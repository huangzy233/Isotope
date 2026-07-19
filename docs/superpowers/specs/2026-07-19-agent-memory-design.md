# 设计：Agent 记忆系统（短期 + 长期）

- 日期：2026-07-19
- 状态：已批准（对话确认）
- 范围：短期 context 窗口压缩；长期 Preference（DB）+ Product Spec / Decision（项目内 `.project/memory`）；确定性注入，无向量
- 相关：`docs/PRD.md` §6.2.1 / §7.13；Plan `2026-07-19-plan-mode-design.md`；过程可见性 `2026-07-18-agent-process-visibility-design.md`；骨架 `docs/architecture/PROJECT_SKELETON.md`

## 1. 目标

1. 长对话不把全量 `Message.content` 塞进 LLM；统一组装短期窗口 + 滚动摘要。
2. 长期记忆分两档：**用户级 Preference** 落库跨项目；**产品级** Product Spec / Decision 以项目文档组织。
3. 每回合确定性注入记忆块；写入显式（tool / Plan 确认），禁止静默从全文对话自动抽取。
4. 回写 PRD 细则与可测 AC。

## 2. 非目标（P0）

- 向量库 / 语义 top-k 检索
- Knowledge / Lesson / Habit 等额外类型
- 跨项目 Product Spec
- UI 记忆管理面板
- 滚动摘要落盘（`.project/memory/session-digest.md`）
- `decisions/*.md` 多文件
- 无关大重构

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 范围 | C：短期窗口 + Spec / Decision / Preference |
| 实现路径 | 结构化 KV + 确定性组装（方案 1） |
| Preference | **唯一**落库的长期记忆；按 `userId` 隔离；`@isotope/memory` |
| Product Spec / Decision | **不进 DB**；`workspace/.project/memory/*` |
| Plan 确认字段 | 保留 `confirmedRequirement` 作门闩；确认时**双写** `product-spec.md` |
| Context 注入 | 以文件为准；文件缺失回退 DB `confirmedRequirement`；**去掉**每回合 `【已确认需求】` history 前插 |
| 摘要 | 组装时即时启发式压缩，不落盘 |
| 向量 | P0 不做 |

## 4. 概念分层

| 层 | 存哪 | 生命周期 |
|----|------|----------|
| 短期-会话 | `workspace` messages | 随项目；组装时窗口化 |
| 短期-回合内 | `runTurn` 内存 `messages` | 回合结束丢弃（结论进 Message） |
| 长期-Preference | `@isotope/memory` + SQLite | 跟用户，跨项目 |
| 长期-Product Spec / Decision | `workspace/.project/memory/*` | 跟项目 |

```text
listMessages → 过滤/加身份/窗口/摘要
Preference + product-spec + decisions(尾部)
  → buildTurnContext
  → runTurn(system + memoryBlock + history)
回合内 tool result → 字符上限截断
```

## 5. 项目内文档约定

路径（相对项目 workspace 根，经 `@isotope/workspace` 读写）：

```text
.project/
  memory/
    product-spec.md    # 产品是什么 / 目标 / 非目标；Plan 确认时写入或覆盖
    decisions.md       # 已拍板取舍的追加日志
```

- 模板可不预置；首次写入时创建目录与文件。
- `.project/**` 对只读编辑器可见。
- Agent **禁止**直碰 `data/**`；一律走 workspace 端口。

### 5.1 `product-spec.md`

- 内容：Plan 确认时的需求规格摘要（与 `confirm_requirement` 的 `summary` 对齐）。
- 写入：覆盖写（非追加）。
- 读取：`buildTurnContext` 注入；缺失则回退 `project.confirmedRequirement`。

### 5.2 `decisions.md`

- 格式（每条一行或一小段，追加）：

```markdown
## 2026-07-19T03:00:00.000Z
用本地存储，不做后端登录。
```

- 注入：解析后取**尾部 K 条**（默认 K=20）；文件不存在则跳过。

## 6. Preference（`@isotope/memory`）

### 6.1 端口

```ts
export type PreferenceKey =
  | "ui_language"
  | "explanation_verbosity"
  | "code_style_notes";

export type PreferenceStore = {
  getPreferences(userId: string): Record<PreferenceKey, string | undefined>;
  upsertPreference(
    userId: string,
    key: PreferenceKey,
    value: string,
  ): void;
};
```

- P0 key **白名单仅上述 3 个**；未知 key 拒绝。
- 值：非空 trim 后字符串；建议单值 ≤ 500 字符。
- 存储：与现有 `isotope.sqlite` 同库新表 `user_preferences`（`user_id`, `key`, `value`, `updated_at`），PK `(user_id, key)`。
- `memory` 包依赖：`kernel` + sqlite 打开方式与 workspace 对齐（`openMemoryDatabase(dataRoot)` 或接收已打开 `Database`）；**不**依赖 `agents` / `workspace`。

### 6.2 读写时机

| 动作 | 时机 |
|------|------|
| 写 | Agent tool `set_preference`；禁止静默全文抽取 |
| 读 | 每回合 `buildTurnContext`；有非空项则注入，全空则省略块 |

## 7. 短期记忆：`buildTurnContext`

落点：`packages/application`（engineer / team / plan 共用），替换三处重复 filter。

### 7.1 步骤（顺序固定）

1. **过滤**：`role === user|assistant`；`content !== ASSISTANT_PLACEHOLDER`；只用 `content`（`process` 不进）。
2. **身份**：若有 `agentName`，assistant 内容前缀 `[Alex]` / `[Mike]` / `[Pat]`（与 `agentName` 一致）。
3. **窗口**：最近 N 条原文（默认 **N=20**，可配置常量）。
4. **滚动摘要**：被窗口裁掉的更早消息，启发式拼成一条合成 user（截断总长，如 ≤ 2000 字符）；无更早消息则不插入。
5. **长期块**（拼进返回的 `memoryBlock` 字符串，由调用方放在 system 旁或 history 最前一条合成 system/user——P0 锁定为 **history 最前一条合成 `user`，角色文案前缀 `【记忆】`**，与旧 `【已确认需求】` 同构但合并三类，避免改 `runTurn` system 契约）：
   - Preference（有则）
   - product-spec（文件优先，否则 DB 回退）
   - decisions 尾部 K 条（有则）
6. **禁止**再单独 unshift 整段 `【已确认需求】\n${confirmedRequirement}`。

### 7.2 返回形状

```ts
export type TurnContext = {
  /** 已含可选【记忆】首条 + 可选摘要条 + 窗口消息 */
  history: Array<{ role: "user" | "assistant"; content: string }>;
};
```

### 7.3 回合内 tool 截断

`packages/agent-runtime` `runTurn`：写入 `role: "tool"` 的 `content` 前，若长度 > **M**（默认 **8000**），截断并追加 `\n…(已截断，可再 read_file)`。

## 8. Agent Tools

| Tool | 谁挂载 | 行为 |
|------|--------|------|
| `set_preference` | Alex（及需要时 Mike）；**不**挂 Pat P0 | `key` 白名单 + `value` → `PreferenceStore.upsertPreference(ownerUserId, …)` |
| `remember_decision` | Alex、Mike | 追加一行到 `.project/memory/decisions.md`（经 workspace `writeFile`；读旧+拼+写） |
| `confirm_requirement` | Pat（已有） | 现有 DB 更新外，**同步** `writeFile` `.project/memory/product-spec.md` |

Port 扩展：application 组装 port 时注入 `userId` + memory store；文件类仍走 `WorkspaceToolPort`。

## 9. 包边界

```text
application
  → memory          # Preference only
  → workspace       # messages + .project/memory
  → agent-runtime   # runTurn + tool 截断

memory → kernel（+ sqlite）
agents → 工具定义；执行经 port（不直读 DB）
```

与 `PROJECT_SKELETON.md`：`memory` = 跨项目用户记忆；项目文档走 workspace。

## 10. 成功标准

1. Preference：用户 A 写入后，其另一项目回合 context 含该偏好；用户 B 不可见。
2. Product Spec：Plan 确认后存在 `.project/memory/product-spec.md`；后续 Engineer/Team 回合 history 含其内容；刷新仍在；且不再每回合重复前插旧 `【已确认需求】` 单独块（并入 `【记忆】`）。
3. Decision：`remember_decision` 后 `decisions.md` 追加；后续回合 `【记忆】` 含该条。
4. 短期：消息数 > N 时发给 LLM 的 history 不含全量最早原文；含一条摘要合成消息；`process` 仍不进。
5. 回合内超大 tool result 被截断。
6. 相关 typecheck / 单测通过。

## 11. 测试要点

- `buildTurnContext`：过滤 placeholder、身份前缀、窗口 N、摘要、记忆块顺序、文件优先/DB 回退、无记忆时不插空块。
- `PreferenceStore`：隔离、白名单拒绝、upsert 覆盖。
- Plan 确认双写：DB + `product-spec.md`。
- `remember_decision` 追加格式。
- `runTurn` tool content 截断。
- engineer/team/plan 均走 `buildTurnContext`（集成测至少一处锁定不再 unshift `【已确认需求】`）。

## 12. PRD 回写映射

- §6.2.1 规则 G1/G2 → 本设计类型与存储分流。
- §7.13 AC → §10 成功标准细化后的可测条目。
