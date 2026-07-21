import assert from "node:assert/strict";
import test from "node:test";

import { createLedgerService } from "../miniprogram/services/ledger";

const transactionResponse = {
  transactionId: "txn_1",
  type: "expense",
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
  status: "active",
  version: 1,
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
};

test("ledger service 使用指定 requestId 创建支出且不发送身份字段", async () => {
  const calls: object[] = [];
  const service = createLedgerService(async (options) => {
    calls.push(options);
    return {
      data: options.parseData({
        transaction: transactionResponse,
        created: true,
        duplicate: false,
      }),
      requestId: options.requestId,
      serverTime: "2026-07-21T10:00:00.000Z",
    };
  });
  const requestId = "11111111-1111-4111-a111-111111111111";
  const result = await service.createExpense(
    {
      type: "expense",
      amountInCents: 1250,
      categoryId: "category-a",
      accountId: "account-a",
      occurredAt: "2026-07-21T09:30:00.000Z",
      note: "午餐",
      merchant: null,
      includeInBudget: true,
    },
    requestId,
  );

  assert.equal(result.transaction.amountInCents, 1250);
  const serialized = JSON.stringify(calls[0]);
  assert.match(serialized, new RegExp(requestId));
  assert.doesNotMatch(serialized, /ownerId|openId|userId/);
});

test("ledger service 显式发送收入类型并严格解析收入账单", async () => {
  const calls: object[] = [];
  const incomeTransaction = {
    ...transactionResponse,
    type: "income",
    includeInBudget: false,
    categoryId: "income-category-a",
  };
  const service = createLedgerService(async (options) => {
    calls.push(options);
    return {
      data: options.parseData({
        transaction: incomeTransaction,
        created: true,
        duplicate: false,
      }),
      requestId: options.requestId,
      serverTime: transactionResponse.updatedAt,
    };
  });
  const result = await service.createTransaction(
    {
      type: "income",
      amountInCents: 1250,
      categoryId: "income-category-a",
      accountId: "account-a",
      occurredAt: transactionResponse.occurredAt,
      note: null,
      merchant: null,
      includeInBudget: false,
    },
    "22222222-2222-4222-a222-222222222222",
  );
  assert.equal(result.transaction.type, "income");
  assert.match(JSON.stringify(calls[0]), /"type":"income"/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /ownerId|openId|userId/);
});

test("ledger service 拒绝不符合契约的交易响应", async () => {
  const service = createLedgerService(async (options) => ({
    data: options.parseData({ transaction: { ...transactionResponse, amountInCents: 12.5 } }),
    requestId: options.requestId,
    serverTime: "2026-07-21T10:00:00.000Z",
  }));
  await assert.rejects(() => service.getTransaction("txn_1"), /响应格式无效/);
});

test("ledger service 发送月份游标查询且严格解析列表和全月汇总", async () => {
  const calls: object[] = [];
  const service = createLedgerService(async (options) => {
    calls.push(options);
    return {
      data: options.parseData({
        items: [
          {
            transactionId: "txn_1",
            type: "expense",
            amountInCents: 1250,
            categoryId: "category-a",
            categoryName: "餐饮",
            categoryIcon: "餐",
            accountId: "account-a",
            accountName: "微信",
            accountIcon: "微",
            occurredAt: "2026-07-21T09:30:00.000Z",
            occurredDateKey: "2026-07-21",
            note: "午餐",
            status: "active",
            createdAt: "2026-07-21T10:00:00.000Z",
          },
        ],
        pagination: { pageSize: 20, nextCursor: null, hasMore: false },
        summary: {
          year: 2026,
          month: 7,
          monthExpenseInCents: 4430,
          monthIncomeInCents: 8000,
          monthBalanceInCents: 3570,
        },
      }),
      requestId: options.requestId,
      serverTime: "2026-07-21T10:00:00.000Z",
    };
  });
  const result = await service.listExpenseTransactions({
    year: 2026,
    month: 7,
    pageSize: 20,
    cursor: null,
  });
  assert.equal(result.items[0]?.amountInCents, 1250);
  assert.equal(result.summary.monthExpenseInCents, 4430);
  const serialized = JSON.stringify(calls[0]);
  assert.match(serialized, /listTransactions/);
  assert.match(serialized, /"type":"expense"/);
  assert.doesNotMatch(serialized, /ownerId|openId|userId/);
});

test("ledger service 调用独立月度汇总且校验整数结余关系", async () => {
  const calls: object[] = [];
  const service = createLedgerService(async (options) => {
    calls.push(options);
    return {
      data: options.parseData({
        summary: {
          year: 2026,
          month: 7,
          monthExpenseInCents: 1250,
          monthIncomeInCents: 8000,
          monthBalanceInCents: 6750,
        },
      }),
      requestId: options.requestId,
      serverTime: "2026-07-21T10:00:00.000Z",
    };
  });
  const result = await service.getMonthlySummary({ year: 2026, month: 7 });
  assert.equal(result.summary.monthBalanceInCents, 6750);
  const serialized = JSON.stringify(calls[0]);
  assert.match(serialized, /getMonthlySummary/);
  assert.doesNotMatch(serialized, /ownerId|openId|userId/);

  const invalid = createLedgerService(async (options) => ({
    data: options.parseData({
      summary: {
        year: 2026,
        month: 7,
        monthExpenseInCents: 1250,
        monthIncomeInCents: 8000,
        monthBalanceInCents: 1,
      },
    }),
    requestId: options.requestId,
    serverTime: "2026-07-21T10:00:00.000Z",
  }));
  await assert.rejects(
    () => invalid.getMonthlySummary({ year: 2026, month: 7 }),
    /汇总响应数据无效/,
  );
});

test("ledger service 拒绝不一致的分页响应和浮点汇总", async () => {
  for (const response of [
    {
      items: [],
      pagination: { pageSize: 20, nextCursor: null, hasMore: true },
      summary: {
        year: 2026,
        month: 7,
        monthExpenseInCents: 0,
        monthIncomeInCents: 0,
        monthBalanceInCents: 0,
      },
    },
    {
      items: [],
      pagination: { pageSize: 20, nextCursor: null, hasMore: false },
      summary: {
        year: 2026,
        month: 7,
        monthExpenseInCents: 12.5,
        monthIncomeInCents: 0,
        monthBalanceInCents: 0,
      },
    },
  ]) {
    const service = createLedgerService(async (options) => ({
      data: options.parseData(response),
      requestId: options.requestId,
      serverTime: "2026-07-21T10:00:00.000Z",
    }));
    await assert.rejects(
      () => service.listExpenseTransactions({ year: 2026, month: 7, pageSize: 20, cursor: null }),
      /响应/,
    );
  }
});

test("ledger service 更新和删除支出时不发送身份字段并解析严格响应", async () => {
  const calls: object[] = [];
  const service = createLedgerService(async (options) => {
    calls.push(options);
    const data = options.action === "updateTransaction"
      ? {
          transaction: { ...transactionResponse, amountInCents: 1880, version: 2 },
          updated: true,
          duplicate: false,
          previousOccurredAt: transactionResponse.occurredAt,
        }
      : {
          transactionId: transactionResponse.transactionId,
          deleted: true,
          alreadyDeleted: false,
          previousOccurredAt: transactionResponse.occurredAt,
          version: 3,
          updatedAt: transactionResponse.updatedAt,
        };
    return {
      data: options.parseData(data),
      requestId: options.requestId,
      serverTime: transactionResponse.updatedAt,
    };
  });
  const update = await service.updateExpense(
    {
      transactionId: "txn_1",
      amountInCents: 1880,
      categoryId: "category-a",
      accountId: "account-a",
      occurredAt: transactionResponse.occurredAt,
      note: null,
      expectedVersion: 1,
    },
    "44444444-4444-4444-a444-444444444444",
  );
  assert.equal(update.transaction.version, 2);
  const deleted = await service.deleteExpense(
    { transactionId: "txn_1", expectedVersion: 2 },
    "55555555-5555-4555-a555-555555555555",
  );
  assert.equal(deleted.deleted, true);
  assert.doesNotMatch(JSON.stringify(calls), /ownerId|openId|userId/);
});
