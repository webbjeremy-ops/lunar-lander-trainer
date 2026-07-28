## No — this error is a real bug, not expected behavior

The DSKY shows `worker: loadRope before initialize`. That comes from `src/agc/AgcWorker.ts:294`, where `loadRope` throws if `state.adapter` is still `null`.

### Root cause (confirmed by reading the code)

`AgcWorkerClient.initialize()` and `AgcWorkerClient.loadRope()` are called back-to-back in `Dsky.tsx`. Both `postMessage` calls arrive at the worker almost simultaneously. The worker's `handle(cmd)` function is `async` and is invoked without any per-command serialization, so:

1. `handle({type:"initialize"})` starts, awaits `AgcCoreAdapter.init(wasmUrl)` (network fetch of the WASM).
2. While that await is pending, the `message` event for `loadRope` fires and `handle({type:"loadRope"})` runs concurrently.
3. `state.adapter` has not been assigned yet (it's assigned only after the `await` on line 281), so `loadRope` throws `"loadRope before initialize"`.

This is timing-dependent — it can appear to work in fast local runs and fail in the preview.

### Fix

Serialize command handling in the worker with a FIFO promise chain so each command fully resolves before the next starts. This is a small, contained change with no protocol impact.

**Change 1 — `src/agc/AgcWorker.ts`**

- Add a module-level `let commandQueue: Promise<void> = Promise.resolve();`
- In the `onmessage` handler, replace the direct `handle(cmd, requestId).catch(...)` call with:
  ```ts
  commandQueue = commandQueue.then(() => handle(cmd, requestId)).catch((err) => {
    send({ type: "error", payload: { requestId, message: String(err?.message ?? err) } });
  });
  ```
  so `loadRope` cannot start until `initialize` has fully resolved (including the `await a.init(...)` and the `state.adapter = a` assignment).
- Keep the existing `if (state.adapter) return;` guard in the `initialize` branch — with serialization it becomes correct instead of racy.

**Change 2 — defensive UX in `src/ui/dsky/Dsky.tsx`**

- The error banner currently says "AGC worker failed to start." even for transient/init-order errors. After the worker fix this specific message will no longer appear, but keep the existing Retry button behavior unchanged — no other UI edits.

### Verification

1. `bunx vitest run` — existing 23 tests must still pass (no test currently covers this race; queue behavior is a pure worker-internal change).
2. Flush HMR (`curl -sf -X POST http://localhost:8080/__hmr_flush`) and reload `/sim`. Confirm:
   - No `loadRope before initialize` banner.
   - `ready` event fires; DSKY leaves the "loading" state.
   - Diagnostics panel shows non-zero mission time within ~1 s.
3. `bunx tsgo --noEmit` — clean.

### Out of scope

- No protocol change, no client-side change to `AgcWorkerClient`, no changes to mission clock, checksum, or licensing.
- The alternative fix — making the client await `ready` before sending `loadRope` — is rejected: worker-side serialization is the correct place because any future command (`reset`, `setTimeScale`, `keyDown`) sent before `ready` would hit the same race.
