// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Product footer.
//
// Licensing, the NASA disclaimer, and the development harnesses. The
// harnesses stay reachable (and client-side routable, so the shared AGC
// session is preserved) but they are not part of the primary navigation.

import { Link } from "@tanstack/react-router";

const dev = [
  { to: "/dev/mission-runtime", label: "Mission runtime", testId: "nav-mission-runtime" },
  { to: "/dev/lm-physics", label: "LM physics", testId: "nav-lm-physics" },
];

const linkClass =
  "rounded px-1 hover:text-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

export function AppFooter() {
  return (
    <footer
      data-testid="app-footer"
      className="border-t border-neutral-900 bg-neutral-950/80 px-4 py-4 text-[11px] leading-relaxed text-neutral-500"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <p>
          Tranquility is an independent, open-source educational project. Not sponsored, approved
          or endorsed by NASA, MIT, or the Virtual AGC project. Application code is
          GPL-3.0-or-later; the yaAGC / webAGC core remains GPL-2.0-or-later. Rope images are
          NASA-authored public domain.
        </p>
        <nav aria-label="Developer harnesses" className="flex flex-wrap gap-3">
          <span className="font-mono uppercase tracking-widest text-neutral-600">
            Developer harnesses
          </span>
          {dev.map((d) => (
            <Link key={d.to} to={d.to} data-testid={d.testId} className={linkClass}>
              {d.label}
            </Link>
          ))}
          <Link to="/sources" className={linkClass}>
            Sources &amp; methodology
          </Link>
          <Link to="/about" className={linkClass}>
            About &amp; credits
          </Link>
        </nav>
      </div>
    </footer>
  );
}
