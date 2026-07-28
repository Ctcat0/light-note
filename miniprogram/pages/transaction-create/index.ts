import {
  DEFAULT_TIME_ZONE,
  getDateTimeInputValues,
  getYearMonth,
} from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { formatAmountInCents, normalizeYuanInput } from "../../utils/money";
import { createRequestId } from "../../utils/request-id";
import { validateTransactionForm } from "../../utils/transaction-form";
import { ledgerService } from "../../services/ledger";
import { markTransactionListStale } from "../../services/transaction-list-refresh";
import type { Account, Category } from "../../types/user";
import type {
  Transaction,
  TransactionFormErrors,
  TransactionFormState,
  SupportedTransactionType,
} from "../../types/transaction";
import type { PageViewState } from "../../types/page-state";

interface LedgerPageData {
  transactionType: SupportedTransactionType;
  transactionTypeLabel: string;
  viewState: PageViewState;
  errorMessage: string;
  submitting: boolean;
  canSubmit: boolean;
  categories: Category[];
  accounts: Account[];
  categoryIndex: number;
  accountIndex: number;
  form: TransactionFormState;
  formErrors: TransactionFormErrors;
  submitErrorMessage: string;
  successMessage: string;
  savedTransaction: Transaction | null;
  savedAmountDisplay: string;
  noteLength: number;
  timeZone: string;
  destroyed: boolean;
}

interface ValueChangeEvent {
  detail: { value: string };
}

interface TransactionTypeTapEvent {
  currentTarget: { dataset: { type?: string } };
}

interface LedgerPageMethods {
  loadOptions(): Promise<void>;
  syncValidation(form?: TransactionFormState): void;
  updateForm(changes: Partial<TransactionFormState>): void;
  handleTransactionTypeChange(event: TransactionTypeTapEvent): void;
  handleAmountInput(event: ValueChangeEvent): void;
  handleCategoryChange(event: ValueChangeEvent): void;
  handleAccountChange(event: ValueChangeEvent): void;
  handleDateChange(event: ValueChangeEvent): void;
  handleTimeChange(event: ValueChangeEvent): void;
  handleNoteInput(event: ValueChangeEvent): void;
  handleSubmit(): Promise<void>;
  handleRetry(): void;
  handleRetrySubmission(): void;
  handleCreateAnother(): void;
  handleBackToLedger(): void;
}

function createEmptyErrors(): TransactionFormErrors {
  return { amount: "", category: "", account: "", occurredAt: "", note: "" };
}

function createInitialForm(timeZone: string): TransactionFormState {
  const values = getDateTimeInputValues(new Date(), timeZone);
  return {
    amountInput: "",
    categoryId: "",
    accountId: "",
    dateValue: values.dateValue,
    timeValue: values.timeValue,
    note: "",
    requestId: createRequestId(),
  };
}

Page<LedgerPageData, LedgerPageMethods>({
  data: {
    transactionType: "expense",
    transactionTypeLabel: "支出",
    viewState: "loading",
    errorMessage: "",
    submitting: false,
    canSubmit: false,
    categories: [],
    accounts: [],
    categoryIndex: 0,
    accountIndex: 0,
    form: createInitialForm(DEFAULT_TIME_ZONE),
    formErrors: createEmptyErrors(),
    submitErrorMessage: "",
    successMessage: "",
    savedTransaction: null,
    savedAmountDisplay: "",
    noteLength: 0,
    timeZone: DEFAULT_TIME_ZONE,
    destroyed: false,
  },

  onLoad(options: Record<string, string | undefined>): void {
    const settings = getApp<IAppOption>().globalData.userInitialization?.settings;
    const transactionType: SupportedTransactionType =
      options.type === "income" || options.type === "expense"
        ? options.type
        : settings?.defaultTransactionType ?? "expense";
    const transactionTypeLabel = transactionType === "expense" ? "支出" : "收入";
    const timeZone = settings?.timezone ?? DEFAULT_TIME_ZONE;
    this.setData({
      transactionType,
      transactionTypeLabel,
      timeZone,
      form: createInitialForm(timeZone),
      destroyed: false,
    });
    wx.setNavigationBarTitle({ title: `新增${transactionTypeLabel}` });
    void this.loadOptions();
  },

  onUnload(): void {
    this.data.destroyed = true;
  },

  async loadOptions(): Promise<void> {
    this.setData({ viewState: "loading", errorMessage: "" });

    const app = getApp<IAppOption>();
    if (app.globalData.userInitializationState !== "ready") {
      await app.initializeUser();
    }
    if (this.data.destroyed) {
      return;
    }
    if (
      app.globalData.userInitializationState !== "ready" ||
      app.globalData.userInitialization === null
    ) {
      this.setData({
        viewState: "error",
        errorMessage:
          app.globalData.userInitializationErrorMessage ?? "用户初始化失败",
      });
      return;
    }

    const timeZone = app.globalData.userInitialization.settings.timezone;
    if (timeZone !== this.data.timeZone) {
      const values = getDateTimeInputValues(new Date(), timeZone);
      const form = {
        ...this.data.form,
        dateValue: values.dateValue,
        timeValue: values.timeValue,
      };
      this.setData({ timeZone, form });
    }

    const [categoryResult, accountResult] = await Promise.allSettled([
      ledgerService.listCategories(this.data.transactionType),
      ledgerService.listAccounts(this.data.transactionType),
    ]);
    if (this.data.destroyed) {
      return;
    }

    const categories =
      categoryResult.status === "fulfilled"
        ? categoryResult.value.items
        : this.data.categories;
    const accounts =
      accountResult.status === "fulfilled"
        ? accountResult.value.items
        : this.data.accounts;

    if (categoryResult.status === "rejected" || accountResult.status === "rejected") {
      const failed =
        categoryResult.status === "rejected"
          ? categoryResult.reason
          : accountResult.status === "rejected"
            ? accountResult.reason
            : null;
      const error = normalizeError(failed);
      this.setData({
        categories,
        accounts,
        viewState: "error",
        errorMessage: error.message,
      });
      return;
    }

    const currentCategoryIndex = categories.findIndex(
      (item) => item.categoryId === this.data.form.categoryId,
    );
    const defaultAccountIndex = accounts.findIndex((item) => item.isDefault);
    const currentAccountIndex = accounts.findIndex(
      (item) => item.accountId === this.data.form.accountId,
    );
    const categoryIndex = currentCategoryIndex >= 0 ? currentCategoryIndex : 0;
    const accountIndex =
      currentAccountIndex >= 0
        ? currentAccountIndex
        : defaultAccountIndex >= 0
          ? defaultAccountIndex
          : 0;
    const form: TransactionFormState = {
      ...this.data.form,
      categoryId: categories[categoryIndex]?.categoryId ?? "",
      accountId: accounts[accountIndex]?.accountId ?? "",
    };

    this.setData({
      categories,
      accounts,
      categoryIndex,
      accountIndex,
      form,
      viewState: categories.length === 0 || accounts.length === 0 ? "empty" : "ready",
    });
    this.syncValidation(form);
  },

  syncValidation(form?: TransactionFormState): void {
    const currentForm = form ?? this.data.form;
    const result = validateTransactionForm(currentForm, this.data.transactionType, {
      timeZone: this.data.timeZone,
    });
    this.setData({
      canSubmit: result.payload !== null && !this.data.submitting,
      formErrors: result.errors,
    });
  },

  updateForm(changes: Partial<TransactionFormState>): void {
    if (this.data.submitting) {
      return;
    }
    const form: TransactionFormState = {
      ...this.data.form,
      ...changes,
      requestId: createRequestId(),
    };
    this.setData({
      form,
      submitErrorMessage: "",
      successMessage: "",
      savedTransaction: null,
      noteLength: form.note.length,
    });
    this.syncValidation(form);
  },

  handleTransactionTypeChange(event: TransactionTypeTapEvent): void {
    const type = event.currentTarget.dataset.type;
    if (
      (type !== "expense" && type !== "income") ||
      type === this.data.transactionType ||
      this.data.submitting ||
      this.data.viewState === "loading"
    ) {
      return;
    }
    const transactionTypeLabel = type === "expense" ? "支出" : "收入";
    const form: TransactionFormState = {
      ...this.data.form,
      categoryId: "",
      accountId: "",
      requestId: createRequestId(),
    };
    this.setData({
      transactionType: type,
      transactionTypeLabel,
      viewState: "loading",
      categories: [],
      accounts: [],
      categoryIndex: 0,
      accountIndex: 0,
      form,
      formErrors: createEmptyErrors(),
      canSubmit: false,
      submitErrorMessage: "",
      successMessage: "",
      savedTransaction: null,
      savedAmountDisplay: "",
    });
    wx.setNavigationBarTitle({ title: `新增${transactionTypeLabel}` });
    void this.loadOptions();
  },

  handleAmountInput(event: ValueChangeEvent): void {
    const amountInput = normalizeYuanInput(
      event.detail.value,
      this.data.form.amountInput,
    );
    this.updateForm({ amountInput });
  },

  handleCategoryChange(event: ValueChangeEvent): void {
    const index = Number(event.detail.value);
    const category = this.data.categories[index];
    if (category === undefined) return;
    this.setData({ categoryIndex: index });
    this.updateForm({ categoryId: category.categoryId });
  },

  handleAccountChange(event: ValueChangeEvent): void {
    const index = Number(event.detail.value);
    const account = this.data.accounts[index];
    if (account === undefined) return;
    this.setData({ accountIndex: index });
    this.updateForm({ accountId: account.accountId });
  },

  handleDateChange(event: ValueChangeEvent): void {
    this.updateForm({ dateValue: event.detail.value });
  },

  handleTimeChange(event: ValueChangeEvent): void {
    this.updateForm({ timeValue: event.detail.value });
  },

  handleNoteInput(event: ValueChangeEvent): void {
    this.updateForm({ note: event.detail.value });
  },

  async handleSubmit(): Promise<void> {
    if (this.data.submitting) return;
    const validation = validateTransactionForm(this.data.form, this.data.transactionType, {
      timeZone: this.data.timeZone,
    });
    if (validation.payload === null) {
      this.setData({ formErrors: validation.errors, canSubmit: false });
      return;
    }

    const requestId = this.data.form.requestId;
    this.setData({
      submitting: true,
      canSubmit: false,
      submitErrorMessage: "",
      successMessage: "",
    });

    try {
      const created = await ledgerService.createTransaction(
        validation.payload,
        requestId,
      );
      const verified = await ledgerService.getTransaction(
        created.transaction.transactionId,
      );
      if (this.data.destroyed) return;

      const successMessage = created.duplicate
        ? "账单已存在，已确认原记录"
        : `${this.data.transactionTypeLabel}账单保存成功`;
      this.setData({
        submitting: false,
        savedTransaction: verified.transaction,
        savedAmountDisplay: formatAmountInCents(
          verified.transaction.amountInCents,
          { showCurrencySymbol: false },
        ),
        successMessage,
      });
      markTransactionListStale(
        getYearMonth(verified.transaction.occurredAt, this.data.timeZone),
      );
      wx.showToast({
        title: created.duplicate ? "已确认原账单" : "保存成功",
        icon: "success",
      });
    } catch (error) {
      if (this.data.destroyed) return;
      const normalized = normalizeError(error);
      this.setData({
        submitting: false,
        submitErrorMessage: normalized.message,
      });
      this.syncValidation();
    }
  },

  handleRetry(): void {
    void this.loadOptions();
  },

  handleRetrySubmission(): void {
    void this.handleSubmit();
  },

  handleCreateAnother(): void {
    const form = createInitialForm(this.data.timeZone);
    form.categoryId = this.data.categories[this.data.categoryIndex]?.categoryId ?? "";
    form.accountId = this.data.accounts[this.data.accountIndex]?.accountId ?? "";
    this.setData({
      form,
      noteLength: 0,
      successMessage: "",
      submitErrorMessage: "",
      savedTransaction: null,
      savedAmountDisplay: "",
      formErrors: createEmptyErrors(),
    });
    this.syncValidation(form);
  },

  handleBackToLedger(): void {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: "/pages/ledger/index" });
  },
});
