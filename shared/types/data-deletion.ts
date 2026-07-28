export type DataDeletionStatus =
  | "pending"
  | "cancelled"
  | "processing"
  | "completed"
  | "failed";

export interface DataDeletionRequestSummary {
  status: DataDeletionStatus;
  requestedAt: string;
  cooldownEndsAt: string;
  cancelledAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  canCancel: boolean;
  version: number;
}

export type GetDataDeletionStatusPayload = Record<string, never>;

export interface GetDataDeletionStatusResult {
  request: DataDeletionRequestSummary | null;
}

export type RequestDataDeletionPayload = Record<string, never>;

export interface RequestDataDeletionResult {
  request: DataDeletionRequestSummary;
  duplicate: boolean;
}

export interface CancelDataDeletionPayload {
  expectedVersion: number;
}

export interface CancelDataDeletionResult {
  request: DataDeletionRequestSummary;
}
