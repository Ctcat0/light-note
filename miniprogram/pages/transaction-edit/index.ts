import { ledgerService } from "../../services/ledger";
import { markTransactionListStale } from "../../services/transaction-list-refresh";
import type { PageViewState } from "../../types/page-state";
import type { Account, Category } from "../../types/user";
import type {
  Transaction,
  TransactionFormErrors,
  TransactionFormState,
} from "../../types/transaction";
import { DEFAULT_TIME_ZONE, getYearMonth } from "../../utils/date";
import { AppError, normalizeError } from "../../utils/error";
import { createRequestId } from "../../utils/request-id";
import {
  createTransactionEditForm,
  createUpdateTransactionPayload,
  isTransactionDirty,
} from "../../utils/transaction-edit";
import { validateTransactionForm } from "../../utils/transaction-form";
import { normalizeYuanInput } from "../../utils/money";

interface EditPageData {
  transactionTypeLabel: string;
  viewState: PageViewState;
  transactionId: string;
  transaction: Transaction | null;
  categories: Category[];
  accounts: Account[];
  categoryIndex: number;
  accountIndex: number;
  form: TransactionFormState;
  formErrors: TransactionFormErrors;
  timeZone: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  deleting: boolean;
  errorMessage: string;
  mutationErrorMessage: string;
  conflict: boolean;
  deleteRequestId: string;
  noteLength: number;
  destroyed: boolean;
}

interface ValueChangeEvent { detail: { value: string } }

interface EditPageMethods {
  loadDetail(): Promise<void>;
  syncValidation(form: TransactionFormState): void;
  updateForm(changes: Partial<TransactionFormState>): void;
  handleAmountInput(event: ValueChangeEvent): void;
  handleCategoryChange(event: ValueChangeEvent): void;
  handleAccountChange(event: ValueChangeEvent): void;
  handleDateChange(event: ValueChangeEvent): void;
  handleTimeChange(event: ValueChangeEvent): void;
  handleNoteInput(event: ValueChangeEvent): void;
  handleSave(): Promise<void>;
  handleDelete(): Promise<void>;
  handleRetry(): void;
  handleReload(): void;
  enableLeaveAlert(): void;
  disableLeaveAlert(): void;
  returnToLedger(): void;
}

function emptyErrors(): TransactionFormErrors {
  return { amount: "", category: "", account: "", occurredAt: "", note: "" };
}

function emptyForm(): TransactionFormState {
  return {
    amountInput: "",
    categoryId: "",
    accountId: "",
    dateValue: "",
    timeValue: "",
    note: "",
    requestId: createRequestId(),
  };
}

Page<EditPageData, EditPageMethods>({
  data: {
    transactionTypeLabel: "支出",
    viewState: "loading",
    transactionId: "",
    transaction: null,
    categories: [],
    accounts: [],
    categoryIndex: 0,
    accountIndex: 0,
    form: emptyForm(),
    formErrors: emptyErrors(),
    timeZone: DEFAULT_TIME_ZONE,
    dirty: false,
    canSave: false,
    saving: false,
    deleting: false,
    errorMessage: "",
    mutationErrorMessage: "",
    conflict: false,
    deleteRequestId: createRequestId(),
    noteLength: 0,
    destroyed: false,
  },

  onLoad(options: Record<string, string | undefined>): void {
    const transactionId = options.transactionId;
    if (typeof transactionId !== "string" || transactionId.length === 0) {
      this.setData({ viewState: "error", errorMessage: "账单 ID 无效" });
      return;
    }
    this.setData({ transactionId, destroyed: false });
    void this.loadDetail();
  },

  onUnload(): void {
    this.data.destroyed = true;
  },

  async loadDetail(): Promise<void> {
    this.setData({ viewState: "loading", errorMessage: "", mutationErrorMessage: "" });
    try {
      const app = getApp<IAppOption>();
      if (app.globalData.userInitializationState !== "ready") await app.initializeUser();
      if (app.globalData.userInitializationState !== "ready" || app.globalData.userInitialization === null) {
        throw new Error(app.globalData.userInitializationErrorMessage ?? "用户初始化失败");
      }
      const timeZone = app.globalData.userInitialization.settings.timezone;
      const detail = await ledgerService.getTransaction(this.data.transactionId);
      if (this.data.destroyed) return;
      if (detail.transaction.status !== "active") {
        throw new Error("该账单不可编辑");
      }
      const [categoryResult, accountResult] = await Promise.all([
        ledgerService.listCategories(detail.transaction.type),
        ledgerService.listAccounts(),
      ]);
      if (this.data.destroyed) return;
      const transactionTypeLabel =
        detail.transaction.type === "expense" ? "支出" : "收入";
      wx.setNavigationBarTitle({ title: `编辑${transactionTypeLabel}` });
      const categories = categoryResult.items;
      const accounts = accountResult.items;
      const categoryIndex = categories.findIndex((item) => item.categoryId === detail.transaction.categoryId);
      const accountIndex = accounts.findIndex((item) => item.accountId === detail.transaction.accountId);
      const form = createTransactionEditForm(detail.transaction, timeZone, createRequestId());
      this.disableLeaveAlert();
      this.setData({
        viewState: "ready",
        transactionTypeLabel,
        transaction: { ...detail.transaction },
        categories,
        accounts,
        categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
        accountIndex: accountIndex >= 0 ? accountIndex : 0,
        form,
        formErrors: emptyErrors(),
        timeZone,
        dirty: false,
        canSave: false,
        saving: false,
        deleting: false,
        conflict: false,
        deleteRequestId: createRequestId(),
        noteLength: form.note.length,
      });
    } catch (error) {
      if (this.data.destroyed) return;
      this.setData({ viewState: "error", errorMessage: normalizeError(error).message });
    }
  },

  syncValidation(form: TransactionFormState): void {
    const transaction = this.data.transaction;
    const validation = validateTransactionForm(
      form,
      transaction?.type ?? "expense",
      { timeZone: this.data.timeZone },
    );
    const payload = transaction === null ? null : createUpdateTransactionPayload(form, transaction, this.data.timeZone);
    const dirty = transaction !== null && isTransactionDirty(payload, transaction);
    if (dirty) this.enableLeaveAlert(); else this.disableLeaveAlert();
    this.setData({
      formErrors: validation.errors,
      dirty,
      canSave: payload !== null && dirty && !this.data.saving && !this.data.deleting,
    });
  },

  updateForm(changes: Partial<TransactionFormState>): void {
    if (this.data.saving || this.data.deleting) return;
    const form = { ...this.data.form, ...changes, requestId: createRequestId() };
    this.setData({ form, mutationErrorMessage: "", conflict: false, noteLength: form.note.length });
    this.syncValidation(form);
  },

  handleAmountInput(event: ValueChangeEvent): void {
    this.updateForm({ amountInput: normalizeYuanInput(event.detail.value, this.data.form.amountInput) });
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
  handleDateChange(event: ValueChangeEvent): void { this.updateForm({ dateValue: event.detail.value }); },
  handleTimeChange(event: ValueChangeEvent): void { this.updateForm({ timeValue: event.detail.value }); },
  handleNoteInput(event: ValueChangeEvent): void { this.updateForm({ note: event.detail.value }); },

  async handleSave(): Promise<void> {
    if (this.data.saving || this.data.deleting || this.data.transaction === null) return;
    const payload = createUpdateTransactionPayload(this.data.form, this.data.transaction, this.data.timeZone);
    if (payload === null || !isTransactionDirty(payload, this.data.transaction)) {
      this.syncValidation(this.data.form);
      return;
    }
    this.setData({ saving: true, canSave: false, mutationErrorMessage: "", conflict: false });
    try {
      const result = await ledgerService.updateTransaction(payload, this.data.form.requestId);
      if (this.data.destroyed) return;
      const originalMonth = getYearMonth(result.previousOccurredAt, this.data.timeZone);
      const currentMonth = getYearMonth(result.transaction.occurredAt, this.data.timeZone);
      markTransactionListStale(originalMonth, [currentMonth]);
      this.disableLeaveAlert();
      wx.showToast({ title: result.duplicate ? "修改已确认" : "修改成功", icon: "success" });
      this.returnToLedger();
    } catch (error) {
      if (this.data.destroyed) return;
      const normalized = normalizeError(error);
      this.setData({
        saving: false,
        mutationErrorMessage: normalized.message,
        conflict: normalized instanceof AppError && normalized.code === "TRANSACTION_CONFLICT",
      });
      this.syncValidation(this.data.form);
    }
  },

  async handleDelete(): Promise<void> {
    if (this.data.saving || this.data.deleting || this.data.transaction === null) return;
    const confirmation = await wx.showModal({
      title: `删除${this.data.transactionTypeLabel}账单`,
      content: "删除后该账单将不再计入流水和统计，确定删除吗？",
      confirmText: "删除",
      confirmColor: "#b34040",
    });
    if (!confirmation.confirm || this.data.transaction === null) return;
    this.setData({ deleting: true, canSave: false, mutationErrorMessage: "", conflict: false });
    try {
      const result = await ledgerService.deleteTransaction(
        { transactionId: this.data.transaction.transactionId, expectedVersion: this.data.transaction.version },
        this.data.deleteRequestId,
      );
      if (this.data.destroyed) return;
      markTransactionListStale(getYearMonth(result.previousOccurredAt, this.data.timeZone));
      this.disableLeaveAlert();
      wx.showToast({ title: "删除成功", icon: "success" });
      this.returnToLedger();
    } catch (error) {
      if (this.data.destroyed) return;
      const normalized = normalizeError(error);
      this.setData({
        deleting: false,
        mutationErrorMessage: normalized.message,
        conflict: normalized instanceof AppError && normalized.code === "TRANSACTION_CONFLICT",
      });
      this.syncValidation(this.data.form);
    }
  },

  handleRetry(): void { void this.loadDetail(); },
  handleReload(): void {
    if (!this.data.dirty) { void this.loadDetail(); return; }
    void wx.showModal({ title: "重新加载账单？", content: "当前未保存的修改将丢失。", confirmText: "重新加载" })
      .then((result) => { if (result.confirm) void this.loadDetail(); });
  },
  enableLeaveAlert(): void { wx.enableAlertBeforeUnload({ message: "修改尚未保存，确定离开吗？" }); },
  disableLeaveAlert(): void { wx.disableAlertBeforeUnload(); },
  returnToLedger(): void {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/ledger/index" });
  },
});
