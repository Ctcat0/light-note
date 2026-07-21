import type { YearMonth } from "../utils/date";

export interface TransactionListRefreshSignal extends YearMonth {
  revision: number;
  affectedMonths: YearMonth[];
}

let revision = 0;
let latestSignal: TransactionListRefreshSignal | null = null;

export function markTransactionListStale(
  targetMonth: YearMonth,
  additionalMonths: readonly YearMonth[] = [],
): TransactionListRefreshSignal {
  revision += 1;
  const unique = new Map<string, YearMonth>();
  for (const value of [targetMonth, ...additionalMonths]) {
    unique.set(`${value.year}-${value.month}`, { ...value });
  }
  latestSignal = {
    ...targetMonth,
    revision,
    affectedMonths: [...unique.values()],
  };
  return latestSignal;
}

export function readTransactionListRefreshSignal(): TransactionListRefreshSignal | null {
  return latestSignal === null
    ? null
    : {
        ...latestSignal,
        affectedMonths: latestSignal.affectedMonths.map((value) => ({ ...value })),
      };
}
