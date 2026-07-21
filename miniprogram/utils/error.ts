import {
  CLIENT_ERROR_CODES,
  DEFAULT_ERROR_MESSAGE,
} from "../constants/errors";
import type { AppErrorCode, ErrorViewModel } from "../types/error";
import { isRecord } from "./record";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly requestId: string | null;

  constructor(
    code: AppErrorCode,
    message: string,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.requestId = requestId;
  }
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (isRecord(error)) {
    const candidate = error.errMsg ?? error.message;

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

export function normalizeError(
  error: unknown,
  fallbackCode: AppErrorCode = CLIENT_ERROR_CODES.UNKNOWN_ERROR,
  fallbackMessage = DEFAULT_ERROR_MESSAGE,
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    fallbackCode,
    readErrorMessage(error) ?? fallbackMessage,
  );
}

export function toErrorViewModel(error: unknown): ErrorViewModel {
  const normalized = normalizeError(error);

  return {
    message: normalized.message,
    requestId: normalized.requestId,
  };
}

