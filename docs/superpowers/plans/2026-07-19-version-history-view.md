# Version History View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台对话顶栏可打开「版本记录」Dialog；列表与 VersionCard 在「仅当前预览产物」规则下可切到 App Viewer。

**Architecture:** application 薄用例 `listProjectVersions`（归属校验 + 将 workspace ASC 反转为新→旧）→ `GET /api/projects/[id]/versions` → Dialog 列表；开预览为纯前端（`canOpenPreview` + 切 `viewerMode`），不改 preview 存储。

**Tech Stack:** TypeScript, vitest, Next.js App Router, shadcn Dialog, `@isotope/workspace` / `@isotope/application`

**Spec:** `docs/superpowers/specs/2026-07-19-version-history-view-design.md`

## Global Constraints

- 用户可见文案：简体中文
- 依赖向内：`web` → `application` → `workspace`；禁止 UI 直读 `data/**`
- 不做源码回滚 / 多产物归档；禁止用旧 `?r=` 伪装历史预览
- 外科手术：不重构 `workbench-shell` 大文件结构；Dialog / helper 抽小组件
- Neutral Tool + 现有 Dialog；列表不要营销卡 / 紫渐变 / 为列表重做 Sparkles
- `workspace.listVersions` 保持 `number ASC`；Dialog API 在 application 层反转为新→旧

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/application/src/projects/list-project-versions.ts` | 归属校验 + reverse 新→旧 |
| `packages/application/src/projects/list-project-versions.test.ts` | 用例测 |
| `packages/application/src/index.ts` | export |
| `apps/web/app/api/projects/[id]/versions/route.ts` | `GET` → `{ versions }` |
| `apps/web/lib/version-preview.ts` | `canOpenPreview` + `previewAvailabilityLabel` |
| `apps/web/lib/version-preview.test.ts` | helper 测 |
| `apps/web/lib/format-version-time.ts` | 相对 + 绝对时间文案 |
| `apps/web/lib/format-version-time.test.ts` | 时间格式测 |
| `apps/web/components/version-history-dialog.tsx` | Dialog UI + fetch |
| `apps/web/components/version-card.tsx` | 可选开预览 |
| `apps/web/components/workbench-shell.tsx` | 顶栏入口、传 preview、切 Tab |
| `docs/ui/ai-surfaces.md` | §3 Version 一句补充 |

---

### Task 1: `listProjectVersions` application 用例

**Files:**
- Create: `packages/application/src/projects/list-project-versions.ts`
- Create: `packages/application/src/projects/list-project-versions.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `getProject`, `WorkspaceStore.listVersions` / `recordVersion`
- Produces:
  ```ts
  listProjectVersions(
    input: { ownerUserId: string; projectId: string },
    workspace: WorkspaceStore,
  ): Version[] | null
  ```
  - 非 owner / 无项目 → `null`
  - 成功 → 新→旧（`number` 降序）

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { listProjectVersions } from "./list-project-versions.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

describe("listProjectVersions", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-list-ver-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("returns null for non-owner", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    expect(
      listProjectVersions(
        { ownerUserId: "other", projectId: project.id },
        workspace,
      ),
    ).toBeNull();
  });

  it("returns versions newest-first", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.recordVersion({
      projectId: project.id,
      summary: "一",
      previewRevision: "a",
    });
    workspace.recordVersion({
      projectId: project.id,
      summary: "二",
      previewRevision: "b",
    });
    const listed = listProjectVersions(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
    );
    expect(listed?.map((v) => v.number)).toEqual([2, 1]);
    expect(listed?.[0]?.summary).toBe("二");
    // store itself stays ASC
    expect(workspace.listVersions(project.id).map((v) => v.number)).toEqual([
      1, 2,
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @isotope/application test -- list-project-versions.test.ts`

Expected: FAIL（模块不存在或 `listProjectVersions` 未定义）

- [ ] **Step 3: Implement**

```ts
// packages/application/src/projects/list-project-versions.ts
import type { Version, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function listProjectVersions(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): Version[] | null {
  if (!getProject(input, workspace)) {
    return null;
  }
  return [...workspace.listVersions(input.projectId)].reverse();
}
```

在 `packages/application/src/index.ts` 增加：

```ts
export { listProjectVersions } from "./projects/list-project-versions.js";
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @isotope/application test -- list-project-versions.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/projects/list-project-versions.ts \
  packages/application/src/projects/list-project-versions.test.ts \
  packages/application/src/index.ts
git commit -m "$(cat <<'EOF'
feat(application): list project versions newest-first

EOF
)"
```

---

### Task 2: 前端 `canOpenPreview` + 时间格式 helper

**Files:**
- Create: `apps/web/lib/version-preview.ts`
- Create: `apps/web/lib/version-preview.test.ts`
- Create: `apps/web/lib/format-version-time.ts`
- Create: `apps/web/lib/format-version-time.test.ts`

**Interfaces:**
- Consumes: 无包依赖（纯函数）；preview 形状与 workbench 一致
- Produces:
  ```ts
  type PreviewLike = {
    status: string;
    revision: string | null;
  } | null | undefined;

  type VersionLike = {
    previewRevision: string | null;
  };

  canOpenPreview(version: VersionLike, preview: PreviewLike): boolean

  previewAvailabilityLabel(
    version: VersionLike,
    preview: PreviewLike,
  ): "可预览" | "产物已覆盖" | "无预览"

  formatRelativeTime(iso: string, nowMs?: number): string
  formatAbsoluteTime(iso: string): string  // 使用 zh-CN 本地可读格式
  ```

- [ ] **Step 1: Write failing tests**

`apps/web/lib/version-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canOpenPreview,
  previewAvailabilityLabel,
} from "./version-preview";

const ver = (previewRevision: string | null) => ({ previewRevision });

describe("canOpenPreview", () => {
  it("true only when ready and revision matches", () => {
    expect(
      canOpenPreview(ver("r1"), { status: "ready", revision: "r1" }),
    ).toBe(true);
  });

  it("false when status not ready", () => {
    expect(
      canOpenPreview(ver("r1"), { status: "building", revision: "r1" }),
    ).toBe(false);
  });

  it("false when revision mismatches", () => {
    expect(
      canOpenPreview(ver("old"), { status: "ready", revision: "new" }),
    ).toBe(false);
  });

  it("false when previewRevision is null", () => {
    expect(
      canOpenPreview(ver(null), { status: "ready", revision: "r1" }),
    ).toBe(false);
  });
});

describe("previewAvailabilityLabel", () => {
  it("labels openable / covered / missing", () => {
    expect(
      previewAvailabilityLabel(ver("r1"), {
        status: "ready",
        revision: "r1",
      }),
    ).toBe("可预览");
    expect(
      previewAvailabilityLabel(ver("old"), {
        status: "ready",
        revision: "new",
      }),
    ).toBe("产物已覆盖");
    expect(
      previewAvailabilityLabel(ver(null), {
        status: "ready",
        revision: "r1",
      }),
    ).toBe("无预览");
  });
});
```

`apps/web/lib/format-version-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "./format-version-time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");

  it("uses minutes / hours / days buckets", () => {
    expect(
      formatRelativeTime("2026-07-19T11:59:00.000Z", now),
    ).toBe("1 分钟前");
    expect(
      formatRelativeTime("2026-07-19T10:00:00.000Z", now),
    ).toBe("2 小时前");
    expect(
      formatRelativeTime("2026-07-17T12:00:00.000Z", now),
    ).toBe("2 天前");
  });
});

describe("formatAbsoluteTime", () => {
  it("returns a non-empty zh-CN style string", () => {
    const s = formatAbsoluteTime("2026-07-19T12:00:00.000Z");
    expect(s.length).toBeGreaterThan(8);
    expect(s).toMatch(/2026/);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @isotope/web test -- version-preview.test.ts format-version-time.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement helpers**

```ts
// apps/web/lib/version-preview.ts
export type PreviewLike = {
  status: string;
  revision: string | null;
} | null | undefined;

export type VersionLike = {
  previewRevision: string | null;
};

export function canOpenPreview(
  version: VersionLike,
  preview: PreviewLike,
): boolean {
  return (
    preview?.status === "ready" &&
    version.previewRevision != null &&
    version.previewRevision === preview.revision
  );
}

export function previewAvailabilityLabel(
  version: VersionLike,
  preview: PreviewLike,
): "可预览" | "产物已覆盖" | "无预览" {
  if (version.previewRevision == null) return "无预览";
  if (canOpenPreview(version, preview)) return "可预览";
  return "产物已覆盖";
}
```

```ts
// apps/web/lib/format-version-time.ts
export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @isotope/web test -- version-preview.test.ts format-version-time.test.ts`

Expected: PASS（若相对时间文案与断言差 1 单位，以实现为准微调断言，保持桶逻辑不变）

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/version-preview.ts apps/web/lib/version-preview.test.ts \
  apps/web/lib/format-version-time.ts apps/web/lib/format-version-time.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add version preview eligibility helpers

EOF
)"
```

---

### Task 3: API + `VersionHistoryDialog` + 顶栏入口

**Files:**
- Create: `apps/web/app/api/projects/[id]/versions/route.ts`
- Create: `apps/web/components/version-history-dialog.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`（`PanelHeader` trailing + open 状态 + `onOpenPreview`）

**Interfaces:**
- Consumes: `listProjectVersions`, `canOpenPreview`, `previewAvailabilityLabel`, `formatRelativeTime`, `formatAbsoluteTime`
- Produces:
  - `GET /api/projects/[id]/versions` → `401` / `404` / `{ versions: Version[] }`
  - `VersionHistoryDialog({ projectId, open, onOpenChange, preview, onOpenPreview })`

- [ ] **Step 1: Add API route**

对齐 `apps/web/app/api/projects/[id]/messages/route.ts`：

```ts
import { listProjectVersions } from "@isotope/application";
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
  const versions = listProjectVersions(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!versions) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ versions });
}
```

- [ ] **Step 2: Implement `VersionHistoryDialog`**

要点（完整实现写在组件文件内）：

- `open` 变为 `true` 时 `fetch(/api/projects/${projectId}/versions)`；loading / error / empty / list
- 标题「版本记录」；`DialogDescription`：「成功构建后的变更摘要；仅当前预览产物可打开。」
- 每行：`版本 {n}`、summary、相对 · 绝对 · `previewAvailabilityLabel`、按钮「查看预览」
- `disabled={!canOpenPreview(...)}`；点击启用按钮 → `onOpenPreview()` 后由父级关 Dialog + 切 Tab
- 空：`EmptyState` title「暂无版本记录」
- 列表视觉：`divide-y` / `border` 行式，**不要**复制 VersionCard 的 Sparkles 皮肤
- `max-h` + `overflow-y-auto` 防止版本多时撑破

类型可内联：

```ts
type VersionRow = {
  id: string;
  number: number;
  summary: string;
  previewRevision: string | null;
  createdAt: string;
};
```

组件签名：

```tsx
export function VersionHistoryDialog(props: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: { status: string; revision: string | null } | null;
  onOpenPreview: () => void;
}): JSX.Element
```

- [ ] **Step 3: Wire `workbench-shell`**

在主组件内：

```ts
const [versionsOpen, setVersionsOpen] = useState(false);

function handleOpenVersionPreview() {
  setVersionsOpen(false);
  persistViewerMode("preview");
}
```

`PanelHeader`：

```tsx
<PanelHeader
  title="对话"
  trailing={
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setVersionsOpen(true)}
      >
        版本
      </Button>
      <StatusBadge status={agentStatus} />
    </>
  }
/>
<VersionHistoryDialog
  projectId={project.id}
  open={versionsOpen}
  onOpenChange={setVersionsOpen}
  preview={preview}
  onOpenPreview={handleOpenVersionPreview}
/>
```

确保已 import `Button`、`VersionHistoryDialog`。`preview` 使用现有轮询 state（含 `status` / `revision`）。

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 5: Manual smoke（可选但推荐）**

`pnpm --filter @isotope/web dev` → 打开有版本的项目 → 点「版本」见列表 → 仅最新且 ready 时可「查看预览」并切到应用查看器。

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/projects/\[id\]/versions/route.ts \
  apps/web/components/version-history-dialog.tsx \
  apps/web/components/workbench-shell.tsx
git commit -m "$(cat <<'EOF'
feat(web): add version history dialog and API

EOF
)"
```

---

### Task 4: VersionCard 强联动 + ai-surfaces 文档

**Files:**
- Modify: `apps/web/components/version-card.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`（`MessageRow` 传入预览 props）
- Modify: `docs/ui/ai-surfaces.md`

**Interfaces:**
- Consumes: `canOpenPreview`, `previewAvailabilityLabel`, `handleOpenVersionPreview` / `persistViewerMode`
- Produces: `VersionCard` 在可预览时提供开预览动作（次要文字按钮「查看预览」）

**钉死：消息无 `previewRevision`。** 用 `versionRevisions: Record<number, string | null>`，经 `GET .../versions` 填充；未加载前当 `null`（只读，避免误开）。

- [ ] **Step 1: Extend `VersionCard`**

```tsx
export function VersionCard(props: {
  number: number;
  summary: string;
  canOpenPreview?: boolean;
  onOpenPreview?: () => void;
  unavailableReason?: string;
}): JSX.Element {
  // 保留现有外观
  // 当 canOpenPreview && onOpenPreview：摘要下加 Button variant="link"、「查看预览」
  // 否则：外层 title={unavailableReason}（可选），无按钮
}
```

- [ ] **Step 2: Wire revision map + `MessageRow`**

在 `WorkbenchShell`：

```ts
const [versionRevisions, setVersionRevisions] = useState<
  Record<number, string | null>
>({});

async function refreshVersionRevisions() {
  const res = await fetch(`/api/projects/${project.id}/versions`);
  if (!res.ok) return;
  const data = (await res.json()) as {
    versions: { number: number; previewRevision: string | null }[];
  };
  const next: Record<number, string | null> = {};
  for (const v of data.versions) next[v.number] = v.previewRevision;
  setVersionRevisions(next);
}
```

触发时机：

1. mount 时若 `initialMessages` / 当前 `messages` 含 `versionId` → `void refreshVersionRevisions()`
2. 现有「ready 后 refetch messages」成功且出现新 version 消息 → 再拉一次
3. `VersionHistoryDialog` 打开并成功 fetch 后，可把结果回传父级更新 map（可选；若嫌耦合，仅用 1+2）

`MessageRow` 版本分支：

```tsx
<VersionCard
  number={message.versionNumber}
  summary={message.content}
  canOpenPreview={canOpenPreview(
    { previewRevision: versionRevisions[message.versionNumber] ?? null },
    preview,
  )}
  unavailableReason={
    previewAvailabilityLabel(
      { previewRevision: versionRevisions[message.versionNumber] ?? null },
      preview,
    ) === "可预览"
      ? undefined
      : "仅当前预览产物可打开"
  }
  onOpenPreview={handleOpenVersionPreview}
/>
```

需把 `preview`、`versionRevisions`、`handleOpenVersionPreview` 传入 `MessageRow`（扩展其 props）。

- [ ] **Step 3: Update `docs/ui/ai-surfaces.md` §3**

将 Version 行改为：

```markdown
| Version | 版本号 + 一句话摘要（弱边框即可）；可从对话顶栏「版本」Dialog 浏览全部记录；「查看预览」仅当该版本对应**当前** App Viewer 产物时可点 |
```

- [ ] **Step 4: Typecheck + tests**

Run:

```bash
pnpm --filter @isotope/web typecheck
pnpm --filter @isotope/web test -- version-preview.test.ts format-version-time.test.ts
pnpm --filter @isotope/application test -- list-project-versions.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/version-card.tsx \
  apps/web/components/workbench-shell.tsx \
  docs/ui/ai-surfaces.md
git commit -m "$(cat <<'EOF'
feat(web): link VersionCard preview to current revision

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 顶栏「版本」→ Dialog | Task 3 |
| 字段：号/摘要/相对/绝对/预览状态 | Task 2 + 3 |
| 仅当前 revision 可开预览 | Task 2 + 3 + 4 |
| VersionCard 同规则 | Task 4 |
| `listProjectVersions` 新→旧 | Task 1 |
| `GET .../versions` `{ versions }` | Task 3 |
| 不改 preview 存储 / 无回滚 | 全任务遵守 |
| ai-surfaces 更新 | Task 4 |
| application + canOpenPreview 测试 | Task 1 + 2 |

## Out of scope (do not implement)

- `build/revisions/<rev>/` 归档
- git `snapshotRef` / 源码回滚
- 列表「在对话中定位」
- Sheet 组件
