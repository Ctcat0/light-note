import assert from "node:assert/strict";
import test from "node:test";
import {
  createDataDeletionExecutor,
  USER_OWNED_COLLECTIONS,
} from "../cloudfunctions/dataDeletionExecutor/src/application/executor";
import type {
  DataDeletionExecutorStore,
  ExecutorRequestRecord,
} from "../cloudfunctions/dataDeletionExecutor/src/domain/types";

const TOKEN = "test-executor-token-at-least-24-characters";
const NOW = new Date("2026-08-05T08:00:00.000Z");

function request(ownerId: string, cooldownEndsAt: Date): ExecutorRequestRecord {
  return {
    _id: `del_${ownerId}`,
    ownerId,
    requestId: `request-${ownerId}`,
    status: "pending",
    requestedAt: new Date("2026-07-28T08:00:00.000Z"),
    cooldownEndsAt,
    cancelledAt: null,
    processingStartedAt: null,
    completedAt: null,
    failedAt: null,
    nextRetryAt: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    attempts: 0,
    progress: { collectionIndex: 0, deletedCounts: {} },
    createdAt: new Date("2026-07-28T08:00:00.000Z"),
    updatedAt: new Date("2026-07-28T08:00:00.000Z"),
    version: 1,
  };
}

class ExecutorStore implements DataDeletionExecutorStore {
  readonly requests = new Map<string, ExecutorRequestRecord>();
  readonly users = new Set<string>();
  readonly records = new Map<string, Map<string, { ownerId: string }>>();
  failCollection: string | null = null;

  async listRunnableRequests(
    now: Date,
    limit: number,
  ): Promise<ExecutorRequestRecord[]> {
    return [...this.requests.values()]
      .filter((item) => {
        if (item.status === "pending") {
          return item.cooldownEndsAt.getTime() <= now.getTime();
        }
        if (item.status === "processing") {
          return (
            item.leaseExpiresAt !== null &&
            item.leaseExpiresAt.getTime() <= now.getTime()
          );
        }
        return (
          item.status === "failed" &&
          item.nextRetryAt !== null &&
          item.nextRetryAt.getTime() <= now.getTime()
        );
      })
      .slice(0, limit);
  }

  async claimRequest(
    ownerId: string,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<ExecutorRequestRecord | null> {
    const current = this.requests.get(ownerId);
    if (current === undefined) return null;
    const claimed: ExecutorRequestRecord = {
      ...current,
      status: "processing",
      processingStartedAt: current.processingStartedAt ?? now,
      failedAt: null,
      nextRetryAt: null,
      leaseExpiresAt,
      attempts: current.attempts + 1,
      updatedAt: now,
      version: current.version + 1,
    };
    this.requests.set(ownerId, claimed);
    return claimed;
  }

  async saveRequest(requestValue: ExecutorRequestRecord): Promise<void> {
    this.requests.set(requestValue.ownerId, { ...requestValue });
  }

  async deleteOwnedBatch(
    collection: string,
    ownerId: string,
    limit: number,
  ): Promise<number> {
    if (this.failCollection === collection) {
      this.failCollection = null;
      throw Object.assign(new Error("simulated failure"), {
        code: "TEMPORARY_FAILURE",
      });
    }
    const records = this.records.get(collection);
    if (records === undefined) return 0;
    const targets = [...records.entries()]
      .filter(([, value]) => value.ownerId === ownerId)
      .slice(0, limit);
    for (const [id] of targets) records.delete(id);
    return targets.length;
  }

  async deleteUser(ownerId: string): Promise<void> {
    this.users.delete(ownerId);
  }

  seed(ownerId: string, otherOwnerId: string): void {
    this.users.add(ownerId);
    this.users.add(otherOwnerId);
    for (const collection of USER_OWNED_COLLECTIONS) {
      this.records.set(
        collection,
        new Map([
          [`${ownerId}-1`, { ownerId }],
          [`${ownerId}-2`, { ownerId }],
          [`${otherOwnerId}-1`, { ownerId: otherOwnerId }],
        ]),
      );
    }
  }
}

test("删除执行器拒绝普通前端调用", async () => {
  const store = new ExecutorStore();
  const executor = createDataDeletionExecutor({
    expectedToken: TOKEN,
    getCurrentTime: () => NOW,
    store,
  });
  const response = await executor({});
  assert.equal(response.success, false);
  assert.equal(response.code, "DELETION_EXECUTOR_UNAUTHORIZED");
});

test("执行器仅处理冷静期结束申请，分批隔离删除并可重复安全执行", async () => {
  const store = new ExecutorStore();
  store.seed("usr_a", "usr_b");
  store.requests.set(
    "usr_a",
    request("usr_a", new Date("2026-08-04T08:00:00.000Z")),
  );
  store.requests.set(
    "usr_b",
    request("usr_b", new Date("2026-08-12T08:00:00.000Z")),
  );
  const executor = createDataDeletionExecutor({
    expectedToken: TOKEN,
    getCurrentTime: () => NOW,
    store,
  });

  for (let index = 0; index < USER_OWNED_COLLECTIONS.length + 1; index += 1) {
    const response = await executor({
      executorToken: TOKEN,
      batchSize: 50,
      maxRequests: 5,
    });
    assert.equal(response.success, true);
  }

  assert.equal(store.requests.get("usr_a")?.status, "completed");
  assert.equal(store.requests.get("usr_b")?.status, "pending");
  assert.equal(store.users.has("usr_a"), false);
  assert.equal(store.users.has("usr_b"), true);
  for (const records of store.records.values()) {
    assert.equal(
      [...records.values()].some((item) => item.ownerId === "usr_a"),
      false,
    );
    assert.equal(
      [...records.values()].some((item) => item.ownerId === "usr_b"),
      true,
    );
  }
  const repeated = await executor({
    executorToken: TOKEN,
    batchSize: 50,
  });
  assert.equal(repeated.success, true);
  if (repeated.success) assert.equal(repeated.data.claimed, 0);
});

test("批次失败保存安全错误和进度，重试后从原集合恢复", async () => {
  let now = NOW;
  const store = new ExecutorStore();
  store.seed("usr_a", "usr_b");
  store.requests.set(
    "usr_a",
    request("usr_a", new Date("2026-08-04T08:00:00.000Z")),
  );
  store.failCollection = "transactions";
  const executor = createDataDeletionExecutor({
    expectedToken: TOKEN,
    getCurrentTime: () => now,
    store,
  });
  const failed = await executor({ executorToken: TOKEN });
  assert.equal(failed.success, true);
  assert.equal(store.requests.get("usr_a")?.status, "failed");
  assert.equal(
    store.requests.get("usr_a")?.lastErrorCode,
    "TEMPORARY_FAILURE",
  );
  assert.equal(store.requests.get("usr_a")?.progress.collectionIndex, 0);

  now = new Date(NOW.getTime() + 6 * 60 * 1000);
  const retried = await executor({ executorToken: TOKEN });
  assert.equal(retried.success, true);
  assert.equal(store.requests.get("usr_a")?.status, "processing");
  assert.equal(store.requests.get("usr_a")?.progress.collectionIndex, 1);
});
