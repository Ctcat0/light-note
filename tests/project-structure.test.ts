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

test("app.json 注册四个一级页面和底部导航", () => {
  const config = readJsonFile<AppConfiguration>("miniprogram/app.json");
  const expectedPages = [
    "pages/home/index",
    "pages/ledger/index",
    "pages/todo/index",
    "pages/profile/index",
  ];

  assert.deepEqual(config.pages, expectedPages);
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
