// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Learning tracks.
//
// A track is an ordered curation of existing lesson ids. Tracks own no
// lesson content: adding a track never changes a lesson, and every existing
// M2 DSKY lesson keeps working untouched.

export interface LearningTrack {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly lessonIds: readonly string[];
  /** Mission ids unlocked once every lesson in the track is completed. */
  readonly unlocksMissions: readonly string[];
}

export const TRACK_FLYING = "track-flying-on-the-moon";
export const TRACK_ROCKET = "track-rocket-physics";
export const TRACK_AGC = "track-apollo-guidance-computer";
export const TRACK_ORBITAL = "track-orbital-mechanics";

export const LEARNING_TRACKS: readonly LearningTrack[] = [
  {
    id: TRACK_FLYING,
    title: "Track 1 — Flying on the Moon",
    blurb:
      "Why a lander falls the way it does, what the throttle really controls, and how the braking, approach and terminal phases fit together.",
    lessonIds: [
      "lesson-08-why-the-lm-falls",
      "lesson-09-thrust-to-weight",
      "lesson-10-horizontal-velocity",
      "lesson-12-high-gate-to-low-gate",
      "lesson-13-fly-the-terminal-descent",
    ],
    unlocksMissions: ["landing-fundamentals"],
  },
  {
    id: TRACK_ROCKET,
    title: "Track 2 — Rocket Physics",
    blurb:
      "Mass ratio, specific impulse and delta-v — the arithmetic that decides whether a correction is affordable.",
    lessonIds: ["lesson-11-fuel-and-the-rocket-equation", "lesson-16-prepare-for-liftoff"],
    unlocksMissions: ["free-flight"],
  },
  {
    id: TRACK_AGC,
    title: "Track 3 — Apollo Guidance Computer",
    blurb:
      "The authentic Luminary 099 rope, the DSKY you actually operate, and the hardware interfaces that feed it.",
    lessonIds: [
      "lesson-01-meet-the-agc",
      "lesson-02-reading-the-dsky",
      "lesson-03-v35-lamp-test",
      "lesson-04-v16-n65-mission-time",
      "lesson-05-decoding-ch010",
      "lesson-06-annunciators",
      "lesson-14-pipa-and-landing-radar",
      "lesson-07-powered-descent-timeline",
    ],
    unlocksMissions: ["full-descent"],
  },
  {
    id: TRACK_ORBITAL,
    title: "Track 4 — Orbital Mechanics",
    blurb:
      "Orbit as continuous free fall: speed against curvature, periapsis and apoapsis, what liftoff has to buy back, and how to plan the manoeuvres that reshape an orbit.",
    lessonIds: [
      "lesson-15-orbit-is-free-fall",
      "lesson-16-prepare-for-liftoff",
      "lesson-17-reading-an-orbit",
      "lesson-18-save-the-periapsis",
      "lesson-19-circularizing",
      "lesson-20-phasing-and-intercept",
    ],
    unlocksMissions: [
      "save-the-periapsis",
      "circularization-trainer",
      "phasing-burn-trainer",
      "apollo11-orbital-operations",
    ],
  },
] as const;

export function trackForLesson(lessonId: string): LearningTrack | null {
  for (const t of LEARNING_TRACKS) {
    if (t.lessonIds.includes(lessonId)) return t;
  }
  return null;
}

/**
 * Recommend the next lesson: the first not-yet-completed lesson after the
 * given one within its track, else the first incomplete lesson anywhere.
 * Pure and total — returns null only when everything is complete.
 */
export function recommendNextLesson(
  lessonId: string,
  completed: readonly string[],
): string | null {
  const done = new Set(completed);
  const track = trackForLesson(lessonId);
  if (track) {
    const idx = track.lessonIds.indexOf(lessonId);
    for (const id of track.lessonIds.slice(idx + 1)) {
      if (!done.has(id)) return id;
    }
  }
  for (const t of LEARNING_TRACKS) {
    for (const id of t.lessonIds) {
      if (!done.has(id) && id !== lessonId) return id;
    }
  }
  return null;
}

/** Mission ids unlocked by the completed-lesson set. */
export function unlockedMissionsFor(completed: readonly string[]): readonly string[] {
  const done = new Set(completed);
  const out = new Set<string>(["landing-fundamentals", "free-flight", "orbit-fundamentals", "orbit-sandbox"]);
  for (const t of LEARNING_TRACKS) {
    // Partial credit: completing any lesson in a track unlocks its first
    // mission; completing all of them unlocks the rest.
    const anyDone = t.lessonIds.some((id) => done.has(id));
    const allDone = t.lessonIds.every((id) => done.has(id));
    if (anyDone && t.unlocksMissions[0]) out.add(t.unlocksMissions[0]);
    if (allDone) for (const m of t.unlocksMissions) out.add(m);
  }
  return Array.from(out).sort();
}
