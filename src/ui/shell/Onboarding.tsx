// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — First-run onboarding.
//
// Four steps, no account, fully keyboard operable, dismissible at any point.
// The chosen assistance level is written into product settings so every
// mission and lesson starts at the level the player picked.

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyOnboarding,
  loadOnboarding,
  onboardingDestination,
  reduceOnboarding,
  saveOnboarding,
  type OnboardingEvent,
  type OnboardingState,
} from "@/onboarding/onboarding";
import { useSettings } from "@/settings/SettingsProvider";
import type { AssistanceLevelId } from "@/settings/settings";

const ASSISTANCE_COPY: Readonly<Record<AssistanceLevelId, string>> = {
  instructor: "Full cues, generous landing limits. Start here.",
  pilot: "Fewer cues, Apollo-like gear limits.",
  commander: "No numeric cues, the tightest limits.",
};

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(() => emptyOnboarding());
  const [loaded, setLoaded] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    setState(loadOnboarding());
    setLoaded(true);
  }, []);

  const dispatch = useCallback((event: OnboardingEvent) => {
    setState((prev) => {
      const next = reduceOnboarding(prev, event);
      if (next !== prev) saveOnboarding(next);
      return next;
    });
  }, []);

  return { state, loaded, dispatch };
}

const btn =
  "rounded border px-3 py-2 text-left font-mono text-[11px] uppercase tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

export function OnboardingFlow() {
  const { state, loaded, dispatch } = useOnboarding();
  const { settings, set } = useSettings();

  if (!loaded || state.completed) return null;

  const stepNumber = ["intent", "assistance", "controls", "launch"].indexOf(state.step) + 1;
  const destination = onboardingDestination(state);

  return (
    <section
      data-testid="onboarding"
      aria-labelledby="onboarding-heading"
      className="rounded border border-emerald-800 bg-emerald-950/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="onboarding-heading"
          className="font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-300"
        >
          Getting started · step {stepNumber} of 4
        </h2>
        <button
          type="button"
          data-testid="onboarding-skip"
          onClick={() => dispatch({ kind: "complete" })}
          className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Skip
        </button>
      </div>

      {state.step === "intent" && (
        <div className="mt-3">
          <p className="text-sm text-neutral-300">
            Do you want to fly first, or learn how the machine works first? No account needed —
            everything is saved in this browser.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              data-testid="onboarding-intent-fly"
              onClick={() => dispatch({ kind: "chooseIntent", intent: "fly" })}
              className={`${btn} border-emerald-600 text-emerald-200 hover:bg-emerald-900/30`}
            >
              Fly a lunar landing
              <span className="mt-1 block font-sans text-[11px] normal-case tracking-normal text-neutral-400">
                Straight into the cockpit with Landing Fundamentals.
              </span>
            </button>
            <button
              type="button"
              data-testid="onboarding-intent-learn"
              onClick={() => dispatch({ kind: "chooseIntent", intent: "learn" })}
              className={`${btn} border-sky-700 text-sky-200 hover:bg-sky-900/30`}
            >
              Learn first
              <span className="mt-1 block font-sans text-[11px] normal-case tracking-normal text-neutral-400">
                Rocket physics, orbital mechanics and the real DSKY.
              </span>
            </button>
          </div>
        </div>
      )}

      {state.step === "assistance" && (
        <div className="mt-3">
          <p className="text-sm text-neutral-300">Pick an assistance level. You can change it any time in Settings.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(["instructor", "pilot", "commander"] as const).map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`onboarding-assistance-${level}`}
                aria-pressed={settings.defaultAssistance === level}
                onClick={() => {
                  set({ defaultAssistance: level });
                  dispatch({ kind: "chooseAssistance", assistance: level });
                }}
                className={`${btn} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
              >
                {level}
                <span className="mt-1 block font-sans text-[11px] normal-case tracking-normal text-neutral-400">
                  {ASSISTANCE_COPY[level]}
                </span>
              </button>
            ))}
          </div>
          <BackButton onClick={() => dispatch({ kind: "back" })} />
        </div>
      )}

      {state.step === "controls" && (
        <div className="mt-3">
          <p className="text-sm text-neutral-300">The controls, in one screen:</p>
          <ul className="mt-2 grid gap-1 text-xs text-neutral-400 sm:grid-cols-2">
            <li>· ↑ / ↓ — throttle up and down</li>
            <li>· ← / → — pitch left and right</li>
            <li>· Shift — fine attitude control</li>
            <li>· Space / on-screen button — engine cutoff or liftoff</li>
            <li>· Tab — move between every control; nothing needs a mouse</li>
            <li>· Touch: the same controls appear as on-screen buttons</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="onboarding-controls-next"
              onClick={() => dispatch({ kind: "next" })}
              className={`${btn} border-emerald-600 text-emerald-200 hover:bg-emerald-900/30`}
            >
              Got it
            </button>
            <BackButton inline onClick={() => dispatch({ kind: "back" })} />
          </div>
        </div>
      )}

      {state.step === "launch" && (
        <div className="mt-3">
          <p className="text-sm text-neutral-300">
            You are set up at <strong className="text-emerald-300">{settings.defaultAssistance}</strong>{" "}
            level. When the flight or lesson ends you land back on a debrief that explains what
            happened and what to try next.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={destination.to}
              data-testid="onboarding-launch"
              onClick={() => dispatch({ kind: "complete" })}
              className={`${btn} border-emerald-500 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-800/40`}
            >
              {destination.label} →
            </Link>
            <BackButton inline onClick={() => dispatch({ kind: "back" })} />
          </div>
        </div>
      )}
    </section>
  );
}

function BackButton({ onClick, inline = false }: { onClick: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      data-testid="onboarding-back"
      onClick={onClick}
      className={`${inline ? "" : "mt-3 "}rounded border border-neutral-700 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400`}
    >
      Back
    </button>
  );
}
