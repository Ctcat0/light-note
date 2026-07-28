import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRatioBasisPoints,
  getStatisticsBarWidth,
  isCurrentStatisticsRequest,
} from "../miniprogram/utils/statistics";

test("统计占比与原生条形宽度保持受控且零值可访问", () => {
  assert.equal(formatRatioBasisPoints(7025), "70.25%");
  assert.equal(formatRatioBasisPoints(5000), "50%");
  assert.equal(getStatisticsBarWidth(0, 100), 0);
  assert.equal(getStatisticsBarWidth(1, 1000), 4);
  assert.equal(getStatisticsBarWidth(1000, 1000), 100);
});

test("统计页忽略过期、跨月和卸载后的响应", () => {
  const base = {
    destroyed: false,
    activeRequestVersion: 2,
    responseRequestVersion: 2,
    activeYear: 2026,
    activeMonth: 7,
    responseYear: 2026,
    responseMonth: 7,
  };
  assert.equal(isCurrentStatisticsRequest(base), true);
  assert.equal(isCurrentStatisticsRequest({ ...base, responseRequestVersion: 1 }), false);
  assert.equal(isCurrentStatisticsRequest({ ...base, responseMonth: 6 }), false);
  assert.equal(isCurrentStatisticsRequest({ ...base, destroyed: true }), false);
});
