"use client";

import { useEffect, type RefObject } from "react";

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
  trigger?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open || !container.current) return;
    const panel = container.current;
    const previous = trigger?.current ?? document.activeElement as HTMLElement | null;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    (controls()[0] ?? panel).focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, container, trigger, onClose]);
}
