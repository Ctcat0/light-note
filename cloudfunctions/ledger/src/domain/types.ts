import type { ApiErrorCode } from "../../../../shared/types/api";
import type {
  AccountType,
  CategoryType,
  DefaultLocation,
  Theme,
} from "../../../../shared/types/user";
import type { TransactionType } from "../../../../shared/types/transaction";

export type StoredUserStatus =
  | "active"
  | "disabled"
  | "deletion_pending"
  | "deleted";

export interface UserRecord {
  _id: string;
  openId: string;
  status: StoredUserStatus;
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

export interface TransactionRecord {
  _id: string;
  ownerId: string;
  type: TransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: Date;
  occurredDateKey: string;
  merchant: string | null;
  note: string | null;
  tags: string[];
  attachmentUrls: string[];
  includeInBudget: boolean;
  requestId: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  lastMutationRequestId?: string;
  lastMutationKind?: "update" | "delete";
  lastMutationFingerprint?: string;
  lastMutationPreviousOccurredAt?: Date;
}

export interface LedgerTransactionStore {
  getUser(userId: string): Promise<UserRecord | null>;
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
  createTransaction(transaction: TransactionRecord): Promise<void>;
  updateTransaction(transaction: TransactionRecord): Promise<void>;
  getCategory(categoryId: string): Promise<CategoryRecord | null>;
  getAccount(accountId: string): Promise<AccountRecord | null>;
}

export interface LedgerStore {
  findUserByOpenId(openId: string): Promise<UserRecord | null>;
  getSettingsByOwner(ownerId: string): Promise<UserSettingsRecord | null>;
  listCategories(
    ownerId: string,
    type: TransactionType,
  ): Promise<CategoryRecord[]>;
  listAccounts(ownerId: string): Promise<AccountRecord[]>;
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
  listTransactions(options: {
    ownerId: string;
    type: TransactionType;
    startAt: Date;
    endAt: Date;
    pageSize: number;
    cursor: { occurredAt: Date; transactionId: string } | null;
  }): Promise<TransactionRecord[]>;
  sumTransactions(options: {
    ownerId: string;
    type: TransactionType;
    startAt: Date;
    endAt: Date;
  }): Promise<number>;
  getCategoriesByIds(
    ownerId: string,
    categoryIds: string[],
  ): Promise<CategoryRecord[]>;
  getAccountsByIds(
    ownerId: string,
    accountIds: string[],
  ): Promise<AccountRecord[]>;
  runTransaction<T>(
    operation: (transaction: LedgerTransactionStore) => Promise<T>,
  ): Promise<T>;
}

export class LedgerError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
