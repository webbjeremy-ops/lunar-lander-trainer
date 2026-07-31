// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Progress panel: summary, reset, export, import.

import { useRef, useState } from "react";
import type { LearningProgressApi } from "./useLearningProgress";

export function ProgressPanel({
  api,
  totalLessons,
}: {
  api: LearningProgressApi;
  totalLessons: number;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const p = api.progress;
  const challenges = Object.values(p.challenges);

  return (
    <section
      className="rounded border border-neutral-800 bg-neutral-900/40 p-3"
      aria-label="Learning progress"
      data-testid="progress-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">
          Progress
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
        >
          {open ? "Hide data" : "Manage"}
        </button>
      </div>

      <p className="mt-2 font-mono text-[11px] text-neutral-300" data-testid="progress-summary">
        {p.completedLessons.length}/{totalLessons} lessons ·{" "}
        {challenges.length} challenge{challenges.length === 1 ? "" : "s"} flown ·{" "}
        {p.unlockedMissions.length} missions unlocked
      </p>

      {challenges.length > 0 && (
        <ul className="mt-2 space-y-1">
          {challenges.map((c) => (
            <li key={c.missionId} className="font-mono text-[10px] text-neutral-400">
              <span className="text-neutral-200">{c.missionId}</span> — best {c.bestScore} (
              {c.bestGrade}) · {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
              {c.difficultiesCompleted.length > 0 && (
                <> · landed at {c.difficultiesCompleted.join(", ")}</>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="progress-export"
              onClick={() => {
                if (textRef.current) textRef.current.value = api.exportJson();
                setMessage("Exported to the text box — copy it somewhere safe.");
              }}
              className="rounded border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
            >
              Export
            </button>
            <button
              type="button"
              data-testid="progress-import"
              onClick={() => {
                const raw = textRef.current?.value ?? "";
                const err = api.importJson(raw);
                setMessage(err ?? "Progress imported.");
              }}
              className="rounded border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
            >
              Import
            </button>
            <button
              type="button"
              data-testid="progress-reset"
              onClick={() => {
                api.reset();
                setMessage("Progress reset.");
              }}
              className="rounded border border-red-800 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-950/40"
            >
              Reset
            </button>
          </div>
          <label className="block">
            <span className="sr-only">Progress data (JSON)</span>
            <textarea
              ref={textRef}
              rows={4}
              data-testid="progress-json"
              placeholder="Paste exported progress JSON here to import"
              className="w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-[10px] text-neutral-300"
            />
          </label>
          {message && (
            <p className="font-mono text-[10px] text-amber-300" role="status" data-testid="progress-message">
              {message}
            </p>
          )}
          <p className="font-mono text-[9px] text-neutral-600">
            Stored locally in this browser only. No account, no server.
          </p>
        </div>
      )}
    </section>
  );
}
