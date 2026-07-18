# App Shell + Project Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全局可收起侧栏（项目列表 + 左下用户/退出）+ 硬删除项目（Dialog 确认），首页主区只保留创建入口。

**Architecture:** `(app)/layout` 改为 `AppShell`（左 `AppSidebar` + 右 `{children}`），去掉 `AppHeader`。删除经 `workspace.deleteProject` → `application.deleteProject` → `DELETE /api/projects/[id]`。侧栏收起状态存 `localStorage`。

**Tech Stack:** 既有 Next.js 15 / React 19 / shadcn / Tailwind；补 shadcn Dialog；lucide-react 图标；vitest。

**Spec:** `docs/superpowers/specs/2026-07-18-app-shell-delete-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖：`web` → `application` → `workspace`；UI 不写归属/删库规则。
- 硬删除：messages → projects 行 → `fs.rmSync(data/projects/<id>, { recursive, force })`。
- 非 owner / 不存在：API 404；工作台删当前项目后 `router.push('/')`。
- Dialog 确认文案：`确定删除「{name}」？此操作不可恢复。`
- localStorage key：`isotope.sidebarCollapsed`（`"1"` / `"0"` 或 boolean JSON）。
- 遵守 `docs/UI_GUIDE.md`：Neutral Tool；禁止自写 CSS 皮肤。
- **未经用户要求不要 git commit**（忽略下文 commit 步骤）。
- 外科手术式：不重做 persistence 其它能力；不接 LLM/preview。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/workspace/src/app/workspace-store.ts` | 扩展 `deleteProject` |
| `packages/workspace/src/app/workspace-store.test.ts` | 删除单测 |
| `packages/application/src/projects/delete-project.ts` | 归属校验 + 删除 |
| `packages/application/src/projects/projects.test.ts` | 增删测例 |
| `packages/application/src/index.ts` | 导出 |
| `apps/web/app/api/projects/[id]/route.ts` | 加 `DELETE` |
| `apps/web/components/ui/dialog.tsx` | shadcn Dialog |
| `apps/web/components/app-sidebar.tsx` | 侧栏 UI |
| `apps/web/components/app-shell.tsx` | 壳：侧栏 + main |
| `apps/web/app/(app)/layout.tsx` | 注入 projects + username，渲染 AppShell |
| `apps/web/components/home-shell.tsx` | 去掉「我的项目」列表，只留创建区 |
| `apps/web/components/app-header.tsx` | 停止在 layout 使用（可保留文件暂不删，或删引用即可） |

---

### Task 1: workspace + application 删除

**Files:**
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/app/workspace-store.test.ts`
- Create: `packages/application/src/projects/delete-project.ts`
- Modify: `packages/application/src/projects/projects.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  - `WorkspaceStore.deleteProject(id: string): void`
  - `deleteProject({ ownerUserId, projectId }, workspace) → { ok: true } | null`

- [ ] **Step 1: 写失败测试（workspace）**

在 `workspace-store.test.ts` 追加：

```ts
it("deleteProject removes db rows and project directory", () => {
  const p = store.createProject({
    ownerUserId: "demo",
    name: "待删",
    mode: "engineer",
  });
  store.appendMessage({ projectId: p.id, role: "user", content: "hi" });
  const dir = path.join(dataRoot, "projects", p.id);
  expect(fs.existsSync(dir)).toBe(true);

  store.deleteProject(p.id);

  expect(store.getProject(p.id)).toBeNull();
  expect(store.listMessages(p.id)).toHaveLength(0);
  expect(store.listProjects("demo")).toHaveLength(0);
  expect(fs.existsSync(dir)).toBe(false);
});

it("deleteProject is safe for unknown id", () => {
  expect(() => store.deleteProject("proj_nonexistent")).not.toThrow();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @isotope/workspace test`  
Expected: FAIL（`deleteProject` 不存在）

- [ ] **Step 3: 实现 workspace.deleteProject**

扩展 `WorkspaceStore` 类型，实现：

```ts
deleteProject(id) {
  const projectDir = path.join(projectsRoot, id);
  // 防止逃逸：resolved 必须仍在 projectsRoot 下
  const resolved = path.resolve(projectDir);
  if (
    resolved !== path.resolve(projectsRoot) &&
    !resolved.startsWith(path.resolve(projectsRoot) + path.sep)
  ) {
    throw new Error("Invalid path");
  }
  const tx = database.transaction(() => {
    database.prepare("DELETE FROM messages WHERE project_id = ?").run(id);
    database.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
  fs.rmSync(resolved, { recursive: true, force: true });
},
```

（在文件顶 `import fs from "node:fs"`。）

- [ ] **Step 4: workspace tests PASS**

Run: `pnpm --filter @isotope/workspace test`  
Expected: PASS

- [ ] **Step 5: application 测试 + 实现**

`delete-project.ts`：

```ts
import type { WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function deleteProject(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): { ok: true } | null {
  const project = getProject(input, workspace);
  if (!project) return null;
  workspace.deleteProject(input.projectId);
  return { ok: true };
}
```

在 `projects.test.ts` 追加：

```ts
import { deleteProject } from "./delete-project.js";

it("deleteProject enforces ownership and removes project", () => {
  const { project } = createProject(
    { ownerUserId: "demo", requirement: "x", mode: "engineer" },
    workspace,
  );
  expect(
    deleteProject(
      { ownerUserId: "reviewer", projectId: project.id },
      workspace,
    ),
  ).toBeNull();
  expect(
    deleteProject({ ownerUserId: "demo", projectId: project.id }, workspace),
  ).toEqual({ ok: true });
  expect(
    getProject({ ownerUserId: "demo", projectId: project.id }, workspace),
  ).toBeNull();
});
```

导出 `deleteProject` from `packages/application/src/index.ts`。

- [ ] **Step 6: application tests PASS**

Run: `pnpm --filter @isotope/application test`  
Expected: PASS

- [ ] **Step 7: Commit**（若用户未要求则跳过）

---

### Task 2: DELETE API

**Files:**
- Modify: `apps/web/app/api/projects/[id]/route.ts`

**Interfaces:**
- Consumes: `deleteProject` from application、`readSession`、`getWorkspace`
- Produces: `DELETE` → 401 / 404 / 204

- [ ] **Step 1: 实现 DELETE handler**

```ts
import { deleteProject, getProject } from "@isotope/application";
// ... existing GET ...

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await context.params;
  const result = deleteProject(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!result) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 3: Commit**（若用户未要求则跳过）

---

### Task 3: shadcn Dialog + AppShell / AppSidebar

**Files:**
- Create: `apps/web/components/ui/dialog.tsx`（及所需 radix 依赖）
- Create: `apps/web/components/app-sidebar.tsx`
- Create: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`
- Modify: `apps/web/components/home-shell.tsx`

**Interfaces:**
- Consumes: `listProjects`、`readSession`、项目 `{ id, name, mode, updatedAt }[]`、`username`
- Produces: 全局壳；首页无重复项目列表

- [ ] **Step 1: 添加 Dialog**

在 `apps/web` 目录执行（网络许可下）：

```bash
pnpm --filter @isotope/web exec shadcn@latest add dialog --yes
```

若 CLI 不可用：按 shadcn default 风格手写 `dialog.tsx`，并  
`pnpm --filter @isotope/web add @radix-ui/react-dialog`。

- [ ] **Step 2: 实现 AppSidebar**

客户端组件，props：

```ts
type SidebarProject = { id: string; name: string; mode: string; updatedAt: string };

{
  username: string;
  projects: SidebarProject[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}
```

结构：
- 顶：`Link`「Isotope」+ 收起 `Button`（lucide `PanelLeftClose` / `PanelLeft`）
- 中：`projects.map` → `Link` 到 `/projects/[id]`；`usePathname()` 高亮；悬停显示垃圾箱按钮（`stopPropagation`）
- 删除：本地 `pendingDelete` state → Dialog；确认后 `DELETE /api/projects/${id}`；成功 `router.refresh()`；若 `pathname === /projects/${id}` 则 `router.push('/')`
- 底：`username` + 退出（复用现 `AppHeader` 的 logout fetch 逻辑）
- `collapsed === true`：窄宽（如 `w-14`），隐藏列表文字与用户名（可留展开按钮）

空列表：`text-xs text-muted-foreground`「暂无项目」。

- [ ] **Step 3: 实现 AppShell**

```tsx
"use client";
// read/write localStorage key isotope.sidebarCollapsed on mount + toggle
export function AppShell({
  username,
  projects,
  children,
}: {
  username: string;
  projects: SidebarProject[];
  children: React.ReactNode;
}) {
  // collapsed state + AppSidebar + <main className="flex-1 min-w-0">{children}</main>
}
```

外层：`flex h-screen`（或 `min-h-screen`）`bg-background`。

- [ ] **Step 4: 改 layout**

```tsx
import { listProjects } from "@isotope/application";
import { AppShell } from "@/components/app-shell";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect("/login");
  const projects = listProjects(
    { ownerUserId: session.username },
    getWorkspace(),
  ).map((p) => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    updatedAt: p.updatedAt,
  }));
  return (
    <AppShell username={session.username} projects={projects}>
      {children}
    </AppShell>
  );
}
```

**不再**渲染 `AppHeader`。

- [ ] **Step 5: 精简 HomeShell**

- 删除「我的项目」整段与 `initialProjects` prop（或保留 prop 但不渲染——推荐直接去掉 prop）
- `page.tsx` 不再传 projects（列表只在 layout/侧栏）
- 主区居中或左对齐的创建区即可（`max-w-3xl` 可保留）

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 7: Commit**（若用户未要求则跳过）

---

### Task 4: 验收

**Files:** 无（必要时修 bug）

- [ ] **Step 1: 自动化**

```bash
pnpm --filter @isotope/workspace test
pnpm --filter @isotope/application test
pnpm --filter @isotope/web typecheck
```

Expected: 全部通过。

- [ ] **Step 2: 手动清单**

1. `pnpm dev`，登录后见左栏项目 + 左下用户；可收起，刷新保持  
2. 首页右侧仅创建区；侧栏点项目进工作台  
3. 删除确认后列表与磁盘目录消失  
4. 在工作台删当前项目 → 回首页  
5. 换账号看不到他人项目；直链他人仍 404  

- [ ] **Step 3: Commit**（若用户未要求则跳过）

---

## Spec Coverage Self-Review

| Spec | Task |
|------|------|
| 全局可收起侧栏 + 左下用户 | T3 |
| 去掉顶栏、首页只创建 | T3 |
| deleteProject workspace/application | T1 |
| DELETE API 401/404/204 | T2 |
| Dialog 确认 + 删当前回首页 | T3 |
| typecheck + 手动验收 | T4 |

**Placeholder scan:** 无 TBD。  
**Type consistency:** `deleteProject` 签名在 T1–T3 一致。
