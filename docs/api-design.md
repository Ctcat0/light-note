# 轻记 MVP 云函数 API 设计

> 状态：接口契约基线。所有接口由小程序 service 通过 `wx.cloud.callFunction` 调用；页面不得直接调用云函数或数据库。  
> 数据库字段以 [`data-model.md`](./data-model.md) 为准，安全与分层以 [`architecture.md`](./architecture.md) 为准。

## 1. 调用协议

### 1.1 云函数与 action

| 云函数名 | 业务域 | MVP action |
| --- | --- | --- |
| `user` | 用户初始化与设置 | `init`, `getSettings`, `updateSettings` |
| `ledger` | 账单、分类、账户、预算 | 见第 4 节 |
| `todo` | 待办与清单 | 见第 5 节 |
| `weather` | 城市搜索与天气 | `searchLocations`, `getWeather` |
| `home` | 首页聚合 | `getOverview` |
| `dataDeletion` | 删除申请 | `getStatus`, `request`, `cancel` |

请求统一为：

```ts
interface FunctionRequest<TPayload> {
  action: string;
  requestId: string;
  payload: TPayload;
}
```

- `requestId` 为 UUID。写接口必须由前端在首次提交前生成，重试沿用同一个值；读接口也应携带，便于排障。
- 请求中禁止包含 `ownerId`、`userId`、`openId`。身份只由云函数从可信上下文取得。
- 未定义字段默认拒绝；字符串先去首尾空格，再验证长度。

### 1.2 统一响应

```ts
type ApiResponse<T> =
  | {
      success: true;
      code: "OK";
      message: string;
      data: T;
      requestId: string;
      serverTime: string; // ISO 8601
    }
  | {
      success: false;
      code: ErrorCode;
      message: string;
      data: null;
      requestId: string;
      serverTime: string; // ISO 8601
    };
```

云函数调用平台成功不代表业务成功；service 必须检查 `result.success`。对外错误不包含堆栈、集合名、数据库错误、第三方原始响应或密钥。

### 1.3 通用类型

```ts
type IsoDateTime = string; // 必须带 Z 或 UTC offset
type DateKey = string;     // YYYY-MM-DD，按用户时区
type MonthKey = string;    // YYYY-MM，按用户时区

interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
```

游标是不透明字符串，客户端不得解析或拼接；服务端应对游标签名或严格校验。默认 `limit = 20`，最大 `50`。

## 2. 安全与校验规则

每个 action 在处理 payload 前执行：

1. 调用 `getWXContext()` 取得 `OPENID`；
2. 解析 `status = active` 的 `users` 记录；`user.init` 是唯一允许创建用户的例外；
3. 校验 action 白名单和 payload；
4. 查询、引用、更新和删除条件全部带当前 `ownerId`；
5. 返回字段白名单 DTO，不返回 `ownerId`、`openId`、`isDeleted` 或内部缓存字段。

修改资源必须携带 `expectedVersion`。当资源不存在或不属于当前用户时返回 `RESOURCE_NOT_FOUND`；只有资源存在且版本不同才返回 `VERSION_CONFLICT`，实现时不得为此向客户端泄漏他人资源是否存在。

## 3. 用户与设置 API（`user`）

### 3.1 DTO

```ts
interface UserSummaryDto {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: "active";
}

interface DefaultLocationDto {
  locationKey: string;
  displayName: string;
  source: "manual" | "geolocation";
}

interface UserSettingsDto {
  currency: "CNY";
  timezone: string;
  defaultTransactionType: "expense" | "income";
  defaultExpenseAccountId: string;
  defaultIncomeAccountId: string;
  defaultLocation: DefaultLocationDto | null;
  preferGeolocation: boolean;
  showWeather: boolean;
  showBudget: boolean;
  theme: "system" | "light" | "dark";
  version: number;
  updatedAt: IsoDateTime;
}
```

`userId` 只作为当前用户自己的公开内部 ID 返回，不接受客户端用它切换身份。

### 3.2 `init`

用途：首次初始化或恢复会话；必须幂等补齐默认设置、账户和分类，不创建待办数据。

请求：

```ts
type InitPayload = Record<string, never>;
```

响应 `data`：

```ts
interface InitResult {
  isNewUser: boolean;
  user: UserSummaryDto;
  settings: UserSettingsDto;
  initialization: {
    userCreated: boolean;
    expenseCategoriesCreated: number;
    incomeCategoriesCreated: number;
    accountsCreated: number;
    repeatedInitialization: boolean;
    completed: boolean;
  };
}
```

首次成功调用应分别创建 11 个支出分类、8 个收入分类和 5 个固定渠道；微信渠道成为新用户默认支付和收款方式。完整重复调用的各创建数量为 `0`，并返回 `repeatedInitialization = true`；部分缺失补齐时该值为 `false`。接口只补齐按稳定 `systemKey` 缺失的系统项，不按中文名称匹配，不开放固定渠道新增、编辑、删除、停用或排序，也不覆盖现有默认支付/收款方式。

### 3.3 `getSettings`

请求 payload 为空；返回 `UserSettingsDto`。

### 3.4 `updateSettings`

请求：

```ts
type UpdateSettingsPayload =
  | {
      expectedVersion: number;
      group: "ledger";
      changes: {
        defaultTransactionType?: "expense" | "income";
        defaultExpenseAccountId?: string;
        defaultIncomeAccountId?: string;
      };
    }
  | {
      expectedVersion: number;
      group: "weather";
      changes: {
        defaultLocation?: DefaultLocationDto | null;
        preferGeolocation?: boolean;
      };
    };
```

规则：

- `currency`、时区和未开放偏好不可通过该接口修改；
- 记账与天气使用判别明确的分组 payload，每次只能更新一个分组，未提交字段保持原值；
- `defaultExpenseAccountId` 和 `defaultIncomeAccountId` 必须属于本人且启用；
- `defaultLocation.locationKey` 必须来自 `weather.searchLocations` 或受控定位解析结果，不接受任意 URL；
- `preferGeolocation` 仅保存用户偏好，不绕过微信位置授权；
- `updatedAt` 一律使用服务端时间；
- 返回更新后的 `UserSettingsDto`。

### 3.5 本地缓存操作

“清除天气缓存”只删除本机天气快照；“清除本地可再生缓存”删除本机天气和首页快照。两者均不直接修改共享 `weather_cache`，不需要云函数 action。

## 4. 个人数据删除 API（`dataDeletion`）

公共云函数只暴露以下三个 action，身份只从 `getWXContext().OPENID` 获取。

### 4.1 `getStatus`

payload 为空，返回当前申请或 `null`。

### 4.2 `request`

payload 为空；顶层 `requestId` 是申请幂等键。同一申请重试返回原记录，不同请求不能覆盖 `pending` 或 `processing` 申请。服务端写入 `requestedAt` 和固定 7 天的 `cooldownEndsAt`，并把用户状态改为 `deletion_pending`。

### 4.3 `cancel`

```ts
interface CancelDeletionPayload {
  expectedVersion: number;
}
```

仅 `pending` 可撤销；成功后申请状态为 `cancelled`，用户恢复 `active`。

### 4.4 受保护执行器（`dataDeletionExecutor`）

执行器是独立云函数，不出现在前端云函数常量中。它要求至少 24 字符的 `DATA_DELETION_EXECUTOR_TOKEN`，按冷静期、失败重试时间和执行租约认领任务，分批删除当前 `ownerId` 数据并保存进度。前端不得持有令牌或直接执行删除。

## 5. 记账 API（`ledger`）

### 5.1 账单 DTO

```ts
type TransactionType = "expense" | "income";
type SupportedTransactionType = TransactionType;
type TransactionListFilter = "all" | SupportedTransactionType;

interface TransactionDto {
  transactionId: string;
  type: SupportedTransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: IsoDateTime;
  occurredDateKey: DateKey;
  merchant: string | null;
  note: string | null;
  tags: string[];
  attachmentUrls: string[];
  includeInBudget: boolean;
  status: "active" | "deleted"; // 由 isDeleted 派生，不是数据库重复字段
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

interface TransactionWriteFields {
  type: SupportedTransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: IsoDateTime;
  merchant?: string | null;
  note?: string | null;
  includeInBudget: boolean;
}
```

服务端校验 `amountInCents` 为正的安全整数；`categoryId` 的类型必须与 `type` 匹配；`occurredDateKey` 由服务端派生，客户端不得提交。

当前实现开放收入和支出创建。`merchant` 固定为 `null`，`includeInBudget` 由类型决定：支出为 `true`、收入为 `false`；服务端生成空 `tags` 和 `attachmentUrls`。标签和附件没有可调用的写入逻辑。

### 5.2 账单 actions

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `createTransaction` | `CreateTransactionPayload` | `CreateTransactionResult` | 接受 `expense \| income`；顶层 `requestId` 作为创建幂等键，重复请求返回原记录 |
| `getTransaction` | `{ transactionId: string }` | `{ transaction: TransactionDto }` | 仅本人、未删除记录，用于新增后的精确写入确认 |
| `updateTransaction` | `UpdateTransactionRequest` | `UpdateTransactionResult` | 编辑收入或支出；类型不可变；校验版本、引用归属与派生日期；同请求重试幂等 |
| `deleteTransaction` | `DeleteTransactionRequest` | `DeleteTransactionResult` | 逻辑删除收入或支出；同请求重试返回等效成功，不同请求重复删除返回 `TRANSACTION_ALREADY_DELETED` |
| `listTransactions` | `ListTransactionsPayload` | `ListTransactionsResult` | 默认混合查询收入与支出，也可按单一类型筛选；稳定游标分页并返回全月收支汇总 |
| `getMonthlySummary` | `GetMonthlySummaryPayload` | `GetMonthlySummaryResult` | 已实现；按用户时区汇总指定月份收入、支出和结余，不含预算与分类统计 |

本次已实现的最小契约：

```ts
interface CreateTransactionPayload {
  type: "expense" | "income";
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: IsoDateTime;
  note: string | null;
  merchant: null;
  includeInBudget: boolean; // expense=true，income=false
}

interface CreateTransactionResult {
  transaction: TransactionDto;
  created: boolean;
  duplicate: boolean;
}
```

`createTransaction` 拒绝无效类型、类型与分类不匹配、`includeInBudget` 与类型不匹配以及任何未允许字段。相同用户、相同 `requestId` 再次请求返回 `created = false`、`duplicate = true`；不同用户可使用相同 `requestId`。收入和支出编辑、逻辑删除沿用同一 `ledger` 云函数。

```ts
interface UpdateTransactionRequest {
  transactionId: string;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: IsoDateTime;
  note: string | null;
  expectedVersion: number;
}

interface UpdateTransactionResult {
  transaction: TransactionDto;
  updated: true;
  duplicate: boolean;
  previousOccurredAt: IsoDateTime;
}

interface DeleteTransactionRequest {
  transactionId: string;
  expectedVersion: number;
}

interface DeleteTransactionResult {
  transactionId: string;
  deleted: true;
  alreadyDeleted: boolean;
  previousOccurredAt: IsoDateTime;
  version: number;
  updatedAt: IsoDateTime;
}
```

两个 action 的 `requestId` 均位于统一请求信封，不放入 payload。服务端只接受上列字段，身份来自 `getWXContext()`；编辑请求不携带可信 `type`，不能改变 `ownerId`、`type`、创建 requestId、`createdAt` 或删除状态。事务读取账单后校验本人、支持的账单类型、`isDeleted=false` 和 `expectedVersion`，再按记录原类型校验分类、账户归属及启用状态。冲突返回 `TRANSACTION_CONFLICT`，不会覆盖新版本。

每次成功变更在交易记录中保存最近一次变更的 requestId、操作类型、请求指纹和变更前发生时间。同一账单、同一 requestId、同一 payload 重试返回等效成功；同一 requestId 改变 payload 返回 `DUPLICATE_REQUEST`。不同 requestId 删除已删除记录返回 `TRANSACTION_ALREADY_DELETED`。普通 `getTransaction` 将已删除记录视为不存在。

```ts
type TransactionCursor = string; // 客户端视为不透明字符串

interface ListTransactionsPayload {
  filter: "all" | "expense" | "income"; // 页面默认 all
  categoryId?: string | null; // 分类下钻时必配单一收入/支出 filter
  year: number;       // 1000–9999 的四位整数
  month: number;      // 1–12
  pageSize: number;   // 1–50，页面默认 20
  cursor: TransactionCursor | null;
}

interface TransactionListItem {
  transactionId: string;
  type: "expense" | "income";
  amountInCents: number;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  accountId: string;
  accountName: string;
  accountIcon: string | null;
  occurredAt: IsoDateTime;
  occurredDateKey: DateKey;
  note: string | null;
  status: "active";
  createdAt: IsoDateTime;
}

interface ListTransactionsResult {
  items: TransactionListItem[];
  pagination: {
    pageSize: number;
    nextCursor: TransactionCursor | null;
    hasMore: boolean;
  };
  summary: {
    year: number;
    month: number;
    monthExpenseInCents: number;
    monthIncomeInCents: number;
    monthBalanceInCents: number;
  };
}

interface GetMonthlySummaryPayload {
  year: number;
  month: number;
}

interface GetMonthlySummaryResult {
  summary: {
    year: number;
    month: number;
    monthIncomeInCents: number;
    monthExpenseInCents: number;
    monthBalanceInCents: number;
  };
}

// 以下完整统计结构仍是后续设计，不属于当前 getMonthlySummary 响应。
interface PlannedMonthlySummaryDto {
  monthKey: MonthKey;
  incomeInCents: number;
  expenseInCents: number;
  balanceInCents: number; // income - expense，可为负
  transactionCount: number;
  budget: {
    budgetAmountInCents: number;
    spentInCents: number;
    remainingInCents: number;
    usageBasisPoints: number; // 万分比，避免浮点百分比
  } | null;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    amountInCents: number;
  }>;
  calculatedAt: IsoDateTime;
}
```

`listTransactions` 接受 `all | expense | income` 筛选，但不接受任意起止时间或身份字段。页面默认发送 `all`；分类下钻必须指定单一收入/支出类型。云函数从可信上下文解析当前 `ownerId`，按用户设置时区计算月份半开区间，并在单次查询中使用 `ownerId`、`isDeleted=false`、类型和可选 `categoryId`。排序为 `occurredAt DESC, _id DESC`；查询 `pageSize + 1` 条判断 `hasMore`。游标是 Base64URL 编码的严格版本化对象，包含版本、筛选、分类 ID、年月、`occurredAt` 和 `transactionId`；服务端校验字段集合、ID 格式、筛选/分类与月份绑定和时间范围，非法或跨条件游标返回 `INVALID_CURSOR`。游标不是授权凭证，所有查询仍重新附加当前用户条件。

`summary.monthExpenseInCents` 与 `summary.monthIncomeInCents` 由同一云函数分别针对整月匹配集合执行聚合求和，`monthBalanceInCents = monthIncomeInCents - monthExpenseInCents`，均与当前页条数无关；空月份为 `0`。分类和账户信息按本页去重后的 ID 分成最多 10 个 ID 的批次查询，并同时限制当前 `ownerId`，避免逐条 N+1。当前采用“关联最新名称”语义，不保存或返回名称快照。

`getMonthlySummary` 复用上述聚合逻辑，但请求只接受 `year` 和 `month`，不接受 `type`、`ownerId`、`userId` 或 `openId`。云函数从可信调用上下文解析当前用户，以 `user_settings.timezone` 计算月份半开区间；收入和支出分别过滤 `isDeleted = false` 后求和。空月份返回三个 `0`，聚合失败返回 `TRANSACTION_SUMMARY_FAILED`。当前接口不返回预算、分类明细或浮点比例。

列表输入错误分别返回 `INVALID_YEAR`、`INVALID_MONTH`、`INVALID_PAGE_SIZE`、`INVALID_CURSOR`；列表、展示关联和汇总依赖失败分别映射为 `TRANSACTION_LIST_FAILED` 或 `TRANSACTION_SUMMARY_FAILED`。项目现有未登录错误码为 `UNAUTHENTICATED`，等价于需求草案中的 `UNAUTHORIZED`，不另建含义重复的第二套代码。

`usageBasisPoints` 使用整数万分比；例如 70.25% 返回 `7025`。预算为 0 不允许保存，因此不存在除零语义。

### 5.3 分类 DTO 与 actions

```ts
interface CategoryDto {
  categoryId: string;
  type: TransactionType;
  name: string;
  icon: string;
  sortOrder: number;
  isSystem: boolean;
  isEnabled: boolean;
  version: number;
}
```

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `listCategories` | `{ type?: TransactionType; includeDisabled?: boolean }` | `{ items: CategoryDto[] }` | 默认只返回启用项 |
| `createCategory` | `{ type; name; icon; sortOrder? }` | `CategoryDto` | 创建项 `isSystem = false` |
| `updateCategory` | `{ categoryId; expectedVersion; changes: { name?; icon?; sortOrder?; isEnabled? } }` | `CategoryDto` | 已引用分类只能停用；不可改 `type`/`isSystem` |

恢复默认分类通过幂等初始化模板补齐，不删除或覆盖用户自定义分类。MVP 不提供物理删除分类接口。

### 5.4 固定资金渠道 DTO 与 actions

```ts
interface AccountDto {
  accountId: string;
  name: string;
  type: "cash" | "wechat" | "alipay" | "bank" | "other";
  icon: string | null;
  sortOrder: number;
  isDefault: boolean; // 按请求收支类型由对应默认渠道派生
  isSystem: boolean;
  isEnabled: boolean;
  version: number;
}
```

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `listAccounts` | `{ transactionType: "expense" \| "income"; includeDisabled: false }` | `{ items: AccountDto[] }` | 仅返回当前用户启用的固定资金渠道，并按收支类型标记默认项 |

固定渠道没有面向用户的新增、编辑、删除、停用或排序 action。正式交易接口返回纯交易结果，不返回渠道变更副作用。

### 5.5 统计分析 actions

统计沿用 `ledger` 云函数，但由独立前端 `statisticsService` 调用三个只读 action，以支持页面局部失败和独立重试：

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `getStatisticsSummary` | `{ year, month }` | `StatisticsMonthSummary` | 返回月收入、月支出、结余和收支笔数 |
| `getStatisticsTrend` | `{ endYear, endMonth, monthCount: 6 \| 12 }` | `StatisticsTrendResult` | 服务端计算范围、跨年、补齐空月、旧到新排序 |
| `getCategoryStatistics` | `{ year, month, type: expense \| income }` | `CategoryStatisticsResult` | 分类聚合后按金额降序，合计与明细严格一致 |

```ts
interface StatisticsMonthSummary {
  year: number;
  month: number;
  monthIncomeInCents: number;
  monthExpenseInCents: number;
  monthBalanceInCents: number;
  incomeCount: number;
  expenseCount: number;
}

interface StatisticsTrendItem {
  year: number;
  month: number;
  monthKey: MonthKey;
  incomeInCents: number;
  expenseInCents: number;
  balanceInCents: number;
}

interface CategoryStatisticsItem {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  amountInCents: number;
  count: number;
  ratioBasisPoints: number;
}
```

所有 action 都从可信微信上下文解析 `ownerId`，固定过滤 `isDeleted=false` 和收入/支出类型，月份边界按当前设置时区计算。分类名称采用“关联当前记录”语义；分类文档缺失时返回“已删除分类”与 `other` 图标，但仍保留对应金额、笔数和占比。统计页点击分类后把 `{ year, month, type, categoryId }` 交给现有流水查询，游标同时绑定分类 ID；服务端每页仍重新附加可信用户条件。

趋势和分类在数据库侧聚合，不向前端下载整库交易。当前用原生条形数据视图同时展示文字与金额，不增加图表依赖。统计异常分别映射为 `STATISTICS_QUERY_FAILED`、`STATISTICS_TREND_FAILED`、`STATISTICS_CATEGORY_FAILED`；`monthCount` 非 6/12 返回 `INVALID_MONTH_COUNT`。

### 5.6 基础预算 actions

```ts
interface BudgetDto {
  budgetId: string;
  monthKey: MonthKey;
  budgetAmountInCents: number;
  version: number;
  updatedAt: IsoDateTime;
}
```

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `getBudget` | `{ monthKey: MonthKey }` | `BudgetDto \| null` | 不存在返回 `null`，不是错误 |
| `upsertBudget` | `{ monthKey; budgetAmountInCents; expectedVersion?: number }` | `BudgetDto` | 创建时不传版本，更新时版本必填；金额为正整数 |
| `deleteBudget` | `{ budgetId; expectedVersion }` | `{ budgetId; deleted: true }` | 物理删除单条配置；不影响账单 |

基础预算若未确认进入首发，则这三个 action、设置中的 `showBudget` 和首页预算块一起关闭，不能只实现一部分。

## 6. 待办 API（`todo`）

### 6.1 DTO

```ts
type TodoStatus = "pending" | "doing" | "completed" | "cancelled";
type TodoPriority = "high" | "medium" | "low" | "none";
type DueKind = "none" | "date" | "datetime";

type DueInput =
  | { dueKind: "none"; dueDateKey?: never; dueAt?: never }
  | { dueKind: "date"; dueDateKey: DateKey; dueAt?: never }
  | { dueKind: "datetime"; dueAt: IsoDateTime; dueDateKey?: never };

interface TodoDto {
  todoId: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  listId: string;
  dueKind: DueKind;
  dueDateKey: DateKey | null;
  dueAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  isOverdue: boolean;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

`isOverdue` 是按用户时区实时计算的响应字段，不落库。`dueKind = none` 的待办永不逾期。

### 6.2 待办 actions

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `createTodo` | `CreateTodoPayload` | `TodoDto` | 顶层 `requestId` 作为创建幂等键 |
| `getTodo` | `{ todoId: string }` | `TodoDto` | 仅本人、未删除记录 |
| `updateTodo` | `UpdateTodoPayload` | `TodoDto` | 不通过该 action 改完成状态 |
| `setTodoStatus` | `{ todoId; expectedVersion; status: TodoStatus }` | `TodoDto` | 完成时写 `completedAt`，撤销时清空 |
| `deleteTodo` | `{ todoId; expectedVersion }` | `{ todoId; deletedAt; version }` | 逻辑删除 |
| `listTodos` | `ListTodosPayload` | `PageResult<TodoDto>` | 今日、近期、全部、完成、逾期视图 |

```ts
type CreateTodoPayload = {
  title: string;
  description?: string | null;
  priority: TodoPriority;
  listId: string;
} & DueInput;

type UpdateTodoPayload = {
  todoId: string;
  expectedVersion: number;
  changes: {
    title?: string;
    description?: string | null;
    priority?: TodoPriority;
    listId?: string;
    due?: DueInput;
  };
};

interface ListTodosPayload {
  view: "today" | "upcoming" | "all" | "completed" | "overdue";
  listId?: string;
  priority?: TodoPriority;
  cursor?: string | null;
  limit?: number;
}
```

`title` 在服务端去首尾空格后必须为 1–100 字；`description` 去首尾空格后最多 500 字，空字符串统一存为 `null`。创建、编辑、状态修改和删除都使用顶层 UUID `requestId` 做幂等保护。

视图语义：

- `today`：`dueDateKey` 等于服务端当前 `dateKey` 且未删除；
- `upcoming`：未来 7 个自然日内且状态未完成/未取消；“7 天”如需调整必须改契约版本；
- `all`：全部未删除，可包含无截止时间；
- `completed`：`status = completed`；
- `overdue`：截止值早于当前自然日/时刻，且状态不是 `completed`/`cancelled`；
- 无截止时间任务不进入 `today`、`upcoming` 或 `overdue`。

### 6.3 待办清单 actions

```ts
interface TodoListDto {
  listId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isEnabled: boolean;
  version: number;
}
```

MVP 必须提供 `listTodoLists` 读取默认清单：

| action | payload | data |
| --- | --- | --- |
| `listTodoLists` | `{ includeDisabled?: boolean }` | `{ items: TodoListDto[] }` |

自定义清单管理不在 MVP；需要时再增加 create/update action，不得先暴露无权限校验的通用 CRUD。

## 7. 天气 API（`weather`）

天气 action 也要求有效用户身份，以便限流和防止云函数成为公开代理。MVP adapter 采用 Open-Meteo 免费开放接口，云函数只访问代码中固定的官方 Forecast 与 Geocoding host，不需要 API Key，也不接受客户端 host 或 URL。

### 7.1 `searchLocations`

请求采用二选一：

```ts
type SearchLocationsPayload =
  | { mode: "keyword"; keyword: string }
  | { mode: "coordinates"; latitude: number; longitude: number };
```

规则：

- `keyword` 长度为 1 至 40 个字符，最多返回 10 项，禁止将任意查询参数透传给供应商；
- 坐标必须由用户当次主动授权获得，校验纬度 `[-90, 90]`、经度 `[-180, 180]`，传给 adapter 前降至小数点后 2 位；日志不得记录原始精确坐标；
- 不自动写入用户设置，用户选定后再调用 `user.updateSettings`。
- Open-Meteo 城市坐标对外统一包装为 `open-meteo:<latitude>,<longitude>`，坐标最多四位小数；客户端不能提交任意供应商或 host。

响应：

```ts
interface LocationDto {
  locationKey: string;
  displayName: string;
  adminArea: string | null;
  countryCode: string;
}

interface SearchLocationsResult {
  items: LocationDto[];
}
```

### 7.2 `getWeather`

请求：

```ts
interface GetWeatherPayload {
  locationKey?: string; // 省略时使用 user_settings.defaultLocation
}
```

响应：

```ts
interface CurrentWeatherDto {
  temperatureCelsius: number;
  apparentTemperatureCelsius: number | null;
  conditionCode: string;
  conditionText: string;
  humidityPercent: number | null;
  windDirection: string | null;
  windScale: string | null;
  precipitationProbabilityPercent: number | null;
}

interface DailyWeatherDto {
  dateKey: DateKey;
  minTemperatureCelsius: number;
  maxTemperatureCelsius: number;
  conditionCode: string;
  conditionText: string;
  precipitationProbabilityPercent: number | null;
}

interface WeatherResult {
  location: LocationDto;
  current: CurrentWeatherDto;
  daily: DailyWeatherDto[]; // 最多 3 天，按 dateKey 升序
  observedAt: IsoDateTime;
  fetchedAt: IsoDateTime;
  cacheStatus: "fresh" | "refreshed" | "stale";
  provider: string;
}
```

温度可包含小数，因为它不是金额；字段必须是有限数并限制在合理气象范围。供应商失败时，仅在 `staleUntil` 内返回旧缓存并标记 `cacheStatus = stale`；否则返回 `WEATHER_UNAVAILABLE`。

Open-Meteo 当前天气没有同时间点降水概率时，`current.precipitationProbabilityPercent` 返回 `null`；三日预报使用 `precipitation_probability_max`。实时与三日预报分别使用 15 分钟和 2 小时新鲜 TTL，失败降级窗口分别为 6 小时和 24 小时。

## 8. 首页聚合 API（`home`）

### 8.1 `getOverview`

请求：

```ts
interface GetOverviewPayload {
  dateKey?: DateKey; // 仅允许当前用户时区下的今天；MVP 不做任意历史首页
}
```

响应使用模块级状态，天气失败不阻断其他模块：

```ts
type ModuleResult<T> =
  | { status: "success"; data: T }
  | { status: "unavailable"; data: null; code: string; message: string };

interface HomeOverviewResult {
  dateKey: DateKey;
  timezone: string;
  ledger: ModuleResult<{
    todayIncomeInCents: number;
    todayExpenseInCents: number;
    monthIncomeInCents: number;
    monthExpenseInCents: number;
    monthBalanceInCents: number;
    budget: PlannedMonthlySummaryDto["budget"];
  }>;
  todos: ModuleResult<{
    todayTotal: number;
    todayCompleted: number;
    todayPending: number;
    overdueCount: number;
    items: TodoDto[]; // 最多 5 项未完成/逾期待办
  }>;
  weather: ModuleResult<WeatherResult>;
  generatedAt: IsoDateTime;
}
```

首页 service 可先展示带时间戳的本地快照，再刷新该 action。快照不是写操作事实来源。

基础预算当前延期，因此实现返回 `budget: null` 且首页不展示预算占位；预算进入开发后再同步调整数据模型、接口与页面。

## 9. 错误码

| code | 含义 | 前端建议 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | action、字段、格式、范围或组合非法 | 标记相关输入，不自动重试 |
| `UNAUTHENTICATED` | 无法取得有效微信身份/用户 | 重新初始化；仍失败则提示 |
| `USER_NOT_INITIALIZED` | 当前身份尚未完成用户初始化 | 先调用 `user.init`，不要继续写入 |
| `USER_DISABLED` | 用户禁用或待删除 | 阻止业务写入并进入说明页 |
| `INVALID_TRANSACTION_TYPE` | 请求了本次未支持的交易类型或流水筛选 | 只允许收入、支出或全部筛选 |
| `INVALID_AMOUNT` | 金额不是允许范围内的正整数分 | 标记金额输入，不重试 |
| `CATEGORY_REQUIRED` / `ACCOUNT_REQUIRED` | 未选择必需的分类或账户 | 标记表单字段 |
| `CATEGORY_NOT_FOUND` / `ACCOUNT_NOT_FOUND` | 引用记录不存在 | 刷新选项后让用户重选 |
| `CATEGORY_NOT_OWNED` / `ACCOUNT_NOT_OWNED` | 引用记录不属于当前用户 | 拒绝提交并刷新选项 |
| `CATEGORY_TYPE_INVALID` / `CATEGORY_DISABLED` | 分类类型错误或已停用 | 按账单类型刷新分类 |
| `ACCOUNT_DISABLED` | 账户已停用 | 刷新账户 |
| `INVALID_OCCURRED_AT` | 发生时间非法或超过服务器当前时间 5 分钟 | 标记时间输入 |
| `NOTE_TOO_LONG` | 备注超过 200 字 | 保留表单并提示缩短 |
| `REQUEST_ID_REQUIRED` | 写请求缺少幂等 UUID | 客户端生成后再提交 |
| `TRANSACTION_CREATE_FAILED` | 数据库写入未确认成功 | 保留表单和原 requestId 供显式重试 |
| `TRANSACTION_NOT_FOUND` | 本人范围内未找到有效账单 | 不区分不存在与他人资源 |
| `RESOURCE_NOT_FOUND` | 资源不存在、已删除或无权访问 | 返回列表或刷新，不区分无权限 |
| `VERSION_CONFLICT` | 资源已被其他请求修改 | 刷新最新数据后由用户重试 |
| `DUPLICATE_REQUEST` | 同 requestId 被用于不同 payload | 停止重试并记录排障信息 |
| `TODO_TITLE_REQUIRED` / `TODO_TITLE_TOO_LONG` | 待办标题为空或超过 100 字 | 保留表单并标记标题 |
| `TODO_DESCRIPTION_TOO_LONG` / `TODO_DUE_INVALID` | 描述超过 500 字或截止组合非法 | 保留表单并标记对应字段 |
| `TODO_LIST_NOT_FOUND` / `TODO_LIST_DISABLED` | 清单不存在、不属于本人或已停用 | 刷新清单后重新选择 |
| `TODO_NOT_FOUND` | 本人范围内未找到有效待办 | 返回列表或刷新，不区分无权限 |
| `TODO_CREATE_FAILED` / `TODO_LIST_FAILED` / `TODO_UPDATE_FAILED` / `TODO_DELETE_FAILED` | 待办依赖写入或读取失败 | 保留表单；读操作可重试，写操作沿用原 requestId |
| `RATE_LIMITED` | 调用过于频繁 | 按受控退避时间重试 |
| `WEATHER_LOCATION_REQUIRED` | 未传位置且无默认城市 | 引导手动选择城市 |
| `WEATHER_UNAVAILABLE` | 天气服务和合规缓存均不可用 | 局部错误，不影响账目/待办 |
| `DELETION_REQUEST_NOT_FOUND` / `DELETION_REQUEST_ACTIVE` / `DELETION_CANNOT_CANCEL` | 删除申请不存在、已有生效申请或当前状态不能撤销 | 刷新删除状态，不重复提交 |
| `DELETION_EXECUTOR_UNAUTHORIZED` / `DELETION_EXECUTION_FAILED` | 后台执行器未授权或批处理失败 | 仅后台告警和受控重试，前端不得调用 |
| `DEPENDENCY_ERROR` | 数据库或外部依赖暂时失败 | 读请求可退避重试，写请求谨慎 |
| `INTERNAL_ERROR` | 未分类服务端错误 | 展示通用提示并携 requestId |

## 10. 版本与兼容性

- MVP 使用文档版本 `v1`；action 名和响应 DTO 一旦被已发布客户端使用，不做破坏性原地修改。
- 新增可选响应字段视为向后兼容；删除字段、改变类型/单位/枚举或语义必须建立 `v2` action 或迁移期。
- 金额单位、时间格式、`ownerId` 规则、`dueKind` 组合和逻辑删除语义属于不可静默修改的契约。
- 天气供应商可以替换，但 `WeatherResult` 必须保持稳定；供应商专属码只在 adapter 内存在。

## 11. 接口待定项

1. Open-Meteo 免费开放接口仅适用于非商业用途且需署名；商业发布前必须重新确认许可或切换商业/自托管端点；
2. 日期可回溯范围、未来商户字段长度及其他未实现业务字段长度；
3. `upcoming` 固定 7 天是否符合产品原型；
4. 基础预算是否首发；
5. 用户删除的确认、冷静期、状态查询与撤销接口；
6. 生产级跨实例限流与天气配额告警；MVP 已有单实例、单用户每分钟搜索 10 次/天气 30 次保护；
7. 首页账目摘要是否需要分类排行，MVP 当前只返回必要汇总。
