"use client";

import {useCallback} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  completedLessonIds,
  LEARNER_REWARD_USD,
  LESSONS,
  LESSON_COUNT,
  publicLessons,
  type PublicLesson,
} from "@/lib/learn";
import {
  readLocalLearnTasks,
  writeLocalLearnTasks,
} from "@/lib/localStore";
import {useSession} from "@/lib/session";
import type {LearnerState} from "@/lib/server/learn";

interface LearnPayload {
  lessons: PublicLesson[];
  progress: LearnerState;
}

interface CheckResult {
  correct: boolean;
  explanation?: string;
  message?: string;
  progress?: LearnerState;
}

interface RewardResult {
  granted: boolean;
  message: string;
  state: LearnerState;
}

function localLearnerState(tasksDone: number): LearnerState {
  const completed = completedLessonIds(tasksDone);
  const allDone = completed.length >= LESSON_COUNT;
  return {
    completed,
    sharedOnX: false,
    rewarded: false,
    waitlisted: false,
    seatsLeft: 50,
    status: allDone ? "needs_share" : "in_progress",
    rewardUsd: LEARNER_REWARD_USD,
  };
}

function mergeTasksDone(serverDone: number, localDone: number): number {
  return Math.min(Math.max(serverDone, localDone), LESSON_COUNT);
}

function gradeLesson(lessonId: string, choice: number): CheckResult {
  const index = LESSONS.findIndex((lesson) => lesson.id === lessonId);
  if (index === -1) {
    throw new Error("Unknown lesson.");
  }

  const lesson = LESSONS[index];
  if (choice !== lesson.quickCheck.answer) {
    return {
      correct: false,
      message: "Not quite — have another read and try again.",
    };
  }

  const current = readLocalLearnTasks();
  if (index > current) {
    throw new Error("Finish the earlier lessons first.");
  }

  const tasksDone = Math.max(current, index + 1);
  writeLocalLearnTasks(tasksDone);

  return {
    correct: true,
    explanation: lesson.quickCheck.explanation,
    progress: localLearnerState(tasksDone),
  };
}

export function useLearn() {
  const {getAccessToken, mode} = useSession();
  const queryClient = useQueryClient();
  const offline = mode === "demo";

  const authed = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? {authorization: `Bearer ${token}`} : {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as {error?: string}).error ?? `Request failed (${res.status})`,
        );
      }
      return body as T;
    },
    [getAccessToken],
  );

  const query = useQuery({
    queryKey: ["learn", offline],
    queryFn: async () => {
      const localTasks = readLocalLearnTasks();

      if (offline) {
        return {
          lessons: publicLessons(),
          progress: localLearnerState(localTasks),
        } satisfies LearnPayload;
      }

      try {
        const payload = await authed<LearnPayload>("/api/learn");
        const merged = mergeTasksDone(
          payload.progress.completed.length,
          localTasks,
        );
        if (merged !== payload.progress.completed.length) {
          writeLocalLearnTasks(merged);
        }
        return {
          lessons: payload.lessons,
          progress: {
            ...payload.progress,
            completed: completedLessonIds(merged),
            status:
              merged >= LESSON_COUNT ? "needs_share" : payload.progress.status,
          },
        };
      } catch {
        return {
          lessons: publicLessons(),
          progress: localLearnerState(localTasks),
        } satisfies LearnPayload;
      }
    },
  });

  const applyProgress = useCallback(
    (progress: LearnerState) => {
      writeLocalLearnTasks(progress.completed.length);
      queryClient.setQueryData<LearnPayload>(["learn", offline], {
        lessons: publicLessons(),
        progress,
      });
    },
    [offline, queryClient],
  );

  const answer = useMutation({
    mutationFn: async ({
      lessonId,
      answer: choice,
    }: {
      lessonId: string;
      answer: number;
    }) => {
      if (offline) {
        return gradeLesson(lessonId, choice);
      }

      try {
        const result = await authed<CheckResult>("/api/learn/complete", {
          method: "POST",
          body: JSON.stringify({lessonId, answer: choice}),
        });
        if (result.correct && result.progress) {
          writeLocalLearnTasks(result.progress.completed.length);
        }
        return result;
      } catch {
        return gradeLesson(lessonId, choice);
      }
    },
    onSuccess: (result) => {
      if (!result.correct || !result.progress) return;
      applyProgress(result.progress);
    },
  });

  const reward = useMutation({
    mutationFn: async (shareUrl: string) => {
      if (offline) {
        const tasksDone = readLocalLearnTasks();
        if (tasksDone < LESSON_COUNT) {
          throw new Error("Finish all three lessons first.");
        }
        return {
          granted: false,
          message:
            "Sharing is saved locally in demo mode. Connect Supabase and Privy to claim for real.",
          state: localLearnerState(tasksDone),
        } satisfies RewardResult;
      }

      return authed<RewardResult>("/api/learn/reward", {
        method: "POST",
        body: JSON.stringify({shareUrl}),
      });
    },
    onSuccess: (result) => {
      if (result.state) applyProgress(result.state);
      void queryClient.invalidateQueries({queryKey: ["learn"]});
      void queryClient.invalidateQueries({queryKey: ["rewards"]});
    },
  });

  return {
    lessons: query.data?.lessons ?? publicLessons(),
    progress: query.data?.progress ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => void query.refetch(),
    submitAnswer: answer.mutateAsync,
    answerResult: answer.data ?? null,
    answerError: answer.error instanceof Error ? answer.error.message : null,
    isChecking: answer.isPending,
    resetAnswer: answer.reset,
    claimReward: reward.mutateAsync,
    isClaiming: reward.isPending,
    rewardError: reward.error instanceof Error ? reward.error.message : null,
    rewardResult: reward.data ?? null,
  };
}
