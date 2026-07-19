# Home + Workbench Visual Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在蓝主色已落地的前提下，按诚实能力对齐首页与工作台视觉（快捷开始预填、过程步/顶栏/侧栏/版本卡 token 化），不引入假入口。

**Architecture:** 只改 `apps/web` 呈现层与 `docs/ui` playbook。快捷开始文案抽到纯常量模块便于回归；Composer 共用密度；工作台过程步与预览顶栏做 class 级打磨；版本卡去掉硬编码紫蓝。

**Tech Stack:** Next.js 15、React 19、Tailwind 3、shadcn/ui、lucide-react、vitest、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-19-home-workbench-visual-align-design.md`（用户已确认）

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 不做：模型选择器、设备切换、Zoom、新标签、Restore、多脚手架、主区项目缩略图、假 checkbox 任务板、假「即将推出」控件。
- 快捷开始 = 仅预填 Composer；仍走同一 `vite-react` 脚手架。
- 语义 class only；禁止页面硬编码 hex / 紫粉渐变 / glow / 主按钮 `rounded-full`。
- Primary 已是 `#2563EB`；本轮不改 `globals.css` tokens。
- 不改鉴权、Agent、预览构建后端。
- **未经用户要求不要 git commit**（下文 commit 步骤一律跳过，除非用户明确要求）。

## Out of Scope

- 登录页再改（已交付）
- P1 真实响应式视口实现
- 版本回滚后端

## File Structure

| 路径 | 职责 |
|------|------|
| `apps/web/lib/home-quick-starts.ts` | 快捷开始静态常量 |
| `apps/web/lib/home-quick-starts.test.ts` | 文案回归 |
| `apps/web/components/composer.tsx` | 共用输入区加高 / 密度 |
| `apps/web/components/home-shell.tsx` | 标题层级 + 快捷开始 UI |
| `apps/web/components/app-sidebar.tsx` | 活跃项目 primary 指示 |
| `apps/web/components/workbench-shell.tsx` | 过程步 + 预览顶栏样式 |
| `apps/web/components/version-card.tsx` | 去掉硬编码紫蓝 → token |
| `apps/web/lib/version-card-tokens.test.ts` | 断言无硬编码 `#` 色 |
| `docs/ui/page-blueprints.md` | Home / Workspace 约定同步 |
| `docs/superpowers/specs/2026-07-19-home-workbench-visual-align-design.md` | 状态 → 已批准 |

---

### Task 1: Composer density + home quick starts

**Files:**
- Create: `apps/web/lib/home-quick-starts.ts`
- Create: `apps/web/lib/home-quick-starts.test.ts`
- Modify: `apps/web/components/composer.tsx`
- Modify: `apps/web/components/home-shell.tsx`
- Modify: `docs/ui/page-blueprints.md`（仅 Home `/` 节）

**Interfaces:**
- Produces: `HOME_QUICK_STARTS: readonly { id: string; label: string; prompt: string }[]`
- Consumes: 现有 `Composer` / `ComposerModeChips` / `ComposerModeMenu` props（不变）

- [ ] **Step 1: 写失败的快捷开始测试**

创建 `apps/web/lib/home-quick-starts.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { HOME_QUICK_STARTS } from "./home-quick-starts";

describe("HOME_QUICK_STARTS", () => {
  it("has exactly three honest prompt chips", () => {
    expect(HOME_QUICK_STARTS).toEqual([
      {
        id: "todo",
        label: "待办清单",
        prompt: "做一个待办清单，支持分组与截止时间",
      },
      {
        id: "login",
        label: "登录页",
        prompt: "做一个简洁的登录页，含邮箱密码与主按钮",
      },
      {
        id: "dashboard",
        label: "数据看板",
        prompt: "做一个简单数据看板，含指标卡与图表占位",
      },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
pnpm --filter @isotope/web test -- lib/home-quick-starts.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 添加常量模块**

创建 `apps/web/lib/home-quick-starts.ts`：

```ts
export const HOME_QUICK_STARTS = [
  {
    id: "todo",
    label: "待办清单",
    prompt: "做一个待办清单，支持分组与截止时间",
  },
  {
    id: "login",
    label: "登录页",
    prompt: "做一个简洁的登录页，含邮箱密码与主按钮",
  },
  {
    id: "dashboard",
    label: "数据看板",
    prompt: "做一个简单数据看板，含指标卡与图表占位",
  },
] as const;
```

- [ ] **Step 4: 再跑测试确认通过**

Run:

```bash
pnpm --filter @isotope/web test -- lib/home-quick-starts.test.ts
```

Expected: PASS

- [ ] **Step 5: 加高 Composer 输入区**

在 `apps/web/components/composer.tsx`，将 Textarea 的 `min-h-24` 改为 `min-h-32`。其余逻辑与 class 不动（保持 `rounded-lg border border-border bg-card p-3`）。

- [ ] **Step 6: 更新 HomeShell**

在 `apps/web/components/home-shell.tsx`：

1. Import：`Button` from `@/components/ui/button`；`HOME_QUICK_STARTS` from `@/lib/home-quick-starts`
2. 外层容器垂直节奏：`space-y-6` → `space-y-8`；标题区 `space-y-1` → `space-y-2`，并加 `pt-2`
3. 标题 class：`text-xl` → `text-2xl sm:text-3xl`
4. Composer 块之后、error 之前（或 error 之后）增加快捷开始区：

```tsx
<section className="space-y-3">
  <h2 className="text-sm font-semibold text-foreground">快捷开始</h2>
  <div className="flex flex-wrap gap-2">
    {HOME_QUICK_STARTS.map((item) => (
      <Button
        key={item.id}
        type="button"
        variant="outline"
        size="sm"
        disabled={submitting}
        onClick={() => setRequirement(item.prompt)}
      >
        {item.label}
      </Button>
    ))}
  </div>
</section>
```

禁止在 chip 文案中写「模板」「CRM」等暗示多脚手架的词。主区不加项目网格。

完整 `return` 结构参考：

```tsx
return (
  <div className="mx-auto w-full max-w-3xl px-6 py-8">
    <div className="space-y-8">
      <section className="space-y-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          从一句话开始构建
        </h1>
        <p className="text-sm text-muted-foreground">
          选择模式，描述需求，进入工作台继续迭代
        </p>
      </section>

      <div className="space-y-2">
        <Composer /* 现有 props 不变 */ />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">快捷开始</h2>
        <div className="flex flex-wrap gap-2">
          {HOME_QUICK_STARTS.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() => setRequirement(item.prompt)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </section>
    </div>
  </div>
);
```

- [ ] **Step 7: 更新 Home Blueprint**

在 `docs/ui/page-blueprints.md` 的 `## Home `/`` 中：

1. 信息架构「可选」列增加：`快捷开始 chips（仅预填 Composer 文案）`
2. ASCII 在 Composer 下方加一行：`快捷开始 [待办] [登录页] [数据看板]`
3. 首屏补充：快捷开始可见；**不要**主区项目缩略图网格
4. 反例增加：`主区假多模板 / 缩略图项目墙`；`快捷开始暗示不同脚手架`

- [ ] **Step 8: typecheck**

Run:

```bash
pnpm --filter @isotope/web typecheck
```

Expected: 无错误

- [ ] **Step 9: Commit（仅当用户明确要求时；否则跳过）**

```bash
git add apps/web/lib/home-quick-starts.ts apps/web/lib/home-quick-starts.test.ts apps/web/components/composer.tsx apps/web/components/home-shell.tsx docs/ui/page-blueprints.md
git commit -m "$(cat <<'EOF'
feat(web): enlarge home composer and add quick-start chips

EOF
)"
```

---

### Task 2: Sidebar + workbench chrome + version tokens

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`（过程步 summary / phase 指示 + 预览顶栏 TabsTrigger）
- Modify: `apps/web/components/version-card.tsx`
- Create: `apps/web/lib/version-card-tokens.test.ts`
- Modify: `docs/ui/page-blueprints.md`（Workspace 节）
- Modify: `docs/superpowers/specs/2026-07-19-home-workbench-visual-align-design.md`（状态）

**Interfaces:**
- Consumes: Task 1 的 Composer `min-h-32`（工作台自动受益）
- Produces: 侧栏活跃态 class；过程步 success 勾选感；版本卡语义色

- [ ] **Step 1: 写失败的版本卡 token 测试**

创建 `apps/web/lib/version-card-tokens.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../components/version-card.tsx"),
  "utf8",
);

describe("VersionCard tokens", () => {
  it("does not hardcode hex colors", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
pnpm --filter @isotope/web test -- lib/version-card-tokens.test.ts
```

Expected: FAIL（当前有 `#d8defa` 等）

- [ ] **Step 3: 用语义 token 重写 VersionCard**

将 `apps/web/components/version-card.tsx` 的根与装饰改为（逻辑 props / 按钮行为不变；**不加** Restore）：

```tsx
"use client";

import type { JSX } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VersionCard(props: {
  number: number;
  summary: string;
  canOpenPreview?: boolean;
  onOpenPreview?: () => void;
  unavailableReason?: string;
}): JSX.Element {
  const { number, summary, canOpenPreview, onOpenPreview, unavailableReason } =
    props;
  const showPreview = Boolean(canOpenPreview && onOpenPreview);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border bg-primary/5 px-4 py-3.5"
      title={showPreview ? undefined : unavailableReason}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-1 top-2 text-primary/30"
      >
        <Sparkles className="size-7" strokeWidth={1.25} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-8 text-primary/20"
      >
        <Sparkles className="size-4" strokeWidth={1.25} />
      </div>

      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary">
          <Sparkles className="size-3.5 text-primary-foreground" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold text-foreground">版本 {number}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {summary}
          </p>
          {showPreview ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto px-0 text-xs text-primary"
              onClick={onOpenPreview}
            >
              查看预览
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 再跑版本卡测试**

Run:

```bash
pnpm --filter @isotope/web test -- lib/version-card-tokens.test.ts
```

Expected: PASS

- [ ] **Step 5: 侧栏活跃态改为 primary 指示**

在 `apps/web/components/app-sidebar.tsx`，将 active 分支 class 从：

```ts
active
  ? "bg-accent font-medium text-accent-foreground"
  : "text-foreground hover:bg-accent/60",
```

改为：

```ts
active
  ? "border-l-2 border-primary bg-primary/5 font-medium text-foreground"
  : "border-l-2 border-transparent text-foreground hover:bg-accent/60",
```

折叠态同样使用上述 `active` / 非 `active` 分支（保持现有 `collapsed ? ... : ...` 布局 class，只替换颜色分支）。交互（删除、折叠、退出）不动。

- [ ] **Step 6: 过程步视觉（只读时间线）**

在 `apps/web/components/workbench-shell.tsx` 的 assistant `MessageRow` 过程步区块：

1. summary 内 `CheckCircle2`：`text-muted-foreground` → `text-success`
2. 每个 phase 左侧圆点：`bg-muted-foreground/45` → `bg-success`
3. 不改 `groupProcessPhases`、不改成可勾选 checkbox、不改数据模型

- [ ] **Step 7: 预览顶栏活跃 Tab**

同一文件预览顶栏 `TabsTrigger`，为两个 trigger 增加 active 指示 class（保留 `text-xs`）：

```tsx
<TabsTrigger
  value="preview"
  className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
>
  应用查看器
</TabsTrigger>
<TabsTrigger
  value="editor"
  className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
>
  编辑器
</TabsTrigger>
```

顶栏仍只含：Tabs、StatusBadge、刷新、沉浸。**不要**加设备/Zoom/新标签按钮。

- [ ] **Step 8: 更新 Workspace Blueprint + spec 状态**

`docs/ui/page-blueprints.md` Workspace 节：

1. 反例或「不要」列表明确：无模型选择器、无设备切换/Zoom/新标签、无版本 Restore
2. 可选一句：过程步为只读时间线（success 指示），非可勾选任务板
3. 侧栏：活跃项可用 primary 轻底 / 左边线

将 spec `2026-07-19-home-workbench-visual-align-design.md` 状态改为：`已批准（对话确认）`。

- [ ] **Step 9: 跑相关测试 + typecheck**

Run:

```bash
pnpm --filter @isotope/web test -- lib/home-quick-starts.test.ts lib/version-card-tokens.test.ts lib/design-tokens.test.ts
pnpm --filter @isotope/web typecheck
```

Expected: 全部 PASS；typecheck 无错误

- [ ] **Step 10: 目视冒烟（手动）**

1. `pnpm --filter @isotope/web dev`
2. 首页：大标题 + 三个快捷 chip 预填；点「开始」可建项目（若有演示账号）
3. 工作台：过程步勾选感；预览 Tab 蓝活跃；侧栏活跃 primary；版本卡无紫硬编码、仅「查看预览」
4. 确认无模型选择 / 设备切换 / Restore

- [ ] **Step 11: Commit（仅当用户明确要求时；否则跳过）**

```bash
git add apps/web/components/app-sidebar.tsx apps/web/components/workbench-shell.tsx apps/web/components/version-card.tsx apps/web/lib/version-card-tokens.test.ts docs/ui/page-blueprints.md docs/superpowers/specs/2026-07-19-home-workbench-visual-align-design.md
git commit -m "$(cat <<'EOF'
feat(web): align workbench chrome and version card with blue primary

EOF
)"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 首页标题放大 + Composer 加高 | Task 1 |
| 三个快捷 chip 预填文案 | Task 1 |
| 无主区缩略图 / 假模板 | Task 1 约束 |
| Home blueprint | Task 1 |
| 侧栏 primary 活跃 | Task 2 |
| 过程步 success 指示、只读时间线 | Task 2 |
| 预览 Tab primary 活跃；无设备/Zoom/新标签 | Task 2 |
| 版本卡 token 化；无 Restore | Task 2 |
| Workspace blueprint + spec 已批准 | Task 2 |
| Composer 工作台自动受益 | Task 1 → Task 2 |

## Plan Self-Review

1. **Spec coverage:** 上表覆盖 §3–§6；无遗漏。
2. **Placeholders:** 无 TBD；关键 UI 含完整 class / JSX。
3. **Consistency:** 三条文案与 spec §3.3 逐字一致；禁止假入口与 Global Constraints 一致。
