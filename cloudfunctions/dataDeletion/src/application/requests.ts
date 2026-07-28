import type {
  CancelDataDeletionResult,
  DataDeletionRequestSummary,
  GetDataDeletionStatusResult,
  RequestDataDeletionResult,
} from "../../../../shared/types/data-deletion";
import { createDeletionRequestId } from "../domain/ids";
import type {
  DataDeletionRequestRecord,
  DataDeletionStore,
  DeletionUserRecord,
} from "../domain/types";
import { DataDeletionError } from "../domain/types";

export const DATA_DELETION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function toSummary(
  request: DataDeletionRequestRecord,
): DataDeletionRequestSummary {
  return {
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    cooldownEndsAt: request.cooldownEndsAt.toISOString(),
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    processingStartedAt: request.processingStartedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    failedAt: request.failedAt?.toISOString() ?? null,
    canCancel: request.status === "pending",
    version: request.version,
  };
}

async function requireUser(
  openId: string | undefined,
  store: DataDeletionStore,
): Promise<DeletionUserRecord> {
  if (!openId?.trim()) {
    throw new DataDeletionError(
      "UNAUTHENTICATED",
      "无法获取有效的微信用户身份",
    );
  }
  const user = await store.findUserByOpenId(openId);
  if (user === null) {
    throw new DataDeletionError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  }
  if (user.status !== "active" && user.status !== "deletion_pending") {
    throw new DataDeletionError("USER_DISABLED", "当前用户状态不可用");
  }
  return user;
}

export async function getDeletionStatus(options: {
  openId: string | undefined;
  store: DataDeletionStore;
}): Promise<GetDataDeletionStatusResult> {
  const user = await requireUser(options.openId, options.store);
  return options.store.runTransaction(async (transaction) => {
    const request = await transaction.getRequest(user._id);
    return { request: request === null ? null : toSummary(request) };
  });
}

export async function requestDeletion(options: {
  openId: string | undefined;
  requestId: string;
  now: Date;
  store: DataDeletionStore;
}): Promise<RequestDataDeletionResult> {
  const user = await requireUser(options.openId, options.store);
  return options.store.runTransaction(async (transaction) => {
    const currentUser = await transaction.getUser(user._id);
    if (currentUser === null) {
      throw new DataDeletionError("USER_NOT_INITIALIZED", "用户不存在");
    }
    const existing = await transaction.getRequest(user._id);
    if (existing?.status === "pending" || existing?.status === "processing") {
      if (existing.requestId === options.requestId) {
        return { request: toSummary(existing), duplicate: true };
      }
      throw new DataDeletionError(
        "DELETION_REQUEST_ACTIVE",
        "已有生效中的个人数据删除申请",
      );
    }
    if (currentUser.status !== "active") {
      throw new DataDeletionError(
        "DELETION_REQUEST_ACTIVE",
        "个人数据删除申请已生效",
      );
    }
    const request: DataDeletionRequestRecord = {
      _id: createDeletionRequestId(user._id),
      ownerId: user._id,
      requestId: options.requestId,
      status: "pending",
      requestedAt: options.now,
      cooldownEndsAt: new Date(
        options.now.getTime() + DATA_DELETION_COOLDOWN_MS,
      ),
      cancelledAt: null,
      processingStartedAt: null,
      completedAt: null,
      failedAt: null,
      nextRetryAt: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      attempts: 0,
      progress: { collectionIndex: 0, deletedCounts: {} },
      createdAt: existing?.createdAt ?? options.now,
      updatedAt: options.now,
      version: (existing?.version ?? 0) + 1,
    };
    await transaction.setRequest(request);
    await transaction.updateUser({
      ...currentUser,
      status: "deletion_pending",
      updatedAt: options.now,
      version: currentUser.version + 1,
    });
    return { request: toSummary(request), duplicate: false };
  });
}

export async function cancelDeletion(options: {
  openId: string | undefined;
  expectedVersion: number;
  now: Date;
  store: DataDeletionStore;
}): Promise<CancelDataDeletionResult> {
  const user = await requireUser(options.openId, options.store);
  return options.store.runTransaction(async (transaction) => {
    const request = await transaction.getRequest(user._id);
    if (request === null) {
      throw new DataDeletionError(
        "DELETION_REQUEST_NOT_FOUND",
        "没有可撤销的个人数据删除申请",
      );
    }
    if (request.version !== options.expectedVersion) {
      throw new DataDeletionError(
        "VERSION_CONFLICT",
        "删除申请状态已更新，请刷新后重试",
      );
    }
    if (request.status !== "pending") {
      throw new DataDeletionError(
        "DELETION_CANNOT_CANCEL",
        "当前删除申请状态不可撤销",
      );
    }
    const currentUser = await transaction.getUser(user._id);
    if (currentUser === null) {
      throw new DataDeletionError("USER_NOT_INITIALIZED", "用户不存在");
    }
    const cancelled: DataDeletionRequestRecord = {
      ...request,
      status: "cancelled",
      cancelledAt: options.now,
      updatedAt: options.now,
      version: request.version + 1,
    };
    await transaction.setRequest(cancelled);
    await transaction.updateUser({
      ...currentUser,
      status: "active",
      updatedAt: options.now,
      version: currentUser.version + 1,
    });
    return { request: toSummary(cancelled) };
  });
}
