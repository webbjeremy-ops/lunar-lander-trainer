// SPDX-License-Identifier: GPL-3.0-or-later
//
// Named scenarios for the MissionRuntime dev harness and acceptance tests.
// The GOLDEN scenario reuses the M3.1 golden LM state + commands so a
// scenario driven through the runtime produces the same terminal touchdown
// as calling `runLmScenario` directly on the pure kernel.

import {
  GOLDEN_COMMANDS,
  GOLDEN_INITIAL_STATE,
} from "@/simulation/lm/__tests__/goldenScenario";
import type { LmScenarioDefinition } from "./types";

export const GOLDEN_MISSION_SCENARIO: LmScenarioDefinition = {
  id: "m3.2-golden-vertical-descent-v1",
  initialLmState: GOLDEN_INITIAL_STATE,
  timedCommands: GOLDEN_COMMANDS,
};
