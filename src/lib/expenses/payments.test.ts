import { describe, expect, it } from "vitest";
import { readExpensePayments, validateExpensePayments } from "./payments";

const cash = "f58d4aa9-429a-420e-9faf-c340e5515dff";
const transfer = "9d3f6709-15c3-47f4-889e-3a0e90bbc85d";

describe("expense payment allocation", () => {
  it("validates a combined payment using exact cents", () => {
    const payments = [{ payment_method_id: cash, amount: 0.1 }, { payment_method_id: transfer, amount: 0.2 }];
    expect(validateExpensePayments(payments, 0.3)).toEqual({ payments });
  });

  it("rejects missing amounts and excess allocations", () => {
    expect(validateExpensePayments([{ payment_method_id: cash, amount: 20 }], 30).error).toBeTruthy();
    expect(validateExpensePayments([{ payment_method_id: cash, amount: 40 }], 30).error).toBeTruthy();
  });

  it.each([0, -10, 10.001, Infinity, 1_000_000_000])("rejects invalid amount %s", (amount) => {
    expect(validateExpensePayments([{ payment_method_id: cash, amount }], amount).error).toBeTruthy();
  });

  it("rejects duplicated payment methods", () => {
    expect(validateExpensePayments([{ payment_method_id: cash, amount: 10 }, { payment_method_id: cash, amount: 20 }], 30).error).toBeTruthy();
  });

  it("keeps legacy allocations empty and reads saved splits", () => {
    expect(readExpensePayments([])).toEqual([]);
    expect(readExpensePayments(null)).toEqual([]);
    expect(readExpensePayments([{ payment_method_id: cash, amount: 15 }])).toEqual([{ payment_method_id: cash, amount: 15 }]);
  });
});
