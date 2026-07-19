# 设计：首页 + 工作台视觉对齐（诚实能力）

- 日期：2026-07-19
- 状态：待用户审阅
- 范围：在已落地的蓝主色 `#2563EB` 之上，按图例气质对齐首页与工作台 UI；仅使用已实现能力
- 前置决策：范围 A（视觉对齐）+ 假入口策略 A（一律不做）+ 落地方案 1（视觉对齐为主）
- 相关：`docs/superpowers/specs/2026-07-19-blue-primary-login-ui-design.md`（登录已交付）

## 1. 目标

1. 首页主区更接近图例：更大标题、更突出的 Composer、快捷开始 chips（仅预填文案）。
2. 工作台更接近图例：对话过程步观感、Composer 底栏、预览顶栏与侧栏活跃态统一到蓝主色工具 UI。
3. 文案与控件诚实：不出现未实现能力的可点入口。

## 2. 非目标

- 用户侧模型选择器（GPT-4o 等）
- Desktop / Tablet / Mobile 视口切换、Zoom、Open in New Tab
- 版本 Restore / 回滚
- 多脚手架模板（CRM / 知识库等不同工程模板）
- 主区「最近修改」缩略图网格（与现 Blueprint「项目只在侧栏」冲突；本轮不改信息架构）
- 不可交互的假 checkbox 任务板
- 附件上传、开放注册、假「即将推出」禁用控件墙
- 改鉴权、Agent 编排、预览构建后端

## 3. 首页

### 3.1 布局

```text
┌──────────┬────────────────────────────────────┐
│ 侧栏项目  │  从一句话开始构建（更大标题）         │
│ （保留）  │  副文案一句                         │
│          │  ┌─ Composer（加高输入区）─────────┐ │
│          │  │ chips + 输入                     │ │
│          │  │ + / Plan·Team   [开始]（primary）│ │
│          │  └────────────────────────────────┘ │
│          │  快捷开始                           │
│          │  [待办清单] [登录页] [数据看板]      │
└──────────┴────────────────────────────────────┘
```

### 3.2 视觉与文案

| 元素 | 约定 |
|------|------|
| 标题 | 「从一句话开始构建」；约 `text-2xl`～`text-3xl` · `font-semibold` · `tracking-tight` |
| 副文案 | 保持现有：「选择模式，描述需求，进入工作台继续迭代」 |
| Composer | 输入区 `min-h` 高于现状；卡片 `rounded-lg` + `border-border`；主按钮 `bg-primary` |
| 快捷开始标题 | 「快捷开始」· Section Title（`text-sm font-semibold`） |
| 垂直节奏 | 区块间距 16～24；略增标题区留白，仍非营销落地页 |

### 3.3 快捷开始 chips（定稿）

点击 = **仅** `setRequirement(预填文案)`，可再编辑；创建仍走现有 `POST /api/projects` + 唯一 `vite-react` 脚手架。

| Chip 标签 | 预填文案 |
|-----------|----------|
| 待办清单 | 做一个待办清单，支持分组与截止时间 |
| 登录页 | 做一个简洁的登录页，含邮箱密码与主按钮 |
| 数据看板 | 做一个简单数据看板，含指标卡与图表占位 |

实现：静态常量数组 + `Button variant="outline"` 或等价 chip；禁止暗示「不同产品模板」。

### 3.4 文件

- 主要：`apps/web/components/home-shell.tsx`
- 共用：`apps/web/components/composer.tsx`（加高 / 底栏密度，供首页与工作台共用时一并微调）
- 文档：`docs/ui/page-blueprints.md` Home 节补充「快捷开始可选；项目仍只在侧栏」

## 4. 工作台

### 4.1 对话过程步

- 保留现有「已处理 N 步」折叠 + 时间线数据模型（`groupProcessPhases` / `ToolCallRow`）
- 视觉：左侧步骤指示更清晰；已完成步可用 `text-success` / 勾选图标暗示完成；进行中用 `text-muted-foreground` 或 `warning`
- **不**改为可勾选任务清单；不新增虚假 step 状态

### 4.2 Composer（工作台）

- 底栏：左 `ComposerModeMenu`（`+`）+ `ComposerModeChips`；右主按钮「发送」（primary 蓝）
- 与首页共用 Composer 密度约定；不改提交 / SSE 逻辑
- 不做模型下拉、附件 `+`

### 4.3 预览顶栏

- 保留：Tabs「应用查看器 / 编辑器」、StatusBadge、刷新、沉浸
- 统一 `PanelHeader` / 工具按钮高度与间距；活跃 Tab 用 primary 指示（语义 class）
- 不做设备切换、Zoom、新标签（沉浸继续承担放大预览）

### 4.4 版本 UI

- `version-history-dialog.tsx` / `version-card.tsx`：边框、按钮、强调色统一到 primary / 语义 token
- 仅保留「查看预览」；不加 Restore
- 去掉或替换任何硬编码紫蓝装饰色（若仍存在）为 token

### 4.5 侧栏

- 活跃项目：`bg-primary/5` 或左边 `border-primary` 指示 + `font-medium`
- 折叠 / 删除 / 退出交互不变
- 不加假搜索框（现网无搜索则本轮不加）

### 4.6 文件

- `apps/web/components/workbench-shell.tsx`（过程步 + 预览顶栏样式）
- `apps/web/components/composer.tsx`（共用）
- `apps/web/components/app-sidebar.tsx`（活跃态）
- `apps/web/components/version-history-dialog.tsx`、`version-card.tsx`（token 对齐）
- `apps/web/components/tool-call-row.tsx`（若过程步指示需要）
- 文档：`docs/ui/page-blueprints.md` Workspace 节；必要时 `docs/ui/ai-surfaces.md` 过程步视觉一句

## 5. Design token / 约束继承

- Primary / ring 已为 `#2563EB`（HSL `221 83% 53%`）；本轮不改 token 表
- 继续禁止：紫粉渐变、glow、主按钮 `rounded-full`、页面硬编码 hex、假能力入口
- 语义 class only：`bg-primary`、`text-primary`、`bg-primary/5` 等

## 6. 验收标准

1. 首页：标题层级放大；Composer 更突出；三个快捷 chip 预填对应文案且仍可编辑后创建项目
2. 首页主区无项目缩略图网格；无假多模板文案
3. 工作台：过程步视觉更清单化但仍为只读时间线；Composer 底栏与蓝发送对齐图例气质
4. 预览顶栏无设备/Zoom/新标签控件；沉浸仍可用
5. 版本 UI 无 Restore；无模型选择器
6. 侧栏活跃项目有 primary 指示
7. `page-blueprints.md` 已与上述约定同步
8. 首页创建项目、工作台发消息、预览切换/沉浸冒烟通过

## 7. 实现顺序（供后续 plan）

1. Composer 共用密度 + 首页快捷开始 + Home blueprint
2. 侧栏活跃态 + 工作台过程步 / 预览顶栏 / 版本 token 对齐 + Workspace blueprint
3. 目视与冒烟验收
