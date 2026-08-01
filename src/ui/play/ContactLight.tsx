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
      <div className="grid grid-cols-2 gap-2">
        {["l", "r"].map((side) => (
          <div
            key={side}
            data-testid={`contact-lamp-${side}`}
            role="status"
            aria-live="polite"
            className={`rounded-sm border px-1 py-2 text-center font-mono text-[9px] font-bold uppercase leading-tight tracking-widest transition-colors ${
              on
                ? "border-sky-200 bg-sky-400 text-neutral-950 shadow-[0_0_14px_2px_rgba(56,189,248,0.65)]"
                : "border-neutral-700 bg-neutral-900 text-neutral-500/70"
            }`}
            title={
              on
                ? "Contact — a 67-inch footpad probe is touching the surface. Engine stop."
                : "Lunar contact: lights blue when a footpad probe touches the surface."
            }
          >
            Lunar
            <br />
            Contact
          </div>
        ))}
      </div>
    </section>
  );
}
