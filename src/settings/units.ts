// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Unit presentation.
//
// The simulation is SI internally and always will be: these helpers are a
// PRESENTATION layer only. "Apollo-style" mirrors the units the crew actually
// read on the DSKY and the flight documents — feet, feet per second, nautical
// miles, pounds — and is an educational convenience, not a change of model.

import type { UnitSystem } from "./settings";

export const M_PER_FT = 0.3048;
export const M_PER_NMI = 1852;
export const KG_PER_LB = 0.45359237;

function round(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/** Altitude / distance. Switches to nmi (Apollo) or km (metric) when large. */
export function formatDistance(metres: number, units: UnitSystem, digits = 0): string {
  if (!Number.isFinite(metres)) return "—";
  if (units === "apollo") {
    const ft = metres / M_PER_FT;
    if (Math.abs(ft) >= 60_000) return `${round(metres / M_PER_NMI, 1)} nmi`;
    return `${round(ft, digits)} ft`;
  }
  if (Math.abs(metres) >= 10_000) return `${round(metres / 1000, 1)} km`;
  return `${round(metres, digits)} m`;
}

/** Speed. */
export function formatSpeed(mps: number, units: UnitSystem, digits = 1): string {
  if (!Number.isFinite(mps)) return "—";
  return units === "apollo"
    ? `${round(mps / M_PER_FT, digits)} fps`
    : `${round(mps, digits)} m/s`;
}

/** Mass. */
export function formatMass(kg: number, units: UnitSystem, digits = 0): string {
  if (!Number.isFinite(kg)) return "—";
  return units === "apollo"
    ? `${round(kg / KG_PER_LB, digits)} lb`
    : `${round(kg, digits)} kg`;
}

/** Short unit label for a bare numeric readout. */
export function speedUnitLabel(units: UnitSystem): string {
  return units === "apollo" ? "fps" : "m/s";
}

export function distanceUnitLabel(units: UnitSystem): string {
  return units === "apollo" ? "ft" : "m";
}

export function massUnitLabel(units: UnitSystem): string {
  return units === "apollo" ? "lb" : "kg";
}

/** Raw numeric conversion, for feeding a formatter that owns its own layout. */
export function toDisplaySpeed(mps: number, units: UnitSystem): number {
  return units === "apollo" ? mps / M_PER_FT : mps;
}

export function toDisplayDistance(metres: number, units: UnitSystem): number {
  return units === "apollo" ? metres / M_PER_FT : metres;
}

export function toDisplayMass(kg: number, units: UnitSystem): number {
  return units === "apollo" ? kg / KG_PER_LB : kg;
}

/** Mission elapsed time as HH:MM:SS, unit-system independent. */
export function formatMet(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
