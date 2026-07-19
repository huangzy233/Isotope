# Blue Primary + Restrained Login UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全局 primary / ring 换为 `#2563EB`，并把 `/login` 改成 md+ 左右分栏（左侧仅展示已落地能力文案），首页与工作台结构不动。

**Architecture:** 只改 `apps/web` 呈现层与 `docs/ui` playbook。Token 仍集中在 `globals.css`；登录页用现有 Card / Form + lucide 线型图标拼分栏壳；不新建皮肤 CSS、不改鉴权。

**Tech Stack:** Next.js 15 App Router、React 19、Tailwind 3、shadcn/ui、lucide-react、vitest（token 回归）、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md`（用户已确认）

## Global Constraints

- 沟通与用户可见文案：简体中文。
- Primary / ring = `#2563EB` → HSL `221 83% 53%`；页面禁止硬编码该 hex（用语义 class）。
- 登录左侧底：`bg-primary/5`；禁止渐变、glow、3D 装饰、主按钮 `rounded-full`。
- 文案禁止：实时协作、数据安全、灵活扩展、记住我、忘记密码、立即注册、演示账号快捷按钮。
- 品牌仅文字「Isotope」；不新增 logo 资产。
- 不改首页 / 工作台结构；不改鉴权 / `packages/*`。
- **未经用户要求不要 git commit**（下文若出现 commit 步骤，一律跳过）。

## Out of Scope

- 首页 Composer / 工作台布局改版
- 深色模式专项
- 开放注册与密码找回
- 改写归档 spec `2026-07-18-ui-design-system.md`

## File Structure

| 路径 | 职责 |
|------|------|
| `apps/web/app/globals.css` | `--primary` / `--ring` → 蓝 |
| `apps/web/lib/design-tokens.test.ts` | 断言 primary/ring HSL，防回退近黑 |
| `docs/ui/design-system.md` | 日常色板文档与 primary 规则 |
| `apps/web/app/(public)/login/page.tsx` | 分栏登录壳 + 左侧能力列表 |
| `apps/web/components/login-form.tsx` | 逻辑不动；仅必要时微调 class |
| `docs/ui/page-blueprints.md` | Login Blueprint 与分栏约定对齐 |
| `docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md` | 状态改为已批准 |

---

### Task 1: Blue primary design tokens

**Files:**
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/lib/design-tokens.test.ts`
- Modify: `docs/ui/design-system.md`

**Interfaces:**
- Produces: `--primary` / `--ring` = `221 83% 53%`（`#2563EB`）；文档与测试与之对齐
- Consumes: 无

- [ ] **Step 1: 写失败的 token 测试**

创建 `apps/web/lib/design-tokens.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  resolve(__dirname, "../app/globals.css"),
  "utf8",
);

describe("design tokens", () => {
  it("uses blue primary #2563EB (HSL 221 83% 53%)", () => {
    expect(globalsCss).toMatch(/--primary:\s*221\s+83%\s+53%/);
  });

  it("uses matching blue ring", () => {
    expect(globalsCss).toMatch(/--ring:\s*221\s+83%\s+53%/);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run:

```bash
pnpm --filter @isotope/web test -- lib/design-tokens.test.ts
```

Expected: FAIL（当前仍为 `222 47% 11%`）

- [ ] **Step 3: 更新 `globals.css` 的 primary / ring**

在 `apps/web/app/globals.css` 的 `:root` 中仅改这两行（其余 token 不动），并更新文件头注释：

```css
  /* Blue primary tool UI — see docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md */
  --primary: 221 83% 53%; /* #2563EB */
  --ring: 221 83% 53%; /* #2563EB */
```

把旧注释 `Neutral Tool` / `near-black, NOT purple` 换成上述注释；`--primary-foreground` 保持 `0 0% 100%`。

- [ ] **Step 4: 再跑测试，确认通过**

Run:

```bash
pnpm --filter @isotope/web test -- lib/design-tokens.test.ts
```

Expected: PASS（2 tests）

- [ ] **Step 5: 同步 `docs/ui/design-system.md`**

在 Color 一节：

1. 将标题 `## 2. Color（Neutral Tool）` 改为 `## 2. Color（蓝主色工具 UI）`
2. 表格中 `--primary` 行改为：`主按钮 / 活跃态` | `#2563EB`（**蓝，非近黑 / 非紫**）
3. `--ring` 行改为：`focus ring` | `#2563EB`（与 primary 一致）
4. 规则列表改为：
   - Primary **不用于**全屏 Hero 大面积铺底、渐变、glow；登录等局部可用 `bg-primary/5` 作克制 tint
   - 边框始终 subtle；分层靠留白与字重
   - 状态色 + 文案；禁止霓虹色与多色图标墙
   - 链接 / 选中态可用 `text-primary`；禁止紫粉装饰墙

§12 禁止事项中「Primary 大面积铺底」保留；若有「近黑 primary」表述一并改掉。

- [ ] **Step 6: Commit（仅当用户明确要求时执行；否则跳过）**

```bash
git add apps/web/app/globals.css apps/web/lib/design-tokens.test.ts docs/ui/design-system.md
git commit -m "$(cat <<'EOF'
feat(web): switch primary token to blue #2563EB

EOF
)"
```

---

### Task 2: Restrained split login page

**Files:**
- Modify: `apps/web/app/(public)/login/page.tsx`
- Modify: `apps/web/components/login-form.tsx`（仅当 class 需要微调；逻辑禁止改）
- Modify: `docs/ui/page-blueprints.md`（Login 节）
- Modify: `docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md`（状态 → 已批准）

**Interfaces:**
- Consumes: Task 1 的 `bg-primary` / `bg-primary/5` / `text-primary`
- Produces: `/login` md+ 分栏；窄屏仅表单；文案与 spec §4.2 一致

- [ ] **Step 1: 重写登录页为分栏壳**

将 `apps/web/app/(public)/login/page.tsx` 替换为：

```tsx
import { redirect } from "next/navigation";
import { Eye, Layers, MessageSquare } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { readSession } from "@/lib/auth";

const capabilities = [
  {
    icon: MessageSquare,
    title: "对话驱动生成",
    description: "自然语言描述需求，智能体生成并迭代",
  },
  {
    icon: Eye,
    title: "实时预览",
    description: "改码后自动构建，App Viewer 即时更新",
  },
  {
    icon: Layers,
    title: "Plan / Team 模式",
    description: "需求澄清与多智能体编排可按需开关",
  },
] as const;

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen">
      <section className="hidden w-1/2 flex-col justify-center bg-primary/5 px-10 py-12 md:flex lg:px-16">
        <div className="mx-auto w-full max-w-md space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-semibold tracking-tight text-primary">
              Isotope
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              智能应用生成平台
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              用 AI 对话构建应用，并实时预览
            </p>
          </div>
          <ul className="space-y-5">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex w-full items-center justify-center bg-background px-4 py-12 md:w-1/2">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="space-y-1 text-center">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                Isotope
              </h2>
              <CardDescription>使用演示账号登录以继续</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
```

约束核对：无「协作 / 安全 / 注册 / 忘记密码」；无 `style={{}}`；无渐变 class。

- [ ] **Step 2: 确认 `login-form.tsx` 无需改逻辑**

打开 `apps/web/components/login-form.tsx`：若表单已是 `space-y-4` + 全宽主按钮，**不要改**。仅当右侧 Card 内边距明显失调时，才可微调外层 class（禁止改 fetch / 路由 / 字段名）。

- [ ] **Step 3: 更新 Login Blueprint**

在 `docs/ui/page-blueprints.md` 的 `## Login /login` 中替换为与实现一致的约定：

**信息架构表** — 必须列增加「md+ 左侧：品牌 + 已落地能力说明（可选对窄屏隐藏）」；可选列删除「忘记密码」或注明「本产品不做」。

**推荐布局 ASCII** 改为：

```text
md+:
┌──────────────────────┬─────────────────────┐
│ Isotope              │  ┌───────────────┐  │
│ 智能应用生成平台      │  │ Isotope        │  │
│ 副文案               │  │ 演示账号登录…   │  │
│ · 对话驱动生成        │  │ 用户名 / 密码   │  │
│ · 实时预览           │  │ [登录]         │  │
│ · Plan / Team 模式   │  └───────────────┘  │
└──────────────────────┴─────────────────────┘

窄屏：仅右侧表单居中（左侧 hidden）
```

**首屏 / 第二屏** 改为：

- 首屏：md+ 为分栏；窄屏为表单 only
- 不要：虚假卖点（协作 / 安全）、注册入口、忘记密码、3D 装饰、紫粉渐变

**响应式** 改为：`< md` 隐藏左侧；表单始终可达。

**为什么这样布局** 改为：桌面用克制分栏交代产品能力；主任务仍是登录；窄屏不让营销区挤掉表单。

**本页反例** 改为：

- 紫渐变全屏 + 居中大口号
- 列出未实现能力（实时协作、数据安全等）
- 主按钮胶囊全圆角 + glow
- 开放注册 / 忘记密码假入口

- [ ] **Step 4: 将 spec 状态标为已批准**

在 `docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md` 将 `- 状态：待用户审阅` 改为 `- 状态：已批准（对话确认）`。

- [ ] **Step 5: typecheck**

Run:

```bash
pnpm --filter @isotope/web typecheck
```

Expected: 无错误退出。

- [ ] **Step 6: 目视与登录冒烟（手动）**

1. `pnpm --filter @isotope/web dev`
2. 打开 `/login`（桌面宽度 ≥768）：左右分栏；主按钮为蓝；左侧三条文案与 spec 一致
3. 缩到窄屏：左侧消失，仅表单
4. 用演示账号登录 → 进入 `/`；首页 / 工作台结构未改，主按钮等为蓝
5. 确认页上无「协作」「安全」「注册」「忘记密码」

- [ ] **Step 7: Commit（仅当用户明确要求时执行；否则跳过）**

```bash
git add apps/web/app/\(public\)/login/page.tsx apps/web/components/login-form.tsx docs/ui/page-blueprints.md docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md
git commit -m "$(cat <<'EOF'
feat(web): add restrained split login with honest copy

EOF
)"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| `--primary` / `--ring` → `#2563EB` | Task 1 |
| `design-system.md` 同步 | Task 1 |
| 登录 md+ 分栏、`bg-primary/5` | Task 2 |
| 三条已落地能力文案；无协作/安全等 | Task 2 |
| 窄屏隐藏左侧 | Task 2 |
| 不改鉴权 / 表单逻辑 | Task 2 Step 2 |
| `page-blueprints.md` 同步 | Task 2 |
| 首页/工作台结构不动 | Out of Scope + 冒烟 Step 6 |
| 无注册/忘记密码/3D/渐变 | Task 2 约束 + 反例 |

## Plan Self-Review

1. **Spec coverage:** 上表已覆盖 §3–§6；无遗漏实现项。
2. **Placeholders:** 无 TBD /「类似 Task N」；登录页与测试含完整代码。
3. **Consistency:** HSL 统一为 `221 83% 53%`；文案与 spec §4.2 逐字一致；图标固定为 `MessageSquare` / `Eye` / `Layers`。
