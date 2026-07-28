import type {
  AccountRecord,
  CategoryTransactionAggregate,
  CategoryRecord,
  LedgerStore,
  LedgerTransactionStore,
  TransactionRecord,
  UserRecord,
  UserSettingsRecord,
} from "../domain/types";
import type {
  SupportedTransactionType,
  TransactionListFilter,
} from "../../../../shared/types/transaction";

interface QueryResult {
  data: unknown[];
}

interface AggregateResult {
  list: unknown[];
}

interface DocumentResult {
  data: unknown;
}

interface CloudQuery {
  where(query: unknown): CloudQuery;
  orderBy(field: string, direction: "asc" | "desc"): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<QueryResult>;
}

interface CloudAggregate {
  match(query: unknown): CloudAggregate;
  group(options: Record<string, unknown>): CloudAggregate;
  end(): Promise<AggregateResult>;
}

interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
  update(options: { data: Record<string, unknown> }): Promise<unknown>;
}

interface CloudCollection extends CloudQuery {
  doc(documentId: string): CloudDocument;
  aggregate(): CloudAggregate;
}

interface CloudTransaction {
  collection(name: string): CloudCollection;
}

export interface CloudDatabase {
  command: {
    and(...conditions: unknown[]): unknown;
    or(...conditions: unknown[]): unknown;
    eq(value: unknown): unknown;
    gte(value: unknown): { and(condition: unknown): unknown };
    in(values: unknown[]): unknown;
    lt(value: unknown): unknown;
    aggregate: { sum(field: string | number): unknown };
  };
  collection(name: string): CloudCollection;
  runTransaction<T>(
    operation: (transaction: CloudTransaction) => Promise<T>,
    retryTimes?: number,
  ): Promise<T>;
}

function createTransactionRangeFilter(
  database: CloudDatabase,
  options: {
    ownerId: string;
    type: SupportedTransactionType;
    startAt: Date;
    endAt: Date;
  },
): Record<string, unknown> {
  return {
    ownerId: options.ownerId,
    type: options.type,
    isDeleted: false,
    occurredAt: database.command
      .gte(options.startAt)
      .and(database.command.lt(options.endAt)),
  };
}

function createTransactionListFilter(
  database: CloudDatabase,
  options: {
    ownerId: string;
    filter: TransactionListFilter;
    categoryId: string | null;
    startAt: Date;
    endAt: Date;
  },
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ownerId: options.ownerId,
    type:
      options.filter === "all"
        ? database.command.in(["expense", "income"])
        : options.filter,
    isDeleted: false,
    occurredAt: database.command
      .gte(options.startAt)
      .and(database.command.lt(options.endAt)),
  };
  if (options.categoryId !== null) filter.categoryId = options.categoryId;
  return filter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingDocumentError(error: unknown): boolean {
  const code = isRecord(error) ? error.errCode ?? error.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof (error.errMsg ?? error.message) === "string"
        ? String(error.errMsg ?? error.message)
        : "";

  return (
    code === -502005 ||
    code === "-502005" ||
    code === "DATABASE_DOCUMENT_NOT_EXIST" ||
    code === "DOCUMENT_NOT_FOUND" ||
    /document.*(?:not exist|not found)|DATABASE_DOCUMENT_NOT_EXIST|-502005/i.test(
      message,
    )
  );
}

function readDocumentData<TRecord>(value: unknown): TRecord | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined ? null : (first as TRecord);
  }

  return value === null || value === undefined ? null : (value as TRecord);
}

function withoutId<TRecord extends { _id: string }>(
  record: TRecord,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "_id"),
  );
}

function chunkValues(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function getDocument<TRecord>(
  collection: CloudCollection,
  documentId: string,
): Promise<TRecord | null> {
  try {
    const result = await collection.doc(documentId).get();
    return readDocumentData<TRecord>(result.data);
  } catch (error) {
    if (isMissingDocumentError(error)) {
      return null;
    }
    throw error;
  }
}

function createTransactionAdapter(
  transaction: CloudTransaction,
): LedgerTransactionStore {
  return {
    getUser: (userId) =>
      getDocument<UserRecord>(transaction.collection("users"), userId),
    getTransaction: (transactionId) =>
      getDocument<TransactionRecord>(
        transaction.collection("transactions"),
        transactionId,
      ),
    async createTransaction(record): Promise<void> {
      await transaction.collection("transactions").doc(record._id).set({
        data: withoutId(record),
      });
    },
    async updateTransaction(record): Promise<void> {
      await transaction.collection("transactions").doc(record._id).update({
        data: withoutId(record),
      });
    },
    getCategory: (categoryId) =>
      getDocument<CategoryRecord>(
        transaction.collection("categories"),
        categoryId,
      ),
    getAccount: (accountId) =>
      getDocument<AccountRecord>(
        transaction.collection("accounts"),
        accountId,
      ),
  };
}

export function createCloudBaseLedgerStore(
  database: CloudDatabase,
): LedgerStore {
  return {
    async findUserByOpenId(openId): Promise<UserRecord | null> {
      const result = await database
        .collection("users")
        .where({ openId })
        .limit(1)
        .get();
      return (result.data[0] as UserRecord | undefined) ?? null;
    },
    async getSettingsByOwner(ownerId): Promise<UserSettingsRecord | null> {
      const result = await database
        .collection("user_settings")
        .where({ ownerId })
        .limit(1)
        .get();
      return (result.data[0] as UserSettingsRecord | undefined) ?? null;
    },
    async listCategories(ownerId, type): Promise<CategoryRecord[]> {
      const result = await database
        .collection("categories")
        .where({ ownerId, type, isEnabled: true })
        .orderBy("sortOrder", "asc")
        .get();
      return result.data as CategoryRecord[];
    },
    async listAccounts(ownerId): Promise<AccountRecord[]> {
      const result = await database
        .collection("accounts")
        .where({ ownerId, isEnabled: true })
        .orderBy("sortOrder", "asc")
        .get();
      return result.data as AccountRecord[];
    },
    getTransaction: (transactionId) =>
      getDocument<TransactionRecord>(
        database.collection("transactions"),
        transactionId,
      ),
    async listTransactions(options): Promise<TransactionRecord[]> {
      const base = createTransactionListFilter(database, options);
      const filter =
        options.cursor === null
          ? base
          : database.command.and(
              base,
              database.command.or(
                { occurredAt: database.command.lt(options.cursor.occurredAt) },
                {
                  occurredAt: database.command.eq(options.cursor.occurredAt),
                  _id: database.command.lt(options.cursor.transactionId),
                },
              ),
            );
      const result = await database
        .collection("transactions")
        .where(filter)
        .orderBy("occurredAt", "desc")
        .orderBy("_id", "desc")
        .limit(options.pageSize + 1)
        .get();
      return result.data as TransactionRecord[];
    },
    async sumTransactions(options): Promise<number> {
      const result = await database
        .collection("transactions")
        .aggregate()
        .match(createTransactionRangeFilter(database, options))
        .group({
          _id: null,
          totalInCents: database.command.aggregate.sum("$amountInCents"),
        })
        .end();
      const first = result.list[0];
      return isRecord(first) &&
        typeof first.totalInCents === "number"
        ? first.totalInCents
        : 0;
    },
    async aggregateTransactions(options) {
      const result = await database
        .collection("transactions")
        .aggregate()
        .match(createTransactionRangeFilter(database, options))
        .group({
          _id: null,
          amountInCents: database.command.aggregate.sum("$amountInCents"),
          count: database.command.aggregate.sum(1),
        })
        .end();
      const first = result.list[0];
      return {
        amountInCents:
          isRecord(first) && typeof first.amountInCents === "number"
            ? first.amountInCents
            : 0,
        count:
          isRecord(first) && typeof first.count === "number"
            ? first.count
            : 0,
      };
    },
    async aggregateTransactionsByCategory(options) {
      const result = await database
        .collection("transactions")
        .aggregate()
        .match(createTransactionRangeFilter(database, options))
        .group({
          _id: "$categoryId",
          amountInCents: database.command.aggregate.sum("$amountInCents"),
          count: database.command.aggregate.sum(1),
        })
        .end();
      return result.list.flatMap((item): CategoryTransactionAggregate[] => {
        if (
          !isRecord(item) ||
          typeof item._id !== "string" ||
          typeof item.amountInCents !== "number" ||
          typeof item.count !== "number"
        ) {
          return [];
        }
        return [{
          categoryId: item._id,
          amountInCents: item.amountInCents,
          count: item.count,
        }];
      });
    },
    async getCategoriesByIds(ownerId, categoryIds): Promise<CategoryRecord[]> {
      if (categoryIds.length === 0) return [];
      const results = await Promise.all(
        chunkValues(categoryIds, 10).map((ids) =>
          database
            .collection("categories")
            .where({ ownerId, _id: database.command.in(ids) })
            .get(),
        ),
      );
      return results.flatMap((result) => result.data as CategoryRecord[]);
    },
    async getAccountsByIds(ownerId, accountIds): Promise<AccountRecord[]> {
      if (accountIds.length === 0) return [];
      const results = await Promise.all(
        chunkValues(accountIds, 10).map((ids) =>
          database
            .collection("accounts")
            .where({ ownerId, _id: database.command.in(ids) })
            .get(),
        ),
      );
      return results.flatMap((result) => result.data as AccountRecord[]);
    },
    runTransaction: <T>(
      operation: (transaction: LedgerTransactionStore) => Promise<T>,
    ): Promise<T> =>
      database.runTransaction(
        (transaction) => operation(createTransactionAdapter(transaction)),
        3,
      ),
  };
}
