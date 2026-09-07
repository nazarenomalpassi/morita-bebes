import { describe, expect, it } from "vitest";

import { getFinancialAccountCode } from "./financial-account";

describe("getFinancialAccountCode", () => {
  it.each([
    ["cash", "cash"],
    ["transfer", "transfer"],
    ["card", "transfer"],
    ["debit", "transfer"],
    ["credit", "transfer"],
  ] as const)("maps %s to %s", (method, expected) => {
    expect(getFinancialAccountCode(method)).toBe(expected);
  });
});
