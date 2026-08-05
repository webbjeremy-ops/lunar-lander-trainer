// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Touch / pointer flight controls. Mirrors the keyboard bindings.
//
// Mobile notes: every control is driven from pointer events with
// `touch-action: none` and explicit pointer capture, so a finger that drifts
// while held keeps commanding the axis instead of being stolen by the page
// scroller. Thrust and ROD trim auto-repeat while held, matching the way the
// keyboard bindings repeat.

import { useCallback, useEffect, useRef } from "react";

/** Press-and-hold auto-repeat: fires immediately, then every `everyMs`. */
function useHoldRepeat() {
  const timers = useRef<{ delay?: number; interval?: number }>({});

  const stop = useCallback(() => {
    if (timers.current.delay) window.clearTimeout(timers.current.delay);
    if (timers.current.interval) window.clearInterval(timers.current.interval);
    timers.current = {};
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (fn: () => void, firstDelayMs = 260, everyMs = 90) => {
      stop();
      fn();
      timers.current.delay = window.setTimeout(() => {
        timers.current.interval = window.setInterval(fn, everyMs);
      }, firstDelayMs);
    },
    [stop],
  );

  return { start, stop };
}

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
    "touch-none select-none rounded border border-neutral-700 bg-neutral-900 px-3 py-4 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 active:border-emerald-500 active:bg-neutral-800 disabled:opacity-40";

  const hold = useHoldRepeat();

  /** Latching axis control: hold to command, release (anywhere) to centre. */
  const axisProps = (value: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onAttitude(value);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      onAttitude(0);
    },
    onPointerCancel: () => onAttitude(0),
    onLostPointerCapture: () => onAttitude(0),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  /** Repeating control: hold to keep stepping the value. */
  const repeatProps = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      hold.start(fn);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      hold.stop();
    },
    onPointerCancel: () => hold.stop(),
    onLostPointerCapture: () => hold.stop(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

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
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-yaw-left"
          {...axisProps(-1)}
        >
          ◀ pitch
        </button>
        <button
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-throttle-up"
          {...repeatProps(() => onThrottle(0.08))}
        >
          ▲ thrust
        </button>
        <button
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-yaw-right"
          {...axisProps(1)}
        >
          pitch ▶
        </button>
        <button
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-rod-down"
          {...repeatProps(() => onRod(-1))}
        >
          ROD −1 ft/s
        </button>
        <button
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-throttle-down"
          {...repeatProps(() => onThrottle(-0.08))}
        >
          ▼ thrust
        </button>
        <button
          type="button"
          className={btn}
          disabled={!manual}
          data-testid="ctl-rod-up"
          {...repeatProps(() => onRod(1))}
        >
          ROD +1 ft/s
        </button>
      </div>

      <button
        type="button"
        className={`mt-2 w-full ${btn} ${engineOn ? "border-emerald-600 text-emerald-300" : ""}`}
        disabled={!manual}
        data-testid="ctl-engine"
        onClick={() => onEngine(!engineOn)}
      >
        {engineOn ? "DPS on" : "DPS off"} · throttle {(throttle * 100).toFixed(0)}%
      </button>

      <p className="mt-2 text-[10px] leading-snug text-neutral-500">
        Touch: hold ▲/▼ to run the throttle, hold ◀/▶ to command pitch. Keyboard:
        ↑/↓ throttle · ←/→ pitch · Space engine on/off · , / . rate-of-descent
        trim · F window view · D pop out the DSKY.
        Gamepad: left stick pitch, triggers thrust. The DSKY keypad keeps its own
        bindings (V, N, digits, ENTR, PRO).
      </p>
    </div>
  );
}
