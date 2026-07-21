import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type { Account, Category } from "../types/user";
import type {
  CreateExpenseTransactionRequest,
  CreateExpenseTransactionResult,
  CreateTransactionRequest,
  CreateTransactionResult,
  DeleteExpenseTransactionRequest,
  DeleteExpenseTransactionResult,
  DeleteTransactionRequest,
  DeleteTransactionResult,
  GetTransactionResult,
  GetMonthlySummaryRequest,
  GetMonthlySummaryResult,
  ListAccountsRequest,
  ListAccountsResult,
  ListCategoriesRequest,
  ListCategoriesResult,
  ListExpenseCategoriesRequest,
  ListExpenseCategoriesResult,
  ListExpenseTransactionsRequest,
  ListExpenseTransactionsResult,
  ListTransactionsRequest,
  ListTransactionsResult,
  Transaction,
  TransactionListItem,
  TransactionMonthSummary,
  TransactionStatus,
  TransactionType,
  UpdateExpenseTransactionRequest,
  UpdateExpenseTransactionResult,
  UpdateTransactionRequest,
  UpdateTransactionResult,
} from "../types/transaction";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import {
  callCloudFunctionWithMetadata,
  type CloudCallOptions,
  type CloudCallResult,
} from "./cloud";

type LedgerTransport = <TPayload extends object, TData>(
  options: CloudCallOptions<TPayload, TData>,
) => Promise<CloudCallResult<TData>>;

function isTransactionType(value: unknown): value is TransactionType {
  return value === "expense" || value === "income";
}

function isTransactionStatus(value: unknown): value is TransactionStatus {
  return value === "active" || value === "deleted";
}

function parseTransaction(value: unknown): Transaction {
  if (
    !isRecord(value) ||
    typeof value.transactionId !== "string" ||
    !isTransactionType(value.type) ||
    !Number.isSafeInteger(value.amountInCents) ||
    typeof value.categoryId !== "string" ||
    typeof value.accountId !== "string" ||
    typeof value.occurredAt !== "string" ||
    typeof value.occurredDateKey !== "string" ||
    (value.merchant !== null && typeof value.merchant !== "string") ||
    (value.note !== null && typeof value.note !== "string") ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    !Array.isArray(value.attachmentUrls) ||
    !value.attachmentUrls.every((url) => typeof url === "string") ||
    typeof value.includeInBudget !== "boolean" ||
    !isTransactionStatus(value.status) ||
    !Number.isSafeInteger(value.version) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("账单响应格式无效");
  }

  return {
    transactionId: value.transactionId,
    type: value.type,
    amountInCents: value.amountInCents as number,
    categoryId: value.categoryId,
    accountId: value.accountId,
    occurredAt: value.occurredAt,
    occurredDateKey: value.occurredDateKey,
    merchant: value.merchant,
    note: value.note,
    tags: [...value.tags] as string[],
    attachmentUrls: [...value.attachmentUrls] as string[],
    includeInBudget: value.includeInBudget,
    status: value.status,
    version: value.version as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseCategory(value: unknown): Category {
  if (
    !isRecord(value) ||
    typeof value.categoryId !== "string" ||
    (value.type !== "expense" && value.type !== "income") ||
    typeof value.name !== "string" ||
    typeof value.icon !== "string" ||
    !Number.isSafeInteger(value.sortOrder) ||
    typeof value.isSystem !== "boolean" ||
    typeof value.isEnabled !== "boolean" ||
    !Number.isSafeInteger(value.version)
  ) {
    throw new Error("分类响应格式无效");
  }

  return {
    categoryId: value.categoryId,
    type: value.type,
    name: value.name,
    icon: value.icon,
    sortOrder: value.sortOrder as number,
    isSystem: value.isSystem,
    isEnabled: value.isEnabled,
    version: value.version as number,
  };
}

function parseAccount(value: unknown): Account {
  const validType =
    isRecord(value) &&
    ["wechat", "alipay", "bank", "cash", "other"].includes(
      String(value.type),
    );
  if (
    !isRecord(value) ||
    typeof value.accountId !== "string" ||
    !validType ||
    typeof value.name !== "string" ||
    (value.icon !== null && typeof value.icon !== "string") ||
    !Number.isSafeInteger(value.sortOrder) ||
    typeof value.isDefault !== "boolean" ||
    typeof value.isSystem !== "boolean" ||
    typeof value.isEnabled !== "boolean" ||
    !Number.isSafeInteger(value.version)
  ) {
    throw new Error("账户响应格式无效");
  }

  return {
    accountId: value.accountId,
    name: value.name,
    type: value.type as Account["type"],
    icon: value.icon,
    sortOrder: value.sortOrder as number,
    isDefault: value.isDefault,
    isSystem: value.isSystem,
    isEnabled: value.isEnabled,
    version: value.version as number,
  };
}

function parseCreateResult(value: unknown): CreateTransactionResult {
  if (
    !isRecord(value) ||
    typeof value.created !== "boolean" ||
    typeof value.duplicate !== "boolean"
  ) {
    throw new Error("新增账单响应格式无效");
  }

  return {
    transaction: parseTransaction(value.transaction),
    created: value.created,
    duplicate: value.duplicate,
  };
}

function parseGetResult(value: unknown): GetTransactionResult {
  if (!isRecord(value)) {
    throw new Error("查询账单响应格式无效");
  }

  return { transaction: parseTransaction(value.transaction) };
}

function parseUpdateResult(value: unknown): UpdateTransactionResult {
  if (
    !isRecord(value) ||
    value.updated !== true ||
    typeof value.duplicate !== "boolean" ||
    typeof value.previousOccurredAt !== "string"
  ) {
    throw new Error("更新账单响应格式无效");
  }
  const transaction = parseTransaction(value.transaction);
  if (transaction.status !== "active") {
    throw new Error("更新账单响应状态无效");
  }
  return {
    transaction: { ...transaction, status: "active" },
    updated: true,
    duplicate: value.duplicate,
    previousOccurredAt: value.previousOccurredAt,
  };
}

function parseDeleteResult(value: unknown): DeleteTransactionResult {
  if (
    !isRecord(value) ||
    typeof value.transactionId !== "string" ||
    value.deleted !== true ||
    typeof value.alreadyDeleted !== "boolean" ||
    typeof value.previousOccurredAt !== "string" ||
    !Number.isSafeInteger(value.version) ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("删除账单响应格式无效");
  }
  return {
    transactionId: value.transactionId,
    deleted: true,
    alreadyDeleted: value.alreadyDeleted,
    previousOccurredAt: value.previousOccurredAt,
    version: value.version as number,
    updatedAt: value.updatedAt,
  };
}

function parseCategoryList(
  value: unknown,
  expectedType: TransactionType = "expense",
): ListCategoriesResult {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("分类列表响应格式无效");
  }

  const items = value.items.map(parseCategory);
  if (items.some((item) => item.type !== expectedType || !item.isEnabled)) {
    throw new Error("分类列表包含类型不匹配或不可用的分类");
  }

  return { items };
}

function parseAccountList(value: unknown): ListAccountsResult {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("账户列表响应格式无效");
  }

  const items = value.items.map(parseAccount);
  if (items.some((item) => !item.isEnabled)) {
    throw new Error("账户列表包含已停用账户");
  }

  return { items };
}

function parseTransactionListItem(value: unknown): TransactionListItem {
  if (
    !isRecord(value) ||
    typeof value.transactionId !== "string" ||
    !isTransactionType(value.type) ||
    !Number.isSafeInteger(value.amountInCents) ||
    typeof value.categoryId !== "string" ||
    typeof value.categoryName !== "string" ||
    typeof value.categoryIcon !== "string" ||
    typeof value.accountId !== "string" ||
    typeof value.accountName !== "string" ||
    (value.accountIcon !== null && typeof value.accountIcon !== "string") ||
    typeof value.occurredAt !== "string" ||
    typeof value.occurredDateKey !== "string" ||
    (value.note !== null && typeof value.note !== "string") ||
    value.status !== "active" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("账单流水响应格式无效");
  }
  return {
    transactionId: value.transactionId,
    type: value.type,
    amountInCents: value.amountInCents as number,
    categoryId: value.categoryId,
    categoryName: value.categoryName,
    categoryIcon: value.categoryIcon,
    accountId: value.accountId,
    accountName: value.accountName,
    accountIcon: value.accountIcon,
    occurredAt: value.occurredAt,
    occurredDateKey: value.occurredDateKey,
    note: value.note,
    status: "active",
    createdAt: value.createdAt,
  };
}

function parseTransactionMonthSummary(value: unknown): TransactionMonthSummary {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.year) ||
    !Number.isSafeInteger(value.month) ||
    !Number.isSafeInteger(value.monthExpenseInCents) ||
    !Number.isSafeInteger(value.monthIncomeInCents) ||
    !Number.isSafeInteger(value.monthBalanceInCents)
  ) {
    throw new Error("月度收支汇总响应格式无效");
  }
  const year = value.year as number;
  const month = value.month as number;
  const monthExpenseInCents = value.monthExpenseInCents as number;
  const monthIncomeInCents = value.monthIncomeInCents as number;
  const monthBalanceInCents = value.monthBalanceInCents as number;
  if (
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    monthExpenseInCents < 0 ||
    monthIncomeInCents < 0 ||
    monthIncomeInCents - monthExpenseInCents !== monthBalanceInCents
  ) {
    throw new Error("月度收支汇总响应数据无效");
  }
  return {
    year,
    month,
    monthExpenseInCents,
    monthIncomeInCents,
    monthBalanceInCents,
  };
}

function parseMonthlySummaryResult(value: unknown): GetMonthlySummaryResult {
  if (!isRecord(value)) {
    throw new Error("月度收支汇总响应格式无效");
  }
  return { summary: parseTransactionMonthSummary(value.summary) };
}

function parseTransactionList(
  value: unknown,
  expectedType: TransactionType = "expense",
): ListTransactionsResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isRecord(value.pagination) ||
    !Number.isSafeInteger(value.pagination.pageSize) ||
    (value.pagination.nextCursor !== null &&
      typeof value.pagination.nextCursor !== "string") ||
    typeof value.pagination.hasMore !== "boolean" ||
    !isRecord(value.summary)
  ) {
    throw new Error("账单流水响应格式无效");
  }
  if (
    (value.pagination.hasMore && value.pagination.nextCursor === null) ||
    (!value.pagination.hasMore && value.pagination.nextCursor !== null)
  ) {
    throw new Error("账单流水分页响应不一致");
  }
  const items = value.items.map(parseTransactionListItem);
  if (items.some((item) => item.type !== expectedType)) {
    throw new Error("账单流水包含类型不匹配的记录");
  }
  return {
    items,
    pagination: {
      pageSize: value.pagination.pageSize as number,
      nextCursor: value.pagination.nextCursor,
      hasMore: value.pagination.hasMore,
    },
    summary: parseTransactionMonthSummary(value.summary),
  };
}

export function createLedgerService(
  transport: LedgerTransport = callCloudFunctionWithMetadata,
): {
  listCategories(type: TransactionType): Promise<ListCategoriesResult>;
  listExpenseCategories(): Promise<ListExpenseCategoriesResult>;
  listAccounts(): Promise<ListAccountsResult>;
  createTransaction(
    payload: CreateTransactionRequest,
    requestId: string,
  ): Promise<CreateTransactionResult>;
  createExpense(
    payload: CreateExpenseTransactionRequest,
    requestId: string,
  ): Promise<CreateExpenseTransactionResult>;
  getTransaction(transactionId: string): Promise<GetTransactionResult>;
  getMonthlySummary(
    payload: GetMonthlySummaryRequest,
  ): Promise<GetMonthlySummaryResult>;
  updateTransaction(
    payload: UpdateTransactionRequest,
    requestId: string,
  ): Promise<UpdateTransactionResult>;
  updateExpense(
    payload: UpdateExpenseTransactionRequest,
    requestId: string,
  ): Promise<UpdateExpenseTransactionResult>;
  deleteExpense(
    payload: DeleteExpenseTransactionRequest,
    requestId: string,
  ): Promise<DeleteExpenseTransactionResult>;
  deleteTransaction(
    payload: DeleteTransactionRequest,
    requestId: string,
  ): Promise<DeleteTransactionResult>;
  listExpenseTransactions(
    payload: ListExpenseTransactionsRequest,
  ): Promise<ListExpenseTransactionsResult>;
  listTransactions(
    payload: ListTransactionsRequest,
  ): Promise<ListTransactionsResult>;
} {
  return {
    async listCategories(type): Promise<ListCategoriesResult> {
      const payload: ListCategoriesRequest = { type, includeDisabled: false };
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "listCategories",
        requestId: createRequestId(),
        payload,
        parseData: (value) => parseCategoryList(value, type),
      });
      return result.data;
    },

    async listExpenseCategories(): Promise<ListExpenseCategoriesResult> {
      const payload: ListExpenseCategoriesRequest = {
        type: "expense",
        includeDisabled: false,
      };
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "listCategories",
        requestId: createRequestId(),
        payload,
        parseData: parseCategoryList,
      });
      return result.data;
    },

    async createTransaction(payload, requestId): Promise<CreateTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "createTransaction",
        requestId,
        payload,
        parseData: parseCreateResult,
      });
      if (result.data.transaction.type !== payload.type) {
        throw new Error("新增账单响应类型不匹配");
      }
      return result.data;
    },

    async listAccounts(): Promise<ListAccountsResult> {
      const payload: ListAccountsRequest = { includeDisabled: false };
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "listAccounts",
        requestId: createRequestId(),
        payload,
        parseData: parseAccountList,
      });
      return result.data;
    },

    async createExpense(
      payload: CreateExpenseTransactionRequest,
      requestId: string,
    ): Promise<CreateExpenseTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "createTransaction",
        requestId,
        payload,
        parseData: parseCreateResult,
      });
      return result.data;
    },

    async getTransaction(transactionId: string): Promise<GetTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "getTransaction",
        requestId: createRequestId(),
        payload: { transactionId },
        parseData: parseGetResult,
      });
      return result.data;
    },

    async getMonthlySummary(payload): Promise<GetMonthlySummaryResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "getMonthlySummary",
        requestId: createRequestId(),
        payload,
        parseData: parseMonthlySummaryResult,
      });
      return result.data;
    },

    async updateExpense(payload, requestId): Promise<UpdateExpenseTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "updateTransaction",
        requestId,
        payload,
        parseData: parseUpdateResult,
      });
      return result.data;
    },

    async updateTransaction(payload, requestId): Promise<UpdateTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "updateTransaction",
        requestId,
        payload,
        parseData: parseUpdateResult,
      });
      return result.data;
    },

    async deleteExpense(payload, requestId): Promise<DeleteExpenseTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "deleteTransaction",
        requestId,
        payload,
        parseData: parseDeleteResult,
      });
      return result.data;
    },

    async deleteTransaction(payload, requestId): Promise<DeleteTransactionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "deleteTransaction",
        requestId,
        payload,
        parseData: parseDeleteResult,
      });
      return result.data;
    },

    async listExpenseTransactions(
      payload: ListExpenseTransactionsRequest,
    ): Promise<ListExpenseTransactionsResult> {
      const request: ListTransactionsRequest = { ...payload, type: "expense" };
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "listTransactions",
        requestId: createRequestId(),
        payload: request,
        parseData: parseTransactionList,
      });
      return result.data;
    },

    async listTransactions(payload): Promise<ListTransactionsResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.LEDGER,
        action: "listTransactions",
        requestId: createRequestId(),
        payload,
        parseData: (value) => parseTransactionList(value, payload.type),
      });
      return result.data;
    },
  };
}

export {
  parseAccountList,
  parseCategoryList,
  parseCreateResult,
  parseGetResult,
  parseMonthlySummaryResult,
  parseUpdateResult,
  parseDeleteResult,
  parseTransactionList,
};

export const ledgerService = createLedgerService();
