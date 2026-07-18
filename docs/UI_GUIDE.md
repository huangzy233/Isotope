# Isotope UI 指导文档

> **日常查阅入口。** AI / 后人改 `apps/web` 前先读本文。  
> 设计决策原文：[`docs/superpowers/specs/2026-07-18-ui-design-system.md`](superpowers/specs/2026-07-18-ui-design-system.md)  
> P0 实现计划：[`docs/superpowers/plans/2026-07-18-ui-design-system-p0.md`](superpowers/plans/2026-07-18-ui-design-system-p0.md)

**气质：** Neutral Tool（对齐 Linear / Vercel / Notion / Raycast / Stripe）  
**组件库：** 锁定 **shadcn/ui** — 禁止 AI 自写 CSS 皮肤  
**主色：** 近黑（非紫）

---

## 1. 目标

把 Demo 风格 UI 约束成可展示给用户与投资人的产品界面：视觉品质、信息层级、易用性、产品感、一致性。

**关键词：** Modern SaaS · Minimal · Professional · Clean · High information density · Developer friendly

### 约束对象

- 壳层：登录、首页、项目工作台
- AI 产品面：Prompt Composer、Agent 状态、Tool 调用、Streaming、Trace、App Viewer

### 非目标

- 不引入 Ant Design / MUI 等新 UI 库
- 不做营销落地页、深色模式专项（以浅色为准）
- 不在本文规定后端 / LLM 协议

---

## 2. 设计原则

1. **工具感优先于营销感** — 少 uppercase eyebrow、少大标题英雄区、少装饰
2. **中性默认，彩色仅语义** — 灰阶为主；绿 / 琥珀 / 红只表状态
3. **高信息密度，仍可读** — 紧凑但层级清晰
4. **一屏一主任务** — 首页 = 发起；工作台 = 对话 + 预览
5. **状态可见** — idle / running / streaming / success / error 可辨
6. **禁止 Demo 脸** — 无紫粉渐变、无 glow、无糖果大圆角、无 emoji 堆砌、无科技风粒子

---

## 3. 技术硬约束（禁止自写 CSS 皮肤）

### 3.1 唯一 UI 组件源

| 允许 | 禁止 |
|------|------|
| `apps/web/components/ui/*`（shadcn） | 页面内大段自定义 CSS |
| 缺组件按 shadcn 流程补到 `components/ui` | `style={{}}`（极罕见动态值须注释） |
| 组合件放 `apps/web/components/*.tsx`，只拼 shadcn + token class | 新建 `.css` / `.module.css` 皮肤 |
| Tailwind **语义** class：`bg-background`、`text-muted-foreground` | 硬编码色：`#5B5BF7`、`bg-purple-500`、渐变 |
| `globals.css` **仅**放 CSS 变量（tokens） | 组件内大量 `@apply`、炫技 keyframes |

**含义：AI 拼组件 + design token，不写 CSS 皮肤。**

### 3.2 已有原子组件（优先复用）

Button、Input、Textarea、Label、Tabs、Card、Badge、Skeleton、Separator

### 3.3 建议按需再补的 shadcn

Dialog、DropdownMenu、ScrollArea、Tooltip、Table

### 3.4 产品组合件

| 组合件 | 路径 / 状态 | 职责 |
|--------|-------------|------|
| `EmptyState` | ✅ `components/empty-state.tsx` | 空状态 |
| `PanelHeader` | ✅ `components/panel-header.tsx` | 工作台栏头 |
| `Composer` | ✅ `components/composer.tsx` | Prompt / 消息输入 |
| `StatusBadge` | ✅ `components/status-badge.tsx` | 运行 / 构建状态 |
| `MessageItem` | P1 待建 | User / Agent / System / Tool / Version |
| `ToolCallRow` | P1 待建 | Tool 摘要 + 可折叠详情 |
| `ViewerChrome` | P1 待建 | App Viewer 顶栏 |

---

## 4. Design Tokens

实现位置：`apps/web/app/globals.css` + `apps/web/tailwind.config.ts`

### 4.1 Color（Neutral Tool）

| Token | 用途 | 值 |
|-------|------|-----|
| `--background` | 页面底 | `#F8FAFC` |
| `--card` | 面板 | `#FFFFFF` |
| `--foreground` | 主文字 | `#0F172A` |
| `--muted-foreground` | 次要文字 | `#64748B` |
| `--border` | 边框 | `#E2E8F0` |
| `--primary` | 主按钮 / 焦点 | `#0F172A`（**近黑，非紫**） |
| `--success` / `--warning` / `--destructive` | 语义状态 | 克制绿 / 琥珀 / 红 |

**规则：** Primary 不做大面积底 / 渐变 / glow；边框弱化；分层靠留白与字重。

### 4.2 Typography

| 层级 | 约定 |
|------|------|
| Page Title | `text-xl`～`text-2xl` · `font-semibold` · `tracking-tight` |
| Section Title | `text-sm` · `font-semibold` |
| Panel Title | `text-sm` · `font-medium` |
| Body | `text-sm` · `leading-relaxed` |
| Secondary | `text-sm` · `text-muted-foreground` |
| Metadata | `text-xs` · `text-muted-foreground`；技术值可用 `font-mono` |

同屏 ≤ 4 级字号；工作台以 `sm` / `xs` 为主。

### 4.3 Spacing / Radius / Layout

- Spacing 刻度：`4 / 8 / 12 / 16 / 24 / 32`
- Radius：约 `8px`（`rounded-lg`）；禁止主按钮 `rounded-full`
- Shadow：最多一级 soft；面板优先 border
- **Auth** `max-w-md`｜**首页** `max-w-2xl`～`max-w-3xl`｜**工作台全宽**（禁止内容区 `max-w-page`）

---

## 5. 交互

| 状态 | 要求 |
|------|------|
| Hover / Focus | shadcn 默认 + `--ring` |
| Disabled / Loading | 禁重复提交；文案切换或 Skeleton |
| Empty / Error | `EmptyState`；错误靠近控件，勿大红全屏 |

微动效 ≤ `150ms`；禁止炫技动画。

---

## 6. AI / Developer 产品模式

### 6.1 Composer

结构：Textarea → 次要控件行（Tabs 等）→ 主按钮。  
状态：`idle` · `submitting` · `disabled`。  
不要大营销卡片。

### 6.2 Agent 状态（StatusBadge）

`Idle` · `Thinking` · `Running` · `Streaming` · `Done` · `Error`  
颜色只用 semantic，不用霓虹。

### 6.3 消息时间线

User / Agent（**角色名 + 身份标签**）/ System / Tool / Version。  
避免彩色气泡墙。

### 6.4 Tool

一行摘要 + Badge + 可选耗时；详情默认折叠。

### 6.5 Streaming

文本追加 + 轻量光标或 Skeleton；禁止彩虹渐变文字。

### 6.6 Trace / Cost

Metadata 级，默认可折叠；不进首页首屏。

### 6.7 App Viewer

`Idle` · `Building` · `Ready` · `Failed`（失败须有文案 + 重试）。

---

## 7. 页面指引

| 页面 | 要点 |
|------|------|
| `/login` | 窄栏 + Card；品牌用 Page Title；无 uppercase eyebrow |
| `/` | Composer 为主；项目列表为次；`max-w-3xl`；控留白 |
| `/projects/[id]` | 全宽双栏；左对话+Composer，右 Viewer；窄屏可堆叠 |
| Header | 产品名 + 用户 + 退出；全宽 |

---

## 8. Responsive

| 断点 | 要求 |
|------|------|
| ≥1280px | 双栏完整 |
| Tablet | 堆叠或抽屉聊天 |
| Mobile | 不崩；Composer ↔ Viewer 可切换即可 |

---

## 9. AI 输出检查清单

**视觉**

- [ ] 像商业工具，非 Demo 占位
- [ ] 无紫粉渐变 / glow / 糖果圆角
- [ ] 字号层级清晰；主色近黑

**交互**

- [ ] hover / focus；loading；empty / error

**代码**

- [ ] 只用 shadcn + 组合件
- [ ] 无 inline style、无硬编码色、无新建皮肤 CSS
- [ ] 走 design token

**AI 产品**

- [ ] Composer 统一；Agent/Tool/Streaming/Viewer 状态可辨
- [ ] Trace/Cost 弱化可折叠；无炫技动画

---

## 10. 相关文档

| 文档 | 用途 |
|------|------|
| [`docs/PRD.md`](PRD.md) | 产品行为与验收 |
| [`docs/architecture/PROJECT_SKELETON.md`](architecture/PROJECT_SKELETON.md) | 包边界 |
| [`docs/superpowers/specs/2026-07-18-ui-design-system.md`](superpowers/specs/2026-07-18-ui-design-system.md) | 设计决策原文 |
| [`docs/superpowers/plans/2026-07-18-ui-design-system-p0.md`](superpowers/plans/2026-07-18-ui-design-system-p0.md) | P0 落地任务 |

若与旧「偏紫强调色」描述冲突，**以本文 Neutral Tool 为准**。
