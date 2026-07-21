import type {
  ApiErrorCode,
  ApiResponse,
  CloudFunctionRequest,
} from "../../../../shared/types/api";
import type {
  CreateTransactionRequest,
  CreateTransactionResult,
  DeleteTransactionRequest,
  DeleteTransactionResult,
  GetTransactionRequest,
  GetTransactionResult,
  GetMonthlySummaryRequest,
  GetMonthlySummaryResult,
  ListAccountsRequest,
  ListAccountsResult,
  ListCategoriesRequest,
  ListCategoriesResult,
  ListTransactionsRequest,
  ListTransactionsResult,
  UpdateTransactionRequest,
  UpdateTransactionResult,
} from "../../../../shared/types/transaction";
import type { LedgerStore } from "../domain/types";
import { LedgerError } from "../domain/types";
import {
  createTransaction,
  deleteTransaction,
  getTransactionById,
  getMonthlySummary,
  listAccounts,
  listCategories,
  listTransactions,
  resolveLedgerUser,
  updateTransaction,
} from "./transactions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LedgerResponseData =
  | CreateTransactionResult
  | UpdateTransactionResult
  | DeleteTransactionResult
  | GetTransactionResult
  | GetMonthlySummaryResult
  | ListCategoriesResult
  | ListAccountsResult
  | ListTransactionsResult;

interface LedgerFunctionDependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: LedgerStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRequestId(event: unknown): string {
  return isRecord(event) && typeof event.requestId === "string"
    ? event.requestId.slice(0, 128)
    : `server-${Date.now().toString(36)}`;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    requiredKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) && keys.every((key) => allowedKeys.includes(key))
  );
}

function parseBaseRequest(event: unknown): CloudFunctionRequest<object> {
  if (!isRecord(event)) {
    throw new LedgerError("INVALID_ARGUMENT", "请求格式无效");
  }

  const prohibited = ["ownerId", "userId", "openId", "openid", "OPENID"];
  if (prohibited.some((key) => Object.prototype.hasOwnProperty.call(event, key))) {
    throw new LedgerError("INVALID_ARGUMENT", "请求包含不可信身份字段");
  }
  if (typeof event.requestId !== "string" || event.requestId.length === 0) {
    throw new LedgerError("REQUEST_ID_REQUIRED", "缺少 requestId");
  }
  if (!UUID_PATTERN.test(event.requestId)) {
    throw new LedgerError("INVALID_ARGUMENT", "requestId 必须是 UUID");
  }
  if (typeof event.action !== "string" || !isRecord(event.payload)) {
    throw new LedgerError("INVALID_ARGUMENT", "请求格式无效");
  }

  return {
    action: event.action,
    requestId: event.requestId,
    payload: event.payload,
  };
}

function parseCreatePayload(value: object): CreateTransactionRequest {
  if (!isRecord(value)) {
    throw new LedgerError("INVALID_ARGUMENT", "账单参数无效");
  }
  const allowed = [
    "type",
    "amountInCents",
    "categoryId",
    "accountId",
    "occurredAt",
    "note",
    "merchant",
    "includeInBudget",
  ] as const;
  if (!hasExactKeys(value, allowed, allowed)) {
    throw new LedgerError("INVALID_ARGUMENT", "账单参数包含未允许的字段");
  }
  if (value.type !== "expense" && value.type !== "income") {
    throw new LedgerError("INVALID_ARGUMENT", "账单类型无效");
  }
  if (typeof value.categoryId !== "string") {
    throw new LedgerError("CATEGORY_REQUIRED", "请选择分类");
  }
  if (typeof value.accountId !== "string") {
    throw new LedgerError("ACCOUNT_REQUIRED", "请选择账户");
  }
  if (
    typeof value.amountInCents !== "number" ||
    typeof value.occurredAt !== "string" ||
    (value.note !== null && typeof value.note !== "string") ||
    value.merchant !== null ||
    value.includeInBudget !== (value.type === "expense")
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "账单参数类型无效");
  }

  return {
    type: value.type,
    amountInCents: value.amountInCents,
    categoryId: value.categoryId,
    accountId: value.accountId,
    occurredAt: value.occurredAt,
    note: value.note,
    merchant: null,
    includeInBudget: value.includeInBudget,
  };
}

function parseGetPayload(value: object): GetTransactionRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["transactionId"], ["transactionId"]) ||
    typeof value.transactionId !== "string" ||
    value.transactionId.trim().length === 0
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "账单 ID 无效");
  }

  return { transactionId: value.transactionId };
}

function parseUpdatePayload(value: object): UpdateTransactionRequest {
  const keys = [
    "transactionId",
    "amountInCents",
    "categoryId",
    "accountId",
    "occurredAt",
    "note",
    "expectedVersion",
  ] as const;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys, keys) ||
    typeof value.transactionId !== "string" ||
    typeof value.amountInCents !== "number" ||
    typeof value.categoryId !== "string" ||
    typeof value.accountId !== "string" ||
    typeof value.occurredAt !== "string" ||
    (value.note !== null && typeof value.note !== "string") ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "账单更新参数无效");
  }
  if (value.transactionId.trim().length === 0) {
    throw new LedgerError("TRANSACTION_ID_REQUIRED", "缺少账单 ID");
  }
  return {
    transactionId: value.transactionId,
    amountInCents: value.amountInCents,
    categoryId: value.categoryId,
    accountId: value.accountId,
    occurredAt: value.occurredAt,
    note: value.note,
    expectedVersion: value.expectedVersion,
  };
}

function parseDeletePayload(value: object): DeleteTransactionRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["transactionId", "expectedVersion"],
      ["transactionId", "expectedVersion"],
    ) ||
    typeof value.transactionId !== "string" ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "账单删除参数无效");
  }
  if (value.transactionId.trim().length === 0) {
    throw new LedgerError("TRANSACTION_ID_REQUIRED", "缺少账单 ID");
  }
  return {
    transactionId: value.transactionId,
    expectedVersion: value.expectedVersion,
  };
}

function parseCategoryListPayload(value: object): ListCategoriesRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "includeDisabled"], ["type", "includeDisabled"]) ||
    (value.type !== "expense" && value.type !== "income") ||
    value.includeDisabled !== false
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "分类查询参数无效");
  }

  return { type: value.type, includeDisabled: false };
}

function parseAccountListPayload(value: object): ListAccountsRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["includeDisabled"], ["includeDisabled"]) ||
    value.includeDisabled !== false
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "账户查询参数无效");
  }

  return { includeDisabled: false };
}

function parseTransactionListPayload(
  value: object,
): ListTransactionsRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["type", "year", "month", "pageSize", "cursor"],
      ["type", "year", "month", "pageSize", "cursor"],
    )
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "流水查询参数无效");
  }
  if (value.type !== "expense" && value.type !== "income") {
    throw new LedgerError("INVALID_ARGUMENT", "账单类型无效");
  }
  if (
    !Number.isInteger(value.year) ||
    typeof value.year !== "number" ||
    value.year < 1000 ||
    value.year > 9999
  ) {
    throw new LedgerError("INVALID_YEAR", "year 必须是四位整数");
  }
  if (
    !Number.isInteger(value.month) ||
    typeof value.month !== "number" ||
    value.month < 1 ||
    value.month > 12
  ) {
    throw new LedgerError("INVALID_MONTH", "month 必须是 1 至 12 的整数");
  }
  if (
    !Number.isInteger(value.pageSize) ||
    typeof value.pageSize !== "number" ||
    value.pageSize < 1 ||
    value.pageSize > 50
  ) {
    throw new LedgerError("INVALID_PAGE_SIZE", "pageSize 必须是 1 至 50 的整数");
  }
  if (value.cursor !== null && typeof value.cursor !== "string") {
    throw new LedgerError("INVALID_CURSOR", "分页游标无效");
  }
  return {
    type: value.type,
    year: value.year,
    month: value.month,
    pageSize: value.pageSize,
    cursor: value.cursor,
  };
}

function parseMonthlySummaryPayload(value: object): GetMonthlySummaryRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["year", "month"], ["year", "month"])
  ) {
    throw new LedgerError("INVALID_ARGUMENT", "月度汇总参数无效");
  }
  if (
    typeof value.year !== "number" ||
    !Number.isInteger(value.year) ||
    value.year < 1000 ||
    value.year > 9999
  ) {
    throw new LedgerError("INVALID_YEAR", "year 必须是四位整数");
  }
  if (
    typeof value.month !== "number" ||
    !Number.isInteger(value.month) ||
    value.month < 1 ||
    value.month > 12
  ) {
    throw new LedgerError("INVALID_MONTH", "month 必须是 1 至 12 的整数");
  }
  return { year: value.year, month: value.month };
}

function successResponse(
  data: LedgerResponseData,
  requestId: string,
  now: Date,
): ApiResponse<LedgerResponseData> {
  return {
    success: true,
    code: "OK",
    message: "操作成功",
    data,
    requestId,
    serverTime: now.toISOString(),
  };
}

function failureResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  now: Date,
): ApiResponse<LedgerResponseData> {
  return {
    success: false,
    code,
    message,
    data: null,
    requestId,
    serverTime: now.toISOString(),
  };
}

export function createLedgerFunctionHandler(
  dependencies: LedgerFunctionDependencies,
): (event: unknown) => Promise<ApiResponse<LedgerResponseData>> {
  return async (event: unknown): Promise<ApiResponse<LedgerResponseData>> => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId = extractRequestId(event);

    try {
      const request = parseBaseRequest(event);
      const identity = await resolveLedgerUser(
        dependencies.getOpenId(),
        dependencies.store,
      );
      let data: LedgerResponseData;

      switch (request.action) {
        case "createTransaction":
          data = await createTransaction({
            ownerId: identity.user._id,
            requestId: request.requestId,
            payload: parseCreatePayload(request.payload),
            settings: identity.settings,
            now,
            store: dependencies.store,
          });
          break;
        case "getTransaction": {
          const payload = parseGetPayload(request.payload);
          data = await getTransactionById({
            transactionId: payload.transactionId,
            ownerId: identity.user._id,
            store: dependencies.store,
          });
          break;
        }
        case "getMonthlySummary": {
          const payload = parseMonthlySummaryPayload(request.payload);
          data = await getMonthlySummary({
            ownerId: identity.user._id,
            year: payload.year,
            month: payload.month,
            settings: identity.settings,
            store: dependencies.store,
          });
          break;
        }
        case "updateTransaction":
          data = await updateTransaction({
            ownerId: identity.user._id,
            requestId: request.requestId,
            payload: parseUpdatePayload(request.payload),
            settings: identity.settings,
            now,
            store: dependencies.store,
          });
          break;
        case "deleteTransaction":
          data = await deleteTransaction({
            ownerId: identity.user._id,
            requestId: request.requestId,
            payload: parseDeletePayload(request.payload),
            now,
            store: dependencies.store,
          });
          break;
        case "listCategories":
          const payload = parseCategoryListPayload(request.payload);
          data = await listCategories(
            identity.user._id,
            payload.type,
            dependencies.store,
          );
          break;
        case "listAccounts":
          parseAccountListPayload(request.payload);
          data = await listAccounts(
            identity.user._id,
            identity.settings.defaultAccountId,
            dependencies.store,
          );
          break;
        case "listTransactions": {
          const payload = parseTransactionListPayload(request.payload);
          data = await listTransactions({
            ownerId: identity.user._id,
            type: payload.type,
            year: payload.year,
            month: payload.month,
            pageSize: payload.pageSize,
            cursor: payload.cursor,
            settings: identity.settings,
            store: dependencies.store,
          });
          break;
        }
        default:
          throw new LedgerError("INVALID_ARGUMENT", "未知的记账操作");
      }

      return successResponse(data, request.requestId, now);
    } catch (error) {
      if (error instanceof LedgerError) {
        return failureResponse(
          error.code,
          error.message,
          fallbackRequestId,
          now,
        );
      }

      const isCreate = isRecord(event) && event.action === "createTransaction";
      const isList = isRecord(event) && event.action === "listTransactions";
      const isUpdate = isRecord(event) && event.action === "updateTransaction";
      const isDelete = isRecord(event) && event.action === "deleteTransaction";
      return failureResponse(
        isUpdate
          ? "TRANSACTION_UPDATE_FAILED"
          : isDelete
            ? "TRANSACTION_DELETE_FAILED"
            : isCreate
          ? "TRANSACTION_CREATE_FAILED"
          : isList
            ? "TRANSACTION_LIST_FAILED"
            : "DEPENDENCY_ERROR",
        isUpdate
          ? "账单更新失败，请稍后重试"
          : isDelete
            ? "账单删除失败，请稍后重试"
            : isCreate
          ? "账单保存失败，请稍后重试"
          : isList
            ? "账单流水加载失败，请稍后重试"
            : "记账服务暂时不可用，请稍后重试",
        fallbackRequestId,
        now,
      );
    }
  };
}
