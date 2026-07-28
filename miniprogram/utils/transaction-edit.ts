import type {
  Transaction,
  TransactionFormState,
  UpdateTransactionRequest,
} from "../types/transaction";
import { getDateTimeInputValues } from "./date";
import { formatAmountInCents } from "./money";
import { validateTransactionForm } from "./transaction-form";

export function createTransactionEditForm(
  transaction: Transaction,
  timeZone: string,
  requestId: string,
): TransactionFormState {
  const dateTime = getDateTimeInputValues(transaction.occurredAt, timeZone);
  return {
    amountInput: formatAmountInCents(transaction.amountInCents, {
      showCurrencySymbol: false,
    }),
    categoryId: transaction.categoryId,
    accountId: transaction.accountId,
    dateValue: dateTime.dateValue,
    timeValue: dateTime.timeValue,
    note: transaction.note ?? "",
    requestId,
  };
}

export function createUpdateTransactionPayload(
  form: TransactionFormState,
  transaction: Transaction,
  timeZone: string,
): UpdateTransactionRequest | null {
  const validation = validateTransactionForm(form, transaction.type, { timeZone });
  if (validation.payload === null) return null;
  return {
    transactionId: transaction.transactionId,
    amountInCents: validation.payload.amountInCents,
    categoryId: validation.payload.categoryId,
    accountId: validation.payload.accountId,
    occurredAt: validation.payload.occurredAt,
    note: validation.payload.note,
    expectedVersion: transaction.version,
  };
}

export function isTransactionDirty(
  payload: UpdateTransactionRequest | null,
  transaction: Transaction,
): boolean {
  return (
    payload !== null &&
    (payload.amountInCents !== transaction.amountInCents ||
      payload.categoryId !== transaction.categoryId ||
      payload.accountId !== transaction.accountId ||
      payload.occurredAt !== transaction.occurredAt ||
      payload.note !== transaction.note)
  );
}

export const createUpdateExpensePayload = createUpdateTransactionPayload;
export const isExpenseTransactionDirty = isTransactionDirty;
