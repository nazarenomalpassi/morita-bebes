export function completePaymentRemainder(total: number, amounts: Record<string, string>, methodId: string) {
  const otherCents = Object.entries(amounts).reduce((sum, [id, value]) => {
    const amount = Number(value || 0);
    return sum + (id === methodId || !Number.isFinite(amount) ? 0 : Math.round(amount * 100));
  }, 0);
  return (Math.max(0, Math.round(total * 100) - otherCents) / 100).toFixed(2);
}
