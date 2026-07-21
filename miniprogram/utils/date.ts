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

