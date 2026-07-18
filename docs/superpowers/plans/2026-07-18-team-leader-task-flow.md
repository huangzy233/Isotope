# Team Leader Task Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Team 与 Engineer 肉眼可分，并跑通 Mike（真 LLM + `create_task`）→ Task/EventBus → Alex 改码/SSE/预览 → 自动 completed 的最小闭环。

**Architecture:** `web` 按 `project.mode` 分支 SSE → `application.beginTeamTurn`（Mike `runTurn` → Task 落库 + `TaskEventBus` → 同锁内驱动 Alex → 自动 completed + 条件 enqueue）→ 复用 `agent-runtime.runTurn`；`TaskWatchdog` interval 兜底；Engineer 仍走 `beginEngineerTurn` 不变。

**Tech Stack:** TypeScript、pnpm workspace、vitest、better-sqlite3、Next.js App Router SSE、现有 shadcn Composer/Tabs/Badge、yaml 读 configs。

**Spec:** `docs/superpowers/specs/2026-07-18-team-leader-task-flow-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- UI：遵循 `docs/ui/`（README → design-principles → ai-surfaces）；Neutral Tool + shadcn only；禁止自写 CSS 皮肤、硬编码色、Demo/Landing 风。
- 依赖：`web → application → agent-runtime → agents|llm`；`application → workspace|preview`；禁止 Agent/llm 直接读写 `data/**`；禁止 TS 硬编码长 Prompt。
- 全自动任务流：按钮只展示状态；半自动确认不做。
- Watchdog 默认：`intervalMs=3000`，`stuckMs=90000`；assignee 仅 `Alex`。
- 不做：版本卡片、多工程师并行、复杂任务图、完整 Trace、MessageItem 大拆分、跨进程队列。
- **未经用户要求不要 git commit**（忽略下文若出现的 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关代码。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/workspace/src/domain/types.ts` | `Task` / `TaskStatus`；`Message.taskId?` |
| `packages/workspace/src/infra/db.ts` | `tasks` 表 + `messages.task_id`；CASCADE |
| `packages/workspace/src/app/workspace-store.ts` | Task CRUD；删项目清 tasks；append/update `taskId` |
| `packages/workspace/src/app/workspace-store.test.ts` | Task + cascade 测 |
| `packages/workspace/src/index.ts` | 导出 Task 类型 |
| `packages/agents/src/leader/tools.ts` | `create_task` 定义与执行 |
| `packages/agents/src/leader/index.ts` | Mike `LeaderAgent` |
| `packages/agents/src/index.ts` | 导出 leader |
| `prompts/leader/mike-system.v1.md` | Mike system prompt |
| `packages/agent-runtime/src/domain/types.ts` | `TurnAgent` 结构类型（兼容 Coder/Leader） |
| `packages/agent-runtime/src/app/run-turn.ts` | 用 `TurnAgent`；`filesChanged` 仍仅 `write_file` |
| `packages/application/src/projects/task-event-bus.ts` | `TaskEventBus` 进程内实现 |
| `packages/application/src/projects/task-event-bus.test.ts` | bus 测 |
| `packages/application/src/projects/task-watchdog.ts` | interval 扫描兜底 |
| `packages/application/src/projects/task-watchdog.test.ts` | 可注入间隔 |
| `packages/application/src/projects/stream-team-turn.ts` | `beginTeamTurn` + `retryStuckAssignedTask` |
| `packages/application/src/projects/stream-team-turn.test.ts` | 流水线（mock LLM） |
| `packages/application/src/projects/update-project-mode.ts` | mode PATCH 用例 |
| `packages/application/src/projects/create-project.ts` | Team 占位 `agentName: Mike` |
| `packages/application/src/projects/list-tasks.ts` | 列表用例 |
| `packages/application/src/projects/turn-lock.ts` | 导出 `isTurnLocked` |
| `packages/application/src/index.ts` | 导出 |
| `apps/web/lib/paths.ts` | `mikeSystemPromptPath` |
| `apps/web/lib/agent.ts` | `createTeamTurnDeps` |
| `apps/web/lib/task-runtime.ts` | 单例 bus + 启动 watchdog |
| `apps/web/app/api/projects/[id]/messages/stream/route.ts` | mode 分支 + `speaker`/`task` |
| `apps/web/app/api/projects/[id]/tasks/route.ts` | GET tasks |
| `apps/web/app/api/projects/[id]/route.ts` | PATCH mode |
| `apps/web/components/workbench-shell.tsx` | 标签、任务卡、mode Tabs、多 speaker SSE |
| `apps/web/components/agent-identity.ts` | `agentName → 身份标签` |
| `apps/web/components/task-card.tsx` | 任务卡 |

**编排锁定（相对 spec 的实现澄清）：** `beginTeamTurn` 持有 turn lock 期间，Mike 的 `create_task` 只写 DB + `bus.publish`；**同一 `run()` 在 Mike `runTurn` 返回后同步启动 Alex**（不在 subscribe 回调里异步抢锁）。Watchdog 仅在 **无 lock** 时对卡住的 `assigned` 调用 `retryStuckAssignedTask`。

**SSE 增量锁定：** 增加 `speaker` 事件 `{ agentName, messageId }`，便于 UI 从 Mike 气泡切到 Alex 气泡。

---

### Task 1: Workspace Task 持久化 + Message.taskId + 级联删除

**Files:**
- Modify: `packages/workspace/src/domain/types.ts`
- Modify: `packages/workspace/src/infra/db.ts`
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/app/workspace-store.test.ts`
- Modify: `packages/workspace/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TaskStatus =
    | "pending"
    | "assigned"
    | "running"
    | "completed"
    | "failed";

  export type Task = {
    id: string;
    projectId: string;
    title: string;
    assignee: "Alex";
    status: TaskStatus;
    createdByMessageId?: string;
    assigneeMessageId?: string;
    createdAt: string;
    updatedAt: string;
    lastProgressAt: string;
  };

  // Message 增加 taskId?: string

  // WorkspaceStore 增加：
  createTask(input: {
    projectId: string;
    title: string;
    assignee: "Alex";
    status?: TaskStatus;
    createdByMessageId?: string;
  }): Task;
  updateTask(
    taskId: string,
    patch: Partial<
      Pick<
        Task,
        | "title"
        | "status"
        | "assigneeMessageId"
        | "createdByMessageId"
        | "lastProgressAt"
      >
    >,
  ): Task | null;
  getTask(taskId: string): Task | null;
  listTasks(projectId: string): Task[];
  listTasksByStatus(statuses: TaskStatus[]): Task[];
  // appendMessage / updateMessage 支持 taskId?: string | null
  ```

- [ ] **Step 1: 写失败测试**

在 `workspace-store.test.ts` 追加：

```ts
  it("createTask / updateTask / listTasks and cascade on deleteProject", () => {
    const p = store.createProject({
      ownerUserId: "demo",
      name: "x",
      mode: "team",
    });
    const mike = store.appendMessage({
      projectId: p.id,
      role: "assistant",
      content: "拆任务",
      agentName: "Mike",
    });
    const task = store.createTask({
      projectId: p.id,
      title: "统一文案",
      assignee: "Alex",
      status: "assigned",
      createdByMessageId: mike.id,
    });
    expect(task.status).toBe("assigned");
    expect(task.assignee).toBe("Alex");
    expect(store.listTasks(p.id)).toHaveLength(1);

    const linked = store.updateMessage(mike.id, { taskId: task.id });
    expect(linked?.taskId).toBe(task.id);

    const running = store.updateTask(task.id, { status: "running" });
    expect(running?.status).toBe("running");
    expect(running?.lastProgressAt).toBeTruthy();

    store.deleteProject(p.id);
    expect(store.getTask(task.id)).toBeNull();
    expect(store.listTasks(p.id)).toEqual([]);
  });
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/workspace test -- src/app/workspace-store.test.ts`

Expected: FAIL（`createTask` 等不存在）

- [ ] **Step 3: 实现类型、表、CRUD**

`domain/types.ts`：加入 `TaskStatus`、`Task`；`Message` 加 `taskId?: string`。

`infra/db.ts`：增加 `tasks` 表（`ON DELETE CASCADE`）与 `messages.task_id` 列迁移（模式同现有 `process_json`）。

`workspace-store.ts`：
- `randomId` 支持 `"task_"`。
- `createTask`：默认 `status: "assigned"`；时间戳三字段同 `now`。
- `updateTask`：`status` 变更时刷新 `lastProgressAt`（除非 patch 显式传入）。
- `listTasksByStatus`：`WHERE status IN (...)`。
- `deleteProject` 事务内显式 `DELETE FROM tasks WHERE project_id = ?`，再 messages、projects。
- message 读写带 `task_id`。

`index.ts` 导出 `Task`、`TaskStatus`。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @isotope/workspace test -- src/app/workspace-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（跳过，除非用户要求）

---

### Task 2: TaskEventBus + TaskWatchdog

**Files:**
- Create: `packages/application/src/projects/task-event-bus.ts`
- Create: `packages/application/src/projects/task-event-bus.test.ts`
- Create: `packages/application/src/projects/task-watchdog.ts`
- Create: `packages/application/src/projects/task-watchdog.test.ts`
- Modify: `packages/application/src/projects/turn-lock.ts`（导出 `isTurnLocked`）

**Interfaces:**
- Produces:
  ```ts
  export type TaskEvent =
    | { type: "task.created"; task: Task }
    | { type: "task.updated"; task: Task; prevStatus: TaskStatus }
    | { type: "task.completed"; task: Task }
    | { type: "task.failed"; task: Task; error?: string };

  export type TaskEventBus = {
    publish(event: TaskEvent): void;
    subscribe(handler: (event: TaskEvent) => void): () => void;
  };

  export function createTaskEventBus(): TaskEventBus;

  export type TaskWatchdogDeps = {
    workspace: WorkspaceStore;
    bus: TaskEventBus;
    isTurnLocked: (projectId: string) => boolean;
    onRetryAssigned: (task: Task) => void | Promise<void>;
    intervalMs?: number;
    stuckMs?: number;
    now?: () => number;
  };

  export function startTaskWatchdog(deps: TaskWatchdogDeps): () => void;

  export function isTurnLocked(projectId: string): boolean;
  ```

- [ ] **Step 1: 写 bus 测试并实现**

```ts
// task-event-bus.ts
export function createTaskEventBus(): TaskEventBus {
  const handlers = new Set<(event: TaskEvent) => void>();
  return {
    publish(event) {
      for (const h of [...handlers]) h(event);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
```

测试：双订阅、unsubscribe 后不再收到。

Run: `pnpm --filter @isotope/application test -- src/projects/task-event-bus.test.ts`

Expected: PASS

- [ ] **Step 2: turn-lock 导出 isTurnLocked**

```ts
export function isTurnLocked(projectId: string): boolean {
  return locks.has(projectId);
}
```

- [ ] **Step 3: 写 watchdog 测试并实现**

逻辑：每 `intervalMs`（默认 3000）取 `listTasksByStatus(["assigned","running"])`；若 `now - lastProgressAt > stuckMs`（默认 90000）且 `!isTurnLocked`：
- `assigned` → `onRetryAssigned(task)`
- `running` → `updateTask(failed)` + `bus.publish(task.failed)` + `task.updated`

测试用 `intervalMs: 20`、人为把 `lastProgressAt` 设为 120s 前，断言 `onRetryAssigned` 被调用。构造 `createFsSqliteWorkspace` 的方式对齐现有 `workspace-store.test.ts` / `projects.test.ts`。

Run: `pnpm --filter @isotope/application test -- src/projects/task-watchdog.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**（跳过）

---

### Task 3: Leader（Mike）agent + prompt

**Files:**
- Create: `packages/agents/src/leader/tools.ts`
- Create: `packages/agents/src/leader/index.ts`
- Create: `packages/agents/src/leader/tools.test.ts`
- Modify: `packages/agents/src/index.ts`
- Modify: `packages/agents/package.json`（若无 `test` script，加 `"test": "vitest run"`，对齐 coder 包）
- Create: `prompts/leader/mike-system.v1.md`

**Interfaces:**
- Produces:
  ```ts
  export const LEADER_DISPLAY_NAME = "Mike";

  export type TaskToolPort = {
    createTask(input: {
      title: string;
      assignee: "Alex";
    }): { taskId: string; title: string; assignee: "Alex" };
  };

  export type LeaderAgent = {
    displayName: typeof LEADER_DISPLAY_NAME;
    systemPrompt: string;
    tools: LlmToolDefinition[];
    executeTool(
      name: string,
      argsJson: string,
      port: TaskToolPort,
    ): { ok: true; result: string } | { ok: false; error: string };
  };

  export function createLeaderAgent(input: {
    systemPrompt: string;
  }): LeaderAgent;
  ```

- [ ] **Step 1: 写 prompt**

`prompts/leader/mike-system.v1.md`：

```markdown
你是 Mike，Isotope 的团队领导。

职责：
1. 用简短中文说明你将如何拆解用户需求。
2. 必须调用工具 create_task，指派给 Alex（工程师）执行改码。
3. 每个用户需求本轮只创建一个任务；title 简洁（一句话）。
4. 不要自己改代码；不要假装已完成实现。

语气：简洁、协作、可执行。
```

- [ ] **Step 2: tools + agent + 测试**

`create_task` tool：`title` + `assignee` enum `["Alex"]`。  
`executeLeaderTool`：校验 JSON / 非空 title / assignee===Alex，再调 `port.createTask`，`result` 为 JSON 字符串。

```ts
it("create_task calls port", () => {
  const port = {
    createTask: vi.fn(() => ({
      taskId: "task_1",
      title: "改文案",
      assignee: "Alex" as const,
    })),
  };
  const r = executeLeaderTool(
    "create_task",
    JSON.stringify({ title: "改文案", assignee: "Alex" }),
    port,
  );
  expect(r.ok).toBe(true);
  expect(port.createTask).toHaveBeenCalled();
});
```

Run: `pnpm --filter @isotope/agents test`

Expected: PASS

- [ ] **Step 3: Commit**（跳过）

---

### Task 4: runTurn 接受 TurnAgent（兼容 Leader）

**Files:**
- Modify: `packages/agent-runtime/src/domain/types.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.ts`（仅随类型调整，行为不变）

**Interfaces:**
- Produces:
  ```ts
  export type TurnAgent<TPort = unknown> = {
    displayName: string;
    systemPrompt: string;
    tools: LlmToolDefinition[];
    executeTool(
      name: string,
      argsJson: string,
      port: TPort,
    ): { ok: true; result: string } | { ok: false; error: string };
  };

  export type RunTurnInput<TPort = WorkspaceToolPort> = {
    llm: LlmClient;
    agent: TurnAgent<TPort>;
    port: TPort;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    maxToolRounds: number;
    signal?: AbortSignal;
    onToken: (text: string) => void;
    onThinking?: (text: string) => void;
    onTool?: (ev: ToolEvent) => void;
    onStatus?: (phase: TurnPhase) => void;
  };
  ```

- [ ] **Step 1: 改类型，去掉对 `CoderAgent` 的硬依赖**

保留默认 `WorkspaceToolPort`；`filesChanged` 逻辑仍为 tool 名 `write_file` 且 ok。

- [ ] **Step 2: 跑测**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: PASS

- [ ] **Step 3: Commit**（跳过）

---

### Task 5: `beginTeamTurn` 编排 + mode/listTasks + Team 占位

**Files:**
- Create: `packages/application/src/projects/stream-team-turn.ts`
- Create: `packages/application/src/projects/stream-team-turn.test.ts`
- Create: `packages/application/src/projects/update-project-mode.ts`
- Create: `packages/application/src/projects/list-tasks.ts`
- Modify: `packages/application/src/projects/create-project.ts`
- Modify: `packages/application/src/projects/projects.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TeamTurnEvent =
    | { type: "speaker"; agentName: "Mike" | "Alex"; messageId: string }
    | { type: "status"; phase: "thinking" | "running" | "streaming" }
    | { type: "thinking"; text: string }
    | {
        type: "tool";
        id: string;
        name: string;
        state: "start" | "end";
        summary?: string;
        ok?: boolean;
      }
    | { type: "token"; text: string }
    | {
        type: "task";
        taskId: string;
        status: TaskStatus;
        title: string;
        assignee: "Alex";
      }
    | {
        type: "done";
        messageId: string;
        filesChanged: boolean;
        previewEnqueued: boolean;
        taskId?: string;
      }
    | { type: "error"; message: string };

  export type TeamTurnDeps = {
    workspace: WorkspaceStore;
    preview: PreviewService;
    llm: LlmClient;
    leader: LeaderAgent;
    coder: CoderAgent;
    bus: TaskEventBus;
    maxToolRounds: number;
  };

  export function beginTeamTurn(
    input: EngineerTurnInput,
    deps: TeamTurnDeps,
  ): BeginEngineerTurnResult;

  export function retryStuckAssignedTask(
    task: Task,
    deps: TeamTurnDeps,
  ): Promise<{ ok: boolean; error?: string }>;

  export function updateProjectMode(
    input: { ownerUserId: string; projectId: string; mode: ProjectMode },
    workspace: WorkspaceStore,
  ): Project | null;

  export function listTasks(
    input: { ownerUserId: string; projectId: string },
    workspace: WorkspaceStore,
  ): Task[] | null;
  ```

- [ ] **Step 1: createProject Team 占位改为 Mike**

```ts
    agentName: input.mode === "team" ? "Mike" : "Alex",
```

更新 `projects.test.ts`：team 模式期望 `Mike`。

- [ ] **Step 2: 写 stream-team-turn 测试（mock LLM）**

对齐 `stream-engineer-turn.test.ts` 的 mock 手法。覆盖：
1. send：Mike `create_task` → Alex 正文 → task `completed`；emit 含 `speaker`×2、`task` 状态推进、`done.taskId`。
2. Mike 不调 tool → `error`，无 Alex `speaker`。
3. `retryStuckAssignedTask`：已有 assigned task → Alex 跑完 → completed。

- [ ] **Step 3: 实现 beginTeamTurn**

流程（必须落成真实代码，勿留伪实现）：
1. 鉴权 / continue 占位校验（`ASSISTANT_PLACEHOLDER`；agent 可为 Mike）/ send append user / `tryAcquireTurnLock`。
2. emit `speaker` Mike；`runTurn(leader, taskPort)`；`taskPort.createTask` 写库、`updateMessage.taskId`、`bus.publish(created)`、emit `task`。
3. 若无 `createdTaskId` → emit error，release lock，return。
4. task → `running` + bus/emit；append Alex 消息；emit `speaker` Alex；`runTurn(coder, filePort)`。
5. Alex 成功 → task `completed` + bus/emit；`filesChanged` 则 `enqueuePreviewBuild`；emit `done`（含 `taskId`）。
6. catch：有 task 则 `failed`；emit `error`；finally `releaseTurnLock`。

History：只 `content`，过滤占位；Mike 结论进入 Alex history。

`retryStuckAssignedTask`：`tryAcquireTurnLock` 失败则 `{ ok:false }`；只跑 Alex 段（title 作额外 user 上下文可选：用 task.title）；成功 completed。

`updateProjectMode` / `listTasks`：`getProject` 后更新/列表。

- [ ] **Step 4: 跑测**

```bash
pnpm --filter @isotope/application test -- src/projects/stream-team-turn.test.ts src/projects/projects.test.ts src/projects/stream-engineer-turn.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**（跳过）

---

### Task 6: Web API — stream 分支、tasks、mode PATCH、runtime 单例

**Files:**
- Modify: `apps/web/lib/paths.ts`
- Modify: `apps/web/lib/agent.ts`
- Create: `apps/web/lib/task-runtime.ts`
- Modify: `apps/web/app/api/projects/[id]/messages/stream/route.ts`
- Create: `apps/web/app/api/projects/[id]/tasks/route.ts`
- Modify: `apps/web/app/api/projects/[id]/route.ts`
- Modify: `apps/web/lib/workspace.ts`（或 stream 顶部）调用 `ensureTaskRuntime()`

**Interfaces:**
- Produces:
  ```ts
  export function mikeSystemPromptPath(): string;

  export function createTeamTurnDeps(): {
    llm: LlmClient;
    leader: LeaderAgent;
    coder: CoderAgent;
    maxToolRounds: number;
  };

  export function getTaskBus(): TaskEventBus;
  export function ensureTaskRuntime(): void;
  ```

- [ ] **Step 1: paths + createTeamTurnDeps**

读 `prompts/leader/mike-system.v1.md` + Alex prompt；共享 llm；返回 leader+coder。

- [ ] **Step 2: task-runtime**

单例 `createTaskEventBus()`；`startTaskWatchdog({ onRetryAssigned: (task) => retryStuckAssignedTask(task, fullDeps) })`；`ensureTaskRuntime` 幂等。

- [ ] **Step 3: stream route**

`getProject` 后：`team` → `beginTeamTurn` + bus；否则 `beginEngineerTurn`。  
SSE 增加 `speaker` / `task`；`done` 转发可选 `taskId`。

- [ ] **Step 4: GET `/tasks` + PATCH mode**

`listTasks` / `updateProjectMode`；401/404/400 文案简体中文。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: 若仅缺 UI 引用则 API 相关应通过；UI 在 Task 7 补齐后再跑一次。

- [ ] **Step 6: Commit**（跳过）

---

### Task 7: Workbench UI — 身份标签、任务卡、mode Tabs、多 speaker SSE

**Files:**
- Create: `apps/web/components/agent-identity.ts`
- Create: `apps/web/components/task-card.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function agentRoleLabel(agentName: string | undefined): string | null;
  // Mike → 团队领导；Alex → 工程师

  export function TaskCard(props: {
    title: string;
    assignee: string;
    status: TaskStatus;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: agent-identity + TaskCard**

展示 `Name | 身份`；任务卡弱边框 + Badge + 「创建任务」「完成任务」按钮（点击 no-op；`completed` 时完成按钮 disabled）。

状态文案：`pending` 待创建 / `assigned` 待执行 / `running` 执行中 / `completed` 已完成 / `failed` 失败。

- [ ] **Step 2: MessageRow**

非用户：`${agentName} | ${role}`；有 `taskId` 且 tasks map 有值则渲染 `TaskCard`。

- [ ] **Step 3: mode Tabs + 拉 tasks**

`useState(project.mode)`；Composer `toolbar` 用与首页相同的 Tabs；`PATCH /api/projects/:id`；失败回滚并 `setError`。  
挂载 `GET .../tasks` 填入 map。

- [ ] **Step 4: SSE 多 speaker**

扩展 stream 消费：`onSpeaker` / `onTask`。  
Team send 初始 temp 助手为 Mike；`onSpeaker` 切到 Alex 时 **append** 新助手消息，后续 thinking/tool/token 打到当前助手（用 ref 保存当前 messageId）。  
`onTask` 更新 tasks map 与 Mike 消息 `taskId`。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @isotope/web typecheck`

Expected: PASS

- [ ] **Step 6: Commit**（跳过）

---

### Task 8: 回归与终验

- [ ] **Step 1: 全量相关测**

```bash
pnpm --filter @isotope/workspace test
pnpm --filter @isotope/agents test
pnpm --filter @isotope/agent-runtime test
pnpm --filter @isotope/application test
pnpm --filter @isotope/web typecheck
```

Expected: 全部 PASS

- [ ] **Step 2: 手工验收清单**

1. Engineer：仅 `Alex | 工程师`；无任务卡。
2. Team：`Mike | 团队领导` → 任务卡 → `Alex | 工程师` → 有写文件则 Viewer Building → Ready/Failed。
3. 工作台切 mode；刷新后 mode / 对话 / 任务仍在。
4. 删项目后无残留 task（单测已覆盖；可选手动 sqlite 抽查）。

- [ ] **Step 3: Commit**（跳过，除非用户要求）

---

## Spec coverage（自检）

| Spec 项 | Task |
|---------|------|
| Task 表 + CASCADE | 1 |
| Message.taskId | 1, 7 |
| TaskEventBus | 2 |
| Watchdog 3s/90s | 2, 6 |
| Mike LLM + create_task | 3, 5 |
| runTurn 复用 / TurnAgent | 4, 5 |
| beginTeamTurn + 自动 completed | 5 |
| Team 占位 Mike | 5 |
| updateProjectMode / listTasks | 5, 6 |
| SSE speaker/task + mode 分支 | 6, 7 |
| 身份标签 / 任务卡 / Tabs | 7 |
| Engineer 不变 | 5 回归 + 8 |
| Prompt 外置 | 3 |
| 版本卡片 / 半自动 | 明确不做 |

## Type consistency

- `TaskStatus` / `Task` / `assignee: "Alex"` 全文一致。
- `TaskEvent` 四类与 spec 一致。
- SSE：`speaker` / `task` + 既有过程事件；`done.taskId?`。
- `beginTeamTurn` 输入同 `EngineerTurnInput`；deps 含 `leader` + `coder` + `bus`。
