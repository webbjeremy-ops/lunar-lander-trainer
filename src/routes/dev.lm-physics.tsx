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
