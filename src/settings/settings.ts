// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Versioned local product settings.
//
// PURE CORE: `defaultSettings`, `parseSettings`, `reduceSettings`,
// `serializeSettings` and `migrateSettings` are total, pure functions. The
// only impure surface is `loadSettings` / `saveSettings`, thin localStorage
// adapters.
//
// Failure policy: corrupt, truncated, foreign-schema, wrong-version or
// hostile payloads NEVER throw and NEVER partially apply. Unknown fields are
// dropped; known fields are clamped into range. A rejected payload falls back
// to defaults so the product always boots.

export const SETTINGS_SCHEMA = "agc-tranquility.settings";
export const SETTINGS_VERSION = 2;
export const SETTINGS_STORAGE_KEY = "agc-tranquility:settings:v2";
/** v1 key, read once for a safe forward migration. */
export const SETTINGS_LEGACY_KEY_V1 = "agc-tranquility:settings:v1";

export type UnitSystem = "metric" | "apollo";
export type AssistanceLevelId = "instructor" | "pilot" | "commander";
export type KeyboardMapId = "arrows" | "wasd";
export type TouchSizeId = "small" | "medium" | "large";

export interface AppSettings {
  readonly schema: typeof SETTINGS_SCHEMA;
  readonly version: typeof SETTINGS_VERSION;
  /** 0…1 master gain applied to every synthesized sound. */
  readonly masterVolume: number;
  /** Sound effects on/off (master volume still gates level). */
  readonly soundEffects: boolean;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly units: UnitSystem;
  /** 0.25…3 multiplier on attitude/throttle control input. */
  readonly controlSensitivity: number;
  readonly keyboardMap: KeyboardMapId;
  readonly touchControlSize: TouchSizeId;
  readonly defaultAssistance: AssistanceLevelId;
}

export type SettingsEvent =
  | { readonly kind: "set"; readonly patch: Partial<MutableSettings> }
  | { readonly kind: "reset" };

type MutableSettings = Omit<AppSettings, "schema" | "version">;

export function defaultSettings(): AppSettings {
  return {
    schema: SETTINGS_SCHEMA,
    version: SETTINGS_VERSION,
    masterVolume: 0.6,
    soundEffects: true,
    reducedMotion: false,
    highContrast: false,
    units: "metric",
    controlSensitivity: 1,
    keyboardMap: "arrows",
    touchControlSize: "medium",
    defaultAssistance: "instructor",
  };
}

const UNIT_SYSTEMS: readonly UnitSystem[] = ["metric", "apollo"];
const ASSISTANCE: readonly AssistanceLevelId[] = ["instructor", "pilot", "commander"];
const KEYBOARD_MAPS: readonly KeyboardMapId[] = ["arrows", "wasd"];
const TOUCH_SIZES: readonly TouchSizeId[] = ["small", "medium", "large"];

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Normalize any record-ish input into a valid, in-range settings object. */
export function coerceSettings(raw: unknown, base: AppSettings = defaultSettings()): AppSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    schema: SETTINGS_SCHEMA,
    version: SETTINGS_VERSION,
    masterVolume:
      typeof r["masterVolume"] === "number" ? clamp(r["masterVolume"], 0, 1) : base.masterVolume,
    soundEffects: bool(r["soundEffects"], base.soundEffects),
    reducedMotion: bool(r["reducedMotion"], base.reducedMotion),
    highContrast: bool(r["highContrast"], base.highContrast),
    units: pick(r["units"], UNIT_SYSTEMS, base.units),
    controlSensitivity:
      typeof r["controlSensitivity"] === "number"
        ? clamp(r["controlSensitivity"], SENSITIVITY_MIN, SENSITIVITY_MAX)
        : base.controlSensitivity,
    keyboardMap: pick(r["keyboardMap"], KEYBOARD_MAPS, base.keyboardMap),
    touchControlSize: pick(r["touchControlSize"], TOUCH_SIZES, base.touchControlSize),
    defaultAssistance: pick(r["defaultAssistance"], ASSISTANCE, base.defaultAssistance),
  };
}

export function reduceSettings(state: AppSettings, event: SettingsEvent): AppSettings {
  switch (event.kind) {
    case "reset":
      return defaultSettings();
    case "set": {
      const next = coerceSettings({ ...state, ...event.patch }, state);
      return shallowEqual(state, next) ? state : next;
    }
    default:
      return state;
  }
}

function shallowEqual(a: AppSettings, b: AppSettings): boolean {
  const keys = Object.keys(a) as (keyof AppSettings)[];
  return keys.every((k) => a[k] === b[k]);
}

/** Deterministic serialization: sorted keys, so equal state ⇒ equal text. */
export function serializeSettings(settings: AppSettings): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(settings).sort()) {
    sorted[key] = (settings as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted, null, 2);
}

export type ParseSettingsResult =
  | { readonly ok: true; readonly settings: AppSettings; readonly migrated: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Safe forward migration. v1 payloads (which lacked `keyboardMap` and
 * `touchControlSize`) are accepted and completed with defaults. Anything
 * newer than the current version is rejected rather than mangled.
 */
export function migrateSettings(raw: unknown): ParseSettingsResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "payload is not an object" };
  }
  const r = raw as Record<string, unknown>;
  if (r["schema"] !== SETTINGS_SCHEMA) {
    return { ok: false, reason: "unrecognised schema" };
  }
  const version = r["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: "missing or invalid version" };
  }
  if (version > SETTINGS_VERSION) {
    return { ok: false, reason: "payload is from a newer version of Tranquility" };
  }
  return { ok: true, settings: coerceSettings(r), migrated: version !== SETTINGS_VERSION };
}

export function parseSettings(text: string): ParseSettingsResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  return migrateSettings(raw);
}

// ---- impure adapters -------------------------------------------------

export function loadSettings(): AppSettings {
  if (typeof localStorage === "undefined") return defaultSettings();
  for (const key of [SETTINGS_STORAGE_KEY, SETTINGS_LEGACY_KEY_V1]) {
    let text: string | null = null;
    try {
      text = localStorage.getItem(key);
    } catch {
      return defaultSettings();
    }
    if (!text) continue;
    const parsed = parseSettings(text);
    if (parsed.ok) {
      if (parsed.migrated || key !== SETTINGS_STORAGE_KEY) saveSettings(parsed.settings);
      return parsed.settings;
    }
  }
  return defaultSettings();
}

export function saveSettings(settings: AppSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
  } catch {
    /* quota or private mode — settings stay in memory for this session. */
  }
}
