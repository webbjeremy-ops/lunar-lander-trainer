// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.47 — Gamepad UI navigation outside the cockpit.
//
// On every page except a live descent/ascent run, the D-pad and left stick
// move focus between interactive elements and A / X activate the focused one.
// Once gameplay starts, `play` claims the pad by setting
// `document.body.dataset.gamepadOwner = "gameplay"` and this hook stands down
// so the flight controls have it to themselves.

import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Axis / D-pad repeat rate while a direction is held, ms. */
const REPEAT_MS = 180;
const AXIS_DEADZONE = 0.55;

function visibleTargets(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE));
  return all.filter((el) => {
    if (el.hasAttribute("aria-hidden")) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function move(delta: number): void {
  const targets = visibleTargets();
  if (targets.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const index = active ? targets.indexOf(active) : -1;
  const next =
    index === -1
      ? delta > 0
        ? 0
        : targets.length - 1
      : (index + delta + targets.length) % targets.length;
  const el = targets[next];
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function activate(): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) {
    const first = visibleTargets()[0];
    first?.focus({ preventScroll: true });
    return;
  }
  active.click();
}

export function useGamepadUiNavigation(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;

    let frame = 0;
    let nextMoveAt = 0;
    let selectHeld = false;

    const poll = () => {
      frame = window.requestAnimationFrame(poll);
      // Gameplay owns the pad while a run is live.
      if (document.body.dataset["gamepadOwner"] === "gameplay") {
        nextMoveAt = 0;
        selectHeld = false;
        return;
      }

      const pads = navigator.getGamepads();
      let dir = 0;
      let select = false;
      for (const pad of pads) {
        if (!pad?.connected) continue;
        const b = pad.buttons;
        const up = b[12]?.pressed ?? false;
        const down = b[13]?.pressed ?? false;
        const left = b[14]?.pressed ?? false;
        const right = b[15]?.pressed ?? false;
        const y = pad.axes[1] ?? 0;
        const x = pad.axes[0] ?? 0;
        if (down || right || y > AXIS_DEADZONE || x > AXIS_DEADZONE) dir = 1;
        else if (up || left || y < -AXIS_DEADZONE || x < -AXIS_DEADZONE) dir = -1;
        // A (0) and X (2) both select.
        if ((b[0]?.pressed ?? false) || (b[2]?.pressed ?? false)) select = true;
      }

      const now = performance.now();
      if (dir === 0) {
        nextMoveAt = 0;
      } else if (now >= nextMoveAt) {
        // First press moves immediately, then repeats while held.
        nextMoveAt = now + (nextMoveAt === 0 ? REPEAT_MS * 2.5 : REPEAT_MS);
        move(dir);
      }

      if (select && !selectHeld) activate();
      selectHeld = select;
    };

    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, []);
}
