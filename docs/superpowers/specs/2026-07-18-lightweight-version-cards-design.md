# 设计：轻量版本记录（版本卡片）

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：P0 版本卡片 + 持久化元数据；构建成功后 LLM（小模型）生成一句中文摘要；不做 git 回滚 / 点卡切预览
- PRD：§3 P0「轻量版本记录」、规则 K、§7.9 AC1–AC3；演示 §8 标准 F / §9
- UI：`docs/ui/ai-surfaces.md` §3 Version；Neutral Tool + shadcn

## 1. 目标

1. 每次 **Agent 改码后入队** 的预览构建 **成功** 后，聊天流出现「版本 N」卡片（版本号 + 一句话变更摘要）。
2. 版本与对应消息写入 SQLite；刷新后仍可见。
3. 与普通消息 / TaskCard 视觉可区分（弱边框即可，不要大营销卡片）。

## 2. 非目标

- Remix / 完整版本分支
- **源码回滚**（下一迭代用 git 快照；本轮仅预留 `snapshotRef`）
- 点击版本切换预览 / 回滚（默认可不做；`previewRevision` 仅元数据预留）
- `MessageItem` 大拆、`ViewerChrome` 重构
- 语法高亮、Trace/Token 面板
- 手动刷新 / ensure 触发的构建创建版本

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 数据模型 | 独立 `versions` 表 + 聊天消息引用 `versionId` |
| 触发 | 仅 Agent `filesChanged` 后 `enqueuePreviewBuild` 的成功构建；手动 refresh/ensure 不建 |
| 成功落库 | `PreviewService` 可选 `onBuildComplete`；application 注册后写 version + 消息 |
| 摘要 | 构建 **成功后** 调 LLM（小模型）出一句中文；失败则截断兜底，仍建卡 |
| 实时 UI | 预览轮询见 `building → ready`（及摘要延迟）后 refetch messages |
| 回滚 | P0 不上；下迭代 git；`snapshotRef` 恒 null |

## 4. 架构与依赖

```text
apps/web
  → @isotope/application
      → @isotope/workspace   # versions / pending / messages
      → @isotope/preview     # onBuildComplete hook
      → @isotope/llm         # 摘要（小模型）
```

禁止：

- Agent / UI 直接读写 `data/**`
- `workspace` → `preview` / `agents` / `web`
- 在 TS 中硬编码摘要 Prompt（放 `prompts/`）

### 4.1 职责

| 层 | 职责 |
|----|------|
| `workspace` | `versions`、`pending_version_intents`、messages.`version_id`；递增 number；CRUD |
| `preview` | 构建终态回调 `onBuildComplete`；**fire-and-forget**（不 await），以免 LLM 阻塞全局构建队列 |
| `application` | 改码路径登记 pending；成功时调 LLM → `recordVersion` + `appendMessage`；组装 hook |
| `llm` | 现有 `LlmClient.complete`；配置指向小模型 |
| `web` | `VersionCard`；Message 带 `versionId`/`versionNumber`；ready 后拉消息 |

## 5. 数据模型

### 5.1 `versions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | |
| `project_id` | TEXT FK | |
| `number` | INTEGER | 项目内从 1 递增 |
| `summary` | TEXT | 一句中文摘要 |
| `preview_revision` | TEXT NULL | 成功时的 preview revision（L1 预留） |
| `snapshot_ref` | TEXT NULL | git 快照预留；P0 恒 NULL |
| `created_at` | TEXT | ISO-8601 |

索引：`(project_id, number)`；`number` 在项目内唯一。

### 5.2 `pending_version_intents`

| 字段 | 类型 | 说明 |
|------|------|------|
| `project_id` | TEXT PK | 一项目至多一条「等待版本」 |
| `created_at` | TEXT | |

含义：该项目有一次改码构建尚未兑现为版本。最终 `summary` **不**存在 pending 里（成功后再由 LLM 生成）。

P0：成功时从该项目最近消息现取上下文喂给 LLM；**不**在 pending 存 `source_hint`（YAGNI）。

### 5.3 `messages`

- 新增可空 `version_id`（FK → versions）
- 版本卡消息：`role: "system"`，`version_id` 非空，`content` = summary（纯文本可读）
- 领域 `Message` 对外可带 `versionNumber`（list 时 join），供 UI 渲染「版本 N」

## 6. 时序

```text
回合结束且 filesChanged
  → upsert pending_version_intent(projectId)
  → enqueuePreviewBuild（仅此路径登记 pending）
  → preview 异步构建
       ├─ success → 写 ready 后 fire-and-forget onBuildComplete(ok, revision)
       │     → 原子 takePending(projectId)：无则 noop（手动构建）
       │     → 取上下文（助手终轮结论 > 用户最后一句 > 「代码已更新」）
       │     → LLM 一句中文摘要（失败 → 截断兜底，约 ≤80 字）
       │     → INSERT version → appendMessage(system + versionId)
       └─ failed → 写 failed 后 fire-and-forget：takePending（丢弃，不调 LLM、不建卡）
```

**并发：**

- 同项目已在 building、enqueue 被跳过时：**不**清除已有 pending。
- 成功/失败路径必须先 **takePending**（读出并删除）再跑 LLM，避免摘要等待期间新回合 upsert 的 pending 被误删。

**摘要 Prompt：** `prompts/` 下独立模板（如 `workspace/version-summary`）；变量含变更上下文；要求单句中文、约 ≤80 字、无前后缀。

## 7. UI

- 新增 `VersionCard`：`版本 {N}` + summary；弱边框、小 padding；不可点击回滚
- `MessageRow`：若 `versionId` 有值则渲染 `VersionCard`，不走 User/Agent 气泡
- 预览轮询：`building → ready` 后 `GET` messages 合并 state；因 LLM 在 ready 之后，可短间隔再拉 1～2 次直到出现新版本消息或超时
- SSR `listMessages` 含历史版本消息 → 刷新仍在

遵循 Neutral Tool + shadcn；禁止 Demo/Landing/紫粉渐变/自写皮肤。

## 8. 错误处理

| 情况 | 行为 |
|------|------|
| 构建失败 | takePending 丢弃；不建卡 |
| LLM 失败/超时 | 截断兜底；仍建卡 |
| takePending 为空的 ready | noop |
| 非 owner | 与现有 API 一致 |
| `snapshotRef` | 恒 null |

## 9. 测试与验收

**测试**

- workspace：number 递增、version 消息、pending 生命周期
- application：改码成功建卡；失败不建；手动 enqueue 不建；LLM mock 失败走兜底
- preview：ready/failed 各触发一次 `onBuildComplete`
- UI：`versionId` → VersionCard（轻量）

**验收**

- AC1：至少一次成功构建后出现「版本 N」卡片
- AC2：含短摘要（LLM 或兜底）
- AC3：持久化，刷新仍可见
- typecheck / 相关单测通过

## 10. 后续（P2 待办）

> 已登记为 PRD §3 P2「版本 git 快照与回滚」，本轮不做。

- 用 git 对 `workspace/`（排除 `node_modules`）打快照，写入 `snapshotRef`
- 版本卡操作：恢复源码 / 可选打开对应 `previewRevision` 产物
- 保留最近 N 版快照上限，控制 `data/` 体积
