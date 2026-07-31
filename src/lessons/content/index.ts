// SPDX-License-Identifier: GPL-3.0-or-later
export { LESSON_01_MEET_THE_AGC } from "./lesson01";
export { LESSON_02_READING_THE_DSKY } from "./lesson02";
export { LESSON_03_V35_LAMP_TEST } from "./lesson03";
export { LESSON_04_V16_N65 } from "./lesson04";
export { LESSON_05_DECODING_CH010 } from "./lesson05";
export { LESSON_06_ANNUNCIATORS } from "./lesson06";
export { LESSON_07_POWERED_DESCENT_TIMELINE } from "./lesson07";
export { LESSON_08_WHY_THE_LM_FALLS } from "./lesson08";
export { LESSON_09_THRUST_TO_WEIGHT } from "./lesson09";
export { LESSON_10_HORIZONTAL_VELOCITY } from "./lesson10";
export { LESSON_11_ROCKET_EQUATION } from "./lesson11";
export { LESSON_12_HIGH_GATE_TO_LOW_GATE } from "./lesson12";
export { LESSON_13_FLY_THE_TERMINAL_DESCENT } from "./lesson13";
export { LESSON_14_PIPA_AND_LANDING_RADAR } from "./lesson14";
export { LESSON_15_ORBIT_IS_FREE_FALL } from "./lesson15";
export { LESSON_16_PREPARE_FOR_LIFTOFF } from "./lesson16";

import type { LessonDefinition } from "../types";
import { LESSON_01_MEET_THE_AGC } from "./lesson01";
import { LESSON_02_READING_THE_DSKY } from "./lesson02";
import { LESSON_03_V35_LAMP_TEST } from "./lesson03";
import { LESSON_04_V16_N65 } from "./lesson04";
import { LESSON_05_DECODING_CH010 } from "./lesson05";
import { LESSON_06_ANNUNCIATORS } from "./lesson06";
import { LESSON_07_POWERED_DESCENT_TIMELINE } from "./lesson07";
import { LESSON_08_WHY_THE_LM_FALLS } from "./lesson08";
import { LESSON_09_THRUST_TO_WEIGHT } from "./lesson09";
import { LESSON_10_HORIZONTAL_VELOCITY } from "./lesson10";
import { LESSON_11_ROCKET_EQUATION } from "./lesson11";
import { LESSON_12_HIGH_GATE_TO_LOW_GATE } from "./lesson12";
import { LESSON_13_FLY_THE_TERMINAL_DESCENT } from "./lesson13";
import { LESSON_14_PIPA_AND_LANDING_RADAR } from "./lesson14";
import { LESSON_15_ORBIT_IS_FREE_FALL } from "./lesson15";
import { LESSON_16_PREPARE_FOR_LIFTOFF } from "./lesson16";

export const ALL_LESSONS: readonly LessonDefinition[] = [
  LESSON_01_MEET_THE_AGC,
  LESSON_02_READING_THE_DSKY,
  LESSON_03_V35_LAMP_TEST,
  LESSON_04_V16_N65,
  LESSON_05_DECODING_CH010,
  LESSON_06_ANNUNCIATORS,
  LESSON_07_POWERED_DESCENT_TIMELINE,
  LESSON_08_WHY_THE_LM_FALLS,
  LESSON_09_THRUST_TO_WEIGHT,
  LESSON_10_HORIZONTAL_VELOCITY,
  LESSON_11_ROCKET_EQUATION,
  LESSON_12_HIGH_GATE_TO_LOW_GATE,
  LESSON_13_FLY_THE_TERMINAL_DESCENT,
  LESSON_14_PIPA_AND_LANDING_RADAR,
  LESSON_15_ORBIT_IS_FREE_FALL,
  LESSON_16_PREPARE_FOR_LIFTOFF,
];

export function lessonById(id: string): LessonDefinition | null {
  return ALL_LESSONS.find((l) => l.id === id) ?? null;
}
