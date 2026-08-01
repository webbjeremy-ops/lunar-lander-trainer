// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Settings provider.
//
// Owns the versioned settings record, mirrors accessibility choices onto the
// document element (so CSS can respond globally), and exposes a `playCue`
// helper already bound to the current volume/SFX preferences.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultSettings,
  loadSettings,
  parseSettings,
  reduceSettings,
  saveSettings,
  serializeSettings,
  type AppSettings,
} from "./settings";
import { playCue as playCueRaw, setMasterVolume, type SoundCue } from "./audio";

export interface SettingsApi {
  readonly settings: AppSettings;
  /** False until the client-side load effect has run (SSR-safe defaults). */
  readonly loaded: boolean;
  set(patch: Partial<Omit<AppSettings, "schema" | "version">>): void;
  reset(): void;
  exportJson(): string;
  /** Returns null on success, or a human-readable failure reason. */
  importJson(raw: string): string | null;
  playCue(cue: SoundCue): void;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const stored = loadSettings();
    // Respect the OS preference on a first run that has never been saved.
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSettings(prefersReduced ? { ...stored, reducedMotion: true } : stored);
    setLoaded(true);
  }, []);

  // Mirror accessibility settings onto <html> so global CSS can react.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("reduced-motion", settings.reducedMotion);
    root.classList.toggle("high-contrast", settings.highContrast);
    root.dataset["units"] = settings.units;
    root.dataset["touchSize"] = settings.touchControlSize;
    setMasterVolume(settings.soundEffects ? settings.masterVolume : 0);
  }, [settings]);

  const set = useCallback((patch: Partial<Omit<AppSettings, "schema" | "version">>) => {
    setSettings((prev) => {
      const next = reduceSettings(prev, { kind: "set", patch });
      if (next !== prev) saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = defaultSettings();
    saveSettings(next);
    setSettings(next);
  }, []);

  const exportJson = useCallback(() => serializeSettings(settings), [settings]);

  const importJson = useCallback((raw: string): string | null => {
    const parsed = parseSettings(raw);
    if (!parsed.ok) return `Import rejected: ${parsed.reason}.`;
    saveSettings(parsed.settings);
    setSettings(parsed.settings);
    return null;
  }, []);

  const playCue = useCallback(
    (cue: SoundCue) => {
      playCueRaw(cue, { enabled: settings.soundEffects, volume: settings.masterVolume });
    },
    [settings.soundEffects, settings.masterVolume],
  );

  const value = useMemo<SettingsApi>(
    () => ({ settings, loaded, set, reset, exportJson, importJson, playCue }),
    [settings, loaded, set, reset, exportJson, importJson, playCue],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings() must be used inside <SettingsProvider>");
  }
  return ctx;
}

/** Convenience: the settings record alone. */
export function useAppSettings(): AppSettings {
  return useSettings().settings;
}
