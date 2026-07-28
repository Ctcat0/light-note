import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TRANSACTION_AMOUNT_IN_CENTS,
} from "../miniprogram/constants/transaction";
import {
  normalizeYuanInput,
  parseYuanInputToCents,
} from "../miniprogram/utils/money";
import {
  validateExpenseTransactionForm,
  validateTransactionForm,
} from "../miniprogram/utils/transaction-form";
import type { TransactionFormState } from "../miniprogram/types/transaction";
import {
  createTransactionEditForm,
  createUpdateExpensePayload,
  isExpenseTransactionDirty,
} from "../miniprogram/utils/transaction-edit";

test("金额输入通过字符串算法转换为整数分", () => {
  const cases: Array<[string, number]> = [
    ["0.01", 1],
    ["0.1", 10],
    ["1", 100],
    ["1.20", 120],
    ["12.34", 1234],
    [".5", 50],
    ["01.20", 120],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseYuanInputToCents(input), expected);
  }
});

test("金额输入拒绝零、负数、非法字符、多小数点、三位小数和超限值", () => {
  for (const input of ["", "0", "-1", "1.234", "abc", "1.2.3", "Infinity"]) {
    assert.throws(() => parseYuanInputToCents(input));
  }
  assert.throws(() =>
    parseYuanInputToCents(String(MAX_TRANSACTION_AMOUNT_IN_CENTS / 100 + 1)),
  );
  assert.equal(normalizeYuanInput("1.234", "1.23"), "1.23");
  assert.equal(normalizeYuanInput(".5", ""), "0.5");
});

test("表单校验要求金额、分类、账户和合法时间并 trim 备注", () => {
  const form: TransactionFormState = {
    amountInput: "12.50",
    categoryId: "category-a",
    accountId: "account-a",
    dateValue: "2026-07-21",
    timeValue: "17:30",
    note: "  午餐  ",
    requestId: "11111111-1111-4111-a111-111111111111",
  };
  const result = validateExpenseTransactionForm(form, {
    now: new Date("2026-07-21T10:00:00.000Z"),
    timeZone: "Asia/Shanghai",
  });
  assert.equal(result.payload?.amountInCents, 1250);
  assert.equal(result.payload?.occurredAt, "2026-07-21T09:30:00.000Z");
  assert.equal(result.payload?.note, "午餐");
  const income = validateTransactionForm(form, "income", {
    now: new Date("2026-07-21T10:00:00.000Z"),
    timeZone: "Asia/Shanghai",
  });
  assert.equal(income.payload?.type, "income");
  assert.equal(income.payload?.includeInBudget, false);

  const invalid = validateExpenseTransactionForm(
    { ...form, amountInput: "0", categoryId: "", accountId: "" },
    { now: new Date("2026-07-21T10:00:00.000Z") },
  );
  assert.equal(invalid.payload, null);
  assert.notEqual(invalid.errors.amount, "");
  assert.notEqual(invalid.errors.category, "");
  assert.notEqual(invalid.errors.account, "");
});

test("表单拒绝超长备注和超过服务器当前时间五分钟的发生时间", () => {
  const form: TransactionFormState = {
    amountInput: "1",
    categoryId: "category-a",
    accountId: "account-a",
    dateValue: "2026-07-21",
    timeValue: "18:06",
    note: "x".repeat(201),
    requestId: "11111111-1111-4111-a111-111111111111",
  };
  const result = validateExpenseTransactionForm(form, {
    now: new Date("2026-07-21T10:00:00.000Z"),
    timeZone: "Asia/Shanghai",
  });
  assert.equal(result.payload, null);
  assert.notEqual(result.errors.note, "");
  assert.notEqual(result.errors.occurredAt, "");
});

test("编辑表单以整数分和标准时间初始化并使用规范化值判断 dirty", () => {
  const transaction = {
    transactionId: "txn_1",
    type: "expense" as const,
    amountInCents: 1250,
    categoryId: "category-a",
    accountId: "account-a",
    occurredAt: "2026-07-21T09:30:00.000Z",
    occurredDateKey: "2026-07-21",
    merchant: null,
    note: "午餐",
    tags: [],
    attachmentUrls: [],
    includeInBudget: true,
    status: "active" as const,
    version: 1,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
  };
  const form = createTransactionEditForm(
    transaction,
    "Asia/Shanghai",
    "44444444-4444-4444-a444-444444444444",
  );
  assert.equal(form.amountInput, "12.50");
  const unchanged = createUpdateExpensePayload(form, transaction, "Asia/Shanghai");
  assert.equal(isExpenseTransactionDirty(unchanged, transaction), false);
  const changed = createUpdateExpensePayload(
    { ...form, amountInput: "18.80", note: "  工作午餐  " },
    transaction,
    "Asia/Shanghai",
  );
  assert.equal(changed?.amountInCents, 1880);
  assert.equal(changed?.note, "工作午餐");
  assert.equal(isExpenseTransactionDirty(changed, transaction), true);
});
