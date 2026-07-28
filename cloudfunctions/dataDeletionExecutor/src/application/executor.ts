import type { ApiErrorCode, ApiResponse } from "../../../../shared/types/api";
import type {
  DataDeletionExecutorStore,
  ExecutorRequestRecord,
} from "../domain/types";

export const USER_OWNED_COLLECTIONS = [
  "transactions",
  "todos",
  "todo_lists",
  "categories",
  "accounts",
  "user_settings",
] as const;

const LEASE_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export interface ExecutorResult {
  inspected: number;
  claimed: number;
  completed: number;
  failed: number;
}

interface Dependencies {
  expectedToken: string | undefined;
  getCurrentTime(): Date;
  store: DataDeletionExecutorStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  return "DEPENDENCY_ERROR";
}

function failure(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  now: Date,
): ApiResponse<ExecutorResult> {
  return {
    success: false,
    code,
    message,
    data: null,
    requestId,
    serverTime: now.toISOString(),
  };
}

async function processRequest(options: {
  request: ExecutorRequestRecord;
  batchSize: number;
  now: Date;
  store: DataDeletionExecutorStore;
}): Promise<"progressed" | "completed"> {
  const index = options.request.progress.collectionIndex;
  if (index < USER_OWNED_COLLECTIONS.length) {
    const collection = USER_OWNED_COLLECTIONS[index];
    if (collection === undefined) return "progressed";
    const deleted = await options.store.deleteOwnedBatch(
      collection,
      options.request.ownerId,
      options.batchSize,
    );
    const advance = deleted < options.batchSize;
    await options.store.saveRequest({
      ...options.request,
      status: "processing",
      progress: {
        collectionIndex: advance ? index + 1 : index,
        deletedCounts: {
          ...options.request.progress.deletedCounts,
          [collection]:
            (options.request.progress.deletedCounts[collection] ?? 0) + deleted,
        },
      },
      leaseExpiresAt: options.now,
      updatedAt: options.now,
      version: options.request.version + 1,
    });
    return "progressed";
  }

  await options.store.deleteUser(options.request.ownerId);
  await options.store.saveRequest({
    ...options.request,
    status: "completed",
    completedAt: options.now,
    failedAt: null,
    nextRetryAt: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    updatedAt: options.now,
    version: options.request.version + 1,
  });
  return "completed";
}

export function createDataDeletionExecutor(
  dependencies: Dependencies,
): (event: unknown) => Promise<ApiResponse<ExecutorResult>> {
  return async (event) => {
    const now = dependencies.getCurrentTime();
    const requestId = `executor-${now.getTime().toString(36)}`;
    if (
      !isRecord(event) ||
      typeof event.executorToken !== "string" ||
      dependencies.expectedToken === undefined ||
      dependencies.expectedToken.length < 24 ||
      event.executorToken !== dependencies.expectedToken
    ) {
      return failure(
        "DELETION_EXECUTOR_UNAUTHORIZED",
        "删除执行器未授权",
        requestId,
        now,
      );
    }
    const batchSize =
      Number.isSafeInteger(event.batchSize) &&
      Number(event.batchSize) >= 1 &&
      Number(event.batchSize) <= 100
        ? Number(event.batchSize)
        : 50;
    const maxRequests =
      Number.isSafeInteger(event.maxRequests) &&
      Number(event.maxRequests) >= 1 &&
      Number(event.maxRequests) <= 10
        ? Number(event.maxRequests)
        : 5;
    try {
      const candidates = await dependencies.store.listRunnableRequests(
        now,
        maxRequests,
      );
      const result: ExecutorResult = {
        inspected: candidates.length,
        claimed: 0,
        completed: 0,
        failed: 0,
      };
      for (const candidate of candidates) {
        const claimed = await dependencies.store.claimRequest(
          candidate.ownerId,
          now,
          new Date(now.getTime() + LEASE_MS),
        );
        if (claimed === null) continue;
        result.claimed += 1;
        try {
          const outcome = await processRequest({
            request: claimed,
            batchSize,
            now,
            store: dependencies.store,
          });
          if (outcome === "completed") result.completed += 1;
        } catch (error) {
          result.failed += 1;
          await dependencies.store.saveRequest({
            ...claimed,
            status: "failed",
            failedAt: now,
            nextRetryAt: new Date(now.getTime() + RETRY_DELAY_MS),
            leaseExpiresAt: null,
            lastErrorCode: safeCode(error),
            updatedAt: now,
            version: claimed.version + 1,
          });
        }
      }
      return {
        success: true,
        code: "OK",
        message: "删除批处理执行完成",
        data: result,
        requestId,
        serverTime: now.toISOString(),
      };
    } catch {
      return failure(
        "DELETION_EXECUTION_FAILED",
        "删除批处理暂时不可用",
        requestId,
        now,
      );
    }
  };
}
