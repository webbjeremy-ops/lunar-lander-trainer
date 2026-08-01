// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Ascent mission briefing and setup screen.

import {
  ASCENT_MISSIONS,
  ASCENT_MISSION_IDS,
  getAscentTarget,
  NMI_M,
  type AscentMissionId,
  type AssistanceLevel,
} from "@/game/ascent";

const ASSISTANCE_COPY: Record<AssistanceLevel, { title: string; body: string }> = {
  instructor: {
    title: "Instructor",
    body: "Pitch-program cue drawn on the orbit view and spelled out numerically.",
  },
  pilot: {
    title: "Pilot",
    body: "Cue shown, no extra margin. The intended way to fly these ascents.",
  },
  commander: {
    title: "Commander",
    body: "Numeric cues suppressed. Instruments only, tightest periapsis floor.",
  },
};

export function AscentMissionSelect({
  missionId,
  assistance,
  onMission,
  onAssistance,
  onStart,
}: {
  missionId: AscentMissionId;
  assistance: AssistanceLevel;
  onMission: (id: AscentMissionId) => void;
  onAssistance: (a: AssistanceLevel) => void;
  onStart: () => void;
}) {
  const mission = ASCENT_MISSIONS[missionId];
  const target = getAscentTarget(mission.targetOrbitId);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="ascent-select">
      <div className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">
          Ascent missions
        </h2>
        {ASCENT_MISSION_IDS.map((id) => {
          const m = ASCENT_MISSIONS[id];
          const active = id === missionId;
          return (
            <button
              key={id}
              data-testid={`ascent-mission-${id}`}
              onClick={() => {
                onMission(id);
                onAssistance(m.defaultAssistance);
              }}
              className={
                "w-full rounded border px-3 py-2 text-left transition-colors " +
                (active
                  ? "border-emerald-600 bg-emerald-950/30"
                  : "border-neutral-800 bg-neutral-950 hover:border-neutral-600")
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-neutral-100">{m.title}</span>
                <span className="font-mono text-[10px] text-neutral-500">{m.order}</span>
              </div>
              <div className="font-mono text-[10px] text-neutral-500">{m.subtitle}</div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3 rounded border border-neutral-800 bg-neutral-950 p-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">{mission.title}</h1>
          <p className="mt-1 text-sm text-neutral-400">{mission.summary}</p>
        </div>

        <div className="rounded border border-neutral-800 bg-black/50 px-3 py-2 text-sm">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">
            Objective
          </div>
          <div className="text-neutral-200">{mission.objective}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-neutral-400 md:grid-cols-4">
          <Fact
            label="Target orbit"
            value={`${(target.periapsisAltitudeM / NMI_M).toFixed(0)} × ${(target.apoapsisAltitudeM / NMI_M).toFixed(0)} nmi`}
          />
          <Fact
            label="In kilometres"
            value={`${(target.periapsisAltitudeM / 1000).toFixed(0)} × ${(target.apoapsisAltitudeM / 1000).toFixed(0)} km`}
          />
          <Fact label="APS propellant" value={`${mission.ascentPropellantKg.toFixed(0)} kg`} />
          <Fact
            label="Periapsis floor"
            value={`${(mission.safePeriapsisAltitudeM / 1000).toFixed(0)} km`}
          />
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
            Assistance
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {(["instructor", "pilot", "commander"] as const).map((a) => (
              <button
                key={a}
                data-testid={`ascent-assist-${a}`}
                aria-pressed={a === assistance}
                onClick={() => onAssistance(a)}
                className={
                  "rounded border px-2 py-2 text-left transition-colors " +
                  (a === assistance
                    ? "border-emerald-600 bg-emerald-950/30"
                    : "border-neutral-800 bg-black/40 hover:border-neutral-600")
                }
              >
                <div className="text-xs text-neutral-100">{ASSISTANCE_COPY[a].title}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">
                  {ASSISTANCE_COPY[a].body}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded border border-neutral-800 bg-black/50 px-3 py-2 font-mono text-[10px] leading-snug text-neutral-500">
          Target provenance: {target.classification} · {target.rationale}
        </div>

        <p className="rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-amber-200/80">
          {mission.historicalNote}
        </p>

        <button
          onClick={onStart}
          data-testid="ascent-start"
          className="w-full rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-xs uppercase tracking-widest text-emerald-200 hover:bg-emerald-900/40"
        >
          Begin ascent
        </button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-neutral-600">{label}</div>
      <div className="text-neutral-200">{value}</div>
    </div>
  );
}
