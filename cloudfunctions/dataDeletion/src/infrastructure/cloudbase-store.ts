import type {
  DataDeletionRequestRecord,
  DataDeletionStore,
  DataDeletionTransaction,
  DeletionUserRecord,
} from "../domain/types";
import { createDeletionRequestId } from "../domain/ids";

interface QueryResult {
  data: unknown[];
}

interface DocumentResult {
  data: unknown;
}

interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
}

interface CloudCollection {
  where(query: Record<string, unknown>): CloudCollection;
  limit(limit: number): CloudCollection;
  get(): Promise<QueryResult>;
  doc(id: string): CloudDocument;
}

interface CloudTransaction {
  collection(name: string): CloudCollection;
}

export interface CloudDatabase {
  collection(name: string): CloudCollection;
  runTransaction<T>(
    operation: (transaction: CloudTransaction) => Promise<T>,
    retries?: number,
  ): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissing(error: unknown): boolean {
  const code = isRecord(error) ? error.errCode ?? error.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error)
        ? String(error.errMsg ?? error.message ?? "")
        : "";
  return (
    code === -502005 ||
    code === "-502005" ||
    /document.*(?:not exist|not found)|-502005/iu.test(message)
  );
}

function withoutId<T extends { _id: string }>(
  record: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "_id"),
  );
}

async function getDocument<T>(
  source: CloudTransaction,
  collection: string,
  id: string,
): Promise<T | null> {
  try {
    const data = (await source.collection(collection).doc(id).get()).data;
    if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
    return data === null || data === undefined ? null : (data as T);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function adapter(transaction: CloudTransaction): DataDeletionTransaction {
  return {
    getUser: (id) =>
      getDocument<DeletionUserRecord>(transaction, "users", id),
    updateUser: async (user) => {
      await transaction
        .collection("users")
        .doc(user._id)
        .set({ data: withoutId(user) });
    },
    getRequest: (ownerId) =>
      getDocument<DataDeletionRequestRecord>(
        transaction,
        "data_deletion_requests",
        createDeletionRequestId(ownerId),
      ),
    setRequest: async (request) => {
      await transaction
        .collection("data_deletion_requests")
        .doc(request._id)
        .set({ data: withoutId(request) });
    },
  };
}

export function createCloudBaseDataDeletionStore(
  database: CloudDatabase,
): DataDeletionStore {
  return {
    async findUserByOpenId(openId) {
      const result = await database
        .collection("users")
        .where({ openId })
        .limit(1)
        .get();
      return (result.data[0] as DeletionUserRecord | undefined) ?? null;
    },
    runTransaction: (operation) =>
      database.runTransaction(
        (transaction) => operation(adapter(transaction)),
        3,
      ),
  };
}
