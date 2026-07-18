# Workspace Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现第 2 步：SQLite 项目/消息持久化 + 模板复制 + application 用例 + 首页/工作台真实接线（无 LLM / preview）。

**Architecture:** `web` → `application`（五用例 + 归属校验）→ `workspace`（`better-sqlite3` 索引 + FS 源码树）。列表按 `owner_user_id` 查询，不扫目录。创建时复制 `templates/vite-react` → `data/projects/<id>/workspace/`。

**Tech Stack:** TypeScript、pnpm workspace、`better-sqlite3`、Node `fs`/`path`/`crypto`、vitest、Next.js 15 App Router。

**Spec:** `docs/superpowers/specs/2026-07-18-workspace-persistence-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖方向：`web` → `application` → `workspace` / `identity` → `kernel`；禁止 UI 写 DB/归属规则；禁止绕过 workspace 读写 `data/projects/**`。
- 不做：LLM、Agent、vite build、preview iframe、Team 任务、版本卡片、工作台切 mode、Prompt。
- 助手占位文案固定：`已收到你的需求。预览与智能体编排将在下一步接入；当前仅持久化对话。`；`agentName` 恒为 `Alex`。
- 项目名：需求 trim + 压缩空白后截断 **32** 字符，截断则加 `…`；空则 `未命名项目`。
- 非 owner / 不存在：API 404；页面 `notFound()`。
- **未经用户要求不要 git commit**（忽略下文若出现的 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关骨架包。

## File Structure

| 路径 | 职责 |
|------|------|
| `.gitignore` | 补 `data/*.sqlite`、`data/*.sqlite-*` |
| `templates/vite-react/**` | 最小可构建 Vite+React+TS 模板 |
| `packages/workspace/src/domain/types.ts` | `Project` / `Message` / `ProjectMode` |
| `packages/workspace/src/domain/project-name.ts` | 命名启发式 |
| `packages/workspace/src/domain/paths.ts` | workspace 相对路径安全解析 |
| `packages/workspace/src/infra/db.ts` | SQLite 打开 + migrate |
| `packages/workspace/src/infra/fs-store.ts` | 模板复制 + 文件读写列 |
| `packages/workspace/src/app/workspace-store.ts` | `createFsSqliteWorkspace` 实现全部端口 |
| `packages/workspace/src/index.ts` | 窄导出 |
| `packages/workspace/src/**/*.test.ts` | vitest |
| `packages/application/src/projects/*.ts` | 五用例 + 占位文案常量 |
| `packages/application/src/index.ts` | 导出 |
| `apps/web/lib/paths.ts` | `dataRoot` / `templatePath` |
| `apps/web/lib/workspace.ts` | workspace 单例 |
| `apps/web/lib/auth.ts` | 沿用；API 用 `readSession` |
| `apps/web/app/api/projects/**` | REST API |
| `apps/web/app/(app)/page.tsx` | RSC 注入项目列表 |
| `apps/web/components/home-shell.tsx` | 真实创建 + 列表 |
| `apps/web/app/(app)/projects/[id]/page.tsx` | RSC 加载项目+消息 / notFound |
| `apps/web/components/workbench-shell.tsx` | 消息回显 + 发送 |
| `apps/web/next.config.ts` | transpile workspace；`serverExternalPackages: ['better-sqlite3']` |

---

### Task 1: gitignore + vite-react 模板

**Files:**
- Modify: `.gitignore`
- Create: `templates/vite-react/package.json`
- Create: `templates/vite-react/tsconfig.json`
- Create: `templates/vite-react/tsconfig.app.json`
- Create: `templates/vite-react/tsconfig.node.json`
- Create: `templates/vite-react/vite.config.ts`
- Create: `templates/vite-react/index.html`
- Create: `templates/vite-react/src/main.tsx`
- Create: `templates/vite-react/src/App.tsx`
- Create: `templates/vite-react/src/vite-env.d.ts`
- Keep: `templates/vite-react/README.md`（可微调一句）

**Interfaces:**
- Produces: 可被递归复制的模板树（本步不执行 install/build）

- [ ] **Step 1: 更新 `.gitignore`**

在「runtime workspace data」段追加：

```gitignore
data/*.sqlite
data/*.sqlite-*
```

- [ ] **Step 2: 写入最小 Vite+React+TS 模板**

`templates/vite-react/package.json`:

```json
{
  "name": "isotope-workspace-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.7.2",
    "vite": "^6.0.0"
  }
}
```

`templates/vite-react/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

`templates/vite-react/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`templates/vite-react/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

`templates/vite-react/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

`templates/vite-react/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Isotope App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`templates/vite-react/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`templates/vite-react/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`templates/vite-react/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Isotope Workspace</h1>
      <p>由模板创建的起始应用。后续由 Agent 迭代改码。</p>
    </main>
  );
}
```

- [ ] **Step 3: 确认模板文件存在**

Run: `find templates/vite-react -type f | sort`  
Expected: 含 `package.json`、`vite.config.ts`、`index.html`、`src/App.tsx`、`src/main.tsx` 等。

- [ ] **Step 4: Commit**（若用户未要求则跳过）

```bash
git add .gitignore templates/vite-react
git commit -m "chore: add vite-react workspace template and sqlite gitignore"
```

---

### Task 2: workspace 领域类型 + 命名启发式 + 路径安全

**Files:**
- Create: `packages/workspace/src/domain/types.ts`
- Create: `packages/workspace/src/domain/project-name.ts`
- Create: `packages/workspace/src/domain/project-name.test.ts`
- Create: `packages/workspace/src/domain/paths.ts`
- Create: `packages/workspace/src/domain/paths.test.ts`
- Modify: `packages/workspace/package.json`（加 `vitest`、`test` script、`@types/node`）
- Modify: `packages/workspace/src/index.ts`（先只导出类型与 `deriveProjectName`）

**Interfaces:**
- Produces:
  - `type ProjectMode = "engineer" | "team"`
  - `type Project = { id: string; name: string; mode: ProjectMode; ownerUserId: string; createdAt: string; updatedAt: string }`
  - `type MessageRole = "user" | "assistant" | "system"`
  - `type Message = { id: string; projectId: string; role: MessageRole; content: string; createdAt: string; agentName?: string }`
  - `deriveProjectName(requirement: string): string`
  - `resolveWorkspaceRelativePath(workspaceRoot: string, relativePath: string): string` — 非法则 throw `Error("Invalid path")`

- [ ] **Step 1: 配置 vitest**

`packages/workspace/package.json` scripts/devDeps 对齐 identity：

```json
{
  "name": "@isotope/workspace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/workspace/src/domain/project-name.test.ts
import { describe, expect, it } from "vitest";
import { deriveProjectName } from "./project-name.js";

describe("deriveProjectName", () => {
  it("trims and collapses whitespace", () => {
    expect(deriveProjectName("  做一个\n待办  ")).toBe("做一个 待办");
  });
  it("truncates to 32 chars with ellipsis", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多余";
    const name = deriveProjectName(long);
    expect(name.endsWith("…")).toBe(true);
    expect([...name.replace(/…$/, "")].length).toBe(32);
  });
  it("falls back for empty", () => {
    expect(deriveProjectName("   ")).toBe("未命名项目");
  });
});
```

```ts
// packages/workspace/src/domain/paths.test.ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceRelativePath } from "./paths.js";

describe("resolveWorkspaceRelativePath", () => {
  const root = path.join("/tmp", "ws-root");
  it("resolves a safe relative path", () => {
    expect(resolveWorkspaceRelativePath(root, "src/App.tsx")).toBe(
      path.join(root, "src/App.tsx"),
    );
  });
  it("rejects escape", () => {
    expect(() => resolveWorkspaceRelativePath(root, "../secret")).toThrow(
      /Invalid path/,
    );
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `pnpm --filter @isotope/workspace test`  
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

```ts
// packages/workspace/src/domain/types.ts
export type ProjectMode = "engineer" | "team";

export type Project = {
  id: string;
  name: string;
  mode: ProjectMode;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  agentName?: string;
};
```

```ts
// packages/workspace/src/domain/project-name.ts
const MAX = 32;

export function deriveProjectName(requirement: string): string {
  const collapsed = requirement.trim().replace(/\s+/g, " ");
  if (!collapsed) return "未命名项目";
  const chars = [...collapsed];
  if (chars.length <= MAX) return collapsed;
  return chars.slice(0, MAX).join("") + "…";
}
```

```ts
// packages/workspace/src/domain/paths.ts
import path from "node:path";

export function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid path");
  }
  return resolved;
}
```

更新 `packages/workspace/src/index.ts` 导出上述类型与函数。

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @isotope/workspace test`  
Expected: PASS

- [ ] **Step 6: Commit**（若用户未要求则跳过）

---

### Task 3: workspace SQLite + 项目 CRUD + 模板复制

**Files:**
- Modify: `packages/workspace/package.json`（加 `better-sqlite3`、`@types/better-sqlite3`）
- Create: `packages/workspace/src/infra/db.ts`
- Create: `packages/workspace/src/infra/fs-store.ts`
- Create: `packages/workspace/src/app/workspace-store.ts`
- Create: `packages/workspace/src/app/workspace-store.test.ts`
- Modify: `packages/workspace/src/index.ts`

**Interfaces:**
- Consumes: `deriveProjectName` 不在本层调用（application 调）；本层 `createProject` 接收已算好的 `name`
- Produces:
  - `type WorkspaceStore` 含：
    - `createProject(input: { ownerUserId: string; name: string; mode: ProjectMode }): Project`
    - `listProjects(ownerUserId: string): Project[]`
    - `getProject(id: string): Project | null`
    - `updateProjectMeta(id: string, patch: { updatedAt?: string; name?: string; mode?: ProjectMode }): void`
    - `appendMessage(input: { projectId: string; role: MessageRole; content: string; agentName?: string }): Message`
    - `listMessages(projectId: string): Message[]`
    - `readFile(projectId: string, relativePath: string): string`
    - `writeFile(projectId: string, relativePath: string, content: string): void`
    - `listFiles(projectId: string, relativeDir?: string): string[]`
  - `createFsSqliteWorkspace(opts: { dataRoot: string; templatePath: string }): WorkspaceStore`

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @isotope/workspace add better-sqlite3 && pnpm --filter @isotope/workspace add -D @types/better-sqlite3`  
Expected: package.json 更新成功。

- [ ] **Step 2: 写失败集成测试（临时目录）**

```ts
// packages/workspace/src/app/workspace-store.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "./workspace-store.js";

const repoTemplate = path.resolve(
  import.meta.dirname,
  "../../../../templates/vite-react",
);

describe("createFsSqliteWorkspace", () => {
  let dataRoot: string;
  let store: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-ws-"));
    store = createFsSqliteWorkspace({
      dataRoot,
      templatePath: repoTemplate,
    });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("creates project, copies template, lists by owner only", () => {
    const a = store.createProject({
      ownerUserId: "demo",
      name: "待办",
      mode: "engineer",
    });
    store.createProject({
      ownerUserId: "reviewer",
      name: "别人的",
      mode: "team",
    });

    expect(a.id.startsWith("proj_")).toBe(true);
    expect(
      fs.existsSync(path.join(dataRoot, "projects", a.id, "workspace", "package.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dataRoot, "projects", a.id, "build")),
    ).toBe(true);

    const listed = store.listProjects("demo");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(a.id);
    expect(store.listProjects("reviewer")).toHaveLength(1);
    expect(store.getProject(a.id)?.ownerUserId).toBe("demo");
  });

  it("appends and lists messages; updates updatedAt", async () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const before = store.getProject(p.id)!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const m = store.appendMessage({
      projectId: p.id,
      role: "user",
      content: "hello",
    });
    expect(m.id).toBeTruthy();
    expect(store.listMessages(p.id)).toHaveLength(1);
    expect(store.getProject(p.id)!.updatedAt >= before).toBe(true);
  });

  it("reads/writes files and rejects escape", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    store.writeFile(p.id, "src/note.txt", "hi");
    expect(store.readFile(p.id, "src/note.txt")).toBe("hi");
    expect(store.listFiles(p.id, "src")).toContain("src/note.txt");
    expect(() => store.readFile(p.id, "../secret")).toThrow(/Invalid path/);
  });
});
```

注意：若 `import.meta.dirname` 在环境不可用，改用 `path.dirname(fileURLToPath(import.meta.url))`。

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm --filter @isotope/workspace test`  
Expected: FAIL（`createFsSqliteWorkspace` 未定义）

- [ ] **Step 4: 实现 db + fs + store**

`packages/workspace/src/infra/db.ts`：打开 `{dataRoot}/isotope.sqlite`，执行：

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
  ON projects(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  agent_name TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_project_created
  ON messages(project_id, created_at ASC);
```

`packages/workspace/src/infra/fs-store.ts`：

- `copyTemplate(templatePath, projectWorkspaceDir)` → `fs.cpSync(..., { recursive: true })`
- `ensureBuildDir(projectBuildDir)` → `fs.mkdirSync(..., { recursive: true })`
- 文件 read/write/list 使用 `resolveWorkspaceRelativePath`

`packages/workspace/src/app/workspace-store.ts`：

- id：`proj_` + `crypto.randomUUID().replaceAll("-", "").slice(0, 16)`
- message id：`msg_` + 同上
- 时间：`new Date().toISOString()`
- `listProjects`：`WHERE owner_user_id = ? ORDER BY updated_at DESC`（**禁止** `readdir` 列项目）
- `appendMessage`：INSERT message + `UPDATE projects SET updated_at = ?`

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @isotope/workspace test`  
Expected: 全部 PASS

- [ ] **Step 6: 导出并 typecheck**

`index.ts` 导出 `createFsSqliteWorkspace`、`WorkspaceStore` 类型及相关 domain 类型。

Run: `pnpm --filter @isotope/workspace typecheck`  
Expected: 无错误

- [ ] **Step 7: Commit**（若用户未要求则跳过）

---

### Task 4: application 五用例

**Files:**
- Modify: `packages/application/package.json`（依赖 `@isotope/workspace`；加 vitest）
- Create: `packages/application/src/projects/placeholder.ts`
- Create: `packages/application/src/projects/create-project.ts`
- Create: `packages/application/src/projects/list-projects.ts`
- Create: `packages/application/src/projects/get-project.ts`
- Create: `packages/application/src/projects/list-messages.ts`
- Create: `packages/application/src/projects/append-message.ts`
- Create: `packages/application/src/projects/projects.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `WorkspaceStore`、`deriveProjectName`、`ProjectMode`
- Produces:
  - `ASSISTANT_PLACEHOLDER = "已收到你的需求。预览与智能体编排将在下一步接入；当前仅持久化对话。"`
  - `createProject({ ownerUserId, requirement, mode }, workspace) → { project, messages }`
  - `listProjects({ ownerUserId }, workspace) → Project[]`
  - `getProject({ ownerUserId, projectId }, workspace) → Project | null`
  - `listMessages({ ownerUserId, projectId }, workspace) → Message[] | null`（无权限/不存在 → `null`）
  - `appendMessage({ ownerUserId, projectId, content }, workspace) → { messages: [user, assistant] } | null`

- [ ] **Step 1: 加依赖与 test script**

Run: `pnpm --filter @isotope/application add @isotope/workspace`  
`package.json` 增加 `"test": "vitest run"` 与 `vitest` devDependency（与 identity 同法）。

- [ ] **Step 2: 写失败测试**

```ts
// packages/application/src/projects/projects.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { appendMessage } from "./append-message.js";
import { createProject } from "./create-project.js";
import { getProject } from "./get-project.js";
import { listMessages } from "./list-messages.js";
import { listProjects } from "./list-projects.js";
import { ASSISTANT_PLACEHOLDER } from "./placeholder.js";

const templatePath = path.resolve(
  import.meta.dirname,
  "../../../../templates/vite-react",
);

describe("project use cases", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("createProject seeds user + assistant messages", () => {
    const { project, messages } = createProject(
      {
        ownerUserId: "demo",
        requirement: "做一个待办清单",
        mode: "engineer",
      },
      workspace,
    );
    expect(project.name).toContain("待办");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.content).toBe(ASSISTANT_PLACEHOLDER);
    expect(messages[1]?.agentName).toBe("Alex");
    expect(listProjects({ ownerUserId: "demo" }, workspace)).toHaveLength(1);
  });

  it("hides other users projects", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "team" },
      workspace,
    );
    expect(getProject({ ownerUserId: "reviewer", projectId: project.id }, workspace)).toBeNull();
    expect(listMessages({ ownerUserId: "reviewer", projectId: project.id }, workspace)).toBeNull();
    expect(
      appendMessage(
        { ownerUserId: "reviewer", projectId: project.id, content: "hi" },
        workspace,
      ),
    ).toBeNull();
  });

  it("appendMessage adds user + placeholder assistant", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const result = appendMessage(
      { ownerUserId: "demo", projectId: project.id, content: "继续" },
      workspace,
    );
    expect(result?.messages).toHaveLength(2);
    const all = listMessages({ ownerUserId: "demo", projectId: project.id }, workspace);
    expect(all?.length).toBe(4);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @isotope/application test`  
Expected: FAIL

- [ ] **Step 4: 实现用例**

`placeholder.ts`：导出 `ASSISTANT_PLACEHOLDER` 常量。

`create-project.ts`：校验 `requirement.trim()` 非空、`mode` ∈ `{engineer,team}`，否则 throw 带中文消息的 Error（web 层转 400）。调用 `deriveProjectName` → `workspace.createProject` → 两条 `appendMessage`。

`get-project.ts`：`const p = workspace.getProject(id); if (!p || p.ownerUserId !== ownerUserId) return null`。

`list-messages.ts` / `append-message.ts`：先 `getProject` 用例逻辑；失败 null；成功则 list / append user + assistant（`agentName: "Alex"`）。

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @isotope/application test`  
Expected: PASS

- [ ] **Step 6: 更新 `index.ts` 导出五用例 + 常量；typecheck**

Run: `pnpm --filter @isotope/application typecheck`  
Expected: 无错误

- [ ] **Step 7: Commit**（若用户未要求则跳过）

---

### Task 5: web 装配 + Projects API

**Files:**
- Modify: `apps/web/package.json`（若需传递 native 依赖：依赖会经 application→workspace 解析；确保 workspace 已装 better-sqlite3）
- Modify: `apps/web/lib/paths.ts`
- Create: `apps/web/lib/workspace.ts`
- Create: `apps/web/app/api/projects/route.ts`
- Create: `apps/web/app/api/projects/[id]/route.ts`
- Create: `apps/web/app/api/projects/[id]/messages/route.ts`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `readSession`、`createFsSqliteWorkspace`、application 五用例
- Produces: REST 行为符合 spec §8.1

- [ ] **Step 1: 扩展 paths + workspace 单例**

```ts
// apps/web/lib/paths.ts 追加
export function dataRoot(): string {
  return path.join(monorepoRoot(), "data");
}

export function templatePath(): string {
  return path.join(monorepoRoot(), "templates/vite-react");
}
```

```ts
// apps/web/lib/workspace.ts
import { createFsSqliteWorkspace, type WorkspaceStore } from "@isotope/workspace";
import { dataRoot, templatePath } from "./paths";

let store: WorkspaceStore | null = null;

export function getWorkspace(): WorkspaceStore {
  if (!store) {
    store = createFsSqliteWorkspace({
      dataRoot: dataRoot(),
      templatePath: templatePath(),
    });
  }
  return store;
}
```

- [ ] **Step 2: next.config**

```ts
const nextConfig: NextConfig = {
  transpilePackages: [
    "@isotope/application",
    "@isotope/identity",
    "@isotope/kernel",
    "@isotope/workspace",
  ],
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
```

- [ ] **Step 3: 实现 API routes**

`GET/POST /api/projects`：

- 无 session → 401 `{ error: "未登录" }`
- GET → `listProjects` → 200 `{ projects }`
- POST body `{ requirement, mode }` → try `createProject`；空/非法 → 400；成功 201 `{ project }`（可不返回 messages，工作台会再拉）

`GET /api/projects/[id]`：

- 401 / `getProject` null → 404 `{ error: "项目不存在" }` / 200 `{ project }`

`GET/POST .../messages`：

- GET：`listMessages` null → 404；否则 `{ messages }`
- POST：`{ content }` 空 → 400；`appendMessage` null → 404；否则 201 `{ messages }`（新增两条）

校验 mode：

```ts
function parseMode(v: unknown): "engineer" | "team" | null {
  return v === "engineer" || v === "team" ? v : null;
}
```

- [ ] **Step 4: 手动冒烟（可选）**

用已登录 cookie 调 API 较麻烦；本任务以 typecheck 为主：

Run: `pnpm --filter @isotope/web typecheck`  
Expected: 无错误（若 better-sqlite3 类型报错，确认 `@types/better-sqlite3` 在 workspace 且 skipLibCheck）

- [ ] **Step 5: Commit**（若用户未要求则跳过）

---

### Task 6: 首页接线

**Files:**
- Modify: `apps/web/app/(app)/page.tsx`
- Modify: `apps/web/components/home-shell.tsx`

**Interfaces:**
- Consumes: `readSession`、`listProjects`、`getWorkspace`、`POST /api/projects`
- Produces: 真实创建跳转；真实项目列表

- [ ] **Step 1: page.tsx 注入列表**

```tsx
import { listProjects } from "@isotope/application";
import { HomeShell } from "@/components/home-shell";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export default async function Home() {
  const session = await readSession();
  // layout 已保证登录；仍收窄类型
  const projects = session
    ? listProjects({ ownerUserId: session.username }, getWorkspace())
    : [];
  return <HomeShell initialProjects={projects} />;
}
```

- [ ] **Step 2: 更新 HomeShell**

Props：`initialProjects: { id: string; name: string; mode: string; updatedAt: string }[]`

- `handleStart`：`POST /api/projects` JSON `{ requirement, mode }`；ok → `router.push(`/projects/${project.id}`)`；失败设 `error` 文案
- 列表：有数据时渲染可点击链接（`Link` 到 `/projects/[id]`），展示 name、mode Badge、更新时间；无数据保留 EmptyState；去掉「即将接入」与 mock demo
- 提交中保持 Composer `submitting`

示例列表项结构（样式用现有 token class）：

```tsx
<ul className="divide-y divide-border rounded-lg border border-border">
  {initialProjects.map((p) => (
    <li key={p.id}>
      <Link href={`/projects/${p.id}`} className="flex ...">
        <span>{p.name}</span>
        <Badge variant="secondary">{p.mode}</Badge>
      </Link>
    </li>
  ))}
</ul>
```

（若尚无 Badge 用法，可用 `StatusBadge` 或小字 `text-muted-foreground` 显示 mode。）

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**（若用户未要求则跳过）

---

### Task 7: 工作台接线

**Files:**
- Modify: `apps/web/app/(app)/projects/[id]/page.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: `getProject`、`listMessages`、`POST .../messages`
- Produces: 持久化对话 UI；非 owner → `notFound()`

- [ ] **Step 1: 服务端加载**

```tsx
import { notFound } from "next/navigation";
import { getProject, listMessages } from "@isotope/application";
import { WorkbenchShell } from "@/components/workbench-shell";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await readSession();
  if (!session) notFound();
  const workspace = getWorkspace();
  const project = getProject(
    { ownerUserId: session.username, projectId: id },
    workspace,
  );
  if (!project) notFound();
  const messages =
    listMessages(
      { ownerUserId: session.username, projectId: id },
      workspace,
    ) ?? [];
  return <WorkbenchShell project={project} initialMessages={messages} />;
}
```

- [ ] **Step 2: WorkbenchShell 客户端**

Props：`project`、`initialMessages`。

- 顶栏：`project.name` + 只读 mode 文案
- 消息区：map 渲染；user 右/弱区分；assistant 显示 `Alex`（或 `agentName`）
- `handleSend`：`POST /api/projects/${project.id}/messages`；成功把返回的两条 append 到 state；清空 draft
- 空消息时 EmptyState；有消息则列表
- App Viewer：`EmptyState` title「预览区」，description「下一步接入 preview / 自动构建」

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**（若用户未要求则跳过）

---

### Task 8: 端到端验收

**Files:** 无新文件（必要时修 bug）

- [ ] **Step 1: 安装与类型检查**

Run:

```bash
pnpm install
pnpm --filter @isotope/workspace test
pnpm --filter @isotope/application test
pnpm --filter @isotope/web typecheck
```

Expected: 全部通过。

- [ ] **Step 2: 手动验收清单**

1. `pnpm dev`，用 `demo`/`demo` 登录  
2. 选 Engineer，输入需求，点「开始」→ 进入真实 `/projects/proj_...`  
3. 可见初始 user + Alex 占位回复  
4. 再发一条消息 → 刷新后四条仍在  
5. 回首页「我的项目」可见  
6. 登出 → 打项目 URL → 登录页  
7. 用 `reviewer` 登录 → 列表空；粘贴 demo 的项目 URL → notFound/404  
8. 确认未接 LLM / preview iframe 刷新  

- [ ] **Step 3: 对照 spec 扫一遍非目标** — 确认无越界实现  

- [ ] **Step 4: Commit**（若用户未要求则跳过；用户要求时可一次性提交）

---

## Spec Coverage Self-Review

| Spec 要求 | Task |
|-----------|------|
| 最小 vite-react 模板复制 | T1 + T3 |
| SQLite projects/messages，按 owner 查，不扫目录 | T3 |
| 命名启发式 32 + 占位 assistant Alex | T2 + T4 |
| 文件端口 read/write/list + 防逃逸 | T3 |
| application 五用例 + 归属 | T4 |
| Web API + 401/400/404 | T5 |
| 首页创建/列表 RSC | T6 |
| 工作台消息 + notFound | T7 |
| typecheck + 手动隔离验收 | T8 |
| gitignore sqlite | T1 |
| 无 LLM/preview/Team/版本 | Global + T8 |

**Placeholder scan:** 无 TBD；测试与实现代码已给出。  
**Type consistency:** `WorkspaceStore` / `createFsSqliteWorkspace` / 用例签名在 T3–T7 一致。
