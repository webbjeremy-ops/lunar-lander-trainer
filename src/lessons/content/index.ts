// SPDX-License-Identifier: GPL-3.0-or-later
export { LESSON_01_MEET_THE_AGC } from "./lesson01";
export { LESSON_02_READING_THE_DSKY } from "./lesson02";
export { LESSON_03_V35_LAMP_TEST } from "./lesson03";
export { LESSON_04_V16_N65 } from "./lesson04";

import type { LessonDefinition } from "../types";
import { LESSON_01_MEET_THE_AGC } from "./lesson01";
import { LESSON_02_READING_THE_DSKY } from "./lesson02";
import { LESSON_03_V35_LAMP_TEST } from "./lesson03";
import { LESSON_04_V16_N65 } from "./lesson04";

export const ALL_LESSONS: readonly LessonDefinition[] = [
  LESSON_01_MEET_THE_AGC,
  LESSON_02_READING_THE_DSKY,
  LESSON_03_V35_LAMP_TEST,
  LESSON_04_V16_N65,
];
