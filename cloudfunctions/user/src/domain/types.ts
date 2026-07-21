import type { ApiErrorCode } from "../../../../shared/types/api";
import type {
  AccountType,
  CategoryType,
  DefaultLocation,
  Theme,
} from "../../../../shared/types/user";

export type StoredUserStatus =
  | "active"
  | "disabled"
  | "deletion_pending"
  | "deleted";

export interface UserRecord {
  _id: string;
  openId: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: StoredUserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
  version: number;
}

export interface UserSettingsRecord {
  _id: string;
  ownerId: string;
  currency: "CNY";
  timezone: string;
  defaultAccountId: string | null;
  defaultLocation: DefaultLocation | null;
  showWeather: boolean;
  showBudget: boolean;
  theme: Theme;
  initializationVersion: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface CategoryRecord {
  _id: string;
  ownerId: string;
  type: CategoryType;
  systemKey: string;
  name: string;
  icon: string;
  sortOrder: number;
  isSystem: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AccountRecord {
  _id: string;
  ownerId: string;
  systemKey: string;
  name: string;
  type: AccountType;
  icon: string;
  sortOrder: number;
  isSystem: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface UserInitializationTransaction {
  getUser(userId: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<void>;
  updateUser(user: UserRecord): Promise<void>;
  getSettings(settingsId: string): Promise<UserSettingsRecord | null>;
  createSettings(settings: UserSettingsRecord): Promise<void>;
  updateSettings(settings: UserSettingsRecord): Promise<void>;
  getCategory(categoryId: string): Promise<CategoryRecord | null>;
  createCategory(category: CategoryRecord): Promise<void>;
  getAccount(accountId: string): Promise<AccountRecord | null>;
  createAccount(account: AccountRecord): Promise<void>;
}

export interface UserInitializationStore {
  findUserByOpenId(openId: string): Promise<UserRecord | null>;
  runTransaction<T>(
    operation: (transaction: UserInitializationTransaction) => Promise<T>,
  ): Promise<T>;
}

export class UserInitializationError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "UserInitializationError";
    this.code = code;
  }
}
