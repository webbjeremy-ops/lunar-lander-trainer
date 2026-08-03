// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Primary product navigation.
//
// Seven promoted destinations. Development harnesses (/dev/*, /capture)
// remain routable but are deliberately not promoted here.

import { Link } from "@tanstack/react-router";
import { UnitsToggle } from "./UnitsToggle";

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly testId: string;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { to: "/", label: "Home", testId: "nav-home" },
  { to: "/missions", label: "Missions", testId: "nav-missions" },
  { to: "/learn", label: "Learn", testId: "nav-learn" },
  { to: "/sim", label: "AGC Lab", testId: "nav-agc-lab" },
  { to: "/explore", label: "Explore", testId: "nav-explore" },
  { to: "/sources", label: "Sources", testId: "nav-sources" },
  { to: "/about", label: "About", testId: "nav-about" },
];

const linkClass =
  "rounded px-1.5 py-1 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

export function AppNav() {
  return (
    <nav
      aria-label="Primary"
      data-testid="app-nav"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-900 bg-neutral-950/80 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500"
    >
      <Link
        to="/"
        className="mr-2 rounded px-1 font-semibold tracking-[0.25em] text-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      >
        Tranquility
      </Link>
      {PRIMARY_NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          data-testid={item.testId}
          className={linkClass}
          activeOptions={{ exact: item.to === "/" }}
          activeProps={{
            className: `${linkClass} text-neutral-100 underline underline-offset-4`,
            "aria-current": "page",
          }}
        >
          {item.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <UnitsToggle />
      </div>
      <Link
        to="/settings"
        data-testid="nav-settings"
        className={linkClass}
        activeProps={{ className: `${linkClass} text-neutral-100`, "aria-current": "page" }}
      >
        Settings
      </Link>
    </nav>
  );
}
