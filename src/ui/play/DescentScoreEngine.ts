// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.21 — Procedural descent score (Web Audio renderer).
//
// No audio assets: the score is synthesised, so it is a few hundred bytes of
// code instead of a few megabytes of MP3, and it can follow the flight
// continuously instead of being cut to a fixed length. The musical decisions
// live in the pure model (`src/game/play/descentScore.ts`); this class only
// renders them.
//
// Layers:
//   drone       two detuned sub oscillators through a low-pass — the bed
//   pulse       gated bass note, rate rising with tension (the heartbeat)
//   strings     a minor-second-flavoured cluster that fades in mid-descent
//   dissonance  a high tritone partial that only appears when it is going wrong
//   rumble      filtered noise, the descent engine through the structure

import {
  chordForStep,
  melodyNotesPerChord,
  scoreLayers,
  type ScoreLayers,
} from "@/game/play/descentScore";


type Ctx = AudioContext;

const ROOT_HZ = 55; // A1 — the bed
const FIFTH_HZ = 82.41; // E2
const MINOR_THIRD_HZ = 65.41; // C2
const TRITONE_HZ = 311.13; // D#4 against A — the dread interval

function ramp(param: AudioParam, value: number, ctx: Ctx, seconds = 0.35): void {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, Math.max(0.02, seconds / 3));
}

function makeNoiseBuffer(ctx: Ctx): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic pseudo-noise so the texture is identical every run.
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

export class DescentScoreEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private stringsGain: GainNode | null = null;
  private dissonanceGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private melodyGain: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private pulseTimer: number | null = null;
  private melodyTimer: number | null = null;
  private melodyStep = 0;
  private currentChordName: string | null = null;

  private layers: ScoreLayers = scoreLayers(0);

  private volume = 0.7;
  private started = false;

  get isRunning(): boolean {
    return this.started;
  }

  /** Safe to call repeatedly: a suspended context is resumed on each gesture. */
  start(): void {
    if (typeof window === "undefined") return;
    if (this.started) {
      // Created before the user gesture: the context is suspended, resume it.
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
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = "lowpass";
    bedFilter.frequency.value = 300;
    bedFilter.Q.value = 0.8;
    bedFilter.connect(master);
    this.bedFilter = bedFilter;

    // --- drone -------------------------------------------------------------
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(bedFilter);
    this.droneGain = droneGain;
    for (const [hz, detune] of [
      [ROOT_HZ, -6],
      [ROOT_HZ, 7],
      [FIFTH_HZ, 0],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      osc.connect(g).connect(droneGain);
      osc.start();
    }

    // --- strings cluster ---------------------------------------------------
    const stringsGain = ctx.createGain();
    stringsGain.gain.value = 0;
    stringsGain.connect(master);
    this.stringsGain = stringsGain;
    for (const hz of [MINOR_THIRD_HZ * 2, FIFTH_HZ * 2, ROOT_HZ * 4]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      // Slow vibrato so the cluster breathes instead of sitting static.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 3.5;
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start();
      osc.connect(g).connect(stringsGain);
      osc.start();
    }

    // --- dissonance --------------------------------------------------------
    const dissonanceGain = ctx.createGain();
    dissonanceGain.gain.value = 0;
    dissonanceGain.connect(master);
    this.dissonanceGain = dissonanceGain;
    for (const hz of [TRITONE_HZ, TRITONE_HZ * 1.005]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      osc.connect(g).connect(dissonanceGain);
      osc.start();
    }

    // --- engine rumble -----------------------------------------------------
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleGain.connect(master);
    this.rumbleGain = rumbleGain;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 110;
    noise.connect(noiseFilter).connect(rumbleGain);
    noise.start();

    // --- pulse bus ---------------------------------------------------------
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0;
    pulseGain.connect(master);
    this.pulseGain = pulseGain;

    // --- under-melody bus (organ) -------------------------------------------
    const melodyGain = ctx.createGain();
    melodyGain.gain.value = 0;
    const melodyDelay = ctx.createDelay(1.5);
    melodyDelay.delayTime.value = 0.42;
    const melodyFeedback = ctx.createGain();
    melodyFeedback.gain.value = 0.35;
    const melodyWet = ctx.createGain();
    melodyWet.gain.value = 0.45;
    melodyGain.connect(master);
    melodyGain.connect(melodyDelay);
    melodyDelay.connect(melodyFeedback).connect(melodyDelay);
    melodyDelay.connect(melodyWet).connect(master);
    this.melodyGain = melodyGain;

    this.started = true;
    this.applyLayers();
    ramp(master.gain, this.volume, ctx, 2.5);
    this.scheduleNextPulse();
    this.scheduleNextNote();
  }


  stop(): void {
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = null;
    if (this.melodyTimer !== null) window.clearTimeout(this.melodyTimer);
    this.melodyTimer = null;
    const ctx = this.ctx;
    if (ctx && this.master) {

      ramp(this.master.gain, 0, ctx, 0.6);
      window.setTimeout(() => void ctx.close().catch(() => undefined), 900);
    }
    this.ctx = null;
    this.master = null;
    this.started = false;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master) ramp(this.master.gain, this.volume, this.ctx, 0.4);
  }

  /** Feed the current tension (0..1); the engine re-balances its layers. */
  setTension(tension: number): void {
    this.layers = scoreLayers(tension);
    this.applyLayers();
  }

  private applyLayers(): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const l = this.layers;
    if (this.droneGain) ramp(this.droneGain.gain, 0.22 * l.drone, ctx, 1.5);
    if (this.stringsGain) ramp(this.stringsGain.gain, 0.3 * l.strings, ctx, 2.5);
    if (this.dissonanceGain) ramp(this.dissonanceGain.gain, 0.4 * l.dissonance, ctx, 0.8);
    if (this.rumbleGain) ramp(this.rumbleGain.gain, 0.1 + 0.16 * l.drone, ctx, 1.5);
    if (this.bedFilter) ramp(this.bedFilter.frequency, l.cutoffHz, ctx, 1.5);
    if (this.melodyGain) ramp(this.melodyGain.gain, 0.26 * l.melody, ctx, 2.0);
  }

  /**
   * Under-melody: A-minor organ line that evolves with the mission. Early on
   * it is two sustained pedal tones; as tension builds it opens into a
   * four-note figure and finally a running eight/twelve-note arpeggio with a
   * shorter, more articulated attack — the Zimmer/"Interstellar" build.
   */
  private scheduleNextNote(): void {
    if (!this.started) return;
    const stepMs = Math.max(280, this.layers.melodyNoteSec * 1000);
    this.melodyTimer = window.setTimeout(() => {
      this.tickNote();
      this.scheduleNextNote();
    }, stepMs);
  }

  /**
   * Pattern as chord-tone indices (0,1,2 = chord tones; 3+ wrap an octave up),
   * so the same figure re-colours as the bass chord moves underneath.
   */
  private melodyPattern(arp: number): readonly number[] {
    if (arp < 0.25) return [0, 2]; // pedal: root and fifth
    if (arp < 0.5) return [0, 2, 1, 4]; // simple rocking figure
    if (arp < 0.78) return [0, 1, 2, 4, 2, 1]; // rising/falling arpeggio
    return [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 4]; // full running line
  }


  private tickNote(): void {
    const ctx = this.ctx;
    const bus = this.melodyGain;
    if (!ctx || !bus || this.layers.melody <= 0) return;

    const arp = this.layers.melodyArp;
    const seq = this.melodyPattern(arp);
    const step = this.melodyStep;
    const chord = chordForStep(step, arp);
    const perChord = melodyNotesPerChord(arp);

    // New chord? Sound the bass root underneath before the melody note.
    if (step % perChord === 0 && chord.name !== this.currentChordName) {
      this.currentChordName = chord.name;
      this.tickBass(chord.bassHz, perChord);
    }

    const degree = seq[step % seq.length]!;
    const tones = chord.tonesHz;
    const base = tones[degree % tones.length]! * 2 ** Math.floor(degree / tones.length);
    this.melodyStep += 1;


    const now = ctx.currentTime;
    // Sustained and overlapping when simple; short and articulated when fast.
    const overlap = 2.2 - 1.3 * arp;
    const hold = Math.max(0.35, this.layers.melodyNoteSec * overlap);
    const attack = 0.24 - 0.2 * arp;
    const level = (0.16 - 0.05 * arp) * this.layers.melody;

    // Organ voice: fundamental + octave + soft fifth + sub.
    for (const [mult, weight] of [
      [1, 1],
      [2, 0.45],
      [3, 0.18],
      [0.5, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(level * weight, now + Math.max(0.02, attack));
      g.gain.setTargetAtTime(0.0001, now + hold * 0.55, hold * 0.28);
      osc.connect(g).connect(bus);
      osc.start(now);
      osc.stop(now + hold + 0.6);
    }
  }



  /** One heartbeat: a short bass thud whose rate tracks tension. */
  private scheduleNextPulse(): void {
    if (!this.started) return;
    const bpm = this.layers.pulseBpm;
    const intervalMs = Math.max(180, (60_000 / bpm));
    this.pulseTimer = window.setTimeout(() => {
      this.tickPulse();
      this.scheduleNextPulse();
    }, intervalMs);
  }

  private tickPulse(): void {
    const ctx = this.ctx;
    const bus = this.pulseGain;
    if (!ctx || !bus || this.layers.pulse <= 0) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, 0.5 * this.layers.pulse), now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(g).connect(bus);
    bus.gain.setValueAtTime(1, now);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Chord root under the melody: a long, swelling low note on each change. */
  private tickBass(hz: number, notesPerChord: number): void {
    const ctx = this.ctx;
    const bus = this.melodyGain;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const dur = Math.max(1.2, this.layers.melodyNoteSec * notesPerChord);
    const level = 0.2 * this.layers.melody;
    for (const [mult, weight, type] of [
      [1, 1, "sine"],
      [2, 0.3, "sine"],
      [3, 0.1, "triangle"],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(level * weight, now + 0.5);
      g.gain.setTargetAtTime(0.0001, now + dur * 0.6, dur * 0.3);
      osc.connect(g).connect(bus);
      osc.start(now);
      osc.stop(now + dur + 1.0);
    }
  }
}
