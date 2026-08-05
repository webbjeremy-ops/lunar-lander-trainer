// SPDX-License-Identifier: GPL-3.0-or-later
//
// Plain-language glossary for lesson prose. Pure presentation: the first
// occurrence of a known term in a step body is marked with a dotted
// underline and an accessible definition, and every term used in the step
// is repeated in a "Key terms" list below the prose.

import { Fragment, type ReactNode } from "react";

export interface GlossaryEntry {
  /** Canonical label shown in the key-terms list. */
  readonly term: string;
  /** One-sentence, lay-reader definition. */
  readonly definition: string;
  /** Extra spellings/abbreviations that should also be matched. */
  readonly aliases?: readonly string[];
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "periapsis",
    definition:
      "The low point of an orbit — where the spacecraft passes closest to the surface and is moving fastest.",
    aliases: ["perilune", "perigee"],
  },
  {
    term: "apoapsis",
    definition:
      "The high point of an orbit — where the spacecraft is farthest from the surface and moving slowest.",
    aliases: ["apolune", "apogee"],
  },
  {
    term: "delta-v",
    definition:
      "\u201Cchange in velocity\u201D: the total speed change a burn can buy you. It is the currency of spaceflight — every manoeuvre costs some.",
    aliases: ["\u0394v", "delta v"],
  },
  {
    term: "prograde",
    definition: "Pointing (or burning) along the direction of travel, which raises your orbit.",
  },
  {
    term: "retrograde",
    definition: "Pointing (or burning) against the direction of travel, which lowers your orbit.",
  },
  {
    term: "free fall",
    definition:
      "Falling under gravity alone with no engine or air resistance. In orbit you are in free fall permanently — you keep missing the ground.",
  },
  {
    term: "rocket equation",
    definition:
      "Tsiolkovsky's formula linking how much delta-v you get to how much of the vehicle is propellant and how fast the engine throws it.",
  },
  {
    term: "specific impulse",
    definition:
      "A measure of engine efficiency: how much push you get per kilogram of propellant, measured in seconds. Higher is better.",
    aliases: ["Isp"],
  },
  {
    term: "thrust-to-weight",
    definition:
      "Engine thrust divided by the vehicle's weight. Above 1 you can hover or climb; below 1 you can only slow your fall.",
  },
  {
    term: "sink rate",
    definition: "How fast you are descending, in feet or metres per second.",
  },
  {
    term: "high gate",
    definition:
      "The point about 7,000 ft up where the LM pitches upright and the crew can first see the landing site (program P64 begins).",
  },
  {
    term: "low gate",
    definition:
      "About 500 ft up, where the LM is nearly upright and slow — the handover point to the final, mostly vertical descent.",
  },
  {
    term: "throttle",
    definition: "The engine power setting — how hard the descent engine is pushing.",
  },
  {
    term: "attitude",
    definition:
      "Which way the spacecraft is pointing (pitch, roll, yaw) — not its altitude.",
  },
  {
    term: "AGC",
    definition:
      "Apollo Guidance Computer: the 1960s onboard computer that flew the descent. It ran programs identified by two-digit numbers such as P63 and P64.",
  },
  {
    term: "DSKY",
    definition:
      "\u201CDISS-key\u201D — the display-and-keyboard unit: the AGC's only interface, with numeric registers and VERB/NOUN keys.",
  },
  {
    term: "verb",
    definition: "On the DSKY, a two-digit code for the action you want (\u201Cdisplay\u201D, \u201Cload\u201D).",
  },
  {
    term: "noun",
    definition: "On the DSKY, a two-digit code for the data the action applies to (altitude, velocity, time).",
  },
  {
    term: "PIPA",
    definition:
      "Pulsed Integrating Pendulous Accelerometer: the accelerometer that tells the AGC how much velocity the engine has added.",
  },
  {
    term: "IMU",
    definition:
      "Inertial Measurement Unit: the gyroscope platform that keeps track of which way the spacecraft is pointing.",
  },
  {
    term: "REFSMMAT",
    definition:
      "The stored reference orientation the AGC measures all attitudes against — effectively its definition of \u201Cwhich way is up\u201D.",
  },
  {
    term: "erasable",
    definition: "The AGC's small read/write memory, as opposed to the fixed rope memory holding the programs.",
    aliases: ["erasable memory"],
  },
  {
    term: "core rope",
    definition:
      "The AGC's read-only program memory, literally woven from wire through magnetic cores by hand.",
    aliases: ["rope memory"],
  },
  {
    term: "major mode",
    definition: "The AGC program currently running, shown as a two-digit PROG number such as 63 or 64.",
  },
  {
    term: "restart",
    definition: "An AGC reboot that takes about a second and resumes the flight programs where safe.",
  },
  {
    term: "APS",
    definition: "Ascent Propulsion System: the single fixed-thrust engine that lifts the upper stage off the Moon.",
  },
  {
    term: "DPS",
    definition: "Descent Propulsion System: the throttleable engine used for the landing.",
  },
  {
    term: "PDI",
    definition: "Powered Descent Initiation: the moment the descent engine lights to begin the landing.",
  },
];

interface CompiledTerm extends GlossaryEntry {
  readonly pattern: RegExp;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED: readonly CompiledTerm[] = GLOSSARY.map((e) => {
  const forms = [e.term, ...(e.aliases ?? [])]
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const upperOnly = /^[A-Z\u0394]+$/.test(e.term);
  return {
    ...e,
    pattern: new RegExp(`\\b(${forms.join("|")})\\b`, upperOnly ? "" : "i"),
  };
});

/** Terms present in a body of prose, in the order they first appear. */
export function findGlossaryTerms(text: string): GlossaryEntry[] {
  const hits: Array<{ index: number; entry: CompiledTerm }> = [];
  for (const c of COMPILED) {
    const m = c.pattern.exec(text);
    if (m) hits.push({ index: m.index, entry: c });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => ({ term: h.entry.term, definition: h.entry.definition, aliases: h.entry.aliases }));
}

/**
 * Renders prose with the first occurrence of each known term marked up as
 * an <abbr> carrying its definition (native tooltip + screen-reader text).
 */
export function GlossedText({ text, className }: { text: string; className?: string }) {
  const marks: Array<{ start: number; end: number; entry: CompiledTerm }> = [];
  for (const c of COMPILED) {
    const m = c.pattern.exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (marks.some((x) => start < x.end && end > x.start)) continue;
    marks.push({ start, end, entry: c });
  }
  marks.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  marks.forEach((mk, i) => {
    if (mk.start > cursor) nodes.push(<Fragment key={`t${i}`}>{text.slice(cursor, mk.start)}</Fragment>);
    nodes.push(
      <abbr
        key={`m${i}`}
        title={mk.entry.definition}
        data-glossary-term={mk.entry.term}
        className="cursor-help underline decoration-dotted decoration-amber-500/70 underline-offset-4"
      >
        {text.slice(mk.start, mk.end)}
      </abbr>,
    );
    cursor = mk.end;
  });
  if (cursor < text.length) nodes.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);

  return <p className={className}>{nodes}</p>;
}

/** Compact definition list of every glossary term used in the given prose. */
export function KeyTerms({ text }: { text: string }) {
  const terms = findGlossaryTerms(text);
  if (terms.length === 0) return null;
  return (
    <details className="mt-4 rounded border border-amber-900/60 bg-amber-950/10 px-3 py-2" data-testid="lesson-key-terms">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-amber-300/90">
        Key terms ({terms.length})
      </summary>
      <dl className="mt-2 space-y-2 text-xs leading-relaxed">
        {terms.map((t) => (
          <div key={t.term}>
            <dt className="font-mono text-[11px] uppercase tracking-wide text-amber-200">{t.term}</dt>
            <dd className="text-neutral-300">{t.definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
