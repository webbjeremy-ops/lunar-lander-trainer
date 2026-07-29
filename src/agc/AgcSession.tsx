// SPDX-License-Identifier: GPL-3.0-or-later
// Shared, app-wide AGC session provider.
//
// One AgcWorkerClient is owned by this provider and lives for the entire
// browser session. Route components (/learn, /explore, ...) attach to the
// SAME client through the `useAgcSession()` hook — the emulator state,
// mission clock, event log and DSKY latched state persist across route
// changes.
//
// The provider owns the primary listener bag on the client (via
// `client.setListeners`). Route-level consumers that need per-component
// callbacks (Dsky, LessonHost, /explore panels) MUST attach through
// `client.addListener(...)`, which is the supplementary-listener path that
// does not displace the provider.
//
// A `resetSession()` call disposes the current client, bumps the epoch, and
// creates a fresh one. Consumers key their sub-trees on `sessionEpoch` to
// force a clean remount across resets.

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
import { AgcWorkerClient } from "./AgcWorkerClient";
import type { ReadyPayload, StateSnapshot } from "./protocol";
import type { DecodedDsky } from "./dsky/DskyTypes";
import { makeEmptyDecodedDsky } from "./dsky/DskyDecoder";
import { agcWasmUrl, ropeById, type RopeImage } from "@/sim/agc/roms";

export interface AgcSessionValue {
  /** Live client, or `null` while the Worker is being (re)created. */
  client: AgcWorkerClient | null;
  ready: ReadyPayload | null;
  snapshot: StateSnapshot | null;
  decoded: DecodedDsky;
  lamps: number;
  /** Monotonic per-provider session epoch. Bumps on `resetSession()`. */
  sessionEpoch: number;
  rope: RopeImage;
  /** Full teardown + fresh client. Same rope. */
  resetSession: () => void;
  /** True once the provider's mount effect has run at least once. On the
   *  server this stays false; use it to gate SSR-unsafe render paths. */
  bootAttempted: boolean;
  /** Bootstrap error (worker construction failed). Consumers may show a
   *  retry affordance; a `resetSession()` reruns the boot. */
  bootError: string | null;
}

const AgcSessionContext = createContext<AgcSessionValue | null>(null);

export function AgcSessionProvider({ children }: { children: ReactNode }) {
  const rope = useMemo(() => ropeById("Luminary099"), []);
  const [epoch, setEpoch] = useState(0);
  const [client, setClient] = useState<AgcWorkerClient | null>(null);
  const [ready, setReady] = useState<ReadyPayload | null>(null);
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [decoded, setDecoded] = useState<DecodedDsky>(() => makeEmptyDecodedDsky());
  const [lamps, setLamps] = useState(0);
  const [bootAttempted, setBootAttempted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    disposedRef.current = false;
    setBootAttempted(true);
    setBootError(null);
    setReady(null);
    setSnapshot(null);
    setDecoded(makeEmptyDecodedDsky());
    setLamps(0);

    let c: AgcWorkerClient;
    try {
      c = new AgcWorkerClient();
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
      return;
    }
    c.setListeners({
      onReady: (p) => {
        if (disposedRef.current) return;
        setReady(p);
      },
      onSnapshot: (s) => {
        if (disposedRef.current) return;
        setSnapshot(s);
        setLamps(s.lamps);
        if (s.decodedDsky) setDecoded(s.decodedDsky);
      },
      onDsky: (l) => {
        if (disposedRef.current) return;
        setLamps(l);
      },
      onDskyDecoded: (d) => {
        if (disposedRef.current) return;
        setDecoded(d);
      },
      onFatalError: (code, message) => {
        if (disposedRef.current) return;
        setBootError(`${code}: ${message}`);
      },
    });
    c.initialize(agcWasmUrl());
    c.loadRope(rope.id, rope.url, rope.manifestUrl);
    setClient(c);

    if (typeof window !== "undefined") {
      const w = window as unknown as { __agcSession?: unknown };
      w.__agcSession = { client: c, epoch };
    }

    return () => {
      disposedRef.current = true;
      try { c.dispose(); } catch { /* ignore */ }
      setClient(null);
    };
  }, [epoch, rope.id, rope.url, rope.manifestUrl]);

  const resetSession = useCallback(() => setEpoch((e) => e + 1), []);

  const value = useMemo<AgcSessionValue>(
    () => ({
      client,
      ready,
      snapshot,
      decoded,
      lamps,
      sessionEpoch: epoch,
      rope,
      resetSession,
      bootAttempted,
      bootError,
    }),
    [client, ready, snapshot, decoded, lamps, epoch, rope, resetSession, bootAttempted, bootError],
  );

  return <AgcSessionContext.Provider value={value}>{children}</AgcSessionContext.Provider>;
}

/** Read-only access to the shared AGC session. Throws if used outside the
 *  provider so a misplaced consumer fails loudly instead of silently
 *  spawning its own client. */
export function useAgcSession(): AgcSessionValue {
  const v = useContext(AgcSessionContext);
  if (!v) throw new Error("useAgcSession must be used inside <AgcSessionProvider>");
  return v;
}

/** Non-throwing variant for optional consumers (e.g. tests). */
export function useOptionalAgcSession(): AgcSessionValue | null {
  return useContext(AgcSessionContext);
}
