import assert from "node:assert/strict";
import test from "node:test";

import { createLedgerFunctionHandler } from "../cloudfunctions/ledger/src/application/handler";
import { getTransactionMonthRange } from "../cloudfunctions/ledger/src/application/transactions";
import type { TransactionRecord } from "../cloudfunctions/ledger/src/domain/types";
import {
  InMemoryLedgerStore,
  seedLedgerUser,
} from "./helpers/in-memory-ledger-store";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-a111-111111111111";

function createFixture(openId: string | undefined = "openid-a") {
  const store = new InMemoryLedgerStore();
  const seeded = seedLedgerUser(store);
  const handler = createLedgerFunctionHandler({
    getOpenId: () => openId,
    getCurrentTime: () => new Date(NOW),
    store,
  });
  const payload = {
    type: "expense",
    amountInCents: 1250,
    categoryId: seeded.expenseCategoryId,
    accountId: seeded.accountId,
    occurredAt: "2026-07-21T09:30:00.000Z",
    note: "  午餐  ",
    merchant: null,
    includeInBudget: true,
  };
  return { store, seeded, handler, payload };
}

function putTransaction(
  fixture: ReturnType<typeof createFixture>,
  options: {
    sequence: number;
    occurredAt: string;
    amountInCents?: number;
    ownerId?: string;
    type?: "expense" | "income";
    isDeleted?: boolean;
  },
): TransactionRecord {
  const id = `txn_${options.sequence.toString(16).padStart(32, "0")}`;
  const occurredAt = new Date(options.occurredAt);
  const record: TransactionRecord = {
    _id: id,
    ownerId: options.ownerId ?? fixture.seeded.userId,
    type: options.type ?? "expense",
    amountInCents: options.amountInCents ?? 100,
    categoryId:
      options.type === "income"
        ? fixture.seeded.incomeCategoryId
        : fixture.seeded.expenseCategoryId,
    accountId: fixture.seeded.accountId,
    occurredAt,
    occurredDateKey: options.occurredAt.slice(0, 10),
    merchant: null,
    note: null,
    tags: [],
    attachmentUrls: [],
    includeInBudget: options.type !== "income",
    requestId: `seed-${options.sequence}`,
    isDeleted: options.isDeleted ?? false,
    deletedAt: options.isDeleted ? NOW : null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    version: 1,
  };
  fixture.store.transactions.set(id, record);
  return record;
}

test("合法支出由服务端补齐归属、日期、状态和审计字段并可单条查询", async () => {
  const fixture = createFixture();
  const response = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: fixture.payload,
  });
  assert.equal(response.success, true);
  if (!response.success || !("transaction" in response.data)) return;
  const transaction = response.data.transaction;
  assert.equal(transaction.type, "expense");
  assert.equal(transaction.amountInCents, 1250);
  assert.equal(transaction.note, "午餐");
  assert.equal(transaction.occurredDateKey, "2026-07-21");
  assert.equal(transaction.status, "active");
  assert.equal(transaction.createdAt, NOW.toISOString());
  const stored = [...fixture.store.transactions.values()][0];
  assert.equal(stored?.ownerId, fixture.seeded.userId);
  assert.equal(stored?.requestId, REQUEST_ID);
  assert.deepEqual(stored?.tags, []);
  assert.deepEqual(stored?.attachmentUrls, []);

  const query = await fixture.handler({
    action: "getTransaction",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: { transactionId: transaction.transactionId },
  });
  assert.equal(query.success, true);
});

test("收入账单支持新增、编辑、流水汇总和逻辑删除闭环", async () => {
  const fixture = createFixture();
  const create = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: {
      ...fixture.payload,
      type: "income",
      categoryId: fixture.seeded.incomeCategoryId,
      includeInBudget: false,
      note: "工资",
    },
  });
  assert.equal(create.success, true);
  if (!create.success || !("transaction" in create.data)) return;
  assert.equal(create.data.transaction.type, "income");
  assert.equal(create.data.transaction.includeInBudget, false);

  const update = await fixture.handler({
    action: "updateTransaction",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: {
      transactionId: create.data.transaction.transactionId,
      amountInCents: 1880,
      categoryId: fixture.seeded.incomeCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: fixture.payload.occurredAt,
      note: "奖金",
      expectedVersion: 1,
    },
  });
  assert.equal(update.success, true);

  const mismatchedCategory = await fixture.handler({
    action: "updateTransaction",
    requestId: "29292929-2929-4929-a929-292929292929",
    payload: {
      transactionId: create.data.transaction.transactionId,
      amountInCents: 1880,
      categoryId: fixture.seeded.expenseCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: fixture.payload.occurredAt,
      note: "奖金",
      expectedVersion: 2,
    },
  });
  assert.equal(mismatchedCategory.code, "CATEGORY_TYPE_INVALID");

  const list = await fixture.handler({
    action: "listTransactions",
    requestId: "33333333-3333-4333-a333-333333333333",
    payload: { filter: "income", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  assert.equal(list.success, true);
  if (
    !list.success ||
    !("items" in list.data) ||
    !("summary" in list.data)
  ) return;
  assert.deepEqual(list.data.items.map((item) => item.type), ["income"]);
  assert.equal(list.data.summary.monthExpenseInCents, 0);
  assert.equal(list.data.summary.monthIncomeInCents, 1880);
  assert.equal(list.data.summary.monthBalanceInCents, 1880);

  const deleted = await fixture.handler({
    action: "deleteTransaction",
    requestId: "44444444-4444-4444-a444-444444444444",
    payload: {
      transactionId: create.data.transaction.transactionId,
      expectedVersion: 2,
    },
  });
  assert.equal(deleted.success, true);
  assert.equal(
    fixture.store.transactions.get(create.data.transaction.transactionId)
      ?.isDeleted,
    true,
  );

  const afterDelete = await fixture.handler({
    action: "listTransactions",
    requestId: "45454545-4545-4545-a545-454545454545",
    payload: { filter: "all", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  assert.equal(afterDelete.success, true);
  if (afterDelete.success && "pagination" in afterDelete.data) {
    assert.deepEqual(afterDelete.data.items, []);
    assert.equal(afterDelete.data.summary.monthIncomeInCents, 0);
    assert.equal(afterDelete.data.summary.monthBalanceInCents, 0);
  }
});

test("金额仅接受允许范围内的正整数分", async () => {
  for (const amountInCents of [0, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_000_000]) {
    const fixture = createFixture();
    const response = await fixture.handler({
      action: "createTransaction",
      requestId: REQUEST_ID,
      payload: { ...fixture.payload, amountInCents },
    });
    assert.equal(response.success, false);
    assert.equal(response.code, "INVALID_AMOUNT");
  }
  const fixture = createFixture();
  const oneCent = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: { ...fixture.payload, amountInCents: 1 },
  });
  assert.equal(oneCent.success, true);
});

test("分类必须存在、属于本人、为支出且启用", async () => {
  const cases: Array<[string, string]> = [
    ["required", "CATEGORY_REQUIRED"],
    ["missing", "CATEGORY_NOT_FOUND"],
    ["income", "CATEGORY_TYPE_INVALID"],
    ["disabled", "CATEGORY_DISABLED"],
    ["other", "CATEGORY_NOT_OWNED"],
  ];
  for (const [kind, expectedCode] of cases) {
    const fixture = createFixture();
    const other = seedLedgerUser(fixture.store, {
      userId: "usr_owner_b",
      openId: "openid-b",
    });
    const categoryId =
      kind === "required"
        ? ""
        : kind === "missing"
        ? "missing"
        : kind === "income"
          ? fixture.seeded.incomeCategoryId
          : kind === "disabled"
            ? fixture.seeded.disabledCategoryId
            : other.expenseCategoryId;
    const response = await fixture.handler({
      action: "createTransaction",
      requestId: REQUEST_ID,
      payload: { ...fixture.payload, categoryId },
    });
    assert.equal(response.success, false);
    assert.equal(response.code, expectedCode);
  }
});

test("收入分类必须存在、属于本人、类型匹配且启用", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  const incomeCategory = fixture.store.categories.get(
    fixture.seeded.incomeCategoryId,
  );
  assert.ok(incomeCategory);
  const disabledIncomeCategoryId = `${fixture.seeded.userId}_disabled_income`;
  fixture.store.categories.set(disabledIncomeCategoryId, {
    ...incomeCategory,
    _id: disabledIncomeCategoryId,
    isEnabled: false,
  });
  const incomePayload = {
    ...fixture.payload,
    type: "income",
    categoryId: fixture.seeded.incomeCategoryId,
    includeInBudget: false,
  };

  for (const [changes, expectedCode] of [
    [{ categoryId: "missing" }, "CATEGORY_NOT_FOUND"],
    [{ categoryId: fixture.seeded.expenseCategoryId }, "CATEGORY_TYPE_INVALID"],
    [{ categoryId: disabledIncomeCategoryId }, "CATEGORY_DISABLED"],
    [{ categoryId: other.incomeCategoryId }, "CATEGORY_NOT_OWNED"],
    [{ categoryType: "income" }, "INVALID_ARGUMENT"],
  ] as const) {
    const response = await fixture.handler({
      action: "createTransaction",
      requestId: createRequestIdForTest(),
      payload: { ...incomePayload, ...changes },
    });
    assert.equal(response.code, expectedCode);
  }
});

test("账户必须存在、属于本人且启用", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  for (const [accountId, expectedCode] of [
    ["", "ACCOUNT_REQUIRED"],
    ["missing", "ACCOUNT_NOT_FOUND"],
    [fixture.seeded.disabledAccountId, "ACCOUNT_DISABLED"],
    [other.accountId, "ACCOUNT_NOT_OWNED"],
  ] as const) {
    const response = await fixture.handler({
      action: "createTransaction",
      requestId: REQUEST_ID,
      payload: { ...fixture.payload, accountId },
    });
    assert.equal(response.success, false);
    assert.equal(response.code, expectedCode);
  }
});

test("身份缺失、未初始化、停用以及前端伪造身份均被拒绝", async () => {
  const missing = createFixture("");
  const missingResponse = await missing.handler({
    action: "listAccounts",
    requestId: REQUEST_ID,
    payload: { transactionType: "expense", includeDisabled: false },
  });
  assert.equal(missingResponse.code, "UNAUTHENTICATED");

  const uninitialized = createFixture("not-seeded");
  const uninitializedResponse = await uninitialized.handler({
    action: "listAccounts",
    requestId: REQUEST_ID,
    payload: { transactionType: "expense", includeDisabled: false },
  });
  assert.equal(uninitializedResponse.code, "USER_NOT_INITIALIZED");

  const disabledStore = new InMemoryLedgerStore();
  seedLedgerUser(disabledStore, { status: "disabled" });
  const disabled = createLedgerFunctionHandler({
    getOpenId: () => "openid-a",
    getCurrentTime: () => NOW,
    store: disabledStore,
  });
  const disabledResponse = await disabled({
    action: "listAccounts",
    requestId: REQUEST_ID,
    payload: { transactionType: "expense", includeDisabled: false },
  });
  assert.equal(disabledResponse.code, "USER_DISABLED");

  const fixture = createFixture();
  for (const field of ["userId", "openId", "ownerId"]) {
    const forged = await fixture.handler({
      action: "createTransaction",
      requestId: REQUEST_ID,
      payload: { ...fixture.payload, [field]: "forged" },
    });
    assert.equal(forged.code, "INVALID_ARGUMENT");
  }
});

test("相同 requestId 的连续和并发请求只创建一条，不同用户互不冲突", async () => {
  const fixture = createFixture();
  const [first, second] = await Promise.all([
    fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload }),
    fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload }),
  ]);
  assert.equal(fixture.store.transactions.size, 1);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  if (
    first.success &&
    second.success &&
    "duplicate" in first.data &&
    "duplicate" in second.data &&
    "transaction" in first.data &&
    "transaction" in second.data
  ) {
    assert.equal(first.data.transaction.transactionId, second.data.transaction.transactionId);
    assert.equal([first.data.duplicate, second.data.duplicate].filter(Boolean).length, 1);
  }

  const reusedWithDifferentPayload = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: { ...fixture.payload, amountInCents: 9999 },
  });
  assert.equal(reusedWithDifferentPayload.code, "DUPLICATE_REQUEST");

  const distinctRequest = await fixture.handler({
    action: "createTransaction",
    requestId: "33333333-3333-4333-a333-333333333333",
    payload: fixture.payload,
  });
  assert.equal(distinctRequest.success, true);
  assert.equal(fixture.store.transactions.size, 2);

  const secondUser = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  const secondHandler = createLedgerFunctionHandler({
    getOpenId: () => secondUser.openId,
    getCurrentTime: () => NOW,
    store: fixture.store,
  });
  const otherResponse = await secondHandler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: {
      ...fixture.payload,
      categoryId: secondUser.expenseCategoryId,
      accountId: secondUser.accountId,
    },
  });
  assert.equal(otherResponse.success, true);
  assert.equal(fixture.store.transactions.size, 3);
});

test("收入创建复用 ownerId + requestId 幂等并发保障", async () => {
  const fixture = createFixture();
  const payload = {
    ...fixture.payload,
    type: "income",
    categoryId: fixture.seeded.incomeCategoryId,
    includeInBudget: false,
  };
  const [first, second] = await Promise.all([
    fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload }),
    fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload }),
  ]);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(fixture.store.transactions.size, 1);
  assert.equal([...fixture.store.transactions.values()][0]?.type, "income");
});

test("选项查询按收支类型返回当前用户启用分类并标记默认固定渠道", async () => {
  const fixture = createFixture();
  const categories = await fixture.handler({
    action: "listCategories",
    requestId: REQUEST_ID,
    payload: { type: "expense", includeDisabled: false },
  });
  assert.equal(categories.success, true);
  if (categories.success && "items" in categories.data) {
    const categoryIds = categories.data.items.map((item) =>
      "categoryId" in item ? item.categoryId : null,
    );
    assert.deepEqual(categoryIds, [fixture.seeded.expenseCategoryId]);
  }

  const incomeCategories = await fixture.handler({
    action: "listCategories",
    requestId: "12121212-1212-4212-a212-121212121212",
    payload: { type: "income", includeDisabled: false },
  });
  assert.equal(incomeCategories.success, true);
  if (incomeCategories.success && "items" in incomeCategories.data) {
    const categoryIds = incomeCategories.data.items.map((item) =>
      "categoryId" in item ? item.categoryId : null,
    );
    assert.deepEqual(categoryIds, [fixture.seeded.incomeCategoryId]);
  }

  const accounts = await fixture.handler({
    action: "listAccounts",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: { transactionType: "expense", includeDisabled: false },
  });
  assert.equal(accounts.success, true);
  if (accounts.success && "items" in accounts.data) {
    assert.equal(accounts.data.items.length, 1);
    const firstAccount = accounts.data.items[0];
    assert.equal(
      firstAccount !== undefined &&
        "isDefault" in firstAccount &&
        firstAccount.isDefault,
      true,
    );
  }
});

test("备注、时间、requestId 和数据库失败返回受控错误", async () => {
  const fixture = createFixture();
  const tooLong = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: { ...fixture.payload, note: "x".repeat(201) },
  });
  assert.equal(tooLong.code, "NOTE_TOO_LONG");

  const future = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: { ...fixture.payload, occurredAt: "2026-07-21T10:06:00.000Z" },
  });
  assert.equal(future.code, "INVALID_OCCURRED_AT");

  const missingRequest = await fixture.handler({
    action: "createTransaction",
    payload: fixture.payload,
  });
  assert.equal(missingRequest.code, "REQUEST_ID_REQUIRED");

  fixture.store.failNextWrite();
  const failedWrite = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: fixture.payload,
  });
  assert.equal(failedWrite.code, "TRANSACTION_CREATE_FAILED");
  assert.equal(fixture.store.transactions.size, 0);
});

test("用户只能查询自己的账单且不存在 ID 返回统一错误", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: fixture.payload,
  });
  assert.equal(created.success, true);
  if (!created.success || !("transaction" in created.data)) return;

  const second = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  const otherHandler = createLedgerFunctionHandler({
    getOpenId: () => second.openId,
    getCurrentTime: () => NOW,
    store: fixture.store,
  });
  for (const transactionId of [created.data.transaction.transactionId, "missing"]) {
    const response = await otherHandler({
      action: "getTransaction",
      requestId: "22222222-2222-4222-a222-222222222222",
      payload: { transactionId },
    });
    assert.equal(response.code, "TRANSACTION_NOT_FOUND");
  }
});

test("支出流水仅返回当前用户、指定月份、未删除支出并稳定倒序", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  putTransaction(fixture, { sequence: 1, occurredAt: "2026-06-30T16:00:00.000Z", amountInCents: 100 });
  putTransaction(fixture, { sequence: 2, occurredAt: "2026-07-21T09:30:00.000Z", amountInCents: 200 });
  putTransaction(fixture, { sequence: 3, occurredAt: "2026-07-21T09:30:00.000Z", amountInCents: 300 });
  putTransaction(fixture, { sequence: 4, occurredAt: "2026-07-31T15:59:59.999Z", amountInCents: 400 });
  putTransaction(fixture, { sequence: 5, occurredAt: "2026-07-01T10:00:00.000Z", type: "income", amountInCents: 500 });
  putTransaction(fixture, { sequence: 6, occurredAt: "2026-07-01T10:00:00.000Z", isDeleted: true, amountInCents: 600 });
  putTransaction(fixture, { sequence: 7, occurredAt: "2026-07-01T10:00:00.000Z", ownerId: other.userId, amountInCents: 700 });
  putTransaction(fixture, { sequence: 8, occurredAt: "2026-07-31T16:00:00.000Z", amountInCents: 800 });

  const first = await fixture.handler({
    action: "listTransactions",
    requestId: REQUEST_ID,
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 2, cursor: null },
  });
  assert.equal(first.success, true);
  if (!first.success || !("pagination" in first.data)) return;
  assert.deepEqual(
    first.data.items.map((item) => item.transactionId),
    [
      "txn_00000000000000000000000000000004",
      "txn_00000000000000000000000000000003",
    ],
  );
  assert.equal(first.data.summary.monthExpenseInCents, 1000);
  assert.equal(first.data.summary.monthIncomeInCents, 500);
  assert.equal(first.data.summary.monthBalanceInCents, -500);
  assert.equal(first.data.pagination.hasMore, true);
  assert.notEqual(first.data.pagination.nextCursor, null);

  const second = await fixture.handler({
    action: "listTransactions",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: {
      filter: "expense",
      year: 2026,
      month: 7,
      pageSize: 2,
      cursor: first.data.pagination.nextCursor,
    },
  });
  assert.equal(second.success, true);
  if (!second.success || !("pagination" in second.data)) return;
  assert.deepEqual(
    second.data.items.map((item) => item.transactionId),
    [
      "txn_00000000000000000000000000000002",
      "txn_00000000000000000000000000000001",
    ],
  );
  assert.equal(second.data.pagination.hasMore, false);
  assert.equal(second.data.summary.monthExpenseInCents, 1000);
});

test("混合流水单次分页稳定返回收入和支出且筛选互不串数据", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  putTransaction(fixture, { sequence: 11, occurredAt: "2026-07-21T09:30:00.000Z", type: "expense", amountInCents: 1250 });
  putTransaction(fixture, { sequence: 12, occurredAt: "2026-07-21T09:30:00.000Z", type: "income", amountInCents: 500000 });
  putTransaction(fixture, { sequence: 13, occurredAt: "2026-07-20T09:30:00.000Z", type: "expense", amountInCents: 2300 });
  putTransaction(fixture, { sequence: 14, occurredAt: "2026-07-19T09:30:00.000Z", type: "income", amountInCents: 8000 });
  putTransaction(fixture, { sequence: 15, occurredAt: "2026-07-18T09:30:00.000Z", type: "income", isDeleted: true });
  putTransaction(fixture, { sequence: 16, occurredAt: "2026-07-17T09:30:00.000Z", ownerId: other.userId });

  const collected: TransactionRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await fixture.handler({
      action: "listTransactions",
      requestId: createRequestIdForTest(),
      payload: { filter: "all", year: 2026, month: 7, pageSize: 2, cursor },
    });
    assert.equal(page.success, true);
    if (!page.success || !("pagination" in page.data)) return;
    collected.push(
      ...page.data.items.map((value) =>
        fixture.store.transactions.get(value.transactionId),
      ).filter((value): value is TransactionRecord => value !== undefined),
    );
    cursor = page.data.pagination.nextCursor;
    assert.equal(page.data.summary.monthIncomeInCents, 508000);
    assert.equal(page.data.summary.monthExpenseInCents, 3550);
    assert.equal(page.data.summary.monthBalanceInCents, 504450);
  } while (cursor !== null);

  assert.deepEqual(
    collected.map((value) => value._id),
    [
      "txn_0000000000000000000000000000000c",
      "txn_0000000000000000000000000000000b",
      "txn_0000000000000000000000000000000d",
      "txn_0000000000000000000000000000000e",
    ],
  );
  assert.equal(new Set(collected.map((value) => value._id)).size, 4);

  const incomeOnly = await fixture.handler({
    action: "listTransactions",
    requestId: createRequestIdForTest(),
    payload: { filter: "income", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  assert.equal(incomeOnly.success, true);
  if (incomeOnly.success && "items" in incomeOnly.data && "summary" in incomeOnly.data) {
    assert.deepEqual(incomeOnly.data.items.map((value) => value.type), ["income", "income"]);
  }
});

test("独立月度汇总按用户、时区、收支类型和删除状态聚合", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, {
    userId: "usr_owner_b",
    openId: "openid-b",
  });
  putTransaction(fixture, {
    sequence: 31,
    occurredAt: "2026-07-21T09:30:00.000Z",
    amountInCents: 1250,
  });
  putTransaction(fixture, {
    sequence: 32,
    occurredAt: "2026-07-20T09:30:00.000Z",
    amountInCents: 8000,
    type: "income",
  });
  putTransaction(fixture, {
    sequence: 33,
    occurredAt: "2026-07-19T09:30:00.000Z",
    amountInCents: 500,
    isDeleted: true,
  });
  putTransaction(fixture, {
    sequence: 34,
    occurredAt: "2026-07-18T09:30:00.000Z",
    amountInCents: 900,
    ownerId: other.userId,
  });
  putTransaction(fixture, {
    sequence: 35,
    occurredAt: "2026-07-31T16:00:00.000Z",
    amountInCents: 700,
  });

  const response = await fixture.handler({
    action: "getMonthlySummary",
    requestId: "56565656-5656-4656-a656-565656565656",
    payload: { year: 2026, month: 7 },
  });
  assert.equal(response.success, true);
  if (!response.success || !("summary" in response.data)) return;
  assert.deepEqual(response.data.summary, {
    year: 2026,
    month: 7,
    monthExpenseInCents: 1250,
    monthIncomeInCents: 8000,
    monthBalanceInCents: 6750,
  });

  for (const [payload, code] of [
    [{ year: 26, month: 7 }, "INVALID_YEAR"],
    [{ year: 2026, month: 13 }, "INVALID_MONTH"],
    [{ year: 2026, month: 7, ownerId: fixture.seeded.userId }, "INVALID_ARGUMENT"],
  ] as const) {
    const invalid = await fixture.handler({
      action: "getMonthlySummary",
      requestId: "57575757-5757-4757-a757-575757575757",
      payload,
    });
    assert.equal(invalid.code, code);
  }

  fixture.store.failNextSummary();
  const failed = await fixture.handler({
    action: "getMonthlySummary",
    requestId: "58585858-5858-4858-a858-585858585858",
    payload: { year: 2026, month: 7 },
  });
  assert.equal(failed.code, "TRANSACTION_SUMMARY_FAILED");
});

test("月份范围按用户时区使用半开区间并正确跨年和处理闰年", () => {
  assert.deepEqual(
    getTransactionMonthRange(2026, 1, "Asia/Shanghai"),
    {
      startAt: new Date("2025-12-31T16:00:00.000Z"),
      endAt: new Date("2026-01-31T16:00:00.000Z"),
    },
  );
  assert.deepEqual(
    getTransactionMonthRange(2026, 12, "Asia/Shanghai"),
    {
      startAt: new Date("2026-11-30T16:00:00.000Z"),
      endAt: new Date("2026-12-31T16:00:00.000Z"),
    },
  );
  assert.deepEqual(
    getTransactionMonthRange(2024, 2, "Asia/Shanghai"),
    {
      startAt: new Date("2024-01-31T16:00:00.000Z"),
      endAt: new Date("2024-02-29T16:00:00.000Z"),
    },
  );
  assert.deepEqual(
    getTransactionMonthRange(2025, 2, "Asia/Shanghai"),
    {
      startAt: new Date("2025-01-31T16:00:00.000Z"),
      endAt: new Date("2025-02-28T16:00:00.000Z"),
    },
  );
});

test("流水查询拒绝非法年月、页大小、游标和跨月份旧游标", async () => {
  const fixture = createFixture();
  putTransaction(fixture, { sequence: 1, occurredAt: "2026-07-21T09:30:00.000Z" });
  for (const [payload, code] of [
    [{ filter: "expense", year: 26, month: 7, pageSize: 20, cursor: null }, "INVALID_YEAR"],
    [{ filter: "expense", year: 2026, month: 13, pageSize: 20, cursor: null }, "INVALID_MONTH"],
    [{ filter: "expense", year: 2026, month: 7, pageSize: 51, cursor: null }, "INVALID_PAGE_SIZE"],
    [{ filter: "expense", year: 2026, month: 7, pageSize: 20, cursor: "not-valid!" }, "INVALID_CURSOR"],
  ] as const) {
    const response = await fixture.handler({ action: "listTransactions", requestId: REQUEST_ID, payload });
    assert.equal(response.code, code);
  }

  const july = await fixture.handler({
    action: "listTransactions",
    requestId: REQUEST_ID,
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 1, cursor: null },
  });
  if (!july.success || !("pagination" in july.data)) return;
  putTransaction(fixture, { sequence: 2, occurredAt: "2026-07-20T09:30:00.000Z" });
  const page = await fixture.handler({
    action: "listTransactions",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 1, cursor: null },
  });
  if (!page.success || !("pagination" in page.data)) return;
  const wrongMonth = await fixture.handler({
    action: "listTransactions",
    requestId: "33333333-3333-4333-a333-333333333333",
    payload: { filter: "expense", year: 2026, month: 6, pageSize: 1, cursor: page.data.pagination.nextCursor },
  });
  assert.equal(wrongMonth.code, "INVALID_CURSOR");
  const wrongFilter = await fixture.handler({
    action: "listTransactions",
    requestId: "44444444-4444-4444-a444-444444444444",
    payload: {
      filter: "income",
      year: 2026,
      month: 7,
      pageSize: 1,
      cursor: page.data.pagination.nextCursor,
    },
  });
  assert.equal(wrongFilter.code, "INVALID_CURSOR");
});

test("空月份汇总为零且列表和汇总依赖失败返回各自受控错误", async () => {
  const fixture = createFixture();
  const empty = await fixture.handler({
    action: "listTransactions",
    requestId: REQUEST_ID,
    payload: { filter: "expense", year: 2026, month: 6, pageSize: 20, cursor: null },
  });
  assert.equal(empty.success, true);
  if (empty.success && "pagination" in empty.data) {
    assert.deepEqual(empty.data.items, []);
    assert.equal(empty.data.summary.monthExpenseInCents, 0);
    assert.equal(empty.data.summary.monthIncomeInCents, 0);
    assert.equal(empty.data.summary.monthBalanceInCents, 0);
  }

  fixture.store.failNextList();
  const listFailure = await fixture.handler({
    action: "listTransactions",
    requestId: "22222222-2222-4222-a222-222222222222",
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  assert.equal(listFailure.code, "TRANSACTION_LIST_FAILED");

  fixture.store.failNextSummary();
  const summaryFailure = await fixture.handler({
    action: "listTransactions",
    requestId: "33333333-3333-4333-a333-333333333333",
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  assert.equal(summaryFailure.code, "TRANSACTION_SUMMARY_FAILED");
});

test("支出编辑更新允许字段并保留归属、类型和创建时间", async () => {
  const fixture = createFixture();
  const originalCategory = fixture.store.categories.get(fixture.seeded.expenseCategoryId);
  const originalAccount = fixture.store.accounts.get(fixture.seeded.accountId);
  assert.ok(originalCategory);
  assert.ok(originalAccount);
  const alternateCategoryId = `${fixture.seeded.userId}_expense_alternate`;
  const alternateAccountId = `${fixture.seeded.userId}_account_alternate`;
  fixture.store.categories.set(alternateCategoryId, {
    ...originalCategory,
    _id: alternateCategoryId,
    systemKey: "test_alternate",
    name: "备用分类",
  });
  fixture.store.accounts.set(alternateAccountId, {
    ...originalAccount,
    _id: alternateAccountId,
    systemKey: "account_test_alternate",
    name: "备用账户",
  });
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const original = created.data.transaction;
  const response = await fixture.handler({
    action: "updateTransaction",
    requestId: "44444444-4444-4444-a444-444444444444",
    payload: {
      transactionId: original.transactionId,
      amountInCents: 1880,
      categoryId: alternateCategoryId,
      accountId: alternateAccountId,
      occurredAt: "2026-07-20T09:30:00.000Z",
      note: "  工作午餐  ",
      expectedVersion: 1,
    },
  });
  assert.equal(response.success, true);
  if (!response.success || !("updated" in response.data)) return;
  assert.equal(response.data.transaction.amountInCents, 1880);
  assert.equal(response.data.transaction.categoryId, alternateCategoryId);
  assert.equal(response.data.transaction.accountId, alternateAccountId);
  assert.equal(response.data.transaction.note, "工作午餐");
  assert.equal(response.data.transaction.version, 2);
  assert.equal(response.data.transaction.createdAt, original.createdAt);
  const stored = fixture.store.transactions.get(original.transactionId);
  assert.equal(stored?.ownerId, fixture.seeded.userId);
  assert.equal(stored?.type, "expense");
  assert.equal(stored?.isDeleted, false);
  assert.equal(stored?.updatedAt.toISOString(), NOW.toISOString());
});

test("编辑使用版本乐观锁且同 requestId 重试幂等", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const payload = {
    transactionId: created.data.transaction.transactionId,
    amountInCents: 1880,
    categoryId: fixture.seeded.expenseCategoryId,
    accountId: fixture.seeded.accountId,
    occurredAt: fixture.payload.occurredAt,
    note: "更新",
    expectedVersion: 1,
  };
  const requestId = "44444444-4444-4444-a444-444444444444";
  const first = await fixture.handler({ action: "updateTransaction", requestId, payload });
  const retry = await fixture.handler({ action: "updateTransaction", requestId, payload });
  assert.equal(first.success, true);
  assert.equal(retry.success, true);
  if (retry.success && "duplicate" in retry.data) assert.equal(retry.data.duplicate, true);
  assert.equal(fixture.store.transactions.get(payload.transactionId)?.version, 2);

  const conflict = await fixture.handler({
    action: "updateTransaction",
    requestId: "55555555-5555-4555-a555-555555555555",
    payload: { ...payload, amountInCents: 2000 },
  });
  assert.equal(conflict.code, "TRANSACTION_CONFLICT");
  assert.equal(fixture.store.transactions.get(payload.transactionId)?.amountInCents, 1880);

  const reused = await fixture.handler({
    action: "updateTransaction",
    requestId,
    payload: { ...payload, amountInCents: 1999 },
  });
  assert.equal(reused.code, "DUPLICATE_REQUEST");
});

test("编辑复用新增校验并拒绝他人账单", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const base = {
    transactionId: created.data.transaction.transactionId,
    amountInCents: 1880,
    categoryId: fixture.seeded.expenseCategoryId,
    accountId: fixture.seeded.accountId,
    occurredAt: fixture.payload.occurredAt,
    note: null,
    expectedVersion: 1,
  };
  const other = seedLedgerUser(fixture.store, { userId: "usr_owner_b", openId: "openid-b" });
  for (const [changes, code] of [
    [{ amountInCents: 0 }, "INVALID_AMOUNT"],
    [{ amountInCents: -1 }, "INVALID_AMOUNT"],
    [{ amountInCents: 12.5 }, "INVALID_AMOUNT"],
    [{ amountInCents: 10_000_000_000 }, "INVALID_AMOUNT"],
    [{ categoryId: "missing" }, "CATEGORY_NOT_FOUND"],
    [{ categoryId: fixture.seeded.incomeCategoryId }, "CATEGORY_TYPE_INVALID"],
    [{ categoryId: fixture.seeded.disabledCategoryId }, "CATEGORY_DISABLED"],
    [{ categoryId: other.expenseCategoryId }, "CATEGORY_NOT_OWNED"],
    [{ accountId: "missing" }, "ACCOUNT_NOT_FOUND"],
    [{ accountId: fixture.seeded.disabledAccountId }, "ACCOUNT_DISABLED"],
    [{ accountId: other.accountId }, "ACCOUNT_NOT_OWNED"],
    [{ occurredAt: "not-a-date" }, "INVALID_OCCURRED_AT"],
    [{ note: "x".repeat(201) }, "NOTE_TOO_LONG"],
  ] as const) {
    const result = await fixture.handler({
      action: "updateTransaction",
      requestId: createRequestIdForTest(),
      payload: { ...base, ...changes },
    });
    assert.equal(result.code, code);
  }
  const otherHandler = createLedgerFunctionHandler({ getOpenId: () => other.openId, getCurrentTime: () => NOW, store: fixture.store });
  const denied = await otherHandler({ action: "updateTransaction", requestId: "66666666-6666-4666-a666-666666666666", payload: base });
  assert.equal(denied.code, "TRANSACTION_NOT_FOUND");
});

test("跨月编辑后原月份移除且新月份列表和汇总包含新值", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const updated = await fixture.handler({
    action: "updateTransaction",
    requestId: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
    payload: {
      transactionId: created.data.transaction.transactionId,
      amountInCents: 1880,
      categoryId: fixture.seeded.expenseCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: "2026-06-20T09:30:00.000Z",
      note: null,
      expectedVersion: 1,
    },
  });
  assert.equal(updated.success, true);

  const july = await fixture.handler({
    action: "listTransactions",
    requestId: "ffffffff-ffff-4fff-afff-ffffffffffff",
    payload: { filter: "expense", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  const june = await fixture.handler({
    action: "listTransactions",
    requestId: "12121212-1212-4212-a212-121212121212",
    payload: { filter: "expense", year: 2026, month: 6, pageSize: 20, cursor: null },
  });
  assert.equal(july.success, true);
  assert.equal(june.success, true);
  if (july.success && "items" in july.data && "summary" in july.data) {
    assert.deepEqual(july.data.items, []);
    assert.equal(july.data.summary.monthExpenseInCents, 0);
  }
  if (june.success && "items" in june.data && "summary" in june.data) {
    assert.deepEqual(june.data.items.map((item) => item.transactionId), [created.data.transaction.transactionId]);
    assert.equal(june.data.summary.monthExpenseInCents, 1880);
  }
});

test("收入跨月编辑同步更新原月、新月流水与结余", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({
    action: "createTransaction",
    requestId: REQUEST_ID,
    payload: {
      ...fixture.payload,
      type: "income",
      categoryId: fixture.seeded.incomeCategoryId,
      includeInBudget: false,
      amountInCents: 500000,
    },
  });
  if (!created.success || !("transaction" in created.data)) return;
  const updated = await fixture.handler({
    action: "updateTransaction",
    requestId: createRequestIdForTest(),
    payload: {
      transactionId: created.data.transaction.transactionId,
      amountInCents: 520000,
      categoryId: fixture.seeded.incomeCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: "2026-06-20T09:30:00.000Z",
      note: "工资及补贴",
      expectedVersion: 1,
    },
  });
  assert.equal(updated.success, true);

  const july = await fixture.handler({
    action: "listTransactions",
    requestId: createRequestIdForTest(),
    payload: { filter: "all", year: 2026, month: 7, pageSize: 20, cursor: null },
  });
  const june = await fixture.handler({
    action: "listTransactions",
    requestId: createRequestIdForTest(),
    payload: { filter: "all", year: 2026, month: 6, pageSize: 20, cursor: null },
  });
  assert.equal(july.success, true);
  assert.equal(june.success, true);
  if (july.success && "pagination" in july.data) {
    assert.deepEqual(july.data.items, []);
    assert.equal(july.data.summary.monthIncomeInCents, 0);
    assert.equal(july.data.summary.monthBalanceInCents, 0);
  }
  if (june.success && "pagination" in june.data) {
    assert.deepEqual(june.data.items.map((value) => value.type), ["income"]);
    assert.equal(june.data.summary.monthIncomeInCents, 520000);
    assert.equal(june.data.summary.monthBalanceInCents, 520000);
  }
});

test("逻辑删除保留记录、退出列表汇总并支持同请求重试", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const transactionId = created.data.transaction.transactionId;
  const requestId = "77777777-7777-4777-a777-777777777777";
  const payload = { transactionId, expectedVersion: 1 };
  const deleted = await fixture.handler({ action: "deleteTransaction", requestId, payload });
  assert.equal(deleted.success, true);
  const stored = fixture.store.transactions.get(transactionId);
  assert.equal(stored?.isDeleted, true);
  assert.equal(stored?.deletedAt?.toISOString(), NOW.toISOString());
  assert.equal(stored?.createdAt.toISOString(), created.data.transaction.createdAt);

  const retry = await fixture.handler({ action: "deleteTransaction", requestId, payload });
  assert.equal(retry.success, true);
  if (retry.success && "alreadyDeleted" in retry.data) assert.equal(retry.data.alreadyDeleted, true);
  const different = await fixture.handler({ action: "deleteTransaction", requestId: "88888888-8888-4888-a888-888888888888", payload: { transactionId, expectedVersion: 2 } });
  assert.equal(different.code, "TRANSACTION_ALREADY_DELETED");
  const detail = await fixture.handler({ action: "getTransaction", requestId: "99999999-9999-4999-a999-999999999999", payload: { transactionId } });
  assert.equal(detail.code, "TRANSACTION_NOT_FOUND");
  const list = await fixture.handler({ action: "listTransactions", requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", payload: { filter: "expense", year: 2026, month: 7, pageSize: 20, cursor: null } });
  assert.equal(list.success, true);
  if (list.success && "items" in list.data && "summary" in list.data) {
    assert.deepEqual(list.data.items, []);
    assert.equal(list.data.summary.monthExpenseInCents, 0);
  }
});

test("删除拒绝旧版本和跨用户 transactionId", async () => {
  const fixture = createFixture();
  const created = await fixture.handler({ action: "createTransaction", requestId: REQUEST_ID, payload: fixture.payload });
  if (!created.success || !("transaction" in created.data)) return;
  const transactionId = created.data.transaction.transactionId;
  const conflict = await fixture.handler({
    action: "deleteTransaction",
    requestId: "cccccccc-cccc-4ccc-accc-cccccccccccc",
    payload: { transactionId, expectedVersion: 99 },
  });
  assert.equal(conflict.code, "TRANSACTION_CONFLICT");
  assert.equal(fixture.store.transactions.get(transactionId)?.isDeleted, false);

  const other = seedLedgerUser(fixture.store, { userId: "usr_owner_b", openId: "openid-b" });
  const otherHandler = createLedgerFunctionHandler({ getOpenId: () => other.openId, getCurrentTime: () => NOW, store: fixture.store });
  const denied = await otherHandler({
    action: "deleteTransaction",
    requestId: "dddddddd-dddd-4ddd-addd-dddddddddddd",
    payload: { transactionId, expectedVersion: 1 },
  });
  assert.equal(denied.code, "TRANSACTION_NOT_FOUND");
  assert.equal(fixture.store.transactions.get(transactionId)?.isDeleted, false);
});

let testRequestSequence = 0;
function createRequestIdForTest(): string {
  testRequestSequence += 1;
  return `bbbbbbbb-bbbb-4bbb-abbb-${testRequestSequence.toString().padStart(12, "0")}`;
}
