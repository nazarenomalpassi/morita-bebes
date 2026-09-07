import { describe, expect, it } from "vitest";

import {
  argentinaLocalDateTimeToIso,
  dateTimeInputValueInArgentina,
  isIsoDate,
  isYearMonth,
  nextIsoDate,
} from "./date";

describe("Argentina date helpers", () => {
  it("formats an instant for the Buenos Aires date-time input", () => {
    expect(
      dateTimeInputValueInArgentina(new Date("2026-08-04T15:30:00.000Z")),
    ).toBe("2026-08-04T12:30");
  });

  it("converts a valid Buenos Aires local date-time to UTC", () => {
    expect(argentinaLocalDateTimeToIso("2026-08-04T12:30")).toBe(
      "2026-08-04T15:30:00.000Z",
    );
    expect(argentinaLocalDateTimeToIso("2026-02-30T12:30")).toBeNull();
  });

  it("validates calendar dates and year-month values", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isYearMonth("2026-12")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
  });

  it("advances dates across month and year boundaries", () => {
    expect(nextIsoDate("2026-12-31")).toBe("2027-01-01");
  });
});
