import { AppError } from "./error";

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

