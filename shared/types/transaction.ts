import type { Account, Category } from "./user";

export type TransactionType = "expense" | "income";

export type SupportedTransactionType = TransactionType;

export type TransactionListFilter = "all" | SupportedTransactionType;

export type TransactionStatus = "active" | "deleted";

export interface Transaction {
  transactionId: string;
  type: SupportedTransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: string;
  occurredDateKey: string;
  merchant: string | null;
  note: string | null;
  tags: string[];
  attachmentUrls: string[];
  includeInBudget: boolean;
  status: TransactionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionRequest {
  type: SupportedTransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: string;
  note: string | null;
  merchant: null;
  includeInBudget: boolean;
}

export interface CreateTransactionResult {
  transaction: Transaction;
  created: boolean;
  duplicate: boolean;
}

export type CreateExpenseTransactionRequest = CreateTransactionRequest & {
  type: "expense";
  includeInBudget: true;
};

export type CreateIncomeTransactionRequest = CreateTransactionRequest & {
  type: "income";
  includeInBudget: false;
};

export type CreateExpenseTransactionResult = Omit<
  CreateTransactionResult,
  "transaction"
> & {
  transaction: Transaction & { type: "expense" };
};
export type CreateIncomeTransactionResult = Omit<
  CreateTransactionResult,
  "transaction"
> & {
  transaction: Transaction & { type: "income" };
};

export interface GetTransactionRequest {
  transactionId: string;
}

export interface GetTransactionResult {
  transaction: Transaction;
}

export type ExpenseTransactionDetail = Transaction & {
  type: "expense";
  status: "active";
};

export type IncomeTransactionDetail = Transaction & {
  type: "income";
  status: "active";
};

export type ActiveTransactionDetail =
  | ExpenseTransactionDetail
  | IncomeTransactionDetail;

export interface UpdateTransactionRequest {
  transactionId: string;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: string;
  note: string | null;
  expectedVersion: number;
}

export interface UpdateTransactionResult {
  transaction: ActiveTransactionDetail;
  updated: true;
  duplicate: boolean;
  previousOccurredAt: string;
}

export type UpdateExpenseTransactionRequest = UpdateTransactionRequest;
export type UpdateIncomeTransactionRequest = UpdateTransactionRequest;
export type UpdateExpenseTransactionResult = UpdateTransactionResult;
export type UpdateIncomeTransactionResult = UpdateTransactionResult;

export interface DeleteTransactionRequest {
  transactionId: string;
  expectedVersion: number;
}

export interface DeleteTransactionResult {
  transactionId: string;
  deleted: true;
  alreadyDeleted: boolean;
  previousOccurredAt: string;
  version: number;
  updatedAt: string;
}

export type DeleteExpenseTransactionRequest = DeleteTransactionRequest;
export type DeleteIncomeTransactionRequest = DeleteTransactionRequest;
export type DeleteExpenseTransactionResult = DeleteTransactionResult;
export type DeleteIncomeTransactionResult = DeleteTransactionResult;

export interface ListCategoriesRequest {
  type: SupportedTransactionType;
  includeDisabled: false;
}

export interface ListCategoriesResult {
  items: Category[];
}

export type ListExpenseCategoriesRequest = ListCategoriesRequest & {
  type: "expense";
};
export type ListIncomeCategoriesRequest = ListCategoriesRequest & {
  type: "income";
};
export type ListExpenseCategoriesResult = ListCategoriesResult;
export type ListIncomeCategoriesResult = ListCategoriesResult;

export interface ListAccountsRequest {
  transactionType: SupportedTransactionType;
  includeDisabled: false;
}

export interface ListAccountsResult {
  items: Account[];
}

export type TransactionCursor = string;

export interface PaginationResult<TItem> {
  items: TItem[];
  pagination: {
    pageSize: number;
    nextCursor: TransactionCursor | null;
    hasMore: boolean;
  };
}

export interface TransactionListItem {
  transactionId: string;
  type: SupportedTransactionType;
  amountInCents: number;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  accountId: string;
  accountName: string;
  accountIcon: string | null;
  occurredAt: string;
  occurredDateKey: string;
  note: string | null;
  status: "active";
  createdAt: string;
}

export interface TransactionMonthSummary {
  year: number;
  month: number;
  monthExpenseInCents: number;
  monthIncomeInCents: number;
  monthBalanceInCents: number;
}

export interface GetMonthlySummaryRequest {
  year: number;
  month: number;
}

export interface GetMonthlySummaryResult {
  summary: TransactionMonthSummary;
}

export interface ListTransactionsRequest {
  filter: TransactionListFilter;
  categoryId?: string | null;
  year: number;
  month: number;
  pageSize: number;
  cursor: TransactionCursor | null;
}

export interface ListTransactionsResult
  extends PaginationResult<TransactionListItem> {
  summary: TransactionMonthSummary;
}

export type ListExpenseTransactionsRequest = Omit<
  ListTransactionsRequest,
  "filter"
>;
export type ListIncomeTransactionsRequest = Omit<
  ListTransactionsRequest,
  "filter"
>;
export type ListExpenseTransactionsResult = ListTransactionsResult;
export type ListIncomeTransactionsResult = ListTransactionsResult;
