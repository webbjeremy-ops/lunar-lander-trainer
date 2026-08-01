// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.13 — Historically grounded crew-callout timeline for powered descent.
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// These are the calls the Apollo 11 crew and CAPCOM made during powered
// descent, paraphrased from the air-to-ground transcript and the mission
// report, keyed to the same reconstruction the rest of the game uses
// (src/content/apollo11PoweredDescentReference.ts). They are raised by the
// GAME, never by the pinned Luminary 099 rope, and every consumer labels them
// as a bridged overlay.
//
// Each callout carries: who said it, what they said, what the learner has to
// do about it, and why. Triggers are keyed to BOTH ignition-relative time and
// altitude, because the game's planar trajectory does not run at exactly the
// flown timeline — whichever condition is met first fires the call.
//
// PURE MODULE: no timers, no side effects, no AGC access.

const S = 1_000_000;
const FT = 0.3048;

export type CalloutSpeaker =
  | "Armstrong"
  | "Aldrin"
  | "Duke (CAPCOM)"
  | "Vehicle";

export type CalloutAction =
  | "none"
  | "roll"
  | "dsky"
  | "throttle"
  | "land";

export interface DescentCallout {
  readonly id: string;
  readonly speaker: CalloutSpeaker;
  /** The call itself, paraphrased from the transcript. */
  readonly text: string;
  /** What the player must do now, in plain language. */
  readonly guidance: string;
  /** Why it matters — the teaching line. */
  readonly teaching: string;
  readonly action: CalloutAction;
  /** Fires at or after this many seconds since ignition. */
  readonly atSinceIgnitionSec: number;
  /** …or as soon as the vehicle is at or below this altitude (metres). */
  readonly belowAltitudeM: number | null;
  /** Coarse program label shown on the card. */
  readonly programLabel: string;
}

export const CALLOUT_CITATION = {
  label: "Apollo 11 air-to-ground transcript / Apollo 11 Mission Report",
  detail:
    "Crew and CAPCOM calls are paraphrased from the transcript and the " +
    "telemetry-derived mission log. They are raised by the game as a bridged " +
    "overlay, not by the Luminary 099 rope.",
} as const;

function c(
  id: string,
  speaker: CalloutSpeaker,
  text: string,
  guidance: string,
  teaching: string,
  action: CalloutAction,
  atSinceIgnitionSec: number,
  belowAltitudeFt: number | null,
  programLabel: string,
): DescentCallout {
  return {
    id,
    speaker,
    text,
    guidance,
    teaching,
    action,
    atSinceIgnitionSec,
    belowAltitudeM: belowAltitudeFt === null ? null : belowAltitudeFt * FT,
    programLabel,
  };
}

/**
 * The descent script, in flight order. Altitudes are the telemetry-derived
 * figures from the powered-descent reconstruction (49,971 ft at PDI, 42,426 ft
 * at the face-up roll, 7,129 ft entering P64, ~500 ft at low gate).
 */
export const APOLLO11_DESCENT_CALLOUTS: readonly DescentCallout[] = [
  c(
    "ignition",
    "Aldrin",
    "Ignition. Ten percent.",
    "Leave the throttle alone. The DPS holds 10 % for 26 seconds while the engine settles.",
    "A cold start at minimum thrust lets the chamber stabilise before guidance asks for full throttle.",
    "none",
    0,
    null,
    "P63",
  ),
  c(
    "throttle-up",
    "Armstrong",
    "Throttle up. Looks good.",
    "Nothing to do — guidance takes the engine to the fixed throttle point for the braking phase.",
    "The braking phase burns off ~5,500 ft/s of orbital velocity at fixed maximum thrust.",
    "none",
    26,
    null,
    "P63",
  ),
  c(
    "roll-windows-up",
    "Aldrin",
    "Coming up on the yaw-around — windows up, let's get the radar looking down.",
    "HOLD R (or the ROLL button) until the roll indicator reads WINDOWS UP — about 18 seconds of roll.",
    "Eagle flew the first minutes face-down. Rolling windows-up points the landing-radar antenna at the surface and puts the ground in the crew's window.",
    "roll",
    45,
    42_426,
    "P63 · roll",
  ),
  c(
    "radar-good",
    "Duke (CAPCOM)",
    "Eagle, Houston. We've got you on radar — Delta-H looks good.",
    "Key V16 N68 E to watch Delta-H: the disagreement between radar altitude and the computer's own estimate.",
    "Delta-H is the go/no-go for trusting the landing radar. A small Delta-H means the radar and the state vector agree.",
    "dsky",
    140,
    37_462,
    "P63 · LR",
  ),
  c(
    "lr-accept",
    "Armstrong",
    "Delta-H is small. Accepting radar.",
    "Key V57 E to tell the computer to start folding radar altitude into its state estimate.",
    "Without V57 the AGC keeps navigating on inertial data alone, and altitude error grows all the way down.",
    "dsky",
    215,
    35_000,
    "P63 · LR",
  ),
  c(
    "high-gate",
    "Duke (CAPCOM)",
    "Eagle, Houston. You're go for landing.",
    "High gate. The vehicle pitches up and the site comes into the window — key V06 N64 E for the approach display.",
    "High gate (~7,600 ft) is where P64 takes over and the landing-point designator angle becomes meaningful.",
    "dsky",
    520,
    7_600,
    "P64",
  ),
  c(
    "site-assessment",
    "Armstrong",
    "Pretty rocky area… I'm going to fly a little longer.",
    "Look out the window. Use LEFT/RIGHT to pitch and steer past the boulder field before you commit.",
    "In P64 the commander can redesignate the aim point; Armstrong flew past West Crater's ejecta before settling.",
    "throttle",
    600,
    2_000,
    "P64",
  ),
  c(
    "low-gate",
    "Aldrin",
    "Five hundred feet, down at nineteen… forty-seven forward.",
    "Take P66 (V37 E 6 6 E). Then fly it: hold sink under 3 ft/s per 100 ft, and null forward velocity before contact.",
    "Low gate (~500 ft) is where the descent becomes a visual, semi-manual landing on the rate-of-descent switch.",
    "land",
    640,
    500,
    "P66",
  ),
  c(
    "quantity-light",
    "Duke (CAPCOM)",
    "Sixty seconds.",
    "Propellant is low. Get down: keep sink around 3 ft/s and stop translating.",
    "The low-level light starts a burn-time countdown, not a tank reading. Eagle landed with about 25 seconds left.",
    "land",
    680,
    200,
    "P66",
  ),
  c(
    "contact",
    "Aldrin",
    "Contact light.",
    "Cut the engine (SPACE) as the probes touch.",
    "A probe on a landing leg touches first; the crew's cue is the light, then ENG STOP.",
    "land",
    9_999,
    12,
    "P66 · contact",
  ),
] as const;

export interface CalloutInput {
  readonly sinceIgnitionUs: number;
  readonly altitudeM: number;
  readonly burning: boolean;
}

/** Every callout whose trigger condition has been met, in flight order. */
export function triggeredCallouts(
  input: CalloutInput,
  timeline: readonly DescentCallout[] = APOLLO11_DESCENT_CALLOUTS,
): readonly DescentCallout[] {
  if (input.sinceIgnitionUs <= 0 && !input.burning) return [];
  const t = input.sinceIgnitionUs / S;
  return timeline.filter(
    (call) =>
      t >= call.atSinceIgnitionSec ||
      (call.belowAltitudeM !== null && input.altitudeM <= call.belowAltitudeM),
  );
}

/**
 * The callout the cockpit should be showing: the latest triggered call the
 * player has not acknowledged yet.
 */
export function activeCallout(
  input: CalloutInput,
  acknowledgedIds: readonly string[],
  timeline: readonly DescentCallout[] = APOLLO11_DESCENT_CALLOUTS,
): DescentCallout | null {
  const fired = triggeredCallouts(input, timeline);
  for (let i = fired.length - 1; i >= 0; i--) {
    const call = fired[i]!;
    if (!acknowledgedIds.includes(call.id)) return call;
  }
  return null;
}

export function calloutById(id: string): DescentCallout | null {
  return APOLLO11_DESCENT_CALLOUTS.find((c) => c.id === id) ?? null;
}
