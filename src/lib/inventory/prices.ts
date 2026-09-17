const MAX_PRICE = 999_999_999_999.99;

const priceFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
});

export type ProductPrices = {
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number | null;
};

export function formatPriceInput(value: number | null) {
  return value === null ? "" : priceFormatter.format(value);
}

export function parsePriceInput(raw: string): number | null {
  const value = raw.trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!value) return null;

  const argentineGrouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value);
  const ungrouped = /^\d+(?:[,.]\d{1,2})?$/.test(value);
  if (!argentineGrouped && !ungrouped) return null;

  const normalized = argentineGrouped
    ? value.replace(/\./g, "").replace(",", ".")
    : value.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_PRICE
    ? amount
    : null;
}
