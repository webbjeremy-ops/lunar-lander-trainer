// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — SENSORS IN, DISPLAY OUT.
//
// The flown descent state (specific force from the DPS, radar altitude) is
// published to the AGC Worker every mission tick. Inside the Worker the
// M3.3E hardware-interface lab turns that into REAL PIPA pulse trains
// (native PINC/MINC into counters 0o37/0o40/0o41) and REAL landing-radar
// transactions (serial RNRAD shift + RADARUPT) applied to the running
// Luminary 099 WASM.
//
// What this hook does NOT do: it does not write AGC registers, and it does
// not let the rope fly the vehicle. The rope is fed authentic hardware
// input; whatever it displays on channel 010 is its own business.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type { MissionSnapshot } from "@/simulation/runtime/types";
import type { SimReadyPayload } from "@/agc/simulationProtocol";
import type { LmDiscreteSensorState } from "@/simulation/agcio/discreteEncoder";
import { GOLDEN_MISSION_SCENARIO } from "@/simulation/runtime/scenarios";

/** Mission tick in the Worker; matches the sensor-encoding cadence. */
const FEED_INTERVAL_MS = 20;
/** Commands must land strictly ahead of the runtime cursor. */
const APPLY_AT_MARGIN_US = 5_000_000;

export interface AgcSensorSample {
  /** Body-axis specific force, m/s^2 (thrust / mass — NO lunar gravity). */
  readonly bodySpecificForceMps2: readonly [number, number, number] | null;
  /** Radar altitude above the surface, metres. */
  readonly altitudeMeters: number | null;
  readonly engineArmed: boolean;
  readonly engineBurning: boolean;
  /** True once the landing radar has valid range (windows-up, below ~40 kft). */
  readonly radarAcquired: boolean;
}

export interface AgcSensorFeedStatus {
  /** Monitor profile actually armed inside the Worker. */
  readonly profile: string;
  readonly status: string;
  readonly blockReasons: readonly string[];
  /** PIPA pulses actually applied to the WASM counters this tick. */
  readonly pipaPulsesDelivered: number;
  readonly chan13RequestsObserved: number;
  readonly radarResponsesDelivered: number;
  readonly interlocked: boolean;
  readonly live: boolean;
}

const IDLE_STATUS: AgcSensorFeedStatus = {
  profile: "off",
  status: "off",
  blockReasons: [],
  pipaPulsesDelivered: 0,
  chan13RequestsObserved: 0,
  radarResponsesDelivered: 0,
  interlocked: false,
  live: false,
};

function avionicsFor(sample: AgcSensorSample): LmDiscreteSensorState {
  return {
    engineArmed: sample.engineArmed,
    autoThrottleEnabled: sample.engineBurning,
    lgcInControl: true,
    issOperate: true,
    imuHealthy: true,
    imuCduHealthy: true,
    pipaHealthy: true,
    landingRadarStatus: sample.radarAcquired ? "acquired-valid" : "not-acquired",
    landingRadarAntenna: sample.radarAcquired ? "descent" : "transit",
    landingRadarRangeLowScale: (sample.altitudeMeters ?? Infinity) < 762,
  };
}

/**
 * Publishes the flown state to the AGC Worker's hardware-interface lab.
 *
 * @param sampleRef a ref the caller keeps current with live flight state;
 *                  read on a timer so the descent loop stays untouched.
 */
export function useAgcSensorFeed(
  client: AgcWorkerClient | null,
  simReady: SimReadyPayload | null,
  missionSnapshot: MissionSnapshot | null,
  sampleRef: React.RefObject<AgcSensorSample>,
  enabled: boolean,
): AgcSensorFeedStatus {
  const [status, setStatus] = useState<AgcSensorFeedStatus>(IDLE_STATUS);
  const nextIdRef = useRef(1);
  const armedEpochRef = useRef<number | null>(null);
  const scenarioEpochRef = useRef<number | null>(null);
  const lastAvionicsRef = useRef<string>("");

  const takeId = useCallback(() => nextIdRef.current++, []);

  // ---- 1. a scenario must be running before any profile can be armed ----
  useEffect(() => {
    if (!enabled || !client || !simReady || !missionSnapshot) return;
    const epoch = simReady.simulationEpoch;
    if (missionSnapshot.status === "running") return;
    if (scenarioEpochRef.current === epoch) return;
    scenarioEpochRef.current = epoch;
    client.enqueueMissionCommand({
      type: "startScenario",
      commandId: takeId(),
      simulationEpoch: epoch,
      applyAtMissionTimeUs: missionSnapshot.missionTimeUs + APPLY_AT_MARGIN_US,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
  }, [enabled, client, simReady, missionSnapshot, takeId]);

  // ---- 2. arm the hardware-interface lab once the scenario is live ------
  useEffect(() => {
    if (!enabled || !client || !simReady || !missionSnapshot) return;
    if (missionSnapshot.status !== "running") return;
    const epoch = simReady.simulationEpoch;
    if (armedEpochRef.current === epoch) return;
    const monitor = missionSnapshot.monitor;
    if (monitor?.status === "active") {
      armedEpochRef.current = epoch;
      return;
    }
    if (monitor?.status === "blocked") return; // surfaced in the readout
    armedEpochRef.current = epoch;
    client.setAvionicsState(takeId(), epoch, avionicsFor(sampleRef.current));
    client.setMonitorProfile(
      takeId(),
      epoch,
      missionSnapshot.missionTimeUs + APPLY_AT_MARGIN_US,
      "agc-hardware-interface-lab-v1",
    );
  }, [enabled, client, simReady, missionSnapshot, sampleRef, takeId]);

  // ---- 3. publish the flown state every mission tick --------------------
  useEffect(() => {
    if (!enabled || !client || !simReady) return;
    const epoch = simReady.simulationEpoch;
    const id = window.setInterval(() => {
      const sample = sampleRef.current;
      client.setExternalFlightState(
        epoch,
        sample.bodySpecificForceMps2,
        sample.altitudeMeters,
      );
      // Discretes only move on real state changes, never per tick.
      const av = avionicsFor(sample);
      const key = JSON.stringify(av);
      if (key !== lastAvionicsRef.current) {
        lastAvionicsRef.current = key;
        client.setAvionicsState(takeId(), epoch, av);
      }
    }, FEED_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, client, simReady, sampleRef, takeId]);

  // ---- 4. mirror the Worker's own diagnostics ---------------------------
  useEffect(() => {
    const monitor = missionSnapshot?.monitor ?? null;
    if (!monitor) {
      setStatus(IDLE_STATUS);
      return;
    }
    const lab = monitor.lab ?? null;
    setStatus({
      profile: monitor.profile,
      status: monitor.status,
      blockReasons: monitor.blockReasons.map((r) => `${r.code}: ${r.detail}`),
      pipaPulsesDelivered: lab?.hardwareInputDelivered ?? 0,
      chan13RequestsObserved: lab?.chan13RequestsObserved ?? 0,
      radarResponsesDelivered: lab?.radarResponsesDelivered ?? 0,
      interlocked: lab?.interlocked ?? false,
      live: monitor.status === "active",
    });
  }, [missionSnapshot]);

  return status;
}
