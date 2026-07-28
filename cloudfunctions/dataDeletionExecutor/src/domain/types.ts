import type { DataDeletionStatus } from "../../../../shared/types/data-deletion";

export interface ExecutorProgress {
  collectionIndex: number;
  deletedCounts: Record<string, number>;
}

export interface ExecutorRequestRecord {
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
  progress: ExecutorProgress;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface DataDeletionExecutorStore {
  listRunnableRequests(now: Date, limit: number): Promise<ExecutorRequestRecord[]>;
  claimRequest(
    ownerId: string,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<ExecutorRequestRecord | null>;
  saveRequest(request: ExecutorRequestRecord): Promise<void>;
  deleteOwnedBatch(
    collection: string,
    ownerId: string,
    limit: number,
  ): Promise<number>;
  deleteUser(ownerId: string): Promise<void>;
}
