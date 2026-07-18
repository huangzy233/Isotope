# 设计：Team 模式 Leader 任务流最小闭环

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 前置：
  - [`2026-07-18-engineer-agent-turn-design.md`](./2026-07-18-engineer-agent-turn-design.md)
  - [`2026-07-18-agent-process-visibility-design.md`](./2026-07-18-agent-process-visibility-design.md)
- 范围：Team 与 Engineer 肉眼可分；Mike（真 LLM + `create_task`）→ 独立 Task + EventBus → Alex 执行（复用现有改码/SSE/预览）→ 自动 completed；工作台可切 mode；删项目级联清 task；interval watchdog 兜底
- UI：遵循 `docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + shadcn only

## 1. 目标

1. 新建 / 切换为 Team 后，对话区出现 **Mike | 团队领导**（角色名 + 身份标签）。
2. 用户发需求 → Mike 创建任务并指派 Alex → 任务卡可见（可点「创建 / 完成」但本轮为全自动状态展示）→ Alex 走现有改码 + 过程可见 + 写文件后自动 preview。
3. Alex 成功后任务自动 `completed`；Mike 侧任务卡状态更新。
4. Engineer 路径保持不变（不强制任务卡）。
5. 刷新后：mode、任务状态、对话可恢复；删项目后相关 task 一并删除。

## 2. 非目标

- 半自动「先点创建再执行」（留给后续 Plan 模式）
- 多工程师并行、复杂任务图
- 完整 Trace / Token 面板
- MessageItem 大拆分、ViewerChrome 重构
- 版本卡片（另开一轮）
- 跨进程队列 / Redis / 持久化 outbox
- 改 Playbook 视觉体系；无关大重构

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 任务交互节奏 | **全自动**：发需求后自动创建并指派、自动执行、自动完成；按钮以状态展示为主 |
| Mike | **真实 LLM** + Leader prompt |
| 任务创建 | Mike tool：`create_task`（title、assignee） |
| 任务完成 | Alex **成功结束**即自动 `completed`（不强制 Mike 再调 `complete_task`） |
| 任务持久化 | 独立 `Task` 表；删项目 **CASCADE** |
| 通知 | application 级 **`TaskEventBus` 端口**（进程内实现） |
| 兜底 | 常驻 **interval worker** 扫卡住任务（默认 3s / 90s） |
| 架构 | application 编排 Team 流水线；复用 `runTurn` + Alex |
| 工作台 mode | Composer Tabs 可切换；`PATCH` 落库 |
| 切换时有 turn | **允许**改 mode；当前 turn 按开始时路径跑完；下一条用新 mode |
| 身份标签 | UI 按 `agentName` 映射（Mike→团队领导，Alex→工程师）；不强制新 DB 列 |
| 任务卡挂载 | 内嵌 Mike 消息（`taskId` 关联） |
| 版本卡片 | 本轮不做 |

## 4. 成功标准

1. 评审人 2 分钟内能区分 Engineer vs Team 交互路径。
2. Team：需求 → Mike（真 LLM + `create_task`）→ Alex（过程可见）→ 自动 completed → 有写文件则 Viewer Building → Ready/Failed。
3. 刷新后 mode、对话、任务状态可恢复。
4. 删项目后无残留 task。
5. 包边界不变：`web → application → agent-runtime / agents / …`；Prompt 在 `prompts/leader/`。
6. 相关 typecheck / 测试通过。

## 5. 架构与数据流

### 5.1 包职责

| 包 | 本轮职责 |
|----|----------|
| `@isotope/workspace` | `Task` 表与 CRUD；`ON DELETE CASCADE`；`listTasks`；复用 `updateProject.mode` |
| `@isotope/application` | `beginTeamTurn` 编排；`TaskEventBus` 实现；`TeamOrchestrator`；task watchdog；`updateProjectMode`；复用 Alex turn + `enqueuePreviewBuild` |
| `@isotope/agent-runtime` | 现有 `runTurn` 供 Mike/Alex 复用（换 agent + tools）；尽量少改 |
| `@isotope/agents` | `leader`（Mike）：加载 prompt + `create_task`；Alex 不变 |
| `@isotope/llm` / `@isotope/preview` | 原则上不改 |
| `apps/web` | mode 分支 SSE；任务卡；身份标签；Composer 模式 Tabs；`PATCH` mode；拉取 tasks |
| `prompts/leader/` | Mike system prompt（禁止 TS 硬编码长文） |

### 5.2 依赖方向（不变）

```text
apps/web
  → @isotope/application
      → @isotope/agent-runtime
          → @isotope/agents
          → @isotope/llm
      → @isotope/workspace
      → @isotope/preview
```

禁止：Agent / runtime / llm 直接读写 `data/**`；`workspace` → `agents` / `preview` / `web`。

### 5.3 时序（Team `send`）

```text
appendMessage(user)
→ Mike runTurn（SSE: status / thinking / tool / token；agentName=Mike）
→ create_task tool → Task(status=assigned, assignee=Alex) → bus.publish(task.created)
→ TeamOrchestrator 订阅 → Task(running) → Alex runTurn（现有过程可见）
→ Alex 成功 → Task(completed) → bus.publish(task.completed)
→ 可选模板收尾（系统或短 Mike 文案，不再为完成单独调 LLM）
→ 若 filesChanged → enqueuePreviewBuild
→ SSE done
```

**Engineer：** 仍只走 `beginEngineerTurn`；无 Mike、无 Task、无 `task` SSE 事件。

### 5.4 占位与 continue

- Team 新建：user + **Mike** 占位（可用同一 `ASSISTANT_PLACEHOLDER` 文案，`agentName: "Mike"`）。
- 工作台挂载检测到占位 → `continue` → `beginTeamTurn`（替换 Mike 占位后跑完整流水线）。
- Engineer 新建仍为 Alex 占位；行为不变。

### 5.5 防重入

同一 `projectId` 同时只允许一个进行中的流水线（Mike+Alex 整段共用现有 turn lock）。重复 `send` / `continue`：开流前 `409` JSON。

## 6. Task 模型与 EventBus

### 6.1 Task

```ts
type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed";

type Task = {
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
```

- 表 `tasks`；`FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`。
- `PRAGMA foreign_keys = ON`（已有）。
- 端口：`createTask` / `updateTask` / `getTask` / `listTasks(projectId)`。
- 删项目后测：tasks 数为 0。

**状态机：**

```text
create_task → assigned
Orchestrator 开始 Alex → running（刷新 lastProgressAt）
Alex 成功 → completed
失败 → failed
```

本轮 assignee 仅 `Alex`。

### 6.2 TaskEventBus（application 端口）

```ts
type TaskEvent =
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task; prevStatus: TaskStatus }
  | { type: "task.completed"; task: Task }
  | { type: "task.failed"; task: Task; error?: string };

interface TaskEventBus {
  publish(event: TaskEvent): void;
  subscribe(handler: (event: TaskEvent) => void): () => void;
}
```

- 进程内实现；可注入 fake 做单测。
- **不**做持久化 outbox；可靠靠 DB 状态 + watchdog。
- `TeamOrchestrator` 订阅 `task.created`（及必要时 `task.updated`）：`assigned` 且无活跃 Alex → 启动 Alex。

### 6.3 Watchdog

- `startTaskWatchdog({ intervalMs: 3000, stuckMs: 90000 })`（web/application 单例旁启动）。
- 每 3s 扫描 `assigned | running` 且 `now - lastProgressAt > 90s`。
- `assigned` 且无 turn lock → 补触发一次 Alex（或再 publish created）。
- `running` 超时 → 标 `failed` + `task.failed`（不强制 abort 进程内 Promise；状态收敛避免 UI 永挂）。
- 已有 lock → 跳过，防双开。

## 7. API 与 SSE / UI

### 7.1 HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/projects/:id/messages/stream` | 按 `project.mode` 走 Team 或 Engineer |
| `GET` | `/api/projects/:id/messages` | 历史消息 |
| `GET` | `/api/projects/:id/tasks` | 任务列表（刷新合并用） |
| `PATCH` | `/api/projects/:id` | `{ mode }` 更新并落库 |

Stream body 不变：`{ action: "continue" }` / `{ action: "send", content }`。

### 7.2 SSE 事件（Team 增量）

沿用过程可见性事件；并增加：

| event | data | 含义 |
|-------|------|------|
| `task` | `{ taskId, status, title, assignee }` | 更新任务卡 |
| （Mike/Alex） | 现有 `status` / `thinking` / `tool` / `token` | 须带当前发言者上下文（UI 用消息上的 `agentName`） |
| `done` | 可含 `taskId`, `filesChanged`, `previewEnqueued` | 流水线结束 |
| `error` | `{ message }` | 失败 |

### 7.3 身份标签

| agentName | 标签 |
|-----------|------|
| Mike | 团队领导 |
| Alex | 工程师 |

展示：`Mike | 团队领导`、`Alex | 工程师`。Engineer 路径下 Alex 同样补标签。

### 7.4 任务卡 UI

- 弱边框：标题、`@Alex`、状态 Badge。
- 「创建任务」「完成任务」：全自动下以展示为主；完成后「完成」为 disabled/已完成态；点击不改编排。
- 内嵌于 Mike 消息（`taskId`）；刷新用 `listTasks` 合并最新状态。

### 7.5 模式切换

- Composer 次要行 Engineer / Team Tabs。
- `PATCH` → `workspace.updateProject`；侧栏/本地 state 同步。
- 进行中 turn 允许改 mode；当前 turn 不打断；下一条按新 mode。

## 8. 错误处理

| 情况 | 行为 |
|------|------|
| 未登录 / 非主人 / 无项目 | `401` / `404` |
| 回合进行中 | `409` |
| 缺 key / Mike LLM 失败 | SSE `error`；无 task 则不启 Alex；`continue` 替换占位为失败文案 |
| Mike 未调 `create_task` | 编排失败 `error`；不启 Alex |
| Alex 失败 | task → `failed`；SSE `error`；仅 `filesChanged` 时 enqueue preview |
| Watchdog 补触发仍失败 | `failed` |
| 切 mode 失败 | 用户可见错误；不打断当前 turn |
| 删项目 | CASCADE 清 tasks |

## 9. 测试

1. workspace：Task CRUD；删 project → tasks 空。
2. EventBus：subscribe / publish / unsubscribe；orchestrator 响应 `created`（mock Alex）。
3. Team 流水线（mock LLM）：send → create_task → Alex → completed；SSE 含 `task`。
4. Engineer 回归：无 task 事件。
5. `PATCH` mode + 刷新保持。
6. Watchdog：卡住 `assigned` 会补触发（可注入 `stuckMs`）。
7. 相关包 typecheck / test；`@isotope/web` typecheck。

## 10. 默认参数

| 参数 | 值 |
|------|-----|
| `intervalMs` | 3000 |
| `stuckMs` | 90000 |
| assignee | 仅 `Alex` |

## 11. 与前置 spec 的关系

- Engineer 回合与过程可见性 **保持**；本 spec 在 Team 下增加 Mike 段与 Task 编排。
- 前置 spec 中「Team 暂与 Engineer 同一路径」由本 spec **取代**（仅 Team；Engineer 不变）。
