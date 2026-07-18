# 设计：断线重连（进行中回合 / 任务状态恢复）

- 日期：2026-07-18
- 状态：待用户审阅 spec
- 前置：
  - [`2026-07-18-engineer-agent-turn-design.md`](./2026-07-18-engineer-agent-turn-design.md)
  - [`2026-07-18-agent-process-visibility-design.md`](./2026-07-18-agent-process-visibility-design.md)
  - [`2026-07-18-team-leader-task-flow-design.md`](./2026-07-18-team-leader-task-flow-design.md)
- PRD：`docs/PRD.md` §3 P0「断线重连」、§7.10 AC1–AC4、标准 F
- UI：`docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + shadcn；进行中用现有 `StatusBadge` / process 步骤，勿大营销卡
- 架构：`docs/architecture/PROJECT_SKELETON.md`；`apps/web → application → 领域包`

## 1. 目标

1. 客户端断开（刷新 / 关页 / 网络中断）不得把仍在服务端运行的回合误标为「生成失败」；传输层错误与真正 LLM/业务失败区分开。
2. 进行中刷新或重新登录进入工作台：能看到进行中状态（占位 / 已落库 process / Streaming·Running），不是空白。
3. 断开期间回合正常结束：再次进入可见最终结论与过程；若仍在跑：可恢复 SSE 订阅并看到后续进度直至结束。
4. Team：进行中 task 状态刷新后仍正确；不因重连重复开跑或假死锁。

## 2. 非目标

- 多设备同时编辑同一回合的完整 CRDT
- 断点续跑换模型 / 跨进程分布式队列（单机 Demo 优先；进程内存 hub）
- 只读编辑器、git 回滚、MessageItem 大拆
- WebSocket 替换 SSE
- 多 Node 实例之间的 turn 迁移

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 重连语义 | **只订阅进度**；不重放整轮 LLM / 不重复开任务 |
| 传输 | 进程内 **SSE 扇出**；新连接挂到已有 turn |
| API 形状 | `action: "continue"` **语义分流**：有活跃 turn → 订阅；无活跃 + 合法占位 → 开跑 |
| 刷新可见过程 | **落库快照 + 内存事件缓冲回放**（两者都做） |
| 进程死掉兜底 | 无活跃 hub + 合法占位 → 允许 `continue` **重新开跑** |
| 架构 | 方案 1：进程内 **TurnHub**（与 turn-lock 协作） |
| `send` 冲突 | 已有活跃 turn 时仍 **409**（禁止并行再发） |
| Team / 锁 | 断开 **不**释放 turn lock；不因重连再次 `beginTeamTurn` |

## 4. 成功标准（验收）

| ID | 标准 |
|----|------|
| AC1 | 回合进行中刷新工作台，仍见进行中指示（占位 / 已落库 process / StatusBadge），不是空白或立刻失败 |
| AC2 | 客户端断开后，服务端回合若仍在跑，不因 SSE `Controller is already closed` 等把助手消息写成「生成失败：…」 |
| AC3 | 断开期间正常结束后再进可见终态；仍在跑则可 `continue` 订阅 + replay 看到后续进度 |
| AC4 | Team 任务状态刷新后正确；与锁/watchdog 一致；无假死锁、无重复开跑 |
| 工程 | 相关 typecheck / 单测通过；用户可见文案简体中文 |

## 5. 现状根因（实现约束）

1. `messages/stream/route.ts` 把 `begun.run(emit)` 与单个 `ReadableStream` controller 绑死；客户端断开后 controller 关闭，后续 `enqueue` 抛 `Controller is already closed`。
2. 该异常落入 `stream-engineer-turn` / `stream-team-turn` 的业务 `catch`，把占位写成「生成失败：…」。
3. `turn-lock` 为进程内内存；与「刷新仍进行中」语义纠缠——刷新后 `continue` 在持锁时返回 409，UI 当错误处理，且看不到进行中过程。
4. `process` 目前多在终态才完整落库；中途刷新难以看到已发生的工具/思考步骤。

## 6. 架构：TurnHub

### 6.1 包职责

| 包 | 增量 |
|----|------|
| `@isotope/application` | `TurnHub`（按 `projectId`）；`publish` / `subscribe` / `replay`；与 `turn-lock` 协作；`begin*` 的 emit 只走 hub；中途落库 `process` |
| `apps/web` route | `continue` 分流；SSE 作为订阅者；`cancel`/`finally` 只 unsubscribe |
| `apps/web` workbench | 见占位仍 `continue`；容忍订阅恢复；传输断开不写「生成失败」到消息正文 |
| `@isotope/workspace` | 若需，允许占位消息携带进行中 `process`（已有 `updateMessage` + `process` 即可则不改 schema） |
| watchdog / Team | 行为保持：持锁 skip；无锁才 retry assigned / fail stuck running |

### 6.2 依赖方向（不变）

```text
apps/web → application → workspace | agent-runtime | …
```

### 6.3 Hub 模型（概念）

每个 `projectId` 至多一个活跃 hub：

| 字段 | 含义 |
|------|------|
| `subscribers` | 当前 SSE 连接的安全 enqueue 回调 |
| `buffer` | 本轮已 publish 事件环（有上限） |
| `active` | 是否有进行中 turn |

对外能力：

- `isActive(projectId)` / 与 `isTurnLocked` 对齐或由其派生
- `subscribe(projectId, send) → unsubscribe`：先 replay buffer，再加入 subscribers
- `publish(projectId, event)`：写入 buffer + 扇出；**单个订阅者失败不影响其他，也不抛回调用方**
- 开跑时创建 hub；业务终态（done / 业务 error）后清空并与 `releaseTurnLock` 一起拆除

### 6.4 生命周期

```text
send / continue(开跑)
  → tryAcquireTurnLock
  → create hub
  → run(turn) 仅 hub.publish
  → 订阅者可随时 join/leave
  → done | 业务 error
  → publish 终态 → release lock → destroy hub

continue(订阅)
  → hub active?
       yes → replay + subscribe（不 begin）
       no  → 合法占位? begin : 400
```

客户端断开：只 `unsubscribe`；**不** release lock；**不**结束 turn。

## 7. API：`continue` 分流

`POST /api/projects/:id/messages/stream`，body 仍为 `{ action: "continue" | "send", content? }`。

| 条件 | HTTP | 行为 |
|------|------|------|
| `send` + 无活跃 | 200 SSE | 开跑；该连接为首个订阅者 |
| `send` + 已活跃 | 409 JSON | 「回合进行中」（禁止并行发送） |
| `continue` + 已活跃 | 200 SSE | **只订阅**：replay → live |
| `continue` + 无活跃 + 末条合法占位 | 200 SSE | **开跑**（进程重启兜底） |
| `continue` + 无活跃 + 非占位 | 400 | 请求无效 |
| 未登录 / 无项目 | 401 / 404 | 同现有 |

说明：刷新后 workbench 仍「见占位就 continue」，无需新 action；「409 = 冲突」从重连主路径移除（仅 `send` 冲突保留）。

## 8. 落库快照 + 内存回放

### 8.1 落库

- 进行中：当前正在生成的助手消息 `content` 保持 `ASSISTANT_PLACEHOLDER`，直到该条业务终态（Team 下 Mike / Alex / 总结各自一条，互不影响）。
- 在 **tool start/end、status 变化、thinking 步边界** 将**该条消息**当前 `MessageProcess` `updateMessage` 落库。
- **不**对每个 token 落库（避免写放大）。
- 终态：写入该条最终 `content` + 完整 `process`（成功或业务失败文案）。

### 8.2 缓冲回放

- hub buffer 保留本轮已 `publish` 的事件（含 token）。
- 新订阅者：按序 replay，再收 live。
- 上限建议：最近约 200 条事件或约 256KB，超出丢弃最旧；极早 token 可能不全，以落库 `process` 为准。

### 8.3 错误边界（钉死 AC2）

- `hub.publish` / SSE `enqueue` 使用**独立** try/catch。
- `Controller is already closed`、连接已取消等：**只移除该订阅者**（可打日志），**绝不**抛入 `stream-*-turn` 业务 `catch`。
- 业务 `catch` 仅处理 LLM / 工具 / 编排失败 → 才写「生成失败：…」并 `publish({ type: "error", ... })`。

## 9. UI 恢复（workbench）

- 末条为占位 → 调用 `continue`（保持现有触发）；服务端按 §7 分流。
- 首屏：初始 messages 中已有落库 `process` → 现有 MessageItem / process 步骤直接渲染；栏头 `StatusBadge` 在占位期间为 `running`（或随 replay/live 的 `status` 事件切换 thinking / running / streaming）。
- 传输断开：清除本地 flight；**不**把助手 `content` 改成「生成失败：…」；可静默再 `continue` 一次（限次）或轻提示「连接中断，正在恢复…」。
- `send` 真正 409：维持「回合进行中，请稍候」+ 输入禁用。
- 不新增大营销卡 / 英雄空态；只用现有 StatusBadge 与 process 行。

## 10. Team / watchdog 一致性（AC4）

钉死策略：

1. 客户端断开 **不**释放 turn lock。
2. 重连 **只订阅**，不第二次 `beginTeamTurn`，故不重复 `create_task`、不并行跑 Alex。
3. Watchdog：`isTurnLocked` 为真 → skip；无锁且 `assigned` 卡住 → `retryStuckAssignedTask`；`running` 超时 → `failed`（与现有一致）。
4. 任务状态真相在 workspace；刷新后 listTasks / 消息已含状态；SSE `task` 事件仅增量。
5. 假死锁规避：仅当进程内 **无** active hub 时，占位 `continue` 才允许重新开跑（§3 兜底）。

## 11. 测试要点

| 层 | 用例 |
|----|------|
| TurnHub 单测 | publish 扇出；订阅者抛错不影响其他；unsubscribe 后不再收到；replay 顺序；buffer 上限 |
| stream-*-turn | emit/publish 传输失败不写「生成失败」；业务失败仍写；中途 process 落库 |
| continue 分流 | active → 订阅不二次 begin；无 active + 占位 → begin；send + active → 409 |
| Team | 持锁期间 disconnect 不 unlock；subscribe 不创建第二任务 |
| UI（可选/轻量） | 占位 + process 时 StatusBadge 非 idle；409 仅 send |

## 12. 实现顺序建议

1. TurnHub + 安全 publish/subscribe + 与 turn-lock 协作（单测）
2. 改造 `stream-engineer-turn` / `stream-team-turn`：emit → hub；中途落库 process；业务 catch 与传输隔离
3. 改造 `messages/stream/route.ts`：continue 分流；SSE 订阅生命周期
4. 改造 `workbench-shell`：重连路径；传输错误不污染消息正文
5. 回归 AC1–AC4 相关单测 + typecheck

## 13. 明确不做什么

- 不引入 Redis / 外部 queue 做跨进程 turn
- 不把 turn 改成完全与 HTTP 无关的后台 job 框架（方案 2）
- 不在本 P0 做多标签页 CRDT 合并
- 不重做 MessageItem / 版本卡片 / 只读编辑器
