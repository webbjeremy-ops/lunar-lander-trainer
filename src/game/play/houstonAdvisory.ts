// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.18 — Improvised Houston advisories (off-script flight director calls).
//
// The historical air-to-ground transcript (descentCallouts.ts) is only honest
// while the player is flying something like the flown trajectory. The moment
// the vehicle goes off-script — inverted, tumbling, hot, translating, bingo
// fuel — replaying Apollo 11's words would be a lie. This module improvises
// instead: CAPCOM calls that are clearly written for THIS flight, labelled as
// improvised, plus a hard go/no-go for landing.
//
// PURE MODULE: no timers, no side effects, no AGC access. Deterministic.

export type HoustonSeverity = "advisory" | "caution" | "no-go";

export interface HoustonCall {
  readonly id: string;
  readonly severity: HoustonSeverity;
  /** Improvised CAPCOM words — never transcript text. */
  readonly text: string;
  /** What the player must do now. */
  readonly guidance: string;
  /** Why it matters. */
  readonly teaching: string;
  /** True when this deviation alone disqualifies the vehicle for landing. */
  readonly blocksLanding: boolean;
}

export interface FlightDeviationInput {
  readonly altitudeM: number;
  /** Positive is climbing; negative is descending. */
  readonly radialSpeedMps: number;
  /** Signed horizontal (down-range) speed. */
  readonly horizontalSpeedMps: number;
  /** Pitch from local vertical, radians. */
  readonly attitudeRad: number;
  readonly angularRateRadPerSec: number;
  /** Descent propellant remaining, as a fraction of the initial load. */
  readonly propellantFraction: number;
  readonly windowsUp: boolean;
  readonly engineBurning: boolean;
  readonly terminal: boolean;
}

export const HOUSTON_IMPROVISED_NOTE =
  "Improvised CAPCOM call — written for your flight, not the Apollo 11 transcript.";

const DEG = Math.PI / 180;

/**
 * Sink-rate limit for the altitude: the flight-crew rule of thumb of roughly
 * 3 ft/s per 100 ft of altitude, floored so the last few metres stay gentle.
 */
export function sinkRateLimitMps(altitudeM: number): number {
  return Math.max(1.2, Math.min(45, altitudeM * 0.03 + 1));
}

/** Horizontal-velocity limit for the altitude (m/s). */
export function translationLimitMps(altitudeM: number): number {
  if (altitudeM <= 30) return 1.5;
  if (altitudeM <= 150) return 6;
  if (altitudeM <= 600) return 20;
  return 200;
}

function call(
  id: string,
  severity: HoustonSeverity,
  text: string,
  guidance: string,
  teaching: string,
): HoustonCall {
  return { id, severity, text, guidance, teaching, blocksLanding: severity === "no-go" };
}

/**
 * Every deviation currently true, worst first. Pure: same input, same list.
 */
export function houstonDeviations(
  input: FlightDeviationInput,
): readonly HoustonCall[] {
  if (input.terminal) return [];
  const out: HoustonCall[] = [];
  const alt = input.altitudeM;
  const sink = -input.radialSpeedMps;
  const speed = Math.abs(input.horizontalSpeedMps);
  const pitchDeg = Math.abs(input.attitudeRad) / DEG;
  const rateDeg = Math.abs(input.angularRateRadPerSec) / DEG;

  if (pitchDeg > 100) {
    out.push(
      call(
        "attitude-inverted",
        "no-go",
        "Eagle, Houston. We show you past ninety degrees and going over — you are inverted. Get the nose back up.",
        "Hold the opposite attitude key until pitch is back under 60°, then null the rate.",
        "Past the horizontal the descent engine is thrusting you toward the surface, not away from it. Nothing about the landing works from here.",
      ),
    );
  }

  if (rateDeg > 20) {
    out.push(
      call(
        "attitude-tumbling",
        "no-go",
        "Eagle, Houston. Your rates are building — we're showing better than twenty degrees a second. Stop the rate.",
        "Release the attitude keys; tap the opposite direction to null the rotation before you do anything else.",
        "The rate-command law holds an attitude only when you stop commanding rate. A tumbling vehicle cannot resolve radar or fly a landing.",
      ),
    );
  }

  const sinkLimit = sinkRateLimitMps(alt);
  if (sink > sinkLimit * 2) {
    out.push(
      call(
        "sink-excessive",
        "no-go",
        `Eagle, Houston. You are coming down hot — ${Math.round(sink / 0.3048)} feet per second at ${Math.round(alt / 0.3048)} feet. We are no-go for landing on this profile.`,
        "Throttle up now and get the sink rate back under the gear limit before you go lower.",
        "Roughly three feet per second per hundred feet of altitude is the rule that keeps the gear inside its stroke.",
      ),
    );
  } else if (sink > sinkLimit) {
    out.push(
      call(
        "sink-high",
        "caution",
        "Eagle, Houston. Your rate of descent is a little high for that altitude.",
        "Trim the rate of descent down (ROD, or throttle up a touch).",
        "Sink rate has to shrink with altitude — the gear only absorbs so much.",
      ),
    );
  }

  const transLimit = translationLimitMps(alt);
  if (speed > transLimit * 2 && alt < 2_000) {
    out.push(
      call(
        "translation-excessive",
        "no-go",
        `Eagle, Houston. You're moving ${Math.round(speed / 0.3048)} feet per second across the ground at ${Math.round(alt / 0.3048)} feet. No-go for landing until that comes off.`,
        "Pitch back against the direction of travel and burn the horizontal velocity off before descending further.",
        "Horizontal velocity at contact tips the vehicle. The landing has to be flown to near-zero translation.",
      ),
    );
  } else if (speed > transLimit && alt < 2_000) {
    out.push(
      call(
        "translation-high",
        "caution",
        "Eagle, Houston. You're still translating — let's get that forward velocity down.",
        "Pitch a few degrees against your drift and hold it until the horizontal needle centres.",
        "Nulling translation early costs less propellant than fighting it at low gate.",
      ),
    );
  }

  if (input.radialSpeedMps > 3 && alt < 6_000 && input.engineBurning) {
    out.push(
      call(
        "climbing",
        "caution",
        "Eagle, Houston. You're climbing away from the site — back the throttle off.",
        "Reduce throttle until the altitude rate reads negative again.",
        "Every second spent going up is propellant you will not have at low gate.",
      ),
    );
  }

  if (!input.windowsUp && alt < 12_000) {
    out.push(
      call(
        "still-windows-down",
        "caution",
        "Eagle, Houston. We still show you windows-down — the landing radar has nothing.",
        "Hold ROLL (R) until the indicator reads WINDOWS UP.",
        "Face-down, the radar antenna points at black sky and the crew cannot see the site.",
      ),
    );
  }

  if (input.propellantFraction > 0 && input.propellantFraction < 0.04 && alt > 30) {
    out.push(
      call(
        "bingo-fuel",
        "no-go",
        "Eagle, Houston. You are down to the last of the descent propellant. Land it or abort — your call, but make it now.",
        "Get the vehicle down at about 3 ft/s, or hit ABORT STAGE to fire the ascent engine.",
        "Below the low-level point the number that matters is burn time remaining, not tank quantity.",
      ),
    );
  } else if (input.propellantFraction > 0 && input.propellantFraction < 0.1) {
    out.push(
      call(
        "fuel-low",
        "caution",
        "Eagle, Houston. Propellant is getting thin — keep it descending.",
        "Stop manoeuvring laterally and fly a steady descent.",
        "Hovering is the most expensive thing you can do this close to the surface.",
      ),
    );
  }

  if (alt < 300 && pitchDeg > 25 && pitchDeg <= 100) {
    out.push(
      call(
        "attitude-steep",
        "caution",
        "Eagle, Houston. You're low and still pitched over. Bring it upright for the landing.",
        "Fly the pitch back toward 0–10° from vertical.",
        "The gear only lands the vehicle when the thrust axis is near vertical.",
      ),
    );
  }

  const order: Record<HoustonSeverity, number> = { "no-go": 0, caution: 1, advisory: 2 };
  return [...out].sort((a, b) => order[a.severity] - order[b.severity]);
}

/** The single call the cockpit should show, or null when the flight is clean. */
export function activeHoustonCall(
  input: FlightDeviationInput,
  acknowledgedIds: readonly string[] = [],
): HoustonCall | null {
  const list = houstonDeviations(input);
  return (
    list.find((c) => c.severity === "no-go") ??
    list.find((c) => !acknowledgedIds.includes(c.id)) ??
    null
  );
}

export interface LandingClearance {
  readonly clear: boolean;
  readonly reasons: readonly string[];
  readonly label: string;
}

/**
 * Houston's go/no-go. The player is only "clear for landing" when no no-go
 * deviation is standing.
 */
export function landingClearance(input: FlightDeviationInput): LandingClearance {
  const blocking = houstonDeviations(input).filter((c) => c.blocksLanding);
  return {
    clear: blocking.length === 0,
    reasons: blocking.map((c) => c.guidance),
    label: blocking.length === 0 ? "GO FOR LANDING" : "NO-GO FOR LANDING",
  };
}

/**
 * True when the flight has departed the historical profile far enough that
 * replaying the Apollo 11 transcript would be dishonest. The game suppresses
 * scripted crew callouts while this holds and improvises instead.
 */
export function isOffScript(input: FlightDeviationInput): boolean {
  return houstonDeviations(input).some((c) => c.severity !== "advisory");
}

/** The call Houston makes the moment the crew hits ABORT STAGE. */
export const HOUSTON_ABORT_CALL: HoustonCall = {
  id: "abort-stage",
  severity: "no-go",
  text:
    "Eagle, Houston. Copy abort stage — you're staged and on the ascent engine. " +
    "Fly it up, we'll get you a rendezvous solution.",
  guidance:
    "The descent stage is gone. The ascent engine burns at fixed thrust — pitch over and build horizontal velocity for orbit.",
  teaching:
    "Abort stage jettisons the descent stage and lights the ascent engine in one action. It was available at every point in the descent, and it was the crew's only way off the surface path.",
  blocksLanding: true,
};
