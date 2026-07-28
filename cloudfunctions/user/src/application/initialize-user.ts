import type { UserInitializationResult } from "../../../../shared/types/user";
import {
  createAccountId,
  createCategoryId,
  createSettingsId,
  createUserId,
} from "../domain/ids";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "../domain/templates";
import type {
  AccountRecord,
  CategoryRecord,
  UserInitializationStore,
  UserInitializationTransaction,
  UserRecord,
  UserSettingsRecord,
} from "../domain/types";
import { UserInitializationError } from "../domain/types";

const INITIALIZATION_VERSION = 2;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface InitializeUserOptions {
  openId: string;
  now: Date;
  store: UserInitializationStore;
}

interface InitializedDefaults {
  expenseCategoriesCreated: number;
  incomeCategoriesCreated: number;
  accountsCreated: number;
  accounts: AccountRecord[];
}

function createUserRecord(openId: string, now: Date): UserRecord {
  return {
    _id: createUserId(openId),
    openId,
    nickname: null,
    avatarUrl: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    version: 1,
  };
}

async function ensureUser(
  transaction: UserInitializationTransaction,
  userId: string,
  openId: string,
  now: Date,
): Promise<{ user: UserRecord; created: boolean }> {
  const existing = await transaction.getUser(userId);

  if (existing === null) {
    const user = createUserRecord(openId, now);
    await transaction.createUser(user);

    return { user, created: true };
  }

  if (existing.openId !== openId) {
    throw new UserInitializationError(
      "INTERNAL_ERROR",
      "用户身份初始化失败",
    );
  }

  if (existing.status !== "active") {
    throw new UserInitializationError(
      "USER_DISABLED",
      "当前用户状态不可用",
    );
  }

  const user: UserRecord = {
    ...existing,
    updatedAt: now,
    lastLoginAt: now,
    version: existing.version + 1,
  };
  await transaction.updateUser(user);

  return { user, created: false };
}

function createCategoryRecord(
  ownerId: string,
  template: (typeof DEFAULT_EXPENSE_CATEGORIES)[number] |
    (typeof DEFAULT_INCOME_CATEGORIES)[number],
  now: Date,
): CategoryRecord {
  return {
    _id: createCategoryId(ownerId, template.type, template.systemKey),
    ownerId,
    type: template.type,
    systemKey: template.systemKey,
    name: template.name,
    icon: template.icon,
    sortOrder: template.sortOrder,
    isSystem: true,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function ensureCategories(
  transaction: UserInitializationTransaction,
  ownerId: string,
  now: Date,
): Promise<{ expenseCreated: number; incomeCreated: number }> {
  let expenseCreated = 0;
  let incomeCreated = 0;

  for (const template of [
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...DEFAULT_INCOME_CATEGORIES,
  ]) {
    const category = createCategoryRecord(ownerId, template, now);
    const existing = await transaction.getCategory(category._id);

    if (existing !== null) {
      if (
        existing.ownerId !== ownerId ||
        existing.systemKey !== template.systemKey ||
        existing.type !== template.type
      ) {
        throw new UserInitializationError(
          "DEPENDENCY_ERROR",
          "默认分类数据不一致",
        );
      }

      continue;
    }

    await transaction.createCategory(category);
    if (template.type === "expense") {
      expenseCreated += 1;
    } else {
      incomeCreated += 1;
    }
  }

  return { expenseCreated, incomeCreated };
}

function createAccountRecord(
  ownerId: string,
  template: (typeof DEFAULT_ACCOUNTS)[number],
  now: Date,
): AccountRecord {
  return {
    _id: createAccountId(ownerId, template.systemKey),
    ownerId,
    systemKey: template.systemKey,
    name: template.name,
    type: template.type,
    icon: template.icon,
    sortOrder: template.sortOrder,
    isSystem: true,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function ensureAccounts(
  transaction: UserInitializationTransaction,
  ownerId: string,
  now: Date,
): Promise<{ created: number; accounts: AccountRecord[] }> {
  let created = 0;
  const accounts: AccountRecord[] = [];

  for (const template of DEFAULT_ACCOUNTS) {
    const account = createAccountRecord(ownerId, template, now);
    const existing = await transaction.getAccount(account._id);

    if (existing !== null) {
      if (
        existing.ownerId !== ownerId ||
        existing.systemKey !== template.systemKey
      ) {
        throw new UserInitializationError(
          "DEPENDENCY_ERROR",
          "固定渠道数据不一致",
        );
      }

      accounts.push(existing);
      continue;
    }

    await transaction.createAccount(account);
    accounts.push(account);
    created += 1;
  }

  return { created, accounts };
}

function chooseInitialDefaultAccount(accounts: AccountRecord[]): AccountRecord {
  const enabledWechat = accounts.find(
    (account) => account.systemKey === "account_wechat" && account.isEnabled,
  );
  const fallback = accounts.find((account) => account.isEnabled);
  const selected = enabledWechat ?? fallback;

  if (selected === undefined) {
    throw new UserInitializationError(
      "DEPENDENCY_ERROR",
      "没有可用的固定支付/收款渠道",
    );
  }

  return selected;
}

async function validateExistingDefaultChannel(
  transaction: UserInitializationTransaction,
  ownerId: string,
  accountId: string,
): Promise<void> {
  const account = await transaction.getAccount(accountId);

  if (account === null || account.ownerId !== ownerId || !account.isEnabled) {
    throw new UserInitializationError(
      "DEPENDENCY_ERROR",
      "默认资金渠道校验失败",
    );
  }
}

function createSettingsRecord(
  ownerId: string,
  defaultAccountId: string,
  now: Date,
): UserSettingsRecord {
  return {
    _id: createSettingsId(ownerId),
    ownerId,
    currency: "CNY",
    timezone: DEFAULT_TIMEZONE,
    defaultTransactionType: "expense",
    defaultExpenseAccountId: defaultAccountId,
    defaultIncomeAccountId: defaultAccountId,
    defaultLocation: null,
    preferGeolocation: false,
    showWeather: true,
    showBudget: false,
    theme: "system",
    initializationVersion: INITIALIZATION_VERSION,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function ensureSettings(
  transaction: UserInitializationTransaction,
  ownerId: string,
  accounts: AccountRecord[],
  now: Date,
): Promise<UserSettingsRecord> {
  const settingsId = createSettingsId(ownerId);
  const existing = await transaction.getSettings(settingsId);

  if (existing === null) {
    const defaultAccount = chooseInitialDefaultAccount(accounts);
    const settings = createSettingsRecord(ownerId, defaultAccount._id, now);
    await transaction.createSettings(settings);

    return settings;
  }

  if (existing.ownerId !== ownerId) {
    throw new UserInitializationError(
      "DEPENDENCY_ERROR",
      "用户设置归属校验失败",
    );
  }

  if (
    existing.initializationVersion >= INITIALIZATION_VERSION &&
    existing.defaultExpenseAccountId &&
    existing.defaultIncomeAccountId
  ) {
    await validateExistingDefaultChannel(
      transaction,
      ownerId,
      existing.defaultExpenseAccountId,
    );
    await validateExistingDefaultChannel(
      transaction,
      ownerId,
      existing.defaultIncomeAccountId,
    );
    return existing;
  }

  const fallbackAccountId =
    existing.defaultAccountId ?? chooseInitialDefaultAccount(accounts)._id;
  const defaultExpenseAccountId =
    existing.defaultExpenseAccountId || fallbackAccountId;
  const defaultIncomeAccountId =
    existing.defaultIncomeAccountId || fallbackAccountId;
  await validateExistingDefaultChannel(
    transaction,
    ownerId,
    defaultExpenseAccountId,
  );
  await validateExistingDefaultChannel(
    transaction,
    ownerId,
    defaultIncomeAccountId,
  );
  const settings: UserSettingsRecord = {
    ...existing,
    defaultTransactionType: existing.defaultTransactionType ?? "expense",
    defaultExpenseAccountId,
    defaultIncomeAccountId,
    preferGeolocation: existing.preferGeolocation ?? false,
    initializationVersion: INITIALIZATION_VERSION,
    updatedAt: now,
    version: existing.version + 1,
  };
  delete settings.defaultAccountId;
  await transaction.updateSettings(settings);

  return settings;
}

async function ensureDefaults(
  transaction: UserInitializationTransaction,
  ownerId: string,
  now: Date,
): Promise<InitializedDefaults> {
  const categories = await ensureCategories(transaction, ownerId, now);
  const accounts = await ensureAccounts(transaction, ownerId, now);

  return {
    expenseCategoriesCreated: categories.expenseCreated,
    incomeCategoriesCreated: categories.incomeCreated,
    accountsCreated: accounts.created,
    accounts: accounts.accounts,
  };
}

function toResult(
  user: UserRecord,
  settings: UserSettingsRecord,
  defaults: InitializedDefaults,
  userCreated: boolean,
): UserInitializationResult {
  return {
    isNewUser: userCreated,
    user: {
      userId: user._id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      status: "active",
    },
    settings: {
      currency: settings.currency,
      timezone: settings.timezone,
      defaultTransactionType: settings.defaultTransactionType,
      defaultExpenseAccountId: settings.defaultExpenseAccountId,
      defaultIncomeAccountId: settings.defaultIncomeAccountId,
      defaultLocation: settings.defaultLocation,
      preferGeolocation: settings.preferGeolocation,
      showWeather: settings.showWeather,
      showBudget: settings.showBudget,
      theme: settings.theme,
      version: settings.version,
      updatedAt: settings.updatedAt.toISOString(),
    },
    initialization: {
      userCreated,
      expenseCategoriesCreated: defaults.expenseCategoriesCreated,
      incomeCategoriesCreated: defaults.incomeCategoriesCreated,
      accountsCreated: defaults.accountsCreated,
      repeatedInitialization:
        !userCreated &&
        defaults.expenseCategoriesCreated === 0 &&
        defaults.incomeCategoriesCreated === 0 &&
        defaults.accountsCreated === 0,
      completed: true,
    },
  };
}

export async function initializeUser(
  options: InitializeUserOptions,
): Promise<UserInitializationResult> {
  const openId = options.openId.trim();

  if (openId.length === 0) {
    throw new UserInitializationError(
      "UNAUTHENTICATED",
      "无法获取有效的微信用户身份",
    );
  }

  const existing = await options.store.findUserByOpenId(openId);
  const userId = existing?._id ?? createUserId(openId);

  return options.store.runTransaction(async (transaction) => {
    const ensuredUser = await ensureUser(
      transaction,
      userId,
      openId,
      options.now,
    );
    const defaults = await ensureDefaults(
      transaction,
      ensuredUser.user._id,
      options.now,
    );
    const settings = await ensureSettings(
      transaction,
      ensuredUser.user._id,
      defaults.accounts,
      options.now,
    );

    return toResult(
      ensuredUser.user,
      settings,
      defaults,
      ensuredUser.created,
    );
  });
}
