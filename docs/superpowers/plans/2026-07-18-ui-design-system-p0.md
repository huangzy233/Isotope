# UI Design System P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有登录 / 首页 / 工作台三页壳按 Neutral Tool + shadcn-only 规范产品化（换肤、降 Demo 感、统一 Composer / Empty / Panel），不接 LLM / Agent 后端。

**Architecture:** 只改 `apps/web` 呈现层。Design tokens 集中在 `globals.css`；原子组件继续放 `components/ui`（shadcn 风格手写，与现有 Button 一致）；产品组合件放 `components/`（EmptyState、PanelHeader、Composer）。页面壳只组合上述组件 + Tailwind 语义 class，禁止新建皮肤 CSS / inline style / 硬编码色值。

**Tech Stack:** Next.js 15 App Router、React 19、Tailwind 3、既有 shadcn/ui 模式（Radix + CVA + `cn`）、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-18-ui-design-system.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- **唯一 UI 源：** shadcn `components/ui/*` + 本 plan 新增组合件；禁止自写 CSS 皮肤、`style={{}}`、硬编码色值（如 `#5B5BF7`、`bg-purple-500`）。
- **Neutral Tool：** Primary = 近黑 slate-900 系；禁止紫粉渐变 / glow / 主按钮 `rounded-full`。
- 不做 LLM / 真实构建 / Agent 消息流 / Trace mock（属 P1，另开 plan）。
- 依赖方向不变；不新增 UI 库（Ant / MUI 等）。
- **未经用户要求不要 git commit**（下文若出现 commit 步骤，一律跳过）。
- 外科手术式改动：不重构 `packages/*`，不改鉴权逻辑。

## Out of Scope（本 plan 不做）

- MessageItem / ToolCallRow / Streaming 光标 / Trace 面板（P1）
- 真实项目 CRUD、发送消息 API
- 深色模式专项
- 更换字体包（保持现有 `Plus_Jakarta_Sans`）

## File Structure

| 路径 | 职责 |
|------|------|
| `apps/web/app/globals.css` | Neutral Tool CSS 变量（含 success / warning） |
| `apps/web/tailwind.config.ts` | 映射 success / warning；确认 page 宽度语义 |
| `apps/web/components/ui/badge.tsx` | shadcn Badge |
| `apps/web/components/ui/skeleton.tsx` | shadcn Skeleton |
| `apps/web/components/ui/separator.tsx` | shadcn Separator（可选，Panel 分割用） |
| `apps/web/components/empty-state.tsx` | 空状态组合件 |
| `apps/web/components/panel-header.tsx` | 工作台栏头 |
| `apps/web/components/composer.tsx` | Prompt / 消息输入组合件 |
| `apps/web/components/status-badge.tsx` | 状态 → Badge 映射（工作台 Viewer / 对话用） |
| `apps/web/app/(public)/login/page.tsx` | 登录页布局打磨 |
| `apps/web/components/login-form.tsx` | 仅必要时微调 class（逻辑不动） |
| `apps/web/components/home-shell.tsx` | 首页 Composer + EmptyState |
| `apps/web/components/workbench-shell.tsx` | 全宽双栏 + PanelHeader + Composer |
| `apps/web/components/app-header.tsx` | 顶栏密度 / hover 对齐 |

---

### Task 1: Neutral Tool design tokens

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`

**Interfaces:**
- Produces: CSS 变量 `--success`、`--warning`；Tailwind `colors.success` / `colors.warning`；Primary 改为近黑

- [ ] **Step 1: 替换 `globals.css` 的 `:root` token**

将 `:root` 改为（保留 `@tailwind` 与 `@layer` 结构）：

```css
:root {
  /* Neutral Tool — see docs/superpowers/specs/2026-07-18-ui-design-system.md */
  --background: 210 40% 98%; /* #F8FAFC */
  --foreground: 222 47% 11%; /* #0F172A */
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 222 47% 11%; /* near-black, NOT purple */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 76% 36%;
  --success-foreground: 0 0% 100%;
  --warning: 32 95% 44%;
  --warning-foreground: 0 0% 100%;
  --border: 214 32% 91%; /* #E2E8F0 */
  --input: 214 32% 91%;
  --ring: 222 47% 11%;
  --radius: 0.5rem; /* 8px */
  --shadow-soft: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
}
```

同步更新文件顶部注释，去掉「Primary #5B5BF7」。

- [ ] **Step 2: 扩展 `tailwind.config.ts` colors**

在 `theme.extend.colors` 中增加：

```ts
success: {
  DEFAULT: "hsl(var(--success))",
  foreground: "hsl(var(--success-foreground))",
},
warning: {
  DEFAULT: "hsl(var(--warning))",
  foreground: "hsl(var(--warning-foreground))",
},
```

保留现有 `maxWidth.page`（首页仍可用）；工作台将不再使用该约束。

- [ ] **Step 3: 视觉冒烟**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS  

手动：`pnpm --filter @isotope/web dev`，打开 `/login`——主按钮应为近黑，非紫色。

---

### Task 2: shadcn Badge + Skeleton + Separator

**Files:**
- Create: `apps/web/components/ui/badge.tsx`
- Create: `apps/web/components/ui/skeleton.tsx`
- Create: `apps/web/components/ui/separator.tsx`
- Modify: `apps/web/package.json`（若 Separator 需要 `@radix-ui/react-separator`）

**Interfaces:**
- Produces:
  - `Badge` + `badgeVariants`（variants: `default` | `secondary` | `outline` | `success` | `warning` | `destructive`）
  - `Skeleton`
  - `Separator`

- [ ] **Step 1: 安装 Radix Separator（若尚未安装）**

Run:

```bash
pnpm --filter @isotope/web add @radix-ui/react-separator
```

Expected: `package.json` 出现该依赖；lockfile 更新。

- [ ] **Step 2: 创建 `badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        success:
          "border-transparent bg-success/10 text-success",
        warning:
          "border-transparent bg-warning/10 text-warning",
        destructive:
          "border-transparent bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 3: 创建 `skeleton.tsx`**

```tsx
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
```

（`React` 命名空间：文件顶部 `import * as React from "react"`。）

- [ ] **Step 4: 创建 `separator.tsx`**

```tsx
"use client";

import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
```

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

---

### Task 3: EmptyState + PanelHeader + StatusBadge

**Files:**
- Create: `apps/web/components/empty-state.tsx`
- Create: `apps/web/components/panel-header.tsx`
- Create: `apps/web/components/status-badge.tsx`

**Interfaces:**
- Produces:
  - `EmptyState({ title, description, action?: ReactNode })`
  - `PanelHeader({ title, trailing?: ReactNode })`
  - `StatusBadge({ status: "idle" | "thinking" | "running" | "streaming" | "done" | "error" | "building" | "ready" | "failed" })`

- [ ] **Step 1: 创建 `empty-state.tsx`**

```tsx
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/60 px-6 py-10 text-center">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: 创建 `panel-header.tsx`**

```tsx
import type { ReactNode } from "react";

export function PanelHeader({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <span className="text-sm font-medium text-foreground">{title}</span>
      {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3: 创建 `status-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<StatusKey, string> = {
  idle: "空闲",
  thinking: "思考中",
  running: "执行中",
  streaming: "输出中",
  done: "完成",
  error: "错误",
  building: "构建中",
  ready: "就绪",
  failed: "失败",
};

type StatusKey =
  | "idle"
  | "thinking"
  | "running"
  | "streaming"
  | "done"
  | "error"
  | "building"
  | "ready"
  | "failed";

const STATUS_VARIANT: Record<
  StatusKey,
  "secondary" | "outline" | "warning" | "success" | "destructive"
> = {
  idle: "secondary",
  thinking: "outline",
  running: "warning",
  streaming: "warning",
  done: "success",
  error: "destructive",
  building: "warning",
  ready: "success",
  failed: "destructive",
};

export function StatusBadge({ status }: { status: StatusKey }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

---

### Task 4: Composer 组合件

**Files:**
- Create: `apps/web/components/composer.tsx`

**Interfaces:**
- Produces: `Composer` — 受控 Textarea + 可选 `toolbar`（左侧）+ 主按钮；支持 `disabled` / `submitting` / `onSubmit`

- [ ] **Step 1: 创建 `composer.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel = "发送",
  submittingLabel = "提交中…",
  submitting = false,
  disabled = false,
  toolbar,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitLabel?: string;
  submittingLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
  toolbar?: ReactNode;
}) {
  const isDisabled = disabled || submitting;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-soft">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={isDisabled}
        className="min-h-[112px] border-0 shadow-none focus-visible:ring-0"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-h-9 items-center gap-2">{toolbar}</div>
        <Button
          type="button"
          className="sm:min-w-28"
          disabled={isDisabled || value.trim().length === 0}
          onClick={onSubmit}
        >
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </div>
  );
}
```

说明：首页「开始」仍可 `Link` 跳转时，由调用方在 `onSubmit` 里 `router.push`；空输入时按钮 disabled（满足规范，不接真实创建 API）。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

---

### Task 5: 登录页打磨

**Files:**
- Modify: `apps/web/app/(public)/login/page.tsx`
- Modify: `apps/web/components/login-form.tsx`（仅 class，逻辑不动）
- Modify: `apps/web/components/ui/card.tsx`（去掉 Card 默认 `hover:shadow-soft-md`，避免无交互卡片「浮动」Demo 感）

**Interfaces:**
- Consumes: Card（可选改用显式 Card 包裹）

- [ ] **Step 1: 弱化 Card 默认 hover 阴影**

将 `card.tsx` 根节点 class 中的 `hover:shadow-soft-md` 删除，保留：

```tsx
"rounded-lg border border-border bg-card text-card-foreground shadow-soft"
```

- [ ] **Step 2: 重写登录页布局**

```tsx
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { readSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Isotope
          </h1>
          <p className="text-sm text-muted-foreground">使用演示账号登录以继续</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>仅支持配置的内置账号</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

去掉 `uppercase tracking-[0.16em]` eyebrow。

- [ ] **Step 3: 确认 LoginForm 无硬编码色**

保持现有错误态 class（已用 `destructive` token）。`space-y-6` 可改为 `space-y-4` 以贴近密度规范（可选）。

- [ ] **Step 4: 手动验收**

打开 `/login`：品牌为 Page Title；主按钮近黑；无紫色；卡片无无意义 hover 上浮。

---

### Task 6: 首页 HomeShell 产品化

**Files:**
- Modify: `apps/web/components/home-shell.tsx`

**Interfaces:**
- Consumes: `Composer`、`EmptyState`、Tabs、`useRouter`

- [ ] **Step 1: 用 Composer + EmptyState 重写 `home-shell.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function HomeShell() {
  const router = useRouter();
  const [requirement, setRequirement] = useState("");
  const [mode, setMode] = useState("engineer");
  const [submitting, setSubmitting] = useState(false);

  function handleStart() {
    if (!requirement.trim() || submitting) return;
    setSubmitting(true);
    // P0：仍跳转 mock 项目；mode 暂不持久化
    router.push(`/projects/demo?mode=${encodeURIComponent(mode)}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="space-y-8">
        <section className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            从一句话开始构建
          </h1>
          <p className="text-sm text-muted-foreground">
            选择模式，描述需求，进入工作台继续迭代
          </p>
        </section>

        <Composer
          value={requirement}
          onChange={setRequirement}
          onSubmit={handleStart}
          placeholder="例如：做一个待办清单，支持分组与截止时间…"
          submitLabel="开始"
          submittingLabel="进入中…"
          submitting={submitting}
          toolbar={
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="engineer">Engineer</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">我的项目</h2>
            <span className="text-xs text-muted-foreground">即将接入</span>
          </div>
          <EmptyState
            title="还没有项目"
            description="描述需求并点击「开始」，即可进入演示工作台"
          />
        </section>
      </div>
    </main>
  );
}
```

要点：标题左对齐（工具感）；`py-8` / `space-y-8` 替代 `py-16` / `space-y-16`；空输入无法开始。

- [ ] **Step 2: typecheck + 手动**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS  

手动：空输入时「开始」disabled；有内容可进入 `/projects/demo`。

---

### Task 7: 工作台全宽 + PanelHeader + Composer

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: `PanelHeader`、`Composer`、`EmptyState`、`StatusBadge`

- [ ] **Step 1: 重写 `workbench-shell.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { PanelHeader } from "@/components/panel-header";
import { StatusBadge } from "@/components/status-badge";

export function WorkbenchShell({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">项目</p>
          <h1 className="truncate text-sm font-semibold text-foreground">
            {projectId}
          </h1>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-[50vh] flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader
            title="对话"
            trailing={<StatusBadge status="idle" />}
          />
          <div className="flex flex-1 flex-col justify-center overflow-y-auto p-4">
            <EmptyState
              title="暂无消息"
              description="下一步将接入 Agent 对话。可先在下方输入框预览发送区交互。"
            />
          </div>
          <div className="border-t border-border p-4">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => {
                /* P0：无后端，仅保留 UI；清空表示「已点发送」反馈可选 */
              }}
              placeholder="输入消息…"
              disabled
              submitLabel="发送"
            />
          </div>
        </section>

        <section className="flex min-h-[50vh] flex-col lg:min-h-0">
          <PanelHeader
            title="App Viewer"
            trailing={<StatusBadge status="idle" />}
          />
          <div className="flex flex-1 flex-col justify-center bg-background p-4">
            <EmptyState
              title="预览区"
              description="构建产物将在此实时展示"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
```

要点：
- **去掉** `max-w-page` 与外层大圆角双栏「卡片盒」——全宽工具布局。
- Composer 在底栏；P0 仍 `disabled`（无后端），但结构与首页一致，避免以后推翻。
- 若希望底栏可输入仅前端态：可去掉 `disabled`，`onSubmit` 里 `setDraft("")` 并保持 EmptyState（仍无真实消息列表）——**推荐保留 disabled**，与「未接 Agent」诚实一致；结构已预留。

**推荐折中（写入实现）：** Composer **不** disabled，点击发送若 `draft` 非空则清空并短暂 `submitting`，不渲染假消息（P1 再做 MessageItem）。这样投资人能感到输入区是活的。

更新后的提交逻辑片段：

```tsx
const [submitting, setSubmitting] = useState(false);

async function handleSend() {
  if (!draft.trim() || submitting) return;
  setSubmitting(true);
  await new Promise((r) => setTimeout(r, 300));
  setDraft("");
  setSubmitting(false);
}
```

Composer：`submitting={submitting}`，`onSubmit={handleSend}`，无 `disabled`。

- [ ] **Step 2: 确认 `(app)/layout` 仍是 `flex flex-col` 全高**

`apps/web/app/(app)/layout.tsx` 已有 `flex min-h-screen flex-col`；工作台根用 `flex-1` 即可撑满。若双栏高度不足，给 workbench 根加 `min-h-[calc(100vh-3.5rem)]`（减去 header `h-14`）。

- [ ] **Step 3: typecheck + 手动**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS  

手动：桌面宽度下双栏顶满视口；无居中窄盒；状态 Badge 可见；发送后输入清空。

---

### Task 8: AppHeader 密度对齐 + 终验

**Files:**
- Modify: `apps/web/components/app-header.tsx`

- [ ] **Step 1: 微调 Header**

保持结构；确保：
- 全宽（可去掉 header 内 `max-w-page`，与工作台全宽一致），左右 `px-6`
- Logo hover 用 `hover:text-foreground` 或保持细微变化；**不要** `hover:text-primary` 若 primary 已是近黑则勉强可读——改为 `hover:opacity-80`

```tsx
<header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-md">
  <div className="flex h-14 items-center justify-between px-6">
    <Link
      href="/"
      className="text-sm font-semibold tracking-tight text-foreground transition-opacity duration-150 hover:opacity-80"
    >
      Isotope
    </Link>
    {/* username + logout 不变 */}
  </div>
</header>
```

- [ ] **Step 2: 全量 typecheck**

Run: `pnpm --filter @isotope/web typecheck`  
Expected: PASS

- [ ] **Step 3: Quality Checklist（对照 spec §11）**

视觉：
- [ ] 主色近黑，无紫色主按钮
- [ ] 登录无营销 uppercase eyebrow
- [ ] 首页密度合理，Composer 为视觉主任务
- [ ] 工作台全宽双栏，非窄卡片盒

交互：
- [ ] 首页空输入不可开始
- [ ] 登录 loading / 错误仍可用
- [ ] 工作台 Composer 可输入并清空（或按选定 disabled 策略）
- [ ] EmptyState 三处文案可读

代码：
- [ ] 无新皮肤 CSS / 无 inline style / 无硬编码紫
- [ ] 新增 UI 仅在 `components/ui` 或组合件
- [ ] 未引入 Ant Design 等新库

- [ ] **Step 4:（可选）Commit —— 仅当用户明确要求时执行**

```bash
git add apps/web/app/globals.css apps/web/tailwind.config.ts \
  apps/web/components apps/web/app/\(public\)/login/page.tsx \
  apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
style(web): apply Neutral Tool UI system to app shell

Align tokens and login/home/workbench shells with the product UI spec
using shadcn primitives and shared Composer/EmptyState patterns.
EOF
)"
```

---

## Self-Review（plan vs spec）

| Spec 要求 | 对应 Task |
|-----------|-----------|
| Neutral Tool tokens / 去紫 Primary | Task 1 |
| shadcn-only，禁自写 CSS | Task 2–8（仅 globals tokens） |
| Badge / Skeleton 等补齐 | Task 2 |
| EmptyState / PanelHeader / Composer | Task 3–4 |
| StatusBadge 状态映射 | Task 3 |
| 登录去 eyebrow、Card | Task 5 |
| 首页密度 + Composer | Task 6 |
| 工作台全宽 + 双栏结构 | Task 7 |
| Header 与全宽对齐 | Task 8 |
| P1 Message/Tool/Streaming/Trace | **明确 Out of Scope** |

无 TBD 占位；类型名在 Task 间一致（`StatusKey`、`Composer` props）。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-ui-design-system-p0.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 派独立 subagent，Task 间审查  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?
