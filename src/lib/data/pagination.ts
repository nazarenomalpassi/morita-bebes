export function requestedPage(value?: string) {
  return value && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
}
export function paginationHref(path: string, params: Record<string, string | undefined>, key: string, page: number, hash = "") {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value && name !== key) next.set(name, value);
  next.set(key, String(page));
  return `${path}?${next}${hash}`;
}
