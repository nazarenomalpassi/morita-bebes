"use client";

import { useCallback, useRef, type FormEvent } from "react";
import { useSubmissionState } from "./use-submission-state";
import { formDataChanged } from "@/lib/actions/form-state";

type Feedback = { error?: string; status?: string };

export function usePreservedActionState<State extends Feedback>(
  action: (state: State, data: FormData) => Promise<State>,
  initialState: State,
) {
  const failed = useRef(false);
  const submitted = useRef<FormData | null>(null);
  const wrappedAction = useCallback(async (state: State, data: FormData) => {
    submitted.current = data;
    try {
      const next = await action(state, data);
      failed.current = Boolean(next.error || next.status === "error");
      return next;
    } catch (error) {
      failed.current = true;
      throw error;
    }
  }, [action]);
  const [state, formAction, pending] = useSubmissionState<State, FormData>(wrappedAction, initialState);
  const onReset = useCallback((event: FormEvent<HTMLFormElement>) => {
    // React resets uncontrolled fields after a resolved action, including errors.
    if (failed.current || (submitted.current && formDataChanged(new FormData(event.currentTarget), submitted.current))) event.preventDefault();
  }, []);
  return { state, formAction, pending, onReset };
}
