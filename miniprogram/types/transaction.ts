import type {
  TransactionCursor,
  TransactionListItem,
  TransactionMonthSummary,
} from "../../shared/types/transaction";

export type {
  ActiveTransactionDetail,
  CreateTransactionRequest,
  CreateTransactionResult,
  CreateExpenseTransactionRequest,
  CreateExpenseTransactionResult,
  CreateIncomeTransactionRequest,
  CreateIncomeTransactionResult,
  DeleteTransactionRequest,
  DeleteTransactionResult,
  DeleteExpenseTransactionRequest,
  DeleteExpenseTransactionResult,
  DeleteIncomeTransactionRequest,
  DeleteIncomeTransactionResult,
  ExpenseTransactionDetail,
  IncomeTransactionDetail,
  GetTransactionRequest,
  GetTransactionResult,
  GetMonthlySummaryRequest,
  GetMonthlySummaryResult,
  ListAccountsRequest,
  ListAccountsResult,
  ListCategoriesRequest,
  ListCategoriesResult,
  ListExpenseCategoriesRequest,
  ListExpenseCategoriesResult,
  ListIncomeCategoriesRequest,
  ListIncomeCategoriesResult,
  ListTransactionsRequest,
  ListTransactionsResult,
  ListExpenseTransactionsRequest,
  ListExpenseTransactionsResult,
  ListIncomeTransactionsRequest,
  ListIncomeTransactionsResult,
  PaginationResult,
  Transaction,
  TransactionCursor,
  TransactionListItem,
  TransactionMonthSummary,
  TransactionStatus,
  TransactionType,
  UpdateTransactionRequest,
  UpdateTransactionResult,
  UpdateExpenseTransactionRequest,
  UpdateExpenseTransactionResult,
  UpdateIncomeTransactionRequest,
  UpdateIncomeTransactionResult,
} from "../../shared/types/transaction";

export type TransactionListLoadStatus =
  | "initialLoading"
  | "ready"
  | "refreshing"
  | "loadingMore"
  | "empty"
  | "initialError"
  | "refreshError"
  | "loadMoreError"
  | "noMore";

export interface TransactionDayGroup {
  dateKey: string;
  dateLabel: string;
  weekdayLabel: string;
  expenseInCents: number;
  expenseDisplay: string;
  incomeInCents: number;
  incomeDisplay: string;
  items: TransactionListDisplayItem[];
}

export interface TransactionListDisplayItem extends TransactionListItem {
  categoryIconDisplay: string;
  amountDisplay: string;
  occurredTimeDisplay: string;
  title: string;
  secondaryText: string;
}

export interface TransactionListPageState {
  loadStatus: TransactionListLoadStatus;
  items: TransactionListItem[];
  groups: TransactionDayGroup[];
  summary: TransactionMonthSummary | null;
  nextCursor: TransactionCursor | null;
  hasMore: boolean;
  errorMessage: string;
}

export interface TransactionFormState {
  amountInput: string;
  categoryId: string;
  accountId: string;
  dateValue: string;
  timeValue: string;
  note: string;
  requestId: string;
}

export interface TransactionFormErrors {
  amount: string;
  category: string;
  account: string;
  occurredAt: string;
  note: string;
}

export interface TransactionEditFormState extends TransactionFormState {
  transactionId: string;
  expectedVersion: number;
}

export type TransactionEditFormErrors = TransactionFormErrors;

export interface TransactionConflictError extends Error {
  readonly code: "TRANSACTION_CONFLICT";
  readonly requestId: string | null;
}

export interface TransactionMutationResult {
  originalMonth: { year: number; month: number };
  currentMonth: { year: number; month: number } | null;
}
