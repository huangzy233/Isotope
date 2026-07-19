# 设计：结论 / 思考实时流式（投机 token + 遇工具降级）

- 日期：2026-07-19
- 状态：已落地（实现计划见 `docs/superpowers/plans/2026-07-19-live-token-streaming.md`）
- 前置：
  - [`2026-07-18-agent-process-visibility-design.md`](./2026-07-18-agent-process-visibility-design.md)（思考 / 工具 / 结论三层；整轮缓冲区分）
  - [`2026-07-18-engineer-agent-turn-design.md`](./2026-07-18-engineer-agent-turn-design.md)
  - [`2026-07-18-disconnect-reconnect-design.md`](./2026-07-18-disconnect-reconnect-design.md)（TurnHub replay）
- UI：`docs/ui/`（尤其 `ai-surfaces.md`）；Neutral Tool + shadcn only
- 架构：`apps/web → application → agent-runtime → agents | llm`

## 1. 目标

1. **思考过程**与**结论**在生成过程中实时出字（边到边），不再等整轮 LLM SSE 结束后才 flush。
2. **Tool call** 仍等 provider 拼完整（如完整 `read_file` + `index.html`）后再展示工具行并执行；不对 arguments 碎片做 UI。
3. 保持既有三层语义与落库规则：`content` = 结论；`process` = 思考 + 工具；history 只带 `content`。
4. Engineer / Team / Plan 凡走 `runTurn` + 现有 SSE 事件的路径一并受益（同一套 runtime 规则）。

## 2. 非目标

- 伪流式（生成完再分段延迟推送）
- WebSocket 替换 SSE；改 TurnHub 扇出模型
- 独立 reasoning API 通道；完整 Trace / Token 成本面板
- Tool 参数碎片的流式展示或未拼完就执行
- MessageItem 大拆、ViewerChrome 重构、多 Node 分布式 turn

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 观感优先 | 无工具时结论真正逐字出现（接近 ChatGPT） |
| 未定身份正文 | **先流式写入 thinking（过程区）**；同时投机 `token`（结论区）。若本轮有 tool → `token_clear` 保留 thinking；若无 tool → `thinking_clear` 提升为仅结论 |
| 思考如何「流式」 | `content_delta` 立刻 `onThinking`，保证过程区里思考永远在工具行之前 |
| 有工具时闪动 | 结论区可能先闪投机正文再 `token_clear`；过程区顺序保持 思考 → 工具 |
| Tool 时机 | 等完整 `tool_calls` 再 `tool start` / 执行（与现网一致） |
| 提前信号 | LLM 层在首个 `delta.tool_calls` 时 yield `tool_calls_begin`，缩短「假结论」窗口 |
| 收回协议 | 新增 SSE `token_clear`：清空本条助手消息当前 `content`（本轮投机正文） |
| 落库 | 规则不变：终态 `content` 仅结论；thinking 进 `process`；中途可按现网节奏落库 process |

## 4. 成功标准（验收）

| ID | 标准 |
|----|------|
| AC1 | 无工具的终轮：用户在生成过程中即见主气泡逐字增长，而非整段蹦出 |
| AC2 | 有工具轮：工具前旁白最终出现在 thinking（process），不进入落库 `content`；工具行仅在完整 tool_calls 后出现 |
| AC3 | `read_file` / `write_file` / `list_files` 行为与摘要规则与过程可见性 spec 一致 |
| AC4 | 下一回合 history 仍只含结论 `content`，不含 process / 已收回的投机正文 |
| AC5 | 断线重连：`token_clear` 进入 TurnHub 缓冲并可 replay；重连后 UI 状态与事件一致（无「已收回却仍显示假结论」） |
| AC6 | 相关 typecheck / `runTurn` 与 stream-* 单测通过；用户可见文案简体中文 |

## 5. 现状根因

`runTurn` 将每轮全部 `content_delta` 缓冲到 LLM stream 结束，才能区分 thinking vs 结论（因 `tool_calls` 由 `@isotope/llm` 在整段 SSE 读完后才 yield）。结果：

- status / thinking（flush 后）/ tool 可以较及时；
- **结论 `token` 要等本轮生成结束**才一次性冲出 → 用户感觉「不流式」。

LLM 层内部其实已在流中收到 `tool_calls` 碎片，只是对外未提前发信号。

## 6. 架构与数据流

### 6.1 包职责（增量）

| 包 | 增量 |
|----|------|
| `@isotope/llm` | 解析 SSE 时：首个 `delta.tool_calls` → `tool_calls_begin`；流末仍聚合 yield `tool_calls` + `finished`；`content_delta` 行为不变 |
| `@isotope/agent-runtime` | `runTurn`：去掉「整轮缓冲再分类 flush」；按 §6.3 实时回调；可选消费 `tool_calls_begin` |
| `@isotope/application` | 事件联合类型加 `token_clear`；`onToken` / `onThinking` / 新 clear 回调接到 `publishTurnEvent`；Engineer / Team / Plan 三路一致 |
| `apps/web` route | SSE 转发 `token_clear`（与其它 event 相同） |
| `apps/web` workbench | 消费 `token_clear`：将当前流式助手消息的 `content` 置为 `""`（保留 process）；`token` / `thinking` / `tool` 逻辑保持 |

### 6.2 依赖方向（不变）

```text
apps/web → application → agent-runtime → agents | llm
                      → workspace | preview
```

### 6.3 `runTurn` 单轮规则（替换过程可见性 §6.3 的缓冲策略）

对每一轮 `llm.complete`：

1. **`content_delta`**：立刻 `onToken(text)`；累加到本轮 `roundBuffer`；同时累加到「投机结论」`assistantText`（可被本轮后续 clear 回滚）。
2. **`tool_calls_begin`**（若有）：  
   - 若 `roundBuffer` 非空 → `onThinking(roundBuffer)` 写入 process；  
   - 调用 `onTokenClear`（或等价）；将本轮已计入的投机结论从 `assistantText` 去掉；`roundBuffer` 保留给 thinking 语义（已发出则不再重复发全文，后续 delta 只走 thinking）。  
   - `onStatus("running")`（或保持至正式 tool）。  
   - **此后**本轮再来的 `content_delta`（少见）只 `onThinking`，**不再** `onToken`。
3. **`tool_calls`**（完整）：若尚未因 `tool_calls_begin` 降级，执行与上相同的降级；然后按现网执行各 tool（`onTool` start/end + port）。**禁止**在 `tool_calls_begin` 时执行工具。
4. **`finished` 且本轮无 tool**：投机 `token` 即为结论；`onStatus("streaming")` 可在首个结论 token 时已发；返回。
5. **达 `maxToolRounds`**：行为与过程可见性 spec 一致（上限文案进结论等）。

**边界（明确）：**

- 同轮短文案 + tools → 文案最终只在 thinking；结论不含该文案。
- 直接 tool、无 content → 无 token / 无 clear；仅工具行。
- 无 `tool_calls_begin` 的旧 provider mock：仅在完整 `tool_calls` 时降级（窗口更长，行为仍正确）。
- `onThinking` 增量：降级时可用一次全文；若已 `tool_calls_begin` 后还有 delta，按增量 `onThinking` 追加（与现网 append thinking step 兼容）。

### 6.4 LLM 事件扩展

```ts
type LlmStreamEvent =
  | { type: "content_delta"; text: string }
  | { type: "tool_calls_begin" } // 新增：本轮将出现 tool_calls
  | { type: "tool_calls"; toolCalls: LlmToolCall[] }
  | { type: "finished"; finishReason: string | null };
```

- `tool_calls_begin` 每轮至多一次（首次见到 `delta.tool_calls` 时）。
- 无 tool 的轮次不发出该事件。
- 测试用 script LLM 可选择不发 `tool_calls_begin`，runtime 仍须在 `tool_calls` 时正确降级。

### 6.5 SSE 事件（相对过程可见性的增量）

| event | data | 含义 |
|-------|------|------|
| `token` | `{ text: string }` | 结论增量（含投机阶段） |
| `token_clear` | `{ }` 或 `{ reason: "tool_calls" }` | 清空当前助手消息 `content`（本轮投机正文收回） |
| `thinking` | `{ text: string }` | 思考增量（降级全文或后续增量） |
| `tool` / `status` / `done` / `error` / … | 不变 | 与现网一致 |

`RunTurnInput` 增量：`onTokenClear?: () => void`（名称以实现为准，语义固定）。

### 6.6 前端行为

- `token`：追加到当前流式助手消息 `content`（现网）。
- `token_clear`：将该消息 `content` 设为 `""`；**不**清空 `process`。
- `thinking` / `tool`：现网合并 process steps。
- 重连 replay：按事件序应用；先 `token` 再 `token_clear` 必须得到空 content + thinking 在 process。

### 6.7 中途落库 / 终态落库

- 与断线重连 / 过程可见性现网一致：process 可中途更新；终态 `content` = 最终 `assistantText`（已扣除降级部分）。
- `token_clear` 之后若中途落库 content，应写已 clear 后的值（通常为空或此前轮次结论——Engineer 单助手消息通常整轮结束后才有最终结论，中途 content 以 application 现有更新策略为准，但**不得**把已降级正文留在终态 content）。

## 7. 错误处理

- LLM / tool 失败：现网 `error`；不新增失败类型。
- 客户端忽略未知 event 仍安全；旧前端无 `token_clear` 时，有工具轮可能短暂留下假结论直到 `done` 用落库 content 纠正——**本仓库前后端同发**，实现时 web 必须同步支持 `token_clear`。

## 8. 测试要点

1. **runtime**：无工具轮 —— `onToken` 在 `finished` 前被调用（按 delta 次序）；无 `onTokenClear` / 无 thinking。
2. **runtime**：先 content 后 `tool_calls` —— 先有 `onToken`，再 `onTokenClear` + `onThinking`，再 tool；`assistantText` 不含该旁白。
3. **runtime**：仅有 `tool_calls`（无 begin）—— 降级仍正确。
4. **runtime**：`tool_calls_begin` 后再来的 content_delta 只进 thinking。
5. **llm**：SSE 含 tool_calls 碎片时先 begin 再聚合 tool_calls。
6. **application / web（单测或轻量）**：`token_clear` 发布与消费后 content 为空、thinking 保留。

## 9. 实现顺序建议

1. `@isotope/llm`：`tool_calls_begin` + 测试  
2. `@isotope/agent-runtime`：`runTurn` 实时规则 + 测试（核心）  
3. `@isotope/application`：三路 turn 事件 + `onTokenClear`  
4. `apps/web`：SSE + workbench `token_clear`  
5. 手动点验：无工具长回答；「先读文件再改」类有工具回合；刷新重连

## 10. 与前置 spec 的关系

本 spec **修订** [`2026-07-18-agent-process-visibility-design.md`](./2026-07-18-agent-process-visibility-design.md) §6.3 中「单轮结束前缓冲正文」的锁定策略；三层产品语义、summary 规则、history 不含 process **保持不变**。
