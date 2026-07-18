# 设计：工作区只读编辑器 + 文件树

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：工作台右栏「应用查看器 | 编辑器」切换；编辑器内嵌只读文件树 + 只读源码查看；application 用例 + BFF API；不做在线改码

## 1. 目标

1. 工作台右栏可在 **应用查看器** 与 **编辑器** 间切换；默认仍是应用查看器。
2. **编辑器** = 左侧可折叠只读文件树 + 右侧只读文件内容（单文件、纯文本）。
3. 展示项目 `workspace/` 内源码文件，排除 `node_modules` 等噪音。
4. 视图模式与上次打开路径刷新后可恢复（浏览器 localStorage，按 projectId）。
5. 未选文件 / 空工作区 / 读失败有明确空态，不得静默空白报错。

## 2. 非目标

- 在线编辑保存、新建 / 删除 / 重命名文件
- 完整 IDE（多文件 Tab、diff、搜索替换、语法高亮、Markdown 渲染）
- 独立「文件」顶栏 Tab（文件能力并入编辑器左侧树）
- 预览区「设计 / 控制台」子页、响应式视口切换
- 版本 git 回滚、MessageItem 大拆、独立 `ViewerChrome` 大重构
- Agent 改文件后自动刷新已打开内容（本轮不做 live sync）

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 顶栏视图 | 仅 `应用查看器` \| `编辑器`（无独立「文件」Tab） |
| 编辑器布局 | 左树 + 右内容（参考 IDE 只读浏览；无搜索、无多 Tab、无付费升级条） |
| 文件树形态 | 可折叠目录树（客户端由扁平路径列表构建） |
| 点文件行为 | 在树中点击 → 右侧打开该文件（已在编辑器内，无需再切 Tab） |
| 默认打开 | 记住上次路径；无记忆或不存在 → 空态 |
| 偏好持久化 | localStorage，按 `projectId` 隔离 |
| 读模式 | 只读纯文本；语法高亮非本轮范围 |
| 噪音过滤 | application 层过滤；不改 `workspace.listFiles` 原语语义 |
| PRD §7.10 AC4 | 「文件」能力由编辑器树覆盖；顶栏不单独提供「文件」入口 |

## 4. 架构与依赖

```text
apps/web (Tabs + EditorPane)
  → API routes（会话 + 调 application）
    → @isotope/application
        listWorkspaceSourceFiles / readWorkspaceSourceFile
      → @isotope/workspace.listFiles / readFile
```

禁止：

- UI / API route 直接扫描或读写 `data/projects/**`
- `workspace` → `web` / `preview` 循环依赖
- 为 Agent 工具链改变 `listFiles` 的「全量」语义（过滤只在面向 UI 的 application 用例）

### 4.1 职责

| 层 | 职责 |
|----|------|
| `workspace` | 现有 `listFiles` / `readFile`（路径防穿越）；本轮不改语义 |
| `application` | 归属校验、噪音过滤、文本/大小门禁、稳定用例 API |
| `web` API | 会话校验；映射 401 / 404 / 400 |
| `web` UI | 视图切换、树、只读内容区、空态、localStorage |

## 5. Application 用例

### 5.1 `listWorkspaceSourceFiles`

输入：`{ ownerUserId, projectId }`  
行为：

1. `getProject` 失败 → `null`
2. `workspace.listFiles(projectId)` 得扁平相对路径
3. 过滤噪音后排序返回 `string[]`（posix `/`）

### 5.2 `readWorkspaceSourceFile`

输入：`{ ownerUserId, projectId, relativePath }`  

返回（钉死）：

- 项目不存在或非 owner → `null`（route → 404）
- 否则 →  
  `{ ok: true; path: string; content: string }`  
  或 `{ ok: false; code: "invalid_path" | "not_found" | "not_text" | "too_large"; message: string }`

`code` → HTTP：`invalid_path` / `not_text` / `too_large` → 400；`not_found` → 404。`message` 为简体中文，可供空态直接展示。

行为要点：噪音路径与穿越 → `invalid_path`；缺文件 → `not_found`；含 `\0` → `not_text`；超过 512KB → `too_large`。

### 5.3 噪音规则（首版固定）

相对路径任一路段等于以下之一则丢弃 / 禁止读：

`node_modules`、`.git`、`dist`、`build`、`.next`、`coverage`

不过度隐藏所有点文件（避免丢掉 `.env.example` 等）。规则以 application 常量维护，可后续扩展。

## 6. HTTP API

| 方法 | 路径 | 成功 | 错误 |
|------|------|------|------|
| GET | `/api/projects/[id]/files` | `{ files: string[] }` | 401 / 404 |
| GET | `/api/projects/[id]/files/[...path]` | `{ path, content }` | 401 / 404 / 400 |

## 7. UI

### 7.1 右栏顶栏

- 使用现有 shadcn `Tabs` + 现有 `PanelHeader` 区域改造；**不**新建 `ViewerChrome`
- Tabs：`应用查看器` | `编辑器`
- 仅在应用查看器激活时展示 `StatusBadge` +「刷新」（行为与现网一致）

### 7.2 应用查看器

保持现有 Idle / Building / Ready / Failed；切换到编辑器时不强制拆掉轮询（可继续后台更新状态）。

### 7.3 编辑器

```text
┌──────────────┬──────────────────────────────────┐
│ 文件树       │  路径条（只读）                    │
│ ▸ src        │──────────────────────────────────│
│   App.tsx ●  │  <pre> 纯文本只读                  │
└──────────────┴──────────────────────────────────┘
```

- 左树宽约 220–280px，可滚动；自建轻量树（chevron + 缩进），不引入第三方树/编辑器库
- 展开策略：默认展开根下一层；若有上次打开路径，展开其祖先目录
- 当前打开文件在树中高亮
- 用户可见文案：简体中文；Neutral Tool；禁止 Demo/Landing/紫粉渐变/自写皮肤

### 7.4 localStorage

| Key | 值 |
|-----|-----|
| `isotope.workbench.viewerMode:{projectId}` | `preview` \| `editor` |
| `isotope.workbench.openFile:{projectId}` | 相对路径或清除 |

### 7.5 空态

| 情况 | 表现 |
|------|------|
| 未选文件且无有效记忆 | EmptyState：选择左侧文件以查看 |
| 记忆路径已不在列表 | EmptyState：文件不存在或已删除；清除该记忆 |
| 过滤后无文件 | EmptyState：工作区暂无源码文件 |
| 读失败 / 非文本 / 过大 | EmptyState：对应中文错误说明 |

## 8. 测试与验收

### 8.1 单测（application）

- 非 owner → list/read 返回 `null`
- 噪音路径不出现在 list；read 噪音路径失败
- 正常模板文件可 list / read
- 路径穿越失败

### 8.2 质量门

- 相关 typecheck 通过
- 上述单测通过

### 8.3 验收映射

| AC | 满足方式 |
|----|----------|
| AC1 | 顶栏可切换应用查看器 / 编辑器 |
| AC2 | 编辑器左侧树可见过滤后的 workspace 文件 |
| AC3 | 点击文件后右侧只读展示内容；刷新可恢复模式与路径 |
| AC4 | 空态明确；typecheck / 单测通过 |

## 9. 文档影响（实现时）

- 可选：`docs/ui/page-blueprints.md` / `ai-surfaces.md` 补一句「编辑器 = 树 + 只读内容；无独立文件 Tab」
- `docs/PRD.md`：若需对齐 §7.10 措辞，实现计划中单列（本设计已记录产品决策）

## 10. 成功标准

- [ ] 右栏可切换应用查看器 / 编辑器，默认查看器
- [ ] 编辑器左树 + 右只读内容可用
- [ ] 噪音目录不出现在树中
- [ ] localStorage 恢复视图与打开路径
- [ ] 空态齐全；application 单测与 typecheck 通过
- [ ] 未引入在线编辑或第三方 IDE 依赖
