"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

export function PasswordInput({ className = "", ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="password-input">
      <input
        {...props}
        className={`field-input ${className}`.trim()}
        type={visible ? "text" : "password"}
      />
      <button
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="password-input-toggle"
        onClick={() => setVisible((current) => !current)}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        type="button"
      >
        {visible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
      </button>
    </span>
  );
}
