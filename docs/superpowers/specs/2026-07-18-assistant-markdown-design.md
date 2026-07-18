# 设计：助手消息 Markdown 渲染

- 日期：2026-07-18
- 状态：已落地（实现计划已执行：MarkdownBody + MessageRow 接入）
- 前置：工作台消息时间线已落地（`MessageRow` 纯文本 `whitespace-pre-wrap`）
- 范围：仅助手消息**结论正文**渲染 GFM Markdown；用户消息与思考过程仍为纯文本
- UI：遵循 `docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + token class；不引入 `@tailwindcss/typography`

## 1. 目标

Agent（如 Alex）回复中的 Markdown（加粗、列表、表格、代码块、`---` 等）在聊天区按格式展示，而不是原样露出 `**`、`|`、`-` 等符号。

## 2. 非目标

- 用户消息 Markdown
- 思考 / 过程文本（`process.steps` thinking）Markdown
- 语法高亮（Prism / Shiki）
- 数学公式、自定义 directive、raw HTML
- 流式与终态双路径渲染切换
- 组件单测（本切片无业务分支逻辑）

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 范围 | 仅助手消息正文（方案 A） |
| 实现 | `react-markdown` + `remark-gfm`（方案 A） |
| 流式 | 边收边渲染 Markdown；接受未闭合表格/代码块短暂变形 |
| 样式 | 组件 `components` map + 现有 token class；不引入 typography 插件 |
| 安全 | 不开启 raw HTML；链接新开页 + `rel="noopener noreferrer"` |

## 4. 成功标准

1. 助手正文含表格、加粗、列表、围栏代码块时正确排版。
2. 用户气泡与思考过程仍为纯文本（`whitespace-pre-wrap`）。
3. 空 `content` 时行为不变（Skeleton / 不渲染）。
4. `pnpm --filter @isotope/web typecheck` 通过。
5. 包边界不变：仅改 `apps/web`（依赖 + 组件）。

## 5. 架构

### 5.1 新组合件

`apps/web/components/markdown-body.tsx` — `MarkdownBody`

- Props：`content: string`；可选 `className`
- 内部：`react-markdown` + `remark-gfm`
- 通过 `components` 覆盖：`p`、`ul`/`ol`/`li`、`strong`/`em`、`code`/`pre`、`table`/`thead`/`tbody`/`tr`/`th`/`td`、`a`、`blockquote`、`hr`
- 样式要点：
  - 与 Body 一致：`text-sm`、`leading-relaxed`
  - 代码块：`bg-muted` + mono；行内 `code` 弱底
  - 表格：细边框、紧凑行高；外层横向可滚动，避免撑破气泡
  - 链接：underline + foreground

### 5.2 接入点

`apps/web/components/workbench-shell.tsx` — `MessageRow` 助手分支：

- 将结论正文的 `<p className="whitespace-pre-wrap ...">{message.content}</p>` 替换为 `<MarkdownBody content={message.content} />`
- 用户分支与 thinking 段落不改

### 5.3 依赖

`@isotope/web`（`apps/web/package.json`）新增：

- `react-markdown`
- `remark-gfm`

## 6. 错误与边界

| 情况 | 行为 |
|------|------|
| `content` 为空 | 不渲染（沿用现有 Skeleton / 空逻辑） |
| 畸形 / 未闭合 Markdown | 库降级为文本；不额外 try/catch |
| raw HTML 片段 | 不执行（库默认） |

## 7. 测试与验收

- 手动：用含表格 + 列表 + 加粗 + 代码块的助手消息目视确认；确认用户消息与思考过程无 Markdown 渲染。
- `pnpm --filter @isotope/web typecheck`
- 不做组件单测。

## 8. 非目标回顾（实现时勿扩散）

不要顺手：给用户气泡加 Markdown、给 thinking 加 Markdown、加语法高亮、抽 MessageItem 大重构、改 `docs/ui` 大段文案（可在落地后于 `ai-surfaces.md` 补一句「助手 Body 支持 GFM」——若实现计划需要再写）。
