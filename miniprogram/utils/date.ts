import { AppError } from "./error";

export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function toValidDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AppError("INVALID_ARGUMENT", "日期格式无效");
  }

  return date;
}

function getDateParts(
  value: Date | string | number,
  timeZone: string,
): DateParts {
  const date = toValidDate(value);

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = new Map(
      formatter
        .formatToParts(date)
        .map((part) => [part.type, part.value] as const),
    );
    const year = parts.get("year");
    const month = parts.get("month");
    const day = parts.get("day");
    const hour = parts.get("hour");
    const minute = parts.get("minute");

    if (!year || !month || !day || !hour || !minute) {
      throw new Error("日期字段不完整");
    }

    return { year, month, day, hour, minute };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("INVALID_ARGUMENT", "时区或日期格式无效");
  }
}

export function getDateTimeInputValues(
  value: Date | string | number,
  timeZone = DEFAULT_TIME_ZONE,
): { dateValue: string; timeValue: string } {
  const { year, month, day, hour, minute } = getDateParts(value, timeZone);

  return {
    dateValue: `${year}-${month}-${day}`,
    timeValue: `${hour}:${minute}`,
  };
}

export function createIsoFromZonedDateTime(
  dateValue: string,
  timeValue: string,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);

  if (dateMatch === null || timeMatch === null) {
    throw new AppError("INVALID_OCCURRED_AT", "发生时间格式无效");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    throw new AppError("INVALID_OCCURRED_AT", "发生时间格式无效");
  }

  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredUtc;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = getDateParts(candidate, timeZone);
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    candidate -= representedAsUtc - desiredUtc;
  }

  const roundTrip = getDateTimeInputValues(candidate, timeZone);
  if (
    roundTrip.dateValue !== dateValue ||
    roundTrip.timeValue !== timeValue
  ) {
    throw new AppError("INVALID_OCCURRED_AT", "发生时间不存在或不明确");
  }

  return new Date(candidate).toISOString();
}

export function formatDate(
  value: Date | string | number,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const { year, month, day } = getDateParts(value, timeZone);

  return `${year}-${month}-${day}`;
}

export function formatDateTime(
  value: Date | string | number,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const { year, month, day, hour, minute } = getDateParts(value, timeZone);

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export interface YearMonth {
  year: number;
  month: number;
}

export function getYearMonth(
  value: Date | string | number,
  timeZone = DEFAULT_TIME_ZONE,
): YearMonth {
  const parts = getDateParts(value, timeZone);
  return { year: Number(parts.year), month: Number(parts.month) };
}

export function formatYearMonth(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

export function formatYearMonthLabel(value: YearMonth): string {
  return `${value.year}年${value.month}月`;
}

export function shiftYearMonth(
  value: YearMonth,
  offset: number,
): YearMonth {
  const monthIndex = value.year * 12 + value.month - 1 + offset;
  return {
    year: Math.floor(monthIndex / 12),
    month: (monthIndex % 12) + 1,
  };
}

export function compareYearMonth(left: YearMonth, right: YearMonth): number {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

export function formatTime(
  value: Date | string | number,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const { hour, minute } = getDateParts(value, timeZone);
  return `${hour}:${minute}`;
}

export function formatDayLabel(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) throw new AppError("INVALID_ARGUMENT", "日期键无效");
  return `${Number(match[2])}月${Number(match[3])}日`;
}

export function formatWeekdayLabel(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) throw new AppError("INVALID_ARGUMENT", "日期键无效");
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return weekdays[date.getUTCDay()] ?? "";
}
