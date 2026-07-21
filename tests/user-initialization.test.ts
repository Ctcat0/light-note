import assert from "node:assert/strict";
import test from "node:test";
import { createUserFunctionHandler } from "../cloudfunctions/user/src/application/handler";
import { initializeUser } from "../cloudfunctions/user/src/application/initialize-user";
import {
  createAccountId,
  createCategoryId,
} from "../cloudfunctions/user/src/domain/ids";
import type { UserInitializationStore } from "../cloudfunctions/user/src/domain/types";
import { InMemoryUserInitializationStore } from "./helpers/in-memory-user-init-store";

const NOW = new Date("2026-07-21T08:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function init(
  store: InMemoryUserInitializationStore,
  openId = "openid-user-a",
) {
  return initializeUser({ openId, now: NOW, store });
}

test("首次初始化创建用户、19 个分类、5 个账户并默认使用微信", async () => {
  const store = new InMemoryUserInitializationStore();
  const result = await init(store);
  const records = store.getUserRecords(result.user.userId);
  const wechat = records.accounts.find(
    (account) => account.systemKey === "account_wechat",
  );

  assert.equal(result.isNewUser, true);
  assert.deepEqual(result.initialization, {
    userCreated: true,
    expenseCategoriesCreated: 11,
    incomeCategoriesCreated: 8,
    accountsCreated: 5,
    repeatedInitialization: false,
    completed: true,
  });
  assert.equal(records.categories.length, 19);
  assert.equal(records.accounts.length, 5);
  assert.deepEqual(
    records.categories
      .filter((category) => category.type === "expense")
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => category.name),
    [
      "餐饮",
      "交通",
      "购物",
      "居住",
      "娱乐",
      "医疗",
      "学习",
      "通讯",
      "人情",
      "旅行",
      "其他",
    ],
  );
  assert.deepEqual(
    records.categories
      .filter((category) => category.type === "income")
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => category.name),
    ["工资", "奖金", "兼职", "报销", "理财收益", "红包", "退款", "其他"],
  );
  assert.deepEqual(
    records.accounts
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((account) => account.name),
    ["微信", "支付宝", "银行卡", "现金", "其他"],
  );
  assert.equal(records.categories.every((item) => item.isSystem), true);
  assert.equal(records.categories.every((item) => item.isEnabled), true);
  assert.equal(records.accounts.every((item) => item.isSystem), true);
  assert.equal(records.accounts.every((item) => item.isEnabled), true);
  assert.ok(wechat);
  assert.equal(result.settings.defaultAccountId, wechat._id);
  assert.equal(records.settings.defaultAccountId, wechat._id);
  assert.equal(JSON.stringify(result).includes("openid-user-a"), false);
});

test("重复初始化不创建重复数据且不覆盖用户已有设置", async () => {
  const store = new InMemoryUserInitializationStore();
  const first = await init(store);
  const records = store.getUserRecords(first.user.userId);
  const alipay = records.accounts.find(
    (account) => account.systemKey === "account_alipay",
  );
  const food = records.categories.find(
    (category) => category.systemKey === "expense_food",
  );

  assert.ok(alipay);
  assert.ok(food);
  const user = store.users.get(first.user.userId);
  assert.ok(user);
  store.users.set(user._id, {
    ...user,
    nickname: "自定义昵称",
    avatarUrl: "https://example.com/avatar.png",
  });
  store.settings.set(records.settings._id, {
    ...records.settings,
    defaultAccountId: alipay._id,
    version: records.settings.version + 1,
  });
  store.categories.set(food._id, {
    ...food,
    name: "工作餐",
    isEnabled: false,
    version: food.version + 1,
  });

  const second = await init(store);
  const after = store.getUserRecords(first.user.userId);
  const preservedFood = after.categories.find(
    (category) => category.systemKey === "expense_food",
  );

  assert.deepEqual(second.initialization, {
    userCreated: false,
    expenseCategoriesCreated: 0,
    incomeCategoriesCreated: 0,
    accountsCreated: 0,
    repeatedInitialization: true,
    completed: true,
  });
  assert.equal(store.users.size, 1);
  assert.equal(after.categories.length, 19);
  assert.equal(after.accounts.length, 5);
  assert.equal(after.settings.defaultAccountId, alipay._id);
  assert.equal(preservedFood?.name, "工作餐");
  assert.equal(preservedFood?.isEnabled, false);
  assert.equal(store.users.get(first.user.userId)?.nickname, "自定义昵称");
  assert.equal(
    store.users.get(first.user.userId)?.avatarUrl,
    "https://example.com/avatar.png",
  );
});

test("部分账户或系统分类缺失时只补齐缺失数据", async () => {
  const store = new InMemoryUserInitializationStore();
  const first = await init(store);
  const ownerId = first.user.userId;
  const accountId = createAccountId(ownerId, "account_wechat");
  const categoryId = createCategoryId(
    ownerId,
    "expense",
    "expense_transport",
  );
  const records = store.getUserRecords(ownerId);

  store.accounts.delete(accountId);
  store.categories.delete(categoryId);
  store.settings.set(records.settings._id, {
    ...records.settings,
    defaultAccountId: null,
    initializationVersion: 0,
  });

  const result = await init(store);
  const repaired = store.getUserRecords(ownerId);

  assert.equal(result.initialization.expenseCategoriesCreated, 1);
  assert.equal(result.initialization.incomeCategoriesCreated, 0);
  assert.equal(result.initialization.accountsCreated, 1);
  assert.equal(repaired.categories.length, 19);
  assert.equal(repaired.accounts.length, 5);
  assert.equal(repaired.settings.defaultAccountId, accountId);
});

test("自定义分类和主动停用状态不受再次初始化影响", async () => {
  const store = new InMemoryUserInitializationStore();
  const first = await init(store);
  const records = store.getUserRecords(first.user.userId);
  const medical = records.categories.find(
    (category) => category.systemKey === "expense_medical",
  );

  assert.ok(medical);
  store.categories.set(medical._id, {
    ...medical,
    isEnabled: false,
    version: medical.version + 1,
  });
  store.categories.set("cat_custom", {
    ...medical,
    _id: "cat_custom",
    systemKey: "custom_user_defined",
    name: "宠物",
    isSystem: false,
    isEnabled: true,
  });

  await init(store);
  const after = store.getUserRecords(first.user.userId);

  assert.equal(
    after.categories.find((item) => item._id === medical._id)?.isEnabled,
    false,
  );
  assert.equal(
    after.categories.find((item) => item._id === "cat_custom")?.name,
    "宠物",
  );
  assert.equal(after.categories.length, 20);
});

test("不同微信身份得到严格隔离的用户、分类、账户和默认账户", async () => {
  const store = new InMemoryUserInitializationStore();
  const [userA, userB] = await Promise.all([
    init(store, "openid-user-a"),
    init(store, "openid-user-b"),
  ]);
  const recordsA = store.getUserRecords(userA.user.userId);
  const recordsB = store.getUserRecords(userB.user.userId);

  assert.notEqual(userA.user.userId, userB.user.userId);
  assert.notEqual(
    recordsA.settings.defaultAccountId,
    recordsB.settings.defaultAccountId,
  );
  assert.equal(
    recordsA.categories.every((item) => item.ownerId === userA.user.userId),
    true,
  );
  assert.equal(
    recordsB.accounts.every((item) => item.ownerId === userB.user.userId),
    true,
  );
  assert.equal(
    recordsA.accounts.some((item) => item.ownerId === userB.user.userId),
    false,
  );
});

test("同一用户并发初始化不会产生重复记录", async () => {
  const store = new InMemoryUserInitializationStore();
  const results = await Promise.all([
    init(store),
    init(store),
    init(store),
  ]);
  const records = store.getUserRecords(results[0]?.user.userId ?? "");

  assert.equal(store.users.size, 1);
  assert.equal(records.categories.length, 19);
  assert.equal(records.accounts.length, 5);
  assert.equal(
    results.filter((result) => result.initialization.userCreated).length,
    1,
  );
});

test("身份缺失、越权参数和数据库失败返回受控错误且不泄漏堆栈", async () => {
  const store = new InMemoryUserInitializationStore();
  const missingIdentityHandler = createUserFunctionHandler({
    getOpenId: () => undefined,
    getCurrentTime: () => NOW,
    store,
  });
  const missingIdentity = await missingIdentityHandler({
    action: "init",
    requestId: REQUEST_ID,
    payload: {},
  });

  assert.equal(missingIdentity.success, false);
  assert.equal(missingIdentity.code, "UNAUTHENTICATED");

  const validHandler = createUserFunctionHandler({
    getOpenId: () => "trusted-openid",
    getCurrentTime: () => NOW,
    store,
  });
  const forgedIdentity = await validHandler({
    action: "init",
    requestId: REQUEST_ID,
    payload: { userId: "another-user" },
  });

  assert.equal(forgedIdentity.success, false);
  assert.equal(forgedIdentity.code, "INVALID_ARGUMENT");

  const failingStore: UserInitializationStore = {
    findUserByOpenId: async () => {
      throw new Error("database stack and internal collection name");
    },
    runTransaction: async () => {
      throw new Error("not reached");
    },
  };
  const failingHandler = createUserFunctionHandler({
    getOpenId: () => "trusted-openid",
    getCurrentTime: () => NOW,
    store: failingStore,
  });
  const failure = await failingHandler({
    action: "init",
    requestId: REQUEST_ID,
    payload: {},
  });
  const serialized = JSON.stringify(failure);

  assert.equal(failure.success, false);
  assert.equal(failure.code, "DEPENDENCY_ERROR");
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("collection"), false);
  assert.equal(serialized.includes("trusted-openid"), false);
});

test("写入失败会回滚且再次调用可以完成初始化", async () => {
  const store = new InMemoryUserInitializationStore();
  store.failNextWrite();

  await assert.rejects(() => init(store));
  assert.equal(store.users.size, 0);
  assert.equal(store.categories.size, 0);
  assert.equal(store.accounts.size, 0);

  const retry = await init(store);

  assert.equal(retry.initialization.completed, true);
  assert.equal(store.users.size, 1);
  assert.equal(store.categories.size, 19);
  assert.equal(store.accounts.size, 5);
});
