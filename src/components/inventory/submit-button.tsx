"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "",
  pendingLabel = "Guardando...",
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`button button-primary gap-2 ${className}`}
      disabled={pending}
      type="submit"
    >
      {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
}
