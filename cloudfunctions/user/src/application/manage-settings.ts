import type {
  DefaultLocation,
  UpdateLedgerSettingsPayload,
  UpdateUserSettingsPayload,
  UpdateWeatherSettingsPayload,
  UserSettings,
} from "../../../../shared/types/user";
import { createSettingsId } from "../domain/ids";
import type {
  UserInitializationStore,
  UserInitializationTransaction,
  UserRecord,
  UserSettingsRecord,
} from "../domain/types";
import { UserInitializationError } from "../domain/types";

function toSettings(record: UserSettingsRecord): UserSettings {
  return {
    currency: record.currency,
    timezone: record.timezone,
    defaultTransactionType: record.defaultTransactionType,
    defaultExpenseAccountId: record.defaultExpenseAccountId,
    defaultIncomeAccountId: record.defaultIncomeAccountId,
    defaultLocation: record.defaultLocation,
    preferGeolocation: record.preferGeolocation,
    showWeather: record.showWeather,
    showBudget: record.showBudget,
    theme: record.theme,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function validateDefaultChannel(
  transaction: UserInitializationTransaction,
  ownerId: string,
  accountId: string,
): Promise<string> {
  const normalizedId = accountId.trim();
  if (normalizedId.length === 0) {
    throw new UserInitializationError(
      "ACCOUNT_REQUIRED",
      "请选择默认资金渠道",
    );
  }
  const account = await transaction.getAccount(normalizedId);
  if (account === null || account.ownerId !== ownerId) {
    throw new UserInitializationError(
      "ACCOUNT_NOT_FOUND",
      "默认资金渠道不存在",
    );
  }
  if (!account.isEnabled) {
    throw new UserInitializationError(
      "ACCOUNT_DISABLED",
      "默认资金渠道已停用",
    );
  }
  return normalizedId;
}

async function applyLedgerChanges(options: {
  ownerId: string;
  payload: UpdateLedgerSettingsPayload;
  settings: UserSettingsRecord;
  transaction: UserInitializationTransaction;
}): Promise<UserSettingsRecord> {
  const changes = options.payload.changes;
  const next = { ...options.settings };
  if (changes.defaultTransactionType !== undefined) {
    next.defaultTransactionType = changes.defaultTransactionType;
  }
  if (changes.defaultExpenseAccountId !== undefined) {
    next.defaultExpenseAccountId = await validateDefaultChannel(
      options.transaction,
      options.ownerId,
      changes.defaultExpenseAccountId,
    );
  }
  if (changes.defaultIncomeAccountId !== undefined) {
    next.defaultIncomeAccountId = await validateDefaultChannel(
      options.transaction,
      options.ownerId,
      changes.defaultIncomeAccountId,
    );
  }
  return next;
}

function applyWeatherChanges(
  settings: UserSettingsRecord,
  payload: UpdateWeatherSettingsPayload,
): UserSettingsRecord {
  const changes = payload.changes;
  return {
    ...settings,
    ...(changes.defaultLocation === undefined
      ? {}
      : { defaultLocation: validateLocation(changes.defaultLocation) }),
    ...(changes.preferGeolocation === undefined
      ? {}
      : { preferGeolocation: changes.preferGeolocation }),
  };
}

function validateLocation(value: DefaultLocation | null): DefaultLocation | null {
  if (value === null) return null;
  const locationKey = value.locationKey.trim();
  const displayName = value.displayName.trim();
  const locationMatch = /^open-meteo:(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/u.exec(locationKey);
  const latitude = Number(locationMatch?.[1]);
  const longitude = Number(locationMatch?.[2]);
  if (
    locationMatch === null ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    displayName.length === 0 ||
    displayName.length > 100 ||
    (value.source !== "manual" && value.source !== "geolocation")
  ) {
    throw new UserInitializationError("INVALID_ARGUMENT", "默认城市参数无效");
  }
  return { locationKey, displayName, source: value.source };
}

async function requireActiveUser(
  openId: string | undefined,
  store: UserInitializationStore,
): Promise<UserRecord> {
  if (!openId?.trim()) throw new UserInitializationError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
  const user = await store.findUserByOpenId(openId);
  if (user === null) throw new UserInitializationError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  if (user.status !== "active") throw new UserInitializationError("USER_DISABLED", "当前用户不可用");
  return user;
}

export async function getUserSettings(options: {
  openId: string | undefined;
  store: UserInitializationStore;
}): Promise<UserSettings> {
  const user = await requireActiveUser(options.openId, options.store);
  return options.store.runTransaction(async (transaction) => {
    const settings = await transaction.getSettings(createSettingsId(user._id));
    if (settings === null || settings.ownerId !== user._id) throw new UserInitializationError("USER_NOT_INITIALIZED", "用户设置尚未初始化");
    return toSettings(settings);
  });
}

export async function updateUserSettings(options: {
  openId: string | undefined;
  payload: UpdateUserSettingsPayload;
  now: Date;
  store: UserInitializationStore;
}): Promise<UserSettings> {
  const user = await requireActiveUser(options.openId, options.store);
  return options.store.runTransaction(async (transaction) => {
    const settings = await transaction.getSettings(createSettingsId(user._id));
    if (settings === null || settings.ownerId !== user._id) throw new UserInitializationError("USER_NOT_INITIALIZED", "用户设置尚未初始化");
    if (settings.version !== options.payload.expectedVersion) throw new UserInitializationError("VERSION_CONFLICT", "设置已更新，请刷新后重试");
    const changed =
      options.payload.group === "ledger"
        ? await applyLedgerChanges({
            ownerId: user._id,
            payload: options.payload,
            settings,
            transaction,
          })
        : applyWeatherChanges(settings, options.payload);
    const next: UserSettingsRecord = {
      ...changed,
      updatedAt: options.now,
      version: settings.version + 1,
    };
    delete next.defaultAccountId;
    await transaction.updateSettings(next);
    return toSettings(next);
  });
}
