# Workspace Readonly Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台右栏可在「应用查看器 | 编辑器」间切换；编辑器内嵌只读文件树 + 只读源码查看。

**Architecture:** `application` 提供带归属校验与噪音过滤的 `listWorkspaceSourceFiles` / `readWorkspaceSourceFile`；BFF 暴露 `GET .../files` 与 `GET .../files/[...path]`；`apps/web` 用 Tabs 切换视图，编辑器为左树右内容，偏好存 localStorage。

**Tech Stack:** TypeScript, vitest, Next.js App Router, shadcn Tabs, `@isotope/workspace` / `@isotope/application`

**Spec:** `docs/superpowers/specs/2026-07-18-workspace-readonly-editor-design.md`

## Global Constraints

- 用户可见文案：简体中文
- 文件 I/O 必须经 `@isotope/workspace`；API / UI 不直接扫 `data/**`
- 噪音过滤只在 application UI 用例；不改 `workspace.listFiles` 全量语义
- 只读；无保存 / 新建 / 删除 / 重命名 / 多 Tab / 语法高亮 / 搜索
- 顶栏仅「应用查看器 | 编辑器」（无独立「文件」Tab）
- Neutral Tool + 现有 shadcn；禁止 Demo/Landing/紫粉渐变/自写皮肤/第三方树或编辑器库
- 不新建 `ViewerChrome`；沿用 `PanelHeader` + `Tabs`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/application/src/projects/workspace-source-noise.ts` | 噪音路段常量 + `isNoisyWorkspacePath` |
| `packages/application/src/projects/list-workspace-source-files.ts` | list 用例 |
| `packages/application/src/projects/read-workspace-source-file.ts` | read 用例 + 判别结果类型 |
| `packages/application/src/projects/workspace-source-files.test.ts` | 上述用例单测 |
| `packages/application/src/index.ts` | 导出新用例与类型 |
| `apps/web/app/api/projects/[id]/files/route.ts` | GET 文件列表 |
| `apps/web/app/api/projects/[id]/files/[...path]/route.ts` | GET 文件内容 |
| `apps/web/lib/build-file-tree.ts` | 扁平路径 → 嵌套树纯函数 |
| `apps/web/components/workspace-file-tree.tsx` | 可折叠只读树 UI |
| `apps/web/components/workspace-editor-pane.tsx` | 左树 + 右内容 + 空态 + fetch |
| `apps/web/components/workbench-shell.tsx` | 右栏 Tabs + localStorage 视图模式 |
| `docs/ui/page-blueprints.md` / `docs/ui/ai-surfaces.md` | 可选一句补丁（Task 5） |

---

### Task 1: application 噪音过滤 + list 用例

**Files:**
- Create: `packages/application/src/projects/workspace-source-noise.ts`
- Create: `packages/application/src/projects/list-workspace-source-files.ts`
- Create: `packages/application/src/projects/workspace-source-files.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  - `NOISY_WORKSPACE_SEGMENTS: readonly string[]` = `["node_modules", ".git", "dist", "build", ".next", "coverage"]`
  - `isNoisyWorkspacePath(relativePath: string): boolean` — 任一路段命中即 true
  - `listWorkspaceSourceFiles(input: { ownerUserId: string; projectId: string }, workspace: WorkspaceStore): string[] | null`

- [ ] **Step 1: Write failing tests**

在 `workspace-source-files.test.ts` 使用与 `projects.test.ts` 相同的 tmp + `createFsSqliteWorkspace` + `templates/vite-react` 脚手架：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { listWorkspaceSourceFiles } from "./list-workspace-source-files.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("workspace source files", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-src-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("isNoisyWorkspacePath matches path segments", () => {
    expect(isNoisyWorkspacePath("node_modules/pkg/index.js")).toBe(true);
    expect(isNoisyWorkspacePath("src/.next/cache")).toBe(true);
    expect(isNoisyWorkspacePath("src/App.tsx")).toBe(false);
    expect(isNoisyWorkspacePath(".env.example")).toBe(false);
  });

  it("listWorkspaceSourceFiles returns null for non-owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      listWorkspaceSourceFiles(
        { ownerUserId: "reviewer", projectId: project.id },
        workspace,
      ),
    ).toBeNull();
  });

  it("listWorkspaceSourceFiles includes template sources and excludes noise", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.writeFile(project.id, "node_modules/pkg/index.js", "x");
    workspace.writeFile(project.id, "dist/out.js", "x");
    const files = listWorkspaceSourceFiles(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
    );
    expect(files).toContain("src/App.tsx");
    expect(files?.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files?.some((f) => f.startsWith("dist/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @isotope/application test -- workspace-source-files.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement noise helper + list**

`workspace-source-noise.ts`:

```ts
export const NOISY_WORKSPACE_SEGMENTS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
] as const;

export function isNoisyWorkspacePath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .some((segment) =>
      (NOISY_WORKSPACE_SEGMENTS as readonly string[]).includes(segment),
    );
}
```

`list-workspace-source-files.ts`:

```ts
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

export function listWorkspaceSourceFiles(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): string[] | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return workspace
    .listFiles(input.projectId)
    .filter((p) => !isNoisyWorkspacePath(p))
    .sort();
}
```

导出：在 `index.ts` 增加  
`export { listWorkspaceSourceFiles } from "./projects/list-workspace-source-files.js";`  
`export { isNoisyWorkspacePath, NOISY_WORKSPACE_SEGMENTS } from "./projects/workspace-source-noise.js";`

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @isotope/application test -- workspace-source-files.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/projects/workspace-source-noise.ts \
  packages/application/src/projects/list-workspace-source-files.ts \
  packages/application/src/projects/workspace-source-files.test.ts \
  packages/application/src/index.ts
git commit -m "$(cat <<'EOF'
feat(application): list filtered workspace source files

EOF
)"
```

---

### Task 2: application read 用例

**Files:**
- Create: `packages/application/src/projects/read-workspace-source-file.ts`
- Modify: `packages/application/src/projects/workspace-source-files.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  - `WorkspaceSourceFileReadResult =`
    - `{ ok: true; path: string; content: string }`
    - `| { ok: false; code: "invalid_path" | "not_found" | "not_text" | "too_large"; message: string }`
  - `readWorkspaceSourceFile(input: { ownerUserId: string; projectId: string; relativePath: string }, workspace: WorkspaceStore): WorkspaceSourceFileReadResult | null`
  - 常量：`MAX_WORKSPACE_SOURCE_BYTES = 512 * 1024`

- [ ] **Step 1: Write failing tests**（追加到同一 test 文件）

```ts
import { readWorkspaceSourceFile } from "./read-workspace-source-file.js";

it("readWorkspaceSourceFile returns null for non-owner", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  expect(
    readWorkspaceSourceFile(
      { ownerUserId: "reviewer", projectId: project.id, relativePath: "src/App.tsx" },
      workspace,
    ),
  ).toBeNull();
});

it("readWorkspaceSourceFile returns content for owner", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  const result = readWorkspaceSourceFile(
    { ownerUserId: "demo", projectId: project.id, relativePath: "src/App.tsx" },
    workspace,
  );
  expect(result?.ok).toBe(true);
  if (result?.ok) {
    expect(result.path).toBe("src/App.tsx");
    expect(result.content).toContain("App");
  }
});

it("readWorkspaceSourceFile rejects noisy and traversal paths", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  workspace.writeFile(project.id, "node_modules/pkg/index.js", "secret");
  const noisy = readWorkspaceSourceFile(
    {
      ownerUserId: "demo",
      projectId: project.id,
      relativePath: "node_modules/pkg/index.js",
    },
    workspace,
  );
  expect(noisy).toEqual({
    ok: false,
    code: "invalid_path",
    message: "无法访问该路径",
  });
  const traversal = readWorkspaceSourceFile(
    { ownerUserId: "demo", projectId: project.id, relativePath: "../secret" },
    workspace,
  );
  expect(traversal?.ok).toBe(false);
  if (traversal && !traversal.ok) {
    expect(traversal.code).toBe("invalid_path");
  }
});

it("readWorkspaceSourceFile returns not_found for missing file", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  const result = readWorkspaceSourceFile(
    { ownerUserId: "demo", projectId: project.id, relativePath: "src/missing.ts" },
    workspace,
  );
  expect(result).toEqual({
    ok: false,
    code: "not_found",
    message: "文件不存在",
  });
});

it("readWorkspaceSourceFile rejects binary content", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  workspace.writeFile(project.id, "src/bin.dat", "a\0b");
  const result = readWorkspaceSourceFile(
    { ownerUserId: "demo", projectId: project.id, relativePath: "src/bin.dat" },
    workspace,
  );
  expect(result).toEqual({
    ok: false,
    code: "not_text",
    message: "暂不支持预览此文件",
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @isotope/application test -- workspace-source-files.test.ts`  
Expected: FAIL（`readWorkspaceSourceFile` 未定义）

- [ ] **Step 3: Implement read**

```ts
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";
import { isNoisyWorkspacePath } from "./workspace-source-noise.js";

export const MAX_WORKSPACE_SOURCE_BYTES = 512 * 1024;

export type WorkspaceSourceFileReadResult =
  | { ok: true; path: string; content: string }
  | {
      ok: false;
      code: "invalid_path" | "not_found" | "not_text" | "too_large";
      message: string;
    };

export function readWorkspaceSourceFile(
  input: {
    ownerUserId: string;
    projectId: string;
    relativePath: string;
  },
  workspace: WorkspaceStore,
): WorkspaceSourceFileReadResult | null {
  if (!getProject(input, workspace)) {
    return null;
  }

  const relativePath = input.relativePath.replace(/^\/+/, "");
  if (!relativePath || isNoisyWorkspacePath(relativePath)) {
    return { ok: false, code: "invalid_path", message: "无法访问该路径" };
  }

  let content: string;
  try {
    content = workspace.readFile(input.projectId, relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Invalid path/i.test(message)) {
      return { ok: false, code: "invalid_path", message: "无法访问该路径" };
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return { ok: false, code: "not_found", message: "文件不存在" };
    }
    if (/ENOENT|no such file/i.test(message)) {
      return { ok: false, code: "not_found", message: "文件不存在" };
    }
    return { ok: false, code: "invalid_path", message: "无法访问该路径" };
  }

  if (content.includes("\0")) {
    return {
      ok: false,
      code: "not_text",
      message: "暂不支持预览此文件",
    };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_SOURCE_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "文件过大，暂不支持预览",
    };
  }

  return { ok: true, path: relativePath, content };
}
```

导出 `readWorkspaceSourceFile` 与 `WorkspaceSourceFileReadResult`。

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @isotope/application test -- workspace-source-files.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/projects/read-workspace-source-file.ts \
  packages/application/src/projects/workspace-source-files.test.ts \
  packages/application/src/index.ts
git commit -m "$(cat <<'EOF'
feat(application): read workspace source files with guards

EOF
)"
```

---

### Task 3: BFF API routes

**Files:**
- Create: `apps/web/app/api/projects/[id]/files/route.ts`
- Create: `apps/web/app/api/projects/[id]/files/[...path]/route.ts`

**Interfaces:**
- Consumes: `listWorkspaceSourceFiles`, `readWorkspaceSourceFile`
- Produces:
  - `GET /api/projects/:id/files` → `{ files: string[] }` | 401 | 404
  - `GET /api/projects/:id/files/*` → `{ path, content }` | 401 | 404 | 400 `{ error: message }`

- [ ] **Step 1: Implement list route**

`apps/web/app/api/projects/[id]/files/route.ts`（对齐 `messages/route.ts` 模式）：

```ts
import { listWorkspaceSourceFiles } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await context.params;
  const files = listWorkspaceSourceFiles(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!files) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ files });
}
```

- [ ] **Step 2: Implement read route**

`apps/web/app/api/projects/[id]/files/[...path]/route.ts`:

```ts
import { readWorkspaceSourceFile } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id, path: segments = [] } = await context.params;
  if (!segments.length) {
    return NextResponse.json({ error: "缺少文件路径" }, { status: 400 });
  }
  const relativePath = segments.join("/");
  const result = readWorkspaceSourceFile(
    {
      ownerUserId: session.username,
      projectId: id,
      relativePath,
    },
    getWorkspace(),
  );
  if (!result) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json({ path: result.path, content: result.content });
}
```

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/projects/\[id\]/files
git commit -m "$(cat <<'EOF'
feat(web): add workspace source file API routes

EOF
)"
```

---

### Task 4: 文件树纯函数 + Editor UI 组件

**Files:**
- Create: `apps/web/lib/build-file-tree.ts`
- Create: `apps/web/components/workspace-file-tree.tsx`
- Create: `apps/web/components/workspace-editor-pane.tsx`

**Interfaces:**
- Produces:
  - `FileTreeNode = { name: string; path: string; kind: "file" | "dir"; children?: FileTreeNode[] }`
  - `buildFileTree(paths: string[]): FileTreeNode[]`
  - `WorkspaceFileTree({ files, selectedPath, onSelectFile })`
  - `WorkspaceEditorPane({ projectId })` — 自管 fetch list/content、展开态、空态、写 `openFile` localStorage

- [ ] **Step 1: Implement `buildFileTree`**

```ts
export type FileTreeNode = {
  name: string;
  path: string; // dir: "src" / "src/components"；file: full relative path
  kind: "file" | "dir";
  children?: FileTreeNode[];
};

export function buildFileTree(paths: string[]): FileTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    kind: "file" | "dir";
    children?: Map<string, Mutable>;
  };
  const root = new Map<string, Mutable>();

  for (const filePath of [...paths].sort()) {
    const parts = filePath.split("/").filter(Boolean);
    let level = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      let node = level.get(name);
      if (!node) {
        node = {
          name,
          path: prefix,
          kind: isFile ? "file" : "dir",
          children: isFile ? undefined : new Map(),
        };
        level.set(name, node);
      }
      if (!isFile) {
        node.kind = "dir";
        node.children ??= new Map();
        level = node.children;
      }
    }
  }

  const toArray = (map: Map<string, Mutable>): FileTreeNode[] =>
    [...map.values()]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({
        name: n.name,
        path: n.path,
        kind: n.kind,
        children: n.children ? toArray(n.children) : undefined,
      }));

  return toArray(root);
}

/** 返回应默认展开的目录 path 集合：根下一层 + openFile 的祖先 */
export function defaultExpandedDirs(
  files: string[],
  openFilePath: string | null,
): Set<string> {
  const expanded = new Set<string>();
  for (const f of files) {
    const i = f.indexOf("/");
    if (i > 0) expanded.add(f.slice(0, i));
  }
  if (openFilePath) {
    const parts = openFilePath.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]!;
      expanded.add(prefix);
    }
  }
  return expanded;
}
```

- [ ] **Step 2: Implement `WorkspaceFileTree`**

要求：

- 使用 `ChevronRight` / `ChevronDown`（`lucide-react`，与 workbench 一致）
- 目录点击切换展开；文件点击调用 `onSelectFile(path)`
- `selectedPath` 高亮：`bg-muted` 或等价 token，勿用彩色皮肤
- 缩进：`pl-2` × depth
- `aria-expanded` 在目录按钮上

骨架：

```tsx
"use client";

import { ChevronDown, ChevronRight, FileIcon, FolderIcon } from "lucide-react";
import type { FileTreeNode } from "@/lib/build-file-tree";
import { cn } from "@/lib/utils";

export function WorkspaceFileTree({
  nodes,
  selectedPath,
  expanded,
  onToggleDir,
  onSelectFile,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  // map nodes → button rows; recurse into children when dir expanded
}
```

- [ ] **Step 3: Implement `WorkspaceEditorPane`**

行为：

1. mount / `projectId` 变 → `GET /api/projects/${id}/files` → `buildFileTree`
2. 读 `localStorage.getItem(\`isotope.workbench.openFile:${projectId}\`)`
3. 若路径在 `files` 中 → fetch content；否则清记忆并空态「选择左侧文件以查看」
4. `files.length === 0` → EmptyState「工作区暂无源码文件」
5. 选文件 → 写 localStorage → fetch → 成功展示路径条 + `<pre className="overflow-auto ... whitespace-pre-wrap font-mono text-xs">`
6. fetch 失败 → EmptyState 用 API `error` 文案
7. loading：树区 Skeleton 或简短「加载中…」

布局：

```tsx
<div className="flex min-h-0 flex-1">
  <aside className="w-[240px] shrink-0 overflow-auto border-r border-border">
    {/* tree or empty */}
  </aside>
  <div className="flex min-w-0 flex-1 flex-col">
    {/* path bar + content / EmptyState */}
  </div>
</div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/build-file-tree.ts \
  apps/web/components/workspace-file-tree.tsx \
  apps/web/components/workspace-editor-pane.tsx
git commit -m "$(cat <<'EOF'
feat(web): add read-only workspace editor pane and file tree

EOF
)"
```

---

### Task 5: 接入 workbench 右栏 Tabs + 偏好 + 文档一句

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`（右栏 `section` 约 903–962 行）
- Modify（可选一句）: `docs/ui/page-blueprints.md` Workspace 信息架构
- Modify（可选一句）: `docs/ui/ai-surfaces.md` 组合件清单旁注

**Interfaces:**
- Consumes: `WorkspaceEditorPane`, shadcn `Tabs` / `TabsList` / `TabsTrigger`
- localStorage: `isotope.workbench.viewerMode:{projectId}` = `preview` | `editor`

- [ ] **Step 1: 改造右栏 header + 内容**

将固定 `PanelHeader title="App Viewer"` 改为：

1. 顶栏一行：左侧 `Tabs`（`应用查看器` / `编辑器`），右侧仅 `preview` 模式显示 `StatusBadge` + 刷新按钮
2. `Tabs` 受控：`value={viewerMode}`，`onValueChange` 写 state + localStorage
3. mount 时按 `projectId` 读 localStorage；非法值回退 `preview`
4. `viewerMode === "preview"` → 现有 iframe / 空态逻辑不变
5. `viewerMode === "editor"` → `<WorkspaceEditorPane projectId={project.id} />`
6. 预览轮询 `useEffect` **不要**因切到 editor 而停止（保持现有依赖即可）

示意（嵌入现有 section，勿整文件重写）：

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceEditorPane } from "@/components/workspace-editor-pane";

const VIEWER_MODE_KEY = (id: string) => `isotope.workbench.viewerMode:${id}`;

type ViewerMode = "preview" | "editor";

// state
const [viewerMode, setViewerMode] = useState<ViewerMode>("preview");

useEffect(() => {
  try {
    const stored = localStorage.getItem(VIEWER_MODE_KEY(project.id));
    if (stored === "preview" || stored === "editor") {
      setViewerMode(stored);
    }
  } catch {
    // ignore
  }
}, [project.id]);

function persistViewerMode(next: ViewerMode) {
  setViewerMode(next);
  try {
    localStorage.setItem(VIEWER_MODE_KEY(project.id), next);
  } catch {
    // ignore
  }
}
```

顶栏结构示例：

```tsx
<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
  <Tabs
    value={viewerMode}
    onValueChange={(v) => {
      if (v === "preview" || v === "editor") persistViewerMode(v);
    }}
  >
    <TabsList className="h-8">
      <TabsTrigger value="preview" className="text-xs">
        应用查看器
      </TabsTrigger>
      <TabsTrigger value="editor" className="text-xs">
        编辑器
      </TabsTrigger>
    </TabsList>
  </Tabs>
  {viewerMode === "preview" ? (
    <div className="flex items-center gap-2">
      <StatusBadge status={preview?.status ?? "idle"} />
      {/* 现有刷新按钮条件不变 */}
    </div>
  ) : null}
</div>
```

内容区：`viewerMode === "editor" ? <WorkspaceEditorPane ... /> : /* 现有 preview 分支 */`

注意：现有 `TabsContent` 带 `mt-2`，本处用受控 value 直接条件渲染即可，不必包 `TabsContent`（避免多余间距）。

- [ ] **Step 2: 可选文档补丁**

`page-blueprints.md` Workspace「必须」表右栏一行改为：  
`右：视图切换（应用查看器 / 编辑器）+ 预览或只读编辑器`

`ai-surfaces.md` 在 App Viewer 节后加短节「编辑器（只读）」：左树右内容；无独立文件 Tab。

- [ ] **Step 3: Typecheck + application tests**

Run:

```bash
pnpm --filter @isotope/application test -- workspace-source-files.test.ts
pnpm --filter @isotope/application typecheck
pnpm --filter @isotope/web typecheck
```

Expected: 全部 PASS

- [ ] **Step 4: 手工验收清单**

1. 打开项目 → 默认应用查看器  
2. 切到编辑器 → 见文件树（含 `src/App.tsx`，无 `node_modules`）  
3. 点文件 → 右侧只读内容  
4. 刷新 → 仍在编辑器且同一文件  
5. 清掉 openFile 或打开不存在路径 → 明确空态  

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workbench-shell.tsx \
  docs/ui/page-blueprints.md \
  docs/ui/ai-surfaces.md
git commit -m "$(cat <<'EOF'
feat(web): switch workbench right pane between viewer and editor

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 顶栏应用查看器 \| 编辑器 | Task 5 |
| 编辑器 = 左树 + 右只读内容 | Task 4–5 |
| 噪音过滤 | Task 1–2 |
| localStorage 模式 + 打开路径 | Task 4–5 |
| 空态 | Task 4 |
| application 归属 + 判别结果 | Task 1–2 |
| API 不扫 data/** | Task 3 |
| 单测 + typecheck | Task 1–2、5 |
| 无独立文件 Tab / 无在线编辑 | Global + Task 5 |

## Self-review notes

- 无 TBD /「类似 Task N」占位
- `read` 错误码与 HTTP 映射在 Task 2/3 一致
- localStorage key 与 spec §7.4 一致
- web 无 vitest：树纯函数靠 typecheck + 手工；I/O 由 application 单测覆盖
