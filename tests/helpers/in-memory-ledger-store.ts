import type {
  AccountRecord,
  CategoryRecord,
  LedgerStore,
  LedgerTransactionStore,
  TransactionRecord,
  UserRecord,
  UserSettingsRecord,
} from "../../cloudfunctions/ledger/src/domain/types";
import type {
  SupportedTransactionType,
  TransactionListFilter,
} from "../../shared/types/transaction";

function cloneRecord<TValue>(value: TValue): TValue {
  return { ...value } as TValue;
}

export class InMemoryLedgerStore implements LedgerStore, LedgerTransactionStore {
  readonly users = new Map<string, UserRecord>();
  readonly settings = new Map<string, UserSettingsRecord>();
  readonly categories = new Map<string, CategoryRecord>();
  readonly accounts = new Map<string, AccountRecord>();
  readonly transactions = new Map<string, TransactionRecord>();

  private transactionQueue: Promise<void> = Promise.resolve();
  private failWrite = false;
  private failList = false;
  private failSummary = false;

  failNextWrite(): void {
    this.failWrite = true;
  }

  failNextList(): void {
    this.failList = true;
  }

  failNextSummary(): void {
    this.failSummary = true;
  }

  async findUserByOpenId(openId: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.openId === openId) ?? null;
  }

  async getSettingsByOwner(ownerId: string): Promise<UserSettingsRecord | null> {
    return [...this.settings.values()].find((item) => item.ownerId === ownerId) ?? null;
  }

  async listCategories(
    ownerId: string,
    type: SupportedTransactionType,
  ): Promise<CategoryRecord[]> {
    return [...this.categories.values()]
      .filter(
        (item) => item.ownerId === ownerId && item.type === type && item.isEnabled,
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  async listAccounts(ownerId: string): Promise<AccountRecord[]> {
    return [...this.accounts.values()]
      .filter((item) => item.ownerId === ownerId && item.isEnabled)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    return this.transactions.get(transactionId) ?? null;
  }

  async listTransactions(options: {
    ownerId: string;
    filter: TransactionListFilter;
    categoryId: string | null;
    startAt: Date;
    endAt: Date;
    pageSize: number;
    cursor: { occurredAt: Date; transactionId: string } | null;
  }): Promise<TransactionRecord[]> {
    if (this.failList) {
      this.failList = false;
      throw new Error("simulated list failure");
    }
    return [...this.transactions.values()]
      .filter((item) => {
        const occurredAt = item.occurredAt.getTime();
        const inRange =
          item.ownerId === options.ownerId &&
          (options.filter === "all"
            ? item.type === "expense" || item.type === "income"
            : item.type === options.filter) &&
          (options.categoryId === null || item.categoryId === options.categoryId) &&
          !item.isDeleted &&
          occurredAt >= options.startAt.getTime() &&
          occurredAt < options.endAt.getTime();
        if (!inRange || options.cursor === null) return inRange;
        const cursorTime = options.cursor.occurredAt.getTime();
        return (
          occurredAt < cursorTime ||
          (occurredAt === cursorTime && item._id < options.cursor.transactionId)
        );
      })
      .sort((left, right) => {
        const timeDifference =
          right.occurredAt.getTime() - left.occurredAt.getTime();
        return timeDifference !== 0
          ? timeDifference
          : right._id.localeCompare(left._id);
      })
      .slice(0, options.pageSize + 1);
  }

  async sumTransactions(options: {
    ownerId: string;
    type: SupportedTransactionType;
    startAt: Date;
    endAt: Date;
  }): Promise<number> {
    if (this.failSummary) {
      this.failSummary = false;
      throw new Error("simulated summary failure");
    }
    return [...this.transactions.values()]
      .filter(
        (item) =>
          item.ownerId === options.ownerId &&
          item.type === options.type &&
          !item.isDeleted &&
          item.occurredAt >= options.startAt &&
          item.occurredAt < options.endAt,
      )
      .reduce((total, item) => total + item.amountInCents, 0);
  }

  async aggregateTransactions(options: {
    ownerId: string;
    type: SupportedTransactionType;
    startAt: Date;
    endAt: Date;
  }): Promise<{ amountInCents: number; count: number }> {
    const items = this.getAggregateItems(options);
    return {
      amountInCents: items.reduce((total, item) => total + item.amountInCents, 0),
      count: items.length,
    };
  }

  async aggregateTransactionsByCategory(options: {
    ownerId: string;
    type: SupportedTransactionType;
    startAt: Date;
    endAt: Date;
  }): Promise<Array<{ categoryId: string; amountInCents: number; count: number }>> {
    const grouped = new Map<string, { amountInCents: number; count: number }>();
    for (const item of this.getAggregateItems(options)) {
      const current = grouped.get(item.categoryId) ?? { amountInCents: 0, count: 0 };
      current.amountInCents += item.amountInCents;
      current.count += 1;
      grouped.set(item.categoryId, current);
    }
    return [...grouped.entries()].map(([categoryId, value]) => ({
      categoryId,
      ...value,
    }));
  }

  private getAggregateItems(options: {
    ownerId: string;
    type: SupportedTransactionType;
    startAt: Date;
    endAt: Date;
  }): TransactionRecord[] {
    if (this.failSummary) {
      this.failSummary = false;
      throw new Error("simulated summary failure");
    }
    return [...this.transactions.values()].filter(
      (item) =>
        item.ownerId === options.ownerId &&
        item.type === options.type &&
        !item.isDeleted &&
        item.occurredAt >= options.startAt &&
        item.occurredAt < options.endAt,
    );
  }

  async getCategoriesByIds(
    ownerId: string,
    categoryIds: string[],
  ): Promise<CategoryRecord[]> {
    const ids = new Set(categoryIds);
    return [...this.categories.values()].filter(
      (item) => item.ownerId === ownerId && ids.has(item._id),
    );
  }

  async getAccountsByIds(
    ownerId: string,
    accountIds: string[],
  ): Promise<AccountRecord[]> {
    const ids = new Set(accountIds);
    return [...this.accounts.values()].filter(
      (item) => item.ownerId === ownerId && ids.has(item._id),
    );
  }

  runTransaction<T>(
    operation: (transaction: LedgerTransactionStore) => Promise<T>,
  ): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      const snapshot = new Map(
        [...this.transactions.entries()].map(([key, value]) => [
          key,
          cloneRecord(value),
        ]),
      );
      try {
        return await operation(this);
      } catch (error) {
        this.transactions.clear();
        for (const [key, value] of snapshot) this.transactions.set(key, value);
        throw error;
      }
    });
    this.transactionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async createTransaction(transaction: TransactionRecord): Promise<void> {
    if (this.failWrite) {
      this.failWrite = false;
      throw new Error("simulated write failure");
    }
    if (this.transactions.has(transaction._id)) {
      throw new Error("duplicate transaction");
    }
    this.transactions.set(transaction._id, transaction);
  }

  async updateTransaction(transaction: TransactionRecord): Promise<void> {
    if (this.failWrite) {
      this.failWrite = false;
      throw new Error("simulated write failure");
    }
    if (!this.transactions.has(transaction._id)) {
      throw new Error("missing transaction");
    }
    this.transactions.set(transaction._id, cloneRecord(transaction));
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getCategory(categoryId: string): Promise<CategoryRecord | null> {
    return this.categories.get(categoryId) ?? null;
  }

  async getAccount(accountId: string): Promise<AccountRecord | null> {
    return this.accounts.get(accountId) ?? null;
  }

}

export function seedLedgerUser(
  store: InMemoryLedgerStore,
  options: {
    userId?: string;
    openId?: string;
    status?: UserRecord["status"];
  } = {},
): {
  userId: string;
  openId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  disabledCategoryId: string;
  accountId: string;
  disabledAccountId: string;
} {
  const userId = options.userId ?? "usr_owner_a";
  const openId = options.openId ?? "openid-a";
  const now = new Date("2026-07-21T08:00:00.000Z");
  const expenseCategoryId = `${userId}_expense`;
  const incomeCategoryId = `${userId}_income`;
  const disabledCategoryId = `${userId}_disabled_expense`;
  const accountId = `${userId}_account`;
  const disabledAccountId = `${userId}_disabled_account`;

  store.users.set(userId, {
    _id: userId,
    openId,
    status: options.status ?? "active",
  });
  store.settings.set(`${userId}_settings`, {
    _id: `${userId}_settings`,
    ownerId: userId,
    currency: "CNY",
    timezone: "Asia/Shanghai",
    defaultTransactionType: "expense",
    defaultExpenseAccountId: accountId,
    defaultIncomeAccountId: accountId,
    defaultLocation: null,
    preferGeolocation: false,
    showWeather: true,
    showBudget: false,
    theme: "system",
    initializationVersion: 2,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const categoryBase = {
    ownerId: userId,
    systemKey: "test",
    name: "测试分类",
    icon: "test",
    sortOrder: 0,
    isSystem: true,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  store.categories.set(expenseCategoryId, {
    ...categoryBase,
    _id: expenseCategoryId,
    type: "expense",
  });
  store.categories.set(incomeCategoryId, {
    ...categoryBase,
    _id: incomeCategoryId,
    type: "income",
  });
  store.categories.set(disabledCategoryId, {
    ...categoryBase,
    _id: disabledCategoryId,
    type: "expense",
    isEnabled: false,
  });

  const accountBase = {
    ownerId: userId,
    systemKey: "account_test",
    name: "测试账户",
    type: "wechat" as const,
    icon: "wechat",
    sortOrder: 0,
    isSystem: true,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  store.accounts.set(accountId, { ...accountBase, _id: accountId });
  store.accounts.set(disabledAccountId, {
    ...accountBase,
    _id: disabledAccountId,
    isEnabled: false,
  });

  return {
    userId,
    openId,
    expenseCategoryId,
    incomeCategoryId,
    disabledCategoryId,
    accountId,
    disabledAccountId,
  };
}
