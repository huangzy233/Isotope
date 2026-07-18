# Agent Process Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台回合中可见思考过程 / 工具行 / 结论三层；SSE 推送 status/thinking/tool；过程落库刷新可见；不进 LLM 短期记忆。

**Architecture:** `runTurn` 按轮缓冲 `content_delta`，有 tool → thinking + tool 事件，无 tool → 结论 `token`；`beginEngineerTurn` 转发事件并落库 `Message.content` + `Message.process`；history 只取 `content`；web 消费事件并渲染 `ToolCallRow` + StatusBadge。

**Tech Stack:** TypeScript、pnpm workspace、vitest、Next.js SSE、现有 shadcn Badge / Composer / StatusBadge；disclosure 用原生 `<details>`（不新增 collapsible 包）。

**Spec:** `docs/superpowers/specs/2026-07-18-agent-process-visibility-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：`docs/ui/`（README → design-principles → ai-surfaces）；Neutral Tool + shadcn only；禁止自写 CSS 皮肤 / 硬编码色。
- 依赖：`web → application → agent-runtime → agents|llm`；`application → workspace|preview`；Agent 不直接碰 `data/**`。
- `process` **禁止**进入 `runTurn` history；只传 `content`。
- 工具 summary 从 args 解析短字段，禁止再调 LLM 压缩；不落库完整文件内容。
- 不做：完整 Trace/Token 面板、MessageItem 大拆、ViewerChrome 重构、Mike/Team、reasoning API。
- **未经用户要求不要 git commit**（忽略下文 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/workspace/src/domain/types.ts` | `MessageProcessStep` / `MessageProcess` / `Message.process` |
| `packages/workspace/src/infra/db.ts` | `process_json` 列迁移 |
| `packages/workspace/src/app/workspace-store.ts` | append/update/list 读写 process |
| `packages/workspace/src/app/workspace-store.test.ts` | process 持久化测 |
| `packages/workspace/src/index.ts` | 导出新类型 |
| `packages/agent-runtime/src/domain/types.ts` | 回调与 `RunTurnResult.process` |
| `packages/agent-runtime/src/app/tool-summary.ts` | 从 args 取 path/dir |
| `packages/agent-runtime/src/app/run-turn.ts` | 缓冲区分 thinking/结论；发 tool/status |
| `packages/agent-runtime/src/app/run-turn.test.ts` | 过程回调与 process 断言 |
| `packages/application/src/projects/stream-engineer-turn.ts` | 事件扩展 + 落库 process |
| `packages/application/src/projects/stream-engineer-turn.test.ts` | 新事件 / process / history |
| `apps/web/app/api/projects/[id]/messages/stream/route.ts` | SSE 转发 |
| `apps/web/components/tool-call-row.tsx` | 最小 ToolCallRow |
| `apps/web/components/workbench-shell.tsx` | 消费事件；三层渲染；StatusBadge |
| `prompts/coding/alex-system.v1.md` | 可选：鼓励工具前一句中文说明 |

**锁定：** 单轮 LLM stream 结束前缓冲正文（因 `tool_calls` 在 provider 末尾才 yield）；flush 后才区分 thinking vs token。工具执行间隙靠 `tool` + `status: running` 可见。

---

### Task 1: Workspace `Message.process` 持久化

**Files:**
- Modify: `packages/workspace/src/domain/types.ts`
- Modify: `packages/workspace/src/infra/db.ts`
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/app/workspace-store.test.ts`
- Modify: `packages/workspace/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MessageProcessStep =
    | { type: "thinking"; text: string }
    | {
        type: "tool";
        id: string;
        name: string;
        status: "running" | "done" | "error";
        summary?: string;
      };
  export type MessageProcess = { steps: MessageProcessStep[] };
  // Message.process?: MessageProcess
  // appendMessage(..., process?: MessageProcess)
  // updateMessage(id, { content?: string; process?: MessageProcess | null })
  ```

- [ ] **Step 1: 写失败测试**

在 `workspace-store.test.ts` 追加：

```ts
it("appendMessage and updateMessage persist process", () => {
  const p = store.createProject({
    ownerUserId: "demo",
    name: "x",
    mode: "engineer",
  });
  const msg = store.appendMessage({
    projectId: p.id,
    role: "assistant",
    content: "结论",
    agentName: "Alex",
    process: {
      steps: [
        { type: "thinking", text: "先看文件" },
        {
          type: "tool",
          id: "c1",
          name: "read_file",
          status: "done",
          summary: "src/App.tsx",
        },
      ],
    },
  });
  expect(store.listMessages(p.id)[0]?.process?.steps).toEqual(msg.process?.steps);

  const updated = store.updateMessage(msg.id, {
    content: "新结论",
    process: {
      steps: [{ type: "thinking", text: "改完了" }],
    },
  });
  expect(updated?.content).toBe("新结论");
  expect(updated?.process?.steps).toEqual([
    { type: "thinking", text: "改完了" },
  ]);
  expect(store.listMessages(p.id)[0]?.process?.steps[0]).toEqual({
    type: "thinking",
    text: "改完了",
  });
});

it("messages without process_json list without process", () => {
  const p = store.createProject({
    ownerUserId: "demo",
    name: "y",
    mode: "engineer",
  });
  store.appendMessage({
    projectId: p.id,
    role: "user",
    content: "hi",
  });
  expect(store.listMessages(p.id)[0]?.process).toBeUndefined();
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/workspace test`

Expected: FAIL（`process` / 类型不存在）

- [ ] **Step 3: 实现类型 + DB + store**

`types.ts` 增加 `MessageProcessStep`、`MessageProcess`，`Message` 增加可选 `process?`。

`db.ts` 在 `database.exec` 建表后追加迁移：

```ts
const cols = database
  .prepare(`PRAGMA table_info(messages)`)
  .all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === "process_json")) {
  database.exec(`ALTER TABLE messages ADD COLUMN process_json TEXT`);
}
```

`workspace-store.ts`：

- `MessageRow` 加 `process_json: string | null`
- `toMessage`：若 `process_json` 非空则 `JSON.parse` 为 `process`（parse 失败则省略）
- `appendMessage`：接受可选 `process`；INSERT 含 `process_json`（`process ? JSON.stringify(process) : null`）
- `updateMessage`：`patch: { content?: string; process?: MessageProcess | null }`；至少更新提供的字段；SELECT/UPDATE 含 `process_json`
- `listMessages` SELECT 含 `process_json`
- `WorkspaceStore` 接口签名同步

`index.ts` 导出 `MessageProcessStep`、`MessageProcess`。

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/workspace test`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add packages/workspace
git commit -m "$(cat <<'EOF'
feat(workspace): persist optional message process JSON

EOF
)"
```

---

### Task 2: `runTurn` 过程回调与 `process` 结果

**Files:**
- Modify: `packages/agent-runtime/src/domain/types.ts`
- Create: `packages/agent-runtime/src/app/tool-summary.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.test.ts`

**Interfaces:**
- Consumes: 现有 `LlmClient` / `CoderAgent` / `WorkspaceToolPort`
- Produces:
  ```ts
  type TurnPhase = "thinking" | "running" | "streaming";
  type ToolEvent = {
    id: string;
    name: string;
    state: "start" | "end";
    summary?: string;
    ok?: boolean; // end 时
  };
  // RunTurnInput 增加可选:
  //   onThinking?: (text: string) => void;
  //   onTool?: (ev: ToolEvent) => void;
  //   onStatus?: (phase: TurnPhase) => void;
  // RunTurnResult 增加: process: MessageProcess
  // （MessageProcess 从 @isotope/workspace 导入，或在 runtime 定义同构类型后由 application 映射——优先直接依赖 workspace 类型若已有依赖；若 agent-runtime 尚未依赖 workspace，在 runtime domain 内定义同构 Process 类型，application 写入时兼容。）
  ```

**依赖检查：** 若 `agent-runtime` 未依赖 `@isotope/workspace`，**不要**为类型新增依赖；在 `domain/types.ts` 定义同构：

```ts
export type TurnProcessStep =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error";
      summary?: string;
    };
export type TurnProcess = { steps: TurnProcessStep[] };
```

- [ ] **Step 1: 写失败测试**

扩展 `run-turn.test.ts`：保留原测（结论仍只含终轮文案）；新增：

```ts
it("routes pre-tool content to thinking and emits tool events", async () => {
  const files = new Map<string, string>([["src/App.tsx", "old"]]);
  const port = {
    listFiles: () => [...files.keys()],
    readFile: (p: string) => files.get(p) ?? "",
    writeFile: (p: string, c: string) => {
      files.set(p, c);
    },
  };
  const agent = createCoderAgent({ systemPrompt: "test" });
  const tokens: string[] = [];
  const thinking: string[] = [];
  const tools: Array<{ name: string; state: string; summary?: string }> = [];
  const phases: string[] = [];

  const result = await runTurn({
    llm: llmFromScript([
      [
        { type: "content_delta", text: "我先读一下" },
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "src/App.tsx" }),
              },
            },
          ],
        },
        { type: "finished", finishReason: "tool_calls" },
      ],
      [
        { type: "content_delta", text: "读完了" },
        { type: "finished", finishReason: "stop" },
      ],
    ]),
    agent,
    port,
    history: [{ role: "user", content: "看看 App" }],
    maxToolRounds: 8,
    onToken: (t) => tokens.push(t),
    onThinking: (t) => thinking.push(t),
    onTool: (ev) =>
      tools.push({ name: ev.name, state: ev.state, summary: ev.summary }),
    onStatus: (p) => phases.push(p),
  });

  expect(thinking.join("")).toBe("我先读一下");
  expect(tokens.join("")).toBe("读完了");
  expect(result.assistantText).toBe("读完了");
  expect(result.assistantText).not.toContain("我先读一下");
  expect(tools).toEqual([
    { name: "read_file", state: "start", summary: "src/App.tsx" },
    { name: "read_file", state: "end", summary: "src/App.tsx" },
  ]);
  expect(result.process.steps).toEqual([
    { type: "thinking", text: "我先读一下" },
    {
      type: "tool",
      id: "c1",
      name: "read_file",
      status: "done",
      summary: "src/App.tsx",
    },
  ]);
  expect(phases[0]).toBe("thinking");
  expect(phases).toContain("running");
  expect(phases).toContain("streaming");
});
```

另加一小测：`write_file` / `list_files` 的 summary（path / `.` 或 relativeDir）。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: FAIL

- [ ] **Step 3: 实现 `tool-summary.ts` + 改写 `run-turn.ts`**

`tool-summary.ts`：

```ts
export function toolSummary(
  name: string,
  argsJson: string,
): string | undefined {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    if (name === "list_files") {
      return typeof args.relativeDir === "string" && args.relativeDir.length > 0
        ? args.relativeDir
        : ".";
    }
    if (name === "read_file" || name === "write_file") {
      return typeof args.path === "string" ? args.path : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
```

`run-turn.ts` 核心逻辑（替换现有立即 `onToken`）：

1. `onStatus?.("thinking")` 开局。
2. 每轮：`roundChunks: string[] = []`，`hadToolCalls = false`。
3. `content_delta` → 只 `roundChunks.push`，**不**立刻 `onToken`。
4. 收到 `tool_calls`：
   - `hadToolCalls = true`
   - 将 `roundChunks.join("")` 若非空：`onThinking` 分块或一次；merge 进 `process.steps`（连续 thinking 合并到最后一步）
   - `onStatus?.("running")`
   - 对每个 call：`summary = toolSummary(...)`；`onTool start`；push/update process tool step `running`；`executeTool`；`onTool end`；status `done`|`error`；`write_file` 成功则 `filesChanged`
   - assistant 消息仍按现逻辑 push tool results
5. 轮结束且 `!hadToolCalls`：
   - `onStatus?.("streaming")`
   - 对每个 chunk：`onToken` + 累加 `assistantText`
   - `return { assistantText, filesChanged, process }`
6. `maxToolRounds` 耗尽：按 spec §6.3——有结论则追加上限说明；无结论有 thinking 则结论=`（已达工具轮次上限）`；皆无则 throw。

更新 `domain/types.ts` 中 `RunTurnInput` / `RunTurnResult`。`onToken` 保持必填（结论通道）。

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: PASS（含原「write 后终轮 token」测：中间无 thinking 文案时 thinking 为空、token 仅为终轮）

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 3: Application 转发事件并落库 `process`

**Files:**
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.test.ts`

**Interfaces:**
- Consumes: `runTurn` 新回调与 `result.process`
- Produces:
  ```ts
  export type EngineerTurnEvent =
    | { type: "status"; phase: "thinking" | "running" | "streaming" }
    | { type: "thinking"; text: string }
    | {
        type: "tool";
        id: string;
        name: string;
        state: "start" | "end";
        summary?: string;
      }
    | { type: "token"; text: string }
    | { type: "done"; messageId: string; filesChanged: boolean; previewEnqueued: boolean }
    | { type: "error"; message: string };
  ```

- [ ] **Step 1: 写/改测试**

在现有 continue 测中断言：

```ts
expect(events.some((e) => e.type === "status" && e.phase === "thinking")).toBe(
  true,
);
expect(
  events.some(
    (e) =>
      e.type === "tool" &&
      e.name === "write_file" &&
      e.state === "start" &&
      e.summary === "src/App.tsx",
  ),
).toBe(true);
expect(last?.process?.steps.some((s) => s.type === "tool")).toBe(true);
expect(last?.content).toBe("已更新 App");
```

新增测：`history` 组装不读 process——构造一条带巨大 `process.thinking` 的旧助手消息，下一 `send` 的 mock llm `complete` 捕获 `messages`，断言无 thinking 长文（仅 `content`）。实现方式：在 `llmFromScript` 外包一层记录最后一次 `input.messages`。

```ts
it("does not put process text into llm history", async () => {
  // seed project, replace placeholder with assistant that has process + short content
  // send new user message
  // capture llm complete() messages
  // expect no message content includes the thinking long string
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/application test`

Expected: FAIL on new assertions

- [ ] **Step 3: 实现 `stream-engineer-turn.ts`**

在 `runTurn({...})`：

```ts
const result = await runTurn({
  llm: deps.llm,
  agent: deps.agent,
  port,
  history, // 仍只 map content
  maxToolRounds: deps.maxToolRounds,
  onToken: (text) => emit({ type: "token", text }),
  onThinking: (text) => emit({ type: "thinking", text }),
  onTool: (ev) =>
    emit({
      type: "tool",
      id: ev.id,
      name: ev.name,
      state: ev.state,
      summary: ev.summary,
    }),
  onStatus: (phase) => emit({ type: "status", phase }),
});
```

落库：

```ts
if (replaceId) {
  messageId = deps.workspace.updateMessage(replaceId, {
    content: text,
    process: result.process,
  })!.id;
} else {
  messageId = deps.workspace.appendMessage({
    projectId: input.projectId,
    role: "assistant",
    content: text,
    agentName: "Alex",
    process: result.process,
  }).id;
}
```

`catch`：失败文案写入 content；`process` 若无法取得可省略（允许）。

确认 `history` 映射仍为：

```ts
.map((m) => ({
  role: m.role as "user" | "assistant",
  content: m.content,
}))
```

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/application test`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 4: SSE 路由转发新事件

**Files:**
- Modify: `apps/web/app/api/projects/[id]/messages/stream/route.ts`

**Interfaces:**
- Consumes: 扩展后的 `EngineerTurnEvent`
- Produces: SSE `event: status|thinking|tool|token|done|error`

- [ ] **Step 1: 扩展 `send` 分支**

将：

```ts
await begun.run((ev) => {
  if (ev.type === "token") send("token", { text: ev.text });
  else if (ev.type === "done") {
    send("done", {
      messageId: ev.messageId,
      filesChanged: ev.filesChanged,
      previewEnqueued: ev.previewEnqueued,
    });
  } else send("error", { message: ev.message });
});
```

改为按 `ev.type` 穷尽转发（`status` / `thinking` / `tool` / `token` / `done` / `error`）。`tool` data：`{ id, name, state, summary? }`。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @isotope/web exec tsc --noEmit`（或仓库惯用 web typecheck 命令）

Expected: PASS（若 web 包脚本不同，用 `apps/web` 现有 `typecheck` / `lint`）

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 5: Workbench UI — ToolCallRow + 三层消息 + StatusBadge

**Files:**
- Create: `apps/web/components/tool-call-row.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`
- Optional: `prompts/coding/alex-system.v1.md`

**Interfaces:**
- Consumes: SSE 新事件；`Message.process`
- Produces: 对话栏可见思考 / 工具 / 结论；栏头 StatusBadge 跟 phase

- [ ] **Step 1: 新增 `ToolCallRow`**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";

const LABEL: Record<string, string> = {
  running: "进行中",
  done: "完成",
  error: "失败",
};

export function ToolCallRow({
  name,
  summary,
  status,
}: {
  name: string;
  summary?: string;
  status: "running" | "done" | "error";
}) {
  const title = summary ? `${name} ${summary}` : name;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
      <span className="truncate font-medium text-foreground">{title}</span>
      <Badge
        variant={
          status === "error"
            ? "destructive"
            : status === "running"
              ? "warning"
              : "secondary"
        }
      >
        {LABEL[status]}
      </Badge>
    </div>
  );
}
```

（若 `Badge` 无 `warning` variant，改用与 `StatusBadge` 一致的现有 variant。）

- [ ] **Step 2: 扩展 `consumeEngineerStream` handlers**

```ts
type StreamHandlers = {
  onStatus?: (phase: "thinking" | "running" | "streaming") => void;
  onThinking?: (text: string) => void;
  onTool?: (ev: {
    id: string;
    name: string;
    state: "start" | "end";
    summary?: string;
  }) => void;
  onToken: (text: string) => void;
  onDone: (...) => void;
  onError: (message: string) => void;
};
```

解析分支增加 `status` / `thinking` / `tool`。

- [ ] **Step 3: Workbench 状态与消息更新**

- `const [agentStatus, setAgentStatus] = useState<...>("idle")`
- PanelHeader：`trailing={<StatusBadge status={agentStatus} />}`（map：`thinking`→`thinking`，`running`→`running`，`streaming`→`streaming`，结束→`idle`）
- 助手消息本地可带 `process`（与 `Message` 对齐）
- `onThinking`：更新末条 assistant 的 `process.steps`（合并连续 thinking）
- `onTool`：start 追加 tool step `running`；end 将同 `id` 标为 `done`（失败时 `error`——若 SSE 未带 ok，默认 `done`）
- `onToken`：只追加 `content`（结论）
- `onDone` / `onError`：`setAgentStatus("idle")`；`setSubmitting(false)`

`continue` 与 `send` 两处 handlers 都接上。

- [ ] **Step 4: 改 `MessageRow` 三层渲染**

对非 user：

```tsx
{/* 思考：有 thinking steps 时 */}
<details className="mb-2">
  <summary className="cursor-pointer text-xs text-muted-foreground">
    已处理 {stepCount} 步
  </summary>
  <div className="mt-1 space-y-1 border-l border-dashed border-border pl-3 text-xs text-muted-foreground whitespace-pre-wrap">
    {thinkingTexts}
  </div>
</details>

{/* 工具行 */}
<div className="mb-2 flex flex-col gap-1">
  {toolSteps.map(... => <ToolCallRow key=... />)}
</div>

{/* 结论 */}
<p className="whitespace-pre-wrap leading-relaxed text-foreground">
  {message.content}
</p>
```

User 气泡保持原样。空结论且仍在 streaming 时可显示极简 Skeleton 一行（可选）。

- [ ] **Step 5: 可选 Prompt 一行**

在 `prompts/coding/alex-system.v1.md` 规则中加：调工具前用一两句简体中文说明意图。

- [ ] **Step 6: typecheck**

Run: web 与相关包 typecheck / 既有 test

Expected: PASS

- [ ] **Step 7: 手工验收**

1. 配 `LLM_API_KEY`，新建项目进工作台  
2. 观察：栏头非长期 idle；出现工具行（read/write/list）；思考灰字与结论深色可辨  
3. 刷新：三层仍在  
4. 再发消息：模型不应「记住」思考碎碎念作为用户可见结论重复  
5. 有写文件 → Viewer Building → Ready/Failed  

- [ ] **Step 8: Commit（仅当用户要求）**

---

## Spec Coverage Self-Review

| Spec 项 | Task |
|---------|------|
| SSE status/thinking/tool/token | 2–4 |
| thinking = 工具轮 content_delta | 2 |
| token = 仅结论 | 2–3 |
| tool summary 非 LLM | 2 `tool-summary.ts` |
| process 落库 + 刷新 | 1, 3, 5 |
| history 不含 process | 3 测试锁定 |
| ToolCallRow + 三层 UI + StatusBadge | 5 |
| maxToolRounds 边界 | 2 |
| 自动 preview | 3（保持既有 enqueue） |
| 非目标未纳入 | ✓ |

## Type Consistency

- DB/UI：`MessageProcess` / steps 形状与 spec §6.6 一致
- SSE `tool.state`: `start` \| `end`；落库 tool `status`: `running` \| `done` \| `error`
- `EngineerTurnEvent` 与 web `StreamHandlers` 字段名对齐：`phase` / `text` / `id` / `name` / `state` / `summary`
