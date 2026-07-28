declare const wx: {
  getAccountInfoSync(): {
    miniProgram: {
      envVersion: "develop" | "trial" | "release";
    };
  };
  cloud: {
    init(config: { env: string; traceUser: boolean }): void;
    callFunction(options: {
      name: string;
      data: object;
    }): Promise<{ result?: unknown }>;
  };
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;
  showToast(options: { title: string; icon: "success" | "error" | "loading" | "none" }): void;
};
