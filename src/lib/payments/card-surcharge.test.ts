import { describe, expect, it } from "vitest";

import {
  calculateCardSurcharge,
  cardSurchargePercentage,
  type SurchargePaymentMethod,
} from "./card-surcharge";

const card: SurchargePaymentMethod = {
  code: "card",
  debit_surcharge_percent: 3.5,
  credit_surcharge_percent: 13,
};

describe("card surcharge preview", () => {
  it("uses the configured debit or credit percentage", () => {
    expect(cardSurchargePercentage(card, "debit")).toBe(3.5);
    expect(cardSurchargePercentage(card, "credit")).toBe(13);
  });

  it("rounds the surcharge to Argentine currency cents", () => {
    expect(calculateCardSurcharge(100_000, card, "credit")).toBe(13_000);
    expect(calculateCardSurcharge(333.33, card, "debit")).toBe(11.67);
  });

  it("never adds a surcharge to cash or transfer", () => {
    const cash = { ...card, code: "cash" };
    expect(calculateCardSurcharge(100_000, cash, "credit")).toBe(0);
  });
});
