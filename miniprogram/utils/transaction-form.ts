import {
  MAX_OCCURRED_AT_FUTURE_OFFSET_MS,
  MAX_TRANSACTION_NOTE_LENGTH,
} from "../constants/transaction";
import type {
  CreateTransactionRequest,
  SupportedTransactionType,
  TransactionFormErrors,
  TransactionFormState,
} from "../types/transaction";
import { createIsoFromZonedDateTime } from "./date";
import { parseYuanInputToCents } from "./money";

export interface TransactionFormValidationResult {
  errors: TransactionFormErrors;
  payload: CreateTransactionRequest | null;
}

function emptyErrors(): TransactionFormErrors {
  return {
    amount: "",
    category: "",
    account: "",
    occurredAt: "",
    note: "",
  };
}

export function validateTransactionForm(
  form: TransactionFormState,
  type: SupportedTransactionType,
  options: { now?: Date; timeZone?: string } = {},
): TransactionFormValidationResult {
  const errors = emptyErrors();
  let amountInCents: number | null = null;
  let occurredAt: string | null = null;

  try {
    amountInCents = parseYuanInputToCents(form.amountInput);
  } catch (error) {
    errors.amount = error instanceof Error ? error.message : "金额无效";
  }

  if (form.categoryId.length === 0) {
    errors.category = `请选择${type === "expense" ? "支出" : "收入"}分类`;
  }

  if (form.accountId.length === 0) {
    errors.account = `请选择${type === "income" ? "收款方式" : "支付方式"}`;
  }

  try {
    occurredAt = createIsoFromZonedDateTime(
      form.dateValue,
      form.timeValue,
      options.timeZone,
    );
    const now = options.now ?? new Date();
    if (
      new Date(occurredAt).getTime() >
      now.getTime() + MAX_OCCURRED_AT_FUTURE_OFFSET_MS
    ) {
      errors.occurredAt = "发生时间不能晚于当前时间 5 分钟以上";
      occurredAt = null;
    }
  } catch (error) {
    errors.occurredAt =
      error instanceof Error ? error.message : "发生时间无效";
  }

  const note = form.note.trim();
  if (note.length > MAX_TRANSACTION_NOTE_LENGTH) {
    errors.note = `备注不能超过 ${MAX_TRANSACTION_NOTE_LENGTH} 个字符`;
  }

  const hasErrors = Object.values(errors).some((message) => message.length > 0);
  if (hasErrors || amountInCents === null || occurredAt === null) {
    return { errors, payload: null };
  }

  return {
    errors,
    payload: {
      type,
      amountInCents,
      categoryId: form.categoryId,
      accountId: form.accountId,
      occurredAt,
      note: note.length === 0 ? null : note,
      merchant: null,
      includeInBudget: type === "expense",
    },
  };
}

export function validateExpenseTransactionForm(
  form: TransactionFormState,
  options: { now?: Date; timeZone?: string } = {},
): TransactionFormValidationResult {
  return validateTransactionForm(form, "expense", options);
}
