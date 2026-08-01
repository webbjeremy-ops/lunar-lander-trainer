// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.24 — LUNAR CONTACT light.
//
// Two identical blue indicator lamps sat on the LM main instrument panel
// directly in front of the crew, engraved LUNAR CONTACT. They lit the instant
// any one of the 67-inch (1.70 m) mechanical probes hanging from the footpads
// touched the surface — which is why the transcript runs "contact light",
// "okay, engine stop". This module is a pure predicate over game state; it
// reads nothing from the AGC and never commands the engine.

/** Length of the footpad contact probes, metres (67 inches). */
export const CONTACT_PROBE_LENGTH_M = 1.7;

export interface ContactLightInput {
  /** Altitude of the footpads above the surface, metres. */
  readonly altitudeM: number;
  /** Terminal state of the flight, if it has already ended. */
  readonly terminalState: string | null;
}

export interface ContactLightState {
  readonly on: boolean;
  /** Probe travel still to run before the lamps light, metres. */
  readonly metresToContactM: number;
}

/**
 * Blue LUNAR CONTACT lamps. Lit once a probe is touching the surface, and
 * latched on after a successful touchdown. A crash leaves them dark: the
 * vehicle is no longer sitting on its gear.
 */
export function contactLightState(input: ContactLightInput): ContactLightState {
  const altitude = Number.isFinite(input.altitudeM) ? input.altitudeM : Number.POSITIVE_INFINITY;
  const landed = input.terminalState === "landed";
  const crashed = input.terminalState === "crashed";
  const touching = altitude <= CONTACT_PROBE_LENGTH_M;
  return {
    on: !crashed && (landed || touching),
    metresToContactM: Math.max(0, altitude - CONTACT_PROBE_LENGTH_M),
  };
}
