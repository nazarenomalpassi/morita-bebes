import { describe, expect, it } from "vitest";

import { percentageChange, resolveReportPeriod } from "./analytics";

describe("resolveReportPeriod", () => {
  const now = new Date("2026-08-10T15:00:00Z");

  it("compares the current month with the same elapsed days of the previous month", () => {
    expect(resolveReportPeriod({ periodo: "thisMonth" }, now)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-10",
      compareFrom: "2026-07-01",
      compareTo: "2026-07-10",
    });
  });

  it("uses an immediately preceding range for a custom selection", () => {
    expect(resolveReportPeriod({ periodo: "custom", desde: "2026-08-01", hasta: "2026-08-10" }, now)).toMatchObject({
      compareFrom: "2026-07-22",
      compareTo: "2026-07-31",
    });
  });
});

describe("percentageChange", () => {
  it("avoids infinite comparisons", () => {
    expect(percentageChange(100, 0)).toBeNull();
    expect(percentageChange(120, 100)).toBe(20);
  });
});
