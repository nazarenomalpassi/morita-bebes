import { describe, expect, it } from "vitest";

import { addCashDays, getCurrentCashPeriod } from "./period";

describe("cash period", () => {
  it("uses the current local day before the 22:00 closure", () => {
    const period = getCurrentCashPeriod(new Date("2026-08-21T00:59:59Z"));

    expect(period.businessDate).toBe("2026-08-20");
    expect(period.startsAt.toISOString()).toBe("2026-08-20T03:00:00.000Z");
    expect(period.closesAt.toISOString()).toBe("2026-08-21T01:00:00.000Z");
    expect(period.isAwaitingNextDay).toBe(false);
  });

  it("starts the next empty period after the 22:00 closure", () => {
    const period = getCurrentCashPeriod(new Date("2026-08-21T01:00:00Z"));

    expect(period.businessDate).toBe("2026-08-21");
    expect(period.startsAt.toISOString()).toBe("2026-08-21T03:00:00.000Z");
    expect(period.closesAt.toISOString()).toBe("2026-08-22T01:00:00.000Z");
    expect(period.isAwaitingNextDay).toBe(true);
  });

  it("handles month and year boundaries", () => {
    expect(addCashDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
