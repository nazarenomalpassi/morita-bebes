import type { AnalyticsReport } from "./analytics";

export function rankingLimit(value: string | number) {
  const limit = Number(value);
  return [5, 10, 20, 50].includes(limit) ? limit : 10;
}

export function rankProducts(products: AnalyticsReport["topProducts"], metric: "units" | "revenue", limit: number) {
  return [...products].sort((left, right) => right[metric] - left[metric] || left.name.localeCompare(right.name, "es") || left.id.localeCompare(right.id)).slice(0, rankingLimit(limit));
}
