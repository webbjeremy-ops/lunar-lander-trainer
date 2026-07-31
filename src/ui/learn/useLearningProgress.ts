// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — React binding for the pure learning-progress store.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyProgress,
  loadProgress,
  parseProgress,
  reduceProgress,
  saveProgress,
  serializeProgress,
  type LearningProgress,
  type ProgressEvent,
} from "@/learning/progress";
import { unlockedMissionsFor } from "@/learning/tracks";

export interface LearningProgressApi {
  readonly progress: LearningProgress;
  readonly loaded: boolean;
  dispatch(event: ProgressEvent): void;
  completeLesson(lessonId: string): void;
  visitLesson(lessonId: string): void;
  reset(): void;
  exportJson(): string;
  /** Returns null on success, or a human-readable failure reason. */
  importJson(raw: string): string | null;
}

export function useLearningProgress(): LearningProgressApi {
  const [progress, setProgress] = useState<LearningProgress>(() => emptyProgress());
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setProgress(loadProgress());
    setLoaded(true);
  }, []);

  const dispatch = useCallback((event: ProgressEvent) => {
    setProgress((prev) => {
      const next = reduceProgress(prev, event);
      if (next !== prev) saveProgress(next);
      return next;
    });
  }, []);

  const completeLesson = useCallback(
    (lessonId: string) => {
      setProgress((prev) => {
        if (prev.completedLessons.includes(lessonId)) return prev;
        const withLesson = reduceProgress(prev, {
          kind: "lessonCompleted",
          lessonId,
          atMs: Date.now(),
          unlocks: unlockedMissionsFor([...prev.completedLessons, lessonId]),
        });
        saveProgress(withLesson);
        return withLesson;
      });
    },
    [],
  );

  const visitLesson = useCallback(
    (lessonId: string) => dispatch({ kind: "lessonVisited", lessonId, atMs: Date.now() }),
    [dispatch],
  );

  const reset = useCallback(() => dispatch({ kind: "reset" }), [dispatch]);

  const exportJson = useCallback(() => serializeProgress(progress), [progress]);

  const importJson = useCallback((raw: string): string | null => {
    const parsed = parseProgress(raw);
    if (!parsed.ok) return `Import rejected: ${parsed.reason}.`;
    saveProgress(parsed.progress);
    setProgress(parsed.progress);
    return null;
  }, []);

  return { progress, loaded, dispatch, completeLesson, visitLesson, reset, exportJson, importJson };
}
