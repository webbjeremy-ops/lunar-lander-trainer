// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Control scheme selection.
//
// The cockpit can be flown two ways on a desktop-class device: keyboard and
// mouse, or an Xbox pad. Phones and tablets get the touch layout and are not
// offered a choice, because neither of the other schemes exists there.

export type ControlSchemeId = "desktop" | "xbox" | "touch";

export const CONTROL_SCHEME_IDS = ["desktop", "xbox"] as const;

export const CONTROL_SCHEME_COPY: Record<
  ControlSchemeId,
  { title: string; body: string }
> = {
  desktop: {
    title: "Keyboard + mouse",
    body: "Arrow keys fly, V toggles the window, on-screen controls for everything else.",
  },
  xbox: {
    title: "Xbox controller",
    body: "Sticks, triggers and face buttons. The legend follows each stage of the descent.",
  },
  touch: {
    title: "Touch",
    body: "On-screen controls, sized for a phone or tablet in landscape.",
  },
};

/** Coarse pointer / small screen: the desktop scheme does not apply. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse && window.innerWidth < 1024;
}

export function detectDefaultScheme(): ControlSchemeId {
  if (isMobileDevice()) return "touch";
  return "desktop";
}

// The physics loop polls the pad outside React, so the active scheme is kept
// in a module cell rather than threaded through every hook signature.
let active: ControlSchemeId = "desktop";

export function setActiveControlScheme(scheme: ControlSchemeId): void {
  active = scheme;
  if (typeof document !== "undefined") {
    document.body.dataset["controlScheme"] = scheme;
  }
}

export function activeControlScheme(): ControlSchemeId {
  return active;
}
