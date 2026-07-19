# 设计：Prompt 级模型路由 + 工具白名单 + LLM Router

- 日期：2026-07-19
- 状态：已批准（对话确认，方案 A）
- 范围：按 Prompt/调用阶段指定模型与暴露工具；Prompt/LLM 配置进程内缓存；按 provider 配置、按 model 调用的 LlmRouter
- 相关：`docs/PRD.md` §7.14（工具白名单部分）/ §7.15；`docs/architecture/PROJECT_SKELETON.md` §7–8；Engineer / Team / Plan 既有 turn 设计

## 1. 目标

1. **按任务类型（Prompt / 调用阶段）指定模型**，并只向 LLM 暴露该阶段允许的工具。
2. **Prompt bundle 与 LLM provider 配置进程内缓存**，避免每次回合都读盘。
3. **LLM 调用增加 Router 层**：调用方传 `model` + 上下文；Router 按 model 找到所属 provider client。同一 provider 下多个 model 共用一份连接配置。
4. 顺带收敛装配：去掉 web 硬编码 prompt 路径与「构造时写死 model 的 client」。

## 2. 非目标

- 完整 ModePolicy / AgentRegistry / 中央 Tool Registry（骨架全量）
- 路径 / 命令 ACL 与越权可观测的完整 §7.14（workspace 边界维持现状）
- 用户侧模型选择器、多 provider 故障转移
- Prompt `{{variables}}` 通用模板引擎（版本摘要若已有简单替换可保留，不扩展）
- 把 Team 阶段编排从 application 抽到 agent-runtime

## 3. 已确认决策

| 决策 | 选择 |
|------|------|
| 「任务类型」绑定单元 | **Prompt / 调用阶段**（如 `mike-system` vs `mike-summary`） |
| 方案 | **A：Prompt Bundle + LlmRouter** |
| 模型声明位置 | `prompts/**/*.meta.yaml`；缺省回退 `configs/llm/default.yaml` 的 `defaultModel` |
| 工具暴露 | meta `tools[]` ∩ agent 已注册工具 catalog；`[]` = 禁止工具 |
| LLM 配置维度 | **按 provider**（baseUrl、apiKeyEnv、models 列表） |
| LLM 调用维度 | **按 model**（每次 `complete` 传入） |
| 缓存 | 进程内 Map + mtime 校验；无 file watcher |

## 4. 架构与职责

```text
apps/web 装配
  → PromptLoader（bundle + 缓存）
  → agents（工具实现 catalog）
  → begin*Turn → runTurn({ model, agent, … })
       → LlmRouter.complete({ model, messages, tools })
            → Provider client（按 provider 复用；请求体带本次 model）
```

| 单元 | 职责 | 不负责 |
|------|------|--------|
| Prompt Bundle | 正文 + meta（`model?`、`tools[]`） | provider、FS |
| PromptLoader | 按 id 加载；进程内缓存 | 调 LLM |
| Agent 插件 | 可执行工具全集 + `executeTool` | 本回合暴露哪些、用何模型 |
| 装配（web deps） | `exposedTools = meta.tools ∩ catalog`；解析 model | 直接 new 死 model client |
| runTurn | tool loop；把 `model` 传给 LLM | 读盘、解析 provider |
| LlmRouter | model → provider client | agent / prompt |

编排路径不变：`resolveTurnKind` → `begin*Turn` → `runTurn`。变化在 deps 装配与 LLM 入口。

## 5. 配置形状

### 5.1 Prompt Bundle

```text
prompts/<domain>/
  <name>.v1.md
  <name>.v1.meta.yaml
```

`meta.yaml` 最小字段：

```yaml
id: leader/mike-system
version: v1
model: deepseek-v4-pro   # 可选
tools:
  - create_task          # 本阶段白名单；[] = 无工具
```

加载：`loadPromptBundle(id, version?)` → `{ id, version, system, model, tools }`。  
`model` 解析顺序：meta.model → env `LLM_MODEL`（若设）→ `defaultModel`。

### 5.2 LLM providers

```text
configs/llm/
  default.yaml              # defaultModel, maxToolRounds, 可选全局 timeout
  providers/
    <provider-id>.yaml
```

Provider 示例：

```yaml
id: deepseek
type: openai-compatible
baseUrl: https://api.deepseek.com
apiKeyEnv: LLM_API_KEY
timeoutMs: 120000
models:
  - deepseek-v4-pro
  - deepseek-chat
```

### 5.3 现有阶段映射

| 阶段 | bundle id | tools（示例） |
|------|-----------|---------------|
| Pat | `requirement/pat-system` | `[confirm_requirement]` |
| Mike 拆任务 | `leader/mike-system` | `[create_task]` |
| Mike 总结 | `leader/mike-summary` | `[]` |
| Alex | `coding/alex-system` | `[list_files, read_file, write_file]` |
| 版本摘要 | `workspace/version-summary` | `[]` |

## 6. API

```ts
// Router / LlmClient 统一入口
complete(input: {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
}): AsyncIterable<LlmStreamEvent>;

// PromptLoader
load(id: string, version?: string): PromptBundle;
```

- `createOpenAiCompatibleClient` 按 **provider** 构造；`model` 每次请求写入 body。
- `runTurn` 增加必填 `model: string`，原样传给 `complete`。
- Agent 工厂支持注入 **过滤后的** `tools`（不再只能用模块常量全量）；catalog 仍由模块导出供装配求交。

Mike summary：通过 `leader/mike-summary` bundle（`tools: []`）装配，不再手写临时 agent 清空工具（可保留 displayName 薄封装）。

## 7. 缓存策略

| 资产 | 策略 |
|------|------|
| Prompt bundle（md + meta） | `Map<id@version, { payload, mtimeMs }>`；命中前 `stat`，mtime 变则重读 |
| Provider YAML | 同策略；Router 持有 `Map<providerId, client>`，配置变更丢弃该 client |
| Agent tool catalog | 代码常量，不读盘 |

测试可注入内存 loader / fixture，绕过磁盘。

## 8. 错误处理

| 情况 | 行为 |
|------|------|
| meta 的 tool ∉ agent catalog | **装配期抛错** |
| 模型调用未暴露 tool | `executeTool` 返回错误（第二道门，与现网一致） |
| model 未登记到任何 provider.models | Router 抛明确错误 → turn 现有 error 路径 |
| meta 缺 model | 使用 `defaultModel` |
| md / meta 缺失 | 加载期抛错 |
| apiKey env 空 | 创建 provider/Router 时失败（保持现语义） |

## 9. 数据流示例（Team Mike 拆任务）

```text
createTeamTurnDeps()
  bundle = loader.load("leader/mike-system")
  tools  = intersect(bundle.tools, LEADER_TOOLS)
  leader = createLeaderAgent({ systemPrompt: bundle.system, tools })

runTurn({ llm: router, agent: leader, model: bundle.model, port, history, … })
  → router.complete({ model, messages, tools: leader.tools })
  → resolve provider → openai-compatible client
  → body.model = 本次 model
  → tool_calls → executeTool(port)
```

## 10. 测试要点

- Router：同 provider 两 model → body.model 不同、凭据/baseUrl 相同；未知 model 报错
- Loader：二次 load 不重读（mock fs）；mtime 变更后重读
- 白名单：meta `tools: []` 时 complete 不带工具（或空列表）
- runTurn：传入的 model 原样到达 llm mock
- 回归：engineer / team / plan turn 行为不变（改用 bundle fixture）

## 11. 实现落点（指导计划，非本 spec 任务拆分）

| 区域 | 变更 |
|------|------|
| `packages/llm` | Router；client 支持 per-request model；加载 `configs/llm/providers` |
| `apps/web/lib/prompt-loader.ts` | PromptLoader（本轮唯一 composition root 在 web；无 Next 专用 API，便于单测） |
| `packages/agent-runtime` | `runTurn` 传 `model` |
| `packages/agents` | 工厂接受 `tools?`；导出 catalog 常量 |
| `apps/web/lib/agent.ts` + `paths.ts` | bundle id 装配；注入 Router |
| `apps/web/lib/preview.ts` | 版本摘要走同一 Router + bundle |
| `prompts/**` | 为现有 md 补齐 `.meta.yaml` |
| `configs/llm` | 拆 default + providers |

## 12. 成功标准（对齐 PRD）

- §7.15 AC1–4：至少一份 meta 声明 model；回合实际请求一致；未声明回退默认；不在业务 TS 硬编码换模型
- §7.14 AC1（本轮范围）：Agent 仅能调用当前阶段允许的工具；未授权不进 schema
- 缓存：同一进程连续回合不因未变更文件重复读盘（测试可证）
- 调用方按 model、配置按 provider
