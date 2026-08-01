// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — /settings : audio, accessibility, units, controls and progress.
//
// Everything is local to this browser. No account, no server, no telemetry.

import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useSettings } from "@/settings/SettingsProvider";
import { SENSITIVITY_MAX, SENSITIVITY_MIN } from "@/settings/settings";
import { useLearningProgress } from "@/ui/learn/useLearningProgress";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — audio, accessibility, units · Tranquility" },
      {
        name: "description",
        content:
          "Volume, reduced motion, high contrast, metric or Apollo-style units, control sensitivity, keyboard mapping, touch size, default assistance, and progress export or reset.",
      },
      { property: "og:title", content: "Settings · Tranquility" },
      {
        property: "og:description",
        content: "Accessibility, units and control preferences, stored locally in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-400">
            Settings
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Make it fit you</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Every preference is stored in this browser only. There is no account and nothing is
            uploaded.
          </p>
        </header>
        <ClientOnly fallback={<p className="text-xs text-neutral-500">Loading settings…</p>}>
          <SettingsForm />
        </ClientOnly>
      </div>
    </main>
  );
}

const fieldset = "rounded border border-neutral-800 bg-neutral-950/60 p-4";
const legend = "font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-400";
const label = "flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-neutral-300";
const control =
  "rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";
const button =
  "rounded border border-neutral-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

function SettingsForm() {
  const { settings, set, reset, exportJson, importJson, playCue } = useSettings();
  const progress = useLearningProgress();
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const announce = (message: string) => setStatus(message);

  return (
    <div className="space-y-4" data-testid="settings-form">
      <fieldset className={fieldset}>
        <legend className={legend}>Audio</legend>
        <label className={label} htmlFor="master-volume">
          <span>
            Master volume
            <span className="ml-2 font-mono text-[11px] text-neutral-500">
              {Math.round(settings.masterVolume * 100)}%
            </span>
          </span>
          <input
            id="master-volume"
            data-testid="setting-master-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.masterVolume}
            onChange={(e) => set({ masterVolume: Number(e.target.value) })}
            className="w-48"
          />
        </label>
        <label className={label} htmlFor="sound-effects">
          <span>
            Sound effects
            <span className="ml-2 text-[11px] text-neutral-500">
              Synthesized cues only — no mission recordings.
            </span>
          </span>
          <input
            id="sound-effects"
            data-testid="setting-sound-effects"
            type="checkbox"
            checked={settings.soundEffects}
            onChange={(e) => set({ soundEffects: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <button
          type="button"
          className={button}
          data-testid="setting-test-sound"
          onClick={() => {
            playCue("contact");
            announce("Played the contact-light cue.");
          }}
        >
          Test sound
        </button>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Accessibility</legend>
        <label className={label} htmlFor="reduced-motion">
          <span>
            Reduced motion
            <span className="ml-2 text-[11px] text-neutral-500">
              Stops non-essential animation. Every mission stays fully playable.
            </span>
          </span>
          <input
            id="reduced-motion"
            data-testid="setting-reduced-motion"
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => set({ reducedMotion: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <label className={label} htmlFor="high-contrast">
          <span>
            High contrast
            <span className="ml-2 text-[11px] text-neutral-500">
              Stronger borders and brighter text on every panel.
            </span>
          </span>
          <input
            id="high-contrast"
            data-testid="setting-high-contrast"
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => set({ highContrast: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Display</legend>
        <label className={label} htmlFor="units">
          <span>
            Units
            <span className="ml-2 text-[11px] text-neutral-500">
              Apollo-style shows feet, feet per second and pounds, as the crew read them.
            </span>
          </span>
          <select
            id="units"
            data-testid="setting-units"
            className={control}
            value={settings.units}
            onChange={(e) => set({ units: e.target.value === "apollo" ? "apollo" : "metric" })}
          >
            <option value="metric">Metric (m, m/s, kg)</option>
            <option value="apollo">Apollo-style (ft, fps, lb)</option>
          </select>
        </label>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Controls</legend>
        <label className={label} htmlFor="sensitivity">
          <span>
            Control sensitivity
            <span className="ml-2 font-mono text-[11px] text-neutral-500">
              ×{settings.controlSensitivity.toFixed(2)}
            </span>
          </span>
          <input
            id="sensitivity"
            data-testid="setting-sensitivity"
            type="range"
            min={SENSITIVITY_MIN}
            max={SENSITIVITY_MAX}
            step={0.05}
            value={settings.controlSensitivity}
            onChange={(e) => set({ controlSensitivity: Number(e.target.value) })}
            className="w-48"
          />
        </label>
        <label className={label} htmlFor="keyboard-map">
          <span>Keyboard mapping</span>
          <select
            id="keyboard-map"
            data-testid="setting-keyboard-map"
            className={control}
            value={settings.keyboardMap}
            onChange={(e) => set({ keyboardMap: e.target.value === "wasd" ? "wasd" : "arrows" })}
          >
            <option value="arrows">Arrow keys (↑↓ throttle, ←→ pitch)</option>
            <option value="wasd">WASD (W/S throttle, A/D pitch)</option>
          </select>
        </label>
        <label className={label} htmlFor="touch-size">
          <span>Touch-control size</span>
          <select
            id="touch-size"
            data-testid="setting-touch-size"
            className={control}
            value={settings.touchControlSize}
            onChange={(e) =>
              set({
                touchControlSize:
                  e.target.value === "small"
                    ? "small"
                    : e.target.value === "large"
                      ? "large"
                      : "medium",
              })
            }
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className={label} htmlFor="default-assistance">
          <span>Default assistance level</span>
          <select
            id="default-assistance"
            data-testid="setting-default-assistance"
            className={control}
            value={settings.defaultAssistance}
            onChange={(e) => {
              const v = e.target.value;
              set({
                defaultAssistance:
                  v === "pilot" ? "pilot" : v === "commander" ? "commander" : "instructor",
              });
            }}
          >
            <option value="instructor">Instructor — full cues</option>
            <option value="pilot">Pilot — fewer cues</option>
            <option value="commander">Commander — no numeric cues</option>
          </select>
        </label>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Progress &amp; data</legend>
        <p className="py-2 text-xs text-neutral-400">
          {progress.progress.completedLessons.length} lesson
          {progress.progress.completedLessons.length === 1 ? "" : "s"} completed.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            data-testid="settings-export-progress"
            onClick={() => {
              downloadJson("tranquility-progress.json", progress.exportJson());
              announce("Exported your learning progress.");
            }}
          >
            Export progress
          </button>
          <button
            type="button"
            className={button}
            data-testid="settings-import-progress"
            onClick={() => fileRef.current?.click()}
          >
            Import progress
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            data-testid="settings-import-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const text = await file.text();
              const failure = progress.importJson(text);
              announce(failure ?? "Progress imported.");
            }}
          />
          <button
            type="button"
            className={button}
            data-testid="settings-export-settings"
            onClick={() => {
              downloadJson("tranquility-settings.json", exportJson());
              announce("Exported your settings.");
            }}
          >
            Export settings
          </button>
          <button
            type="button"
            className={button}
            data-testid="settings-import-settings"
            onClick={() => {
              const raw = window.prompt("Paste a Tranquility settings JSON export:");
              if (raw === null) return;
              announce(importJson(raw) ?? "Settings imported.");
            }}
          >
            Import settings
          </button>
          <button
            type="button"
            data-testid="settings-reset-progress"
            className="rounded border border-rose-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-rose-300 hover:bg-rose-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
            onClick={() => {
              if (!window.confirm("Erase all lesson progress and scores in this browser?")) return;
              progress.reset();
              announce("Progress reset.");
            }}
          >
            Reset progress
          </button>
          <button
            type="button"
            data-testid="settings-reset-settings"
            className={button}
            onClick={() => {
              reset();
              announce("Settings restored to defaults.");
            }}
          >
            Reset settings
          </button>
        </div>
        <p role="status" data-testid="settings-status" className="mt-3 text-xs text-emerald-300">
          {status}
        </p>
      </fieldset>
    </div>
  );
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
