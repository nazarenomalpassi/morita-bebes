export function calculatePercentageDiscount(subtotal: number, percentage: number) {
  if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error("Invalid sale subtotal");
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Discount percentage must be between 0 and 100");
  }

  const amount = Math.round((subtotal * percentage / 100 + Number.EPSILON) * 100) / 100;
  return { amount, total: Math.max(0, Math.round((subtotal - amount + Number.EPSILON) * 100) / 100) };
}

export function calculateSaleAmounts(
  subtotal: number,
  discountPercentage: number,
  manualSurcharge: number,
) {
  if (!Number.isFinite(manualSurcharge) || manualSurcharge < 0) {
    throw new Error("Manual surcharge must be zero or greater");
  }

  const discount = calculatePercentageDiscount(subtotal, discountPercentage);
  const paymentBaseTotal = Math.round(
    (discount.total + manualSurcharge + Number.EPSILON) * 100,
  ) / 100;

  return {
    discountAmount: discount.amount,
    discountedTotal: discount.total,
    paymentBaseTotal,
  };
}

export function isFullyDiscountedSale(subtotal: number, total: number) {
  return subtotal > 0 && total === 0;
}
