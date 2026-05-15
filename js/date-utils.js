const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function cloneDate(date) {
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function daysBetween(startDate, endDate) {
  return Math.round((dateOnly(endDate) - dateOnly(startDate)) / MS_PER_DAY);
}

export function compareDates(left, right) {
  return dateOnly(left).getTime() - dateOnly(right).getTime();
}

export function isSameDate(left, right) {
  if (!left || !right) return false;
  return compareDates(left, right) === 0;
}

export function dateOnly(date) {
  if (!(date instanceof Date)) return null;
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function formatDate(date) {
  if (!date) return "";
  const d = dateOnly(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateCompact(date) {
  return formatDate(date).replaceAll("-", "");
}

export function parseDateValue(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateOnly(value);
  }

  if (typeof value === "number") {
    if (value >= 19000101 && value <= 21991231) {
      const text = String(Math.trunc(value));
      return makeDate(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
    }

    if (value > 20000 && value < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + Math.round(value) * MS_PER_DAY);
      return dateOnly(date);
    }
  }

  const text = String(value).trim();
  if (!text) return null;

  let match = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
  if (match) {
    return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  return null;
}

export function parseDateFromText(text) {
  return parseDateValue(String(text || ""));
}

export function addMonths(date, months, preferredDay = null) {
  const source = dateOnly(date);
  const targetMonthIndex = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const day = preferredDay || source.getUTCDate();
  return makeDate(year, month, Math.min(day, daysInMonth(year, month)));
}

export function nextSettlementDate(afterDate, interestDay) {
  const start = dateOnly(afterDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;
  const candidate = makeDate(year, month, Math.min(interestDay, daysInMonth(year, month)));

  if (compareDates(candidate, start) > 0) return candidate;
  return addMonths(candidate, 1, interestDay);
}

export function isQuarterSettlement(date) {
  const month = dateOnly(date).getUTCMonth() + 1;
  return month === 3 || month === 6 || month === 9 || month === 12;
}

export function minDate(...dates) {
  const valid = dates.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((min, item) => (compareDates(item, min) < 0 ? item : min), valid[0]);
}

export function maxDate(...dates) {
  const valid = dates.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((max, item) => (compareDates(item, max) > 0 ? item : max), valid[0]);
}

export function inferInterestDay(...dateLists) {
  const dates = dateLists.flat().filter(Boolean);
  if (!dates.length) return 21;

  const counts = new Map();
  for (const date of dates) {
    const day = dateOnly(date).getUTCDate();
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
