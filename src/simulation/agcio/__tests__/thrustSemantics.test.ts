// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3B2 — regression lock on the corrected CHAN14 / THRUST interpretation.
//
// CHAN14 bit 13 gates an incremental LGC throttle COMMAND train that the
// DECA analog-sums with the TTCA manual command (LMA790-3-LM §2.1.3.1). It
// is NOT a thrust, not a force and not a percentage. These tests exist so a
// future refactor cannot quietly relabel it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("CHAN14 / THRUST semantics are not relabelled as thrust", () => {
  const panel = read("src/ui/dev/MonitorPanel.tsx");

  it("panel states the DECA summing-junction interpretation verbatim", () => {
    expect(panel).toContain(
      "LGC THROTTLE COMMAND DELTA INTO DECA SUMMING JUNCTION",
    );
    expect(panel).toContain("PHYSICAL FORCE SCALE NOT RESOLVED");
  });

  it("panel never renders a resolved throttle magnitude", () => {
    expect(panel).toContain("PHYSICAL THROTTLE SCALE NOT YET RESOLVED");
    // No unit strings may appear anywhere in the monitor panel.
    for (const unit of ["lbf", "pounds-force", "newtons", "Newtons", "% throttle"]) {
      expect(panel).not.toContain(unit);
    }
  });

  it("actuator registry keeps the throttle magnitude unresolved", () => {
    const registry = read("src/simulation/agcio/actuatorRegistry.ts");
    expect(registry).toMatch(/unresolved/i);
    expect(registry).not.toMatch(/2\.7\s*(lb|pound)/i);
  });

  it("decoded control never yields a numeric throttleFraction", async () => {
    const mod = await import("../actuatorDecoder");
    const src = read("src/simulation/agcio/actuatorDecoder.ts");
    expect(typeof mod).toBe("object");
    // The only permitted value for throttleFraction is null.
    expect(src).toMatch(/throttleFraction:\s*null/);
    expect(src).not.toMatch(/throttleFraction:\s*[0-9]/);
  });
});
