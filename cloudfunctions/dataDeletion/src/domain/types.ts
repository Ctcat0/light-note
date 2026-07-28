import type { ApiErrorCode } from "../../../../shared/types/api";
import type { DataDeletionStatus } from "../../../../shared/types/data-deletion";

export interface DeletionUserRecord {
  _id: string;
  openId: string;
  status: "active" | "disabled" | "deletion_pending" | "deleted";
  updatedAt: Date;
  version: number;
}

export interface DataDeletionProgress {
  collectionIndex: number;
  deletedCounts: Record<string, number>;
}

export interface DataDeletionRequestRecord {
  _id: string;
  ownerId: string;
  requestId: string;
  status: DataDeletionStatus;
  requestedAt: Date;
  cooldownEndsAt: Date;
  cancelledAt: Date | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  nextRetryAt: Date | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  attempts: number;
  progress: DataDeletionProgress;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface DataDeletionTransaction {
  getUser(userId: string): Promise<DeletionUserRecord | null>;
  updateUser(user: DeletionUserRecord): Promise<void>;
  getRequest(ownerId: string): Promise<DataDeletionRequestRecord | null>;
  setRequest(request: DataDeletionRequestRecord): Promise<void>;
}

export interface DataDeletionStore {
  findUserByOpenId(openId: string): Promise<DeletionUserRecord | null>;
  runTransaction<T>(
    operation: (transaction: DataDeletionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class DataDeletionError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "DataDeletionError";
    this.code = code;
  }
}
