export function normalizeManualSearch(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();
}

export function matchesManualSearch(values: (string | null | undefined)[], query: string) {
  const text = normalizeManualSearch(values.filter(Boolean).join(" "));
  return normalizeManualSearch(query).split(/\s+/).filter(Boolean).every((token) => text.includes(token));
}
