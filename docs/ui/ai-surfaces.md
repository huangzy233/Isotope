# AI Surfaces

Isotope 作为 AI 产品的界面结构与状态机。  
后端未接入时，**结构仍按下列状态机预留**，避免以后推翻布局。

布局摆放见 [composition](./composition.md)；页面落位见 [page-blueprints](./page-blueprints.md)。

## 1. Prompt Composer

**出现位置：** 首页发起区；工作台左栏底栏。

**结构（固定三层）：**

1. Textarea（需求 / 消息）
2. 次要控件行（模式 Tabs 等）
3. 主按钮（开始 / 发送）

**状态：** `idle` · `submitting` · `disabled`

**视觉：** 表面 + 细边框；**不要**大营销卡片（过大 padding、过重阴影、居中口号压过输入）。

## 2. Agent 运行状态

用 `StatusBadge`（基于 Badge）展示：

| Status | 含义 |
|--------|------|
| `Idle` | 空闲 |
| `Thinking` | 推理 / 准备 |
| `Running` | 执行中 |
| `Streaming` | 流式输出中 |
| `Done` | 完成 |
| `Error` | 失败 |

颜色：muted / foreground / warning / success / destructive —— **不用霓虹色**。

## 3. 消息时间线

| Type | 展示要点 |
|------|----------|
| User | 右对齐或弱区分背景；Body |
| Agent | **角色名 + 身份标签**（如 `Alex \| 工程师`）；Badge + Body（GFM Markdown） |
| System | Secondary / Metadata 语气 |
| Tool | 见 §4 |
| Version | 版本号 + 一句话摘要（弱边框即可）；可从对话顶栏「版本」Dialog 浏览全部记录；「查看预览」仅当该版本对应**当前** App Viewer 产物时可点 |

避免彩色气泡墙；靠对齐、字重、极弱背景区分。

## 4. Tool execution

- 默认一行：`toolName` + status Badge + 可选耗时（Metadata）
- 详情（参数 / 结果）默认折叠
- 展开用简单 disclosure；长内容用 ScrollArea 或 Dialog
- 禁止每个 tool 都用闪亮动画刷屏

## 5. Streaming

- 输出中：文本追加；末尾可用轻量光标或一行 Skeleton
- 完成：指示消失，保留最终文本
- **禁止**打字机音效式炫技、彩虹渐变文字

## 6. Trace / Token / Cost / Performance

- 层级：Metadata；默认折叠或放面板底部 / 次级抽屉
- 可展示：耗时、token、成本、trace id
- **不进**首页首屏，不进 Hero

## 7. App Viewer（Result）

| Status | UI |
|--------|-----|
| `Idle` | 空状态说明 |
| `Building` | 明确「构建中」+ Skeleton / Badge |
| `Ready` | iframe / 预览内容 |
| `Failed` | 错误说明 + 重试 Button；禁止静默失败 |

顶栏（ViewerChrome）：标题「App Viewer」+ 状态 Badge + 可选刷新。

## 7.1 编辑器（只读）

左文件树 + 右只读内容；无独立文件 Tab。与 App Viewer 同属右栏 Tabs 切换。

## 8. 组合件清单

| 组合件 | 状态 | 职责 |
|--------|------|------|
| `EmptyState` | 已有 | 标题 + 说明 + 可选 CTA |
| `PanelHeader` | 已有 | 工作台栏头 |
| `Composer` | 已有 | Prompt / 消息输入 |
| `StatusBadge` | 已有 | 运行 / 构建状态 |
| `MessageItem` | P1 待建 | User / Agent / System / Tool / Version |
| `ToolCallRow` | P1 待建 | Tool 摘要 + 可折叠详情 |
| `ViewerChrome` | P1 待建 | App Viewer 顶栏 |

路径：`apps/web/components/*.tsx`；内部只组合 shadcn + token class。

## 9. 与 Blueprint 的关系

- Home / Workspace Blueprint **引用**本章，不在 blueprints 重复状态机表。
- 改状态枚举或组合件职责：只改本文。
- 改「左栏底是 Composer」：改 page-blueprints。
