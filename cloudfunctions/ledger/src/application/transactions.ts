import type {
  Account,
  Category,
} from "../../../../shared/types/user";
import type {
  CreateTransactionRequest,
  CreateTransactionResult,
  DeleteTransactionRequest,
  DeleteTransactionResult,
  GetTransactionResult,
  GetMonthlySummaryResult,
  ListTransactionsResult,
  TransactionMonthSummary,
  TransactionCursor,
  TransactionListItem,
  TransactionListFilter,
  Transaction,
  SupportedTransactionType,
  UpdateTransactionRequest,
  UpdateTransactionResult,
} from "../../../../shared/types/transaction";
import { createTransactionId } from "../domain/ids";
import type {
  AccountRecord,
  CategoryRecord,
  LedgerStore,
  TransactionRecord,
  UserRecord,
  UserSettingsRecord,
} from "../domain/types";
import { LedgerError } from "../domain/types";

export const MAX_TRANSACTION_AMOUNT_IN_CENTS = 9_999_999_999;
const MAX_NOTE_LENGTH = 200;
const MAX_FUTURE_OFFSET_MS = 5 * 60 * 1000;
export const DEFAULT_TRANSACTION_PAGE_SIZE = 20;
export const MAX_TRANSACTION_PAGE_SIZE = 50;
const CURSOR_VERSION = 4;

interface CursorPayload {
  version: number;
  year: number;
  month: number;
  filter: TransactionListFilter;
  categoryId: string | null;
  occurredAt: string;
  transactionId: string;
}

function toDate(value: Date): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new LedgerError("INTERNAL_ERROR", "账单时间数据无效");
  }

  return date;
}

function toTransaction(record: TransactionRecord): Transaction {
  return {
    transactionId: record._id,
    type: record.type,
    amountInCents: record.amountInCents,
    categoryId: record.categoryId,
    accountId: record.accountId,
    occurredAt: toDate(record.occurredAt).toISOString(),
    occurredDateKey: record.occurredDateKey,
    merchant: record.merchant,
    note: record.note,
    tags: [...record.tags],
    attachmentUrls: [...record.attachmentUrls],
    includeInBudget: record.includeInBudget,
    status: record.isDeleted ? "deleted" : "active",
    version: record.version,
    createdAt: toDate(record.createdAt).toISOString(),
    updatedAt: toDate(record.updatedAt).toISOString(),
  };
}

export function toAccount(record: AccountRecord, defaultChannelId: string | null): Account {
  return {
    accountId: record._id,
    name: record.name,
    type: record.type,
    icon: record.icon,
    sortOrder: record.sortOrder,
    isDefault: record._id === defaultChannelId,
    isSystem: record.isSystem,
    isEnabled: record.isEnabled,
    version: record.version,
  };
}

function createDateKey(value: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = new Map(
      formatter
        .formatToParts(value)
        .map((part) => [part.type, part.value] as const),
    );
    const year = parts.get("year");
    const month = parts.get("month");
    const day = parts.get("day");

    if (!year || !month || !day) {
      throw new Error("日期字段不完整");
    }

    return `${year}-${month}-${day}`;
  } catch {
    throw new LedgerError("INTERNAL_ERROR", "用户时区配置无效");
  }
}

function getZonedDateTimeParts(value: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = new Map(
      formatter
        .formatToParts(value)
        .map((part) => [part.type, part.value] as const),
    );
    const read = (
      key: "year" | "month" | "day" | "hour" | "minute" | "second",
    ): number => Number(parts.get(key));
    const result = {
      year: read("year"),
      month: read("month"),
      day: read("day"),
      hour: read("hour"),
      minute: read("minute"),
      second: read("second"),
    };
    if (Object.values(result).some((part) => !Number.isInteger(part))) {
      throw new Error("时区日期字段不完整");
    }
    return result;
  } catch {
    throw new LedgerError("INTERNAL_ERROR", "用户时区配置无效");
  }
}

function zonedStartOfDayToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedDateTimeParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate -= represented - desired;
  }
  const result = new Date(candidate);
  const roundTrip = getZonedDateTimeParts(result, timeZone);
  if (
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== 0 ||
    roundTrip.minute !== 0 ||
    roundTrip.second !== 0
  ) {
    throw new LedgerError("INTERNAL_ERROR", "无法计算用户时区月份边界");
  }
  return result;
}

export function getTransactionMonthRange(
  year: number,
  month: number,
  timeZone: string,
): { startAt: Date; endAt: Date } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    startAt: zonedStartOfDayToUtc(year, month, 1, timeZone),
    endAt: zonedStartOfDayToUtc(nextYear, nextMonth, 1, timeZone),
  };
}

function encodeCursor(payload: CursorPayload): TransactionCursor {
  return Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function decodeTransactionCursor(
  cursor: TransactionCursor,
  year: number,
  month: number,
  filter: TransactionListFilter,
  categoryId: string | null,
  range: { startAt: Date; endAt: Date },
): { occurredAt: Date; transactionId: string } {
  if (
    cursor.length === 0 ||
    cursor.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw new LedgerError("INVALID_CURSOR", "分页游标无效");
  }
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed: unknown = JSON.parse(
      Buffer.from(`${normalized}${padding}`, "base64").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("invalid cursor payload");
    }
    const value = parsed as Record<string, unknown>;
    const expectedKeys = [
      "version",
      "year",
      "month",
      "filter",
      "categoryId",
      "occurredAt",
      "transactionId",
    ];
    if (
      Object.keys(value).length !== expectedKeys.length ||
      !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
      value.version !== CURSOR_VERSION ||
      value.year !== year ||
      value.month !== month ||
      value.filter !== filter ||
      value.categoryId !== categoryId ||
      typeof value.occurredAt !== "string" ||
      typeof value.transactionId !== "string" ||
      !/^txn_[0-9a-f]{32}$/.test(value.transactionId)
    ) {
      throw new Error("cursor fields invalid");
    }
    const occurredAt = new Date(value.occurredAt);
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt < range.startAt ||
      occurredAt >= range.endAt
    ) {
      throw new Error("cursor range invalid");
    }
    return { occurredAt, transactionId: value.transactionId };
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("INVALID_CURSOR", "分页游标无效或与月份不匹配");
  }
}

function toTransactionListItem(
  record: TransactionRecord,
  timeZone: string,
  category: CategoryRecord | undefined,
  account: AccountRecord | undefined,
): TransactionListItem {
  return {
    transactionId: record._id,
    type: record.type,
    amountInCents: record.amountInCents,
    categoryId: record.categoryId,
    categoryName: category?.name ?? "未知分类",
    categoryIcon: category?.icon ?? "",
    accountId: record.accountId,
    accountName: account?.name ?? "未知账户",
    accountIcon: account?.icon ?? null,
    occurredAt: toDate(record.occurredAt).toISOString(),
    occurredDateKey: createDateKey(toDate(record.occurredAt), timeZone),
    note: record.note,
    status: "active",
    createdAt: toDate(record.createdAt).toISOString(),
  };
}

function parseOccurredAt(value: string, now: Date): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new LedgerError("INVALID_OCCURRED_AT", "发生时间格式无效");
  }

  const occurredAt = new Date(value);
  if (
    Number.isNaN(occurredAt.getTime()) ||
    occurredAt.getTime() > now.getTime() + MAX_FUTURE_OFFSET_MS
  ) {
    throw new LedgerError(
      "INVALID_OCCURRED_AT",
      "发生时间无效或超过允许的未来时间范围",
    );
  }

  return occurredAt;
}

function validateAmount(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TRANSACTION_AMOUNT_IN_CENTS
  ) {
    throw new LedgerError("INVALID_AMOUNT", "金额必须是允许范围内的正整数分");
  }
}

function normalizeNote(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const note = value.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new LedgerError("NOTE_TOO_LONG", "备注不能超过 200 个字符");
  }

  return note.length === 0 ? null : note;
}

function createMutationFingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertMutationTarget(
  record: TransactionRecord | null,
  ownerId: string,
): TransactionRecord {
  if (record === null || record.ownerId !== ownerId) {
    throw new LedgerError("TRANSACTION_NOT_FOUND", "账单不存在或无权访问");
  }
  if (record.type !== "expense" && record.type !== "income") {
    throw new LedgerError("TRANSACTION_TYPE_INVALID", "账单类型不可修改");
  }
  return record;
}

function assertMutationRequest(
  record: TransactionRecord,
  requestId: string,
  kind: "update" | "delete",
  fingerprint: string,
): boolean {
  if (record.lastMutationRequestId !== requestId) return false;
  if (
    record.lastMutationKind !== kind ||
    record.lastMutationFingerprint !== fingerprint
  ) {
    throw new LedgerError("DUPLICATE_REQUEST", "requestId 已用于其他账单变更");
  }
  return true;
}

function validateCategory(
  category: CategoryRecord | null,
  categoryId: string,
  ownerId: string,
  type: SupportedTransactionType,
): CategoryRecord {
  if (categoryId.trim().length === 0) {
    throw new LedgerError("CATEGORY_REQUIRED", `请选择${type === "expense" ? "支出" : "收入"}分类`);
  }
  if (category === null) {
    throw new LedgerError("CATEGORY_NOT_FOUND", "分类不存在");
  }
  if (category.ownerId !== ownerId) {
    throw new LedgerError("CATEGORY_NOT_OWNED", "不能使用其他用户的分类");
  }
  if (category.type !== type) {
    throw new LedgerError("CATEGORY_TYPE_INVALID", "分类类型与账单类型不匹配");
  }
  if (!category.isEnabled) {
    throw new LedgerError(
      "CATEGORY_DISABLED",
      `该${type === "expense" ? "支出" : "收入"}分类已停用`,
    );
  }

  return category;
}

function validateAccount(
  account: AccountRecord | null,
  accountId: string,
  ownerId: string,
): AccountRecord {
  if (accountId.trim().length === 0) {
    throw new LedgerError("ACCOUNT_REQUIRED", "请选择资金渠道");
  }
  if (account === null) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "资金渠道不存在");
  }
  if (account.ownerId !== ownerId) {
    throw new LedgerError("ACCOUNT_NOT_OWNED", "不能使用其他用户的资金渠道");
  }
  if (!account.isEnabled) {
    throw new LedgerError("ACCOUNT_DISABLED", "该资金渠道已停用");
  }

  return account;
}

export async function resolveLedgerUser(
  openId: string | undefined,
  store: LedgerStore,
): Promise<{ user: UserRecord; settings: UserSettingsRecord }> {
  if (openId === undefined || openId.trim().length === 0) {
    throw new LedgerError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
  }

  const user = await store.findUserByOpenId(openId.trim());
  if (user === null) {
    throw new LedgerError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  }
  if (user.status !== "active") {
    throw new LedgerError("USER_DISABLED", "当前用户状态不可用");
  }

  const settings = await store.getSettingsByOwner(user._id);
  if (settings === null || settings.initializationVersion < 1) {
    throw new LedgerError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  }

  return { user, settings };
}

export async function listCategories(
  ownerId: string,
  type: SupportedTransactionType,
  store: LedgerStore,
): Promise<{ items: Category[] }> {
  const records = await store.listCategories(ownerId, type);

  return {
    items: records.map((record) => ({
      categoryId: record._id,
      type: record.type,
      name: record.name,
      icon: record.icon,
      sortOrder: record.sortOrder,
      isSystem: record.isSystem,
      isEnabled: record.isEnabled,
      version: record.version,
    })),
  };
}

export async function listAccounts(
  ownerId: string,
  defaultChannelId: string | null,
  store: LedgerStore,
): Promise<{ items: Account[] }> {
  const records = await store.listAccounts(ownerId);

  return {
    items: records.map((record) => toAccount(record, defaultChannelId)),
  };
}

export async function createTransaction(options: {
  ownerId: string;
  requestId: string;
  payload: CreateTransactionRequest;
  settings: UserSettingsRecord;
  now: Date;
  store: LedgerStore;
}): Promise<CreateTransactionResult> {
  validateAmount(options.payload.amountInCents);
  if (options.payload.categoryId.trim().length === 0) {
    throw new LedgerError("CATEGORY_REQUIRED", "请选择分类");
  }
  if (options.payload.accountId.trim().length === 0) {
    throw new LedgerError("ACCOUNT_REQUIRED", "请选择账户");
  }
  const occurredAt = parseOccurredAt(options.payload.occurredAt, options.now);
  const note = normalizeNote(options.payload.note);
  const transactionId = createTransactionId(
    options.ownerId,
    options.requestId,
  );
  return options.store.runTransaction(async (transaction) => {
    const currentUser = await transaction.getUser(options.ownerId);
    if (currentUser === null) {
      throw new LedgerError("USER_NOT_INITIALIZED", "请先完成用户初始化");
    }
    if (currentUser.status !== "active") {
      throw new LedgerError("USER_DISABLED", "当前用户状态不可用");
    }

    const existing = await transaction.getTransaction(transactionId);
    if (existing !== null) {
      if (
        existing.ownerId !== options.ownerId ||
        existing.requestId !== options.requestId ||
        existing.type !== options.payload.type ||
        existing.amountInCents !== options.payload.amountInCents ||
        existing.categoryId !== options.payload.categoryId ||
        existing.accountId !== options.payload.accountId ||
        toDate(existing.occurredAt).getTime() !== occurredAt.getTime() ||
        existing.note !== note ||
        existing.merchant !== null ||
        existing.includeInBudget !== (options.payload.type === "expense")
      ) {
        throw new LedgerError(
          "DUPLICATE_REQUEST",
          "requestId 已用于其他账单内容",
        );
      }

      return {
        transaction: toTransaction(existing),
        created: false,
        duplicate: true,
      };
    }

    const [category, account] = await Promise.all([
      transaction.getCategory(options.payload.categoryId),
      transaction.getAccount(options.payload.accountId),
    ]);
    validateCategory(
      category,
      options.payload.categoryId,
      options.ownerId,
      options.payload.type,
    );
    validateAccount(account, options.payload.accountId, options.ownerId);

    const record: TransactionRecord = {
      _id: transactionId,
      ownerId: options.ownerId,
      type: options.payload.type,
      amountInCents: options.payload.amountInCents,
      categoryId: options.payload.categoryId,
      accountId: options.payload.accountId,
      occurredAt,
      occurredDateKey: createDateKey(
        occurredAt,
        options.settings.timezone,
      ),
      merchant: null,
      note,
      tags: [],
      attachmentUrls: [],
      includeInBudget: options.payload.type === "expense",
      requestId: options.requestId,
      isDeleted: false,
      deletedAt: null,
      createdAt: options.now,
      updatedAt: options.now,
      version: 1,
    };
    await transaction.createTransaction(record);

    return {
      transaction: toTransaction(record),
      created: true,
      duplicate: false,
    };
  });
}

export async function getTransactionById(options: {
  transactionId: string;
  ownerId: string;
  store: LedgerStore;
}): Promise<GetTransactionResult> {
  const record = await options.store.getTransaction(options.transactionId);
  if (
    record === null ||
    record.ownerId !== options.ownerId ||
    record.isDeleted
  ) {
    throw new LedgerError("TRANSACTION_NOT_FOUND", "账单不存在或无权访问");
  }

  return { transaction: toTransaction(record) };
}

export async function updateTransaction(options: {
  ownerId: string;
  requestId: string;
  payload: UpdateTransactionRequest;
  settings: UserSettingsRecord;
  now: Date;
  store: LedgerStore;
}): Promise<UpdateTransactionResult> {
  validateAmount(options.payload.amountInCents);
  const occurredAt = parseOccurredAt(options.payload.occurredAt, options.now);
  const note = normalizeNote(options.payload.note);
  const fingerprint = createMutationFingerprint({
    ...options.payload,
    note,
    occurredAt: occurredAt.toISOString(),
  });

  return options.store.runTransaction(async (transaction) => {
    const record = assertMutationTarget(
      await transaction.getTransaction(options.payload.transactionId),
      options.ownerId,
    );
    if (
      assertMutationRequest(
        record,
        options.requestId,
        "update",
        fingerprint,
      )
    ) {
      if (record.isDeleted) {
        throw new LedgerError("TRANSACTION_NOT_FOUND", "账单不存在或无权访问");
      }
      return {
        transaction: toTransaction(record) as UpdateTransactionResult["transaction"],
        updated: true,
        duplicate: true,
        previousOccurredAt: toDate(
          record.lastMutationPreviousOccurredAt ?? record.occurredAt,
        ).toISOString(),
      };
    }
    if (record.isDeleted) {
      throw new LedgerError("TRANSACTION_ALREADY_DELETED", "账单已删除");
    }
    if (record.version !== options.payload.expectedVersion) {
      throw new LedgerError(
        "TRANSACTION_CONFLICT",
        "该账单已在其他位置修改，请重新加载后再试",
      );
    }

    const [category, account] = await Promise.all([
      transaction.getCategory(options.payload.categoryId),
      transaction.getAccount(options.payload.accountId),
    ]);
    validateCategory(
      category,
      options.payload.categoryId,
      options.ownerId,
      record.type,
    );
    validateAccount(account, options.payload.accountId, options.ownerId);

    const previousOccurredAt = toDate(record.occurredAt);
    const updated: TransactionRecord = {
      ...record,
      amountInCents: options.payload.amountInCents,
      categoryId: options.payload.categoryId,
      accountId: options.payload.accountId,
      occurredAt,
      occurredDateKey: createDateKey(occurredAt, options.settings.timezone),
      note,
      updatedAt: options.now,
      version: record.version + 1,
      lastMutationRequestId: options.requestId,
      lastMutationKind: "update",
      lastMutationFingerprint: fingerprint,
      lastMutationPreviousOccurredAt: previousOccurredAt,
    };
    await transaction.updateTransaction(updated);
    return {
      transaction: toTransaction(updated) as UpdateTransactionResult["transaction"],
      updated: true,
      duplicate: false,
      previousOccurredAt: previousOccurredAt.toISOString(),
    };
  });
}

export async function deleteTransaction(options: {
  ownerId: string;
  requestId: string;
  payload: DeleteTransactionRequest;
  now: Date;
  store: LedgerStore;
}): Promise<DeleteTransactionResult> {
  const fingerprint = createMutationFingerprint(options.payload);
  return options.store.runTransaction(async (transaction) => {
    const record = assertMutationTarget(
      await transaction.getTransaction(options.payload.transactionId),
      options.ownerId,
    );
    if (
      assertMutationRequest(
        record,
        options.requestId,
        "delete",
        fingerprint,
      )
    ) {
      return {
        transactionId: record._id,
        deleted: true,
        alreadyDeleted: true,
        previousOccurredAt: toDate(
          record.lastMutationPreviousOccurredAt ?? record.occurredAt,
        ).toISOString(),
        version: record.version,
        updatedAt: toDate(record.updatedAt).toISOString(),
      };
    }
    if (record.isDeleted) {
      throw new LedgerError("TRANSACTION_ALREADY_DELETED", "账单已删除");
    }
    if (record.version !== options.payload.expectedVersion) {
      throw new LedgerError(
        "TRANSACTION_CONFLICT",
        "该账单已在其他位置修改，请重新加载后再试",
      );
    }

    const previousOccurredAt = toDate(record.occurredAt);
    const deleted: TransactionRecord = {
      ...record,
      isDeleted: true,
      deletedAt: options.now,
      updatedAt: options.now,
      version: record.version + 1,
      lastMutationRequestId: options.requestId,
      lastMutationKind: "delete",
      lastMutationFingerprint: fingerprint,
      lastMutationPreviousOccurredAt: previousOccurredAt,
    };
    await transaction.updateTransaction(deleted);
    return {
      transactionId: deleted._id,
      deleted: true,
      alreadyDeleted: false,
      previousOccurredAt: previousOccurredAt.toISOString(),
      version: deleted.version,
      updatedAt: toDate(deleted.updatedAt).toISOString(),
    };
  });
}

async function summarizeTransactionMonth(options: {
  ownerId: string;
  year: number;
  month: number;
  range: { startAt: Date; endAt: Date };
  store: LedgerStore;
}): Promise<TransactionMonthSummary> {
  let monthExpenseInCents: number;
  let monthIncomeInCents: number;
  try {
    [monthExpenseInCents, monthIncomeInCents] = await Promise.all([
      options.store.sumTransactions({
        ownerId: options.ownerId,
        type: "expense",
        startAt: options.range.startAt,
        endAt: options.range.endAt,
      }),
      options.store.sumTransactions({
        ownerId: options.ownerId,
        type: "income",
        startAt: options.range.startAt,
        endAt: options.range.endAt,
      }),
    ]);
  } catch {
    throw new LedgerError(
      "TRANSACTION_SUMMARY_FAILED",
      "月度收支汇总失败，请稍后重试",
    );
  }
  if (
    !Number.isSafeInteger(monthExpenseInCents) ||
    monthExpenseInCents < 0 ||
    !Number.isSafeInteger(monthIncomeInCents) ||
    monthIncomeInCents < 0
  ) {
    throw new LedgerError("TRANSACTION_SUMMARY_FAILED", "月度收支汇总数据无效");
  }
  const monthBalanceInCents = monthIncomeInCents - monthExpenseInCents;
  if (!Number.isSafeInteger(monthBalanceInCents)) {
    throw new LedgerError("TRANSACTION_SUMMARY_FAILED", "月度结余超出安全整数范围");
  }
  return {
    year: options.year,
    month: options.month,
    monthExpenseInCents,
    monthIncomeInCents,
    monthBalanceInCents,
  };
}

export async function getMonthlySummary(options: {
  ownerId: string;
  year: number;
  month: number;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<GetMonthlySummaryResult> {
  const range = getTransactionMonthRange(
    options.year,
    options.month,
    options.settings.timezone,
  );
  return {
    summary: await summarizeTransactionMonth({
      ownerId: options.ownerId,
      year: options.year,
      month: options.month,
      range,
      store: options.store,
    }),
  };
}

export async function listTransactions(options: {
  ownerId: string;
  filter: TransactionListFilter;
  categoryId: string | null;
  year: number;
  month: number;
  pageSize: number;
  cursor: TransactionCursor | null;
  settings: UserSettingsRecord;
  store: LedgerStore;
}): Promise<ListTransactionsResult> {
  const range = getTransactionMonthRange(
    options.year,
    options.month,
    options.settings.timezone,
  );
  const cursor =
    options.cursor === null
      ? null
      : decodeTransactionCursor(
          options.cursor,
          options.year,
          options.month,
          options.filter,
          options.categoryId,
          range,
        );

  let records: TransactionRecord[];
  try {
    records = await options.store.listTransactions({
      ownerId: options.ownerId,
      filter: options.filter,
      categoryId: options.categoryId,
      startAt: range.startAt,
      endAt: range.endAt,
      pageSize: options.pageSize,
      cursor,
    });
  } catch {
    throw new LedgerError(
      "TRANSACTION_LIST_FAILED",
      "账单流水加载失败，请稍后重试",
    );
  }

  const summary = await summarizeTransactionMonth({
    ownerId: options.ownerId,
    year: options.year,
    month: options.month,
    range,
    store: options.store,
  });

  const hasMore = records.length > options.pageSize;
  const pageRecords = records.slice(0, options.pageSize);
  const categoryIds = [...new Set(pageRecords.map((record) => record.categoryId))];
  const accountIds = [...new Set(pageRecords.map((record) => record.accountId))];
  let categories: CategoryRecord[];
  let accounts: AccountRecord[];
  try {
    [categories, accounts] = await Promise.all([
      options.store.getCategoriesByIds(options.ownerId, categoryIds),
      options.store.getAccountsByIds(options.ownerId, accountIds),
    ]);
  } catch {
    throw new LedgerError(
      "TRANSACTION_LIST_FAILED",
      "账单展示信息加载失败，请稍后重试",
    );
  }
  const categoryMap = new Map(categories.map((item) => [item._id, item]));
  const accountMap = new Map(accounts.map((item) => [item._id, item]));
  const last = pageRecords[pageRecords.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({
          version: CURSOR_VERSION,
          year: options.year,
          month: options.month,
          filter: options.filter,
          categoryId: options.categoryId,
          occurredAt: toDate(last.occurredAt).toISOString(),
          transactionId: last._id,
        })
      : null;

  return {
    items: pageRecords.map((record) =>
      toTransactionListItem(
        record,
        options.settings.timezone,
        categoryMap.get(record.categoryId),
        accountMap.get(record.accountId),
      ),
    ),
    pagination: {
      pageSize: options.pageSize,
      nextCursor,
      hasMore,
    },
    summary,
  };
}
import { createHash } from "node:crypto";
