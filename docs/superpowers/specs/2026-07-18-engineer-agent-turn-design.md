# 设计：Engineer 模式最小 Agent 回合（SSE + 自动 Preview）

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：真实 LLM（OpenAI-compatible）+ Alex tool 改码 + SSE 流式正文 + 回合后自动 enqueuePreviewBuild；不做 Team 任务流 / ToolCallRow

## 1. 目标

接入 Engineer 模式最小 Agent 回合：

1. 用户新建项目（快创建：user + Alex 占位）→ 进入工作台 → 自动续跑真实回合，**替换**占位为真实助手回复。
2. 工作台 Composer 发送 → 同一套 SSE 回合：Alex 经 workspace 端口改码 → 流式正文 → 落库。
3. 回合内若发生 `writeFile` → application `enqueuePreviewBuild` → App Viewer 经现有轮询进入 Building → Ready/Failed。
4. 包边界：`web → application → agent-runtime / agents / llm / workspace / preview`；Agent 不直接碰 `data/**`；Prompt 外置。

## 2. 非目标

- ToolCallRow / MessageItem 细粒度拆分 / ViewerChrome P1
- Mike 任务分配、版本卡片、多 agent 协作
- WebSocket、后台 job 表、断线续传 / 断点续跑
- SSE 推送 tool 事件；流式展示工具行
- Publish / Memory
- 改 Playbook 视觉体系；无关大重构
- 本轮区分 Team 与 Engineer 的编排差异（见 §3）

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| Agent「脑」 | 真实 LLM |
| Provider | OpenAI-compatible HTTP（`configs/llm/` + env 覆盖） |
| 创建时机 | 首页「开始」只快创建；**进入工作台后再**触发 LLM |
| 占位处理 | 真实结果 **替换** 占位消息（`updateMessage`） |
| 传输 | SSE（`text/event-stream`） |
| UI 流式粒度 | 仅正文 `token` + `done` / `error`（不推 tool） |
| Team 模式 | 暂与 Engineer **同一条** Alex 直改码路径（无 Mike/任务卡） |
| 架构 | 方案 1：application 编排 + agent-runtime 回合 + SSE 路由 |

## 4. 成功标准

1. 新建项目进工作台后：占位被替换为真实 Alex 回复；典型需求下 workspace 有文件变更。
2. 工作台再发消息：流式出现助手正文；有写文件则 **无需手动构建**，Viewer 进入 Building → Ready/Failed。
3. 依赖方向符合骨架；Agent 只经 workspace 端口做文件 I/O。
4. 缺 `LLM_API_KEY` / LLM 失败：SSE `error`，用户可见失败文案（见 §7）。
5. 相关 typecheck / 单测通过。

## 5. 架构与数据流

### 5.1 包职责

| 包 | 本轮职责 |
|----|----------|
| `apps/web` | SSE 路由；工作台挂载 `continue`；Composer `send`；消费 `token/done/error`；预览仍用现有轮询 |
| `@isotope/application` | 鉴权/所有权；`runEngineerTurn` 编排；组装端口；条件 `enqueuePreviewBuild` |
| `@isotope/agent-runtime` | `runTurn`：消息组装、tool 循环、流式回调；Engineer 策略（Team 暂同路径） |
| `@isotope/agents` | Alex：加载 system prompt + tool 定义（`list_files` / `read_file` / `write_file`） |
| `@isotope/llm` | OpenAI-compatible chat completions（stream + tools） |
| `@isotope/workspace` | 现有 I/O + **新增 `updateMessage`** |
| `@isotope/preview` | 不变；仅被 application 调用 `enqueueBuild` |
| `prompts/coding/` | Alex system prompt（禁止 TS 硬编码长文） |
| `configs/llm/` | 默认 baseURL / model / timeout / maxToolRounds；密钥只走 env |

### 5.2 依赖方向

```text
apps/web
  → @isotope/application
      → @isotope/agent-runtime
          → @isotope/agents
          → @isotope/llm
      → @isotope/workspace
      → @isotope/preview
```

禁止：

- Agent / runtime / llm 直接读写 `data/**`
- `workspace` → `agents` / `preview` / `web` / `llm`
- `llm` → `workspace`
- UI 路由内嵌长 Prompt 或直接调 LLM HTTP

### 5.3 时序

**A. 新建 → 进工作台续跑**

```text
createProject → user + assistant(占位 ASSISTANT_PLACEHOLDER)
GET 工作台 → 消息列表含占位
挂载检测到占位 → POST /messages/stream { action: "continue" }
  → runEngineerTurn(replaceMessageId)
  → stream tokens → updateMessage(最终全文)
  → filesChanged? enqueuePreviewBuild
  → SSE done
```

**B. Composer 发送**

```text
POST /messages/stream { action: "send", content }
  → appendMessage(user)   // 不再写占位
  → runEngineerTurn → append assistant(Alex)
  → 同上 stream / 落库 / enqueue
```

### 5.4 SSE 事件（最小）

| event | data | 含义 |
|-------|------|------|
| `token` | `{ text: string }` | 助手正文增量 |
| `done` | `{ messageId, filesChanged, previewEnqueued }` | 回合成功结束 |
| `error` | `{ message: string }` | 失败（含缺 key） |

Tool 仅在服务端执行，不推送事件。

### 5.5 防重入

同一 `projectId` 同时只允许一个进行中的 turn（进程内锁即可）。重复 `continue` / `send`：开流前返回 `409` JSON（不进入 SSE）。

## 6. API 与持久化

### 6.1 HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/projects/:id/messages/stream` | SSE 回合（产品主路径） |
| `GET` | `/api/projects/:id/messages` | 不变，首屏拉历史 |
| `POST` | `/api/projects/:id/messages` | 保留兼容：仍可写 user+占位（测试/旧客户端）；**工作台 Composer 改走 stream** |

**Stream body**

```json
{ "action": "continue" }
{ "action": "send", "content": "把标题改成中文" }
```

- `continue`：末条须为 `role=assistant` 且 `content === ASSISTANT_PLACEHOLDER`，否则 `400`
- `send`：`content` trim 后非空；先 append user，再跑回合；结束时 append 新 assistant

**SSE 响应头**：`Content-Type: text/event-stream`；`Cache-Control: no-cache`

### 6.2 持久化

| 操作 | 行为 |
|------|------|
| `createProject` | 仍：user + Alex 占位（文案不变，作为「待续跑」标记） |
| `continue` | `workspace.updateMessage(id, { content })`；流式中途不落库，仅内存累加；`done`/`error` 时一次写入 |
| `send` | `appendMessage(user)`；成功结束 `appendMessage(assistant, agentName: "Alex")`；失败见 §7 |
| 文件 | 仅经 `readFile` / `writeFile` / `listFiles` |
| 构建 | `filesChanged === true` 时调用 `enqueuePreviewBuild`；已在 building 则沿用 preview 现有语义 |

**`workspace.updateMessage(messageId, patch: { content })`**：按 id 更新 content；不存在返回 `null`。不做通用消息编辑 UI。

### 6.3 识别占位

```ts
role === "assistant" && content === ASSISTANT_PLACEHOLDER
```

`ASSISTANT_PLACEHOLDER` 仍为：

> 已收到你的需求。预览与智能体编排将在下一步接入；当前仅持久化对话。

工作台挂载：若 `messages.at(-1)` 满足 → 自动 `continue`。React Strict Mode 双挂载靠服务端 turn 锁去重。

## 7. 错误处理

| 情况 | 行为 |
|------|------|
| 未登录 | 开流前 `401` JSON |
| 项目不存在 / 非主人 | `404` |
| 回合进行中 | `409` |
| `continue` 但无占位 | `400` |
| 缺 `LLM_API_KEY` / LLM 失败 / tool 失败 | SSE `error`；**`continue`：将占位替换为失败文案**（避免永远卡在占位）；**`send`：落一条失败 assistant**（`agentName: "Alex"`），刷新可复现 |
| 失败后 | Composer 可再 `send`；已非占位则 **不再自动 continue** |

失败文案建议前缀：`生成失败：` + 截断原因。

## 8. 配置与 Prompt

### 8.1 Env

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | 必填才能跑回合 |
| `LLM_BASE_URL` | 可选，覆盖 config |
| `LLM_MODEL` | 可选，覆盖 config |

`apps/web/.env.example` 补上上述变量说明。

### 8.2 `configs/llm/default.yaml`（形状）

```yaml
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
timeoutMs: 120000
maxToolRounds: 8
```

### 8.3 Prompt

- `prompts/coding/alex-system.v1.md`：约束只改 workspace 内前端相关文件、必须用工具读写、对用户用简体中文短回复。
- 禁止在 TypeScript 中硬编码长 system prompt。

### 8.4 回合硬限制

- 达到 `maxToolRounds`：停止继续调 tool；若已有助手正文则 `done`（可附简短截断说明），否则 `error`。
- 单次 LLM/回合超时遵循 `timeoutMs`。

## 9. UI 行为（工作台）

贴合 `docs/ui/ai-surfaces.md` Streaming / Composer 状态；**本轮不做 ToolCallRow**。

| 场景 | 行为 |
|------|------|
| 进页发现占位 | Composer `disabled`；占位气泡进入流式态（可先清空再追加 `token`） |
| `continue` / `send` 进行中 | Composer `submitting` / `disabled`，防双发 |
| `token` | 当前助手气泡正文追加 |
| `done` | 用 `messageId` 固化；恢复 Composer；`previewEnqueued` 时依赖现有 preview 轮询 |
| `error` | 展示失败文案；恢复 Composer |
| 无占位的普通进页 | 不自动开流 |

首页「开始」流程不变：快创建 → 跳转工作台 → 工作台触发 LLM。

## 10. 测试计划

| 层 | 覆盖 |
|----|------|
| `workspace` | `updateMessage` 更新 / 不存在 |
| `llm` | 假 HTTP：request 形状（messages/tools）；stream chunk 解析 |
| `agent-runtime` | mock llm + 内存/假 workspace：tool 写文件 → token 回调 → `filesChanged` |
| `application` | `continue` 替换占位；`send` 追加；有写入则调 enqueue；缺 key 失败路径；重入 409 |
| `web` | 可选 mock；优先手工 |
| 手工 | 配 key：新建 → 进页流式 → 文件变更 → Viewer 自动构建；再发修改需求同上 |

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 慢/超时 | `timeoutMs`；UI 明确生成中；失败可重试 |
| Strict Mode 双 `continue` | 项目级 turn 锁 |
| 模型乱写路径 | tool 经 workspace 路径校验 |
| 流式中刷新丢半截 | 仅结束时落库；刷新见占位或完整/失败文案；仍为占位可再 auto-continue |
| 无 key 本地演示 | `.env.example` 写清；失败文案可见 |

## 12. 验收清单

- [ ] 新建进工作台后占位被真实回复替换；workspace 有变更（典型需求）
- [ ] Composer 发送走 SSE；正文流式；有写文件则自动 Building → Ready/Failed
- [ ] Team 项目可跑同一 Alex 路径（无任务卡亦可）
- [ ] 缺 key / LLM 失败可见，且不会永久卡在占位
- [ ] Prompt 在 `prompts/`；密钥不进仓库
- [ ] 包边界与依赖方向符合 §5.2
- [ ] 相关 typecheck / 单测通过
- [ ] 未实现 ToolCallRow / Mike 任务 / 版本卡片 / WebSocket job
