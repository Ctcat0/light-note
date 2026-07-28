import assert from "node:assert/strict";
import test from "node:test";

import { createLedgerFunctionHandler } from "../cloudfunctions/ledger/src/application/handler";
import type { TransactionRecord } from "../cloudfunctions/ledger/src/domain/types";
import { InMemoryLedgerStore, seedLedgerUser } from "./helpers/in-memory-ledger-store";

const NOW = new Date("2026-07-22T08:00:00.000Z");
let sequence = 0;

function requestId(): string {
  sequence += 1;
  return `10000000-0000-4000-a000-${String(sequence).padStart(12, "0")}`;
}

function createFixture() {
  const store = new InMemoryLedgerStore();
  const seeded = seedLedgerUser(store);
  const handler = createLedgerFunctionHandler({
    getOpenId: () => seeded.openId,
    getCurrentTime: () => new Date(NOW),
    store,
  });
  return { store, seeded, handler };
}

function putTransaction(
  fixture: ReturnType<typeof createFixture>,
  options: {
    occurredAt: string;
    type: "expense" | "income";
    amountInCents: number;
    categoryId?: string;
    ownerId?: string;
    isDeleted?: boolean;
  },
): TransactionRecord {
  sequence += 1;
  const occurredAt = new Date(options.occurredAt);
  const id = `txn_${sequence.toString(16).padStart(32, "0")}`;
  const record: TransactionRecord = {
    _id: id,
    ownerId: options.ownerId ?? fixture.seeded.userId,
    type: options.type,
    amountInCents: options.amountInCents,
    categoryId: options.categoryId ?? (options.type === "expense" ? fixture.seeded.expenseCategoryId : fixture.seeded.incomeCategoryId),
    accountId: fixture.seeded.accountId,
    occurredAt,
    occurredDateKey: options.occurredAt.slice(0, 10),
    merchant: null,
    note: null,
    tags: [],
    attachmentUrls: [],
    includeInBudget: options.type === "expense",
    requestId: `seed-${sequence}`,
    isDeleted: options.isDeleted ?? false,
    deletedAt: options.isDeleted ? NOW : null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    version: 1,
  };
  fixture.store.transactions.set(id, record);
  return record;
}

test("月度统计仅聚合当前用户未删除收支并返回整数金额和笔数", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, { userId: "usr_b", openId: "openid-b" });
  putTransaction(fixture, { occurredAt: "2026-07-02T04:00:00.000Z", type: "income", amountInCents: 500000 });
  putTransaction(fixture, { occurredAt: "2026-07-03T04:00:00.000Z", type: "expense", amountInCents: 1250 });
  putTransaction(fixture, { occurredAt: "2026-07-04T04:00:00.000Z", type: "expense", amountInCents: 300, isDeleted: true });
  putTransaction(fixture, { occurredAt: "2026-07-05T04:00:00.000Z", type: "income", amountInCents: 900000, ownerId: other.userId });

  const response = await fixture.handler({
    action: "getStatisticsSummary",
    requestId: requestId(),
    payload: { year: 2026, month: 7 },
  });
  assert.equal(response.success, true);
  if (!response.success || !("monthIncomeInCents" in response.data)) return;
  assert.deepEqual(response.data, {
    year: 2026,
    month: 7,
    monthIncomeInCents: 500000,
    monthExpenseInCents: 1250,
    monthBalanceInCents: 498750,
    incomeCount: 1,
    expenseCount: 1,
  });
});

test("趋势统计跨年按旧到新补齐空月份且支持 6/12 个月", async () => {
  const fixture = createFixture();
  putTransaction(fixture, { occurredAt: "2025-12-15T04:00:00.000Z", type: "expense", amountInCents: 1000 });
  putTransaction(fixture, { occurredAt: "2026-02-15T04:00:00.000Z", type: "income", amountInCents: 8000 });

  const response = await fixture.handler({
    action: "getStatisticsTrend",
    requestId: requestId(),
    payload: { endYear: 2026, endMonth: 3, monthCount: 6 },
  });
  assert.equal(response.success, true);
  if (!response.success || !("items" in response.data) || !("monthCount" in response.data)) return;
  assert.deepEqual(response.data.items.map((item) => item.monthKey), [
    "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
  ]);
  assert.equal(response.data.items[2]?.expenseInCents, 1000);
  assert.equal(response.data.items[3]?.incomeInCents, 0);
  assert.equal(response.data.items[4]?.balanceInCents, 8000);

  const twelveMonths = await fixture.handler({
    action: "getStatisticsTrend",
    requestId: requestId(),
    payload: { endYear: 2026, endMonth: 3, monthCount: 12 },
  });
  assert.equal(twelveMonths.success, true);
  if (
    !twelveMonths.success ||
    !("items" in twelveMonths.data) ||
    !("monthCount" in twelveMonths.data)
  ) return;
  assert.equal(twelveMonths.data.items.length, 12);
  assert.equal(twelveMonths.data.items[0]?.monthKey, "2025-04");
  assert.equal(twelveMonths.data.items[11]?.monthKey, "2026-03");

  const invalid = await fixture.handler({
    action: "getStatisticsTrend",
    requestId: requestId(),
    payload: { endYear: 2026, endMonth: 3, monthCount: 7 },
  });
  assert.equal(invalid.code, "INVALID_MONTH_COUNT");
});

test("分类统计按金额降序、合计一致并保留已删除分类金额", async () => {
  const fixture = createFixture();
  const original = fixture.store.categories.get(fixture.seeded.expenseCategoryId);
  assert.ok(original);
  const travelCategoryId = `${fixture.seeded.userId}_travel`;
  fixture.store.categories.set(travelCategoryId, {
    ...original,
    _id: travelCategoryId,
    name: "旅行",
    icon: "travel",
  });
  const removedCategoryId = `${fixture.seeded.userId}_removed`;
  putTransaction(fixture, { occurredAt: "2026-07-02T04:00:00.000Z", type: "expense", amountInCents: 5000, categoryId: travelCategoryId });
  putTransaction(fixture, { occurredAt: "2026-07-03T04:00:00.000Z", type: "expense", amountInCents: 3000 });
  putTransaction(fixture, { occurredAt: "2026-07-04T04:00:00.000Z", type: "expense", amountInCents: 2000, categoryId: removedCategoryId });

  const response = await fixture.handler({
    action: "getCategoryStatistics",
    requestId: requestId(),
    payload: { year: 2026, month: 7, type: "expense" },
  });
  assert.equal(response.success, true);
  if (!response.success || !("totalAmountInCents" in response.data)) return;
  assert.equal(response.data.totalAmountInCents, 10000);
  assert.equal(response.data.totalCount, 3);
  assert.deepEqual(response.data.items.map((item) => item.amountInCents), [5000, 3000, 2000]);
  assert.equal(response.data.items[2]?.categoryName, "已删除分类");
  assert.equal(response.data.items[2]?.categoryIcon, "other");
  assert.deepEqual(response.data.items.map((item) => item.ratioBasisPoints), [5000, 3000, 2000]);

  const summary = await fixture.handler({
    action: "getStatisticsSummary",
    requestId: requestId(),
    payload: { year: 2026, month: 7 },
  });
  assert.equal(summary.success, true);
  if (!summary.success || !("monthExpenseInCents" in summary.data)) return;
  assert.equal(response.data.totalAmountInCents, summary.data.monthExpenseInCents);
});

test("分类流水筛选绑定类型和游标且不会暴露其他用户记录", async () => {
  const fixture = createFixture();
  const other = seedLedgerUser(fixture.store, { userId: "usr_c", openId: "openid-c" });
  putTransaction(fixture, { occurredAt: "2026-07-03T04:00:00.000Z", type: "expense", amountInCents: 100 });
  putTransaction(fixture, { occurredAt: "2026-07-02T04:00:00.000Z", type: "expense", amountInCents: 200 });
  putTransaction(fixture, { occurredAt: "2026-07-01T04:00:00.000Z", type: "expense", amountInCents: 999, ownerId: other.userId, categoryId: fixture.seeded.expenseCategoryId });

  const first = await fixture.handler({
    action: "listTransactions",
    requestId: requestId(),
    payload: { filter: "expense", categoryId: fixture.seeded.expenseCategoryId, year: 2026, month: 7, pageSize: 1, cursor: null },
  });
  assert.equal(first.success, true);
  if (!first.success || !("pagination" in first.data)) return;
  assert.equal(first.data.items.length, 1);
  const wrongCategory = await fixture.handler({
    action: "listTransactions",
    requestId: requestId(),
    payload: { filter: "expense", categoryId: "another-category", year: 2026, month: 7, pageSize: 1, cursor: first.data.pagination.nextCursor },
  });
  assert.equal(wrongCategory.code, "INVALID_CURSOR");
});

test("交易新增、编辑和删除只修改账单事实，不修改固定资金渠道", async () => {
  const fixture = createFixture();
  const before = structuredClone(fixture.store.accounts.get(fixture.seeded.accountId));
  const created = await fixture.handler({
    action: "createTransaction",
    requestId: requestId(),
    payload: {
      type: "expense",
      amountInCents: 1250,
      categoryId: fixture.seeded.expenseCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: "2026-07-20T04:00:00.000Z",
      note: null,
      merchant: null,
      includeInBudget: true,
    },
  });
  assert.equal(created.success, true);
  if (!created.success || !("transaction" in created.data)) return;
  assert.deepEqual(fixture.store.accounts.get(fixture.seeded.accountId), before);

  const updated = await fixture.handler({
    action: "updateTransaction",
    requestId: requestId(),
    payload: {
      transactionId: created.data.transaction.transactionId,
      amountInCents: 1880,
      categoryId: fixture.seeded.expenseCategoryId,
      accountId: fixture.seeded.accountId,
      occurredAt: "2026-07-20T04:00:00.000Z",
      note: "更新",
      expectedVersion: 1,
    },
  });
  assert.equal(updated.success, true);
  assert.deepEqual(fixture.store.accounts.get(fixture.seeded.accountId), before);

  const deleted = await fixture.handler({
    action: "deleteTransaction",
    requestId: requestId(),
    payload: {
      transactionId: created.data.transaction.transactionId,
      expectedVersion: 2,
    },
  });
  assert.equal(deleted.success, true);
  assert.deepEqual(fixture.store.accounts.get(fixture.seeded.accountId), before);
});
