// __tests__/calculateExpiry.test.ts
import { calculateExpiry, warrantyStatus, isLeapYear } from "../src/lib/warranty/calculateExpiry";

describe("calculateExpiry", () => {
  // ---- Spec table (section 6) ----
  it.each([
    ["2026-10-23", 12, "2027-10-22"],
    ["2026-01-31",  1, "2026-02-27"],
    ["2026-01-31", 12, "2027-01-30"],
    ["2026-08-31",  6, "2027-02-27"],
    ["2026-03-30", 12, "2027-03-29"],
    ["2027-12-29",  2, "2028-02-28"],
    ["2027-12-31",  2, "2028-02-28"],
    ["2028-01-29",  1, "2028-02-28"],
    ["2028-01-31",  1, "2028-02-28"],
    ["2026-05-15", 36, "2029-05-14"],
  ])("start %s + %i months = %s", (start, months, expected) => {
    expect(calculateExpiry(start, months)).toBe(expected);
  });

  // ---- Leap-year cases (agent-derived) ----
  it("Feb clamp in a leap year: 2024-01-31 + 1 = 2024-02-28", () => {
    expect(calculateExpiry("2024-01-31", 1)).toBe("2024-02-28");
  });
  it("Feb clamp in a common year: 2023-01-31 + 1 = 2023-02-27", () => {
    expect(calculateExpiry("2023-01-31", 1)).toBe("2023-02-27");
  });
  it("Century non-leap (2100): 2099-08-31 + 6 = 2100-02-27", () => {
    expect(calculateExpiry("2099-08-31", 6)).toBe("2100-02-27");
  });
  it("400-year leap (2400): 2399-08-31 + 6 = 2400-02-28", () => {
    expect(calculateExpiry("2399-08-31", 6)).toBe("2400-02-28");
  });
  it("12 months spanning a leap Feb: 2023-08-31 + 12 = 2024-08-30", () => {
    expect(calculateExpiry("2023-08-31", 12)).toBe("2024-08-30");
  });

  // ---- Validation ----
  it("rejects bad input", () => {
    expect(() => calculateExpiry("23-10-2026", 12)).toThrow();
    expect(() => calculateExpiry("2026-10-23", 0)).toThrow();
    expect(() => calculateExpiry("2026-10-23", 121)).toThrow();
    expect(() => calculateExpiry("2026-10-23", 1.5)).toThrow();
  });
});

describe("warrantyStatus", () => {
  it("active on expiry day (inclusive)", () => {
    expect(warrantyStatus("2026-10-23", "2026-10-23")).toBe("active");
  });
  it("expired the day after", () => {
    expect(warrantyStatus("2026-10-23", "2026-10-24")).toBe("expired");
  });
  it("unknown without expiry", () => {
    expect(warrantyStatus(null, "2026-10-23")).toBe("unknown");
  });
});

describe("isLeapYear", () => {
  it("2024 leap, 2100 not, 2400 leap", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2400)).toBe(true);
  });
});
