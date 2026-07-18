# Assistant Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 助手消息结论正文按 GFM Markdown 渲染（表格、加粗、列表、代码块等），用户消息与思考过程仍为纯文本。

**Architecture:** 新增 `MarkdownBody`（`react-markdown` + `remark-gfm` + token class `components` map）；仅在 `MessageRow` 助手结论处替换纯文本 `<p>`。流式边收边渲染；不开启 raw HTML。

**Tech Stack:** TypeScript、Next.js、`react-markdown`、`remark-gfm`、现有 Tailwind token class；不引入 `@tailwindcss/typography`。

**Spec:** `docs/superpowers/specs/2026-07-18-assistant-markdown-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：`docs/ui/`；Neutral Tool + shadcn / token class only；禁止自写 CSS 皮肤 / 硬编码色 / 紫粉渐变。
- 范围：**仅**助手结论正文；用户气泡与 thinking 保持 `whitespace-pre-wrap` 纯文本。
- 不做：语法高亮、数学公式、raw HTML、用户/thinking Markdown、MessageItem 大重构、组件单测。
- 包边界：只改 `apps/web`（依赖 + 组件）；不碰 domain 包。
- **未经用户要求不要 git commit**（忽略下文 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `apps/web/package.json` | 新增 `react-markdown`、`remark-gfm` |
| `apps/web/components/markdown-body.tsx` | `MarkdownBody`：GFM → React + token 样式 |
| `apps/web/components/workbench-shell.tsx` | `MessageRow` 助手结论接入 `MarkdownBody` |
| `docs/ui/ai-surfaces.md` | 消息时间线补一句「助手 Body 支持 GFM」 |

**锁定：** 空 `content` 仍由 `MessageRow` 外层判断（有 content 才渲染 / 否则 Skeleton）；`MarkdownBody` 假定收到非空字符串。

---

### Task 1: 依赖 + `MarkdownBody` 组合件

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/components/markdown-body.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function MarkdownBody(props: {
    content: string;
    className?: string;
  }): React.ReactElement;
  ```

- [ ] **Step 1: 安装依赖**

在仓库根目录执行：

```bash
pnpm --filter @isotope/web add react-markdown remark-gfm
```

Expected: `apps/web/package.json` 的 `dependencies` 出现 `react-markdown` 与 `remark-gfm`；lockfile 更新。

- [ ] **Step 2: 创建 `MarkdownBody`**

创建 `apps/web/components/markdown-body.tsx`，完整内容：

```tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownBodyProps = {
  content: string;
  className?: string;
};

export function MarkdownBody({ content, className }: MarkdownBodyProps) {
  return (
    <div
      className={cn(
        "max-w-none space-y-3 text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="leading-relaxed [&:not(:first-child)]:mt-3">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          hr: () => <hr className="border-border" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 text-foreground"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isBlock = Boolean(codeClassName?.includes("language-"));
            if (isBlock) {
              return (
                <code className={cn("font-mono text-xs", codeClassName)} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border last:border-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1.5 font-medium text-foreground">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1.5 text-foreground">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

说明：

- 不传 `rehype-raw` / 不开启 raw HTML。
- 围栏代码块由 `pre > code.language-*` 组成；行内 code 走弱底样式。
- 表格外包 `overflow-x-auto`，避免撑破聊天气泡。

- [ ] **Step 3: typecheck 组件可解析**

```bash
pnpm --filter @isotope/web typecheck
```

Expected: PASS（若 `react-markdown` 类型与 React 19 冲突，以安装后实际错误为准：优先加兼容 import，不降级 React）。

- [ ] **Step 4: Commit（仅当用户明确要求时）**

```bash
git add apps/web/package.json apps/web/components/markdown-body.tsx pnpm-lock.yaml
git commit -m "feat(web): add MarkdownBody for GFM assistant content"
```

---

### Task 2: `MessageRow` 接入 + 文档一句

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`
- Modify: `docs/ui/ai-surfaces.md`

**Interfaces:**
- Consumes: `MarkdownBody` from `@/components/markdown-body`（Task 1）
- Produces: 助手结论正文经 Markdown 渲染；用户 / thinking 不变

- [ ] **Step 1: 增加 import**

在 `apps/web/components/workbench-shell.tsx` 顶部 import 区（与其他 `@/components/*` 并列）加入：

```tsx
import { MarkdownBody } from "@/components/markdown-body";
```

- [ ] **Step 2: 替换助手结论渲染**

在 `MessageRow` 助手分支中，将结论正文从：

```tsx
{message.content ? (
  <p className="whitespace-pre-wrap leading-relaxed text-foreground">
    {message.content}
  </p>
) : showContentSkeleton ? (
  <Skeleton className="h-4 w-2/3" />
) : null}
```

改为：

```tsx
{message.content ? (
  <MarkdownBody content={message.content} />
) : showContentSkeleton ? (
  <Skeleton className="h-4 w-2/3" />
) : null}
```

**禁止改动：**

- 用户分支的 `<p className="whitespace-pre-wrap ...">{message.content}</p>`
- thinking 的 `<p className="whitespace-pre-wrap text-sm ...">{phase.thinking}</p>`

- [ ] **Step 3: 更新 `ai-surfaces.md` 一句**

在 `docs/ui/ai-surfaces.md` §3「消息时间线」表格中，Agent 行「Badge + Body」改为「Badge + Body（GFM Markdown）」：

找到：

```markdown
| Agent | **角色名 + 身份标签**（如 `Alex \| 工程师`）；Badge + Body |
```

替换为：

```markdown
| Agent | **角色名 + 身份标签**（如 `Alex \| 工程师`）；Badge + Body（GFM Markdown） |
```

- [ ] **Step 4: typecheck**

```bash
pnpm --filter @isotope/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 手动验收（开发者）**

1. `pnpm --filter @isotope/web dev`（或仓库既有启动方式）。
2. 打开工作台，找一条含表格 / 加粗 / 列表 / 代码块的助手消息（或触发新一轮生成）。
3. 确认：表格有边框与对齐、`**文字**` 显示为加粗、列表有项目符号、代码块有弱底；用户消息与「已处理 N 步」内思考文仍为纯文本。

- [ ] **Step 6: Commit（仅当用户明确要求时）**

```bash
git add apps/web/components/workbench-shell.tsx docs/ui/ai-surfaces.md
git commit -m "feat(web): render assistant message body as Markdown"
```

---

## Spec Coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 仅助手结论 Markdown | Task 2 Step 2（用户/thinking 禁止改） |
| `react-markdown` + `remark-gfm` | Task 1 |
| `MarkdownBody` + components map | Task 1 Step 2 |
| 流式边收边渲染 | 自然满足（仍绑定 `message.content`） |
| 不开启 raw HTML | Task 1（无 rehype-raw） |
| 表格横向滚动、token 样式 | Task 1 `table` / `pre` / `code` |
| 链接 `target=_blank` + `rel` | Task 1 `a` |
| 空 content / Skeleton | Task 2 保留外层分支 |
| typecheck | Task 1 Step 3、Task 2 Step 4 |
| `ai-surfaces` 一句 | Task 2 Step 3 |
| 非目标（高亮、用户 MD 等） | Global Constraints |

无 placeholder；接口名 `MarkdownBody` / props `{ content, className? }` 前后一致。
