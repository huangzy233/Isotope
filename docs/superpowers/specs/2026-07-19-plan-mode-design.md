# 设计：Plan 模式（需求澄清 + 可组合 Team）

- 日期：2026-07-19
- 状态：已批准（对话确认）
- 范围：Pat 澄清 → 推荐路径 → 需求规格说明 → 用户肯定性确认 → 静默下游（Alex 或 Mike→Alex）；Plan/Team 双开关可组合；Composer 模式 chip；AC5 双保险
- 相关：`docs/PRD.md` §6.2 / §7.6 / §7.12；Engineer 设计 `2026-07-18-engineer-agent-turn-design.md`；Team 设计 `2026-07-18-team-leader-task-flow-design.md`

## 1. 目标

落地 P0 Plan 模式，并支持与 Team **同时开启**：

1. 用户打开 Plan（可同时开 Team），提交初始需求。
2. **Pat（产品）** 至少一轮有意义提问澄清需求。
3. 给出编号推荐路径（1/2/3/4）或接受自然语言自定义。
4. 输出 **需求规格说明** 供用户审阅，并提示回复 OK/确认等以开始执行。
5. 用户肯定性回复后：落库确认摘要、**关闭 Plan 开关**、静默开启下游回合（不代发 handoff 用户消息）。
6. 下游：仅 Plan → Alex；Plan∧Team → Mike 任务流 → Alex；之后走现有改码 → 构建 → App Viewer。

## 2. 非目标

- 记忆系统（P0 占位，另议）
- Agent 安全与权限治理、Prompt 指定模型（P1）
- Race / Deep Research / Publish
- 规格说明富 UI、路径点击选择器（P0 用 Markdown）
- 把 Team（Mike 任务卡）焊进 Pat 的同一条 `runTurn`
- 无关大重构；不改 Playbook 视觉体系（chip 仅用现有 token 做轻量强调）

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 产品角色 | **Pat \| 产品**；agent：`packages/agents/src/requirement/`；prompt：`prompts/requirement/` |
| 模式模型 | 双布尔 `planEnabled` + `teamEnabled`（都关 = Engineer）；可组合 |
| 仅 Plan 下游 | 确认后 → **Alex** |
| Plan∧Team 下游 | 确认后 → **Mike → 任务 → Alex** |
| 确认态 | 项目字段 `planConfirmed` + `confirmedRequirement`；澄清靠普通消息 |
| 确认 UX | 规格说明 + 用户发 OK/确认等；Pat 调 `confirm_requirement`；**无**确认按钮 |
| 确认后 Plan 开关 | **`planEnabled=false`**（字面退出 Plan） |
| 交接传输 | 确认回合结束 → SSE `done` 带 `nextTurn` → **静默**自动开下游（不 append handoff user） |
| 新建续跑 | 与 Engineer 同构：Pat 占位 → 工作台 `continue` 跑 Pat 首轮 |
| AC5 | 编排不调度 Alex + `writeFile`/入队构建双保险 |
| 架构 | 方案 1：模式路由器 + 专用 `beginPlanTurn`；下游复用现有 Engineer/Team |
| Composer | Plan/Team 开启时输入框内 chip + X 关闭（类 Cursor） |

### 3.1 主路径矩阵

| planEnabled | teamEnabled | 主路径 |
|-------------|-------------|--------|
| false | false | Engineer：Alex 直改 |
| true | false | Plan：Pat → 确认 → Alex |
| false | true | Team：Mike → Alex |
| true | true | Plan∧Team：Pat → 确认 → Mike → Alex |

路由（确认后 / 未开 Plan）：

```text
planEnabled && !planConfirmed → plan_clarify（Pat）
else if teamEnabled → team
else → engineer
```

## 4. 成功标准

1. 仅 Plan：首轮 Pat；规格 → OK → Plan 关闭 → 静默 Alex → 有写文件则自动构建预览。
2. Plan∧Team：确认后走 Team，不经 Plan 编排内嵌任务卡。
3. 未确认：无工程师成功改码 + 成功构建主路径（单测覆盖双保险）。
4. Composer chip：开则显示，点 X 关对应开关（工作台持久化）。
5. 刷新保持 flags / 确认态；与 Engineer 路径肉眼可区分。
6. 相关 typecheck / 单测通过；可演示 PRD 附录 B 第 4 步。

## 5. 数据模型

### 5.1 项目字段

替换（或迁移离开）单一 `ProjectMode` 三选一作为真相源：

```ts
planEnabled: boolean;              // default false
teamEnabled: boolean;              // default false
planConfirmed: boolean;            // default false
confirmedRequirement?: string;     // 确认时写入；未确认不出现
```

兼容迁移：旧 `mode: "engineer" | "team"` → `planEnabled: false`，`teamEnabled: mode === "team"`。实现期 API 可短暂接受旧 `mode`，尽快单一真相（双布尔）。

### 5.2 切换语义

- **打开 Plan**（`false→true`）：
  - 若 `planConfirmed === false`（尚无确认）：进入 / 保持澄清闸门，下一回合走 Pat。
  - 若已确认（P0）：**保留** `planConfirmed` 与 `confirmedRequirement`，不强制重新澄清；因路由条件是 `planEnabled && !planConfirmed`，此时仍走 Team/Engineer 下游（重新澄清留 P1）。
- **关闭 Plan**：闸门不再适用；不强制清确认字段。
- **确认成功**：`planConfirmed=true`，写入 `confirmedRequirement`，**`planEnabled=false`**；`nextTurn` 按确认瞬间的 `teamEnabled` 决定（true→`team`，false→`engineer`）。
- **仅改 Team**：不影响确认字段。

### 5.3 消息

- Pat：`agentName: "Pat"`；UI **Pat | 产品**
- 不引入 message kind 枚举（P0）
- 新建且 `planEnabled`：助手占位 `agentName: "Pat"`

## 6. 架构与编排

### 6.1 包职责

| 包 | 本轮职责 |
|----|----------|
| `apps/web` | 双开关菜单 + Composer chip；创建/PATCH flags；stream 路由按 `resolveTurnKind`；消费 `done.nextTurn` 静默开下游；Pat 身份展示 |
| `@isotope/application` | `resolveTurnKind`；`beginPlanTurn`；确认工具副作用；组装下游 brief；AC5 端口包装；迁移读写 |
| `@isotope/agent-runtime` | 复用 `runTurn`（Pat 无写文件工具） |
| `@isotope/agents` | 新增 requirement/Pat；导出 `createRequirementAgent` |
| `@isotope/workspace` | 项目字段扩展；updateProject 支持新字段 |
| `prompts/requirement/` | `pat-system.v1.md` |
| 现有 Engineer/Team | 确认后复用；注入 `confirmedRequirement` 上下文 |

### 6.2 依赖方向

```text
apps/web
  → @isotope/application
      → @isotope/agent-runtime
          → @isotope/agents
          → @isotope/llm
      → @isotope/workspace
      → @isotope/preview
```

禁止：Agent 直碰 `data/**`；TS 硬编码长 Prompt；Plan 编排内嵌 Mike 任务状态机。

### 6.3 Plan 澄清回合

`beginPlanTurn` 对齐 `continue` / `send`：

- **continue**：替换 Pat 占位 → 流式 Pat 首轮
- **send**：append user → Pat（澄清 / 路径 / 规格 / 确认）

Pat 工具（仅）：

- `confirm_requirement({ summary: string })`  
  → `planConfirmed=true`，`confirmedRequirement=summary`，`planEnabled=false`

不挂载 `write_file`、任务工具。

### 6.4 用户流程（澄清 → 规格 → 确认）

```text
初始需求
  → Pat 至少一轮有意义提问
  → 编号路径 1/2/3/4 或用户自定义
  → Pat 输出「需求规格说明」+ 提示回复 OK/确认 开始执行
  → 用户肯定性消息
  → confirm_requirement → 落库并关闭 Plan
  → SSE done { planConfirmed: true, nextTurn: "engineer" | "team", ... }
  → 客户端静默开下游（无新 user handoff 气泡）
  → 下游 runTurn 注入 confirmedRequirement 作为执行简报
```

### 6.5 SSE `done` 扩展

在现有字段上增加：

```ts
planConfirmed?: boolean;
nextTurn?: "engineer" | "team";
```

`filesChanged` / `previewEnqueued` 在澄清回合恒为 `false`。

静默下游触发（P0 默认）：客户端在 `done.planConfirmed` 后 POST `{ action: "send", silentHandoff: true }`（或等价字段）；application **不** `appendMessage` user，仅启动 `resolveTurnKind` 对应下游并注入 `confirmedRequirement`。不占用「占位 continue」语义，避免与新建续跑冲突。

### 6.6 AC5 双保险

1. `planEnabled && !planConfirmed` 时路由只进 `plan_clarify`
2. 同条件下 workspace `writeFile` 包装拒绝；`enqueuePreviewBuild` 拒绝

### 6.7 防重入与失败

- 同一 `projectId` 共用现有 turn 锁；澄清与下游不并行
- 确认工具空摘要 → 工具错误，不落库、不自动下游
- 自动下游 409：客户端短重试 1–2 次；仍失败则提示可手动再发
- LLM/配置失败：与 Engineer 相同，可见错误文案；不置确认

## 7. UI

### 7.1 模式菜单

`+` Popover：两个 Switch——Plan、团队；与项目/本地 flags 同源。

### 7.2 Composer 模式 Chip

- `planEnabled` → `Plan` chip（图标 + 文案 + **X**）
- `teamEnabled` → `Team` chip（同上）
- 都开 → 两 chip 并排；都关 → 无 chip（Engineer）
- 点 X → 对应 flag `false`（工作台 PATCH；首页改待提交状态）
- 确认成功后 Plan chip 随 `planEnabled=false` 消失
- 用现有 Playbook token，轻量区分色即可

### 7.3 身份与正文

- **Pat | 产品**；路径与规格为 Markdown，无独立确认按钮

## 8. API 要点

- `POST /projects`：`planEnabled` + `teamEnabled`；占位 agent：`plan ? Pat : team ? Mike : Alex`
- `PATCH /projects/:id`：可更新两布尔（及实现需要的确认字段只读暴露）
- `POST .../messages/stream`：`resolveTurnKind` 取代 `mode === "team"` 二分

## 9. 测试重点

| 区域 | 要点 |
|------|------|
| `resolveTurnKind` | 四组合 × 确认前后 |
| `beginPlanTurn` | 占位替换；确认落库并关 `planEnabled` |
| AC5 | 未确认不调度 Alex；write/enqueue 拒绝 |
| 静默下游 | `nextTurn`；上下文含摘要；无 handoff user 气泡 |
| 迁移 | 旧 `mode` → 双布尔 |
| UI | chip 显隐与 X（能测则测） |

## 10. PRD 对齐说明

本设计将「三模式互斥」改为「Plan / Team 两开关可组合」。`docs/PRD.md` 已按本 spec 回写 §2/§4/§5/§6.2/§7.2/§7.6/§7.12/附录 B 等相关表述。

验收仍覆盖原 §7.12 AC1–AC6 意图，并扩展：

- AC4：仅 Plan → 工程师；Plan∧Team → Leader 任务流再执行
- 确认后 Plan 关闭；Composer 对开启的 Plan/Team 展示可关闭 chip

## 11. 实现顺序建议

1. workspace 字段 + 迁移 + `resolveTurnKind`
2. Pat agent + prompt + `beginPlanTurn` + 确认工具 + AC5 包装
3. stream / create / PATCH API
4. UI：菜单双开关 + chip + Pat 标签 + 静默下游
5. 单测 + 附录 B 第 4 步手测
