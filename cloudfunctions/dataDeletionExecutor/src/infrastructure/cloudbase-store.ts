import type {
  DataDeletionExecutorStore,
  ExecutorRequestRecord,
} from "../domain/types";

interface QueryResult {
  data: unknown[];
}

interface DocumentResult {
  data: unknown;
}

interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
  remove(): Promise<unknown>;
}

interface CloudCollection {
  where(query: unknown): CloudCollection;
  limit(limit: number): CloudCollection;
  get(): Promise<QueryResult>;
  doc(id: string): CloudDocument;
}

interface CloudTransaction {
  collection(name: string): CloudCollection;
}

interface CloudCommand {
  lte(value: unknown): unknown;
  or(...conditions: unknown[]): unknown;
}

export interface CloudDatabase {
  command: CloudCommand;
  collection(name: string): CloudCollection;
  runTransaction<T>(
    operation: (transaction: CloudTransaction) => Promise<T>,
    retries?: number,
  ): Promise<T>;
}

function withoutId<T extends { _id: string }>(
  record: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "_id"),
  );
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

async function readRequest(
  source: CloudTransaction,
  requestId: string,
): Promise<ExecutorRequestRecord | null> {
  try {
    const data = (
      await source
        .collection("data_deletion_requests")
        .doc(requestId)
        .get()
    ).data;
    if (Array.isArray(data)) {
      return (data[0] as ExecutorRequestRecord | undefined) ?? null;
    }
    return data === null || data === undefined
      ? null
      : (data as ExecutorRequestRecord);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function canClaim(request: ExecutorRequestRecord, now: Date): boolean {
  if (
    request.status === "pending" &&
    request.cooldownEndsAt.getTime() <= now.getTime()
  ) {
    return true;
  }
  if (
    request.status === "processing" &&
    request.leaseExpiresAt !== null &&
    request.leaseExpiresAt.getTime() <= now.getTime()
  ) {
    return true;
  }
  return (
    request.status === "failed" &&
    request.nextRetryAt !== null &&
    request.nextRetryAt.getTime() <= now.getTime()
  );
}

export function createCloudBaseDataDeletionExecutorStore(
  database: CloudDatabase,
): DataDeletionExecutorStore {
  const command = database.command;
  return {
    async listRunnableRequests(now, limit) {
      const result = await database
        .collection("data_deletion_requests")
        .where(
          command.or(
            { status: "pending", cooldownEndsAt: command.lte(now) },
            { status: "processing", leaseExpiresAt: command.lte(now) },
            { status: "failed", nextRetryAt: command.lte(now) },
          ),
        )
        .limit(limit)
        .get();
      return result.data as ExecutorRequestRecord[];
    },
    claimRequest(ownerId, now, leaseExpiresAt) {
      return database.runTransaction(async (transaction) => {
        const result = await transaction
          .collection("data_deletion_requests")
          .where({ ownerId })
          .limit(1)
          .get();
        const found = result.data[0] as ExecutorRequestRecord | undefined;
        if (found === undefined) return null;
        const current = await readRequest(transaction, found._id);
        if (current === null || !canClaim(current, now)) return null;
        const claimed: ExecutorRequestRecord = {
          ...current,
          status: "processing",
          processingStartedAt: current.processingStartedAt ?? now,
          failedAt: null,
          nextRetryAt: null,
          leaseExpiresAt,
          lastErrorCode: null,
          attempts: current.attempts + 1,
          updatedAt: now,
          version: current.version + 1,
        };
        await transaction
          .collection("data_deletion_requests")
          .doc(claimed._id)
          .set({ data: withoutId(claimed) });
        return claimed;
      }, 3);
    },
    async saveRequest(request) {
      await database
        .collection("data_deletion_requests")
        .doc(request._id)
        .set({ data: withoutId(request) });
    },
    async deleteOwnedBatch(collection, ownerId, limit) {
      const result = await database
        .collection(collection)
        .where({ ownerId })
        .limit(limit)
        .get();
      await Promise.all(
        result.data.map(async (item) => {
          if (!isRecord(item) || typeof item._id !== "string") return;
          await database.collection(collection).doc(item._id).remove();
        }),
      );
      return result.data.length;
    },
    async deleteUser(ownerId) {
      try {
        await database.collection("users").doc(ownerId).remove();
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
