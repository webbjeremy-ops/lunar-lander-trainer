// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Touch / pointer flight controls. Mirrors the keyboard bindings.

export function FlightControls({
  manual,
  throttle,
  engineOn,
  onAttitude,
  onThrottle,
  onEngine,
  onRod,
}: {
  manual: boolean;
  throttle: number;
  engineOn: boolean;
  onAttitude: (v: number) => void;
  onThrottle: (delta: number) => void;
  onEngine: (on: boolean) => void;
  onRod: (steps: number) => void;
}) {
  const btn =
    "select-none rounded border border-neutral-700 bg-neutral-900 px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 disabled:opacity-40";

  return (
    <div
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="flight-controls"
      aria-label="Flight controls"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Flight controls
        </span>
        <span
          data-testid="control-authority"
          className={
            "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest " +
            (manual
              ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
              : "border-neutral-700 bg-neutral-900 text-neutral-500")
          }
        >
          {manual ? "pilot has control" : "guidance has control"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-yaw-left"
          onPointerDown={() => onAttitude(-1)}
          onPointerUp={() => onAttitude(0)}
          onPointerLeave={() => onAttitude(0)}
        >
          ◀ pitch
        </button>
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-throttle-up"
          onPointerDown={() => onThrottle(0.08)}
        >
          ▲ thrust
        </button>
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-yaw-right"
          onPointerDown={() => onAttitude(1)}
          onPointerUp={() => onAttitude(0)}
          onPointerLeave={() => onAttitude(0)}
        >
          pitch ▶
        </button>
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-rod-down"
          onClick={() => onRod(-1)}
        >
          ROD −1 ft/s
        </button>
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-throttle-down"
          onPointerDown={() => onThrottle(-0.08)}
        >
          ▼ thrust
        </button>
        <button
          className={btn}
          disabled={!manual}
          data-testid="ctl-rod-up"
          onClick={() => onRod(1)}
        >
          ROD +1 ft/s
        </button>
      </div>

      <button
        className={`mt-2 w-full ${btn} ${engineOn ? "border-emerald-600 text-emerald-300" : ""}`}
        disabled={!manual}
        data-testid="ctl-engine"
        onClick={() => onEngine(!engineOn)}
      >
        {engineOn ? "DPS on" : "DPS off"} · throttle {(throttle * 100).toFixed(0)}%
      </button>

      <p className="mt-2 text-[10px] leading-snug text-neutral-500">
        Keyboard: ↑/↓ thrust · ←/→ pitch · Space engine · , / . rate-of-descent
        trim. Gamepad: left stick pitch, triggers thrust. The DSKY keypad keeps
        its own bindings (V, N, digits, ENTR, PRO).
      </p>
    </div>
  );
}
