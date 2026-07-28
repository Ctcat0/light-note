import assert from "node:assert/strict";
import test from "node:test";
import { createDataDeletionHandler } from "../cloudfunctions/dataDeletion/src/application/handler";
import type {
  DataDeletionRequestRecord,
  DataDeletionStore,
  DataDeletionTransaction,
  DeletionUserRecord,
} from "../cloudfunctions/dataDeletion/src/domain/types";

const NOW = new Date("2026-07-28T08:00:00.000Z");
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

class MemoryStore implements DataDeletionStore, DataDeletionTransaction {
  readonly users = new Map<string, DeletionUserRecord>();
  readonly requests = new Map<string, DataDeletionRequestRecord>();

  async findUserByOpenId(openId: string): Promise<DeletionUserRecord | null> {
    return (
      [...this.users.values()].find((user) => user.openId === openId) ?? null
    );
  }

  runTransaction<T>(
    operation: (transaction: DataDeletionTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async getUser(userId: string): Promise<DeletionUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async updateUser(user: DeletionUserRecord): Promise<void> {
    this.users.set(user._id, { ...user });
  }

  async getRequest(
    ownerId: string,
  ): Promise<DataDeletionRequestRecord | null> {
    return this.requests.get(ownerId) ?? null;
  }

  async setRequest(request: DataDeletionRequestRecord): Promise<void> {
    this.requests.set(request.ownerId, { ...request });
  }
}

function fixture(openId = "deletion-openid") {
  const store = new MemoryStore();
  store.users.set("usr_deletion", {
    _id: "usr_deletion",
    openId,
    status: "active",
    updatedAt: NOW,
    version: 1,
  });
  const handler = createDataDeletionHandler({
    getOpenId: () => openId,
    getCurrentTime: () => NOW,
    store,
  });
  return { store, handler };
}

test("删除申请使用可信身份、固定七天冷静期并按 requestId 幂等", async () => {
  const value = fixture();
  const created = await value.handler({
    action: "request",
    requestId: REQUEST_ID,
    payload: {},
  });
  assert.equal(created.success, true);
  if (!created.success || !("duplicate" in created.data)) return;
  assert.equal(created.data.duplicate, false);
  assert.equal(
    new Date(created.data.request.cooldownEndsAt).getTime() - NOW.getTime(),
    7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(value.store.users.get("usr_deletion")?.status, "deletion_pending");

  const duplicate = await value.handler({
    action: "request",
    requestId: REQUEST_ID,
    payload: {},
  });
  assert.equal(duplicate.success, true);
  if (duplicate.success && "duplicate" in duplicate.data) {
    assert.equal(duplicate.data.duplicate, true);
  }

  const conflict = await value.handler({
    action: "request",
    requestId: "30000000-0000-4000-8000-000000000005",
    payload: {},
  });
  assert.equal(conflict.success, false);
  assert.equal(conflict.code, "DELETION_REQUEST_ACTIVE");

  const status = await value.handler({
    action: "getStatus",
    requestId: "30000000-0000-4000-8000-000000000002",
    payload: {},
  });
  assert.equal(status.success, true);
  if (status.success && "request" in status.data) {
    assert.equal(status.data.request?.status, "pending");
  }
});

test("pending 删除申请可按版本撤销并恢复用户状态", async () => {
  const value = fixture();
  const created = await value.handler({
    action: "request",
    requestId: REQUEST_ID,
    payload: {},
  });
  assert.equal(created.success, true);
  if (!created.success || !("duplicate" in created.data)) return;
  const cancelled = await value.handler({
    action: "cancel",
    requestId: "30000000-0000-4000-8000-000000000003",
    payload: { expectedVersion: created.data.request.version },
  });
  assert.equal(cancelled.success, true);
  if (cancelled.success && "request" in cancelled.data) {
    assert.equal(cancelled.data.request?.status, "cancelled");
  }
  assert.equal(value.store.users.get("usr_deletion")?.status, "active");
});

test("身份字段、跨用户状态和非 pending 撤销均被拒绝", async () => {
  const value = fixture();
  const forged = await value.handler({
    action: "getStatus",
    requestId: REQUEST_ID,
    payload: {},
    userId: "usr_other",
  });
  assert.equal(forged.success, false);
  assert.equal(forged.code, "INVALID_ARGUMENT");

  const created = await value.handler({
    action: "request",
    requestId: REQUEST_ID,
    payload: {},
  });
  assert.equal(created.success, true);
  const request = value.store.requests.get("usr_deletion");
  assert.ok(request);
  value.store.requests.set("usr_deletion", {
    ...request,
    status: "processing",
  });
  const blocked = await value.handler({
    action: "cancel",
    requestId: "30000000-0000-4000-8000-000000000004",
    payload: { expectedVersion: request.version },
  });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, "DELETION_CANNOT_CANCEL");
});
