import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type {
  CategoryStatisticsResult,
  StatisticsMonthSummary,
  StatisticsTrendResult,
} from "../../../shared/types/statistics";
import type {
  CreateTransactionResult,
  DeleteTransactionResult,
  GetTransactionResult,
  GetMonthlySummaryResult,
  ListAccountsResult,
  ListCategoriesResult,
  ListTransactionsResult,
  UpdateTransactionResult,
} from "../../../shared/types/transaction";
import { createLedgerFunctionHandler } from "./application/handler";
import {
  createCloudBaseLedgerStore,
  type CloudDatabase,
} from "./infrastructure/cloudbase-store";

type LedgerResponseData =
  | CreateTransactionResult
  | UpdateTransactionResult
  | DeleteTransactionResult
  | GetTransactionResult
  | GetMonthlySummaryResult
  | ListAccountsResult
  | ListCategoriesResult
  | ListTransactionsResult
  | StatisticsMonthSummary
  | StatisticsTrendResult
  | CategoryStatisticsResult;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

const database = cloud.database() as unknown as CloudDatabase;
const store = createCloudBaseLedgerStore(database);
const handler = createLedgerFunctionHandler({
  getOpenId(): string | undefined {
    const context = cloud.getWXContext() as unknown as Record<string, unknown>;
    const openId = context.OPENID;
    return typeof openId === "string" ? openId : undefined;
  },
  getCurrentTime: () => new Date(),
  store,
});

export async function main(event: unknown): Promise<ApiResponse<LedgerResponseData>> {
  return handler(event);
}
