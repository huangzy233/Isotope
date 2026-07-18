# 设计：Workspace 项目与会话持久化（第 2 步）

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：P0 第 2 步 only（不做 LLM / Agent / vite build / preview / Team 任务 / 版本卡片）

## 1. 目标

在第 1 步登录壳之上，实现最小可用的项目与对话持久化：

1. 实现 `@isotope/workspace`：创建项目（从模板复制源码）、按用户列出项目、读写元数据、消息追加/读取、文件端口（read/write/list）。
2. `@isotope/application` 增加用例：`CreateProject`、`ListProjects`、`GetProject`、`AppendMessage`、`ListMessages`。
3. 接 `apps/web`：首页真实创建与「我的项目」列表；工作台可发消息并回显（助手为固定占位文案）；App Viewer 仍可占位。
4. 刷新浏览器后项目列表与对话仍在；登出不可访问；换账号看不到他人项目。

## 2. 非目标

- 真实 LLM、Agent 编排、vite build、preview iframe 刷新
- Team 任务分配、版本卡片、工作台内切换 mode、改名 UI
- Race / Deep Research / 上传 / Publish / 开放注册
- Prompt 硬编码（本步无需 Prompt，不新增）
- 扫描 `data/projects/**` 目录来列项目

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 模板 | 补齐最小可构建的 `templates/vite-react`，创建时完整复制 |
| 项目名称 | 本地启发式（截断需求文案），**不调 LLM** |
| 创建时消息 | 自动写入 user（需求）+ 固定占位 assistant |
| 他人项目直链 | 当作不存在：API **404**；页面 `notFound()`，不暴露 403 |
| 存储 | **SQLite** 存项目索引与消息；**FS** 存 `workspace/` 源码；列表按 `owner_user_id` 查询 |

## 4. 架构与依赖

```text
apps/web
  → @isotope/application
      → @isotope/identity   # 会话（已有）
      → @isotope/workspace  # 本步核心
          → @isotope/kernel（按需最小表面）
```

禁止：

- UI 组件内直接写 SQLite / 复制模板 / 归属规则
- 任意包绕过 workspace 直接读写 `data/projects/**` 业务文件
- `workspace` → `agents` / `preview` / `web`

### 4.1 职责

| 层 | 职责 |
|----|------|
| `workspace` | 项目/消息持久化端口、模板复制、文件端口；SQLite + FS 适配 |
| `application` | 用例编排；注入当前用户；非 owner 视为不存在 |
| `web` | Cookie 鉴权取 username；HTTP API；首页/工作台接线 |

### 4.2 存储布局

```text
data/
  isotope.sqlite                 # projects + messages
  projects/<id>/
    workspace/                   # 从 templates/vite-react 复制
    build/                       # 空目录预留（本步不写产物）
```

`data/` 运行时数据不进 git：现有忽略 `data/projects/**`；实现时补上 `data/*.sqlite`（及 `-wal`/`-shm` 若出现）。

## 5. 数据模型

### 5.1 表 `projects`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | 如 `proj_` + 短唯一码 |
| `owner_user_id` | TEXT NOT NULL | 登录 username（会话 `sub`） |
| `name` | TEXT NOT NULL | 启发式展示名 |
| `mode` | TEXT NOT NULL | `engineer` \| `team` |
| `created_at` | TEXT NOT NULL | ISO-8601 |
| `updated_at` | TEXT NOT NULL | ISO-8601 |

索引：`idx_projects_owner_updated (owner_user_id, updated_at DESC)`。

### 5.2 表 `messages`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | |
| `project_id` | TEXT NOT NULL | FK → projects |
| `role` | TEXT NOT NULL | `user` \| `assistant` \| `system`（本步主要用前两者） |
| `content` | TEXT NOT NULL | |
| `created_at` | TEXT NOT NULL | ISO-8601 |
| `agent_name` | TEXT NULL | 本步 assistant 固定写 `Alex` |

索引：`idx_messages_project_created (project_id, created_at ASC)`。

### 5.3 领域类型（对外）

```ts
type ProjectMode = "engineer" | "team";

type Project = {
  id: string;
  name: string;
  mode: ProjectMode;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  projectId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  agentName?: string; // assistant 本步恒为 "Alex"
};
```

### 5.4 命名启发式（无 LLM）

1. 对需求 `trim`，压缩空白/换行。
2. 取前 **32** 个字符为名称；若被截断则末尾加 `…`。
3. 空需求不应到达此步（API 400）；兜底名：`未命名项目`。
4. 不调用外部 API；日后可替换实现而不改表结构。

### 5.5 创建时初始消息

1. `role=user`，`content=` 需求原文。
2. `role=assistant`，`agent_name=Alex`，固定文案：`已收到你的需求。预览与智能体编排将在下一步接入；当前仅持久化对话。`

## 6. Workspace 端口

构造注入：`dataRoot`（默认仓库 `data/`）、`templatePath`（`templates/vite-react`）。  
库文件：`{dataRoot}/isotope.sqlite`。首次使用 `CREATE TABLE IF NOT EXISTS`。

| 端口 | 行为 |
|------|------|
| `createProject({ ownerUserId, name, mode })` | 生成 id → 插 projects → 复制模板 → 建空 `build/` → 返回 Project |
| `listProjects(ownerUserId)` | `WHERE owner_user_id = ? ORDER BY updated_at DESC`（**不扫目录**） |
| `getProject(id)` | 按 id；不存在 → `null`（**不做归属判断**） |
| `updateProjectMeta(id, patch)` | 至少更新 `updated_at`；本步 UI 不暴露改名/切 mode |
| `appendMessage({ projectId, role, content, agentName? })` | 插 messages；更新项目 `updated_at` |
| `listMessages(projectId)` | 按 `created_at ASC` |
| `readFile(projectId, relativePath)` | 读 `workspace/` 内文件 |
| `writeFile(projectId, relativePath, content)` | 写；自动建父目录；拒绝 `..` 逃逸 |
| `listFiles(projectId, relativeDir?)` | 列相对路径 |

SQLite 驱动：锁定 **`better-sqlite3`**（同步 API）。文件端口 path 一律相对 `workspace/` 根。

## 7. Application 用例

均接收 `ownerUserId`（来自会话），不信任客户端伪造归属。

| 用例 | 规则 |
|------|------|
| `createProject({ ownerUserId, requirement, mode })` | 启发式 name → workspace.createProject → 追加 user + assistant → 返回 `{ project, messages }` |
| `listProjects({ ownerUserId })` | workspace.listProjects |
| `getProject({ ownerUserId, projectId })` | get 后校验 owner；不匹配或缺失 → `null` |
| `listMessages({ ownerUserId, projectId })` | 先归属校验；失败 → 等同不存在 |
| `appendMessage({ ownerUserId, projectId, content })` | 归属校验 → 追加 user → 追加固定 assistant → 返回新增的两条消息 |

本步 application **不**调用 LLM / agent-runtime / preview。

## 8. Web API 与页面

### 8.1 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/projects` | `{ requirement, mode }` → 201 + project |
| `GET` | `/api/projects` | 当前用户项目列表 |
| `GET` | `/api/projects/[id]` | 详情；非 owner / 不存在 → 404 |
| `GET` | `/api/projects/[id]/messages` | 消息列表；同上 404 |
| `POST` | `/api/projects/[id]/messages` | `{ content }` → user + 占位 assistant |

- 未登录 API → **401**
- 空 requirement / 非法 mode → **400**
- 磁盘/DB 失败 → **500**（短错误信息，无堆栈）

Cookie 读写与 session 解析留在 `apps/web`；用例在 application。

### 8.2 页面

- **首页**：选 Engineer/Team + 输入需求 → `POST /api/projects` → `/projects/[id]`；「我的项目」由服务端注入当前用户列表（RSC 调 application），避免首屏闪空。
- **工作台**：服务端加载项目 + 消息；展示 `project.name` 与只读 `mode`；客户端发送走 messages API 后刷新列表；App Viewer 占位「下一步接入 preview」。
- **门禁**：现有 middleware 保护页面；他人 id → `notFound()`。

### 8.3 UI 约束

遵循 `docs/ui/README.md`：复用 Composer / EmptyState / PanelHeader / StatusBadge / shadcn；不自写 CSS 皮肤；本步可用简单消息行，不强制新建完整 `MessageItem`。

## 9. 模板 `templates/vite-react`

补齐最小可构建 Vite + React + TypeScript 树（含 `package.json`、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/App.tsx` 等）。  
创建项目时经 workspace 完整复制到 `data/projects/<id>/workspace/`。本步不在复制后执行 `npm install` / build。

## 10. 错误与安全

| 情况 | 行为 |
|------|------|
| 未登录 | 页面 middleware；API 401 |
| 非 owner / 不存在 | 统一当不存在（404） |
| 路径逃逸 | workspace 文件端口拒绝 |
| 空内容发送 | 400 |

## 11. 测试与验收

### 11.1 自动化（最小）

- `workspace`：create → list（按 owner 过滤）→ append/list messages；他用户 list 为空；文件 write/read 与 `..` 拒绝（vitest + 临时 `dataRoot`）。
- `application`：非 owner `getProject` → null。
- `pnpm --filter @isotope/web typecheck` 必须通过。

### 11.2 手动验收

- [ ] 登录后创建项目并进入工作台
- [ ] 「我的项目」可进入已有项目
- [ ] 发消息后刷新，项目与对话仍在
- [ ] 登出不可访问项目页
- [ ] 换账号：列表无他人项目；直链他人 id → 404
- [ ] 未实现真实 LLM / Agent / build / preview / Team 任务 / 版本卡片

## 12. 实现顺序建议

1. 补齐 `templates/vite-react` + `data/` gitignore 确认  
2. `@isotope/workspace` domain/ports + SQLite/FS infra + 单测  
3. `@isotope/application` 五用例  
4. `apps/web` API + 首页/工作台接线  
5. typecheck + 手动验收  

## 13. 与第 1 步文档关系

- 延续 `2026-07-18-web-login-shell-design.md` 的 identity/session 与页面壳。
- 本步替换首页 mock `/projects/demo` 与空「我的项目」。
- UI 视觉仍以 `docs/ui/README.md`（Playbook）为准；历史决策见 `2026-07-18-ui-design-system.md`（归档）。
