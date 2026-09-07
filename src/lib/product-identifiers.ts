const invisibleIdentifierCharacters = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;
const scientificNotationPattern = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)[eE][+-]?\d+$/;

export function normalizeProductIdentifier(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(invisibleIdentifierCharacters, "").trim();
}

export function isScientificNotationIdentifier(value: string) {
  return scientificNotationPattern.test(normalizeProductIdentifier(value));
}

export function isValidGtin(value: string) {
  const code = normalizeProductIdentifier(value);
  if (![8, 12, 13, 14].includes(code.length) || !/^\d+$/.test(code)) return false;

  let sum = 0;
  const body = code.slice(0, -1);
  for (let index = body.length - 1, position = 1; index >= 0; index -= 1, position += 1) {
    sum += Number(code[index]) * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}

export function productIdentifierWarning(value: string) {
  const code = normalizeProductIdentifier(value);
  if (!code) return null;
  if (isScientificNotationIdentifier(code)) {
    return "La notación científica no es un código válido. Escaneá o escribí el valor completo.";
  }
  if (/^\d+$/.test(code) && [8, 13].includes(code.length) && !isValidGtin(code)) {
    return `El código tiene ${code.length} dígitos, pero su verificador EAN no coincide. Revisalo antes de guardar.`;
  }
  return null;
}
