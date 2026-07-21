export type UserStatus = "active";

export type CategoryType = "expense" | "income";

export type AccountType = "wechat" | "alipay" | "bank" | "cash" | "other";

export type Theme = "system" | "light" | "dark";

export interface DefaultLocation {
  locationKey: string;
  displayName: string;
  source: "manual" | "geolocation";
}

export interface User {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: UserStatus;
}

export interface UserSettings {
  currency: "CNY";
  timezone: string;
  defaultAccountId: string | null;
  defaultLocation: DefaultLocation | null;
  showWeather: boolean;
  showBudget: boolean;
  theme: Theme;
  version: number;
  updatedAt: string;
}

export interface Category {
  categoryId: string;
  type: CategoryType;
  name: string;
  icon: string;
  sortOrder: number;
  isSystem: boolean;
  isEnabled: boolean;
  version: number;
}

export interface Account {
  accountId: string;
  name: string;
  type: AccountType;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isSystem: boolean;
  isEnabled: boolean;
  version: number;
}

export type UserInitPayload = Record<string, never>;

export interface UserInitializationStatus {
  userCreated: boolean;
  expenseCategoriesCreated: number;
  incomeCategoriesCreated: number;
  accountsCreated: number;
  repeatedInitialization: boolean;
  completed: boolean;
}

export interface UserInitializationResult {
  isNewUser: boolean;
  user: User;
  settings: UserSettings;
  initialization: UserInitializationStatus;
}
