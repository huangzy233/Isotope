# Engineer Agent Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 Engineer 最小 Agent 回合：进工作台续跑占位 / Composer 发送 → Alex（coder）经 workspace 改码 → SSE 流式正文 → 有写入则自动 `enqueuePreviewBuild`。

**Architecture:** `web` SSE 路由 → `application.beginEngineerTurn`（归属、占位替换/追加、turn 锁、条件 enqueue）→ `agent-runtime.runTurn`（tool loop）→ `@isotope/llm` OpenAI-compatible stream + `@isotope/agents` coder（Alex）tools；文件只经 `workspace`；`memory` 本轮不碰。

**Tech Stack:** TypeScript、pnpm workspace、vitest、Node `fetch`、Next.js App Router SSE、`yaml` 读 `configs/llm`、现有 shadcn Composer / 消息气泡。

**Spec:** `docs/superpowers/specs/2026-07-18-engineer-agent-turn-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：遵循 `docs/ui/`（先 README → design-principles → ai-surfaces）；Neutral Tool + shadcn only；本轮不做 ToolCallRow / MessageItem 拆分。
- 依赖：`web → application → agent-runtime → agents|llm`；`application → workspace|preview`；禁止 Agent/llm 直接读写 `data/**`；禁止 TS 硬编码长 Prompt。
- 占位文案必须与 `ASSISTANT_PLACEHOLDER` 全等匹配；Team 与 Engineer 同走 Alex 路径。
- SSE 事件仅 `token` / `done` / `error`；重入开流前 `409`。
- 不做：Mike/任务卡、版本卡片、memory、WebSocket、job 表、tool 事件推送。
- **未经用户要求不要 git commit**（忽略下文若出现的 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/workspace/src/app/workspace-store.ts` | 新增 `updateMessage` |
| `packages/workspace/src/app/workspace-store.test.ts` | updateMessage 测 |
| `packages/llm/package.json` | vitest、`@types/node` |
| `packages/llm/src/domain/types.ts` | `LlmClient` / 消息 / 流事件 |
| `packages/llm/src/providers/openai-compatible.ts` | OpenAI-compatible chat stream |
| `packages/llm/src/providers/openai-compatible.test.ts` | mock fetch |
| `packages/llm/src/index.ts` | 导出 |
| `packages/agents/package.json` | vitest（若测） |
| `packages/agents/src/coder/tools.ts` | `list_files` / `read_file` / `write_file` 定义 |
| `packages/agents/src/coder/index.ts` | Alex coder 插件表面 |
| `packages/agents/src/index.ts` | 导出 |
| `prompts/coding/alex-system.v1.md` | Alex system prompt |
| `configs/llm/default.yaml` | baseUrl/model/timeout/maxToolRounds |
| `packages/agent-runtime/package.json` | 依赖 llm；vitest |
| `packages/agent-runtime/src/domain/types.ts` | ToolPort、Turn 回调 |
| `packages/agent-runtime/src/app/run-turn.ts` | tool loop（本轮的 loop） |
| `packages/agent-runtime/src/app/run-turn.test.ts` | mock llm + 假 FS |
| `packages/agent-runtime/src/index.ts` | 导出 |
| `packages/application/package.json` | 加 agent-runtime / agents / llm / preview（已有） |
| `packages/application/src/projects/turn-lock.ts` | 项目级进程内锁 |
| `packages/application/src/projects/stream-engineer-turn.ts` | `beginEngineerTurn` 编排用例 |
| `packages/application/src/projects/stream-engineer-turn.test.ts` | continue/send/enqueue/409 |
| `packages/application/src/index.ts` | 导出 |
| `apps/web/lib/paths.ts` | llm config / prompt 路径 |
| `apps/web/lib/agent.ts` | 组装 llm + systemPrompt + maxToolRounds |
| `apps/web/app/api/projects/[id]/messages/stream/route.ts` | SSE |
| `apps/web/components/workbench-shell.tsx` | continue + stream send |
| `apps/web/.env.example` | LLM_* |
| `apps/web/package.json` | 若需显式依赖 agent-runtime（通常只依赖 application） |

**包内形状（锁定）：** loop = `agent-runtime` 的 `runTurn`；Alex = `agents/src/coder`；`packages/memory` 不改。

---

### Task 1: `workspace.updateMessage`

**Files:**
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/app/workspace-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // WorkspaceStore 新增：
  updateMessage(
    messageId: string,
    patch: { content: string },
  ): Message | null;
  ```
- Consumes: 现有 SQLite `messages` 表

- [ ] **Step 1: 写失败测试**

在 `workspace-store.test.ts` 追加：

```ts
  it("updateMessage updates content or returns null", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "engineer",
    });
    const msg = store.appendMessage({
      projectId: p.id,
      role: "assistant",
      content: "旧文案",
      agentName: "Alex",
    });
    const updated = store.updateMessage(msg.id, { content: "新文案" });
    expect(updated?.content).toBe("新文案");
    expect(updated?.id).toBe(msg.id);
    expect(store.listMessages(p.id)[0]?.content).toBe("新文案");
    expect(store.updateMessage("msg_missing", { content: "x" })).toBeNull();
  });
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/workspace test -- src/app/workspace-store.test.ts`

Expected: FAIL（`updateMessage` 不存在）

- [ ] **Step 3: 实现 `updateMessage`**

在 `WorkspaceStore` 类型与 `createFsSqliteWorkspace` 实现中增加：

```ts
updateMessage(messageId, patch) {
  const row = database
    .prepare(
      `SELECT id, project_id, role, content, created_at, agent_name
       FROM messages WHERE id = ?`,
    )
    .get(messageId) as MessageRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(`UPDATE messages SET content = ? WHERE id = ?`)
      .run(patch.content, messageId);
    database
      .prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`)
      .run(now, row.project_id);
  })();
  return toMessage({ ...row, content: patch.content });
},
```

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @isotope/workspace test -- src/app/workspace-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add packages/workspace/src/app/workspace-store.ts packages/workspace/src/app/workspace-store.test.ts
git commit -m "feat(workspace): add updateMessage for placeholder replacement"
```

---

### Task 2: `@isotope/llm` OpenAI-compatible 客户端

**Files:**
- Modify: `packages/llm/package.json`
- Create: `packages/llm/src/domain/types.ts`
- Create: `packages/llm/src/providers/openai-compatible.ts`
- Create: `packages/llm/src/providers/openai-compatible.test.ts`
- Modify: `packages/llm/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LlmToolParameter = {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };

  export type LlmToolDefinition = {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: LlmToolParameter;
    };
  };

  export type LlmToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  };

  export type LlmMessage =
    | { role: "system" | "user"; content: string }
    | {
        role: "assistant";
        content: string | null;
        tool_calls?: LlmToolCall[];
      }
    | { role: "tool"; tool_call_id: string; content: string };

  export type LlmStreamEvent =
    | { type: "content_delta"; text: string }
    | { type: "tool_calls"; toolCalls: LlmToolCall[] }
    | { type: "finished"; finishReason: string | null };

  export type LlmClient = {
    complete(input: {
      messages: LlmMessage[];
      tools?: LlmToolDefinition[];
      signal?: AbortSignal;
    }): AsyncIterable<LlmStreamEvent>;
  };

  export type OpenAiCompatibleConfig = {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    fetch?: typeof fetch;
  };

  export function createOpenAiCompatibleClient(
    config: OpenAiCompatibleConfig,
  ): LlmClient;
  ```
- Consumes: 无

- [ ] **Step 1: 更新 `package.json`**

```json
{
  "name": "@isotope/llm",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 写失败测试（request 形状 + content stream）**

`openai-compatible.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleClient } from "./openai-compatible.js";

describe("createOpenAiCompatibleClient", () => {
  it("posts chat completions and yields content deltas", async () => {
    const fetchMock = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = createOpenAiCompatibleClient({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "gpt-test",
      timeoutMs: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const events = [];
    for await (const ev of client.complete({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(ev);
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const payload = JSON.parse(String(init?.body));
    expect(payload.model).toBe("gpt-test");
    expect(payload.stream).toBe(true);
    expect(events).toEqual([
      { type: "content_delta", text: "你" },
      { type: "content_delta", text: "好" },
      { type: "finished", finishReason: "stop" },
    ]);
  });

  it("aggregates tool_call deltas into tool_calls event", async () => {
    const fetchMock = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"write_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200 });
    });
    const client = createOpenAiCompatibleClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      model: "m",
      timeoutMs: 5000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const events = [];
    for await (const ev of client.complete({
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "write",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    })) {
      events.push(ev);
    }
    expect(events.at(-2)).toMatchObject({
      type: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "write_file",
            arguments: '{"path":"a.ts"}',
          },
        },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "finished",
      finishReason: "tool_calls",
    });
  });
});
```

- [ ] **Step 3: 跑测确认失败**

Run: `pnpm --filter @isotope/llm test`

Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 types + client**

`domain/types.ts`：按 Interfaces 导出类型。

`providers/openai-compatible.ts` 要点：

- `POST ${baseUrl.replace(/\/$/, "")}/chat/completions`
- Headers: `Authorization: Bearer ${apiKey}`、`Content-Type: application/json`
- Body: `{ model, messages, tools, stream: true, tool_choice: tools?.length ? "auto" : undefined }`
- 用 `AbortSignal.timeout(timeoutMs)` 与可选 `signal` 组合（`AbortSignal.any` 若环境支持，否则手动 abort）
- 解析 SSE 行：`data: ` 前缀；`[DONE]` 结束
- 聚合 `delta.tool_calls[]`（按 `index`）；流结束若有 tool calls → 先 yield `{ type: "tool_calls", toolCalls }`，再 yield `finished`
- HTTP 非 2xx：抛 `Error`（message 含 status + body 截断），由上层变 `error` 事件

`index.ts`：

```ts
export type {
  LlmClient,
  LlmMessage,
  LlmStreamEvent,
  LlmToolCall,
  LlmToolDefinition,
  OpenAiCompatibleConfig,
} from "./domain/types.js";
export { createOpenAiCompatibleClient } from "./providers/openai-compatible.js";
```

把 `OpenAiCompatibleConfig` 放在 `types.ts` 或与 factory 同文件再导出均可，保持 index 表面一致。

- [ ] **Step 5: 跑测确认通过**

Run: `pnpm --filter @isotope/llm test && pnpm --filter @isotope/llm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**（用户未要求则跳过）

---

### Task 3: `@isotope/agents` coder（Alex）+ Prompt

**Files:**
- Create: `prompts/coding/alex-system.v1.md`
- Create: `packages/agents/src/coder/tools.ts`
- Create: `packages/agents/src/coder/index.ts`
- Modify: `packages/agents/src/index.ts`
- Modify: `packages/agents/package.json`（加 `@types/node` / typescript 已有则不动；本任务可不加 vitest）

**Interfaces:**
- Produces:
  ```ts
  export const CODER_DISPLAY_NAME = "Alex";

  export type WorkspaceToolPort = {
    listFiles(relativeDir?: string): string[];
    readFile(relativePath: string): string;
    writeFile(relativePath: string, content: string): void;
  };

  export type CoderAgent = {
    displayName: typeof CODER_DISPLAY_NAME;
    systemPrompt: string;
    tools: LlmToolDefinition[]; // 从 @isotope/llm 类型复用，或 agents 内联同形
    executeTool(
      name: string,
      argsJson: string,
      port: WorkspaceToolPort,
    ): { ok: true; result: string } | { ok: false; error: string };
  };

  export function createCoderAgent(input: {
    systemPrompt: string;
  }): CoderAgent;
  ```
- Consumes: Task 2 的 `LlmToolDefinition`（`agents` package.json 加 `"@isotope/llm": "workspace:*"`）

- [ ] **Step 1: 写 Prompt 文件**

`prompts/coding/alex-system.v1.md`：

```markdown
你是 Alex，Isotope 的工程师 Agent。

规则：
1. 用简体中文对用户做简短说明（改了什么、为什么）。
2. 必须通过工具读写项目文件；不要臆造未读过的文件内容。
3. 这是 Vite + React 前端模板工作区；优先改 `src/` 下文件；不要改 `node_modules`。
4. 路径使用工作区内相对路径（如 `src/App.tsx`）。
5. 完成用户需求即可，不要无关重构。
```

- [ ] **Step 2: 实现 tools + createCoderAgent**

`tools.ts`：三个 function tools：

| name | 参数 |
|------|------|
| `list_files` | `relativeDir?: string` |
| `read_file` | `path: string`（required） |
| `write_file` | `path: string`, `content: string`（required） |

`executeTool`：`JSON.parse` args；调用 port；成功 `JSON.stringify` 结果或原文；失败返回 `{ ok: false, error }`（含非法 JSON / 未知 tool / port 抛错 message）。

`write_file` 成功结果固定字符串 `"ok"` 即可。

- [ ] **Step 3: 导出**

```ts
// packages/agents/src/index.ts
export {
  CODER_DISPLAY_NAME,
  createCoderAgent,
  type CoderAgent,
  type WorkspaceToolPort,
} from "./coder/index.js";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @isotope/agents typecheck`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

---

### Task 4: `@isotope/agent-runtime` `runTurn`（loop）

**Files:**
- Modify: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/src/domain/types.ts`
- Create: `packages/agent-runtime/src/app/run-turn.ts`
- Create: `packages/agent-runtime/src/app/run-turn.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `LlmClient`、`CoderAgent`、`WorkspaceToolPort`
- Produces:
  ```ts
  export type RunTurnInput = {
    llm: LlmClient;
    agent: CoderAgent;
    port: WorkspaceToolPort;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    maxToolRounds: number;
    signal?: AbortSignal;
    onToken: (text: string) => void;
  };

  export type RunTurnResult = {
    assistantText: string;
    filesChanged: boolean;
  };

  export function runTurn(input: RunTurnInput): Promise<RunTurnResult>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { createCoderAgent } from "@isotope/agents";
import type { LlmClient, LlmStreamEvent } from "@isotope/llm";
import { runTurn } from "./run-turn.js";

function llmFromScript(
  rounds: LlmStreamEvent[][],
): LlmClient {
  let i = 0;
  return {
    async *complete() {
      const events = rounds[i++] ?? [
        { type: "finished", finishReason: "stop" } as const,
      ];
      for (const ev of events) yield ev;
    },
  };
}

describe("runTurn", () => {
  it("executes write_file tool then streams final text", async () => {
    const files = new Map<string, string>();
    const port = {
      listFiles: () => [...files.keys()],
      readFile: (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error("missing");
        return v;
      },
      writeFile: (p: string, c: string) => {
        files.set(p, c);
      },
    };
    const agent = createCoderAgent({ systemPrompt: "test" });
    const tokens: string[] = [];
    const result = await runTurn({
      llm: llmFromScript([
        [
          {
            type: "tool_calls",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "src/App.tsx",
                    content: "export default function App(){return null}",
                  }),
                },
              },
            ],
          },
          { type: "finished", finishReason: "tool_calls" },
        ],
        [
          { type: "content_delta", text: "已更新 App" },
          { type: "finished", finishReason: "stop" },
        ],
      ]),
      agent,
      port,
      history: [{ role: "user", content: "做一个空页面" }],
      maxToolRounds: 8,
      onToken: (t) => tokens.push(t),
    });
    expect(files.get("src/App.tsx")).toContain("App");
    expect(result.filesChanged).toBe(true);
    expect(result.assistantText).toBe("已更新 App");
    expect(tokens.join("")).toBe("已更新 App");
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/agent-runtime test`

先在 `package.json` 加 scripts/deps：

```json
{
  "dependencies": {
    "@isotope/agents": "workspace:*",
    "@isotope/llm": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

Expected: FAIL（`runTurn` 不存在）

- [ ] **Step 3: 实现 `runTurn`**

算法：

1. `messages: LlmMessage[] = [{ role: "system", content: agent.systemPrompt }, ...history]`
2. `filesChanged = false`；`assistantText = ""`
3. 循环 `round = 0..maxToolRounds`：
   - `hadToolCalls = false`
   - `for await (ev of llm.complete({ messages, tools: agent.tools, signal }))`：
     - `content_delta` → `assistantText += text`；`onToken(text)`
     - `tool_calls` → `hadToolCalls = true`；把 assistant tool_calls 消息 push 进 messages；对每个 call `agent.executeTool`；若 name 是 `write_file` 且 ok → `filesChanged = true`；push tool 结果消息
     - `finished` → 记录 reason
   - 若无 tool calls → `return { assistantText, filesChanged }`
4. 超出 rounds：若 `assistantText` 非空则 return（可 `onToken` 追加一句「（已达工具轮次上限）」）；否则 `throw new Error("工具调用轮次过多")`

注意：同一轮若先有 content_delta 再有 tool_calls，OpenAI 允许；把该轮 assistant 的 content 一并写入 tool_calls 消息的 `content` 字段。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @isotope/agent-runtime test && pnpm --filter @isotope/agent-runtime typecheck`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

---

### Task 5: `application.beginEngineerTurn`

**Files:**
- Modify: `packages/application/package.json`（加 `@isotope/agent-runtime`、`@isotope/agents`、`@isotope/llm`）
- Create: `packages/application/src/projects/turn-lock.ts`
- Create: `packages/application/src/projects/stream-engineer-turn.ts`
- Create: `packages/application/src/projects/stream-engineer-turn.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `runTurn`、`ASSISTANT_PLACEHOLDER`、`enqueuePreviewBuild`、`WorkspaceStore`、`PreviewService`、`LlmClient`、`CoderAgent`
- Produces:
  ```ts
  export type EngineerTurnEvent =
    | { type: "token"; text: string }
    | {
        type: "done";
        messageId: string;
        filesChanged: boolean;
        previewEnqueued: boolean;
      }
    | { type: "error"; message: string };

  export type EngineerTurnInput =
    | {
        ownerUserId: string;
        projectId: string;
        action: "continue";
      }
    | {
        ownerUserId: string;
        projectId: string;
        action: "send";
        content: string;
      };

  export type EngineerTurnDeps = {
    workspace: WorkspaceStore;
    preview: PreviewService;
    llm: LlmClient;
    agent: CoderAgent;
    maxToolRounds: number;
  };

  export type BeginEngineerTurnResult =
    | { ok: false; status: "not_found" | "bad_request" | "conflict" }
    | {
        ok: true;
        run: (emit: (event: EngineerTurnEvent) => void) => Promise<void>;
      };

  /** 同步：归属 / 占位或 content 校验 / 加锁。失败不持锁。成功后必须调用 run（run 的 finally 释放锁）。 */
  export function beginEngineerTurn(
    input: EngineerTurnInput,
    deps: EngineerTurnDeps,
  ): BeginEngineerTurnResult;
  ```

- [ ] **Step 1: 实现 turn-lock**

```ts
const locks = new Set<string>();

export function tryAcquireTurnLock(projectId: string): boolean {
  if (locks.has(projectId)) return false;
  locks.add(projectId);
  return true;
}

export function releaseTurnLock(projectId: string): void {
  locks.delete(projectId);
}
```

- [ ] **Step 2: 写失败测试（核心路径）**

用真实 `createFsSqliteWorkspace` + mock `LlmClient`（同 Task 4 脚本）+ mock preview：

1. `createProject` 后 `action: "continue"` → `begun.ok`；`await begun.run(emit)` → 占位被替换；`write_file` 后 `enqueueBuild` 被调用；emit 收到 token/done
2. `action: "send"` → 消息多 2 条（user+assistant）；不再是占位
3. 第一次 `begin` 成功后、`run` 完成前，第二次 `begin` → `{ ok: false, status: "conflict" }`
4. llm `complete` throw → emit error；占位内容以 `生成失败：` 开头

并发测法：llm `complete` 内 `await delay(50)`；`const a = begin(...); const b = begin(...);` 期望 `a.ok && !b.ok && b.status === "conflict"`；再 `await a.run(...)`。

- [ ] **Step 3: 跑测确认失败**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-engineer-turn.test.ts`

Expected: FAIL

- [ ] **Step 4: 实现 `beginEngineerTurn`**

```ts
export function beginEngineerTurn(
  input: EngineerTurnInput,
  deps: EngineerTurnDeps,
): BeginEngineerTurnResult {
  if (
    !getProject(
      { ownerUserId: input.ownerUserId, projectId: input.projectId },
      deps.workspace,
    )
  ) {
    return { ok: false, status: "not_found" };
  }

  const messages = deps.workspace.listMessages(input.projectId);
  let replaceId: string | null = null;

  if (input.action === "continue") {
    const last = messages.at(-1);
    if (
      !last ||
      last.role !== "assistant" ||
      last.content !== ASSISTANT_PLACEHOLDER
    ) {
      return { ok: false, status: "bad_request" };
    }
    replaceId = last.id;
  } else {
    if (!input.content.trim()) {
      return { ok: false, status: "bad_request" };
    }
  }

  if (!tryAcquireTurnLock(input.projectId)) {
    return { ok: false, status: "conflict" };
  }

  // send：加锁成功后再 append user，避免 conflict 时脏写
  if (input.action === "send") {
    deps.workspace.appendMessage({
      projectId: input.projectId,
      role: "user",
      content: input.content.trim(),
    });
  }

  return {
    ok: true,
    run: async (emit) => {
      try {
        const history = deps.workspace
          .listMessages(input.projectId)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .filter((m) => m.content !== ASSISTANT_PLACEHOLDER)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const port = {
          listFiles: (dir?: string) =>
            deps.workspace.listFiles(input.projectId, dir),
          readFile: (p: string) =>
            deps.workspace.readFile(input.projectId, p),
          writeFile: (p: string, c: string) =>
            deps.workspace.writeFile(input.projectId, p, c),
        };

        try {
          const result = await runTurn({
            llm: deps.llm,
            agent: deps.agent,
            port,
            history,
            maxToolRounds: deps.maxToolRounds,
            onToken: (text) => emit({ type: "token", text }),
          });

          const text = result.assistantText || "（无回复内容）";
          let messageId: string;
          if (replaceId) {
            messageId = deps.workspace.updateMessage(replaceId, {
              content: text,
            })!.id;
          } else {
            messageId = deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: text,
              agentName: "Alex",
            }).id;
          }

          let previewEnqueued = false;
          if (result.filesChanged) {
            enqueuePreviewBuild(
              {
                ownerUserId: input.ownerUserId,
                projectId: input.projectId,
              },
              deps.workspace,
              deps.preview,
            );
            previewEnqueued = true;
          }
          emit({
            type: "done",
            messageId,
            filesChanged: result.filesChanged,
            previewEnqueued,
          });
        } catch (err) {
          const msg =
            "生成失败：" +
            (err instanceof Error ? err.message : "未知错误").slice(0, 300);
          if (replaceId) {
            deps.workspace.updateMessage(replaceId, { content: msg });
          } else {
            deps.workspace.appendMessage({
              projectId: input.projectId,
              role: "assistant",
              content: msg,
              agentName: "Alex",
            });
          }
          emit({ type: "error", message: msg });
        }
      } finally {
        releaseTurnLock(input.projectId);
      }
    },
  };
}
```

导出 `beginEngineerTurn` 与事件/输入类型。

- [ ] **Step 5: 跑测确认通过**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-engineer-turn.test.ts && pnpm --filter @isotope/application typecheck`

Expected: PASS

- [ ] **Step 6: Commit**（用户未要求则跳过）

---

### Task 6: Web 组装 + SSE 路由

**Files:**
- Modify: `apps/web/lib/paths.ts`
- Create: `apps/web/lib/agent.ts`
- Create: `apps/web/app/api/projects/[id]/messages/stream/route.ts`
- Modify: `apps/web/.env.example`
- Create: `configs/llm/default.yaml`
- Modify: `apps/web/package.json`（加 `@isotope/agents`、`@isotope/llm`）

**Interfaces:**
- Consumes: `beginEngineerTurn`、`createOpenAiCompatibleClient`、`createCoderAgent`
- Produces: SSE HTTP；`createTurnDeps()`

- [ ] **Step 1: 配置与路径**

`configs/llm/default.yaml`：

```yaml
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
timeoutMs: 120000
maxToolRounds: 8
```

`paths.ts` 追加：

```ts
export function llmConfigPath(): string {
  return path.join(monorepoRoot(), "configs/llm/default.yaml");
}

export function alexSystemPromptPath(): string {
  return path.join(monorepoRoot(), "prompts/coding/alex-system.v1.md");
}
```

`.env.example` 追加：

```
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

- [ ] **Step 2: `lib/agent.ts`**

```ts
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createCoderAgent } from "@isotope/agents";
import { createOpenAiCompatibleClient, type LlmClient } from "@isotope/llm";
import { alexSystemPromptPath, llmConfigPath } from "./paths";

type LlmFileConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxToolRounds: number;
};

export function loadLlmFileConfig(): LlmFileConfig {
  const data = parse(readFileSync(llmConfigPath(), "utf8")) as LlmFileConfig;
  return data;
}

export function createTurnDeps(): {
  llm: LlmClient;
  agent: ReturnType<typeof createCoderAgent>;
  maxToolRounds: number;
} {
  const file = loadLlmFileConfig();
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("未配置 LLM_API_KEY");
  }
  const llm = createOpenAiCompatibleClient({
    apiKey,
    baseUrl: process.env.LLM_BASE_URL?.trim() || file.baseUrl,
    model: process.env.LLM_MODEL?.trim() || file.model,
    timeoutMs: file.timeoutMs,
  });
  const systemPrompt = readFileSync(alexSystemPromptPath(), "utf8");
  return {
    llm,
    agent: createCoderAgent({ systemPrompt }),
    maxToolRounds: file.maxToolRounds,
  };
}
```

`apps/web/package.json` 增加 `"@isotope/agents": "workspace:*"`、`"@isotope/llm": "workspace:*"`。

- [ ] **Step 3: SSE route（开流前映射 404/400/409）**

`apps/web/app/api/projects/[id]/messages/stream/route.ts`：

```ts
import { beginEngineerTurn } from "@isotope/application";
import { readSession } from "@/lib/auth";
import { createTurnDeps } from "@/lib/agent";
import { getPreview } from "@/lib/preview";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    content?: string;
  } | null;

  if (!body || (body.action !== "continue" && body.action !== "send")) {
    return Response.json({ error: "请求无效" }, { status: 400 });
  }
  if (body.action === "send" && !String(body.content ?? "").trim()) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  let turnDeps;
  try {
    turnDeps = createTurnDeps();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "LLM 配置无效" },
      { status: 500 },
    );
  }

  const begun = beginEngineerTurn(
    body.action === "continue"
      ? {
          ownerUserId: session.username,
          projectId: id,
          action: "continue",
        }
      : {
          ownerUserId: session.username,
          projectId: id,
          action: "send",
          content: String(body.content),
        },
    {
      workspace: getWorkspace(),
      preview: getPreview(),
      ...turnDeps,
    },
  );

  if (!begun.ok) {
    const status =
      begun.status === "conflict"
        ? 409
        : begun.status === "not_found"
          ? 404
          : 400;
    const error =
      begun.status === "conflict"
        ? "回合进行中"
        : begun.status === "not_found"
          ? "项目不存在"
          : "请求无效";
    return Response.json({ error }, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };
      try {
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
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

使用现有 `getPreview()`（`apps/web/lib/preview.ts`）。

- [ ] **Step 4: typecheck web**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

---

### Task 7: 工作台 UI（continue + stream send）

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`
- Modify: `packages/application/src/projects/placeholder.ts`（可选：导出 `isAssistantPlaceholder(content: string)`；或 web 从 `@isotope/application` 导入 `ASSISTANT_PLACEHOLDER`）

**Interfaces:**
- Consumes: SSE `/api/projects/:id/messages/stream`
- Produces: 流式气泡 UX

- [ ] **Step 1: 增加 SSE 辅助（可内联在 shell）**

```ts
async function consumeEngineerStream(
  projectId: string,
  body: { action: "continue" } | { action: "send"; content: string },
  handlers: {
    onToken: (text: string) => void;
    onDone: (data: {
      messageId: string;
      filesChanged: boolean;
      previewEnqueued: boolean;
    }) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    handlers.onError("回合进行中，请稍候");
    return;
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    handlers.onError(
      typeof data?.error === "string" ? data.error : "请求失败",
    );
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      const data = JSON.parse(dataLine) as Record<string, unknown>;
      if (event === "token" && typeof data.text === "string") {
        handlers.onToken(data.text);
      } else if (event === "done") {
        handlers.onDone(data as {
          messageId: string;
          filesChanged: boolean;
          previewEnqueued: boolean;
        });
      } else if (event === "error") {
        handlers.onError(String(data.message ?? "生成失败"));
      }
    }
  }
}
```

- [ ] **Step 2: 挂载 auto-continue**

```ts
import { ASSISTANT_PLACEHOLDER } from "@isotope/application";

const continuedRef = useRef(false);

useEffect(() => {
  if (continuedRef.current) return;
  const last = messages.at(-1);
  if (
    !last ||
    last.role !== "assistant" ||
    last.content !== ASSISTANT_PLACEHOLDER
  ) {
    return;
  }
  continuedRef.current = true;
  setSubmitting(true);
  setMessages((prev) => {
    const copy = [...prev];
    const i = copy.length - 1;
    copy[i] = { ...copy[i]!, content: "" };
    return copy;
  });
  void consumeEngineerStream(
    project.id,
    { action: "continue" },
    {
      onToken: (text) => {
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          copy[i] = {
            ...copy[i]!,
            content: (copy[i]?.content ?? "") + text,
          };
          return copy;
        });
      },
      onDone: (data) => {
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          copy[i] = { ...copy[i]!, id: data.messageId };
          return copy;
        });
        setSubmitting(false);
        if (data.previewEnqueued) void fetchPreview(false);
      },
      onError: (message) => {
        setError(message);
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          if (copy[i]) {
            copy[i] = {
              ...copy[i]!,
              content: copy[i]!.content || message,
            };
          }
          return copy;
        });
        setSubmitting(false);
      },
    },
  );
}, [project.id]); // 不要把 messages 放进 deps，避免循环
```

注意：eslint 对 messages 初始闭包——用 `initialMessages` 判断是否需 continue，更稳：

```ts
useEffect(() => {
  if (continuedRef.current) return;
  const last = initialMessages.at(-1);
  ...
}, [project.id, initialMessages]);
```

- [ ] **Step 3: 改 `handleSend` 走 stream**

```ts
async function handleSend() {
  if (!draft.trim() || submitting) return;
  const content = draft.trim();
  setSubmitting(true);
  setError(null);
  setDraft("");
  const tempUser = {
    id: `local_user_${Date.now()}`,
    projectId: project.id,
    role: "user" as const,
    content,
    createdAt: new Date().toISOString(),
  };
  const tempAssistant = {
    id: `local_asst_${Date.now()}`,
    projectId: project.id,
    role: "assistant" as const,
    content: "",
    createdAt: new Date().toISOString(),
    agentName: "Alex",
  };
  setMessages((prev) => [...prev, tempUser, tempAssistant]);

  await consumeEngineerStream(
    project.id,
    { action: "send", content },
    {
      onToken: (text) => {
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          copy[i] = {
            ...copy[i]!,
            content: (copy[i]?.content ?? "") + text,
          };
          return copy;
        });
      },
      onDone: (data) => {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1]!,
            id: data.messageId,
          };
          return copy;
        });
        setSubmitting(false);
        if (data.previewEnqueued) void fetchPreview(false);
      },
      onError: (message) => {
        setError(message);
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          if (copy[i]?.role === "assistant") {
            copy[i] = {
              ...copy[i]!,
              content: copy[i]!.content || message,
            };
          }
          return copy;
        });
        setSubmitting(false);
      },
    },
  );
}
```

Composer：`disabled={submitting}`（若尚未绑定）。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 5: 手工验收（配 `LLM_API_KEY`）**

1. `pnpm --filter @isotope/web dev`
2. 登录 → Engineer →「做一个简单的待办落地页」→ 进工作台
3. 见占位变流式真实回复；App Viewer 自动 Building → Ready
4. 再发「改成中文」→ 流式回复 → 预览更新
5. 无 key 时：开流前或错误文案可见，不永久卡占位

- [ ] **Step 6: Commit**（用户未要求则跳过）

---

## Self-Review (against spec)

| Spec 项 | Task |
|---------|------|
| OpenAI-compatible LLM | T2 |
| Alex coder + prompts/coding | T3 |
| runTurn tool loop | T4 |
| continue 替换占位 / send 追加 | T5 |
| filesChanged → enqueuePreviewBuild | T5 |
| SSE token/done/error | T6–T7 |
| 开流前 409 | T5 `beginEngineerTurn` + T6 route |
| 工作台挂载 continue | T7 |
| Team 同路径 | T5（不分支 mode） |
| 缺 key 失败可见 | T6 createTurnDeps + T5/T7 error |
| 不做 memory / ToolCallRow / Mike | Global Constraints |
| `updateMessage` | T1 |
| configs/llm + .env.example | T6 |

**类型一致性：** `beginEngineerTurn` / `CoderAgent` / `WorkspaceToolPort` / `LlmClient` / `EngineerTurnEvent` 跨任务统一。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-engineer-agent-turn.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个新 subagent，任务间审查，迭代快  

**2. Inline Execution** — 本会话用 executing-plans 按任务批量执行并设检查点  

Which approach?
