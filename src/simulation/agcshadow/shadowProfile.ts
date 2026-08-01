// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — experimental profile identity and the labels that MUST be shown
// wherever it is active.

export const RECONSTRUCTED_PDI_SHADOW_PROFILE_ID = "reconstructed-pdi-shadow-v1";

export const SHADOW_BANNER_LINES: readonly string[] = [
  "EXPERIMENTAL LUMINARY SHADOW MODE",
  "RECONSTRUCTED PDI INITIALIZATION — NOT THE ORIGINAL APOLLO 11 INPUT DECK",
  "REAL LUMINARY099 · REAL SIMULATED SENSOR INPUTS · NO AGC CONTROL OF VEHICLE PHYSICS",
];

export const THRUST_SEMANTICS_WARNING =
  "THRUST IS A COMMAND DELTA INTO THE DECA SUMMING JUNCTION — IT IS NOT PHYSICAL ENGINE THRUST";

export const PRODUCT_METHODOLOGY_NOTE =
  "Luminary Shadow Mode uses a reconstructed powered-descent initialization. " +
  "The emulator and sensor interfaces are real. The initialization is not the " +
  "recovered Apollo 11 input deck. Luminary output does not control the vehicle in M4.6A.";

/** The profile is never the default descent mode. */
export const SHADOW_PROFILE_IS_DEFAULT = false;

export type ShadowBootstrapStatus = "not-installed" | "installed" | "rejected" | "invalidated";

export interface ShadowProfileState {
  readonly profileId: typeof RECONSTRUCTED_PDI_SHADOW_PROFILE_ID;
  readonly active: boolean;
  readonly bootstrap: ShadowBootstrapStatus;
  /** AGC epoch the bootstrap was installed in; a reset invalidates it. */
  readonly installedInAgcEpoch: number | null;
}

export const INACTIVE_SHADOW_PROFILE: ShadowProfileState = {
  profileId: RECONSTRUCTED_PDI_SHADOW_PROFILE_ID,
  active: false,
  bootstrap: "not-installed",
  installedInAgcEpoch: null,
};

/** A reset (new AGC epoch) invalidates any installed experimental state. */
export function applyAgcEpoch(
  state: ShadowProfileState,
  agcEpoch: number,
): ShadowProfileState {
  if (state.installedInAgcEpoch === null || state.installedInAgcEpoch === agcEpoch) {
    return state;
  }
  return {
    ...state,
    active: false,
    bootstrap: "invalidated",
    installedInAgcEpoch: null,
  };
}

/** Leaving the profile removes ALL experimental state. */
export function exitShadowProfile(): ShadowProfileState {
  return INACTIVE_SHADOW_PROFILE;
}
