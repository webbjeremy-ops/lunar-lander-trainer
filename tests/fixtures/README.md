# AGC golden trace fixtures (M2.1)

These JSON files are **captured**, not authored. Regenerate them via:

```
bun run build
bunx wrangler dev -c dist/server/wrangler.json --port 8788 &
bun scripts/capture-v35.ts
bun scripts/capture-v16-n65.ts
```

Both scripts drive the same `/capture` route the app ships with (real Worker,
real `yaAGC.wasm`, pinned Luminary099 rope, pinned decoder). The scripts
NEVER hand-author expected digits or lamp states — every value came from the
emulator.

Each fixture records:
- `metadata.emulator.commit` — pinned webAGC commit
- `metadata.wasmSha256` — SHA-256 of `public/agc/yaAGC.wasm`
- `metadata.rope.sha256` + `sourceCommit` — pinned Luminary099
- `metadata.decoderSchemaVersion` + `metadata.protocolVersion`
- `metadata.appCommit` — supplied via `CAPTURE_APP_COMMIT=...`

If a capture changes because any pinned artifact changes, that is a **real**
divergence — investigate before overwriting the fixture.
