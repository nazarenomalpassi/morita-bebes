"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formDataChanged } from "@/lib/actions/form-state";

// Keep feedback independent of the action transition: Next's production RSC
// revalidation can otherwise leave useActionState pending after a committed write.
export function useSubmissionState<State extends { error?: string; message?: string; status?: string }, Payload>(
  action: (previous: State, payload: Payload) => Promise<State>,
  initialState: State,
): [State, (payload: Payload) => Promise<void>, boolean] {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const latestState = useRef(initialState);
  const inFlight = useRef<Promise<void> | null>(null);
  const versionBeforeSubmission = useRef<string | null>(null);
  const detachResetProtection = useRef<(() => void) | null>(null);
  useEffect(() => () => detachResetProtection.current?.(), []);
  useEffect(() => {
    if (!state.message || state.error || state.status === "error") return;
    // Refresh outside the form action's transition so a completed write cannot
    // leave the server-rendered list waiting on that same transition.
    const timer = window.setTimeout(() => router.refresh(), 0);
    const version = versionBeforeSubmission.current;
    let interacted = false;
    const recordInteraction = () => { interacted = true; };
    const events = ["input", "keydown", "pointerdown"] as const;
    for (const event of events) document.addEventListener(event, recordInteraction, true);
    // Next's production RSC transition can remain uncommitted after success.
    // Recover only when no new work would be discarded; otherwise ask explicitly.
    const recovery = window.setTimeout(() => {
      const current = document.querySelector<HTMLElement>(".management-main")?.dataset.renderVersion;
      if (!version || !current || current !== version) return;
      if (interacted) window.dispatchEvent(new Event("morita-refresh-needed"));
      else window.location.reload();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(recovery);
      for (const event of events) document.removeEventListener(event, recordInteraction, true);
    };
  }, [state, router]);
  const submit = useCallback((payload: Payload) => {
    if (inFlight.current) return inFlight.current;
    detachResetProtection.current?.();
    const form = document.activeElement instanceof HTMLElement ? document.activeElement.closest("form") : null;
    if (form && payload instanceof FormData) {
      const protectReset = (event: Event) => {
        const feedback = latestState.current;
        if (feedback.error || feedback.status === "error" || formDataChanged(new FormData(form), payload)) event.preventDefault();
      };
      form.addEventListener("reset", protectReset);
      detachResetProtection.current = () => form.removeEventListener("reset", protectReset);
    }
    versionBeforeSubmission.current = document.querySelector<HTMLElement>(".management-main")?.dataset.renderVersion ?? null;
    setPending(true);
    const operation = Promise.resolve().then(async () => {
      try {
        const next = await action(latestState.current, payload);
        latestState.current = next;
        setState(() => next);
      } finally {
        inFlight.current = null;
        setPending(false);
      }
    });
    inFlight.current = operation;
    return operation;
  }, [action]);
  return [state, submit, pending];
}
