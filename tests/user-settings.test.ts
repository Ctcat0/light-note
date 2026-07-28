import assert from "node:assert/strict";
import test from "node:test";
import { createUserFunctionHandler } from "../cloudfunctions/user/src/application/handler";
import type { UserInitializationResult, UserSettings } from "../shared/types/user";
import { InMemoryUserInitializationStore } from "./helpers/in-memory-user-init-store";

const OPEN_ID = "settings-openid";
const INIT_ID = "10000000-0000-4000-8000-000000000001";
const UPDATE_ID = "10000000-0000-4000-8000-000000000002";

test("默认城市通过版本校验写入 user_settings，响应不暴露身份字段", async () => {
  const store = new InMemoryUserInitializationStore();
  const handler = createUserFunctionHandler({ getOpenId: () => OPEN_ID, getCurrentTime: () => new Date("2026-07-22T04:00:00.000Z"), store });
  const initialized = await handler({ action: "init", requestId: INIT_ID, payload: {} });
  assert.equal(initialized.success, true);
  const initial = initialized.success ? initialized.data as UserInitializationResult : null;
  assert.ok(initial);
  const updated = await handler({
    action: "updateSettings",
    requestId: UPDATE_ID,
    payload: { expectedVersion: initial.settings.version, group: "weather", changes: { defaultLocation: { locationKey: "open-meteo:39.9042,116.4074", displayName: "北京", source: "manual" } } },
  });
  assert.equal(updated.success, true);
  const settings = updated.success ? updated.data as UserSettings : null;
  assert.equal(settings?.defaultLocation?.displayName, "北京");
  assert.equal(settings?.version, initial.settings.version + 1);
  assert.equal(JSON.stringify(updated).includes(OPEN_ID), false);
});

test("默认城市更新拒绝旧版本和非受控 locationKey", async () => {
  const store = new InMemoryUserInitializationStore();
  const handler = createUserFunctionHandler({ getOpenId: () => OPEN_ID, getCurrentTime: () => new Date("2026-07-22T04:00:00.000Z"), store });
  const initialized = await handler({ action: "init", requestId: INIT_ID, payload: {} });
  assert.equal(initialized.success, true);
  const initial = initialized.success ? initialized.data as UserInitializationResult : null;
  assert.ok(initial);
  const invalid = await handler({ action: "updateSettings", requestId: UPDATE_ID, payload: { expectedVersion: initial.settings.version, group: "weather", changes: { defaultLocation: { locationKey: "https://evil.example", displayName: "未知", source: "manual" } } } });
  assert.equal(invalid.success, false);
  assert.equal(invalid.code, "INVALID_ARGUMENT");
});

test("记账与天气设置分组更新互不覆盖，默认渠道校验归属和启用状态", async () => {
  const store = new InMemoryUserInitializationStore();
  const handler = createUserFunctionHandler({
    getOpenId: () => OPEN_ID,
    getCurrentTime: () => new Date("2026-07-22T04:00:00.000Z"),
    store,
  });
  const initialized = await handler({
    action: "init",
    requestId: INIT_ID,
    payload: {},
  });
  assert.equal(initialized.success, true);
  if (!initialized.success) return;
  const initial = initialized.data as UserInitializationResult;
  const ownerRecords = store.getUserRecords(initial.user.userId);
  const bank = ownerRecords.accounts.find(
    (account) => account.systemKey === "account_bank",
  );
  assert.ok(bank);

  const weather = await handler({
    action: "updateSettings",
    requestId: UPDATE_ID,
    payload: {
      expectedVersion: initial.settings.version,
      group: "weather",
      changes: {
        defaultLocation: {
          locationKey: "open-meteo:31.2304,121.4737",
          displayName: "上海",
          source: "manual",
        },
        preferGeolocation: true,
      },
    },
  });
  assert.equal(weather.success, true);
  if (!weather.success) return;
  const weatherSettings = weather.data as UserSettings;

  const ledger = await handler({
    action: "updateSettings",
    requestId: "10000000-0000-4000-8000-000000000003",
    payload: {
      expectedVersion: weatherSettings.version,
      group: "ledger",
      changes: {
        defaultTransactionType: "income",
        defaultExpenseAccountId: bank._id,
        defaultIncomeAccountId: bank._id,
      },
    },
  });
  assert.equal(ledger.success, true);
  if (!ledger.success) return;
  const settings = ledger.data as UserSettings;
  assert.equal(settings.defaultTransactionType, "income");
  assert.equal(settings.defaultExpenseAccountId, bank._id);
  assert.equal(settings.defaultIncomeAccountId, bank._id);
  assert.equal(settings.defaultLocation?.displayName, "上海");
  assert.equal(settings.preferGeolocation, true);

  const otherHandler = createUserFunctionHandler({
    getOpenId: () => "settings-other-openid",
    getCurrentTime: () => new Date("2026-07-22T04:00:00.000Z"),
    store,
  });
  const other = await otherHandler({
    action: "init",
    requestId: "10000000-0000-4000-8000-000000000004",
    payload: {},
  });
  assert.equal(other.success, true);
  if (!other.success) return;
  const otherAccount = store.getUserRecords(
    (other.data as UserInitializationResult).user.userId,
  ).accounts[0];
  assert.ok(otherAccount);

  const crossUser = await handler({
    action: "updateSettings",
    requestId: "10000000-0000-4000-8000-000000000005",
    payload: {
      expectedVersion: settings.version,
      group: "ledger",
      changes: { defaultExpenseAccountId: otherAccount._id },
    },
  });
  assert.equal(crossUser.success, false);
  assert.equal(crossUser.code, "ACCOUNT_NOT_FOUND");

  store.accounts.set(bank._id, { ...bank, isEnabled: false });
  const disabled = await handler({
    action: "updateSettings",
    requestId: "10000000-0000-4000-8000-000000000006",
    payload: {
      expectedVersion: settings.version,
      group: "ledger",
      changes: { defaultExpenseAccountId: bank._id },
    },
  });
  assert.equal(disabled.success, false);
  assert.equal(disabled.code, "ACCOUNT_DISABLED");
});
