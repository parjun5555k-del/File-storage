// lib/expiry.js
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(year, monthIndex0) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30,
          31, 31, 30, 31, 30, 31][monthIndex0];
}

function addMonthsClamped(d, months) {
  const y = d.getFullYear();
  const m0 = d.getMonth() + months;
  const target = new Date(y, m0, 1);
  const day = Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day);
}

function calculateExpiry(startISO, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO))
    throw new Error("startISO must be YYYY-MM-DD");
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error("months must be an integer 1..120");
  const start = new Date(startISO + "T12:00:00");
  const end = addMonthsClamped(start, months);
  end.setDate(end.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;
}

function warrantyStatus(expiryISO, todayISO = new Date().toISOString().slice(0, 10)) {
  if (!expiryISO) return "unknown";
  return todayISO <= expiryISO ? "active" : "expired";
}

exports.calculateExpiry = calculateExpiry;
exports.warrantyStatus = warrantyStatus;
exports.isLeapYear = isLeapYear;
