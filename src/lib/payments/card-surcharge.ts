export type CardType = "debit" | "credit";

export type SurchargePaymentMethod = {
  code: string;
  debit_surcharge_percent: number;
  credit_surcharge_percent: number;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function cardSurchargePercentage(
  method: SurchargePaymentMethod | undefined,
  cardType: CardType | "",
) {
  if (!method || method.code !== "card" || !cardType) return 0;
  return cardType === "debit"
    ? method.debit_surcharge_percent
    : method.credit_surcharge_percent;
}

export function calculateCardSurcharge(
  baseAmount: number,
  method: SurchargePaymentMethod | undefined,
  cardType: CardType | "",
) {
  return roundMoney(
    roundMoney(baseAmount) * cardSurchargePercentage(method, cardType) / 100,
  );
}
