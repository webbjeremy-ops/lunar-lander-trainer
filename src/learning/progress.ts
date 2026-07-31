// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Versioned local learning progress.
//
// PURE CORE: every reducer here is a pure function of (state, event). The
// only impure surface is `loadProgress` / `saveProgress`, which are thin
// localStorage adapters around `parseProgress` / `serializeProgress`.
//
// Failure policy: corrupt, truncated, wrong-version or hostile payloads
// NEVER throw and NEVER partially apply. `parseProgress` returns a typed
// result and the caller falls back to a fresh, empty progress record.

export const PROGRESS_SCHEMA = "agc-tranquility.learning-progress";
export const PROGRESS_VERSION = 1;
export const PROGRESS_STORAGE_KEY = "agc-tranquility:learning-progress:v1";

export type DifficultyId = "instructor" | "pilot" | "commander";

export interface ChallengeRecord {
  /** Mission id from src/game/play. */
  readonly missionId: string;
  /** Highest total score achieved on this mission. */
  readonly bestScore: number;
  readonly bestGrade: string;
  readonly bestOutcome: string;
  /** Difficulty levels completed with a successful landing. */
  readonly difficultiesCompleted: readonly DifficultyId[];
  readonly attempts: number;
  /** Epoch milliseconds; supplied by the caller, never read from a clock here. */
  readonly lastPlayedAtMs: number;
}

export interface LearningProgress {
  readonly schema: typeof PROGRESS_SCHEMA;
  readonly version: typeof PROGRESS_VERSION;
  /** Lesson ids the learner has completed, sorted, unique. */
  readonly completedLessons: readonly string[];
  readonly challenges: Readonly<Record<string, ChallengeRecord>>;
  /** Mission ids unlocked by lesson progress, sorted, unique. */
  readonly unlockedMissions: readonly string[];
  readonly lastActivity: {
    readonly lessonId: string | null;
    readonly atMs: number;
  };
}

export const ALWAYS_UNLOCKED_MISSIONS: readonly string[] = [
  // Kept sorted so exported/parsed progress compares structurally equal.
  "free-flight",
  "landing-fundamentals",
];

export function emptyProgress(): LearningProgress {
  return {
    schema: PROGRESS_SCHEMA,
    version: PROGRESS_VERSION,
    completedLessons: [],
    challenges: {},
    unlockedMissions: [...ALWAYS_UNLOCKED_MISSIONS],
    lastActivity: { lessonId: null, atMs: 0 },
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { kind: "lessonCompleted"; lessonId: string; atMs: number; unlocks?: readonly string[] }
  | { kind: "lessonVisited"; lessonId: string; atMs: number }
  | {
      kind: "challengeResult";
      missionId: string;
      difficulty: DifficultyId;
      score: number;
      grade: string;
      outcome: string;
      atMs: number;
    }
  | { kind: "reset" };

const sortedUnique = (xs: readonly string[]): readonly string[] =>
  Array.from(new Set(xs)).sort();

export function reduceProgress(
  prev: LearningProgress,
  event: ProgressEvent,
): LearningProgress {
  switch (event.kind) {
    case "reset":
      return emptyProgress();

    case "lessonVisited":
      if (
        prev.lastActivity.lessonId === event.lessonId &&
        prev.lastActivity.atMs === event.atMs
      ) {
        return prev;
      }
      return { ...prev, lastActivity: { lessonId: event.lessonId, atMs: event.atMs } };

    case "lessonCompleted": {
      const completedLessons = sortedUnique([...prev.completedLessons, event.lessonId]);
      const unlockedMissions = sortedUnique([
        ...prev.unlockedMissions,
        ...(event.unlocks ?? []),
      ]);
      return {
        ...prev,
        completedLessons,
        unlockedMissions,
        lastActivity: { lessonId: event.lessonId, atMs: event.atMs },
      };
    }

    case "challengeResult": {
      const cur = prev.challenges[event.missionId];
      const landed = event.outcome === "landed";
      const better = !cur || event.score > cur.bestScore;
      const next: ChallengeRecord = {
        missionId: event.missionId,
        bestScore: better ? event.score : cur.bestScore,
        bestGrade: better ? event.grade : cur.bestGrade,
        bestOutcome: better ? event.outcome : cur.bestOutcome,
        difficultiesCompleted: sortedUnique([
          ...(cur?.difficultiesCompleted ?? []),
          ...(landed ? [event.difficulty] : []),
        ]) as readonly DifficultyId[],
        attempts: (cur?.attempts ?? 0) + 1,
        lastPlayedAtMs: event.atMs,
      };
      return {
        ...prev,
        challenges: { ...prev.challenges, [event.missionId]: next },
      };
    }

    default:
      return prev;
  }
}

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; progress: LearningProgress }
  | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const finiteNumber = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const DIFFICULTIES: readonly DifficultyId[] = ["instructor", "pilot", "commander"];

function parseChallenge(missionId: string, v: unknown): ChallengeRecord | null {
  if (!isObj(v)) return null;
  const diffs = stringArray(v["difficultiesCompleted"]).filter(
    (d): d is DifficultyId => (DIFFICULTIES as readonly string[]).includes(d),
  );
  return {
    missionId,
    bestScore: finiteNumber(v["bestScore"], 0),
    bestGrade: typeof v["bestGrade"] === "string" ? v["bestGrade"] : "—",
    bestOutcome: typeof v["bestOutcome"] === "string" ? v["bestOutcome"] : "unknown",
    difficultiesCompleted: sortedUnique(diffs) as readonly DifficultyId[],
    attempts: Math.max(0, Math.trunc(finiteNumber(v["attempts"], 0))),
    lastPlayedAtMs: Math.max(0, Math.trunc(finiteNumber(v["lastPlayedAtMs"], 0))),
  };
}

/** Structural + semantic validation. Never throws. */
export function parseProgress(raw: string | null | undefined): ParseResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "empty" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed-json" };
  }
  if (!isObj(decoded)) return { ok: false, reason: "not-an-object" };
  if (decoded["schema"] !== PROGRESS_SCHEMA) {
    return { ok: false, reason: "schema-mismatch" };
  }
  if (decoded["version"] !== PROGRESS_VERSION) {
    return { ok: false, reason: "version-mismatch" };
  }

  // Semantic validation: present-but-wrong-typed fields are a rejection, not
  // something to silently coerce.
  for (const key of ["completedLessons", "unlockedMissions"] as const) {
    if (decoded[key] !== undefined && !Array.isArray(decoded[key])) {
      return { ok: false, reason: `${key}-not-an-array` };
    }
  }
  if (decoded["challenges"] !== undefined && !isObj(decoded["challenges"])) {
    return { ok: false, reason: "challenges-not-an-object" };
  }
  if (decoded["lastActivity"] !== undefined && !isObj(decoded["lastActivity"])) {
    return { ok: false, reason: "lastActivity-not-an-object" };
  }

  const challengesRaw = isObj(decoded["challenges"]) ? decoded["challenges"] : {};
  const challenges: Record<string, ChallengeRecord> = {};
  for (const [missionId, value] of Object.entries(challengesRaw)) {
    const rec = parseChallenge(missionId, value);
    if (rec) challenges[missionId] = rec;
  }

  const lastActivityRaw = isObj(decoded["lastActivity"]) ? decoded["lastActivity"] : {};

  return {
    ok: true,
    progress: {
      schema: PROGRESS_SCHEMA,
      version: PROGRESS_VERSION,
      completedLessons: sortedUnique(stringArray(decoded["completedLessons"])),
      challenges,
      unlockedMissions: sortedUnique([
        ...ALWAYS_UNLOCKED_MISSIONS,
        ...stringArray(decoded["unlockedMissions"]),
      ]),
      lastActivity: {
        lessonId:
          typeof lastActivityRaw["lessonId"] === "string"
            ? (lastActivityRaw["lessonId"] as string)
            : null,
        atMs: Math.max(0, Math.trunc(finiteNumber(lastActivityRaw["atMs"], 0))),
      },
    },
  };
}

export function serializeProgress(p: LearningProgress): string {
  // Deterministic key ordering so exports diff cleanly.
  const challenges: Record<string, ChallengeRecord> = {};
  for (const key of Object.keys(p.challenges).sort()) {
    challenges[key] = p.challenges[key]!;
  }
  return JSON.stringify(
    {
      schema: p.schema,
      version: p.version,
      completedLessons: [...p.completedLessons].sort(),
      challenges,
      unlockedMissions: [...p.unlockedMissions].sort(),
      lastActivity: p.lastActivity,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Storage adapters (only impure surface)
// ---------------------------------------------------------------------------

export function loadProgress(storage?: Storage): LearningProgress {
  const s = storage ?? safeLocalStorage();
  if (!s) return emptyProgress();
  let raw: string | null = null;
  try {
    raw = s.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return emptyProgress();
  }
  const parsed = parseProgress(raw);
  return parsed.ok ? parsed.progress : emptyProgress();
}

export function saveProgress(p: LearningProgress, storage?: Storage): boolean {
  const s = storage ?? safeLocalStorage();
  if (!s) return false;
  try {
    s.setItem(PROGRESS_STORAGE_KEY, serializeProgress(p));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(storage?: Storage): void {
  const s = storage ?? safeLocalStorage();
  if (!s) return;
  try {
    s.removeItem(PROGRESS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
