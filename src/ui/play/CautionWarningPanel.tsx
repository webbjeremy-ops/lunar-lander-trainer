// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.13 — LM caution-and-warning lamp array.
//
// A presentation-only reproduction of the LM annunciator style: engraved
// legends on square lamps that light amber (caution) or red (warning). Every
// lamp is driven from game state, not from the AGC.

export interface CautionLamp {
  readonly id: string;
  readonly legend: string;
  readonly on: boolean;
  readonly tone: "warning" | "caution" | "status";
  readonly title: string;
}

export function CautionWarningPanel({ lamps }: { lamps: readonly CautionLamp[] }) {
  return (
    <section
      data-testid="caution-warning"
      aria-label="Caution and warning array"
      className="rounded border border-neutral-700 bg-neutral-800/70 p-2 shadow-inner"
    >
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400">
        Caution / warning
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {lamps.map((lamp) => (
          <div
            key={lamp.id}
            data-testid={`cw-${lamp.id}`}
            data-on={lamp.on ? "1" : "0"}
            title={lamp.title}
            className={`rounded-sm border px-1 py-2 text-center font-mono text-[9px] font-bold uppercase leading-tight tracking-wider ${
              lamp.on ? lampOnClass(lamp.tone) : "border-neutral-700 bg-neutral-900 text-neutral-600"
            }`}
          >
            {lamp.legend}
          </div>
        ))}
      </div>
    </section>
  );
}

function lampOnClass(tone: CautionLamp["tone"]): string {
  switch (tone) {
    case "warning":
      return "border-red-400 bg-red-500/80 text-neutral-950 animate-pulse";
    case "caution":
      return "border-amber-300 bg-amber-400/85 text-neutral-950";
    case "status":
      return "border-emerald-300 bg-emerald-400/80 text-neutral-950";
  }
}
