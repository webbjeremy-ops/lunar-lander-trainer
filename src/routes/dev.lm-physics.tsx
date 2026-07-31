// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.1 development harness. Minimal, deliberately unstyled. Advances the
// pure physics kernel on requestAnimationFrame using wall-clock deltas
// converted into whole substeps — display cadence has no effect on physics.
//
// This route is NOT the game UI. It exists to visually verify the kernel
// during M3.1 review.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LM_PHYSICS_PARAMETERS,
  createInitialLmState,
  stepLmPhysics,
  type LmControlInput,
  type LmPhysicsState,
} from "@/simulation/lm";
import {
  LUNAR_SCENARIOS,
  LUNAR_SCENARIO_IDS,
  computeOrbitalValues,
  computeReferenceGuidance,
  instantiateLunarScenario,
  stepLunarFlight,
  totalMassKg,
  type LunarControlInput,
  type LunarFlightState,
  type LunarScenarioId,
} from "@/simulation/lunar2d";

export const Route = createFileRoute("/dev/lm-physics")({
  head: () => ({
    meta: [
      { title: "LM Physics Harness · AGC Tranquility (M3.1)" },
      {
        name: "description",
        content:
          "Developer-only harness for the deterministic LM vertical-descent physics kernel.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LmPhysicsHarness,
});

const P = DEFAULT_LM_PHYSICS_PARAMETERS;

function LmPhysicsHarness() {
  const [state, setState] = useState<LmPhysicsState>(() =>
    createInitialLmState(P, {
      altitudeM: 2000,
      verticalVelocityMps: -20,
      propellantMassKg: 1000,
    }),
  );
  const [throttle, setThrottle] = useState(0);
  const [engineEnabled, setEngineEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScale] = useState(1);

  const controlRef = useRef<LmControlInput>({ throttle, engineEnabled });
  controlRef.current = { throttle, engineEnabled };
  const scaleRef = useRef(timeScale);
  scaleRef.current = timeScale;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastMs = performance.now();
    let leftoverUs = 0;
    const substep = P.integration.substepUs;

    const tick = (now: number) => {
      const dtMs = now - lastMs;
      lastMs = now;
      const scaledUs = dtMs * 1000 * scaleRef.current + leftoverUs;
      const wholeSubsteps = Math.floor(scaledUs / substep);
      leftoverUs = scaledUs - wholeSubsteps * substep;
      if (wholeSubsteps > 0) {
        setState((prev) =>
          prev.landed
            ? prev
            : stepLmPhysics(prev, controlRef.current, wholeSubsteps * substep, P),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const reset = useCallback(() => {
    setRunning(false);
    setThrottle(0);
    setEngineEnabled(false);
    setState(
      createInitialLmState(P, {
        altitudeM: 2000,
        verticalVelocityMps: -20,
        propellantMassKg: 1000,
      }),
    );
  }, []);

  const stepOnce = useCallback(() => {
    setState((prev) =>
      stepLmPhysics(prev, controlRef.current, P.integration.substepUs * 5, P),
    );
  }, []);

  const totalMass = state.dryMassKg + state.propellantMassKg;
  const thrustN =
    state.engineEnabled && state.propellantMassKg > 0
      ? state.throttle * P.vehicle.maxThrustN.value
      : 0;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 font-mono text-sm text-neutral-200">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-400">
          M3.1 dev harness
        </p>
        <h1 className="mt-1 text-xl font-semibold text-neutral-100">
          LM vertical-descent physics kernel
        </h1>
        <p className="mt-2 max-w-2xl text-xs text-neutral-500">
          Pure deterministic kernel. Frame rate has no effect on the trajectory;
          only simulation time (converted from wall-clock delta × time scale)
          does. No AGC coupling, no 3D.
        </p>
      </header>

      <section
        aria-label="Physics state"
        className="grid grid-cols-2 gap-4 rounded border border-neutral-800 bg-neutral-900/60 p-4 md:grid-cols-4"
      >
        <Field label="MET" value={`${(state.simulationTimeUs / 1_000_000).toFixed(3)} s`} />
        <Field label="Altitude" value={`${state.altitudeM.toFixed(2)} m`} />
        <Field label="Vertical v" value={`${state.verticalVelocityMps.toFixed(3)} m/s`} />
        <Field label="Throttle" value={`${(state.throttle * 100).toFixed(1)} %`} />
        <Field label="Engine" value={state.engineEnabled ? "ON" : "OFF"} />
        <Field label="Total mass" value={`${totalMass.toFixed(1)} kg`} />
        <Field label="Propellant" value={`${state.propellantMassKg.toFixed(2)} kg`} />
        <Field label="Thrust" value={`${thrustN.toFixed(0)} N`} />
        <Field
          label="Status"
          value={
            state.landed
              ? `LANDED · ${state.touchdown?.classification.toUpperCase()}`
              : "in flight"
          }
        />
        {state.touchdown ? (
          <Field
            label="Touchdown v"
            value={`${state.touchdown.verticalVelocityMps.toFixed(3)} m/s`}
          />
        ) : null}
      </section>

      <section
        aria-label="Controls"
        className="mt-6 flex flex-wrap items-center gap-4 rounded border border-neutral-800 bg-neutral-900/60 p-4"
      >
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={engineEnabled}
            onChange={(e) => setEngineEnabled(e.target.checked)}
            disabled={state.landed}
          />
          Engine enabled
        </label>
        <label className="flex items-center gap-2 text-xs">
          Throttle
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={throttle}
            onChange={(e) => setThrottle(parseFloat(e.target.value))}
            disabled={state.landed}
          />
          <span className="w-12 text-right">{(throttle * 100).toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          Time scale
          <select
            value={timeScale}
            onChange={(e) => setTimeScale(parseFloat(e.target.value))}
          >
            <option value={0.25}>0.25×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={5}>5×</option>
            <option value={10}>10×</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        >
          {running ? "Pause" : "Run"}
        </button>
        <button
          type="button"
          onClick={stepOnce}
          disabled={running || state.landed}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
        >
          Step 50 ms
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        >
          Reset
        </button>
      </section>

      <LunarPlanarHarness />

      <p className="mt-6 text-[10px] uppercase tracking-widest text-neutral-600">
        Dev-only route. Not linked from the primary nav.
      </p>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="mt-1 text-base tabular-nums text-neutral-100">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M4.0 — planar (2D) lunar-flight kernel section
// ---------------------------------------------------------------------------

function LunarPlanarHarness() {
  const [scenarioId, setScenarioId] = useState<LunarScenarioId>("terminal-descent");
  const [instance, setInstance] = useState(() =>
    instantiateLunarScenario("terminal-descent"),
  );
  const [flight, setFlight] = useState<LunarFlightState>(() => instance.state);
  const [throttle, setThrottle] = useState(0);
  const [engine, setEngine] = useState<LunarFlightState["mainEngine"]>("off");
  const [attitudeCommand, setAttitudeCommand] = useState(0);
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScale] = useState(1);

  const params = instance.definition.parameters;

  const inputRef = useRef<LunarControlInput>({
    throttle,
    engineCommand: engine,
    attitudeCommand,
  });
  inputRef.current = { throttle, engineCommand: engine, attitudeCommand };
  const scaleRef = useRef(timeScale);
  scaleRef.current = timeScale;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastMs = performance.now();
    let leftoverUs = 0;
    const substep = params.integration.substepUs;

    const tick = (now: number) => {
      const dtMs = now - lastMs;
      lastMs = now;
      const scaledUs = dtMs * 1000 * scaleRef.current + leftoverUs;
      const wholeSubsteps = Math.floor(scaledUs / substep);
      leftoverUs = scaledUs - wholeSubsteps * substep;
      if (wholeSubsteps > 0) {
        setFlight((prev) =>
          prev.terminalState !== null
            ? prev
            : stepLunarFlight(prev, inputRef.current, wholeSubsteps * substep, params),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, params]);

  const loadScenario = useCallback((id: LunarScenarioId) => {
    const next = instantiateLunarScenario(id);
    setScenarioId(id);
    setInstance(next);
    setFlight(next.state);
    setRunning(false);
    setThrottle(0);
    setEngine("off");
    setAttitudeCommand(0);
  }, []);

  const orbit = computeOrbitalValues(flight, params);
  const guidance = computeReferenceGuidance(flight, params);
  const deg = (rad: number) => `${((rad * 180) / Math.PI).toFixed(2)}°`;

  return (
    <section
      aria-label="Planar lunar flight kernel"
      className="mt-10 border-t border-neutral-800 pt-8"
    >
      <p className="text-xs uppercase tracking-[0.3em] text-sky-400">
        M4.0 planar kernel
      </p>
      <h2 className="mt-1 text-lg font-semibold text-neutral-100">
        Moon-centered 2D flight model
      </h2>
      <p className="mt-2 max-w-2xl text-xs text-neutral-500">
        Inverse-square gravity, variable mass, DPS throttle band, non-throttleable
        APS, RCS attitude and staging. Independent of the frozen 1D kernel and of
        all AGC hardware interfaces.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          Scenario
          <select
            value={scenarioId}
            onChange={(e) => loadScenario(e.target.value as LunarScenarioId)}
          >
            {LUNAR_SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {LUNAR_SCENARIOS[id].title}
              </option>
            ))}
          </select>
        </label>
        <span className="text-neutral-500">
          v{instance.definition.version} · {instance.definition.objective}
        </span>
      </div>

      <div
        aria-label="Planar flight state"
        className="mt-4 grid grid-cols-2 gap-4 rounded border border-neutral-800 bg-neutral-900/60 p-4 md:grid-cols-4"
      >
        <Field label="MET" value={`${(flight.missionTimeUs / 1e6).toFixed(3)} s`} />
        <Field label="Altitude" value={`${orbit.altitudeM.toFixed(1)} m`} />
        <Field label="Vertical v" value={`${orbit.radialSpeedMps.toFixed(3)} m/s`} />
        <Field
          label="Horizontal v"
          value={`${orbit.tangentialSpeedMps.toFixed(3)} m/s`}
        />
        <Field label="Attitude" value={deg(flight.attitudeRad)} />
        <Field label="Rate" value={`${deg(flight.angularRateRadPerSec)}/s`} />
        <Field label="Config" value={flight.configuration} />
        <Field label="Mass" value={`${totalMassKg(flight).toFixed(0)} kg`} />
        <Field label="DPS prop" value={`${flight.descentPropellantKg.toFixed(1)} kg`} />
        <Field label="APS prop" value={`${flight.ascentPropellantKg.toFixed(1)} kg`} />
        <Field label="RCS prop" value={`${flight.rcsPropellantKg.toFixed(2)} kg`} />
        <Field label="Throttle" value={`${(flight.throttle * 100).toFixed(1)} %`} />
        <Field
          label="Apoapsis"
          value={
            orbit.apoapsisAltitudeM === null
              ? "—"
              : `${(orbit.apoapsisAltitudeM / 1000).toFixed(2)} km`
          }
        />
        <Field
          label="Periapsis"
          value={`${(orbit.periapsisAltitudeM / 1000).toFixed(2)} km`}
        />
        <Field label="Eccentricity" value={orbit.eccentricity.toFixed(5)} />
        <Field
          label="Status"
          value={
            flight.terminalState
              ? flight.terminalState.toUpperCase()
              : "in flight"
          }
        />
      </div>

      <div
        aria-label="Reference guidance"
        className="mt-4 grid grid-cols-2 gap-4 rounded border border-sky-900/60 bg-sky-950/20 p-4 md:grid-cols-4"
      >
        <Field
          label="Target sink"
          value={`${guidance.targetRadialSpeedMps.toFixed(2)} m/s`}
        />
        <Field
          label="Advisory throttle"
          value={`${(guidance.recommendedThrottle * 100).toFixed(0)} %`}
        />
        <Field
          label="Advisory attitude"
          value={deg(guidance.recommendedAttitudeRad)}
        />
        <Field label="Cue" value={guidance.advisory} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded border border-neutral-800 bg-neutral-900/60 p-4 text-xs">
        <label className="flex items-center gap-2">
          Engine
          <select
            value={engine}
            onChange={(e) =>
              setEngine(e.target.value as LunarFlightState["mainEngine"])
            }
          >
            <option value="off">off</option>
            <option value="descent">descent (DPS)</option>
            <option value="ascent">ascent (APS)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Throttle
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={throttle}
            onChange={(e) => setThrottle(parseFloat(e.target.value))}
          />
          <span className="w-12 text-right">{(throttle * 100).toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-2">
          Attitude cmd
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={attitudeCommand}
            onChange={(e) => setAttitudeCommand(parseFloat(e.target.value))}
          />
          <span className="w-12 text-right">{attitudeCommand.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2">
          Time scale
          <select
            value={timeScale}
            onChange={(e) => setTimeScale(parseFloat(e.target.value))}
          >
            <option value={0.25}>0.25×</option>
            <option value={1}>1×</option>
            <option value={5}>5×</option>
            <option value={20}>20×</option>
            <option value={100}>100×</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          {running ? "Pause" : "Run"}
        </button>
        <button
          type="button"
          onClick={() =>
            setFlight((prev) =>
              stepLunarFlight(
                prev,
                { ...inputRef.current, stageSeparation: true },
                params.integration.substepUs,
                params,
              ),
            )
          }
          disabled={flight.configuration !== "complete-lm"}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
        >
          Stage separation
        </button>
        <button
          type="button"
          onClick={() => loadScenario(scenarioId)}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          Reset
        </button>
      </div>
    </section>
  );
}

