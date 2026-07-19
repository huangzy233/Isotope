# 设计：版本记录查看

- 日期：2026-07-19
- 状态：已批准（对话确认）
- 范围：工作台内浏览项目版本列表；在「仅当前预览产物可打开」前提下，列表与聊天 VersionCard 可切到 App Viewer
- 前置：`docs/superpowers/specs/2026-07-18-lightweight-version-cards-design.md`（P0 版本卡 + 持久化）
- PRD：§7.9 轻量版本记录（本轮补「主动查看」入口）；P2 回滚仍不做
- UI：`docs/ui/ai-surfaces.md` §3 Version；Neutral Tool + 现有 shadcn Dialog

## 1. 目标

1. 对话顶栏提供「版本」入口，打开 Dialog，列出该项目全部版本（权威浏览入口，不依赖在聊天流里偶遇版本卡）。
2. 每条展示：版本号、摘要、相对时间、绝对时间、是否关联 / 是否仍可打开 `previewRevision`。
3. 「查看该版预览」仅当该版本的 `previewRevision` 等于**当前** App Viewer 的 `revision` 且 status 为 `ready` 时可点；否则禁用并说明原因。
4. 聊天内 `VersionCard` 与列表预览规则一致（并存、强联动）；不做源码回滚。

## 2. 非目标

- 源码回滚 / 写入或使用 `snapshotRef`（PRD P2 / 轻量版本卡设计 §10）
- 多份构建产物归档（`build/revisions/<rev>/`）；用 `?r=` 假装打开历史产物
- 聊天上方常驻版本时间线；独立侧栏版本页
- 列表「在对话中定位」到 VersionCard（YAGNI）
- `MessageItem` / `ViewerChrome` 大重构；引入 Sheet；另起视觉皮肤
- 手动 refresh / ensure 触发的构建补建版本（仍遵循 P0 触发规则）

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 入口 | 对话 `PanelHeader`「版本」→ Dialog 列表 |
| 字段 | 版本号 + 摘要 + 相对/绝对时间 + 预览状态 |
| 开预览 | 允许，但**仅当前** `preview.revision` 可开（诚实；因 `build/` 单目录覆盖） |
| 与 VersionCard | 并存；卡与列表均可按同一规则开预览 |
| 容器 | 现有 shadcn Dialog（不新增 Sheet） |
| 历史产物归档 | 本轮不做；登记为后续增量 |

### 3.1 为何不能「打开任意历史预览」

`@isotope/preview` 每次成功构建覆盖同一 `build/`，`preview-status.json` 只保留当前 `revision`。`versions.previewRevision` 是当时的标识，**不**指向可回放目录。本轮禁止用旧 `?r=` 伪装历史内容；完整回放需另做产物归档（见 §10）。

## 4. 架构与依赖

```text
apps/web
  → @isotope/application   # listProjectVersions（新建薄用例）
      → @isotope/workspace # 已有 listVersions / Version
  （开预览：纯前端，对照工作台已有 preview 轮询状态；不改 preview 存储）
```

禁止：

- UI / Agent 直接读写 `data/**`
- `workspace` → `preview` / `web`
- 为「历史预览」在本轮改 sandbox 发布布局

### 4.1 职责

| 层 | 职责 |
|----|------|
| `workspace` | 已有 `listVersions`（实现为 `number ASC`，旧→新）；本轮**不改**存储与该方法默认顺序 |
| `application` | `listProjectVersions`：归属校验 → `listVersions` → **反转为新→旧** 再返回（供 Dialog） |
| `web` API | `GET /api/projects/[id]/versions` |
| `web` UI | 顶栏按钮、`VersionHistoryDialog`、`VersionCard` 可选预览动作、可预览判定 helper |

### 4.2 数据流

```text
打开「版本」Dialog
  → GET /api/projects/:id/versions
  → 渲染列表（新→旧）
  → 每行用 version.previewRevision 与当前 preview.{revision,status} 判定可预览

点击「查看预览」（仅可预览）
  → 关闭 Dialog
  → 切到「应用查看器」Tab（若在编辑器）
  → iframe 已由现有轮询加载当前 revision；不改写为历史 r=
```

### 4.3 刷新

- Dialog **打开时**拉取一次 versions；不强制常驻轮询。
- 新版本经现有「构建成功 → 写 version + messages refetch」路径出现后：若 Dialog 仍开着，可选再拉；否则关开即可（实现择一，优先打开时拉取）。

## 5. API 与类型

### 5.1 `GET /api/projects/[id]/versions`

- 鉴权 / 归属：与现有 project messages / preview API 一致。
- 响应形状：`{ versions: Version[] }`（对齐 `{ messages }`）。
- 顺序：**新→旧**（`number` 降序）。由 application 在 `listVersions`（ASC）结果上 `reverse`（或等价），用例测试锁定；不修改 workspace 默认 ASC。
- 字段沿用领域 `Version`：`id`, `projectId`, `number`, `summary`, `previewRevision`, `snapshotRef`, `createdAt`。

### 5.2 可预览判定（前端纯函数）

```text
canOpenPreview(version, preview) =
  preview?.status === "ready"
  && version.previewRevision != null
  && version.previewRevision === preview.revision
```

| 条件 | UI 标签 | 「查看预览」 |
|------|---------|--------------|
| `canOpenPreview` | 可预览 | 启用 |
| `previewRevision` 非空但不满足上式 | 产物已覆盖 | 禁用 |
| `previewRevision` 为空 | 无预览 | 禁用 |

## 6. UI

### 6.1 入口

- `PanelHeader` `trailing`：在现有 `StatusBadge` **左侧**放 `Button`「版本」（`variant` outline 或 ghost，`size="sm"`）。
- 无版本时仍可打开 → Dialog 内 EmptyState。

### 6.2 `VersionHistoryDialog`

- 标题：「版本记录」。
- 描述（Metadata）：「成功构建后的变更摘要；仅当前预览产物可打开。」
- 列表行式：主行 `版本 {N}` + 摘要；次行相对时间 · 绝对时间（本地）· 预览标签；行尾「查看预览」。
- 视觉：细分隔、弱层级；**禁止**大营销卡、紫粉渐变、为列表重做 Sparkles 皮肤。VersionCard 聊天内外观可保持现状，列表本身走 Neutral Tool。
- 状态：加载短文案/Skeleton；错误一行 destructive；空 EmptyState「暂无版本记录」。

### 6.3 `VersionCard`

- 保留聊天流展示；当 `canOpenPreview` 时提供与列表相同的开预览动作（整卡可点或次要文字按钮，二选一，实现时选更贴现有卡片结构者）。
- 不可预览时只读；可用 `title`/Tooltip 说明原因，避免整卡灰化刷屏。

### 6.4 文档

- 更新 `docs/ui/ai-surfaces.md` §3 Version：可从对话顶栏 Dialog 浏览；开预览仅限当前产物。

## 7. 错误处理

| 情况 | 行为 |
|------|------|
| 未登录 / 非 owner | 401 / 403（与现有一致） |
| 项目不存在 | 404 |
| 版本列表为空 | EmptyState，非错误 |
| GET versions 失败 | Dialog 内短错误，可关闭后重试 |
| 点击后 status 已变非 ready | 关 Dialog 后 Viewer 按现有状态机展示，不假装成功 |
| 构建中最新 version 尚未落库 | 列表暂缺；关开 Dialog 或后续 refetch 可见 |

## 8. 测试与验收

**测试**

- application：`listProjectVersions` 归属拒绝；成功时版本数组为新→旧（即使 store 为 ASC）。
- web：`canOpenPreview`（匹配 ready / 不匹配 / null revision / 非 ready）。

**验收**

- AC1：对话顶栏可打开「版本记录」，见该项目全部持久化版本。
- AC2：每条含版本号、摘要、相对+绝对时间、预览状态标签。
- AC3：仅当前 `preview.revision` 对应且 ready 的版本可「查看预览」，并切到应用查看器。
- AC4：聊天 `VersionCard` 与列表预览规则一致。
- AC5：刷新后列表仍可读（SQLite）；无源码回滚、无多产物归档。

## 9. 实现时注意（外科手术）

- 复用 `workspace.listVersions`，避免平行存储。
- 开预览不改 `preview` 包存储模型。
- 不顺手重构 `workbench-shell` 大文件；Dialog / helper 抽成小组件即可。
- 相对时间：若仓库已有日期工具则复用，否则最小本地格式化，勿引入重型库。

## 10. 后续（非本轮）

1. **历史预览回放（原方案 2）**：成功构建发布到 `build/revisions/<revision>/`，保留最近 N 份（建议 10）；列表对保留集内版本可开预览；Viewer 标明「正在预览版本 N」。
2. **P2 源码回滚**：git 快照 → `snapshotRef`；「恢复到此版本」（见轻量版本卡设计 §10）。
3. 可选：列表「在对话中定位」滚到对应 VersionCard 消息。
