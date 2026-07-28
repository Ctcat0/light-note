export function formatRatioBasisPoints(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("分类占比无效");
  }
  const percent = value / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function getStatisticsBarWidth(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error("统计金额无效");
  }
  if (value === 0 || maximum === 0) return 0;
  return Math.max(4, Math.round((value / maximum) * 100));
}

export function isCurrentStatisticsRequest(options: {
  destroyed: boolean;
  activeRequestVersion: number;
  responseRequestVersion: number;
  activeYear: number;
  activeMonth: number;
  responseYear: number;
  responseMonth: number;
}): boolean {
  return (
    !options.destroyed &&
    options.activeRequestVersion === options.responseRequestVersion &&
    options.activeYear === options.responseYear &&
    options.activeMonth === options.responseMonth
  );
}
