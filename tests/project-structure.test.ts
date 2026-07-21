import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

interface AppConfiguration {
  pages: string[];
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
    "pages/todo/index",
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

test("用户和记账云函数部署入口与依赖位于独立函数目录", () => {
  for (const functionName of ["user", "ledger"]) {
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

test("流水页和收支新增/编辑页只通过 ledger service 访问数据", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "ledger", "index.ts"),
    "utf8",
  );
  assert.match(page, /ledgerService\.listTransactions/);
  assert.match(page, /selectedType/);
  assert.match(page, /loadingMore/);
  assert.match(page, /requestVersion/);
  assert.doesNotMatch(page, /wx\.cloud\.(?:database|callFunction)/);

  const createPage = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "transaction-create", "index.ts"),
    "utf8",
  );
  assert.match(createPage, /ledgerService\.createTransaction/);
  assert.match(createPage, /listCategories/);
  assert.match(createPage, /ledgerService\.getTransaction/);
  assert.match(createPage, /submitting/);
  assert.match(createPage, /requestId/);
  assert.doesNotMatch(createPage, /wx\.cloud\.(?:database|callFunction)/);

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

test("首页通过独立月度汇总接口展示收支摘要和完整异步状态", () => {
  const page = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "home", "index.ts"),
    "utf8",
  );
  const template = readFileSync(
    join(workspaceRoot, "miniprogram", "pages", "home", "index.wxml"),
    "utf8",
  );
  assert.match(page, /ledgerService\.getMonthlySummary/);
  assert.match(page, /monthIncomeInCents/);
  assert.match(page, /monthExpenseInCents/);
  assert.match(page, /monthBalanceInCents/);
  assert.match(template, /viewState === 'loading'/);
  assert.match(template, /viewState === 'error'/);
  assert.match(template, /viewState === 'empty'/);
  assert.match(page, /type=expense/);
  assert.match(page, /type=income/);
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
