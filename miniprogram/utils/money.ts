import { AppError } from "./error";
import { MAX_TRANSACTION_AMOUNT_IN_CENTS } from "../constants/transaction";

export interface FormatAmountOptions {
  showCurrencySymbol?: boolean;
}

export function formatAmountInCents(
  amountInCents: number,
  options: FormatAmountOptions = {},
): string {
  if (!Number.isSafeInteger(amountInCents)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "金额必须是以分为单位的安全整数",
    );
  }

  const { showCurrencySymbol = true } = options;
  const absoluteAmount = Math.abs(amountInCents);
  const yuan = Math.floor(absoluteAmount / 100);
  const cents = String(absoluteAmount % 100).padStart(2, "0");
  const sign = amountInCents < 0 ? "-" : "";
  const currencySymbol = showCurrencySymbol ? "¥" : "";

  return `${sign}${currencySymbol}${yuan}.${cents}`;
}

export function parseYuanInputToCents(
  input: string,
  maxAmountInCents = MAX_TRANSACTION_AMOUNT_IN_CENTS,
): number {
  const value = input.trim();

  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value)) {
    throw new AppError("INVALID_AMOUNT", "金额最多保留两位小数");
  }

  const [yuanPart = "", centsPart = ""] = value.split(".");
  const normalizedYuan = yuanPart.length === 0 ? "0" : yuanPart;
  const amountInCents =
    Number(normalizedYuan) * 100 + Number(centsPart.padEnd(2, "0"));

  if (
    !Number.isSafeInteger(amountInCents) ||
    amountInCents <= 0 ||
    amountInCents > maxAmountInCents
  ) {
    throw new AppError(
      "INVALID_AMOUNT",
      `单笔金额必须在 0.01 至 ${formatAmountInCents(maxAmountInCents)} 元之间`,
    );
  }

  return amountInCents;
}

export function normalizeYuanInput(
  input: string,
  previousValue: string,
): string {
  if (input === "") {
    return "";
  }

  if (!/^\d*(?:\.\d{0,2})?$/.test(input)) {
    return previousValue;
  }

  const normalized = input.startsWith(".") ? `0${input}` : input;

  try {
    if (normalized.endsWith(".")) {
      const wholeYuan = Number(normalized.slice(0, -1));
      return Number.isSafeInteger(wholeYuan) && wholeYuan <= 99_999_999
        ? normalized
        : previousValue;
    }

    parseYuanInputToCents(normalized);
    return normalized;
  } catch {
    return /^0+(?:\.0{0,2})?$/.test(normalized)
      ? normalized
      : previousValue;
  }
}
