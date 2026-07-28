import type {
  AccountRecord,
  CategoryRecord,
  UserInitializationStore,
  UserInitializationTransaction,
  UserRecord,
  UserSettingsRecord,
} from "../../cloudfunctions/user/src/domain/types";

function cloneMap<TValue>(source: Map<string, TValue>): Map<string, TValue> {
  return new Map(
    [...source.entries()].map(([key, value]) => [
      key,
      { ...value } as TValue,
    ]),
  );
}

export class InMemoryUserInitializationStore
  implements UserInitializationStore, UserInitializationTransaction
{
  readonly users = new Map<string, UserRecord>();
  readonly settings = new Map<string, UserSettingsRecord>();
  readonly categories = new Map<string, CategoryRecord>();
  readonly accounts = new Map<string, AccountRecord>();

  private transactionQueue: Promise<void> = Promise.resolve();
  private nextWriteError: Error | null = null;

  failNextWrite(message = "simulated database failure"): void {
    this.nextWriteError = new Error(message);
  }

  private assertWriteAvailable(): void {
    if (this.nextWriteError === null) {
      return;
    }

    const error = this.nextWriteError;
    this.nextWriteError = null;
    throw error;
  }

  async findUserByOpenId(openId: string): Promise<UserRecord | null> {
    return (
      [...this.users.values()].find((user) => user.openId === openId) ?? null
    );
  }

  runTransaction<T>(
    operation: (transaction: UserInitializationTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.transactionQueue.then(async () => {
      const snapshot = {
        users: cloneMap(this.users),
        settings: cloneMap(this.settings),
        categories: cloneMap(this.categories),
        accounts: cloneMap(this.accounts),
      };

      try {
        return await operation(this);
      } catch (error) {
        this.restore(this.users, snapshot.users);
        this.restore(this.settings, snapshot.settings);
        this.restore(this.categories, snapshot.categories);
        this.restore(this.accounts, snapshot.accounts);
        throw error;
      }
    });

    this.transactionQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  private restore<TValue>(
    target: Map<string, TValue>,
    snapshot: Map<string, TValue>,
  ): void {
    target.clear();
    for (const [key, value] of snapshot) {
      target.set(key, value);
    }
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async createUser(user: UserRecord): Promise<void> {
    this.assertWriteAvailable();
    if (this.users.has(user._id)) {
      throw new Error("duplicate user");
    }
    this.users.set(user._id, user);
  }

  async updateUser(user: UserRecord): Promise<void> {
    this.assertWriteAvailable();
    this.users.set(user._id, user);
  }

  async getSettings(settingsId: string): Promise<UserSettingsRecord | null> {
    return this.settings.get(settingsId) ?? null;
  }

  async createSettings(settings: UserSettingsRecord): Promise<void> {
    this.assertWriteAvailable();
    if (this.settings.has(settings._id)) {
      throw new Error("duplicate settings");
    }
    this.settings.set(settings._id, settings);
  }

  async updateSettings(settings: UserSettingsRecord): Promise<void> {
    this.assertWriteAvailable();
    this.settings.set(settings._id, settings);
  }

  async getCategory(categoryId: string): Promise<CategoryRecord | null> {
    return this.categories.get(categoryId) ?? null;
  }

  async createCategory(category: CategoryRecord): Promise<void> {
    this.assertWriteAvailable();
    if (this.categories.has(category._id)) {
      throw new Error("duplicate category");
    }
    this.categories.set(category._id, category);
  }

  async getAccount(accountId: string): Promise<AccountRecord | null> {
    return this.accounts.get(accountId) ?? null;
  }

  async createAccount(account: AccountRecord): Promise<void> {
    this.assertWriteAvailable();
    if (this.accounts.has(account._id)) {
      throw new Error("duplicate account");
    }
    this.accounts.set(account._id, account);
  }

  getUserRecords(ownerId: string): {
    categories: CategoryRecord[];
    accounts: AccountRecord[];
    settings: UserSettingsRecord;
  } {
    const settings = [...this.settings.values()].find(
      (item) => item.ownerId === ownerId,
    );

    if (settings === undefined) {
      throw new Error("settings not found");
    }

    return {
      categories: [...this.categories.values()].filter(
        (item) => item.ownerId === ownerId,
      ),
      accounts: [...this.accounts.values()].filter(
        (item) => item.ownerId === ownerId,
      ),
      settings,
    };
  }
}
