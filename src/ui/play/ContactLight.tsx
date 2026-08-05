// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.24 — the pair of blue LUNAR CONTACT lamps from the LM main panel.
// Presentation only: the lit state is passed in from game state.

export function ContactLight({ on }: { on: boolean }) {
  return (
    <section
      data-testid="contact-light"
      data-on={on ? "1" : "0"}
      aria-label="Lunar contact lights"
      className="rounded border border-neutral-800 bg-neutral-950 p-2 shadow-inner"
    >
      <div className="grid grid-cols-2 gap-3">
        {["l", "r"].map((side) => (
          <div
            key={side}
            data-testid={`contact-lamp-${side}`}
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-1"
            title={
              on
                ? "Contact — a 67-inch footpad probe is touching the surface. Engine stop."
                : "Lunar contact: lights blue when a footpad probe touches the surface."
            }
          >
            {/* Bezel ring around a domed bulb, as on the LM main panel. */}
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 shadow-inner">
              <span
                className={`h-7 w-7 rounded-full transition-all ${
                  on
                    ? "bg-[radial-gradient(circle_at_35%_30%,#e0f2fe,#38bdf8_45%,#0284c7_85%)] shadow-[0_0_16px_4px_rgba(56,189,248,0.7)]"
                    : "bg-[radial-gradient(circle_at_35%_30%,#1f2937,#0b1220_80%)]"
                }`}
              />
            </span>
            <span
              className={`text-center font-mono text-[8px] font-bold uppercase leading-tight tracking-widest ${
                on ? "text-sky-200" : "text-neutral-500/70"
              }`}
            >
              Lunar
              <br />
              Contact
            </span>
          </div>
        ))}
      </div>

    </section>
  );
}
