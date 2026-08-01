// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Modest synthesized audio.
//
// Every sound in Tranquility is generated at runtime with a WebAudio
// oscillator. No mission recordings, no sampled assets, nothing copyrighted.
// The cues are deliberately abstract: a key click, a caution tone, a
// contact-light chirp and a success chord.
//
// The AudioContext is created lazily on the first user-gesture-driven cue and
// is a single shared instance for the whole app. If WebAudio is unavailable
// (SSR, locked-down browser) every call is a silent no-op.

export type SoundCue = "key" | "caution" | "contact" | "success" | "failure";

interface CueShape {
  readonly freq: number;
  readonly endFreq?: number;
  readonly durationS: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

const CUES: Readonly<Record<SoundCue, CueShape>> = {
  key: { freq: 880, durationS: 0.04, type: "square", gain: 0.16 },
  caution: { freq: 440, endFreq: 392, durationS: 0.35, type: "sawtooth", gain: 0.22 },
  contact: { freq: 1320, durationS: 0.12, type: "sine", gain: 0.25 },
  success: { freq: 523.25, endFreq: 1046.5, durationS: 0.42, type: "triangle", gain: 0.24 },
  failure: { freq: 220, endFreq: 110, durationS: 0.5, type: "sawtooth", gain: 0.24 },
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let currentVolume = 0;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = currentVolume;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Set the master gain. `0` mutes without tearing the context down. */
export function setMasterVolume(volume: number): void {
  currentVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  if (master) master.gain.value = currentVolume;
}

export interface PlayOptions {
  readonly enabled: boolean;
  readonly volume: number;
}

/** Play one cue. Never throws; returns false when nothing was played. */
export function playCue(cue: SoundCue, opts: PlayOptions): boolean {
  if (!opts.enabled || opts.volume <= 0) return false;
  const audio = ensureContext();
  if (!audio || !master) return false;
  setMasterVolume(opts.volume);
  try {
    if (audio.state === "suspended") void audio.resume();
    const shape = CUES[cue];
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = shape.type;
    osc.frequency.setValueAtTime(shape.freq, now);
    if (shape.endFreq !== undefined) {
      osc.frequency.linearRampToValueAtTime(shape.endFreq, now + shape.durationS);
    }
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(shape.gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + shape.durationS);
    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + shape.durationS + 0.02);
    return true;
  } catch {
    return false;
  }
}

/** Test/teardown hook. */
export function disposeAudio(): void {
  try {
    void ctx?.close();
  } catch {
    /* ignore */
  }
  ctx = null;
  master = null;
}
