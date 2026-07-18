# Preview Build Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 preview/sandbox 构建闭环，使工作台 App Viewer 从 Idle → Building → Ready/Failed，Ready 时 iframe 可交互预览模板产物。

**Architecture:** `web` → `application`（归属校验 + 三用例）→ `preview`（状态机、全局串行锁、`preview-status.json`）→ `sandbox`（`npm install` 按需 + `npm run build`）。路径由 `workspace.getProjectPaths` 提供，经 `resolvePaths` 注入 preview（preview **不**直接依赖 workspace 包，避免过重耦合）。构建异步入队，HTTP 立即返回；前端 1.5s 轮询。

**Tech Stack:** TypeScript、pnpm workspace、vitest、Node `child_process`/`fs`、Next.js 15 App Router、现有 shadcn `PanelHeader` / `StatusBadge` / `EmptyState` / `Button` / `Skeleton`。

**Spec:** `docs/superpowers/specs/2026-07-18-preview-build-loop-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：遵循 `docs/ui/`（Neutral Tool + shadcn only）；本轮不新建 `ViewerChrome`。
- 依赖：`web` → `application` → `preview` → `sandbox`；`application` / `web` 用 `workspace` 做归属与路径；禁止 API route 直接 `child_process` 或读写 `data/**`。
- 非 owner / 不存在：API **404**（与现有 projects API 一致）。
- 不做：LLM、Agent、SSE、多 job 队列、版本卡片、聊天系统消息、视口切换。
- 构建：本机**全局串行**；超时 **5 分钟**；status 文件不存在视为 `idle`。
- **未经用户要求不要 git commit**（忽略下文若出现的 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `templates/vite-react/vite.config.ts` | `base: './'` + `build.outDir: '../build'` |
| `packages/workspace/src/app/workspace-store.ts` | 新增 `getProjectPaths` |
| `packages/workspace/src/index.ts` | 导出路径类型（若独立） |
| `packages/workspace/src/app/workspace-store.test.ts` | 路径断言 |
| `packages/sandbox/package.json` | vitest + `@types/node` |
| `packages/sandbox/src/domain/types.ts` | `Sandbox` / `BuildInput` / 错误类型 |
| `packages/sandbox/src/infra/local-sandbox.ts` | `createLocalSandbox` |
| `packages/sandbox/src/index.ts` | 导出 |
| `packages/sandbox/src/infra/local-sandbox.test.ts` | 轻量 fixture 构建测 |
| `packages/preview/package.json` | 依赖 sandbox；vitest |
| `packages/preview/src/domain/types.ts` | `PreviewStatusSnapshot` 等 |
| `packages/preview/src/app/preview-service.ts` | 状态机 + 锁 + 读资源 |
| `packages/preview/src/index.ts` | 导出 |
| `packages/preview/src/app/preview-service.test.ts` | mock sandbox 测 |
| `packages/application/package.json` | 加 `@isotope/preview` |
| `packages/application/src/projects/get-preview-status.ts` | 用例 |
| `packages/application/src/projects/enqueue-preview-build.ts` | 用例 |
| `packages/application/src/projects/read-preview-asset.ts` | 用例 |
| `packages/application/src/index.ts` | 导出 |
| `packages/application/src/projects/preview.test.ts` | 归属 + 幂等 |
| `apps/web/package.json` | 加 `@isotope/preview`（若 web 组装 preview 单例） |
| `apps/web/lib/preview.ts` | preview 单例 |
| `apps/web/app/api/projects/[id]/preview/route.ts` | GET |
| `apps/web/app/api/projects/[id]/preview/build/route.ts` | POST |
| `apps/web/app/api/projects/[id]/preview/files/[[...path]]/route.ts` | GET 静态 |
| `apps/web/components/workbench-shell.tsx` | Viewer 状态机 UI |

---

### Task 1: 模板 base/outDir + workspace.getProjectPaths

**Files:**
- Modify: `templates/vite-react/vite.config.ts`
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/index.ts`（若需导出 `ProjectPaths`）
- Modify: `packages/workspace/src/app/workspace-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProjectPaths = {
    workspaceDir: string;
    buildDir: string;
  };

  // on WorkspaceStore:
  getProjectPaths(projectId: string): ProjectPaths | null;
  ```
- Consumes: 现有 `projectWorkspaceDir` / `projectBuildDir` 私有函数

- [ ] **Step 1: 更新 Vite 模板配置**

将 `templates/vite-react/vite.config.ts` 改为：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../build",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: 写失败测试 — getProjectPaths**

在 `workspace-store.test.ts` 追加：

```ts
  it("getProjectPaths returns dirs for existing project only", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const paths = store.getProjectPaths(p.id);
    expect(paths?.workspaceDir).toBe(
      path.join(dataRoot, "projects", p.id, "workspace"),
    );
    expect(paths?.buildDir).toBe(
      path.join(dataRoot, "projects", p.id, "build"),
    );
    expect(store.getProjectPaths("proj_missing")).toBeNull();
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @isotope/workspace test`

Expected: FAIL — `getProjectPaths` is not a function

- [ ] **Step 4: 实现 getProjectPaths**

在 `WorkspaceStore` 类型与实现中增加：

```ts
getProjectPaths(projectId: string): ProjectPaths | null {
  if (!this.getProject(projectId) /* use store.getProject */) {
    return null;
  }
  return {
    workspaceDir: projectWorkspaceDir(projectId),
    buildDir: projectBuildDir(projectId),
  };
}
```

注意：实现里用已有 `getProject`；若项目不存在返回 `null`。从 `index.ts` 导出 `ProjectPaths` 类型（可放在 `domain/types.ts` 或与 store 同文件再导出）。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @isotope/workspace test`

Expected: PASS

- [ ] **Step 6: Commit（仅当用户要求时）**

```bash
git add templates/vite-react/vite.config.ts packages/workspace
git commit -m "feat(workspace): expose project paths and relative vite base"
```

---

### Task 2: @isotope/sandbox 本地构建

**Files:**
- Modify: `packages/sandbox/package.json`
- Create: `packages/sandbox/src/domain/types.ts`
- Create: `packages/sandbox/src/infra/local-sandbox.ts`
- Create: `packages/sandbox/src/infra/local-sandbox.test.ts`
- Modify: `packages/sandbox/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SandboxBuildInput = {
    workspaceDir: string;
    buildDir: string;
    timeoutMs?: number; // default 300_000
  };

  export type Sandbox = {
    build(input: SandboxBuildInput): Promise<void>;
  };

  export class SandboxBuildError extends Error {
    readonly logTail: string;
    constructor(message: string, logTail: string);
  }

  export function createLocalSandbox(): Sandbox;
  ```
- Consumes: Node `child_process.spawn`、`fs`

- [ ] **Step 1: 配置 package.json 测试**

`packages/sandbox/package.json` 增加：

```json
"scripts": {
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run"
},
"devDependencies": {
  "@types/node": "^22.10.0",
  "typescript": "^5.7.2",
  "vitest": "^3.0.0"
}
```

- [ ] **Step 2: 写失败测试（轻量 fixture，不跑真实 Vite 模板）**

`local-sandbox.test.ts`：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSandbox, SandboxBuildError } from "../index.js";

describe("createLocalSandbox", () => {
  let root: string;
  let workspaceDir: string;
  let buildDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "iso-sbx-"));
    workspaceDir = path.join(root, "workspace");
    buildDir = path.join(root, "build");
    fs.mkdirSync(workspaceDir);
    fs.mkdirSync(buildDir);
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: {
          build:
            "node -e \"require('fs').mkdirSync('../build',{recursive:true});require('fs').writeFileSync('../build/index.html','ok')\"",
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs build and leaves artifact in buildDir", async () => {
    const sandbox = createLocalSandbox();
    await sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 });
    expect(fs.readFileSync(path.join(buildDir, "index.html"), "utf8")).toBe("ok");
  });

  it("throws SandboxBuildError with log on failure", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { build: "node -e \"process.exit(1)\"" },
      }),
    );
    const sandbox = createLocalSandbox();
    await expect(
      sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(SandboxBuildError);
  });
});
```

说明：fixture 的 `build` 脚本把文件写到 `../build`，与模板 `outDir` 约定一致；无 `node_modules` 时实现应跳过 `npm install`（无 dependencies）或仍可 `npm install`（应很快）。**实现约定：无 `package-lock.json` 且无 `node_modules` 时仍调用 `npm install`，对无依赖包可接受；或「无 dependencies/devDependencies 则跳过 install」——选后者以加快测试。**

固定实现规则：

1. 若 `workspaceDir/node_modules` 不存在 **且** `package.json` 的 `dependencies`/`devDependencies` 任一非空 → `npm install`
2. 否则跳过 install
3. 再 `npm run build`
4. 若 `buildDir/index.html` 不存在 → 抛 `SandboxBuildError`
5. 超时 kill 进程 → `SandboxBuildError` message `构建超时`

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @isotope/sandbox test`

Expected: FAIL — module/export missing

- [ ] **Step 4: 实现 createLocalSandbox**

`domain/types.ts` + `infra/local-sandbox.ts` 要点：

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runNpm(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });
    let log = "";
    const append = (buf: Buffer) => {
      log = (log + buf.toString()).slice(-2048);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new SandboxBuildError("构建超时", log));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, log });
    });
  });
}

export function createLocalSandbox(): Sandbox {
  return {
    async build(input) {
      const timeoutMs = input.timeoutMs ?? 300_000;
      const pkg = JSON.parse(
        fs.readFileSync(path.join(input.workspaceDir, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const needsInstall =
        !fs.existsSync(path.join(input.workspaceDir, "node_modules")) &&
        Boolean(
          (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
            (pkg.devDependencies && Object.keys(pkg.devDependencies).length),
        );
      if (needsInstall) {
        const install = await runNpm(["install"], input.workspaceDir, timeoutMs);
        if (install.code !== 0) {
          throw new SandboxBuildError("npm install 失败", install.log);
        }
      }
      const built = await runNpm(["run", "build"], input.workspaceDir, timeoutMs);
      if (built.code !== 0) {
        throw new SandboxBuildError("构建失败", built.log);
      }
      if (!fs.existsSync(path.join(input.buildDir, "index.html"))) {
        throw new SandboxBuildError("构建成功但缺少 index.html", built.log);
      }
    },
  };
}
```

从 `index.ts` 导出类型、`SandboxBuildError`、`createLocalSandbox`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @isotope/sandbox test`

Expected: PASS

- [ ] **Step 6: Commit（仅当用户要求时）**

```bash
git add packages/sandbox
git commit -m "feat(sandbox): add local npm build runner"
```

---

### Task 3: @isotope/preview 状态机与串行锁

**Files:**
- Modify: `packages/preview/package.json`
- Create: `packages/preview/src/domain/types.ts`
- Create: `packages/preview/src/app/preview-service.ts`
- Create: `packages/preview/src/app/preview-service.test.ts`
- Modify: `packages/preview/src/index.ts`

**Interfaces:**
- Consumes: `Sandbox` from `@isotope/sandbox`
- Produces:
  ```ts
  export type PreviewStatus = "idle" | "building" | "ready" | "failed";

  export type PreviewStatusSnapshot = {
    status: PreviewStatus;
    revision: string | null;
    error: string | null;
    updatedAt: string;
  };

  export type PreviewAsset = {
    body: Buffer;
    contentType: string;
  };

  export type ResolveProjectPaths = (
    projectId: string,
  ) => { workspaceDir: string; buildDir: string } | null;

  export type PreviewService = {
    getStatus(projectId: string): PreviewStatusSnapshot;
    ensureBuild(projectId: string): PreviewStatusSnapshot;
    enqueueBuild(projectId: string): PreviewStatusSnapshot;
    readAsset(
      projectId: string,
      relativePath: string,
    ): PreviewAsset | null; // null if not ready / missing / escape
  };

  export function createPreviewService(opts: {
    resolvePaths: ResolveProjectPaths;
    sandbox: Sandbox;
    buildTimeoutMs?: number;
    staleBuildingMs?: number; // default 300_000
  }): PreviewService;
  ```

状态文件路径：`path.join(path.dirname(workspaceDir), "preview-status.json")`。

行为要点：

- 无文件 → `{ status: "idle", revision: null, error: null, updatedAt: now }`
- `ensureBuild`：`ready` → 原样返回；活跃 `building`（未过 stale）→ 原样返回；否则启动后台构建并立刻返回 `building`
- `enqueueBuild`：若活跃 `building` → 原样返回；否则强制后台构建并返回 `building`
- 后台：全局 `let chain = Promise.resolve()` 串行；写 `building` → `sandbox.build` → 成功写 `ready` + 新 `revision`（`Date.now().toString(36)` 即可）+ `error: null`；失败写 `failed` + `error`（`err.logTail` 或 message，截断 2KB）
- `readAsset`：仅 `ready`；默认相对路径 `index.html`；用与 workspace 相同的防穿越逻辑解析到 `buildDir`；按扩展名设 `contentType`（至少 `html`/`js`/`css`/`svg`/`json`/`ico`/`woff2`，默认 `application/octet-stream`）
- stale：`building` 且 `Date.now() - updatedAt > staleBuildingMs` → 视为可重新入队（ensure/enqueue 可启动新构建）

- [ ] **Step 1: 配置 preview package.json**

依赖 `"@isotope/sandbox": "workspace:*"`；scripts/devDeps 同 sandbox（vitest、typescript、`@types/node`）。

- [ ] **Step 2: 写失败测试（mock sandbox）**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "@isotope/sandbox";
import { createPreviewService } from "./preview-service.js";

describe("createPreviewService", () => {
  let root: string;
  let workspaceDir: string;
  let buildDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "iso-prev-"));
    workspaceDir = path.join(root, "workspace");
    buildDir = path.join(root, "build");
    fs.mkdirSync(workspaceDir);
    fs.mkdirSync(buildDir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ensureBuild is idempotent when ready", async () => {
    let builds = 0;
    const sandbox: Sandbox = {
      async build() {
        builds += 1;
        fs.writeFileSync(path.join(buildDir, "index.html"), "<html></html>");
      },
    };
    const preview = createPreviewService({
      resolvePaths: (id) =>
        id === "p1" ? { workspaceDir, buildDir } : null,
      sandbox,
    });
    preview.ensureBuild("p1");
    await vi.waitFor(() => expect(preview.getStatus("p1").status).toBe("ready"));
    expect(builds).toBe(1);
    preview.ensureBuild("p1");
    await new Promise((r) => setTimeout(r, 50));
    expect(builds).toBe(1);
  });

  it("enqueueBuild marks failed on sandbox error", async () => {
    const sandbox: Sandbox = {
      async build() {
        const { SandboxBuildError } = await import("@isotope/sandbox");
        throw new SandboxBuildError("构建失败", "boom");
      },
    };
    const preview = createPreviewService({
      resolvePaths: () => ({ workspaceDir, buildDir }),
      sandbox,
    });
    preview.enqueueBuild("p1");
    await vi.waitFor(() => expect(preview.getStatus("p1").status).toBe("failed"));
    expect(preview.getStatus("p1").error).toContain("boom");
  });

  it("readAsset rejects path escape and non-ready", () => {
    const sandbox: Sandbox = { async build() {} };
    const preview = createPreviewService({
      resolvePaths: () => ({ workspaceDir, buildDir }),
      sandbox,
    });
    expect(preview.readAsset("p1", "index.html")).toBeNull();
    fs.writeFileSync(
      path.join(root, "preview-status.json"),
      JSON.stringify({
        status: "ready",
        revision: "1",
        error: null,
        updatedAt: new Date().toISOString(),
      }),
    );
    fs.writeFileSync(path.join(buildDir, "index.html"), "hi");
    expect(preview.readAsset("p1", "../preview-status.json")).toBeNull();
    expect(preview.readAsset("p1", "index.html")?.body.toString()).toBe("hi");
  });
});
```

注意：status 文件在 `path.dirname(workspaceDir)` = `root`，与 layout 一致。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @isotope/preview test`

Expected: FAIL

- [ ] **Step 4: 实现 createPreviewService**

按 Interfaces 实现；后台任务用：

```ts
let queue: Promise<void> = Promise.resolve();
const active = new Set<string>(); // projectIds currently scheduled/running

function schedule(projectId: string, job: () => Promise<void>) {
  active.add(projectId);
  queue = queue.then(job).finally(() => {
    active.delete(projectId);
  });
}
```

「活跃 building」判定：内存 `active` 有该 id，**或** 磁盘 status 为 `building` 且未 stale。`ensure`/`enqueue` 在调度前写入 `building`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @isotope/preview test`

Expected: PASS

- [ ] **Step 6: Commit（仅当用户要求时）**

```bash
git add packages/preview
git commit -m "feat(preview): add build status machine and asset reader"
```

---

### Task 4: application 三用例

**Files:**
- Modify: `packages/application/package.json`（依赖 `@isotope/preview`）
- Create: `packages/application/src/projects/get-preview-status.ts`
- Create: `packages/application/src/projects/enqueue-preview-build.ts`
- Create: `packages/application/src/projects/read-preview-asset.ts`
- Create: `packages/application/src/projects/preview.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `WorkspaceStore`、`PreviewService`、`getProject` 模式
- Produces:
  ```ts
  getPreviewStatus(
    input: { ownerUserId: string; projectId: string; ensure?: boolean },
    workspace: WorkspaceStore,
    preview: PreviewService,
  ): PreviewStatusSnapshot | null;

  enqueuePreviewBuild(
    input: { ownerUserId: string; projectId: string },
    workspace: WorkspaceStore,
    preview: PreviewService,
  ): PreviewStatusSnapshot | null;

  readPreviewAsset(
    input: { ownerUserId: string; projectId: string; relativePath: string },
    workspace: WorkspaceStore,
    preview: PreviewService,
  ): PreviewAsset | null;
  ```

规则：先 `getProject` 归属；失败返回 `null`。`ensure === true` 时调 `preview.ensureBuild`，否则 `getStatus`。

- [ ] **Step 1: 写失败测试**

`preview.test.ts`：用真实 `createFsSqliteWorkspace` + mock `PreviewService`（记录调用次数）。

```ts
it("hides preview from non-owners", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  const preview = {
    getStatus: vi.fn(),
    ensureBuild: vi.fn(),
    enqueueBuild: vi.fn(),
    readAsset: vi.fn(),
  };
  expect(
    getPreviewStatus(
      { ownerUserId: "other", projectId: project.id, ensure: true },
      workspace,
      preview,
    ),
  ).toBeNull();
  expect(preview.ensureBuild).not.toHaveBeenCalled();
});

it("ensure skips rebuild when service returns ready without enqueue", () => {
  // mock ensureBuild/getStatus；断言 owner 可调用 ensureBuild 一次路径
});
```

第二个测：owner + `ensure: true` → 调用 `ensureBuild` 而非 `enqueueBuild`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @isotope/application test`

Expected: FAIL on missing exports

- [ ] **Step 3: 实现三用例并导出；更新 package.json dependencies**

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @isotope/application test`

Expected: PASS（含原有 projects 测）

- [ ] **Step 5: Commit（仅当用户要求时）**

```bash
git add packages/application
git commit -m "feat(application): add preview status build and asset use cases"
```

---

### Task 5: web API 路由 + preview 单例

**Files:**
- Modify: `apps/web/package.json`（`"@isotope/preview": "workspace:*"`）
- Create: `apps/web/lib/preview.ts`
- Create: `apps/web/app/api/projects/[id]/preview/route.ts`
- Create: `apps/web/app/api/projects/[id]/preview/build/route.ts`
- Create: `apps/web/app/api/projects/[id]/preview/files/[[...path]]/route.ts`
- Modify: `apps/web/next.config.ts`（若需 transpile `@isotope/preview` / `@isotope/sandbox`）

**Interfaces:**
- Consumes: application 三用例、`getWorkspace`、`createPreviewService` + `createLocalSandbox`

- [ ] **Step 1: 实现 `lib/preview.ts`**

```ts
import { createLocalSandbox } from "@isotope/sandbox";
import { createPreviewService, type PreviewService } from "@isotope/preview";
import { getWorkspace } from "./workspace";

let preview: PreviewService | null = null;

export function getPreview(): PreviewService {
  if (!preview) {
    const workspace = getWorkspace();
    preview = createPreviewService({
      resolvePaths: (projectId) => workspace.getProjectPaths(projectId),
      sandbox: createLocalSandbox(),
    });
  }
  return preview;
}
```

- [ ] **Step 2: GET `/api/projects/[id]/preview`**

模式对齐 `messages/route.ts`：

- 未登录 → 401
- `getPreviewStatus({ ownerUserId, projectId, ensure: url.searchParams.get("ensure") === "1" }, workspace, preview)`
- null → 404 `{ error: "项目不存在" }`
- 200 `{ preview: snapshot }`

- [ ] **Step 3: POST `/api/projects/[id]/preview/build`**

- `enqueuePreviewBuild(...)`；null → 404；200 `{ preview: snapshot }`

- [ ] **Step 4: GET files 代理**

```ts
const segments = (await context.params).path ?? [];
const relativePath = segments.length ? segments.join("/") : "index.html";
const asset = readPreviewAsset(
  { ownerUserId: session.username, projectId: id, relativePath },
  getWorkspace(),
  getPreview(),
);
if (!asset) {
  // 无项目 → 与 getProject 一致 404；有项目但未 ready/无文件 → 404
  return NextResponse.json({ error: "预览不可用" }, { status: 404 });
}
return new NextResponse(asset.body, {
  headers: {
    "Content-Type": asset.contentType,
    "Cache-Control": "no-cache",
  },
});
```

确认 `next.config.ts` 的 `transpilePackages` 含 `@isotope/preview`、`@isotope/sandbox`（若尚无）。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 6: Commit（仅当用户要求时）**

```bash
git add apps/web
git commit -m "feat(web): add preview status and static asset API routes"
```

---

### Task 6: Workbench App Viewer UI

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: GET `?ensure=1`、POST build、files URL；`StatusBadge` status keys 已有 `idle|building|ready|failed`

- [ ] **Step 1: 增加 preview 状态与轮询**

在 `WorkbenchShell` 内：

```ts
type PreviewSnapshot = {
  status: "idle" | "building" | "ready" | "failed";
  revision: string | null;
  error: string | null;
  updatedAt: string;
};

const [preview, setPreview] = useState<PreviewSnapshot | null>(null);

async function fetchPreview(ensure: boolean) {
  const res = await fetch(
    `/api/projects/${project.id}/preview${ensure ? "?ensure=1" : ""}`,
  );
  // ... parse { preview }
  setPreview(data.preview);
}

useEffect(() => {
  void fetchPreview(true);
}, [project.id]);

useEffect(() => {
  if (!preview || preview.status !== "building") return;
  const id = window.setInterval(() => {
    void fetchPreview(false);
  }, 1500);
  return () => window.clearInterval(id);
}, [preview?.status, project.id]);
```

刷新/重试：

```ts
async function handleRebuild() {
  await fetch(`/api/projects/${project.id}/preview/build`, { method: "POST" });
  await fetchPreview(false);
}
```

- [ ] **Step 2: 右栏按状态渲染**

- `PanelHeader` `trailing`：`StatusBadge` 映射 `preview?.status ?? "idle"`；Ready/Building 时加刷新 `Button` variant=`outline` size=`sm`（Building 时可 disabled 或仍允许 POST——按 spec：Building 中 POST 返回 building，按钮可保留）
- Idle：现有 EmptyState 文案可微调为「尚未构建预览」
- Building：`Skeleton` 块 + 文案「正在构建预览…」
- Ready：
  ```tsx
  <iframe
    title="App Viewer"
    className="h-full w-full flex-1 border-0 bg-background"
    src={`/api/projects/${project.id}/preview/files/?r=${preview.revision ?? "0"}`}
  />
  ```
  外层去掉 `justify-center`，改为 `min-h-0 flex-1`
- Failed：`EmptyState` 或段落显示 `preview.error` + `Button`「重试」→ `handleRebuild`

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 4: 手动验收（开发者）**

1. `pnpm --filter @isotope/web dev`，登录，创建项目，打开工作台  
2. 右栏 Building → Ready，iframe 可见模板  
3. 刷新浏览器仍 Ready（Network 中 ensure 不应导致长时间 building，除非人为清空 status）  
4. 点刷新 → 再次 Building → Ready  
5. （可选）改坏 workspace `package.json` 脚本再构建 → Failed → 修复后重试恢复  

- [ ] **Step 5: Commit（仅当用户要求时）**

```bash
git add apps/web/components/workbench-shell.tsx
git commit -m "feat(web): wire App Viewer to preview build status"
```

---

## Self-Review (plan vs spec)

| Spec 项 | Task |
|---------|------|
| sandbox install/build | T2 |
| preview 状态机 / 锁 / status JSON | T3 |
| application 三用例 + 归属 | T4 |
| web 轮询 + UI 四态 + iframe | T5–T6 |
| 打开 ensure + 手动刷新 | T6 |
| `base: './'` + 产物到 build/ | T1（outDir）+ T2 校验 index.html |
| 路径穿越拒绝 | T3 readAsset |
| 非目标未纳入 | ✓ |

无 TBD；类型名在任务间一致（`PreviewStatusSnapshot` / `PreviewService` / `getProjectPaths`）。
