"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import {
  normalizeProductIdentifier,
  productIdentifierWarning,
} from "@/lib/product-identifiers";

export function BarcodeInput({ defaultValue }: { defaultValue?: string | null }) {
  const [captured, setCaptured] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  function normalizeInput(input: HTMLInputElement) {
    const barcode = normalizeProductIdentifier(input.value);
    input.value = barcode;
    setCaptured(Boolean(barcode));
    setWarning(productIdentifierWarning(barcode));
  }

  return (
    <div>
      <input
        autoComplete="off"
        className="field-input"
        defaultValue={defaultValue ?? ""}
        inputMode="text"
        maxLength={80}
        name="barcode"
        onBlur={(event) => normalizeInput(event.currentTarget)}
        onChange={() => {
          setCaptured(false);
          setWarning(null);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          normalizeInput(event.currentTarget);
        }}
        spellCheck={false}
        type="text"
      />
      {captured ? (
        <span className="barcode-captured" role="status">
          <CheckCircle2 aria-hidden="true" size={14} /> Código capturado
        </span>
      ) : null}
      {warning ? <span className="barcode-warning" role="alert">{warning}</span> : null}
    </div>
  );
}
