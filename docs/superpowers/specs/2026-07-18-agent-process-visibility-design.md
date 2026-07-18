# 设计：Agent 过程可见性（思考 / 工具 / 结论）

- 日期：2026-07-18
- 状态：已批准（用户确认继续 → 实现计划）
- 前置：[`2026-07-18-engineer-agent-turn-design.md`](./2026-07-18-engineer-agent-turn-design.md)（已落地：SSE `token`/`done`/`error` + Alex tool 改码 + 自动 preview）
- 范围：SSE 粗粒度过程事件；聊天区区分「思考过程 / 工具调用 / 结论」；过程摘要落库供刷新可见；**不进** LLM 短期记忆
- UI：遵循 `docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + shadcn only

## 1. 目标

工作台回合进行中，tool 长时间无正文时用户能看见过程，而不是「突然出结果」：

1. 流式展示 **思考过程**（模型在工具轮次中的中间口头正文，原样，非二次摘要）。
2. 流式展示 **工具行**（`list_files` / `read_file` / `write_file` 起止 + 短标签如 path）。
3. 流式展示 **结论**（终轮无 tool 的助手正文）；终态落库；有写文件仍自动 `enqueuePreviewBuild`。
4. 刷新后仍能看到该条消息的思考 + 工具摘要 + 结论；下次回合组装 history 时 **只带结论 `content`**。

## 2. 非目标

- 完整 Trace / Token / 成本面板
- MessageItem 大拆分、ViewerChrome 重构
- Team / Mike、版本卡片
- 独立 reasoning API 通道（o1 / R1 等 thinking 字段）
- 再调一次 LLM「压缩」过程文案
- 落库完整 tool args / result（整文件内容）
- WebSocket、断线续传、改包边界

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 架构 | 方案 1：助手消息挂 `process` 元数据；`content` 只存结论 |
| 思考内容 | 工具轮次中的 `content_delta` 原样（非 tool 输出、非二次压缩） |
| 工具展示 | 名称 + 状态 + 从参数直接取的短标签（如 path）；无二次 LLM |
| 刷新可见 | 思考原文 + 工具摘要落库；展开详情不落库（本轮可不做详情体） |
| 短期记忆 | `process` **不**进入 `runTurn` history；只传 `content` |
| UI 三层 | 思考（次要灰字）/ ToolCallRow / 结论（正常正文）；样式须区分 |
| Composer / 栏头 | 回合中 Running / Streaming 等，用现有 `StatusBadge` |

## 4. 成功标准

1. 发需求后，tool 执行期间可见「正在…」类过程（status + 工具行，及可选思考文）。
2. `read_file` / `write_file` / `list_files` 各至少能出现一行工具状态。
3. 终态：结论写入 `content`；`process` 一并落库；刷新后三层仍可见。
4. 下一回合 LLM history 不含 `process` 文本。
5. 有 `write_file` 成功仍自动 preview 构建。
6. 包边界不变：`web → application → agent-runtime / agents / …`。
7. 相关 typecheck / 单测通过。

## 5. 概念（非技术）

一条 Alex 回复分三段：

1. **思考过程** — 动手前/中的口头说明（灰色次要）。
2. **调用工具** — 读/写/列文件的一行状态（短标签，非整文件）。
3. **结论** — 对用户的正式答复（正常正文）；**只有这段**进入下次对话记忆。

## 6. 架构与数据流

### 6.1 包职责（相对前置 spec 的增量）

| 包 | 增量 |
|----|------|
| `@isotope/agent-runtime` | `runTurn`：区分 thinking vs 结论；`onThinking` / `onTool` / `onStatus`；返回 `process` |
| `@isotope/application` | `EngineerTurnEvent` 扩展；落库时写 `content` + `process`；组装 history 仍只 `content` |
| `@isotope/workspace` | `Message.process`；`appendMessage` / `updateMessage` / DB 列 |
| `apps/web` | SSE 转发新事件；Workbench 消费；`ToolCallRow`；栏头/Composer 状态 |
| `@isotope/agents` / `llm` / `preview` | 原则上不改（tool 短标签可在 runtime 从已知 args 解析） |

### 6.2 依赖方向（不变）

```text
apps/web → application → agent-runtime → agents | llm
                      → workspace | preview
```

### 6.3 `runTurn` 区分规则

对每一轮 LLM completion：

1. 若该轮最终出现 `tool_calls`：该轮全部 `content_delta` → **thinking**（回调 `onThinking`；**不**计入结论 `assistantText`）。
2. 执行每个 tool：先 `tool start`，再执行，再 `tool end`（`summary` 由 args 解析，见 §6.5）。
3. 若该轮**无** `tool_calls`（终轮）：`content_delta` → **结论**（`onToken` + 累加 `assistantText`）。
4. 阶段回调建议：
   - 回合开始 → `status: thinking`
   - 进入任一 tool → `status: running`
   - 开始结论 token → `status: streaming`
5. 达 `maxToolRounds`：
   - 若已有结论 `assistantText` → 追加「（已达工具轮次上限）」到结论并 `done`（与现网一致）；
   - 若无结论但有 thinking → 结论写入「（已达工具轮次上限）」并 `done`（thinking 仍留在 `process`）；
   - 若既无结论也无 thinking → `error`（与现网「工具调用轮次过多」一致）。

**边界：** 模型某一轮同时有短文案 + tools → 文案进 thinking。模型直接 tool、无文案 → 仅工具行 + status。终轮无文案 → 结论用「（无回复内容）」占位（与现网一致）。

### 6.4 SSE 事件

| event | data | 含义 |
|-------|------|------|
| `status` | `{ phase: "thinking" \| "running" \| "streaming" }` | 驱动 StatusBadge |
| `thinking` | `{ text: string }` | 思考过程增量 |
| `tool` | `{ id: string, name: string, state: "start" \| "end", summary?: string }` | 工具起止 |
| `token` | `{ text: string }` | **仅结论**增量 |
| `done` | `{ messageId, filesChanged, previewEnqueued }` | 成功结束（不变） |
| `error` | `{ message: string }` | 失败（不变） |

兼容：旧客户端忽略未知 event 即可；`token` 语义收窄为仅结论（破坏性相对「中间文也曾进 token」——本产品尚无外部客户端，可接受）。

### 6.5 工具 `summary`（非 LLM 压缩）

从 tool 参数 JSON 直接取短字段，失败则仅 `name`：

| name | summary 示例 |
|------|----------------|
| `read_file` | path |
| `write_file` | path |
| `list_files` | dir 或 `"."` |

不包含文件正文、不包含完整 arguments JSON（除非极短且无秘密；默认不存 raw args）。

### 6.6 持久化

**`Message` 扩展：**

```ts
type MessageProcessStep =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error";
      summary?: string;
    };

type Message = {
  // …现有字段
  content: string; // 仅结论
  process?: { steps: MessageProcessStep[] };
};
```

**SQLite：** `messages` 增加可空列 `process_json TEXT`（JSON）；缺省 / null = 无过程（旧消息）。迁移：`ALTER TABLE` 若列不存在则添加（与现有 `openWorkspaceDatabase` 风格一致）。

**写入时机：** 与前置一致——流式中途可不落库；`done` / `error` 时一次写入 `content` + `process`。`continue` 用 `updateMessage`；`send` 用 `appendMessage`。

**`updateMessage` patch：** 扩展为 `{ content?: string; process?: Message["process"] | null }`（至少支持终态同时写 content + process）。

**History 组装（强制）：**

```ts
history.map((m) => ({ role, content: m.content }))
// 禁止拼接 process.steps 文本
```

### 6.7 时序（相对前置的增量）

```text
POST stream continue|send
  → status thinking
  → (thinking* | tool start/end* | status running)*
  → status streaming + token*
  → 落库 content + process
  → filesChanged? enqueuePreviewBuild
  → done | error
```

## 7. UI 行为

贴合 `docs/ui/ai-surfaces.md` §2–§5；新增最小 `ToolCallRow`（Playbook §8 组合件）。

| 区域 | 行为 |
|------|------|
| 助手气泡 | 上：思考（`text-muted-foreground` 较小字，可折叠「已处理 N 步」）；中：`ToolCallRow` 列表；下：结论正文 |
| `ToolCallRow` | `toolName`（可加 summary）+ status Badge；详情默认折叠；本轮可不实现详情体 |
| 对话栏 `StatusBadge` | 跟 SSE `status.phase`；空闲/结束后回 `idle`（或短暂 `done` 再 idle，实现选一） |
| Composer | 回合中 `submitting` / disabled（沿用现逻辑） |
| 流式 | thinking / tool / token 增量更新当前助手消息的本地 `process` + `content` |
| 刷新 | `listMessages` 带回 `process`，直接渲染三层 |
| 错误 | 失败文案写入结论 `content`；已收集的 process 尽量一并落库 |

**不做：** 打字机音效、霓虹色、每个 tool 闪亮动画、完整 Trace 抽屉。

可选 Prompt 微调（`prompts/coding/alex-system.v1.md`）：鼓励在调工具前用一两句中文说明意图——**非必须**，有则思考区更饱满。

## 8. 错误处理

沿用前置 spec §7；增量：

| 情况 | 行为 |
|------|------|
| tool 执行失败 | 该行 `status: error`；可继续后续轮次（与现 `executeTool` 回灌错误字符串一致） |
| 流中断 | 客户端 error；服务端若已部分执行，尽力落库已有结论/过程（与现「结束才写」一致则可能仅有占位/失败文——保持结束时写，不中途落库） |

## 9. 测试计划

| 层 | 覆盖 |
|----|------|
| `agent-runtime` | mock LLM：中间文 + tools → thinking 回调且不进 assistantText；终轮 → token；tool start/end；返回 process |
| `workspace` | append/update/list 带 process_json；旧行 null 兼容 |
| `application` | emit 新事件；落库 process；history 不含 process |
| `web` | 可选；优先手工：发需求见工具行；刷新仍见三层 |
| 手工 | 改码需求：思考/工具/结论样式可辨；Viewer 仍自动构建 |

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模型不说话直接 tool | status + 工具行仍可见；可选 prompt 鼓励一句说明 |
| 中间文很长 | UI 折叠「N 步」；仍原样落库（可后续加长度上限，本轮不强制） |
| `token` 语义收窄 | 文档与 UI 同步；无外部 SSE 消费者 |
| process 误入 memory | 单测锁定 history 只含 content |

## 11. 验收清单

- [ ] tool 执行期间可见过程（status 和/或工具行），非仅最终长文
- [ ] read / write / list 均可出现工具行
- [ ] 思考 / 工具 / 结论样式可区分
- [ ] 刷新后三层仍在；下一回合模型只带结论
- [ ] 写文件仍自动 Building → Ready/Failed
- [ ] 包边界符合 §6.2
- [ ] 相关 typecheck / 单测通过
- [ ] 未做完整 Trace / Mike / ViewerChrome 大改 / reasoning API

## 12. 与前置 spec 关系

本文件是 Engineer Agent Turn 的 **UI/SSE 扩展**。前置非目标中的「不做 ToolCallRow / 不推 tool 事件」由本 spec **有意撤销**；其余（Team 同路径、占位 continue、turn 锁、preview 条件入队）仍然有效。
