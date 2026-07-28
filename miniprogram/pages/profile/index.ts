import { dataDeletionService } from "../../services/data-deletion";
import { clearHomeSnapshot } from "../../services/home";
import { ledgerService } from "../../services/ledger";
import {
  getCurrentUserSettings,
  updateCurrentUserSettings,
} from "../../services/user";
import { clearWeatherLocalCache } from "../../services/weather";
import type { DataDeletionRequestSummary } from "../../types/data-deletion";
import type { PageViewState } from "../../types/page-state";
import type {
  Account,
  UpdateUserSettingsPayload,
  UserSettings,
} from "../../types/user";
import { normalizeError } from "../../utils/error";
import { createRequestId } from "../../utils/request-id";

interface ProfilePageData {
  viewState: PageViewState;
  errorMessage: string;
  settings: UserSettings | null;
  accounts: Account[];
  transactionTypeOptions: string[];
  defaultTransactionTypeIndex: number;
  defaultExpenseAccountIndex: number;
  defaultIncomeAccountIndex: number;
  savingGroup: "" | "ledger" | "weather" | "deletion" | "cache";
  settingsDisabled: boolean;
  deletionRequest: DataDeletionRequestSummary | null;
  deletionStatusText: string;
  deletionSubmitRequestId: string;
  appVersion: string;
}

interface ValueEvent {
  detail: { value: string };
}

interface SwitchEvent {
  detail: { value: boolean };
}

interface ProfilePageMethods {
  loadProfile(): Promise<void>;
  saveSettings(payload: UpdateUserSettingsPayload): Promise<void>;
  handleRetry(): void;
  handleDefaultTypeChange(event: ValueEvent): void;
  handleExpenseAccountChange(event: ValueEvent): void;
  handleIncomeAccountChange(event: ValueEvent): void;
  handlePreferLocationChange(event: SwitchEvent): void;
  handleChooseCity(): void;
  handleClearWeatherCache(): void;
  handleClearLocalCaches(): void;
  handleOpenLegal(event: WechatMiniprogram.TouchEvent): void;
  handleRequestDeletion(): void;
  handleCancelDeletion(): void;
}

function getVersion(): string {
  try {
    const info = wx.getAccountInfoSync();
    return info.miniProgram.version || "开发版";
  } catch {
    return "开发版";
  }
}

function formatDeletionStatus(
  request: DataDeletionRequestSummary | null,
): string {
  if (request === null) return "当前没有个人数据删除申请";
  if (request.status === "pending") {
    const deadline = new Date(request.cooldownEndsAt).toLocaleString("zh-CN", {
      hour12: false,
    });
    return `申请已提交，预计在 ${deadline} 后开始删除；冷静期内可以撤销`;
  }
  if (request.status === "processing") return "正在分批删除个人数据";
  if (request.status === "completed") {
    return "个人数据已删除，再次使用时会重新初始化";
  }
  if (request.status === "failed") {
    return "删除执行暂时失败，后台将在安全间隔后继续重试";
  }
  return "个人数据删除申请已撤销";
}

function isActiveDeletion(
  request: DataDeletionRequestSummary | null,
): boolean {
  return (
    request?.status === "pending" ||
    request?.status === "processing" ||
    request?.status === "failed"
  );
}

Page<ProfilePageData, ProfilePageMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    settings: null,
    accounts: [],
    transactionTypeOptions: ["支出", "收入"],
    defaultTransactionTypeIndex: 0,
    defaultExpenseAccountIndex: 0,
    defaultIncomeAccountIndex: 0,
    savingGroup: "",
    settingsDisabled: false,
    deletionRequest: null,
    deletionStatusText: "正在查询删除申请状态",
    deletionSubmitRequestId: "",
    appVersion: getVersion(),
  },

  onShow(): void {
    void this.loadProfile();
  },

  async loadProfile(): Promise<void> {
    this.setData({ viewState: "loading", errorMessage: "" });
    const app = getApp<IAppOption>();
    if (app.globalData.userInitializationState !== "ready") {
      await app.initializeUser();
    }

    if (
      app.globalData.userInitializationState !== "ready" ||
      app.globalData.userInitialization === null
    ) {
      try {
        const deletion = await dataDeletionService.getStatus();
        if (isActiveDeletion(deletion.request)) {
          this.setData({
            viewState: "ready",
            settings: null,
            accounts: [],
            deletionRequest: deletion.request,
            deletionStatusText: formatDeletionStatus(deletion.request),
            settingsDisabled: true,
          });
          return;
        }
      } catch {
        // 初始化错误仍由统一初始化状态提供用户可理解的原因。
      }
      this.setData({
        viewState: "error",
        errorMessage:
          app.globalData.userInitializationErrorMessage ?? "用户初始化失败",
      });
      return;
    }

    try {
      const [settings, accountsResult, deletion] = await Promise.all([
        getCurrentUserSettings(),
        ledgerService.listAccounts("expense"),
        dataDeletionService.getStatus(),
      ]);
      const accounts = accountsResult.items;
      const expenseIndex = accounts.findIndex(
        (item) => item.accountId === settings.defaultExpenseAccountId,
      );
      const incomeIndex = accounts.findIndex(
        (item) => item.accountId === settings.defaultIncomeAccountId,
      );
      app.globalData.userInitialization.settings = settings;
      this.setData({
        viewState: accounts.length === 0 ? "empty" : "ready",
        settings,
        accounts,
        defaultTransactionTypeIndex:
          settings.defaultTransactionType === "expense" ? 0 : 1,
        defaultExpenseAccountIndex: expenseIndex >= 0 ? expenseIndex : 0,
        defaultIncomeAccountIndex: incomeIndex >= 0 ? incomeIndex : 0,
        deletionRequest: deletion.request,
        deletionStatusText: formatDeletionStatus(deletion.request),
        settingsDisabled: isActiveDeletion(deletion.request),
      });
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage: normalizeError(error).message,
      });
    }
  },

  async saveSettings(payload): Promise<void> {
    if (
      this.data.savingGroup !== "" ||
      this.data.settingsDisabled ||
      this.data.settings === null
    ) {
      return;
    }
    this.setData({ savingGroup: payload.group });
    try {
      const settings = await updateCurrentUserSettings(payload);
      const app = getApp<IAppOption>();
      if (app.globalData.userInitialization !== null) {
        app.globalData.userInitialization.settings = settings;
      }
      this.setData({
        settings,
        defaultTransactionTypeIndex:
          settings.defaultTransactionType === "expense" ? 0 : 1,
      });
      wx.showToast({ title: "设置已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: normalizeError(error).message, icon: "none" });
      await this.loadProfile();
    } finally {
      this.setData({ savingGroup: "" });
    }
  },

  handleRetry(): void {
    void this.loadProfile();
  },

  handleDefaultTypeChange(event): void {
    if (this.data.settings === null) return;
    const value = Number(event.detail.value) === 1 ? "income" : "expense";
    void this.saveSettings({
      expectedVersion: this.data.settings.version,
      group: "ledger",
      changes: { defaultTransactionType: value },
    });
  },

  handleExpenseAccountChange(event): void {
    if (this.data.settings === null) return;
    const index = Number(event.detail.value);
    const account = this.data.accounts[index];
    if (account === undefined) return;
    this.setData({ defaultExpenseAccountIndex: index });
    void this.saveSettings({
      expectedVersion: this.data.settings.version,
      group: "ledger",
      changes: { defaultExpenseAccountId: account.accountId },
    });
  },

  handleIncomeAccountChange(event): void {
    if (this.data.settings === null) return;
    const index = Number(event.detail.value);
    const account = this.data.accounts[index];
    if (account === undefined) return;
    this.setData({ defaultIncomeAccountIndex: index });
    void this.saveSettings({
      expectedVersion: this.data.settings.version,
      group: "ledger",
      changes: { defaultIncomeAccountId: account.accountId },
    });
  },

  handlePreferLocationChange(event): void {
    if (this.data.settings === null) return;
    void this.saveSettings({
      expectedVersion: this.data.settings.version,
      group: "weather",
      changes: { preferGeolocation: event.detail.value },
    });
  },

  handleChooseCity(): void {
    wx.navigateTo({ url: "/pages/weather/index" });
  },

  handleClearWeatherCache(): void {
    clearWeatherLocalCache();
    wx.showToast({ title: "天气缓存已清除", icon: "success" });
  },

  handleClearLocalCaches(): void {
    clearHomeSnapshot();
    clearWeatherLocalCache();
    wx.showToast({ title: "本地缓存已清除", icon: "success" });
  },

  handleOpenLegal(event): void {
    const type = String(event.currentTarget.dataset.type ?? "");
    if (!["privacy", "agreement", "about"].includes(type)) return;
    wx.navigateTo({ url: `/pages/legal/index?type=${type}` });
  },

  handleRequestDeletion(): void {
    if (this.data.savingGroup !== "" || this.data.deletionRequest?.canCancel) {
      return;
    }
    wx.showModal({
      title: "申请删除个人数据",
      content:
        "提交后进入 7 天冷静期。期满后后台会分批删除账单、待办、分类、固定渠道、设置和个人资料。冷静期内可以撤销。",
      confirmText: "确认申请",
      confirmColor: "#b83b3b",
      success: (result) => {
        if (!result.confirm) return;
        const requestId =
          this.data.deletionSubmitRequestId || createRequestId();
        this.setData({
          savingGroup: "deletion",
          deletionSubmitRequestId: requestId,
        });
        void dataDeletionService.request(requestId).then(
          (response) => {
            this.setData({
              savingGroup: "",
              deletionSubmitRequestId: "",
              deletionRequest: response.request,
              deletionStatusText: formatDeletionStatus(response.request),
              settingsDisabled: true,
            });
            wx.showToast({ title: "删除申请已提交", icon: "success" });
          },
          (error: unknown) => {
            this.setData({ savingGroup: "" });
            wx.showToast({
              title: normalizeError(error).message,
              icon: "none",
            });
          },
        );
      },
    });
  },

  handleCancelDeletion(): void {
    const request = this.data.deletionRequest;
    if (
      request === null ||
      !request.canCancel ||
      this.data.savingGroup !== ""
    ) {
      return;
    }
    wx.showModal({
      title: "撤销删除申请",
      content: "撤销后个人数据将继续保留。",
      confirmText: "确认撤销",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ savingGroup: "deletion" });
        void dataDeletionService.cancel(request.version).then(
          (response) => {
            this.setData({
              savingGroup: "",
              deletionRequest: response.request,
              deletionStatusText: formatDeletionStatus(response.request),
              settingsDisabled: false,
            });
            wx.showToast({ title: "申请已撤销", icon: "success" });
            void this.loadProfile();
          },
          (error: unknown) => {
            this.setData({ savingGroup: "" });
            wx.showToast({
              title: normalizeError(error).message,
              icon: "none",
            });
            void this.loadProfile();
          },
        );
      },
    });
  },
});
