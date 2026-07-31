// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Pure lesson ⇄ game handoff codec.
//
// A lesson launches /play with a challenge request encoded in the URL query
// string (shareable, reload-safe). /play writes the flight result back into
// sessionStorage under a versioned key; /learn drains it on return.
//
// Nothing here imports the AGC, the worker, or the physics kernel.

export const HANDOFF_VERSION = 1;
export const HANDOFF_RESULT_KEY = "agc-tranquility:challenge-result:v1";

export interface ChallengeRequest {
  readonly version: number;
  readonly lessonId: string;
  readonly stepId: string;
  readonly missionId: string;
  readonly assistance: string;
  readonly controlMode: string;
  readonly passingScore: number;
}

export interface ChallengeResult {
  readonly version: number;
  readonly lessonId: string;
  readonly stepId: string;
  readonly missionId: string;
  readonly difficulty: string;
  readonly score: number;
  readonly maxScore: number;
  readonly grade: string;
  readonly outcome: string;
  readonly passed: boolean;
  /** Player flight data shown in the lesson debrief. */
  readonly flight: {
    readonly verticalSpeedMps: number;
    readonly horizontalSpeedMps: number;
    readonly propellantRemainingKg: number;
    readonly landingZoneErrorM: number;
    readonly missionTimeS: number;
  };
  readonly atMs: number;
}

export function encodeChallengeRequest(req: ChallengeRequest): string {
  const p = new URLSearchParams();
  p.set("cv", String(req.version));
  p.set("lesson", req.lessonId);
  p.set("step", req.stepId);
  p.set("mission", req.missionId);
  p.set("assist", req.assistance);
  p.set("mode", req.controlMode);
  p.set("pass", String(req.passingScore));
  return p.toString();
}

/** Defensive: unknown / malformed / wrong-version query strings yield null. */
export function decodeChallengeRequest(
  search: string | URLSearchParams | null | undefined,
): ChallengeRequest | null {
  if (search === null || search === undefined) return null;
  let p: URLSearchParams;
  try {
    p = typeof search === "string" ? new URLSearchParams(search) : search;
  } catch {
    return null;
  }
  const version = Number(p.get("cv"));
  if (version !== HANDOFF_VERSION) return null;
  const lessonId = p.get("lesson");
  const stepId = p.get("step");
  const missionId = p.get("mission");
  if (!lessonId || !stepId || !missionId) return null;
  const passingScore = Number(p.get("pass"));
  return {
    version: HANDOFF_VERSION,
    lessonId,
    stepId,
    missionId,
    assistance: p.get("assist") || "instructor",
    controlMode: p.get("mode") || "quick-manual",
    passingScore: Number.isFinite(passingScore) ? passingScore : 0,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Defensive parse of a stored result. Never throws. */
export function parseChallengeResult(raw: string | null | undefined): ChallengeResult | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (v["version"] !== HANDOFF_VERSION) return null;
  if (typeof v["lessonId"] !== "string" || typeof v["missionId"] !== "string") return null;
  const flight = isObj(v["flight"]) ? v["flight"] : {};
  return {
    version: HANDOFF_VERSION,
    lessonId: v["lessonId"],
    stepId: typeof v["stepId"] === "string" ? v["stepId"] : "",
    missionId: v["missionId"],
    difficulty: typeof v["difficulty"] === "string" ? v["difficulty"] : "instructor",
    score: num(v["score"]),
    maxScore: num(v["maxScore"]) || 100,
    grade: typeof v["grade"] === "string" ? v["grade"] : "—",
    outcome: typeof v["outcome"] === "string" ? v["outcome"] : "unknown",
    passed: v["passed"] === true,
    flight: {
      verticalSpeedMps: num(flight["verticalSpeedMps"]),
      horizontalSpeedMps: num(flight["horizontalSpeedMps"]),
      propellantRemainingKg: num(flight["propellantRemainingKg"]),
      landingZoneErrorM: num(flight["landingZoneErrorM"]),
      missionTimeS: num(flight["missionTimeS"]),
    },
    atMs: num(v["atMs"]),
  };
}

export function serializeChallengeResult(r: ChallengeResult): string {
  return JSON.stringify(r);
}

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function publishChallengeResult(r: ChallengeResult, storage?: Storage): boolean {
  const s = storage ?? safeSessionStorage();
  if (!s) return false;
  try {
    s.setItem(HANDOFF_RESULT_KEY, serializeChallengeResult(r));
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes any pending result. Returns null when nothing valid. */
export function drainChallengeResult(storage?: Storage): ChallengeResult | null {
  const s = storage ?? safeSessionStorage();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(HANDOFF_RESULT_KEY);
    if (raw !== null) s.removeItem(HANDOFF_RESULT_KEY);
  } catch {
    return null;
  }
  return parseChallengeResult(raw);
}
