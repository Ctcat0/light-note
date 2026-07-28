import { initializeCloud } from "./services/cloud";
import { initializeCurrentUser } from "./services/user";
import { CLIENT_ERROR_CODES } from "./constants/errors";
import { normalizeError } from "./utils/error";

let appInitializationRequest: Promise<void> | null = null;

App<IAppOption>({
  globalData: {
    cloudReady: false,
    cloudErrorMessage: null,
    userInitializationState: "idle",
    userInitialization: null,
    userInitializationErrorMessage: null,
    userInitializationRequestId: null,
    userInitializationErrorCode: null,
  },

  onLaunch(): void {
    const result = initializeCloud();

    this.globalData.cloudReady = result.ready;
    this.globalData.cloudErrorMessage = result.errorMessage;

    if (result.ready) {
      void this.initializeUser();
      return;
    }

    this.globalData.userInitializationState = "error";
    this.globalData.userInitializationErrorMessage = result.errorMessage;
    this.globalData.userInitializationErrorCode =
      CLIENT_ERROR_CODES.CLOUD_NOT_CONFIGURED;
  },

  async initializeUser(): Promise<void> {
    if (appInitializationRequest !== null) {
      return appInitializationRequest;
    }

    const request = (async (): Promise<void> => {
      this.globalData.userInitializationState = "loading";
      this.globalData.userInitializationErrorMessage = null;
      this.globalData.userInitializationErrorCode = null;

      try {
        const response = await initializeCurrentUser();

        this.globalData.userInitialization = response.data;
        this.globalData.userInitializationRequestId = response.requestId;
        this.globalData.userInitializationState = "ready";
      } catch (error) {
        const normalized = normalizeError(
          error,
          CLIENT_ERROR_CODES.CLOUD_UNAVAILABLE,
          "用户初始化失败，请稍后重试",
        );

        this.globalData.userInitialization = null;
        this.globalData.userInitializationState = "error";
        this.globalData.userInitializationErrorMessage = normalized.message;
        this.globalData.userInitializationRequestId = normalized.requestId;
        this.globalData.userInitializationErrorCode = normalized.code;
      }
    })();

    appInitializationRequest = request;

    try {
      await request;
    } finally {
      if (appInitializationRequest === request) {
        appInitializationRequest = null;
      }
    }
  },

  async retryUserInitialization(): Promise<void> {
    if (this.globalData.userInitializationState === "loading") {
      return;
    }

    await this.initializeUser();
  },
});
