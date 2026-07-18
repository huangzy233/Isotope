# 设计：Isotope UI Design System（产品级界面指导）

> **日常查阅请用：** [`docs/UI_GUIDE.md`](../../UI_GUIDE.md)（本文为设计决策原文；P0 壳层换肤已落地）。

- 日期：2026-07-18
- 状态：已批准（对话确认：方案 A 文档优先 + Neutral Tool + shadcn/ui 唯一组件源）
- 范围：UI 指导文档；P0 实现见 `docs/superpowers/plans/2026-07-18-ui-design-system-p0.md`

## 1. 目标

将 AI / 后人输出的 Demo 风格 UI 约束为接近成熟商业产品的界面，重点提升：

- 视觉品质
- 信息层级
- 易用性
- 产品感
- 一致性

最终标准：界面可展示给用户与投资人，而不是「开发者占位页」。

### 1.1 设计方向

参考：Linear、Vercel Dashboard、Notion、Raycast、Stripe Dashboard。

关键词：Modern SaaS · Minimal · Professional · Clean · High information density · Developer friendly。

选定气质：**Neutral Tool（方案 1）** — 中性灰阶为主，主操作近黑，彩色仅用于语义状态。

### 1.2 约束对象

- 现有壳：登录、首页、项目工作台
- 未来能力 UI：Prompt 输入、Agent 运行状态、Tool 调用、Streaming、Trace、Result / App Viewer

### 1.3 非目标

- 本轮不实现组件、不修改 `apps/web` 样式与页面
- 不引入新 UI 依赖（不换 Ant Design / MUI 等）
- 不规定后端协议、LLM、真实构建逻辑
- 不做开放注册、营销落地页、深色模式专项（`darkMode: class` 可保留能力，本规范以浅色为准）

---

## 2. 设计原则

1. **工具感优先于营销感** — 少 uppercase eyebrow、少大标题英雄区、少装饰图形。
2. **中性默认，彩色仅语义** — 几乎全灰阶；绿 / 琥珀 / 红只表示状态。
3. **高信息密度，仍可读** — 紧凑间距，但标题 / 正文 / 元数据层级清晰。
4. **一屏一主任务** — 首页 = 发起构建；工作台 = 对话 + 预览。
5. **状态可见** — `idle` / `running` / `streaming` / `success` / `error` 必须可辨。
6. **禁止 Demo 脸** — 无紫粉渐变、无 glow、无大圆角糖果按钮、无 emoji 堆砌、无科技风粒子背景。

---

## 3. 技术硬约束（禁止 AI 自写 CSS 皮肤）

### 3.1 唯一 UI 组件源

**锁定 shadcn/ui（Radix 原语 + Tailwind 语义 class）。**

| 允许 | 禁止 |
|------|------|
| 使用 `apps/web/components/ui/*` | 页面 / 业务组件内大段自定义 CSS |
| 缺失时按 shadcn 标准流程新增到 `components/ui` | `style={{}}` inline style（除极罕见动态值且需注释理由） |
| 产品组合件放 `apps/web/components/*.tsx`，内部只组合 shadcn + token class | 新建皮肤用 `.css` / `.module.css` |
| Tailwind **语义** class：`bg-background`、`text-muted-foreground`、`border-border` | 硬编码色值：`#5B5BF7`、`bg-purple-500`、`from-indigo-500` |
| `globals.css` **仅**维护 CSS 变量（design tokens） | 组件内大量 `@apply`、自定义 keyframe 炫技动画 |

含义：**AI 拼组件 + design token，不写 CSS 皮肤。** Tailwind class 是设计系统的用法，不是自制样式表。

### 3.2 现有基础组件（已存在则复用）

- Button、Input、Textarea、Label、Tabs、Card

### 3.3 建议按需新增的 shadcn 组件（实现阶段再做）

| 组件 | 用途 |
|------|------|
| Badge | 模式、角色、Agent/Tool/构建状态 |
| Separator | 面板分割 |
| Skeleton | Loading |
| Dialog | 确认、详情 |
| DropdownMenu | 溢出操作、模式等 |
| ScrollArea | 消息列表、长 Trace |
| Tooltip | 图标按钮、元数据说明 |
| Table | 若出现结构化 Trace / 版本列表 |

### 3.4 产品组合件（非 shadcn 原子，但必须基于 shadcn）

实现阶段应提取、并禁止在页面内复制粘贴：

| 组合件 | 职责 |
|--------|------|
| `EmptyState` | 标题 + 说明 + 可选 CTA |
| `PanelHeader` | 工作台左右栏标题行 |
| `Composer` | Prompt / 消息输入区（Textarea + 工具行 + 主按钮） |
| `StatusBadge` | 统一映射运行/构建状态到 Badge |
| `MessageItem` | User / Agent / System / Tool / Version |
| `ToolCallRow` | Tool 名称 + 状态 + 可折叠详情 |
| `ViewerChrome` | App Viewer 顶栏状态 + 刷新等操作 |

---

## 4. Design Tokens

> 下列为**文档约定目标值**。当前仓库 `globals.css` 仍为偏紫 Primary；**换肤属于后续实现任务**，本文先定标准。

### 4.1 Color（Neutral Tool）

| Token | 用途 | 目标值 |
|-------|------|--------|
| `--background` | 页面底 | `#F8FAFC`（slate-50 系） |
| `--card` / surface | 面板、卡片 | `#FFFFFF` |
| `--foreground` | 主文字 | `#0F172A`（slate-900） |
| `--muted` | 弱底 | `#F1F5F9` |
| `--muted-foreground` | 次要文字 | `#64748B` |
| `--border` / `--input` | 边框 | `#E2E8F0`（弱化） |
| `--primary` | 主按钮、焦点环 | `#0F172A`（近黑，**非紫**） |
| `--primary-foreground` | 主按钮文字 | `#FFFFFF` |
| `--accent` | 轻悬停底 | `#F1F5F9` |
| `--accent-foreground` | 悬停文字 | `#0F172A` |
| `--ring` | focus ring | 与 primary 一致或略透明 |
| `--destructive` | 错误 / 危险 | 克制红（保持现有 destructive 量级即可） |
| `--success` | 成功 / 完成 | 克制绿（实现时新增 token） |
| `--warning` | 进行中 / 注意 | 克制琥珀（实现时新增 token） |

**颜色使用规则：**

- Primary **不用于**大面积背景、Hero、渐变、glow。
- 边框始终 subtle；分层靠留白与字重，不靠粗深边框。
- Agent / Tool 状态：semantic color + 文案；禁止霓虹色与多色图标墙。
- 链接色可与 foreground 同级 underline，或极克制的 slate；避免高饱和蓝紫。

### 4.2 Typography

字体：保持单一 `font-sans`（实现阶段可继续用现有字体或改为更工具感的几何无衬线；**禁止**同页混用多种展示字体）。

| 层级 | 用途 | 约定 |
|------|------|------|
| Page Title | 页面主标题 | `text-xl`～`text-2xl` · `font-semibold` · `tracking-tight` |
| Section Title | 区块标题 | `text-sm` · `font-semibold` |
| Panel / Card Title | 面板头 | `text-sm` · `font-medium` |
| Body | 正文、消息 | `text-sm` · `leading-relaxed` |
| Secondary | 说明、辅助 | `text-sm` · `text-muted-foreground` |
| Metadata | 时间、ID、token、耗时、成本 | `text-xs` · `text-muted-foreground`；技术值可用 `font-mono` |

**规则：**

- 同屏字号层级 ≤ 4 级。
- 工作台以 `sm` / `xs` 为主；避免营销向 `text-3xl` / `text-4xl`。
- 避免「所有文字一样大」；标题与正文必须可扫读区分。

### 4.3 Spacing

刻度：`4 / 8 / 12 / 16 / 24 / 32`（对应 Tailwind `1 / 2 / 3 / 4 / 6 / 8`）。

| 场景 | 建议 |
|------|------|
| 控件内边距 | 遵循 shadcn Button/Input 默认 |
| 面板头高度 | 约 `h-12`（48px） |
| 区块间距 | `16`～`24`；首页避免 `space-y-16` 级空洞 |
| 页面垂直 padding | 内容页 `24`～`32`；勿默认 `py-16` |

### 4.4 Radius & Shadow

| Token | 约定 |
|-------|------|
| Radius | 统一约 `8px`（`rounded-lg`）；小控件可用略小；**禁止**主按钮 `rounded-full` |
| Shadow | 最多一级 soft；面板优先 `border`，不堆多层阴影 |

### 4.5 Layout 三套宽度

| 场景 | 宽度 | 说明 |
|------|------|------|
| Auth | `max-w-md` 居中 | 登录 |
| App Content | `max-w-2xl`～`max-w-3xl` | 首页 Composer + 项目列表 |
| Workbench | **全宽** | 去掉工作台内容区 `max-w-page`；顶栏可全宽 |

---

## 5. 组件交互规范

所有交互反馈优先使用 shadcn 已有状态，不自造动画体系。

| 状态 | 要求 |
|------|------|
| Hover | Button / 可点击行有可见反馈（shadcn 默认即可） |
| Focus | `focus-visible` ring 使用 `--ring`；键盘可达 |
| Disabled | `disabled` + 降低透明度；提交中禁止重复点击 |
| Loading | Button 文案切换或 Skeleton；禁止复杂 spinner CSS |
| Empty | `EmptyState`：标题 + 一句说明 + 可选主操作 |
| Error | 文案明确、靠近出错控件；可用 destructive 弱底，勿大红全屏 |

微动效：过渡 ≤ `150ms`；**禁止**复杂炫技、粒子、大范围弹簧动画。

---

## 6. AI / Developer 产品 UI 模式

后端未接入时，**结构仍按下列状态机预留**，避免以后推翻布局。

### 6.1 Prompt Composer

**出现位置：** 首页发起区；工作台左栏底栏。

**结构：**

1. Textarea（需求 / 消息）
2. 次要控件行（模式 Tabs 等）
3. 主按钮（开始 / 发送）

**状态：** `idle` · `submitting` · `disabled`

**视觉：** 表面 + 细边框（Card 或等价）；**不要**大营销卡片（过大 padding、过重阴影、居中口号压过输入本身）。

### 6.2 Agent 运行状态

用 `StatusBadge`（基于 Badge）展示：

| Status | 含义 |
|--------|------|
| `Idle` | 空闲 |
| `Thinking` | 推理 / 准备 |
| `Running` | 执行中 |
| `Streaming` | 流式输出中 |
| `Done` | 完成 |
| `Error` | 失败 |

颜色映射：muted / foreground / warning / success / destructive —— **不用霓虹色**。

### 6.3 消息时间线

消息类型：

| Type | 展示要点 |
|------|----------|
| User | 右对齐或弱区分背景；Body |
| Agent | **角色名 + 身份标签**（如 `Alex \| 工程师`）；Badge + Body |
| System | Secondary / Metadata 语气 |
| Tool | 见 6.4 |
| Version | 版本号 + 一句话摘要（卡片感弱边框即可） |

避免彩色气泡墙；靠对齐、字重、极弱背景区分即可。

### 6.4 Tool execution

- 默认一行：`toolName` + status Badge + 可选耗时（Metadata）
- 详情（参数 / 结果）默认折叠
- 展开用简单 disclosure；长内容用 ScrollArea 或 Dialog
- 禁止每个 tool 都用闪亮动画刷屏

### 6.5 Streaming

- 输出中：文本追加；末尾可用轻量光标或一行 Skeleton
- 完成：指示消失，保留最终文本
- **禁止**打字机音效式炫技、彩虹渐变文字

### 6.6 Trace / Token / Cost / Performance

- 层级：Metadata；默认折叠或放面板底部 / 次级抽屉
- 可展示：耗时、token、成本、trace id
- **不进**首页首屏，不进 Hero

### 6.7 App Viewer（Result）

| Status | UI |
|--------|-----|
| `Idle` | 空状态说明 |
| `Building` | 明确「构建中」+ Skeleton / Badge |
| `Ready` | iframe / 预览内容 |
| `Failed` | 错误说明 + 重试 Button；禁止静默失败 |

顶栏（ViewerChrome）：标题「App Viewer」+ 状态 Badge + 可选刷新。

---

## 7. 页面级指引

### 7.1 登录 `/login`

- 窄栏居中 + Card 包裹表单
- 品牌：Page Title 级「Isotope」或「欢迎回来」；**去掉**过重 `uppercase tracking` 营销 eyebrow
- 全表单 shadcn：Label、Input、Button
- 保留错误态（靠近表单）

### 7.2 首页 `/`

- **主任务：** Composer（需求 + Engineer/Team + 开始）
- **次要：** 「我的项目」Section + 列表或 EmptyState
- 宽度：`max-w-2xl`～`max-w-3xl`
- 降低大留白；模式切换旁可有一句 Secondary 说明差异（可选）
- 「开始」在实现阶段应处理空输入与 submitting 态（规范要求；本轮不实现）

### 7.3 工作台 `/projects/[id]`

- **全宽**双栏（≥1280px）：左对话、右 App Viewer
- 左：PanelHeader（对话 + Agent 状态）→ 消息区 → Composer
- 右：ViewerChrome → 预览区
- 项目上下文：可读项目名 / id（Metadata），非裸字符串堆砌
- 窄屏：上下堆叠或聊天可收起；保证不横向撑破

### 7.4 App Header

- 产品名 + 用户上下文 + 退出
- 实现阶段可加：当前模式、构建状态等轻量信息；避免变成营销导航

---

## 8. Responsive

| 断点 | 要求 |
|------|------|
| Desktop ≥1280px | 工作台双栏完整体验 |
| Tablet | 可上下堆叠或抽屉式聊天 |
| Mobile | 布局不崩；优先 Composer ↔ Viewer 可切换，不追求完整 IDE |

Desktop 优先设计；Mobile 以「可用、不坏」为底线。

---

## 9. 信息架构要点

1. 首页：创建（主）与项目列表（次）权重分离。
2. 工作台：对话流是主叙事；Tool / Trace 为可折叠附属信息。
3. Viewer 有独立状态机，不与聊天状态混写在同一文案块。
4. 跨页：品牌回首页；项目页上下文清晰。

---

## 10. 实现优先级（供后续 plan 使用；本轮不执行）

| 优先级 | 项 | 说明 |
|--------|----|------|
| P0 | Token 换肤为 Neutral Tool | 改 `globals.css` / tailwind 映射；去掉偏紫 primary |
| P0 | 文档约束落地到页面壳 | 登录 / 首页 / 工作台按第 7 节调整结构与密度 |
| P0 | EmptyState + PanelHeader + Composer | 消除复制粘贴与 Demo 文案堆砌 |
| P1 | Badge / Skeleton 等 shadcn 补齐 | 支撑状态与 loading |
| P1 | Message / Tool / Viewer 组合件 + mock 态 | 无后端也可演示产品感 |
| P2 | Trace / Cost 折叠面板 | 次要信息 |

---

## 11. AI 输出检查清单

### 视觉

- [ ] 像真实商业工具产品，而非 Demo 占位页
- [ ] Neutral Tool：无紫粉渐变、无 glow、无糖果大圆角
- [ ] 字号层级清晰（Page / Section / Body / Meta）
- [ ] 边框弱、主色近黑、语义色克制

### 交互

- [ ] 可点击元素有 hover / focus
- [ ] 有 loading（提交中 / Skeleton）
- [ ] 有 empty / error，文案可执行

### 代码

- [ ] 只用 shadcn `components/ui` + 组合件
- [ ] 无 inline style、无硬编码色值、无新建皮肤 CSS
- [ ] 颜色 / 间距走 design token
- [ ] 方便后续接 Agent 状态机，而非推倒重来

### AI 产品专项

- [ ] Composer 结构统一
- [ ] Agent / Tool / Streaming / Viewer 状态可辨
- [ ] Trace / Cost 弱化且可折叠
- [ ] 无复杂炫技动画

---

## 12. 决策记录

| 决策 | 选择 |
|------|------|
| 交付形态 | 文档优先（方案 A）；本轮不改代码 |
| 视觉气质 | Neutral Tool（方案 1） |
| 组件库 | 锁定 shadcn/ui；禁止 AI 自写 CSS 皮肤 |
| Primary | 近黑 slate-900 系；废弃偏紫强调色作为 brand primary |
| 工作台宽度 | 全宽双栏 |
| 参考站 | Linear / Vercel / Notion / Raycast / Stripe Dashboard |

---

## 13. 与现有文档关系

- 登录与壳层范围仍以 `docs/superpowers/specs/2026-07-18-web-login-shell-design.md` 为准（P0 功能边界）。
- 产品行为与验收以 `docs/PRD.md` 为准。
- **本文覆盖视觉与 UI 实现约束**；若与旧壳层「偏紫强调色」描述冲突，**以本文 Neutral Tool 为准**（实现换肤时更新）。
