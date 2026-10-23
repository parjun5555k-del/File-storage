// lib/expiry.ts — Date engine (shared with app)
// Rule: add whole calendar months, clamp day to target month length,
//       then subtract one day (expiry = last day of coverage, inclusive).

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30,
          31, 31, 30, 31, 30, 31][monthIndex0];
}

export function addMonthsClamped(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m0 = d.getMonth() + months;
  const target = new Date(y, m0, 1);
  const day = Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day);
}

export function calculateExpiry(startISO: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO))
    throw new Error("startISO must be YYYY-MM-DD");
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error("months must be an integer 1..120");
  const start = new Date(startISO + "T12:00:00"); // midday avoids DST edges
  const end = addMonthsClamped(start, months);
  end.setDate(end.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;
}

export type WarrantyStatus = "active" | "expired" | "unknown";

export function warrantyStatus(
  expiryISO: string | null,
  todayISO: string = new Date().toISOString().slice(0, 10),
): WarrantyStatus {
  if (!expiryISO) return "unknown";
  return todayISO <= expiryISO ? "active" : "expired";
}
