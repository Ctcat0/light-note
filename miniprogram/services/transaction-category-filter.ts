import type { SupportedTransactionType } from "../types/transaction";

export interface TransactionCategoryFilterSignal {
  revision: number;
  year: number;
  month: number;
  type: SupportedTransactionType;
  categoryId: string;
  categoryName: string;
}

let revision = 0;
let pendingSignal: TransactionCategoryFilterSignal | null = null;

export function requestTransactionCategoryFilter(
  value: Omit<TransactionCategoryFilterSignal, "revision">,
): void {
  revision += 1;
  pendingSignal = { ...value, revision };
}

export function consumeTransactionCategoryFilter(): TransactionCategoryFilterSignal | null {
  const value = pendingSignal;
  pendingSignal = null;
  return value;
}
