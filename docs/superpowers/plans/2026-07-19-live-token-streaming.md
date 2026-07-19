# Live Token Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 结论与工具前旁白在生成过程中实时出字；遇 tool 时收回投机结论并降级为 thinking；tool 仍等拼完整再执行。

**Architecture:** LLM 在首个 `delta.tool_calls` 时 yield `tool_calls_begin`；`runTurn` 对 `content_delta` 立刻 `onToken`，降级时 `onTokenClear` + `onThinking`；application 发 SSE `token_clear`；workbench 清空当前助手 `content`。

**Tech Stack:** TypeScript、pnpm workspace、vitest、Next.js SSE、现有 TurnHub。

**Spec:** `docs/superpowers/specs/2026-07-19-live-token-streaming-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖：`web → application → agent-runtime → agents|llm`；Agent 不直接碰 `data/**`。
- `process` **禁止**进入 `runTurn` history；只传 `content`。
- Tool 不对 arguments 碎片做 UI；完整 `tool_calls` 后才执行。
- **未经用户要求不要 git commit**（忽略下文 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/llm/src/domain/types.ts` | `LlmStreamEvent` 增加 `tool_calls_begin` |
| `packages/llm/src/providers/openai-compatible.ts` | 首个 tool_calls delta 时 yield begin |
| `packages/llm/src/providers/openai-compatible.test.ts` | begin 顺序断言 |
| `packages/agent-runtime/src/domain/types.ts` | `onTokenClear?: () => void` |
| `packages/agent-runtime/src/app/run-turn.ts` | 实时 token + 降级规则 |
| `packages/agent-runtime/src/app/run-turn.test.ts` | 流式 / clear / thinking 断言 |
| `packages/application/src/projects/stream-engineer-turn.ts` | `token_clear` 事件 + 回调 |
| `packages/application/src/projects/stream-team-turn.ts` | 同上 |
| `packages/application/src/projects/stream-plan-turn.ts` | 同上 |
| `apps/web/components/workbench-shell.tsx` | 消费 `token_clear` |

---

### Task 1: LLM `tool_calls_begin`

**Files:**
- Modify: `packages/llm/src/domain/types.ts`
- Modify: `packages/llm/src/providers/openai-compatible.ts`
- Modify: `packages/llm/src/providers/openai-compatible.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LlmStreamEvent =
    | { type: "content_delta"; text: string }
    | { type: "tool_calls_begin" }
    | { type: "tool_calls"; toolCalls: LlmToolCall[] }
    | { type: "finished"; finishReason: string | null };
  ```

- [ ] **Step 1: 写失败测试**

在 `openai-compatible.test.ts` 的 tool_calls 用例中，在聚合断言前增加：

```ts
expect(events[0]).toEqual({ type: "tool_calls_begin" });
```

并新增：content 后再出现 tool_calls 时，begin 夹在 content 与 tool_calls 之间：

```ts
it("yields tool_calls_begin before aggregated tool_calls when content preceded tools", async () => {
  const fetchMock = vi.fn(async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"我先读"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"index.html\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    return new Response(body, { status: 200 });
  });
  const client = createOpenAiCompatibleClient({
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    timeoutMs: 5000,
    fetch: fetchMock as unknown as typeof fetch,
  });
  const events = [];
  for await (const ev of client.complete({
    model: "m",
    messages: [{ role: "user", content: "x" }],
  })) {
    events.push(ev);
  }
  expect(events.map((e) => e.type)).toEqual([
    "content_delta",
    "tool_calls_begin",
    "tool_calls",
    "finished",
  ]);
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/llm test`

Expected: FAIL（尚无 `tool_calls_begin`）

- [ ] **Step 3: 实现**

`types.ts`：为 `LlmStreamEvent` 增加 `| { type: "tool_calls_begin" }`。

`openai-compatible.ts`：在 `complete` 循环内维护 `let emittedToolCallsBegin = false`；处理 `delta.tool_calls` 时，若尚未 emit 且本 chunk 有 tool_calls delta，先 `yield { type: "tool_calls_begin" }` 再聚合碎片。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @isotope/llm test`

Expected: PASS

- [ ] **Step 5: Commit** — 跳过（除非用户要求）

---

### Task 2: `runTurn` 实时 token + 降级

**Files:**
- Modify: `packages/agent-runtime/src/domain/types.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.test.ts`

**Interfaces:**
- Consumes: `LlmStreamEvent` 含 `tool_calls_begin`
- Produces: `RunTurnInput.onTokenClear?: () => void`

- [ ] **Step 1: 写失败测试**

在 `run-turn.test.ts` 追加（沿用现有 `llmFromScript` / agent / port helpers）：

```ts
it("streams content_delta via onToken before finished (no tools)", async () => {
  const order: string[] = [];
  const llm: LlmClient = {
    async *complete() {
      yield { type: "content_delta", text: "你" };
      order.push("delta");
      yield { type: "content_delta", text: "好" };
      yield { type: "finished", finishReason: "stop" };
      order.push("finished");
    },
  };
  const tokens: string[] = [];
  await runTurn({
    llm,
    model: "m",
    agent: createCoderAgent({ systemPrompt: "t" }),
    port: /* existing test port */,
    history: [{ role: "user", content: "hi" }],
    maxToolRounds: 8,
    onToken: (t) => {
      tokens.push(t);
      order.push(`token:${t}`);
    },
  });
  expect(tokens).toEqual(["你", "好"]);
  expect(order.indexOf("token:你")).toBeLessThan(order.indexOf("finished"));
});

it("demotes speculative tokens to thinking when tool_calls arrive", async () => {
  const tokens: string[] = [];
  const clears: number[] = [];
  const thinking: string[] = [];
  const result = await runTurn({
    llm: llmFromScript([
      [
        { type: "content_delta", text: "我先读" },
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"index.html"}',
              },
            },
          ],
        },
        { type: "finished", finishReason: "tool_calls" },
      ],
      [
        { type: "content_delta", text: "好了" },
        { type: "finished", finishReason: "stop" },
      ],
    ]),
    model: "m",
    agent: createCoderAgent({ systemPrompt: "t" }),
    port: /* port with read_file */,
    history: [{ role: "user", content: "读一下" }],
    maxToolRounds: 8,
    onToken: (t) => tokens.push(t),
    onTokenClear: () => clears.push(tokens.length),
    onThinking: (t) => thinking.push(t),
  });
  expect(tokens[0]).toBe("我先读");
  expect(clears.length).toBe(1);
  expect(thinking.join("")).toContain("我先读");
  expect(result.assistantText).toBe("好了");
  expect(result.process.steps.some((s) => s.type === "thinking")).toBe(true);
});

it("tool_calls_begin demotes early; later content_delta only thinking", async () => {
  const tokens: string[] = [];
  const thinking: string[] = [];
  let clears = 0;
  await runTurn({
    llm: {
      async *complete() {
        yield { type: "content_delta", text: "旁白" };
        yield { type: "tool_calls_begin" };
        yield { type: "content_delta", text: "更多" };
        yield {
          type: "tool_calls",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"a.ts"}',
              },
            },
          ],
        };
        yield { type: "finished", finishReason: "tool_calls" };
      },
    },
    // …agent/port/history；第二轮可再 script 一条结论，或 maxToolRounds 测 demote 即可
    model: "m",
    agent: createCoderAgent({ systemPrompt: "t" }),
    port: /* … */,
    history: [{ role: "user", content: "x" }],
    maxToolRounds: 1, // 或 2 + 第二轮 stop，避免抛上限
    onToken: (t) => tokens.push(t),
    onTokenClear: () => {
      clears += 1;
    },
    onThinking: (t) => thinking.push(t),
  });
  expect(tokens).toEqual(["旁白"]); // 「更多」不进 token
  expect(clears).toBe(1);
  expect(thinking.join("")).toBe("旁白更多");
});
```

实现时把注释里的 port/agent 换成文件内已有 helper（与现有用例一致）。`maxToolRounds: 1` 且有 tool 时会走上限分支——第三则测试应用 `llmFromScript` 两轮（第二轮直接 `content_delta` + `finished`），或接受上限文案；**推荐两轮 script**，第二轮 `yield` 结论 `"ok"`。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: FAIL（仍整轮缓冲）

- [ ] **Step 3: 实现 `runTurn`**

`types.ts` 增加 `onTokenClear?: () => void`。

`run-turn.ts` 单轮逻辑替换为（语义）：

```ts
let demotedToThinking = false;
let roundBuffer = "";
let speculativeTokens = ""; // 本轮已 onToken 的正文，降级时从 assistantText 逻辑上回滚

function demoteSpeculative() {
  if (demotedToThinking) return;
  demotedToThinking = true;
  if (roundBuffer.length > 0) {
    onThinking?.(roundBuffer);
    appendThinking(process, roundBuffer);
  }
  if (speculativeTokens.length > 0) {
    onTokenClear?.();
    // assistantText 本轮尚未提交结论：speculative 只存在于 UI / 本地 speculativeTokens
    speculativeTokens = "";
  }
  onStatus?.("running");
}

for await (const ev of llm.complete(...)) {
  if (ev.type === "content_delta") {
    roundBuffer += ev.text;
    if (!demotedToThinking) {
      if (speculativeTokens.length === 0) onStatus?.("streaming");
      onToken(ev.text);
      speculativeTokens += ev.text;
    } else {
      onThinking?.(ev.text);
      appendThinking(process, ev.text);
    }
    continue;
  }
  if (ev.type === "tool_calls_begin") {
    demoteSpeculative();
    continue;
  }
  if (ev.type === "tool_calls") {
    hadToolCalls = true;
    demoteSpeculative();
    // 用 roundBuffer 作为 messages assistant content（与现网 thinkingText 相同）
    const thinkingText = roundBuffer;
    roundBuffer = "";
    messages.push({ role: "assistant", content: thinkingText || null, tool_calls: ev.toolCalls });
    // …现有 tool 执行循环不变…
    continue;
  }
}
if (!hadToolCalls) {
  assistantText += speculativeTokens; // 或本轮 speculative 即结论
  return { assistantText, filesChanged, writtenPaths, process };
}
```

注意：

- 无工具终轮：`assistantText` 必须等于已 stream 的 token 拼接；**不要**再二次 `onToken` flush。
- 有工具轮：`assistantText` **不含**旁白；降级后 `speculativeTokens` 清空。
- `demoteSpeculative` 只调用一次 `onTokenClear`（begin 与 tool_calls 不重复 clear）。
- 达 `maxToolRounds` 分支保持现网文案行为。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: PASS（含旧用例：有 tool 时 thinking、结论、writtenPaths）

- [ ] **Step 5: Commit** — 跳过

---

### Task 3: Application SSE `token_clear`

**Files:**
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-team-turn.ts`
- Modify: `packages/application/src/projects/stream-plan-turn.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.test.ts`（若有事件断言则补 `token_clear`；无则最小补一条）

**Interfaces:**
- Produces: `| { type: "token_clear" }` 加入 Engineer/Team/Plan 的 TurnEvent 联合类型
- `trackProcess` / 等价处：`onTokenClear: () => publish({ type: "token_clear" })` 传入 `runTurn`

- [ ] **Step 1: 扩展事件类型并接线**

三处 TurnEvent：

```ts
| { type: "token_clear" }
```

在 `trackProcess`（engineer）及 team/plan 的回调对象中：

```ts
onTokenClear: () => publish({ type: "token_clear" }),
```

- [ ] **Step 2: 单测（engineer）**

若 `stream-engineer-turn.test.ts` 可 mock LLM script：断言事件序列含 `token` → `token_clear` → `thinking` → `tool`。若现有测试难接，至少保证类型编译 + runtime 单测覆盖降级；engineer 测补一条 publish 列表断言更佳。

- [ ] **Step 3: typecheck / 相关测**

Run: `pnpm --filter @isotope/application test`

Expected: PASS

- [ ] **Step 4: Commit** — 跳过

---

### Task 4: Workbench 消费 `token_clear`

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: SSE `event: token_clear`
- `StreamHandlers.onTokenClear?: () => void`

- [ ] **Step 1: 解析与 handler**

在 `consumeEngineerStream` 的 event 分支增加：

```ts
} else if (event === "token_clear") {
  handlers.onTokenClear?.();
}
```

`StreamHandlers` 增加 `onTokenClear?: () => void`。

所有构造 handlers 处（含 continue 转发）：

```ts
onTokenClear: () => {
  const id = currentAssistantIdRef.current;
  if (!id) return;
  setMessages((prev) =>
    updateMessageById(prev, id, (m) => ({ ...m, content: "" })),
  );
},
```

continue 转发：

```ts
onTokenClear: () =>
  continueFlightByProject.get(project.id)?.handlers.onTokenClear?.(),
```

- [ ] **Step 2: 手动点验清单**

1. 无工具长回答：主气泡逐字出现。  
2. 「先读 index.html 再改」：旁白可能闪进主气泡后清空，thinking 出现，再工具行，最后结论流式。  
3. 刷新重连：有工具轮中途刷新，replay 后不应残留已 clear 的假结论。

- [ ] **Step 3: Commit** — 跳过

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| AC1 无工具逐字 | Task 2 + 4 |
| AC2 旁白→thinking、tool 完整后 | Task 1–4 |
| AC3 tool summary 不变 | Task 2 保留现网 tool 循环 |
| AC4 history 只 content | 无改 history 组装；assistantText 规则保证 |
| AC5 token_clear 进 hub replay | Task 3 publish → 现有 TurnHub |
| AC6 测试 | Task 1–3 |
| `tool_calls_begin` | Task 1 |
| 三路 turn | Task 3 |

无 TBD。类型名统一：`token_clear` / `onTokenClear` / `tool_calls_begin`。
