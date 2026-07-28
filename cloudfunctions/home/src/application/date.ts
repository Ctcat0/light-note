function parts(value: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const map = Object.fromEntries(values.map((item) => [item.type, item.value]));
  const result = { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second) };
  if (Object.values(result).some((item) => !Number.isInteger(item))) throw new Error("时区无效");
  return result;
}

export function dateKeyFor(value: Date, timeZone: string): string {
  const valueParts = parts(value, timeZone);
  return `${valueParts.year}-${String(valueParts.month).padStart(2, "0")}-${String(valueParts.day).padStart(2, "0")}`;
}

function zonedStart(year: number, month: number, day: number, timeZone: string): Date {
  const desired = Date.UTC(year, month - 1, day);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const representedParts = parts(new Date(candidate), timeZone);
    const represented = Date.UTC(representedParts.year, representedParts.month - 1, representedParts.day, representedParts.hour, representedParts.minute, representedParts.second);
    candidate -= represented - desired;
  }
  return new Date(candidate);
}

export function createOverviewRanges(now: Date, timeZone: string): {
  dateKey: string;
  todayStart: Date;
  tomorrowStart: Date;
  monthStart: Date;
  nextMonthStart: Date;
} {
  const value = parts(now, timeZone);
  const tomorrow = new Date(Date.UTC(value.year, value.month - 1, value.day + 1));
  const nextMonthYear = value.month === 12 ? value.year + 1 : value.year;
  const nextMonth = value.month === 12 ? 1 : value.month + 1;
  return {
    dateKey: dateKeyFor(now, timeZone),
    todayStart: zonedStart(value.year, value.month, value.day, timeZone),
    tomorrowStart: zonedStart(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timeZone),
    monthStart: zonedStart(value.year, value.month, 1, timeZone),
    nextMonthStart: zonedStart(nextMonthYear, nextMonth, 1, timeZone),
  };
}
