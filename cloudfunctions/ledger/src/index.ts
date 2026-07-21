import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type {
  CreateExpenseTransactionResult,
  DeleteExpenseTransactionResult,
  GetTransactionResult,
  GetMonthlySummaryResult,
  ListAccountsResult,
  ListExpenseCategoriesResult,
  ListExpenseTransactionsResult,
  UpdateExpenseTransactionResult,
} from "../../../shared/types/transaction";
import { createLedgerFunctionHandler } from "./application/handler";
import {
  createCloudBaseLedgerStore,
  type CloudDatabase,
} from "./infrastructure/cloudbase-store";

type LedgerResponseData =
  | CreateExpenseTransactionResult
  | UpdateExpenseTransactionResult
  | DeleteExpenseTransactionResult
  | GetTransactionResult
  | GetMonthlySummaryResult
  | ListAccountsResult
  | ListExpenseCategoriesResult
  | ListExpenseTransactionsResult;

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
