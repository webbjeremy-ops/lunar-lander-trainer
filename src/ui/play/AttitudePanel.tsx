// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.8 — Windows-up roll control and program-alarm annunciator.
//
// MODELLING NOTE
// --------------
// The flight kernel is planar (2D) and has no roll axis. Eagle's windows-down
// -> windows-up roll is therefore modelled as a cockpit ORIENTATION state, not
// as a physical torque: it gates landing-radar availability and the radar DSKY
// steps exactly as it did in flight, without touching the physics firewall.

import {
  describeRoll,
  radarAvailable,
  rollProgress,
  ROLL_CITATION,
  ROLL_RATE_DEG_PER_SEC,
  ALARM_CITATION,
  type DescentRollState,
  type ProgramAlarmState,
} from "@/game/play";

export function AttitudePanel({
  roll,
  alarms,
  onRoll,
}: {
  roll: DescentRollState;
  alarms: ProgramAlarmState;
  onRoll: (active: boolean) => void;
}) {
  const up = radarAvailable(roll);
  const progress = rollProgress(roll);
  const active = alarms.active;

  return (
    <section
      data-testid="attitude-panel"
      className="rounded-lg border border-border bg-card p-3"
      aria-label="Attitude and caution panel"
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Attitude · roll
        </h2>
        <span
          data-testid="roll-phase"
          data-phase={roll.phase}
          className={`font-mono text-[10px] uppercase tracking-widest ${
            up ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          {up ? "Windows up" : roll.phase === "rolling" ? "Rolling" : "Windows down"}
        </span>
      </header>

      <div className="flex items-center gap-3">
        <RollDial rollDeg={roll.rollDeg} />
        <div className="min-w-0 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className={`h-full transition-[width] duration-100 ${
                up ? "bg-emerald-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p
            data-testid="roll-readout"
            className="mt-1 font-mono text-sm tabular-nums text-foreground"
          >
            {roll.rollDeg.toFixed(0)}°
            <span className="ml-2 text-[10px] text-muted-foreground">
              {ROLL_RATE_DEG_PER_SEC}°/s
            </span>
          </p>
        </div>
      </div>

      <button
        type="button"
        data-testid="roll-control"
        disabled={up}
        onPointerDown={() => onRoll(true)}
        onPointerUp={() => onRoll(false)}
        onPointerLeave={() => onRoll(false)}
        onPointerCancel={() => onRoll(false)}
        className="mt-2 w-full rounded border border-border bg-secondary px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {up ? "Windows up — radar has the surface" : "Hold to roll windows-up (R)"}
      </button>

      <p data-testid="roll-message" className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {roll.lastMessage} {describeRoll(roll)}
      </p>

      <div className="mt-3 border-t border-border pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Program alarm
          </span>
          <span
            data-testid="prog-lamp"
            data-on={alarms.lampOn ? "1" : "0"}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
              alarms.lampOn
                ? "border-red-500 bg-red-500/20 text-red-300 animate-pulse"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            PROG {active ? active.code : "—"}
          </span>
        </div>
        <p data-testid="alarm-message" className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {alarms.lastMessage}
        </p>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Sources
        </summary>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          <strong>{ROLL_CITATION.label}</strong> — {ROLL_CITATION.detail}
        </p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          <strong>{ALARM_CITATION.label}</strong> — {ALARM_CITATION.detail}
        </p>
      </details>
    </section>
  );
}

function RollDial({ rollDeg }: { rollDeg: number }) {
  // 0° draws the LM upright (windows up); 180° draws it inverted.
  return (
    <svg
      viewBox="0 0 48 48"
      width={48}
      height={48}
      role="img"
      aria-label={`Vehicle roll ${rollDeg.toFixed(0)} degrees`}
      className="shrink-0"
    >
      <circle cx="24" cy="24" r="21" className="fill-muted stroke-border" strokeWidth="1.5" />
      <g transform={`rotate(${rollDeg} 24 24)`}>
        <path d="M24 9 L31 22 L17 22 Z" className="fill-foreground" />
        <rect x="16" y="22" width="16" height="11" rx="2" className="fill-foreground/70" />
        <line x1="24" y1="33" x2="24" y2="39" className="stroke-foreground" strokeWidth="2" />
      </g>
    </svg>
  );
}
