interface LegalPageData {
  type: "privacy" | "agreement" | "about";
  title: string;
  version: string;
}

interface LegalPageMethods {
  configure(type: string | undefined): void;
}

function getVersion(): string {
  try {
    return wx.getAccountInfoSync().miniProgram.version || "开发版";
  } catch {
    return "开发版";
  }
}

Page<LegalPageData, LegalPageMethods>({
  data: {
    type: "about",
    title: "关于轻记",
    version: getVersion(),
  },

  onLoad(options: Record<string, string | undefined>): void {
    this.configure(options.type);
  },

  configure(value): void {
    const type =
      value === "privacy" || value === "agreement"
        ? value
        : "about";
    const title =
      type === "privacy"
        ? "隐私政策"
        : type === "agreement"
          ? "用户协议"
          : "关于轻记";
    this.setData({ type, title });
    wx.setNavigationBarTitle({ title });
  },
});
