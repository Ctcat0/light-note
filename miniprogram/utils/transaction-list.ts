import type {
  TransactionDayGroup,
  TransactionListDisplayItem,
  TransactionListItem,
  TransactionListLoadStatus,
} from "../types/transaction";
import { formatDayLabel, formatTime, formatWeekdayLabel } from "./date";
import { formatAmountInCents } from "./money";

function compareTransactions(
  left: TransactionListItem,
  right: TransactionListItem,
): number {
  const timeDifference =
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
  return timeDifference !== 0
    ? timeDifference
    : right.transactionId.localeCompare(left.transactionId);
}

export function mergeTransactionPages(
  existing: readonly TransactionListItem[],
  incoming: readonly TransactionListItem[],
): TransactionListItem[] {
  const byId = new Map<string, TransactionListItem>();
  for (const item of existing) byId.set(item.transactionId, item);
  for (const item of incoming) byId.set(item.transactionId, item);
  return [...byId.values()].sort(compareTransactions);
}

export function calculateDayExpense(
  items: readonly TransactionListItem[],
): number {
  return calculateDayTotal(items, "expense");
}

export function calculateDayIncome(
  items: readonly TransactionListItem[],
): number {
  return calculateDayTotal(items, "income");
}

function calculateDayTotal(
  items: readonly TransactionListItem[],
  type: "expense" | "income",
): number {
  return items.reduce((total, item) => {
    if (item.type !== type) return total;
    if (!Number.isSafeInteger(item.amountInCents)) {
      throw new Error("账单金额不是安全整数分");
    }
    const next = total + item.amountInCents;
    if (!Number.isSafeInteger(next)) throw new Error("每日账单金额超出安全范围");
    return next;
  }, 0);
}

function toDisplayItem(
  item: TransactionListItem,
  timeZone: string,
): TransactionListDisplayItem {
  return {
    ...item,
    categoryIconDisplay: resolveCategoryIcon(item.categoryIcon, item.categoryName),
    amountDisplay: formatAmountInCents(item.amountInCents, {
      showCurrencySymbol: false,
    }),
    occurredTimeDisplay: formatTime(item.occurredAt, timeZone),
    title: item.note ?? item.categoryName,
    secondaryText:
      item.note === null
        ? `${item.accountName} · ${formatTime(item.occurredAt, timeZone)}`
        : `${item.categoryName} · ${item.accountName} · ${formatTime(item.occurredAt, timeZone)}`,
  };
}

const CATEGORY_ICON_DISPLAY: Readonly<Record<string, string>> = {
  food: "🍴",
  transport: "🚇",
  shopping: "🛍",
  housing: "🏠",
  entertainment: "🎮",
  medical: "💊",
  education: "📚",
  communication: "📱",
  social: "🎁",
  travel: "🧳",
  other: "…",
};

function resolveCategoryIcon(icon: string, categoryName: string): string {
  const configured = CATEGORY_ICON_DISPLAY[icon];
  if (configured !== undefined) return configured;
  const iconCharacters = Array.from(icon);
  if (iconCharacters.length > 0 && iconCharacters.length <= 2) return icon;
  return Array.from(categoryName)[0] ?? "·";
}

export function groupTransactionsByDay(
  items: readonly TransactionListItem[],
  timeZone: string,
): TransactionDayGroup[] {
  const merged = mergeTransactionPages([], items);
  const groups = new Map<string, TransactionListItem[]>();
  for (const item of merged) {
    const current = groups.get(item.occurredDateKey) ?? [];
    current.push(item);
    groups.set(item.occurredDateKey, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dateKey, dayItems]) => {
      const expenseInCents = calculateDayExpense(dayItems);
      const incomeInCents = calculateDayIncome(dayItems);
      return {
        dateKey,
        dateLabel: formatDayLabel(dateKey),
        weekdayLabel: formatWeekdayLabel(dateKey),
        expenseInCents,
        expenseDisplay: formatAmountInCents(expenseInCents, {
          showCurrencySymbol: false,
        }),
        incomeInCents,
        incomeDisplay: formatAmountInCents(incomeInCents, {
          showCurrencySymbol: false,
        }),
        items: dayItems.sort(compareTransactions).map((item) =>
          toDisplayItem(item, timeZone),
        ),
      };
    });
}

export function getTransactionListSuccessStatus(
  itemCount: number,
  hasMore: boolean,
): TransactionListLoadStatus {
  if (itemCount === 0) return "empty";
  return hasMore ? "ready" : "noMore";
}

export function canLoadMoreTransactions(options: {
  hasMore: boolean;
  nextCursor: string | null;
  loadStatus: TransactionListLoadStatus;
}): boolean {
  return (
    options.hasMore &&
    options.nextCursor !== null &&
    options.loadStatus === "ready"
  );
}

export function isCurrentTransactionListRequest(options: {
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
