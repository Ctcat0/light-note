import type { UserInitializationResult } from "./user";
import type { AppErrorCode } from "./error";

type UserInitializationState = "idle" | "loading" | "ready" | "error";

declare global {
  interface IAppOption {
    globalData: {
      cloudReady: boolean;
      cloudErrorMessage: string | null;
      userInitializationState: UserInitializationState;
      userInitialization: UserInitializationResult | null;
      userInitializationErrorMessage: string | null;
      userInitializationRequestId: string | null;
      userInitializationErrorCode: AppErrorCode | null;
    };
    initializeUser(): Promise<void>;
    retryUserInitialization(): Promise<void>;
  }
}

export {};
