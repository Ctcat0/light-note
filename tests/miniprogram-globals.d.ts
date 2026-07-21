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
  showToast(options: { title: string; icon: "success" | "error" | "loading" | "none" }): void;
};
