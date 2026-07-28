export type {
  CategoryStatisticsItem,
  CategoryStatisticsResult,
  GetCategoryStatisticsRequest,
  GetStatisticsSummaryRequest,
  GetStatisticsTrendRequest,
  StatisticsMonthCount,
  StatisticsMonthSummary,
  StatisticsPeriod,
  StatisticsTrendItem,
  StatisticsTrendResult,
} from "../../shared/types/statistics";

export type StatisticsPageState =
  | "initialLoading"
  | "ready"
  | "refreshing"
  | "empty"
  | "initialError"
  | "partialError"
  | "retrying";

export type StatisticsSectionStatus = "loading" | "ready" | "empty" | "error";
