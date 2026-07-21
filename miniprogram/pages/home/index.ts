import { isDevelopmentDiagnosticsEnabled } from "../../config/environment";
import { ledgerService } from "../../services/ledger";
import type { PageViewState } from "../../types/page-state";
import { DEFAULT_TIME_ZONE, formatYearMonthLabel, getYearMonth } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { formatAmountInCents } from "../../utils/money";

interface HomePageData {
  viewState: PageViewState;
  errorMessage: string;
  monthLabel: string;
  monthIncomeDisplay: string;
  monthExpenseDisplay: string;
  monthBalanceDisplay: string;
  requestVersion: number;
  loading: boolean;
  destroyed: boolean;
  diagnosticsEnabled: boolean;
  identityAvailable: boolean;
  userCreated: boolean;
  expenseCategoriesCreated: number;
  incomeCategoriesCreated: number;
  accountsCreated: number;
  defaultAccountConfigured: boolean;
  repeatedInitialization: boolean;
  requestId: string;
  errorCode: string;
}

interface HomePageMethods {
  loadMonthlySummary(): Promise<void>;
  syncInitializationDiagnostic(): void;
  handleRetry(): void;
  handleAddExpense(): void;
  handleAddIncome(): void;
  handleOpenLedger(): void;
}

function emptyAmountDisplay(): string {
  return formatAmountInCents(0);
}

Page<HomePageData, HomePageMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    monthLabel: "本月",
    monthIncomeDisplay: emptyAmountDisplay(),
    monthExpenseDisplay: emptyAmountDisplay(),
    monthBalanceDisplay: emptyAmountDisplay(),
    requestVersion: 0,
    loading: false,
    destroyed: false,
    diagnosticsEnabled: false,
    identityAvailable: false,
    userCreated: false,
    expenseCategoriesCreated: 0,
    incomeCategoriesCreated: 0,
    accountsCreated: 0,
    defaultAccountConfigured: false,
    repeatedInitialization: false,
    requestId: "",
    errorCode: "",
  },

  onLoad(): void {
    this.setData({
      destroyed: false,
      diagnosticsEnabled: isDevelopmentDiagnosticsEnabled(),
    });
  },

  onShow(): void {
    void this.loadMonthlySummary();
  },

  onUnload(): void {
    this.data.destroyed = true;
    this.data.requestVersion += 1;
  },

  async onPullDownRefresh(): Promise<void> {
    try {
      await this.loadMonthlySummary();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadMonthlySummary(): Promise<void> {
    if (this.data.loading) return;
    const requestVersion = this.data.requestVersion + 1;
    this.setData({
      requestVersion,
      loading: true,
      viewState: "loading",
      errorMessage: "",
    });

    try {
      const app = getApp<IAppOption>();
      if (
        app.globalData.userInitializationState !== "ready" ||
        app.globalData.userInitialization === null
      ) {
        await app.initializeUser();
      }
      this.syncInitializationDiagnostic();
      if (
        app.globalData.userInitializationState !== "ready" ||
        app.globalData.userInitialization === null
      ) {
        throw new Error(
          app.globalData.userInitializationErrorMessage ?? "用户初始化失败",
        );
      }

      const timeZone =
        app.globalData.userInitialization.settings.timezone || DEFAULT_TIME_ZONE;
      const month = getYearMonth(new Date(), timeZone);
      const result = await ledgerService.getMonthlySummary(month);
      if (
        this.data.destroyed ||
        this.data.requestVersion !== requestVersion
      ) {
        return;
      }
      if (
        result.summary.year !== month.year ||
        result.summary.month !== month.month
      ) {
        throw new Error("月度收支汇总与当前月份不匹配");
      }
      const hasTransactions =
        result.summary.monthIncomeInCents > 0 ||
        result.summary.monthExpenseInCents > 0;
      this.setData({
        viewState: hasTransactions ? "ready" : "empty",
        errorMessage: "",
        monthLabel: formatYearMonthLabel(month),
        monthIncomeDisplay: formatAmountInCents(
          result.summary.monthIncomeInCents,
        ),
        monthExpenseDisplay: formatAmountInCents(
          result.summary.monthExpenseInCents,
        ),
        monthBalanceDisplay: formatAmountInCents(
          result.summary.monthBalanceInCents,
        ),
        loading: false,
      });
    } catch (error) {
      if (
        this.data.destroyed ||
        this.data.requestVersion !== requestVersion
      ) {
        return;
      }
      const normalized = normalizeError(error);
      this.syncInitializationDiagnostic();
      this.setData({
        viewState: "error",
        errorMessage: normalized.message,
        errorCode: normalized.code,
        requestId: normalized.requestId ?? this.data.requestId,
        loading: false,
      });
    }
  },

  syncInitializationDiagnostic(): void {
    if (!this.data.diagnosticsEnabled) return;
    const globalData = getApp<IAppOption>().globalData;
    const result = globalData.userInitialization;
    if (globalData.userInitializationState !== "ready" || result === null) {
      this.setData({
        identityAvailable: false,
        requestId: globalData.userInitializationRequestId ?? "",
        errorCode: globalData.userInitializationErrorCode ?? "UNKNOWN_ERROR",
      });
      return;
    }
    this.setData({
      identityAvailable: true,
      userCreated: result.initialization.userCreated,
      expenseCategoriesCreated: result.initialization.expenseCategoriesCreated,
      incomeCategoriesCreated: result.initialization.incomeCategoriesCreated,
      accountsCreated: result.initialization.accountsCreated,
      defaultAccountConfigured: result.settings.defaultAccountId !== null,
      repeatedInitialization: result.initialization.repeatedInitialization,
      requestId: globalData.userInitializationRequestId ?? "",
      errorCode: "OK",
    });
  },

  handleRetry(): void {
    void this.loadMonthlySummary();
  },

  handleAddExpense(): void {
    wx.navigateTo({ url: "/pages/transaction-create/index?type=expense" });
  },

  handleAddIncome(): void {
    wx.navigateTo({ url: "/pages/transaction-create/index?type=income" });
  },

  handleOpenLedger(): void {
    wx.switchTab({ url: "/pages/ledger/index" });
  },
});
