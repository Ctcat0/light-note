import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

interface AppConfiguration {
  pages: string[];
  permission: {
    "scope.userLocation": { desc: string };
  };
  requiredPrivateInfos: string[];
  tabBar: {
    list: Array<{ pagePath: string; text: string }>;
  };
}

interface ProjectConfiguration {
  miniprogramRoot: string;
  cloudfunctionRoot: string;
  compileType: string;
  setting: {
    useCompilerPlugins: string[];
  };
}

interface CloudFunctionPackage {
  main: string;
  dependencies: Record<string, string>;
}

const workspaceRoot = resolve(import.meta.dirname, "..");

function readJsonFile<T>(relativePath: string): T {
  const content = readFileSync(join(workspaceRoot, relativePath), "utf8");

  return JSON.parse(content) as T;
}

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);

    return statSync(absolutePath).isDirectory()
      ? collectFiles(absolutePath)
      : [absolutePath];
  });
}

test("app.json 注册四个一级页面、支出新增/编辑页和底部导航", () => {
  const config = readJsonFile<AppConfiguration>("miniprogram/app.json");
  const expectedPages = [
    "pages/home/index",
    "pages/ledger/index",
    "pages/todo/index",
    "pages/profile/index",
  ];

  assert.deepEqual(config.pages, [
    "pages/home/index",
    "pages/ledger/index",
    "pages/transaction-create/index",
    "pages/transaction-edit/index",
    "pages/statistics/index",
    "pages/todo/index",
    "pages/todo-edit/index",
    "pages/weather/index",
    "pages/legal/index",
    "pages/profile/index",
  ]);
  assert.deepEqual(
    config.tabBar.list.map((item) => item.pagePath),
    expectedPages,
  );
  assert.deepEqual(
    config.tabBar.list.map((item) => item.text),
    ["首页", "记账", "待办", "我的"],
  );
  assert.match(config.permission["scope.userLocation"].desc, /天气/u);
  assert.deepEqual(config.requiredPrivateInfos, ["getLocation"]);
});

test("统计页通过 statistics service 展示汇总、趋势、分类与局部错误状态", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "statistics", "index.ts"),
    "utf8",
  );
  const template = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "statistics", "index.wxml"),
    "utf8",
  );
  assert.match(page, /statisticsService\.getSummary/);
  assert.match(page, /statisticsService\.getTrend/);
  assert.match(page, /statisticsService\.getCategoryStatistics/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /partialError/);
  assert.match(page, /requestVersion/);
  assert.match(template, /月度概览/);
  assert.match(template, /月度趋势/);
  assert.match(template, /支出分类/);
  assert.match(template, /收入分类/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);
});

test("开发者工具配置指向小程序和云函数目录并启用 TypeScript", () => {
  const config = readJsonFile<ProjectConfiguration>("project.config.json");

  assert.equal(config.miniprogramRoot, "miniprogram/");
  assert.equal(config.cloudfunctionRoot, "cloudfunctions/");
  assert.equal(config.compileType, "miniprogram");
  assert.deepEqual(config.setting.useCompilerPlugins, ["typescript"]);
});

test("每个一级页面具有 ts、json、wxml 和 wxss 文件", () => {
  const pages = ["home", "ledger", "todo", "profile"];

  for (const page of pages) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      const path = join(
        workspaceRoot,
        "miniprogram",
        "pages",
        page,
        `index.${extension}`,
      );

      assert.equal(statSync(path).isFile(), true, path);
    }
  }
});

test("每个一级页面接入统一 loading、empty、error 和 retry 状态", () => {
  const pages = ["home", "ledger", "todo", "profile"];

  for (const page of pages) {
    const templatePath = join(
      workspaceRoot,
      "miniprogram",
      "pages",
      page,
      "index.wxml",
    );
    const content = readFileSync(templatePath, "utf8");

    assert.match(content, /<app-loading\b/);
    assert.match(content, /<app-empty\b/);
    assert.match(content, /<app-error-state\b/);
    assert.match(content, /bind:retry="handleRetry"/);
  }
});

test("小程序前端不直连数据库且不包含常见密钥赋值", () => {
  const miniprogramRoot = join(workspaceRoot, "miniprogram");
  const sourceFiles = collectFiles(miniprogramRoot).filter((path) =>
    /\.(ts|json|wxml|wxss)$/.test(path),
  );
  const forbiddenPatterns = [
    /wx\.cloud\.database\s*\(/,
    /WEATHER_API_KEY\s*[:=]\s*["'][^"']+["']/,
    /SECRET(?:_?KEY)?\s*[:=]\s*["'][^"']+["']/i,
  ];

  for (const sourceFile of sourceFiles) {
    const content = readFileSync(sourceFile, "utf8");

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(content, pattern, sourceFile);
    }
  }
});

test("业务云函数部署入口与依赖位于独立函数目录", () => {
  for (const functionName of [
    "user",
    "ledger",
    "todo",
    "weather",
    "home",
    "dataDeletion",
    "dataDeletionExecutor",
  ]) {
    const functionPackage = readJsonFile<CloudFunctionPackage>(
      `cloudfunctions/${functionName}/package.json`,
    );
    const entry = readFileSync(
      join(workspaceRoot, "cloudfunctions", functionName, "index.js"),
      "utf8",
    );

    assert.equal(functionPackage.main, "index.js");
    assert.equal(functionPackage.dependencies["wx-server-sdk"], "3.0.1");
    assert.match(
      entry,
      new RegExp(`require\\(\"\\.\\/dist\\/cloudfunctions\\/${functionName}\\/src\\/index\\.js\"\\)`),
    );
    assert.doesNotMatch(entry, /[A-Za-z]:\\/u);
  }
});

test("设置页只通过 service 更新分组偏好和删除申请", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "profile", "index.ts"),
    "utf8",
  );
  const template = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "profile", "index.wxml"),
    "utf8",
  );
  assert.match(page, /updateCurrentUserSettings/);
  assert.match(page, /group:\s*"ledger"/);
  assert.match(page, /group:\s*"weather"/);
  assert.match(page, /dataDeletionService\.request/);
  assert.match(page, /dataDeletionService\.cancel/);
  assert.match(page, /clearWeatherLocalCache/);
  assert.match(page, /clearHomeSnapshot/);
  assert.match(template, /默认支付方式/);
  assert.match(template, /默认收款方式/);
  assert.match(template, /隐私政策/);
  assert.match(template, /用户协议/);
  assert.match(template, /申请删除个人数据/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);
});

test("待办列表和编辑页只通过 todo service 完成筛选与修改闭环", () => {
  const listPage = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo", "index.ts"), "utf8");
  const editPage = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo-edit", "index.ts"), "utf8");
  const template = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo", "index.wxml"), "utf8");
  const listStyle = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo", "index.wxss"), "utf8");
  const editTemplate = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo-edit", "index.wxml"), "utf8");
  const editStyle = readFileSync(join(workspaceRoot, "miniprogram", "pages", "todo-edit", "index.wxss"), "utf8");
  assert.match(listPage, /todoService\.listTodos/);
  assert.match(listPage, /todoService\.setTodoStatus/);
  assert.match(listPage, /todoService\.deleteTodo/);
  assert.match(listPage, /showModal/);
  assert.match(editPage, /todoService\.createTodo/);
  assert.match(editPage, /todoService\.updateTodo/);
  assert.match(editPage, /expectedVersion/);
  assert.match(listPage + template, /今天/);
  assert.match(listPage + template, /近期/);
  assert.match(listPage + template, /逾期/);
  assert.match(template, /class="todo-create-entry"/);
  assert.match(template, /class="todo-card-actions"/);
  assert.match(template, /class="filter-row"[\s\S]*class="todo-create-entry"[\s\S]*class="page-state-card"/);
  assert.match(listStyle, /\.todo-create-entry\s*\{/);
  assert.match(editTemplate, /class="todo-form-action-dock"/);
  assert.match(editStyle, /\.todo-form-action-dock\s*\{[\s\S]*position:\s*fixed/);
  assert.doesNotMatch(listPage + editPage, /wx\.cloud\.(?:database|callFunction)/);
});

test("混合流水页和收支新增/编辑页只通过 ledger service 访问数据", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "ledger", "index.ts"),
    "utf8",
  );
  assert.match(page, /ledgerService\.listTransactions/);
  assert.match(page, /selectedFilter/);
  assert.match(page, /filter:\s*this\.data\.selectedFilter/);
  assert.match(page, /monthBalanceInCents/);
  assert.doesNotMatch(page, /showActionSheet/);
  assert.match(page, /transaction-create\/index/);
  assert.match(page, /loadingMore/);
  assert.match(page, /requestVersion/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);

  const listTemplate = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "ledger", "index.wxml"),
    "utf8",
  );
  const listStyle = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "ledger", "index.wxss"),
    "utf8",
  );
  assert.match(listTemplate, /class="month-card-shell"/);
  assert.match(listTemplate, /class="ledger-drop-add"/);
  assert.match(listTemplate, /class="summary-total summary-income"/);
  assert.match(listTemplate, /class="summary-total summary-expense"/);
  assert.match(listStyle, /\.ledger-drop-add\s*\{[\s\S]*position:\s*absolute/);
  assert.match(listStyle, /\.ledger-drop-add\s*\{[\s\S]*left:\s*50%/);
  assert.match(listStyle, /transform:\s*rotate\(45deg\)/);

  const createPage = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "transaction-create", "index.ts"),
    "utf8",
  );
  assert.match(createPage, /ledgerService\.createTransaction/);
  assert.match(createPage, /listCategories/);
  assert.match(createPage, /ledgerService\.getTransaction/);
  assert.match(createPage, /submitting/);
  assert.match(createPage, /requestId/);
  assert.match(createPage, /handleTransactionTypeChange/);
  assert.doesNotMatch(createPage, /wx\.cloud\.(?:database|callFunction)/);
  const createTemplate = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "transaction-create", "index.wxml"),
    "utf8",
  );
  const createStyle = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "transaction-create", "index.wxss"),
    "utf8",
  );
  assert.match(createTemplate, /class="transaction-type-switch/);
  assert.match(createTemplate, /data-type="expense"/);
  assert.match(createTemplate, /data-type="income"/);
  assert.match(createTemplate, /class="form-action-dock"/);
  assert.match(createStyle, /\.form-action-dock\s*\{[\s\S]*position:\s*fixed/);

  const editPage = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "transaction-edit", "index.ts"),
    "utf8",
  );
  assert.match(editPage, /ledgerService\.getTransaction/);
  assert.match(editPage, /ledgerService\.updateTransaction/);
  assert.match(editPage, /ledgerService\.deleteTransaction/);
  assert.match(editPage, /expectedVersion/);
  assert.match(editPage, /requestId/);
  assert.doesNotMatch(editPage, /wx\.cloud\.(?:database|callFunction)/);
});

test("首页通过 home service 聚合天气、待办、收支和局部降级状态", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "home", "index.ts"),
    "utf8",
  );
  const template = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "home", "index.wxml"),
    "utf8",
  );
  assert.match(page, /homeService\.getOverview/);
  assert.match(page, /loadHomeSnapshot/);
  assert.match(page, /todoService\.setTodoStatus/);
  assert.match(template, /weatherAvailable/);
  assert.match(template, /todosAvailable/);
  assert.match(template, /ledgerAvailable/);
  assert.match(template, /viewState === 'loading'/);
  assert.match(template, /viewState === 'error'/);
  assert.match(template, /viewState === 'empty'/);
  assert.match(page, /type=expense/);
  assert.match(page, /type=income/);
  assert.match(page, /todo-edit/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);
});

test("天气页通过 weather service 搜索城市并按用户设置决定是否优先定位", () => {
  const page = readFileSync(join(workspaceRoot, "miniprogram", "pages", "weather", "index.ts"), "utf8");
  const template = readFileSync(join(workspaceRoot, "miniprogram", "pages", "weather", "index.wxml"), "utf8");
  assert.match(page, /weatherService\.searchLocations/);
  assert.match(page, /weatherService\.getWeather/);
  assert.match(page, /updateCurrentUserSettings/);
  assert.match(page, /handleUseCurrentLocation/);
  assert.match(page, /type:\s*"wgs84"/);
  assert.match(page, /wx\.openSetting/);
  assert.match(page, /isLocationPermissionDenied/);
  assert.match(template, /手动搜索城市/);
  assert.match(template, /打开设置授权定位/);
  assert.match(template, /Open-Meteo/);
  assert.match(template, /app-loading/);
  assert.match(template, /app-empty/);
  assert.match(template, /app-error-state/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);
});

test("本地环境配置和云函数构建产物不会进入 Git", () => {
  const gitignore = readFileSync(join(workspaceRoot, ".gitignore"), "utf8");

  assert.match(gitignore, /^\.env\.\*$/mu);
  assert.match(gitignore, /^!\.env\.example$/mu);
  assert.match(
    gitignore,
    /^miniprogram\/config\/environment\.runtime\.ts$/mu,
  );
  assert.match(gitignore, /^cloudfunctions\/\*\*\/dist\/$/mu);
});
