import assert from "node:assert/strict";
import test from "node:test";

import type { TransactionListItem } from "../shared/types/transaction";
import {
  canLoadMoreTransactions,
  calculateDayExpense,
  calculateDayIncome,
  getTransactionListSuccessStatus,
  groupTransactionsByDay,
  isCurrentTransactionListRequest,
  mergeTransactionPages,
} from "../miniprogram/utils/transaction-list";
import {
  markTransactionListStale,
  readTransactionListRefreshSignal,
} from "../miniprogram/services/transaction-list-refresh";

function item(
  transactionId: string,
  occurredAt: string,
  occurredDateKey: string,
  amountInCents: number,
  type: "expense" | "income" = "expense",
): TransactionListItem {
  return {
    transactionId,
    type,
    amountInCents,
    categoryId: "category-a",
    categoryName: "餐饮",
    categoryIcon: "餐",
    accountId: "account-a",
    accountName: "微信",
    accountIcon: "微",
    occurredAt,
    occurredDateKey,
    note: null,
    status: "active",
    createdAt: occurredAt,
  };
}

test("合并分页按 ID 去重、稳定倒序且不修改输入", () => {
  const original = item("txn_a", "2026-07-21T09:00:00.000Z", "2026-07-21", 100);
  const existing = [original];
  const incoming = [
    item("txn_b", "2026-07-21T09:00:00.000Z", "2026-07-21", 200),
    { ...original, amountInCents: 150 },
  ];
  const existingSnapshot = JSON.stringify(existing);
  const incomingSnapshot = JSON.stringify(incoming);
  const merged = mergeTransactionPages(existing, incoming);
  assert.deepEqual(merged.map((value) => value.transactionId), ["txn_b", "txn_a"]);
  assert.equal(merged[1]?.amountInCents, 150);
  assert.equal(JSON.stringify(existing), existingSnapshot);
  assert.equal(JSON.stringify(incoming), incomingSnapshot);
});

test("跨页同日记录合并为一组并用整数分计算每日小计", () => {
  const pageOne = [item("txn_c", "2026-07-21T10:00:00.000Z", "2026-07-21", 1250)];
  const pageTwo = [
    item("txn_b", "2026-07-21T09:00:00.000Z", "2026-07-21", 2300),
    item("txn_a", "2026-07-20T09:00:00.000Z", "2026-07-20", 880),
  ];
  const groups = groupTransactionsByDay(
    mergeTransactionPages(pageOne, pageTwo),
    "Asia/Shanghai",
  );
  assert.deepEqual(groups.map((group) => group.dateKey), ["2026-07-21", "2026-07-20"]);
  assert.equal(groups[0]?.items.length, 2);
  assert.equal(groups[0]?.expenseInCents, 3550);
  assert.equal(groups[0]?.expenseDisplay, "35.50");
  assert.equal(groups[1]?.expenseInCents, 880);
});

test("按日收支小计相互独立且全部使用整数分", () => {
  const values = [
    item("txn_expense", "2026-07-21T10:00:00.000Z", "2026-07-21", 1250),
    item("txn_income", "2026-07-21T09:00:00.000Z", "2026-07-21", 8000, "income"),
  ];
  const groups = groupTransactionsByDay(values, "Asia/Shanghai");
  assert.equal(groups[0]?.expenseInCents, 1250);
  assert.equal(groups[0]?.incomeInCents, 8000);
  assert.equal(groups[0]?.incomeDisplay, "80.00");
  assert.equal(calculateDayIncome(values), 8000);
});

test("分组空输入为空且金额校验拒绝非整数分", () => {
  assert.deepEqual(groupTransactionsByDay([], "Asia/Shanghai"), []);
  assert.equal(calculateDayExpense([]), 0);
  assert.throws(() =>
    calculateDayExpense([
      item("txn_invalid", "2026-07-21T09:00:00.000Z", "2026-07-21", 12.5),
    ]),
  );
});

test("列表状态区分空、无更多并阻止重复加载更多", () => {
  assert.equal(getTransactionListSuccessStatus(0, false), "empty");
  assert.equal(getTransactionListSuccessStatus(1, true), "ready");
  assert.equal(getTransactionListSuccessStatus(1, false), "noMore");
  assert.equal(
    canLoadMoreTransactions({ hasMore: false, nextCursor: null, loadStatus: "noMore" }),
    false,
  );
  assert.equal(
    canLoadMoreTransactions({ hasMore: true, nextCursor: "cursor", loadStatus: "loadingMore" }),
    false,
  );
  assert.equal(
    canLoadMoreTransactions({ hasMore: true, nextCursor: "cursor", loadStatus: "loadMoreError" }),
    false,
  );
  assert.equal(
    canLoadMoreTransactions({ hasMore: true, nextCursor: "cursor", loadStatus: "ready" }),
    true,
  );
});

test("过期月份响应被忽略且新增成功信号携带单调版本和目标月份", () => {
  assert.equal(
    isCurrentTransactionListRequest({
      destroyed: false,
      activeRequestVersion: 3,
      responseRequestVersion: 2,
      activeYear: 2026,
      activeMonth: 8,
      responseYear: 2026,
      responseMonth: 7,
    }),
    false,
  );
  assert.equal(
    isCurrentTransactionListRequest({
      destroyed: false,
      activeRequestVersion: 3,
      responseRequestVersion: 3,
      activeYear: 2026,
      activeMonth: 8,
      responseYear: 2026,
      responseMonth: 8,
    }),
    true,
  );
  const before = readTransactionListRefreshSignal()?.revision ?? 0;
  const signal = markTransactionListStale({ year: 2026, month: 7 });
  assert.equal(signal.revision, before + 1);
  assert.deepEqual(readTransactionListRefreshSignal(), signal);
  const crossMonth = markTransactionListStale(
    { year: 2026, month: 7 },
    [{ year: 2026, month: 6 }],
  );
  assert.deepEqual(crossMonth.affectedMonths, [
    { year: 2026, month: 7 },
    { year: 2026, month: 6 },
  ]);
});
