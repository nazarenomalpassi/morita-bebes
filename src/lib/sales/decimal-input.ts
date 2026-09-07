export function sanitizeDecimalInput(
  value: string,
  options: { maxIntegerDigits?: number; maxFractionDigits?: number } = {},
) {
  const { maxIntegerDigits = 9, maxFractionDigits = 2 } = options;
  const normalized = value.replace(",", ".");

  if (normalized === "") return "";
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return null;

  const [integer = "", fraction = ""] = normalized.split(".");
  if (integer.length > maxIntegerDigits || fraction.length > maxFractionDigits) return null;

  return normalized;
}
