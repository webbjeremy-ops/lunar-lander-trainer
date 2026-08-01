// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Product accuracy legend.
//
// Every number, diagram and behaviour in Tranquility carries one of these
// five classifications. The legend is shown on Home, About and Sources so the
// player always knows what they are looking at.

export interface AccuracyTier {
  readonly id: string;
  readonly label: string;
  readonly dotClass: string;
  readonly textClass: string;
  /** A non-colour marker so the tier is readable without colour vision. */
  readonly glyph: string;
  readonly description: string;
}

export const ACCURACY_TIERS: readonly AccuracyTier[] = [
  {
    id: "authentic-agc",
    label: "Authentic AGC",
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-300",
    glyph: "◆",
    description:
      "The unmodified Luminary 099 rope executing on a yaAGC WebAssembly core. Every DSKY lamp and digit comes from a real I/O channel word.",
  },
  {
    id: "source-derived",
    label: "Source-derived",
    dotClass: "bg-sky-400",
    textClass: "text-sky-300",
    glyph: "▲",
    description:
      "Values read directly out of the Apollo source listings or NASA primary documents — scale factors, pad loads, engine ratings.",
  },
  {
    id: "historically-grounded",
    label: "Historically grounded",
    dotClass: "bg-amber-400",
    textClass: "text-amber-300",
    glyph: "■",
    description:
      "Anchored to documented Apollo landmarks (high gate, low gate, insertion orbit) but reconstructed by us rather than reproduced.",
  },
  {
    id: "educational-approximation",
    label: "Educational approximation",
    dotClass: "bg-violet-400",
    textClass: "text-violet-300",
    glyph: "●",
    description:
      "Simplified on purpose so the physics is visible: planar motion, simplified attitude response, illustrative diagrams.",
  },
  {
    id: "gameplay-tuned",
    label: "Gameplay tuned",
    dotClass: "bg-rose-400",
    textClass: "text-rose-300",
    glyph: "★",
    description:
      "Chosen to make the game teachable and fair: scoring weights, assistance limits, sandbox propellant allowances.",
  },
];

export function AccuracyLegend({ compact = false }: { compact?: boolean }) {
  return (
    <section
      data-testid="accuracy-legend"
      aria-labelledby="accuracy-legend-heading"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <h2
        id="accuracy-legend-heading"
        className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-400"
      >
        Accuracy legend
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        Nothing here is presented as more authentic than it is.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ACCURACY_TIERS.map((tier) => (
          <li
            key={tier.id}
            data-testid={`accuracy-tier-${tier.id}`}
            className="rounded border border-neutral-800 bg-neutral-900/60 p-2"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tier.dotClass}`} />
              <span aria-hidden="true" className={`font-mono text-[10px] ${tier.textClass}`}>
                {tier.glyph}
              </span>
              <span className={`font-mono text-[11px] uppercase tracking-widest ${tier.textClass}`}>
                {tier.label}
              </span>
            </div>
            {!compact && (
              <p className="mt-1 text-[11px] leading-snug text-neutral-400">{tier.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
