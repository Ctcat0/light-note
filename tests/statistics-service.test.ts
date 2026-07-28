import assert from "node:assert/strict";
import test from "node:test";

import { createStatisticsService } from "../miniprogram/services/statistics";

test("statistics service 使用 ledger 只读 action 且不发送身份字段", async () => {
  const calls: object[] = [];
  const service = createStatisticsService(async (options) => {
    calls.push(options);
    const data = options.action === "getStatisticsSummary"
      ? {
          year: 2026, month: 7, monthIncomeInCents: 5000,
          monthExpenseInCents: 1200, monthBalanceInCents: 3800,
          incomeCount: 1, expenseCount: 2,
        }
      : options.action === "getStatisticsTrend"
        ? {
            endYear: 2026, endMonth: 7, monthCount: 6,
            items: Array.from({ length: 6 }, (_, index) => ({
              year: 2026, month: index + 2, monthKey: `2026-0${index + 2}`,
              incomeInCents: 0, expenseInCents: 0, balanceInCents: 0,
            })),
          }
        : {
            year: 2026, month: 7, type: "expense",
            totalAmountInCents: 1200, totalCount: 2,
            items: [{ categoryId: "cat", categoryName: "餐饮", categoryIcon: "food", amountInCents: 1200, count: 2, ratioBasisPoints: 10000 }],
          };
    return { data: options.parseData(data), requestId: options.requestId, serverTime: "2026-07-22T08:00:00.000Z" };
  });

  const summary = await service.getSummary({ year: 2026, month: 7 });
  const trend = await service.getTrend({ endYear: 2026, endMonth: 7, monthCount: 6 });
  const category = await service.getCategoryStatistics({ year: 2026, month: 7, type: "expense" });
  assert.equal(summary.monthBalanceInCents, 3800);
  assert.equal(trend.items.length, 6);
  assert.equal(category.items[0]?.ratioBasisPoints, 10000);
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /getStatisticsSummary/);
  assert.match(serialized, /getStatisticsTrend/);
  assert.match(serialized, /getCategoryStatistics/);
  assert.doesNotMatch(serialized, /ownerId|openId|userId/);
});

test("statistics service 拒绝结余、趋势长度和分类合计不一致", async () => {
  const service = createStatisticsService(async (options) => ({
    data: options.parseData({
      year: 2026, month: 7, monthIncomeInCents: 100,
      monthExpenseInCents: 50, monthBalanceInCents: 99,
      incomeCount: 1, expenseCount: 1,
    }),
    requestId: options.requestId,
    serverTime: "2026-07-22T08:00:00.000Z",
  }));
  await assert.rejects(() => service.getSummary({ year: 2026, month: 7 }), /响应格式无效/);
});
