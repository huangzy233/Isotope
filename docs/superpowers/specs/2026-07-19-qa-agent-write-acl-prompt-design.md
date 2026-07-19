# 设计：QA 质检闭环 + write_file 路径 ACL + Prompt 五段骨架

- 日期：2026-07-19
- 状态：已批准（对话确认）
- 范围：Alex/Engineer 改码后的质检硬环；coder `write_file` 路径白名单（yaml）；统一优化 Mike/Pat/Alex/QA system prompt；变更路径注入
- 相关：`docs/PRD.md`；`docs/architecture/PROJECT_SKELETON.md`；Team `2026-07-18-team-leader-task-flow-design.md`；Engineer `2026-07-18-engineer-agent-turn-design.md`；Preview `2026-07-18-preview-build-loop-design.md`；Prompt 路由 `2026-07-19-prompt-model-tool-routing-design.md`；记忆 `2026-07-19-agent-memory-design.md`

## 1. 目标

1. 降低 Alex 乱改配置、写坏类型导致编译不过且无闭环的问题。
2. **工具硬限制**可写路径；**编排硬环**保证 typecheck 结果回到改码方。
3. 引入独立 **QA** 角色（职责分明）：只读 + `run_check`，只出结构化报告。
4. 统一各 agent system prompt 的五段骨架（身份 / 职责 / 流程 / 上下文 / 交流），否定式约束优先写清禁区。

## 2. 非目标（P0）

- Mike 任务图编排 QA（assignee 仍仅 Alex）
- QA 自由 shell / 任意 npm script
- QA 阶段完整 `vite build`（留给 preview 队列）
- 语义向量 review、自动单测生成
- 全局拦截所有 `workspace.writeFile`（会误杀记忆写入）
- 向量记忆、UI 质检面板、多 QA 并行
- 修改 Pat/Mike 的产品流程语义（只改 prompt 结构与清晰度）

## 3. 已确认决策

| 决策 | 选择 |
|------|------|
| 闭环形态 | **方案 A**：应用编排硬环 `Alex → QA →（失败再 Alex）` |
| Engineer 单人 | **同样**过 QA |
| Team 任务模型 | QA **不是** `Task.assignee`；仍为编排阶段 |
| 重试 | QA 失败后最多再修 **2** 轮 Alex（`maxRepairRounds = 2`） |
| 重试耗尽 | **提示质检失败**，等用户再发消息触发修改；**不**将 task 标为 `failed` |
| 质检未过 | **不** `enqueuePreviewBuild`；**跳过** Mike summary |
| QA 对用户 | **只出结构化报告**，不闲聊 |
| 路径 ACL | **yaml allow 名单**；挂在 coder `write_file` 端口（与 Plan gate 组合） |
| 允许写 | `src/**`、`index.html` |
| `.project/memory` | **不进** `write_file` 白名单；仅 `remember_decision` / `confirm_requirement` 等专用路径写 |
| 变更感知 | `runTurn` 收集成功 `write_file` 的 `writtenPaths`，注入 QA；多轮重修累计去重 |
| 检查命令 | P0：`typecheck`（`npx tsc -b` 或等价）；权威以 exit code 为准 |
| Prompt 结构 | Alex / QA / Mike / Pat 统一五段；`mike-summary` 极简五段 |

## 4. 编排

### 4.1 Team

```text
用户消息
  → Mike：create_task（assignee 仅 Alex）
  → Alex：改码（write_file 受 ACL）
  → 若 filesChanged：
        writtenPaths 累计
        → QA（注入【本轮变更】；必调 run_check）
        → FAIL 且 repairRounds < max → 注入【质检结果】再开 Alex → 再 QA
        → FAIL 且达上限 → 向用户展示质检失败摘要；不 preview；跳过 Mike 总结；结束
        → PASS → enqueuePreviewBuild →（无 open tasks）Mike 总结
  → 若 !filesChanged：不跑 QA；按现逻辑收尾
```

### 4.2 Engineer（及 Plan 确认后的改码）

```text
用户消息 → Alex →（filesChanged 则）QA 环（同上）→ PASS 才 enqueuePreviewBuild
```

无 Mike；质检失败同样只提示、等用户再提。

### 4.3 Preview 时机

- **今天**：Alex 写完即 `enqueuePreviewBuild`。
- **改为**：仅 **QA PASS** 且本回合曾改文件后入队。
- QA 的 `run_check` ≠ preview 的完整 `npm run build`；后者仍供 iframe。

### 4.4 任务状态

- Alex 正常改完仍可 `completed`（或保持现有完成语义）。
- 质检耗尽：**不**因此改为 `failed`；用户可见质检失败报告即可。
- 运输层/异常失败：保持现有 `failTask` 行为（与质检耗尽区分）。

### 4.5 Speaker / UI

- `TeamTurnEvent.speaker`（及 Engineer 等价事件）扩展支持 QA 展示名（如 `QA`）。
- 身份标签：`QA | 质检`（最终文案实现时与 UI playbook 对齐）。
- QA 消息内容 = 结构化报告正文。

## 5. 路径 ACL

### 5.1 配置

```yaml
# configs/workspace/write-policy.yaml
allow:
  - "src/**"
  - "index.html"
```

- P0 以 **allow** 为准；未匹配即拒绝。
- 匹配规则：workspace 相对路径；`**` 通配；拒绝 `..` / 绝对路径（既有 path 解析仍生效）。

### 5.2 挂载点

- 包装 **coder 的 `write_file`**（Plan gate 之外再套一层，或合并为统一 write port 链）。
- **不要**在 `WorkspaceStore.writeFile` 全局拒绝：记忆与规格写入必须继续工作。

### 5.3 拒绝行为

- tool 返回 `ok: false` + 短中文原因（含被拒路径与「请只改 src/ 等」提示）。
- `read_file` / `list_files`：不限制。

## 6. 变更路径收集

### 6.1 `runTurn` 扩展

今日仅 `filesChanged: boolean`。扩展为：

```ts
{
  filesChanged: boolean;
  writtenPaths: string[]; // 本回合成功 write_file 的相对路径，去重、保序
}
```

### 6.2 注入 QA

编排在调用 QA 前追加合成 user（或等价块）：

```text
【本轮变更】
- src/App.tsx
- index.html
```

同一用户请求内多次 Alex 重修：路径 **并集去重**。

### 6.3 不采用

- 让 QA 猜 `list_files`
- 依赖 git diff（工作区不保证是 git）

## 7. QA Agent

### 7.1 包与 Prompt

| 项 | 位置 |
|----|------|
| Agent 插件 | `packages/agents/src/qa/`（或 `review/`） |
| Prompt | `prompts/review/qa-system.v1.md` + `.meta.yaml` |
| 展示名 | QA |

### 7.2 工具

| 工具 | 作用 |
|------|------|
| `run_check` | 在项目 workspace 执行 typecheck；返回 exit code + 日志尾部（约 2–4KB） |
| `read_file` | 只读 |
| `list_files` | 列目录（可选） |

**禁止**：`write_file`、记忆写入、自由命令。

### 7.3 `run_check` 语义

- P0：`npx tsc -b`（或与模板 `build` 中 typecheck 段等价）；缺 `node_modules` 时按需 install（实现可复用 sandbox 能力，但对 QA 暴露为单一 tool）。
- **硬规则**：exit ≠ 0 ⇒ 报告必须 FAIL；exit 0 才可 PASS。
- 编排层：若 QA 结束仍未成功执行过 `run_check`，视为未完成 → 强制 FAIL 或自动补跑一次（实现计划锁定一种）。

### 7.4 报告格式（prompt 约定）

```text
【质检结果】PASS|FAIL
检查：typecheck
问题：（FAIL 时条目；PASS 写「无」）
建议：（可选，短）
```

FAIL 时全文注入下一轮 Alex；耗尽时原样（或略裁）展示给用户。

## 8. Prompt 五段骨架

硬约束优先落在工具与编排；prompt 写判断与交流。各段标题可用中文或英文，正文简体中文。

### 8.1 通用五段

1. **身份** — 是谁、在系统中的位置  
2. **职责** — 做 / 不做  
3. **流程** — 可观察步骤（先读再写、必调某 tool 等），避免表演性长思考链  
4. **上下文 / 领域** — 技术栈、范围、记忆规则要点  
5. **交流** — 对用户说什么、详略、语言  

辅以 **否定式** 禁区列表（短、可执行）。

### 8.2 Alex（`prompts/coding/alex-system`）

- 身份：工程师；在允许范围内改前端工作区。  
- 职责：实现任务；按【质检结果】修类型/编译问题；短说明。  
- 流程：先读再写；只写白名单；FAIL 时对症修改、勿无关重构。  
- 上下文：Vite + React 19；可写 `src/**`、`index.html`；类型优先 `ReactElement` / `React.JSX.Element`；记忆走 `remember_decision`，勿用 `write_file` 写 `.project/memory`。  
- 交流：工具前 1–2 句意图；结束说明改了什么/为何。  
- 否定：不编造未读文件；不改受保护配置（会被拒绝）；不声称已 typecheck/预览通过。

### 8.3 QA（`prompts/review/qa-system`）

- 身份：质检；只验证不实现。  
- 职责：必 `run_check`；按需读【本轮变更】；只出报告。  
- 流程：看变更 →（可选）抽读 → `run_check` → 按退出码套报告格式。  
- 上下文：同模板技术栈；关注类型与明显坏 import；不做产品评价。  
- 交流：仅结构化报告。  
- 否定：检查红不得 PASS；不写文件；不跳过 `run_check`。

### 8.4 Mike 派任务（`mike-system`）

- 身份：团队领导；协调、不写码。  
- 职责：简述拆解 → 必须 `create_task` 派 Alex；本轮一任务。  
- 流程：理解需求 →（可选）记忆 tool → `create_task` → 短说明已派发。  
- 上下文：不假设 QA/编译结果；`remember_decision` / `set_preference` 按需。  
- 交流：简洁说明为何这样拆。  
- 否定：不改码、不多任务、不未派任务就结束、不声称已实现。

### 8.5 Mike 收尾（`mike-summary`）

- 极简五段；无工具；一段话；不编造。  
- 编排仅在 QA PASS（或本回合无改文件）后调用；质检未过不调用。

### 8.6 Pat（`pat-system`）

- 收成五段，**保留**现有提问示例格式与确认门闩语义。  
- 首条必澄清；一次一问 + 选项 + 推荐；确认前禁止 `confirm_requirement`。  
- 否定：不承诺马上改；不假装已实现；不一次抛问题清单；不陈述「我不能改代码」等能力清单。

## 9. 模块与依赖（落点示意）

```text
configs/workspace/write-policy.yaml
prompts/review/qa-system.v1.md (+ meta)
packages/agents/src/qa/          # tools: run_check, read, list
packages/agent-runtime           # writtenPaths
packages/application             # Engineer/Team 质检环；preview 时机；跳过 summary
apps/web                         # 装配 QA agent、speaker UI
```

依赖方向不变：`web → application → agents | sandbox/preview | workspace`。QA 经 workspace 读文件；检查命令经 sandbox（或薄封装）执行，**禁止** agent 直碰 `data/**`。

## 10. 验收标准（可测）

1. Alex `write_file` 写 `vite.config.ts` / `package.json` / `.project/memory/decisions.md` → tool 失败；写 `src/App.tsx` → 成功。  
2. `remember_decision` 仍能追加 `decisions.md`。  
3. Engineer：改码引入类型错误 → QA FAIL → Alex 重修 → PASS 后才 enqueue preview。  
4. Team：同上；PASS 后才 Mike summary；耗尽 FAIL 无 preview、无 Mike summary、用户可见【质检结果】。  
5. `filesChanged === false` 不跑 QA。  
6. QA 报告含 `【质检结果】PASS|FAIL`；对用户无额外闲聊义务。  
7. Mike/Pat/Alex/QA prompt 文件含五段结构（summary 可极简）。

## 11. 风险与后续

| 风险 | 缓解 |
|------|------|
| 仅 typecheck 漏掉 vite 构建错误 | PASS 后仍有 preview build；失败可见于预览状态（P1 可考虑 FAIL 回流） |
| 重修烧 token | `maxRepairRounds = 2` 硬顶 |
| allow 过严挡合法改动 | yaml 可扩；P1 再加 deny 列表或按模板 profile |
| QA 跳过 run_check | 编排强制 |

P1 候选：`check: typecheck | build` 配置；preview 失败回流；QA 轻量语义 review 清单。
