# Disconnect / Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端断开不误标「生成失败」；刷新后可订阅进行中回合（SSE 扇出 + 落库 process + 事件回放），Team 不重复开跑、不假死锁。

**Architecture:** 进程内 `TurnHub`（按 `projectId`）持有订阅者与事件缓冲；`begin*` 只 `publishTurnEvent`，HTTP SSE 只是订阅者；`continue` 在 hub 活跃时只订阅，否则对合法占位开跑；传输错误在 hub 内吞掉，不进入业务 catch。

**Tech Stack:** TypeScript、pnpm workspace、vitest、Next.js SSE、现有 StatusBadge / process UI。

**Spec:** `docs/superpowers/specs/2026-07-18-disconnect-reconnect-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：`docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + shadcn；进行中只用 StatusBadge / process，勿大营销卡。
- 依赖：`apps/web → application → 领域包`；Agent 不直接碰 `data/**`。
- 重连 = **只订阅**；禁止因断开重放整轮 / 重复 `create_task`。
- 单机 Demo：hub 为进程内存；不做 Redis / 跨进程队列。
- **未经用户要求不要 git commit**（忽略下文 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码；不改 MessageItem 大拆 / 只读编辑器。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/application/src/projects/turn-hub.ts` | 进程内 hub：ensure / destroy / publish / subscribe / isActive；安全扇出 + buffer |
| `packages/application/src/projects/turn-hub.test.ts` | hub 单测 |
| `packages/application/src/projects/turn-lock.ts` | 保持；与 hub 成对使用（acquire↔ensure，release↔destroy） |
| `packages/application/src/projects/checkpoint-process.ts` | 中途落库 `process` 的小助手（深拷贝 steps） |
| `packages/application/src/projects/stream-engineer-turn.ts` | `run()` 无 emit；publish 到 hub；send 早建占位；中途 checkpoint；传输与业务分离 |
| `packages/application/src/projects/stream-engineer-turn.test.ts` | 订阅收事件；AC2；中途 process；二次 begin 仍 conflict |
| `packages/application/src/projects/stream-team-turn.ts` | 同上（Mike/Alex/总结各自 checkpoint） |
| `packages/application/src/projects/stream-team-turn.test.ts` | 订阅不二次开跑；传输失败不 fail task |
| `packages/application/src/index.ts` | 导出 hub API + `isTurnHubActive` |
| `apps/web/app/api/projects/[id]/messages/stream/route.ts` | continue 分流；SSE subscribe + cancel unsubscribe；`void run()` |
| `apps/web/components/workbench-shell.tsx` | 占位时 StatusBadge；传输中断不改正文为生成失败；可限次再 continue |

**锁定：** `begin*` 的 `run` 改为 `() => Promise<void>`（不再接收 `emit`）。测试与路由一律经 `subscribeTurn` 收事件。

---

### Task 1: TurnHub（扇出 / 回放 / 安全 publish）

**Files:**
- Create: `packages/application/src/projects/turn-hub.ts`
- Create: `packages/application/src/projects/turn-hub.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TurnHubListener = (event: unknown) => void;

  /** 创建空 hub（若已存在则 no-op）。须在 tryAcquireTurnLock 成功后调用。 */
  export function ensureTurnHub(projectId: string): void;

  /** 拆除 hub（清 buffer / subscribers）。须在 releaseTurnLock 前或紧接调用。 */
  export function destroyTurnHub(projectId: string): void;

  export function isTurnHubActive(projectId: string): boolean;

  /**
   * 写入 buffer 并扇出。单个 listener 抛错只移除该 listener，publish 本身不抛。
   * hub 不存在时 no-op。
   */
  export function publishTurnEvent(projectId: string, event: unknown): void;

  /**
   * 若无 hub 返回 null。否则：同步 replay 当前 buffer，再加入 subscribers。
   * 返回 unsubscribe；unsubscribe 后不再收到。
   */
  export function subscribeTurn(
    projectId: string,
    listener: TurnHubListener,
  ): (() => void) | null;
  ```
- Buffer 上限：`MAX_BUFFER_EVENTS = 200`（超出丢最旧）。

- [ ] **Step 1: 写失败测试**

创建 `turn-hub.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  destroyTurnHub,
  ensureTurnHub,
  isTurnHubActive,
  publishTurnEvent,
  subscribeTurn,
} from "./turn-hub.js";

describe("turn-hub", () => {
  afterEach(() => {
    destroyTurnHub("p1");
  });

  it("publish fans out to all subscribers", () => {
    ensureTurnHub("p1");
    const a: unknown[] = [];
    const b: unknown[] = [];
    subscribeTurn("p1", (e) => a.push(e));
    subscribeTurn("p1", (e) => b.push(e));
    publishTurnEvent("p1", { type: "token", text: "x" });
    expect(a).toEqual([{ type: "token", text: "x" }]);
    expect(b).toEqual([{ type: "token", text: "x" }]);
  });

  it("subscriber throw is isolated; publish does not throw", () => {
    ensureTurnHub("p1");
    const ok: unknown[] = [];
    subscribeTurn("p1", () => {
      throw new Error("Invalid state: Controller is already closed");
    });
    subscribeTurn("p1", (e) => ok.push(e));
    expect(() =>
      publishTurnEvent("p1", { type: "token", text: "hi" }),
    ).not.toThrow();
    expect(ok).toEqual([{ type: "token", text: "hi" }]);
  });

  it("unsubscribe stops delivery; replay then live for new subscriber", () => {
    ensureTurnHub("p1");
    publishTurnEvent("p1", { type: "status", phase: "thinking" });
    publishTurnEvent("p1", { type: "token", text: "a" });
    const got: unknown[] = [];
    const unsub = subscribeTurn("p1", (e) => got.push(e));
    expect(got).toEqual([
      { type: "status", phase: "thinking" },
      { type: "token", text: "a" },
    ]);
    publishTurnEvent("p1", { type: "token", text: "b" });
    expect(got.at(-1)).toEqual({ type: "token", text: "b" });
    unsub?.();
    publishTurnEvent("p1", { type: "token", text: "c" });
    expect(got.filter((e) => (e as { text?: string }).text === "c")).toHaveLength(
      0,
    );
  });

  it("buffer drops oldest beyond 200", () => {
    ensureTurnHub("p1");
    for (let i = 0; i < 210; i++) {
      publishTurnEvent("p1", { type: "token", text: String(i) });
    }
    const got: unknown[] = [];
    subscribeTurn("p1", (e) => got.push(e));
    expect(got).toHaveLength(200);
    expect((got[0] as { text: string }).text).toBe("10");
    expect((got.at(-1) as { text: string }).text).toBe("209");
  });

  it("isTurnHubActive reflects ensure/destroy", () => {
    expect(isTurnHubActive("p1")).toBe(false);
    ensureTurnHub("p1");
    expect(isTurnHubActive("p1")).toBe(true);
    destroyTurnHub("p1");
    expect(isTurnHubActive("p1")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @isotope/application test -- src/projects/turn-hub.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `turn-hub.ts`**

```ts
export type TurnHubListener = (event: unknown) => void;

const MAX_BUFFER_EVENTS = 200;

type Hub = {
  buffer: unknown[];
  listeners: Set<TurnHubListener>;
};

const hubs = new Map<string, Hub>();

export function ensureTurnHub(projectId: string): void {
  if (hubs.has(projectId)) return;
  hubs.set(projectId, { buffer: [], listeners: new Set() });
}

export function destroyTurnHub(projectId: string): void {
  hubs.delete(projectId);
}

export function isTurnHubActive(projectId: string): boolean {
  return hubs.has(projectId);
}

export function publishTurnEvent(projectId: string, event: unknown): void {
  const hub = hubs.get(projectId);
  if (!hub) return;
  hub.buffer.push(event);
  if (hub.buffer.length > MAX_BUFFER_EVENTS) {
    hub.buffer.splice(0, hub.buffer.length - MAX_BUFFER_EVENTS);
  }
  for (const listener of [...hub.listeners]) {
    try {
      listener(event);
    } catch {
      hub.listeners.delete(listener);
    }
  }
}

export function subscribeTurn(
  projectId: string,
  listener: TurnHubListener,
): (() => void) | null {
  const hub = hubs.get(projectId);
  if (!hub) return null;
  for (const event of hub.buffer) {
    try {
      listener(event);
    } catch {
      return () => {};
    }
  }
  hub.listeners.add(listener);
  return () => {
    hub.listeners.delete(listener);
  };
}
```

在 `index.ts` 增加导出：`ensureTurnHub`、`destroyTurnHub`、`isTurnHubActive`、`publishTurnEvent`、`subscribeTurn`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @isotope/application test -- src/projects/turn-hub.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（跳过，除非用户要求）

---

### Task 2: Engineer turn → hub + 中途 process + AC2

**Files:**
- Create: `packages/application/src/projects/checkpoint-process.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.test.ts`

**Interfaces:**
- Consumes: Task 1 hub API；`tryAcquireTurnLock` / `releaseTurnLock`
- Produces:
  ```ts
  // BeginEngineerTurnResult.ok 时：
  run: () => Promise<void>;  // 不再接收 emit

  // checkpointProcess(workspace, messageId, process): void
  // — updateMessage({ process: structuredClone-ish steps })，保留 content 不变
  ```
- 开跑成功路径：`tryAcquire` → `ensureTurnHub` → … → `run` 内 `publishTurnEvent` → `finally`：`destroyTurnHub` + `releaseTurnLock`
- **send 早建占位：** 加锁后 append user，再 append `ASSISTANT_PLACEHOLDER`（agentName Alex），`replaceId` 指向该条，以便中途 checkpoint 与刷新可见（AC1）

- [ ] **Step 1: 写失败测试（追加到 `stream-engineer-turn.test.ts`）**

辅助：用 `subscribeTurn` 收集事件；`run()` 无参。

先改现有用例中所有 `await begun.run((e) => events.push(e))` 为：

```ts
const unsub = subscribeTurn(project.id, (e) =>
  events.push(e as EngineerTurnEvent),
);
await begun.run();
unsub?.();
```

（`begin` 成功后、`run` 前 hub 已 ensure，故 subscribe 非 null。）

新增：

```ts
it("publish to closed subscriber does not write 生成失败", async () => {
  const { project } = createProject(
    {
      ownerUserId: "demo",
      requirement: "x",
      mode: "engineer",
    },
    workspace,
  );
  ensureTurnHub; // 仅类型提醒：begin 会 ensure
  const begun = beginEngineerTurn(
    {
      ownerUserId: "demo",
      projectId: project.id,
      action: "continue",
    },
    {
      workspace,
      preview: mockPreview(),
      llm: llmWithDelay(
        [
          [
            { type: "content_delta", text: "你好" },
            { type: "finished", finishReason: "stop" },
          ],
        ],
        30,
      ),
      agent: createCoderAgent({ systemPrompt: "test" }),
      maxToolRounds: 8,
    },
  );
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  subscribeTurn(project.id, () => {
    throw new Error("Invalid state: Controller is already closed");
  });

  await begun.run();

  const last = workspace.listMessages(project.id).at(-1);
  expect(last?.content).toBe("你好");
  expect(last?.content.startsWith("生成失败")).toBe(false);
});

it("checkpoints process on tool boundary while placeholder remains", async () => {
  const { project } = createProject(
    {
      ownerUserId: "demo",
      requirement: "x",
      mode: "engineer",
    },
    workspace,
  );
  let resolveGate!: () => void;
  const gate = new Promise<void>((r) => {
    resolveGate = r;
  });
  let toolStarted = false;

  const begun = beginEngineerTurn(
    {
      ownerUserId: "demo",
      projectId: project.id,
      action: "continue",
    },
    {
      workspace,
      preview: mockPreview(),
      llm: {
        async *complete(_req, _signal) {
          if (!toolStarted) {
            toolStarted = true;
            yield {
              type: "tool_calls" as const,
              toolCalls: [
                {
                  id: "c1",
                  type: "function" as const,
                  function: {
                    name: "list_files",
                    arguments: JSON.stringify({ dir: "." }),
                  },
                },
              ],
            };
            yield { type: "finished" as const, finishReason: "tool_calls" };
            await gate;
            return;
          }
          yield { type: "content_delta" as const, text: "好了" };
          yield { type: "finished" as const, finishReason: "stop" };
        },
      },
      agent: createCoderAgent({ systemPrompt: "test" }),
      maxToolRounds: 8,
    },
  );
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const running = begun.run();
  // 等到 tool start 落库
  for (let i = 0; i < 50; i++) {
    await delay(10);
    const msg = workspace.listMessages(project.id).at(-1);
    if (msg?.process?.steps.some((s) => s.type === "tool")) break;
  }
  const mid = workspace.listMessages(project.id).at(-1);
  expect(mid?.content).toBe(ASSISTANT_PLACEHOLDER);
  expect(mid?.process?.steps.some((s) => s.type === "tool")).toBe(true);

  resolveGate();
  await running;
});

it("send creates placeholder early so mid-turn process can persist", async () => {
  const { project } = createProject(
    {
      ownerUserId: "demo",
      requirement: "x",
      mode: "engineer",
    },
    workspace,
  );
  // 清掉 createProject 的占位，模拟用户后续 send
  const seed = workspace.listMessages(project.id).at(-1)!;
  workspace.updateMessage(seed.id, { content: "已完成首轮" });

  let resolveGate!: () => void;
  const gate = new Promise<void>((r) => {
    resolveGate = r;
  });

  const begun = beginEngineerTurn(
    {
      ownerUserId: "demo",
      projectId: project.id,
      action: "send",
      content: "再改一下",
    },
    {
      workspace,
      preview: mockPreview(),
      llm: {
        async *complete() {
          yield { type: "content_delta" as const, text: "改完" };
          yield { type: "finished" as const, finishReason: "stop" };
          await gate;
        },
      },
      agent: createCoderAgent({ systemPrompt: "test" }),
      maxToolRounds: 8,
    },
  );
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const running = begun.run();
  await delay(20);
  const msgs = workspace.listMessages(project.id);
  const last = msgs.at(-1);
  expect(last?.role).toBe("assistant");
  expect(last?.content).toBe(ASSISTANT_PLACEHOLDER);
  resolveGate();
  await running;
});
```

（若现有 LLM mock 签名无第二参，去掉 `_signal`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-engineer-turn.test.ts`

Expected: FAIL（`run` 仍要 emit，或无 early placeholder / checkpoint）

- [ ] **Step 3: 实现 checkpoint + 改造 `stream-engineer-turn.ts`**

`checkpoint-process.ts`：

```ts
import type { MessageProcess, WorkspaceStore } from "@isotope/workspace";

export function checkpointProcess(
  workspace: WorkspaceStore,
  messageId: string,
  process: MessageProcess,
): void {
  workspace.updateMessage(messageId, {
    process: {
      steps: process.steps.map((s) =>
        s.type === "thinking"
          ? { type: "thinking" as const, text: s.text }
          : {
              type: "tool" as const,
              id: s.id,
              name: s.name,
              status: s.status,
              ...(s.summary !== undefined ? { summary: s.summary } : {}),
            },
      ),
    },
  });
}
```

`beginEngineerTurn` 关键变更要点：

1. `tryAcquireTurnLock` 成功后立刻 `ensureTurnHub(projectId)`。
2. `send`：append user 后 **再** append 占位助手，设 `replaceId`。
3. `run: async () => { ... }`：所有原 `emit(x)` 改为 `publishTurnEvent(input.projectId, x)`。
4. `onThinking`：新 thinking step 推入时 `checkpointProcess`；`onTool` start/end 后 checkpoint；`onStatus` 后可 checkpoint（可选，至少 tool 边界必须）。
5. `catch`：仅业务失败写「生成失败：…」+ `publishTurnEvent` error（hub 已隔离传输错误）。
6. `finally`：`destroyTurnHub` 然后 `releaseTurnLock`。
7. 类型：`run: () => Promise<void>`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-engineer-turn.test.ts src/projects/turn-hub.test.ts`

Expected: PASS（一并修所有因 `run(emit)` 签名变更而挂的旧测）

- [ ] **Step 5: Commit**（跳过）

---

### Task 3: Team turn → hub + checkpoint + 不重复开跑

**Files:**
- Modify: `packages/application/src/projects/stream-team-turn.ts`
- Modify: `packages/application/src/projects/stream-team-turn.test.ts`

**Interfaces:**
- Consumes: 同 Task 1–2
- Produces: `beginTeamTurn` 的 `run: () => Promise<void>`；Mike/Alex/总结消息在 tool/thinking 边界 `checkpointProcess`

- [ ] **Step 1: 写失败测试**

更新现有 `run(emit)` 为 subscribe + `run()`。

新增：

```ts
it("second begin while active returns conflict; subscribe gets events without second task", async () => {
  // 用 llmWithDelay 拉长 Mike+Alex；begin 一次后 isTurnHubActive true；
  // 第二次 beginTeamTurn → conflict；
  // subscribeTurn 能收到后续 event；
  // listTasks 长度不因「模拟重连」增加（重连路径不调用 begin）
});

it("throwing subscriber does not mark task failed or 生成失败 on mike", async () => {
  // subscribe 抛 Controller is already closed；run 成功结束；
  // 任务 completed；助手 content 无「生成失败」
});
```

（按现有 `stream-team-turn.test.ts` 的 mock LLM / createProject mode:`team` 写法补全具体脚本。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-team-turn.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现**

与 Engineer 对称：

- acquire 后 `ensureTurnHub`
- `trackProcess` 内在 thinking 新步 / tool 边界调用 `checkpointProcess(workspace, currentMessageId, process)`（`trackProcess` 需传入 `messageId` 或在闭包里可读）
- `emit` → `publishTurnEvent`
- `run: () => Promise<void>`
- `finally`：`destroyTurnHub` + `releaseTurnLock`
- **不要**在 unsubscribe / 传输错误时 `failTask`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-team-turn.test.ts src/projects/task-watchdog.test.ts`

Expected: PASS（watchdog 仍用 `isTurnLocked`，行为不变）

- [ ] **Step 5: Commit**（跳过）

---

### Task 4: SSE 路由 `continue` 分流 + 订阅生命周期

**Files:**
- Modify: `apps/web/app/api/projects/[id]/messages/stream/route.ts`

**Interfaces:**
- Consumes: `isTurnHubActive`、`subscribeTurn`、`beginEngineerTurn` / `beginTeamTurn`（`run()` 无参）
- 行为表（与 spec §7 一致）：

| 条件 | 结果 |
|------|------|
| `continue` + `isTurnHubActive` | 200 SSE，只 subscribe（replay+live），**不** begin |
| `continue` + 无 hub + 合法占位 | begin + `void run()` + subscribe |
| `continue` + 无 hub + 非占位 | 400 |
| `send` + active | 409 |
| `send` + 无 active | begin + `void run()` + subscribe |

- [ ] **Step 1: 重写 route 核心流（无独立 vitest；靠手工逻辑 + 后续 typecheck）**

将 ReadableStream 改为订阅模式。关键骨架：

```ts
import {
  // ...existing
  isTurnHubActive,
  subscribeTurn,
} from "@isotope/application";

function isClosedControllerError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Controller is already closed|Invalid state/i.test(err.message)
  );
}

function openTurnSse(projectId: string): Response {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch (err) {
          if (isClosedControllerError(err)) {
            unsub?.();
            unsub = null;
            return;
          }
          throw err;
        }
      };
      unsub = subscribeTurn(projectId, (ev) => {
        forwardTurnEvent(send, ev as EngineerTurnEvent | TeamTurnEvent);
        const type = (ev as { type?: string }).type;
        if (type === "done" || type === "error") {
          unsub?.();
          unsub = null;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
      if (!unsub) {
        send("error", { message: "回合不存在或已结束" });
        controller.close();
      }
    },
    cancel() {
      unsub?.();
      unsub = null;
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

// POST 内，校验项目之后：
if (body.action === "continue" && isTurnHubActive(id)) {
  return openTurnSse(id);
}

if (body.action === "send" && isTurnHubActive(id)) {
  return Response.json({ error: "回合进行中" }, { status: 409 });
}

// ... create deps + begin* 同现有 ...
if (!begun.ok) { /* 同现有 409/404/400 */ }

void begun.run(); // 后台跑；事件进 hub
return openTurnSse(id);
```

注意：

- **删除** `await begun.run((ev) => forward...)` 绑单 controller 的旧路径。
- `cancel` **只** unsubscribe，不 `destroyTurnHub` / 不 release lock。
- config 错误写库逻辑可保留在 begin 之前。

- [ ] **Step 2: typecheck web + application**

Run: `pnpm --filter @isotope/application typecheck && pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 3: Commit**（跳过）

---

### Task 5: Workbench 重连 UX（AC1 / 传输错误）

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: 路由新语义（continue + active → 200 SSE）
- 行为：
  1. 见占位仍 `continue`（保留）；`setAgentStatus` 初始用 `running`（若已有 `process?.steps.length`）否则 `thinking`。
  2. `consumeEngineerStream`：流正常结束但无 terminal 事件（断开）时，**不要**把助手 content 写成「连接中断，请重试」；改为 `setError("连接中断，正在恢复…")` 或静默，并在占位仍在时限次（最多 1 次）再调 `continue`。
  3. `onError`：若 message 为传输类文案（`连接中断`），**不要**用其覆盖助手 content（保持空 / 占位 / 已有过程）；业务「生成失败：…」仍可写。
  4. `continue` 遇 409：仅当本页未持有 SSE 时提示「回合进行中，请稍候」——active 订阅应返回 200，此分支主要留给竞态；可保留。
  5. 首屏 messages 已有 process 时勿清空 steps（当前 continue effect 把 content 设为 `""` 可保留，但 **保留** `process` 字段）。

- [ ] **Step 1: 改 continue effect 初始状态**

```ts
setAgentStatus(
  last.process?.steps?.length ? "running" : "thinking",
);
setMessages((prev) => {
  const copy = [...prev];
  const i = copy.length - 1;
  const cur = copy[i]!;
  copy[i] = {
    ...cur,
    content: "",
    process: cur.process, // 显式保留落库过程
  };
  return copy;
});
```

- [ ] **Step 2: 改 `consumeEngineerStream` 断开与 `onError` 策略**

在 `consumeEngineerStream` 增加可选参数或 handlers 扩展：

```ts
type StreamHandlers = {
  // ...existing
  onTransportDisconnect?: () => void;
};
```

当 `!terminal` 结束或 `catch` 时：

```ts
if (!terminal) {
  handlers.onTransportDisconnect?.() ?? handlers.onError("连接中断，请重试");
}
```

continue effect 的 handlers：

```ts
onTransportDisconnect: () => {
  setError("连接中断，正在恢复…");
  // 不改 messages content
  setAgentStatus("running");
  setSubmitting(true);
  // 限次重连：用 ref reconnectAttemptRef < 1 时再 consumeEngineerStream continue
},
onError: (message) => {
  setError(message);
  const transport = message.includes("连接中断");
  if (!transport) {
    // 现有：空/占位时写入 message
    ...
  }
  if (!transport) {
    setAgentStatus("idle");
    setSubmitting(false);
    continueInFlightRef.current = false;
  }
},
```

`send` 路径的 `onError` 可保持业务失败写 content；传输断开同样走 `onTransportDisconnect` 且不覆盖。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 4: Commit**（跳过）

---

### Task 6: 回归验收 + 更新 spec 状态

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-disconnect-reconnect-design.md`（状态 → 已批准并实现中/已落地）
- 验证命令（不改产品代码除非发现回归）

- [ ] **Step 1: 跑相关测试**

```bash
pnpm --filter @isotope/application test -- \
  src/projects/turn-hub.test.ts \
  src/projects/stream-engineer-turn.test.ts \
  src/projects/stream-team-turn.test.ts \
  src/projects/task-watchdog.test.ts
pnpm --filter @isotope/application typecheck
pnpm --filter @isotope/web typecheck
```

Expected: 全部 PASS

- [ ] **Step 2: 对照 AC 自检清单**

| AC | 验证方式 |
|----|----------|
| AC1 | 中途 checkpoint 测 + UI 保留 process；占位 StatusBadge non-idle |
| AC2 | throwing subscriber 测：无「生成失败」 |
| AC3 | hub replay 测 + continue 分流只订阅；终态落库仍由既有测覆盖 |
| AC4 | Team conflict + 任务数不增；watchdog 测仍过 |

- [ ] **Step 3: 更新 spec 状态行**

`- 状态：已批准（实现计划见 docs/superpowers/plans/2026-07-18-disconnect-reconnect.md）`

- [ ] **Step 4: Commit**（跳过）

---

## Spec coverage（自检）

| Spec 项 | Task |
|---------|------|
| TurnHub 扇出 / 安全 publish | T1 |
| buffer 回放 + 上限 | T1 |
| Engineer emit→hub、AC2、中途 process、send 早占位 | T2 |
| Team 同构、不重复开跑、不断开 failTask | T3 |
| continue 分流、SSE cancel=unsubscribe | T4 |
| UI StatusBadge / 传输不污染正文 / 保留 process | T5 |
| typecheck + AC 清单 | T6 |
| 非目标（CRDT/Redis/MessageItem 大拆） | 不实现 |

## Placeholder / 类型一致性

- `run: () => Promise<void>` 在 T2/T3/T4 一致。
- Hub API 名：`ensureTurnHub` / `destroyTurnHub` / `isTurnHubActive` / `publishTurnEvent` / `subscribeTurn`。
- 无 TBD；路由无单测文件（以 application 测 + typecheck 覆盖）。
