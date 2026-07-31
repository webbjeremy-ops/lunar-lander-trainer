// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Mission briefing and setup screen.

import {
  LANDING_LIMITS,
  MISSIONS,
  MISSION_IDS,
  type AssistanceLevel,
  type ControlModeId,
  type MissionId,
} from "@/game/play";

const ASSISTANCE_COPY: Record<AssistanceLevel, { title: string; body: string }> = {
  instructor: {
    title: "Instructor",
    body: "Full guidance cues, generous gear limits, wide landing zone. Learn the shape of a descent.",
  },
  pilot: {
    title: "Pilot",
    body: "Cues shown, realistic gear limits. The intended way to fly these missions.",
  },
  commander: {
    title: "Commander",
    body: "Numeric cues suppressed, tightest gear limits and landing zone. Armstrong had less.",
  },
};

const MODE_COPY: Record<ControlModeId, { title: string; body: string }> = {
  "quick-manual": {
    title: "Quick Manual",
    body: "Fly immediately. No DSKY procedure required — scored at half credit for procedure.",
  },
  "agc-assisted": {
    title: "AGC-Assisted",
    body: "Work the real DSKY procedure. Guidance flies the braking phase; you take P66 to land.",
  },
  training: {
    title: "Training",
    body: "AGC-Assisted with hints always one keystroke away and no clock pressure.",
  },
};

export function MissionSelect({
  missionId,
  controlMode,
  assistance,
  onMission,
  onControlMode,
  onAssistance,
  onStart,
}: {
  missionId: MissionId;
  controlMode: ControlModeId;
  assistance: AssistanceLevel;
  onMission: (id: MissionId) => void;
  onControlMode: (m: ControlModeId) => void;
  onAssistance: (a: AssistanceLevel) => void;
  onStart: () => void;
}) {
  const mission = MISSIONS[missionId];
  const limits = LANDING_LIMITS[assistance];

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="mission-select">
      <div className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">Missions</h2>
        {MISSION_IDS.map((id) => {
          const m = MISSIONS[id];
          const active = id === missionId;
          return (
            <button
              key={id}
              data-testid={`mission-${id}`}
              onClick={() => {
                onMission(id);
                onControlMode(m.defaultControlMode);
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
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">Objective</div>
          <div className="text-neutral-200">{mission.objective}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-neutral-400 md:grid-cols-4">
          <Fact label="Start altitude" value={`${mission.initial.altitudeM.toLocaleString()} m`} />
          <Fact label="Downrange" value={`${(mission.initial.rangeToLandingZoneM / 1000).toFixed(1)} km`} />
          <Fact label="Horizontal" value={`${mission.initial.tangentialSpeedMps.toFixed(0)} m/s`} />
          <Fact label="DPS propellant" value={`${mission.initial.descentPropellantKg.toLocaleString()} kg`} />
        </div>

        <Group title="Control mode">
          {mission.availableControlModes.map((m) => (
            <Option
              key={m}
              testid={`mode-${m}`}
              active={m === controlMode}
              title={MODE_COPY[m].title}
              body={MODE_COPY[m].body}
              onClick={() => onControlMode(m)}
            />
          ))}
        </Group>

        <Group title="Assistance">
          {(["instructor", "pilot", "commander"] as const).map((a) => (
            <Option
              key={a}
              testid={`assist-${a}`}
              active={a === assistance}
              title={ASSISTANCE_COPY[a].title}
              body={ASSISTANCE_COPY[a].body}
              onClick={() => onAssistance(a)}
            />
          ))}
        </Group>

        <div className="rounded border border-neutral-800 bg-black/50 px-3 py-2 font-mono text-[10px] text-neutral-500">
          Gear limits: ≤ {limits.verticalSpeedMps} m/s vertical · ≤{" "}
          {limits.horizontalSpeedMps} m/s lateral · ≤{" "}
          {((limits.tiltRad * 180) / Math.PI).toFixed(0)}° tilt · zone radius{" "}
          {limits.landingZoneRadiusM} m
        </div>

        <p className="rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-amber-200/80">
          {mission.historicalNote}
        </p>

        <button
          onClick={onStart}
          data-testid="mission-start"
          className="w-full rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-xs uppercase tracking-widest text-emerald-200 hover:bg-emerald-900/40"
        >
          Begin mission
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">{title}</div>
      <div className="grid gap-2 md:grid-cols-3">{children}</div>
    </div>
  );
}

function Option({
  active,
  title,
  body,
  onClick,
  testid,
}: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      className={
        "rounded border px-2 py-2 text-left transition-colors " +
        (active
          ? "border-emerald-600 bg-emerald-950/30"
          : "border-neutral-800 bg-black/40 hover:border-neutral-600")
      }
    >
      <div className="text-xs text-neutral-100">{title}</div>
      <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">{body}</div>
    </button>
  );
}
