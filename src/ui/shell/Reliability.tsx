// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Reliability surfaces.
//
//  * `RecoverableError` — the shared, recoverable runtime-error UI used by the
//    root error boundary and by the in-page boundary below. It never dead-ends:
//    the player can retry, go home, or reload.
//  * `RouteErrorBoundary` — a class boundary so a crash inside one panel
//    (cockpit, DSKY, visualiser) does not take down the whole product.
//  * `AgcBootBanner` — explicit AGC Worker boot-failure messaging with a retry
//    that recreates the Worker through the shared session.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAgcSession } from "@/agc/AgcSession";

export function RecoverableError({
  title = "Something went wrong",
  detail,
  onRetry,
  testId = "recoverable-error",
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="mx-auto my-8 max-w-lg rounded border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-100"
    >
      <h2 className="font-mono text-xs uppercase tracking-widest text-amber-300">⚠ {title}</h2>
      <p className="mt-2 text-amber-100/80">
        The rest of Tranquility is still running. Your saved progress and settings are untouched.
      </p>
      {detail && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950/60 p-2 font-mono text-[10px] text-neutral-400">
          {detail}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid={`${testId}-retry`}
            className="rounded border border-amber-500 bg-amber-900/40 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-amber-100 hover:bg-amber-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Try again
          </button>
        )}
        <Link
          to="/"
          className="rounded border border-neutral-600 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

interface BoundaryProps {
  readonly children: ReactNode;
  readonly title?: string;
}
interface BoundaryState {
  readonly error: Error | null;
}

export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Tranquility] recovered from a render error", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <RecoverableError
          title={this.props.title ?? "This panel stopped responding"}
          detail={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          testId="panel-error"
        />
      );
    }
    return this.props.children;
  }
}

export function AgcBootBanner() {
  const { bootError, bootAttempted, resetSession } = useAgcSession();
  if (!bootAttempted || !bootError) return null;
  return (
    <div
      role="alert"
      data-testid="agc-boot-error"
      className="mx-auto my-3 max-w-3xl rounded border border-rose-700 bg-rose-950/30 px-3 py-2 text-xs text-rose-100"
    >
      <strong className="font-mono uppercase tracking-widest text-rose-300">
        ⚠ AGC did not start
      </strong>
      <p className="mt-1 text-rose-100/80">
        The Apollo Guidance Computer runs in a background Web Worker, and this browser refused to
        create it. Flying and the lessons that do not need the DSKY still work. Reason:{" "}
        <span className="font-mono">{bootError}</span>
      </p>
      <button
        type="button"
        onClick={resetSession}
        data-testid="agc-boot-retry"
        className="mt-2 rounded border border-rose-500 bg-rose-900/40 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-rose-100 hover:bg-rose-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
      >
        Restart the AGC
      </button>
    </div>
  );
}
