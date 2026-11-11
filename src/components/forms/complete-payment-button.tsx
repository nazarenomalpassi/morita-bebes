"use client";

import { CornerDownLeft } from "lucide-react";
import { completePaymentRemainder } from "@/lib/payments/allocation";

export function CompletePaymentButton({ total, amounts, methodId, methodName, onChange, disabled }: {
  total: number; amounts: Record<string, string>; methodId: string; methodName: string;
  onChange: (value: string) => void; disabled?: boolean;
}) {
  return <button aria-label={`Completar restante en ${methodName}`} className="button button-ghost payment-remainder-button" disabled={disabled || total <= 0} onClick={() => onChange(completePaymentRemainder(total, amounts, methodId))} type="button"><CornerDownLeft aria-hidden="true" size={14} /> Completar restante</button>;
}
