// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — First-run onboarding state.
//
// Pure core + a localStorage adapter. Onboarding is a four-step flow
// (intent → assistance → controls → launch) and never requires an account.

import type { AssistanceLevelId } from "@/settings/settings";

export const ONBOARDING_SCHEMA = "agc-tranquility.onboarding";
export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = "agc-tranquility:onboarding:v1";

export type OnboardingIntent = "fly" | "learn";
export type OnboardingStep = "intent" | "assistance" | "controls" | "launch";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "intent",
  "assistance",
  "controls",
  "launch",
];

export interface OnboardingState {
  readonly schema: typeof ONBOARDING_SCHEMA;
  readonly version: typeof ONBOARDING_VERSION;
  readonly completed: boolean;
  readonly intent: OnboardingIntent;
  readonly assistance: AssistanceLevelId;
  readonly step: OnboardingStep;
}

export type OnboardingEvent =
  | { readonly kind: "chooseIntent"; readonly intent: OnboardingIntent }
  | { readonly kind: "chooseAssistance"; readonly assistance: AssistanceLevelId }
  | { readonly kind: "next" }
  | { readonly kind: "back" }
  | { readonly kind: "complete" }
  | { readonly kind: "restart" };

export function emptyOnboarding(): OnboardingState {
  return {
    schema: ONBOARDING_SCHEMA,
    version: ONBOARDING_VERSION,
    completed: false,
    intent: "fly",
    assistance: "instructor",
    step: "intent",
  };
}

function stepAt(index: number): OnboardingStep {
  const clamped = Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, index));
  return ONBOARDING_STEPS[clamped]!;
}

export function reduceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  const index = ONBOARDING_STEPS.indexOf(state.step);
  switch (event.kind) {
    case "chooseIntent":
      return { ...state, intent: event.intent, step: "assistance" };
    case "chooseAssistance":
      return { ...state, assistance: event.assistance, step: "controls" };
    case "next":
      return { ...state, step: stepAt(index + 1) };
    case "back":
      return { ...state, step: stepAt(index - 1) };
    case "complete":
      return { ...state, completed: true, step: "launch" };
    case "restart":
      return { ...emptyOnboarding(), intent: state.intent, assistance: state.assistance };
    default:
      return state;
  }
}

/** The route + search a finished onboarding should hand the player to. */
export function onboardingDestination(state: OnboardingState): {
  readonly to: string;
  readonly label: string;
} {
  return state.intent === "learn"
    ? { to: "/learn", label: "Start the first lesson" }
    : { to: "/play", label: "Fly Landing Fundamentals" };
}

export type ParseOnboardingResult =
  | { readonly ok: true; readonly state: OnboardingState }
  | { readonly ok: false; readonly reason: string };

export function parseOnboarding(text: string): ParseOnboardingResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "payload is not an object" };
  }
  const r = raw as Record<string, unknown>;
  if (r["schema"] !== ONBOARDING_SCHEMA) return { ok: false, reason: "unrecognised schema" };
  if (r["version"] !== ONBOARDING_VERSION) return { ok: false, reason: "unsupported version" };
  const base = emptyOnboarding();
  const intent: OnboardingIntent = r["intent"] === "learn" ? "learn" : "fly";
  const assistance = ["instructor", "pilot", "commander"].includes(String(r["assistance"]))
    ? (r["assistance"] as AssistanceLevelId)
    : base.assistance;
  const step = (ONBOARDING_STEPS as readonly string[]).includes(String(r["step"]))
    ? (r["step"] as OnboardingStep)
    : base.step;
  return {
    ok: true,
    state: {
      ...base,
      completed: r["completed"] === true,
      intent,
      assistance,
      step,
    },
  };
}

export function serializeOnboarding(state: OnboardingState): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(state).sort()) {
    sorted[key] = (state as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}

export function loadOnboarding(): OnboardingState {
  if (typeof localStorage === "undefined") return emptyOnboarding();
  let text: string | null = null;
  try {
    text = localStorage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return emptyOnboarding();
  }
  if (!text) return emptyOnboarding();
  const parsed = parseOnboarding(text);
  return parsed.ok ? parsed.state : emptyOnboarding();
}

export function saveOnboarding(state: OnboardingState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, serializeOnboarding(state));
  } catch {
    /* ignore */
  }
}
