# Design System

只答 **长什么样**。不描述「某页应有哪些模块」——那是 [page-blueprints](./page-blueprints.md)。

实现位置：`apps/web/app/globals.css` + `apps/web/tailwind.config.ts`  
组件：`apps/web/components/ui/*`（shadcn）

## 1. 技术硬约束

**锁定 shadcn/ui（Radix + Tailwind 语义 class）。AI 拼组件 + design token，不写 CSS 皮肤。**

| 允许 | 禁止 |
|------|------|
| `apps/web/components/ui/*` | 页面内大段自定义 CSS |
| 缺组件按 shadcn 流程补到 `components/ui` | `style={{}}`（极罕见动态值须注释理由） |
| 产品组合件放 `apps/web/components/*.tsx`，只拼 shadcn + token class | 新建 `.css` / `.module.css` 皮肤 |
| Tailwind **语义** class：`bg-background`、`text-muted-foreground`、`border-border` | 硬编码色：`#5B5BF7`、`bg-purple-500`、渐变 |
| `globals.css` **仅**维护 CSS 变量（tokens） | 组件内大量 `@apply`、炫技 keyframes |

## 2. Color（蓝主色工具 UI）

| Token | 用途 | 值 |
|-------|------|-----|
| `--background` | 页面底 | `#F8FAFC` |
| `--card` | 面板 / 卡片 | `#FFFFFF` |
| `--foreground` | 主文字 | `#0F172A` |
| `--muted` | 弱底 | `#F1F5F9` |
| `--muted-foreground` | 次要文字 | `#64748B` |
| `--border` / `--input` | 边框 | `#E2E8F0` |
| `--primary` | 主按钮 / 活跃态 | `#2563EB`（**蓝，非近黑 / 非紫**） |
| `--primary-foreground` | 主按钮文字 | `#FFFFFF` |
| `--accent` | 轻悬停底 | `#F1F5F9` |
| `--accent-foreground` | 悬停文字 | `#0F172A` |
| `--ring` | focus ring | `#2563EB`（与 primary 一致） |
| `--destructive` | 错误 / 危险 | 克制红 |
| `--success` | 成功 / 完成 | 克制绿 |
| `--warning` | 进行中 / 注意 | 克制琥珀 |

**规则：**

- Primary **不用于**全屏 Hero 大面积铺底、渐变、glow；登录等局部可用 `bg-primary/5` 作克制 tint
- 边框始终 subtle；分层靠留白与字重
- 状态色 + 文案；禁止霓虹色与多色图标墙
- 链接 / 选中态可用 `text-primary`；禁止紫粉装饰墙

## 3. Typography

单一 `font-sans`；禁止同页混用多种展示字体。

| 层级 | 用途 | 约定 |
|------|------|------|
| Page Title | 页面主标题 | `text-xl`～`text-2xl` · `font-semibold` · `tracking-tight` |
| Section Title | 区块标题 | `text-sm` · `font-semibold` |
| Panel / Card Title | 面板头 | `text-sm` · `font-medium` |
| Body | 正文、消息 | `text-sm` · `leading-relaxed` |
| Secondary | 说明、辅助 | `text-sm` · `text-muted-foreground` |
| Metadata | 时间、ID、token、耗时 | `text-xs` · `text-muted-foreground`；技术值可用 `font-mono` |

**规则：** 同屏字号层级 ≤ 4；工作台以 `sm` / `xs` 为主；避免营销向 `text-3xl` / `text-4xl`。

## 4. Spacing

刻度：`4 / 8 / 12 / 16 / 24 / 32`（Tailwind `1 / 2 / 3 / 4 / 6 / 8`）。

| 场景 | 建议 |
|------|------|
| 控件内边距 | 遵循 shadcn Button / Input 默认 |
| 面板头高度 | 约 `h-12`（48px） |
| 区块间距 | `16`～`24`；避免 `space-y-16` 级空洞 |
| 页面垂直 padding | 内容页 `24`～`32`；勿默认 `py-16` |

## 5. Radius / Shadow / Border

| Token | 约定 |
|-------|------|
| Radius | 约 `8px`（`rounded-lg`）；小控件可略小；**禁止**主按钮 `rounded-full` |
| Shadow | 最多一级 soft；面板优先 `border` |
| Border | 始终用 `--border`；勿粗深框堆层级 |

## 6. Motion

- 过渡 ≤ `150ms`
- 优先 shadcn 已有状态；禁止粒子、大范围弹簧、炫技 keyframes

## 7. Icon

- 与正文对齐的线型图标；尺寸跟随控件（约 16px）
- 禁止 emoji 墙、多彩图标矩阵当装饰
- 图标按钮须有 Tooltip 或可访问名称

## 8. Grid / Width presets

| Preset | 宽度 | 用途 |
|--------|------|------|
| Auth | `max-w-md` 居中 | 登录等窄表单 |
| App Content | `max-w-2xl`～`max-w-3xl` | 首页等内容页 |
| Workbench | **全宽** | 工作台；禁止内容区再套窄 `max-w-page` |

**警告：** 宽度系统 ≠ 页面蓝图。某页放什么模块见 [page-blueprints](./page-blueprints.md)。

## 9. CSS Variables 维护

- 只在 `globals.css` 改 token
- Tailwind 映射语义色到 CSS 变量
- 页面 / 组合件不新增皮肤文件

## 10. shadcn 与组合件约定

**已有原子（优先复用）：** Button、Input、Textarea、Label、Tabs、Card、Badge、Skeleton、Separator

**可按需补：** Dialog、DropdownMenu、ScrollArea、Tooltip、Table

**产品组合件**（路径 `apps/web/components/*.tsx`，交互见 [ai-surfaces](./ai-surfaces.md)）：

EmptyState、PanelHeader、Composer、StatusBadge、MessageItem、ToolCallRow、ViewerChrome

## 11. Tailwind 规范

- 只用语义 token class（`bg-background`、`text-muted-foreground`…）
- 禁止硬编码调色板色与任意渐变 utility 当品牌色

## 12. 禁止事项（汇总）

- 紫粉渐变、glow、主按钮 `rounded-full`
- inline style 皮肤、硬编码 hex、新建 module.css 皮肤
- 组件内炫技动画
- Primary 大面积铺底

## 13. 交互状态基线

| 状态 | 要求 |
|------|------|
| Hover | 可点击元素有可见反馈（shadcn 默认即可） |
| Focus | `focus-visible` + `--ring`；键盘可达 |
| Disabled | `disabled` + 降透明度；提交中禁重复点击 |
| Loading | Button 文案切换或 Skeleton；禁止复杂自造 spinner |
| Empty / Error | 见 composition / ai-surfaces；错误靠近控件，勿大红全屏 |
