"use client";

type ConfirmSubmitButtonProps = {
  children: React.ReactNode;
  className?: string;
  message: string;
  name?: string;
  title?: string;
  value?: string;
};

export function ConfirmSubmitButton({
  children,
  className = "icon-button icon-button-danger",
  message,
  name,
  title,
  value,
}: ConfirmSubmitButtonProps) {
  return (
    <button
      className={className}
      name={name}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      title={title}
      type="submit"
      value={value}
    >
      {children}
    </button>
  );
}
