import assert from "node:assert/strict";
import test from "node:test";
import { createUserFunctionHandler } from "../cloudfunctions/user/src/application/handler";
import {
  createCloudBaseUserInitializationStore,
  isMissingDocumentError,
  readDocumentData,
  type CloudDatabase,
} from "../cloudfunctions/user/src/infrastructure/cloudbase-store";
import type { UserSettingsRecord } from "../cloudfunctions/user/src/domain/types";
import {
  callCloudFunctionWithMetadata,
  initializeCloud,
  type CloudApi,
  type CloudCallResult,
} from "../miniprogram/services/cloud";
import {
  createUserInitializationService,
  parseInitializationResult,
  type UserInitializationTransport,
} from "../miniprogram/services/user";
import {
  resolveEnvironmentConfig,
  type EnvironmentConfig,
} from "../miniprogram/config/environment";
import { AppError } from "../miniprogram/utils/error";
import type { UserInitializationResult } from "../shared/types/user";
import { InMemoryUserInitializationStore } from "./helpers/in-memory-user-init-store";

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-21T08:00:00.000Z");

const INITIALIZATION_RESULT: UserInitializationResult = {
  isNewUser: true,
  user: {
    userId: "usr_contract",
    nickname: null,
    avatarUrl: null,
    status: "active",
  },
  settings: {
    currency: "CNY",
    timezone: "Asia/Shanghai",
    defaultTransactionType: "expense",
    defaultExpenseAccountId: "acc_wechat",
    defaultIncomeAccountId: "acc_wechat",
    defaultLocation: null,
    preferGeolocation: false,
    showWeather: true,
    showBudget: false,
    theme: "system",
    version: 1,
    updatedAt: NOW.toISOString(),
  },
  initialization: {
    userCreated: true,
    expenseCategoriesCreated: 11,
    incomeCategoriesCreated: 8,
    accountsCreated: 5,
    repeatedInitialization: false,
    completed: true,
  },
};

function configuredEnvironment(cloudEnvId: string): EnvironmentConfig {
  return {
    name: "development",
    cloudEnvId,
    enableCloud: true,
  };
}

function createCloudApi(onInit: (envId: string) => void): CloudApi {
  return {
    init(config): void {
      onInit(config.env);
    },
    callFunction: async () => ({ result: undefined }),
  };
}

function successfulTransport(
  onRequest: UserInitializationTransport,
): UserInitializationTransport {
  return onRequest;
}

test("开发版、体验版和正式版分别选择独立 CloudBase 配置", () => {
  assert.equal(resolveEnvironmentConfig("develop").name, "development");
  assert.equal(resolveEnvironmentConfig("trial").name, "test");
  assert.equal(resolveEnvironmentConfig("release").name, "production");
});

test("环境 ID 未配置时拒绝初始化且不会调用 wx.cloud.init", () => {
  let initCalls = 0;
  const result = initializeCloud(
    configuredEnvironment(""),
    createCloudApi(() => {
      initCalls += 1;
    }),
  );

  assert.equal(result.ready, false);
  assert.match(result.errorMessage ?? "", /尚未配置/u);
  assert.equal(initCalls, 0);
});

test("环境 ID 已配置时传给 wx.cloud.init", () => {
  let initializedEnvId = "";
  const result = initializeCloud(
    configuredEnvironment("development-env-id"),
    createCloudApi((envId) => {
      initializedEnvId = envId;
    }),
  );

  assert.equal(result.ready, true);
  assert.equal(initializedEnvId, "development-env-id");
});

test("云函数调用超时返回带 requestId 的受控错误", async () => {
  const cloudApi: CloudApi = {
    init: (): void => undefined,
    callFunction: () => new Promise(() => undefined),
  };
  initializeCloud(configuredEnvironment("development-env-id"), cloudApi);

  await assert.rejects(
    () =>
      callCloudFunctionWithMetadata({
        functionName: "user",
        action: "init",
        requestId: REQUEST_ID,
        payload: {},
        parseData: parseInitializationResult,
        timeoutMs: 5,
        cloudApi,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "NETWORK_ERROR" &&
      error.requestId === REQUEST_ID,
  );
});

test("CloudBase 文档不存在的对象错误和数组响应均可识别", () => {
  assert.equal(
    isMissingDocumentError({
      errCode: -502005,
      errMsg: "document not exist",
    }),
    true,
  );
  assert.equal(
    isMissingDocumentError({
      code: "DATABASE_COLLECTION_NOT_EXIST",
      message: "collection not found",
    }),
    false,
  );
  assert.deepEqual(readDocumentData<{ id: string }>([{ id: "first" }]), {
    id: "first",
  });
  assert.equal(readDocumentData([]), null);
});

test("CloudBase 设置更新使用整文档覆盖，支持默认城市从 null 变为对象", async () => {
  let setPayload: Record<string, unknown> | null = null;
  let updateCalls = 0;
  const database = {
    collection(): never {
      throw new Error("本测试不应执行事务外查询");
    },
    async runTransaction<T>(operation: (transaction: unknown) => Promise<T>): Promise<T> {
      return operation({
        collection: () => ({
          doc: () => ({
            get: async () => ({ data: null }),
            set: async (options: { data: Record<string, unknown> }) => {
              setPayload = options.data;
            },
            update: async () => {
              updateCalls += 1;
            },
          }),
        }),
      });
    },
  } as unknown as CloudDatabase;
  const settings: UserSettingsRecord = {
    _id: "set_contract",
    ownerId: "usr_contract",
    currency: "CNY",
    timezone: "Asia/Shanghai",
    defaultTransactionType: "expense",
    defaultExpenseAccountId: "acc_wechat",
    defaultIncomeAccountId: "acc_wechat",
    defaultLocation: {
      locationKey: "open-meteo:39.9042,116.4074",
      displayName: "北京 · 北京市 · 中国",
      source: "manual",
    },
    preferGeolocation: false,
    showWeather: true,
    showBudget: false,
    theme: "system",
    initializationVersion: 2,
    createdAt: NOW,
    updatedAt: NOW,
    version: 2,
  };

  await createCloudBaseUserInitializationStore(database).runTransaction(
    (transaction) => transaction.updateSettings(settings),
  );

  assert.equal(updateCalls, 0);
  const actualPayload = setPayload as Record<string, unknown> | null;
  assert.ok(actualPayload);
  assert.equal(actualPayload._id, undefined);
  assert.deepEqual(actualPayload.defaultLocation, settings.defaultLocation);
});

test("真实云函数响应契约可以被前端解析且不暴露 OPENID", async () => {
  const handler = createUserFunctionHandler({
    getOpenId: () => "trusted-openid-contract",
    getCurrentTime: () => NOW,
    store: new InMemoryUserInitializationStore(),
  });
  const response = await handler({
    action: "init",
    requestId: REQUEST_ID,
    payload: {},
  });

  assert.equal(response.success, true);
  if (!response.success) {
    return;
  }

  const parsed = parseInitializationResult(response.data);
  assert.equal(parsed.initialization.completed, true);
  assert.equal(parsed.settings.defaultExpenseAccountId.length > 0, true);
  assert.equal(parsed.settings.defaultIncomeAccountId.length > 0, true);
  assert.equal(response.requestId, REQUEST_ID);
  assert.equal(JSON.stringify(response).includes("trusted-openid-contract"), false);
});

test("CloudBase runtime metadata is ignored as identity input", async () => {
  const handler = createUserFunctionHandler({
    getOpenId: () => "trusted-openid-from-context",
    getCurrentTime: () => NOW,
    store: new InMemoryUserInitializationStore(),
  });
  const response = await handler({
    action: "init",
    requestId: REQUEST_ID,
    payload: {},
    userInfo: {
      appId: "platform-app-id",
      openId: "untrusted-event-openid",
    },
    source: "cloudbase-runtime",
  });

  assert.equal(response.success, true);
  assert.equal(JSON.stringify(response).includes("untrusted-event-openid"), false);
});

test("top-level user identity fields are rejected", async () => {
  const handler = createUserFunctionHandler({
    getOpenId: () => "trusted-openid-from-context",
    getCurrentTime: () => NOW,
    store: new InMemoryUserInitializationStore(),
  });

  const response = await handler({
    action: "init",
    requestId: REQUEST_ID,
    payload: {},
    openId: "forged-openid",
  });

  assert.equal(response.success, false);
  assert.equal(response.code, "INVALID_ARGUMENT");
});

test("前端初始化请求不发送 userId 或 openId，并透传诊断元数据", async () => {
  let serializedRequest = "";
  const transport = successfulTransport(async (options) => {
    serializedRequest = JSON.stringify({
      functionName: options.functionName,
      action: options.action,
      requestId: options.requestId,
      payload: options.payload,
    });

    return {
      data: options.parseData(INITIALIZATION_RESULT),
      requestId: options.requestId,
      serverTime: NOW.toISOString(),
    };
  });
  const response = await createUserInitializationService(transport).initialize();

  assert.equal(serializedRequest.includes("userId"), false);
  assert.equal(serializedRequest.includes("openId"), false);
  assert.match(response.requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(response.data.initialization.accountsCreated, 5);
});

test("失败后不会自动无限重试，仅在显式再次调用时重试", async () => {
  let calls = 0;
  const transport: UserInitializationTransport = async (
    options,
  ): Promise<CloudCallResult<UserInitializationResult>> => {
    calls += 1;
    if (calls === 1) {
      throw new AppError("DEPENDENCY_ERROR", "初始化暂时不可用", REQUEST_ID);
    }

    return {
      data: options.parseData(INITIALIZATION_RESULT),
      requestId: options.requestId,
      serverTime: NOW.toISOString(),
    };
  };
  const service = createUserInitializationService(transport);

  await assert.rejects(() => service.initialize(), /初始化暂时不可用/u);
  assert.equal(calls, 1);

  const retry = await service.initialize();
  assert.equal(calls, 2);
  assert.equal(retry.data.initialization.completed, true);
});

test("并发前端初始化共用同一个请求，避免重复提交", async () => {
  let calls = 0;
  type UserInitializationCall = CloudCallResult<UserInitializationResult>;
  const pending: {
    release?: (value: UserInitializationCall) => void;
  } = {};
  const transport: UserInitializationTransport = (options) => {
    calls += 1;
    return new Promise<UserInitializationCall>((resolve) => {
      pending.release = resolve;
      void options;
    });
  };
  const service = createUserInitializationService(transport);
  const first = service.initialize();
  const second = service.initialize();

  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  const release = pending.release;
  assert.ok(release);
  release({
    data: INITIALIZATION_RESULT,
    requestId: REQUEST_ID,
    serverTime: NOW.toISOString(),
  });
  await first;
});
