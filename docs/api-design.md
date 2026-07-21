# 轻记 MVP 云函数 API 设计

> 状态：接口契约基线。所有接口由小程序 service 通过 `wx.cloud.callFunction` 调用；页面不得直接调用云函数或数据库。  
> 数据库字段以 [`data-model.md`](./data-model.md) 为准，安全与分层以 [`architecture.md`](./architecture.md) 为准。

## 1. 调用协议

### 1.1 云函数与 action

| 云函数名 | 业务域 | MVP action |
| --- | --- | --- |
| `user` | 用户初始化与设置 | `init`, `getSettings`, `updateSettings`, `requestDeletion` |
| `ledger` | 账单、分类、账户、预算 | 见第 4 节 |
| `todo` | 待办与清单 | 见第 5 节 |
| `weather` | 城市搜索与天气 | `searchLocations`, `getWeather` |
| `home` | 首页聚合 | `getOverview` |

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
  defaultAccountId: string | null;
  defaultLocation: DefaultLocationDto | null;
  showWeather: boolean;
  showBudget: boolean;
  theme: "system" | "light" | "dark";
  version: number;
  updatedAt: IsoDateTime;
}
```

`userId` 只作为当前用户自己的公开内部 ID 返回，不接受客户端用它切换身份。

### 3.2 `init`

用途：首次初始化或恢复会话；必须幂等补齐默认设置、账户、分类和待办清单。

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
}
```

### 3.3 `getSettings`

请求 payload 为空；返回 `UserSettingsDto`。

### 3.4 `updateSettings`

请求：

```ts
interface UpdateSettingsPayload {
  expectedVersion: number;
  changes: {
    timezone?: string;
    defaultAccountId?: string | null;
    defaultLocation?: DefaultLocationDto | null;
    showWeather?: boolean;
    showBudget?: boolean;
    theme?: "system" | "light" | "dark";
  };
}
```

规则：

- `currency` 在 MVP 不可修改；
- `defaultAccountId` 必须属于本人且启用；
- `defaultLocation.locationKey` 必须来自 `weather.searchLocations` 或受控定位解析结果，不接受任意 URL；
- `timezone` 必须在服务端允许的 IANA 时区列表中；修改时区不改写历史 `occurredAt`，但后续自然日聚合按新时区解释；
- 返回更新后的 `UserSettingsDto`。

### 3.5 `requestDeletion`

请求：

```ts
interface RequestDeletionPayload {
  confirmText: string;
}
```

规则：确认文案、冷静期和二次验证方式待合规方案确认。接口将用户置为 `deletion_pending` 并返回删除申请状态；在规则确认前不得上线该 action。

## 4. 记账 API（`ledger`）

### 4.1 账单 DTO

```ts
type TransactionType = "expense" | "income";

interface TransactionDto {
  transactionId: string;
  type: TransactionType;
  amountInCents: number;
  categoryId: string;
  accountId: string;
  occurredAt: IsoDateTime;
  occurredDateKey: DateKey;
  merchant: string | null;
  note: string | null;
  includeInBudget: boolean;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

interface TransactionWriteFields {
  type: TransactionType;
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

### 4.2 账单 actions

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `createTransaction` | `TransactionWriteFields` | `TransactionDto` | 顶层 `requestId` 作为创建幂等键；重复请求返回原记录 |
| `getTransaction` | `{ transactionId: string }` | `TransactionDto` | 仅本人、未删除记录 |
| `updateTransaction` | `{ transactionId: string; expectedVersion: number; changes: Partial<TransactionWriteFields> }` | `TransactionDto` | 至少一个允许字段；重新校验引用与派生日期 |
| `deleteTransaction` | `{ transactionId: string; expectedVersion: number }` | `{ transactionId: string; deletedAt: IsoDateTime; version: number }` | 逻辑删除；重复删除返回 `RESOURCE_NOT_FOUND` |
| `listTransactions` | `ListTransactionsPayload` | `PageResult<TransactionDto>` | 稳定游标分页，只返回未删除记录 |
| `getMonthlySummary` | `{ monthKey: MonthKey }` | `MonthlySummaryDto` | 按用户时区计算半开时间区间 |

```ts
interface ListTransactionsPayload {
  monthKey?: MonthKey;
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
  cursor?: string | null;
  limit?: number;
}

interface MonthlySummaryDto {
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

`usageBasisPoints` 使用整数万分比；例如 70.25% 返回 `7025`。预算为 0 不允许保存，因此不存在除零语义。

### 4.3 分类 DTO 与 actions

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

### 4.4 账户 DTO 与 actions

```ts
interface AccountDto {
  accountId: string;
  name: string;
  type: "cash" | "wechat" | "alipay" | "bank" | "other";
  icon: string | null;
  sortOrder: number;
  isDefault: boolean; // 由 user_settings.defaultAccountId 派生，不是 accounts 存储字段
  isEnabled: boolean;
  version: number;
}
```

| action | payload | data | 关键规则 |
| --- | --- | --- | --- |
| `listAccounts` | `{ includeDisabled?: boolean }` | `{ items: AccountDto[] }` | 默认只返回启用项 |
| `createAccount` | `{ name; type; icon?; sortOrder?; makeDefault?: boolean }` | `AccountDto` | 首个账户自动为默认 |
| `updateAccount` | `{ accountId; expectedVersion; changes: { name?; type?; icon?; sortOrder?; isEnabled?; makeDefault?: true } }` | `AccountDto` | 不得停用唯一有效账户；`makeDefault` 更新设置中的唯一引用 |

MVP 账户 API 不含初始余额、当前余额和转账。

### 4.5 基础预算 actions

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

## 5. 待办 API（`todo`）

### 5.1 DTO

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

### 5.2 待办 actions

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

视图语义：

- `today`：`dueDateKey` 等于服务端当前 `dateKey` 且未删除；
- `upcoming`：未来 7 个自然日内且状态未完成/未取消；“7 天”如需调整必须改契约版本；
- `all`：全部未删除，可包含无截止时间；
- `completed`：`status = completed`；
- `overdue`：截止值早于当前自然日/时刻，且状态不是 `completed`/`cancelled`；
- 无截止时间任务不进入 `today`、`upcoming` 或 `overdue`。

### 5.3 待办清单 actions

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

## 6. 天气 API（`weather`）

天气 action 也要求有效用户身份，以便限流和防止云函数成为公开代理。天气密钥仅存在云函数环境变量中。

### 6.1 `searchLocations`

请求采用二选一：

```ts
type SearchLocationsPayload =
  | { mode: "keyword"; keyword: string }
  | { mode: "coordinates"; latitude: number; longitude: number };
```

规则：

- `keyword` 长度和返回条数受限，禁止将任意查询参数透传给供应商；
- 坐标必须由用户当次主动授权获得，校验纬度 `[-90, 90]`、经度 `[-180, 180]`；日志不得记录原始精确坐标；
- 不自动写入用户设置，用户选定后再调用 `user.updateSettings`。

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

### 6.2 `getWeather`

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

## 7. 首页聚合 API（`home`）

### 7.1 `getOverview`

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
    budget: MonthlySummaryDto["budget"];
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

## 8. 错误码

| code | 含义 | 前端建议 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | action、字段、格式、范围或组合非法 | 标记相关输入，不自动重试 |
| `UNAUTHENTICATED` | 无法取得有效微信身份/用户 | 重新初始化；仍失败则提示 |
| `USER_DISABLED` | 用户禁用或待删除 | 阻止业务写入并进入说明页 |
| `RESOURCE_NOT_FOUND` | 资源不存在、已删除或无权访问 | 返回列表或刷新，不区分无权限 |
| `VERSION_CONFLICT` | 资源已被其他请求修改 | 刷新最新数据后由用户重试 |
| `DUPLICATE_REQUEST` | 同 requestId 被用于不同 payload | 停止重试并记录排障信息 |
| `RATE_LIMITED` | 调用过于频繁 | 按受控退避时间重试 |
| `WEATHER_LOCATION_REQUIRED` | 未传位置且无默认城市 | 引导手动选择城市 |
| `WEATHER_UNAVAILABLE` | 天气服务和合规缓存均不可用 | 局部错误，不影响账目/待办 |
| `DEPENDENCY_ERROR` | 数据库或外部依赖暂时失败 | 读请求可退避重试，写请求谨慎 |
| `INTERNAL_ERROR` | 未分类服务端错误 | 展示通用提示并携 requestId |

## 9. 版本与兼容性

- MVP 使用文档版本 `v1`；action 名和响应 DTO 一旦被已发布客户端使用，不做破坏性原地修改。
- 新增可选响应字段视为向后兼容；删除字段、改变类型/单位/枚举或语义必须建立 `v2` action 或迁移期。
- 金额单位、时间格式、`ownerId` 规则、`dueKind` 组合和逻辑删除语义属于不可静默修改的契约。
- 天气供应商可以替换，但 `WeatherResult` 必须保持稳定；供应商专属码只在 adapter 内存在。

## 10. 接口待定项

1. 天气供应商确定后，城市搜索能力、天气字段可用性和错误映射；
2. 字段长度、单笔金额上限、日期可回溯/可预填范围；
3. `upcoming` 固定 7 天是否符合产品原型；
4. 基础预算是否首发；
5. 用户删除的确认、冷静期、状态查询与撤销接口；
6. 云函数超时、单用户限流阈值和天气配额；
7. 首页账目摘要是否需要分类排行，MVP 当前只返回必要汇总。
