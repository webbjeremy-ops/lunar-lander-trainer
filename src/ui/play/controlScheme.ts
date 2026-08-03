// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Control scheme selection.
//
// The cockpit can be flown three ways on a desktop-class device: keyboard and
// mouse, an Xbox pad, or a Meta Quest 3 headset (WebXR browser, Touch Plus
// controllers). Phones and tablets get the touch layout and are not offered a
// choice, because neither of the other two schemes exists there.

export type ControlSchemeId = "desktop" | "xbox" | "vr" | "touch";

export const CONTROL_SCHEME_IDS = ["desktop", "xbox", "vr"] as const;

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
  vr: {
    title: "Meta Quest 3 (VR)",
    body: "Touch Plus controllers, enlarged single-column cockpit sized for the headset browser.",
  },
  touch: {
    title: "Touch",
    body: "On-screen controls, sized for a phone or tablet in landscape.",
  },
};

/** Coarse pointer / small screen: the desktop and VR schemes do not apply. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (isQuestBrowser()) return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse && window.innerWidth < 1024;
}

/** The Quest browser reports OculusBrowser/ (Quest 2, 3, Pro). */
export function isQuestBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /OculusBrowser|Quest/i.test(navigator.userAgent);
}

/** True when the page can actually enter an immersive VR session. */
export async function immersiveVrAvailable(): Promise<boolean> {
  const xr = (navigator as unknown as { xr?: { isSessionSupported(mode: string): Promise<boolean> } })
    .xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

export function detectDefaultScheme(): ControlSchemeId {
  if (isQuestBrowser()) return "vr";
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
