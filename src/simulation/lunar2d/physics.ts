// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Pure deterministic planar lunar-flight kernel.
//
// Independent of, and additive to, the frozen 1D kernel in src/simulation/lm.
// Nothing here reads AGC state, monitor output, CHAN11/THRUST/RNRAD, or any
// M3.3E hardware-interface-lab value. The physical state is a closed system.
//
// Integrator: semi-implicit (symplectic) Euler at a fixed internal substep.
// A public step of arbitrary dtUs is broken into whole substeps; fractional
// microseconds are dropped (callers schedule on the substep grid).

import type {
  LunarControlInput,
  LunarFlightState,
  LunarOrbitalValues,
  LunarTouchdownReport,
} from "./types";
import type {
  LunarFlightParameters,
  LunarTerrainModel,
} from "./LunarMissionConstants";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "./LunarMissionConstants";

const TWO_PI = Math.PI * 2;

// -----------------------------------------------------------------------------
// Local frame helpers
// -----------------------------------------------------------------------------

export function magnitude(v: readonly [number, number]): number {
  return Math.hypot(v[0], v[1]);
}

/** Outward radial (local vertical) unit vector at `position`. */
export function localVertical(
  position: readonly [number, number],
): [number, number] {
  const r = magnitude(position);
  if (r === 0) return [0, 1];
  return [position[0] / r, position[1] / r];
}

/** Local horizontal unit vector: local vertical rotated +90 degrees. */
export function localHorizontal(
  position: readonly [number, number],
): [number, number] {
  const u = localVertical(position);
  return [-u[1], u[0]];
}

export function centralAngle(position: readonly [number, number]): number {
  return Math.atan2(position[1], position[0]);
}

/** Terrain radius directly beneath the given central angle. */
export function terrainRadiusAt(
  angleRad: number,
  terrain: LunarTerrainModel,
): number {
  if (terrain.amplitudeM === 0) return terrain.meanRadiusM;
  const k = TWO_PI / terrain.angularWavelengthRad;
  return (
    terrain.meanRadiusM +
    terrain.amplitudeM * Math.sin(k * angleRad + terrain.phaseRad)
  );
}

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TWO_PI;
  while (x < -Math.PI) x += TWO_PI;
  return x;
}

// -----------------------------------------------------------------------------
// Derived orbital values (never stored in state)
// -----------------------------------------------------------------------------

export function computeOrbitalValues(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarOrbitalValues {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const pos = state.positionM;
  const vel = state.velocityMps;
  const r = magnitude(pos);
  const speed = magnitude(vel);
  const u = localVertical(pos);
  const h = localHorizontal(pos);
  const radialSpeed = vel[0] * u[0] + vel[1] * u[1];
  const tangentialSpeed = vel[0] * h[0] + vel[1] * h[1];
  const angle = centralAngle(pos);
  const terrainRadius = terrainRadiusAt(angle, parameters.terrain);

  const energy = (speed * speed) / 2 - mu / r;
  // Planar specific angular momentum (z component).
  const hz = pos[0] * vel[1] - pos[1] * vel[0];
  const eSq = Math.max(0, 1 + (2 * energy * hz * hz) / (mu * mu));
  const eccentricity = Math.sqrt(eSq);

  let semiMajorAxis: number | null = null;
  let apoapsisRadius: number | null = null;
  let periapsisRadius: number;

  if (energy < 0) {
    semiMajorAxis = -mu / (2 * energy);
    apoapsisRadius = semiMajorAxis * (1 + eccentricity);
    periapsisRadius = semiMajorAxis * (1 - eccentricity);
  } else {
    // Parabolic/hyperbolic: no apoapsis. p = h^2 / mu, rp = p / (1 + e).
    const p = (hz * hz) / mu;
    periapsisRadius = eccentricity > 0 ? p / (1 + eccentricity) : r;
  }

  return {
    radiusM: r,
    altitudeM: r - terrainRadius,
    speedMps: speed,
    radialSpeedMps: radialSpeed,
    tangentialSpeedMps: tangentialSpeed,
    specificEnergyJPerKg: energy,
    semiMajorAxisM: semiMajorAxis,
    eccentricity,
    apoapsisRadiusM: apoapsisRadius,
    periapsisRadiusM: periapsisRadius,
    apoapsisAltitudeM:
      apoapsisRadius === null ? null : apoapsisRadius - parameters.terrain.meanRadiusM,
    periapsisAltitudeM: periapsisRadius - parameters.terrain.meanRadiusM,
    centralAngleRad: angle,
    terrainRadiusM: terrainRadius,
  };
}

export function totalMassKg(state: Readonly<LunarFlightState>): number {
  return (
    state.dryMassKg +
    state.descentPropellantKg +
    state.ascentPropellantKg +
    state.rcsPropellantKg
  );
}

// -----------------------------------------------------------------------------
// Initial state construction
// -----------------------------------------------------------------------------

export interface InitialStateOptions {
  readonly altitudeM?: number;
  readonly centralAngleRad?: number;
  /** Positive = climbing. */
  readonly radialSpeedMps?: number;
  /** Positive = prograde. */
  readonly tangentialSpeedMps?: number;
  readonly attitudeRad?: number;
  readonly configuration?: LunarFlightState["configuration"];
  readonly descentPropellantKg?: number;
  readonly ascentPropellantKg?: number;
  readonly rcsPropellantKg?: number;
  readonly missionTimeUs?: number;
}

export function dryMassForConfiguration(
  configuration: LunarFlightState["configuration"],
  parameters: Readonly<LunarFlightParameters>,
): number {
  const descent = parameters.mass.descentStageDryMassKg.value;
  const ascent = parameters.mass.ascentStageDryMassKg.value;
  switch (configuration) {
    case "complete-lm":
      return descent + ascent;
    case "descent-stage":
      return descent;
    case "ascent-stage":
      return ascent;
  }
}

export function createLunarFlightState(
  options: InitialStateOptions = {},
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightState {
  const configuration = options.configuration ?? "complete-lm";
  const angle = options.centralAngleRad ?? 0;
  const terrainRadius = terrainRadiusAt(angle, parameters.terrain);
  const r = terrainRadius + (options.altitudeM ?? 0);
  const u: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const h: [number, number] = [-u[1], u[0]];
  const vr = options.radialSpeedMps ?? 0;
  const vt = options.tangentialSpeedMps ?? 0;

  return {
    missionTimeUs: options.missionTimeUs ?? 0,
    positionM: [r * u[0], r * u[1]],
    velocityMps: [vr * u[0] + vt * h[0], vr * u[1] + vt * h[1]],
    attitudeRad: options.attitudeRad ?? 0,
    angularRateRadPerSec: 0,
    configuration,
    dryMassKg: dryMassForConfiguration(configuration, parameters),
    descentPropellantKg:
      options.descentPropellantKg ??
      (configuration === "ascent-stage"
        ? 0
        : parameters.mass.descentPropellantKg.value),
    ascentPropellantKg:
      options.ascentPropellantKg ??
      (configuration === "descent-stage"
        ? 0
        : parameters.mass.ascentPropellantKg.value),
    rcsPropellantKg:
      options.rcsPropellantKg ??
      (configuration === "descent-stage"
        ? 0
        : parameters.mass.rcsPropellantKg.value),
    mainEngine: "off",
    throttle: 0,
    terminalState: null,
    touchdown: null,
    separatedDescentStage: null,
  };
}

// -----------------------------------------------------------------------------
// Engine models
// -----------------------------------------------------------------------------

/**
 * Map a commanded throttle onto the DPS throttle band:
 *   0                       -> 0 (engine idle/off request)
 *   (0, min)                -> min          (band floor)
 *   [min, maxContinuous]    -> as commanded
 *   (maxContinuous, ftpTh)  -> maxContinuous (erosion region avoided downward)
 *   [ftpThreshold, 1]       -> 1 (FTP)
 */
export function snapDescentThrottle(
  commanded: number,
  parameters: Readonly<LunarFlightParameters>,
): number {
  const d = parameters.descentEngine;
  if (!Number.isFinite(commanded) || commanded <= 0) return 0;
  const t = commanded > 1 ? 1 : commanded;
  if (t < d.minThrottleFraction.value) return d.minThrottleFraction.value;
  if (t <= d.maxContinuousThrottleFraction.value) return t;
  if (t >= d.ftpEngageThresholdFraction.value)
    return d.fixedThrottlePositionFraction.value;
  return d.maxContinuousThrottleFraction.value;
}

interface EngineOutput {
  readonly engine: LunarFlightState["mainEngine"];
  readonly throttle: number;
  readonly thrustN: number;
  readonly ispS: number;
  readonly propellantKey: "descentPropellantKg" | "ascentPropellantKg" | null;
}

function resolveEngine(
  state: Readonly<LunarFlightState>,
  input: Readonly<LunarControlInput>,
  parameters: Readonly<LunarFlightParameters>,
): EngineOutput {
  if (
    input.engineCommand === "descent" &&
    state.configuration === "complete-lm" &&
    state.descentPropellantKg > 0
  ) {
    const throttle = snapDescentThrottle(input.throttle, parameters);
    return {
      engine: throttle > 0 ? "descent" : "off",
      throttle,
      thrustN: throttle * parameters.descentEngine.maxThrustN.value,
      ispS: parameters.descentEngine.specificImpulseS.value,
      propellantKey: "descentPropellantKg",
    };
  }
  if (
    input.engineCommand === "ascent" &&
    state.configuration === "ascent-stage" &&
    state.ascentPropellantKg > 0
  ) {
    // The APS is not throttleable.
    return {
      engine: "ascent",
      throttle: 1,
      thrustN: parameters.ascentEngine.thrustN.value,
      ispS: parameters.ascentEngine.specificImpulseS.value,
      propellantKey: "ascentPropellantKg",
    };
  }
  return {
    engine: "off",
    throttle: 0,
    thrustN: 0,
    ispS: parameters.descentEngine.specificImpulseS.value,
    propellantKey: null,
  };
}

// -----------------------------------------------------------------------------
// Staging
// -----------------------------------------------------------------------------

export function separateDescentStage(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightState {
  if (state.configuration !== "complete-lm") return state;
  const descentDry = parameters.mass.descentStageDryMassKg.value;

  const jettisoned: LunarFlightState = {
    ...state,
    // The descent stage is inert from this instant: it keeps the position and
    // velocity it had at separation and never integrates again.
    configuration: "descent-stage",
    dryMassKg: descentDry,
    descentPropellantKg: state.descentPropellantKg,
    ascentPropellantKg: 0,
    rcsPropellantKg: 0,
    mainEngine: "off",
    throttle: 0,
    angularRateRadPerSec: 0,
    terminalState: state.terminalState ?? null,
    touchdown: state.touchdown,
    separatedDescentStage: null,
  };

  return {
    ...state,
    configuration: "ascent-stage",
    dryMassKg: parameters.mass.ascentStageDryMassKg.value,
    descentPropellantKg: 0,
    mainEngine: "off",
    throttle: 0,
    separatedDescentStage: jettisoned,
  };
}

// -----------------------------------------------------------------------------
// Touchdown evaluation
// -----------------------------------------------------------------------------

export function evaluateTouchdown(
  missionTimeUs: number,
  verticalSpeedMps: number,
  horizontalSpeedMps: number,
  tiltRad: number,
  parameters: Readonly<LunarFlightParameters>,
): LunarTouchdownReport {
  const c = parameters.contact;
  const vs = Math.abs(verticalSpeedMps);
  const hs = Math.abs(horizontalSpeedMps);
  const tilt = Math.abs(wrapAngle(tiltRad));

  const violations: LunarTouchdownReport["violations"][number][] = [];
  let classification: LunarTouchdownReport["classification"] = "landed";

  const bump = (next: LunarTouchdownReport["classification"]) => {
    if (next === "crashed") classification = "crashed";
    else if (classification === "landed") classification = "hard-landing";
  };

  if (vs > c.hardVerticalSpeedMps.value) {
    violations.push("vertical-speed");
    bump("crashed");
  } else if (vs > c.safeVerticalSpeedMps.value) {
    violations.push("vertical-speed");
    bump("hard-landing");
  }
  if (hs > c.hardHorizontalSpeedMps.value) {
    violations.push("horizontal-speed");
    bump("crashed");
  } else if (hs > c.safeHorizontalSpeedMps.value) {
    violations.push("horizontal-speed");
    bump("hard-landing");
  }
  if (tilt > c.hardTiltRad.value) {
    violations.push("tilt");
    bump("crashed");
  } else if (tilt > c.safeTiltRad.value) {
    violations.push("tilt");
    bump("hard-landing");
  }

  return {
    classification,
    missionTimeUs,
    verticalSpeedMps,
    horizontalSpeedMps,
    tiltRad: wrapAngle(tiltRad),
    violations,
  };
}

// -----------------------------------------------------------------------------
// Integrator
// -----------------------------------------------------------------------------

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < -1) return -1;
  if (x > 1) return 1;
  return x;
}

/**
 * Advance the planar flight state by `dtUs` microseconds under a constant
 * control input. Pure: inputs are never mutated, a fresh state is returned.
 */
export function stepLunarFlight(
  state: Readonly<LunarFlightState>,
  input: Readonly<LunarControlInput>,
  dtUs: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightState {
  if (!Number.isFinite(dtUs) || dtUs < 0) {
    throw new RangeError(
      `stepLunarFlight: dtUs must be a finite non-negative number, got ${dtUs}`,
    );
  }

  // Level-triggered staging is applied before dynamics, once per public call.
  let working: LunarFlightState =
    input.stageSeparation && state.configuration === "complete-lm" && state.terminalState === null
      ? separateDescentStage(state, parameters)
      : state;

  const substepUs = parameters.integration.substepUs;
  const substeps = Math.trunc(dtUs / substepUs);
  const advancedUs = substeps * substepUs;

  if (working.terminalState !== null || substeps === 0) {
    // Latch controls (so the UI can reflect the command) but do not integrate.
    const engine = resolveEngine(working, input, parameters);
    if (
      advancedUs === 0 &&
      working === state &&
      engine.engine === state.mainEngine &&
      engine.throttle === state.throttle
    ) {
      return state;
    }
    return {
      ...working,
      missionTimeUs: working.missionTimeUs + advancedUs,
      mainEngine: working.terminalState !== null ? "off" : engine.engine,
      throttle: working.terminalState !== null ? 0 : engine.throttle,
    };
  }

  const dtS = substepUs / 1_000_000;
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const g0 = parameters.environment.standardGravityMps2.value;
  const att = parameters.attitude;

  let px = working.positionM[0];
  let py = working.positionM[1];
  let vx = working.velocityMps[0];
  let vy = working.velocityMps[1];
  let attitude = working.attitudeRad;
  let rate = working.angularRateRadPerSec;
  let descentProp = working.descentPropellantKg;
  let ascentProp = working.ascentPropellantKg;
  let rcsProp = working.rcsPropellantKg;
  let timeUs = working.missionTimeUs;

  let terminal: LunarFlightState["terminalState"] = null;
  let touchdown: LunarTouchdownReport | null = null;
  let lastEngine: LunarFlightState["mainEngine"] = "off";
  let lastThrottle = 0;

  const attitudeCommand = clampUnit(input.attitudeCommand);

  for (let i = 0; i < substeps; i++) {
    const snapshot: LunarFlightState = {
      ...working,
      positionM: [px, py],
      velocityMps: [vx, vy],
      descentPropellantKg: descentProp,
      ascentPropellantKg: ascentProp,
      rcsPropellantKg: rcsProp,
    };
    const engine = resolveEngine(snapshot, input, parameters);
    lastEngine = engine.engine;
    lastThrottle = engine.throttle;

    const dryMass = working.dryMassKg;
    const mass = dryMass + descentProp + ascentProp + rcsProp;

    // --- propulsion -------------------------------------------------------
    let thrust = engine.thrustN;
    let dm = 0;
    if (thrust > 0 && engine.propellantKey) {
      const available =
        engine.propellantKey === "descentPropellantKg" ? descentProp : ascentProp;
      dm = (thrust / (engine.ispS * g0)) * dtS;
      if (dm >= available) {
        // Scale thrust down to what the remaining propellant supports.
        const scale = dm > 0 ? available / dm : 0;
        thrust *= scale;
        dm = available;
      }
    }

    // --- attitude (bounded RCS model) -------------------------------------
    const angularAccel = attitudeCommand * att.maxAngularAccelRadPerSec2.value;
    let rcsBurn = 0;
    if (attitudeCommand !== 0 && rcsProp > 0) {
      rcsBurn = Math.min(
        rcsProp,
        Math.abs(attitudeCommand) * att.rcsMassFlowKgPerSec.value * dtS,
      );
      rate += angularAccel * dtS;
    } else if (attitudeCommand === 0 && Math.abs(rate) < att.rateDeadbandRadPerSec.value) {
      rate = 0;
    }
    const maxRate = att.maxAngularRateRadPerSec.value;
    if (rate > maxRate) rate = maxRate;
    if (rate < -maxRate) rate = -maxRate;
    attitude = wrapAngle(attitude + rate * dtS);
    rcsProp -= rcsBurn;
    if (rcsProp < 0) rcsProp = 0;

    // --- accelerations ----------------------------------------------------
    const r = Math.hypot(px, py);
    const ux = px / r;
    const uy = py / r;
    const gAccel = -mu / (r * r);
    const ca = Math.cos(attitude);
    const sa = Math.sin(attitude);
    // Body axis = local vertical rotated by attitude toward local horizontal.
    const bx = ux * ca + -uy * sa;
    const by = uy * ca + ux * sa;
    const aThrust = mass > 0 ? thrust / mass : 0;

    const ax = gAccel * ux + aThrust * bx;
    const ay = gAccel * uy + aThrust * by;

    // --- semi-implicit Euler ---------------------------------------------
    const nvx = vx + ax * dtS;
    const nvy = vy + ay * dtS;
    const npx = px + nvx * dtS;
    const npy = py + nvy * dtS;

    if (engine.propellantKey === "descentPropellantKg") {
      descentProp -= dm;
      if (descentProp < 0) descentProp = 0;
    } else if (engine.propellantKey === "ascentPropellantKg") {
      ascentProp -= dm;
      if (ascentProp < 0) ascentProp = 0;
    }

    timeUs += substepUs;

    // --- surface contact --------------------------------------------------
    const h0 = r - terrainRadiusAt(Math.atan2(py, px), parameters.terrain);
    const r1 = Math.hypot(npx, npy);
    const h1 = r1 - terrainRadiusAt(Math.atan2(npy, npx), parameters.terrain);

    if (h1 <= 0) {
      const denom = h0 - h1;
      let frac = denom > 0 ? h0 / denom : 0;
      if (!Number.isFinite(frac) || frac < 0) frac = 0;
      if (frac > 1) frac = 1;

      const cvx = vx + (nvx - vx) * frac;
      const cvy = vy + (nvy - vy) * frac;
      const cpx = px + (npx - px) * frac;
      const cpy = py + (npy - py) * frac;
      const cAngle = Math.atan2(cpy, cpx);
      const cTerrain = terrainRadiusAt(cAngle, parameters.terrain);
      const cux = Math.cos(cAngle);
      const cuy = Math.sin(cAngle);
      const vertical = cvx * cux + cvy * cuy;
      const horizontal = cvx * -cuy + cvy * cux;

      const contactTimeUs = timeUs - substepUs + Math.round(frac * substepUs);
      touchdown = evaluateTouchdown(
        contactTimeUs,
        vertical,
        horizontal,
        attitude,
        parameters,
      );
      terminal = touchdown.classification;
      px = cTerrain * cux;
      py = cTerrain * cuy;
      vx = 0;
      vy = 0;
      rate = 0;
      timeUs = contactTimeUs;
      break;
    }

    px = npx;
    py = npy;
    vx = nvx;
    vy = nvy;

    // --- propellant depletion while the engine is commanded ---------------
    if (
      engine.propellantKey === "descentPropellantKg" &&
      descentProp === 0 &&
      thrust > 0
    ) {
      terminal = "propellant-depleted";
      break;
    }
    if (
      engine.propellantKey === "ascentPropellantKg" &&
      ascentProp === 0 &&
      thrust > 0
    ) {
      terminal = "propellant-depleted";
      break;
    }
  }

  let next: LunarFlightState = {
    ...working,
    missionTimeUs: timeUs,
    positionM: [px, py],
    velocityMps: [vx, vy],
    attitudeRad: attitude,
    angularRateRadPerSec: terminal === null ? rate : 0,
    descentPropellantKg: descentProp,
    ascentPropellantKg: ascentProp,
    rcsPropellantKg: rcsProp,
    mainEngine: terminal === null ? lastEngine : "off",
    throttle: terminal === null ? lastThrottle : 0,
    terminalState: terminal,
    touchdown: touchdown ?? working.touchdown,
  };

  // --- orbit insertion --------------------------------------------------
  if (
    next.terminalState === null &&
    next.configuration === "ascent-stage" &&
    next.mainEngine === "off"
  ) {
    const orbit = computeOrbitalValues(next, parameters);
    if (
      orbit.altitudeM > 0 &&
      orbit.periapsisAltitudeM >= parameters.integration.orbitPeriapsisAltitudeM
    ) {
      next = { ...next, terminalState: "orbit-achieved" };
    }
  }

  return next;
}
