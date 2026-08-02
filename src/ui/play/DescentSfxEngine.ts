// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.26 — Cockpit sound effects (Web Audio renderer).
//
// Synthesised, like the score: no assets, and every layer can follow the live
// flight state continuously.
//
//   engine   filtered noise + sub tone, level and brightness follow throttle
//   boost    one-shot swell at DPS ignition and at throttle-up
//   alarm    the AGC master-alarm tone, pulsed while a 1201/1202 is unresolved
//   contact  short chime when the footpad probes touch
//
// Presentation only: nothing here feeds back into the simulation.

type Ctx = AudioContext;

/** AGC master alarm tone — a hard, narrow square-ish beep. */
const ALARM_HZ = 750;
const ALARM_PERIOD_MS = 620;

function makeNoiseBuffer(ctx: Ctx): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x1f123bb5;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

export class DescentSfxEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineSubGain: GainNode | null = null;
  private alarmTimer: number | null = null;
  private started = false;
  private volume = 0.8;

  get isRunning(): boolean {
    return this.started;
  }

  /** Safe to call repeatedly; resumes a context suspended by autoplay policy. */
  start(): void {
    if (typeof window === "undefined") return;
    if (this.started) {
      if (this.ctx && this.ctx.state !== "running") void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;

    // --- descent engine ------------------------------------------------------
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(master);
    this.engineGain = engineGain;

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 120;
    engineFilter.Q.value = 0.9;
    engineFilter.connect(engineGain);
    this.engineFilter = engineFilter;

    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    noise.loop = true;
    noise.connect(engineFilter);
    noise.start();

    // A sub tone under the noise gives the DPS its weight.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 38;
    const subGain = ctx.createGain();
    subGain.gain.value = 0;
    sub.connect(subGain).connect(master);
    sub.start();
    this.engineSub = sub;
    this.engineSubGain = subGain;

    this.started = true;
  }

  stop(): void {
    this.setAlarm(false);
    const ctx = this.ctx;
    if (ctx && this.master) {
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
    }
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineSub = null;
    this.engineSubGain = null;
    this.started = false;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const ctx = this.ctx;
    if (ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.12);
    }
  }

  /** Continuous engine bed: `throttle` is 0..1, silent when the DPS is cold. */
  setEngine(throttle: number, on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const t = on ? Math.max(0, Math.min(1, throttle)) : 0;
    const now = ctx.currentTime;
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime(on ? 0.06 + 0.34 * t : 0, now, 0.12);
    }
    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(90 + 620 * t * t, now, 0.15);
    }
    if (this.engineSubGain) {
      this.engineSubGain.gain.setTargetAtTime(on ? 0.05 + 0.18 * t : 0, now, 0.15);
    }
    if (this.engineSub) {
      this.engineSub.frequency.setTargetAtTime(34 + 22 * t, now, 0.2);
    }
  }

  /**
   * One-shot ignition / throttle-up swell. `strength` 0..1 scales the hit —
   * TIG and the fixed-throttle-point run-up get the full one. The swell hits
   * hard, then decays away over ~8 s so it does not sit on top of the mix for
   * the rest of the burn.
   */
  boost(strength = 1): void {
    const ctx = this.ctx;
    const bus = this.master;
    if (!ctx || !bus || !this.started) return;
    const now = ctx.currentTime;
    const s = Math.max(0.15, Math.min(1, strength));
    const amp = 0.26 * s;
    // Full-volume plateau, then a fade so the score comes back through.
    const hold = 5 + 3 * s; // 5..8 s at full level
    const fade = 4; // seconds to fade out
    const tail = hold + fade;

    // Noise swell.
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.setValueAtTime(140, now);
    nf.frequency.linearRampToValueAtTime(900, now + 0.9);
    nf.frequency.setValueAtTime(900, now + hold);
    nf.frequency.linearRampToValueAtTime(220, now + tail);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(amp, now + 0.22);
    ng.gain.setValueAtTime(amp, now + hold);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    ng.gain.linearRampToValueAtTime(0, now + tail + 0.05);
    noise.connect(nf).connect(ng).connect(bus);
    noise.start(now);
    noise.stop(now + tail + 0.1);

    // Rising sub thump under it.
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(28, now);
    osc.frequency.exponentialRampToValueAtTime(64, now + 0.8);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(amp * 0.8, now + 0.18);
    og.gain.setValueAtTime(amp * 0.8, now + hold);
    og.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    og.gain.linearRampToValueAtTime(0, now + tail + 0.05);
    osc.connect(og).connect(bus);
    osc.start(now);
    osc.stop(now + tail + 0.1);
  }


  /** Master-alarm tone, pulsed until the crew clears the program alarm. */
  setAlarm(on: boolean): void {
    if (on) {
      if (this.alarmTimer !== null || !this.started) return;
      this.alarmBeep();
      this.alarmTimer = window.setInterval(() => this.alarmBeep(), ALARM_PERIOD_MS);
      return;
    }
    if (this.alarmTimer !== null) {
      window.clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
  }

  /** Short bright chime for the LUNAR CONTACT lamps. */
  contactChime(): void {
    const ctx = this.ctx;
    const bus = this.master;
    if (!ctx || !bus || !this.started) return;
    const now = ctx.currentTime;
    for (const [hz, delay] of [
      [880, 0],
      [1318.5, 0.09],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + delay);
      g.gain.exponentialRampToValueAtTime(0.22, now + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.55);
      osc.connect(g).connect(bus);
      osc.start(now + delay);
      osc.stop(now + delay + 0.6);
    }
  }

  private alarmBeep(): void {
    const ctx = this.ctx;
    const bus = this.master;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = ALARM_HZ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    g.gain.setValueAtTime(0.16, now + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    // Gentle low-pass keeps the square from being painful.
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    osc.connect(f).connect(g).connect(bus);
    osc.start(now);
    osc.stop(now + 0.4);
  }
}
