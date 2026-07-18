# 设计：Preview 构建闭环（App Viewer Idle → Building → Ready/Failed）

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：接入 `@isotope/preview` + `@isotope/sandbox` + application 用例 + 工作台 App Viewer 真实状态；不做 Agent / LLM

## 1. 目标

让 App Viewer 从占位 Idle 进入真实构建闭环：

1. 实现 `@isotope/sandbox`：在项目 `workspace/` 执行 `npm install`（按需）+ `npm run build`，产出可发布静态文件。
2. 实现 `@isotope/preview`：维护构建状态、全局串行锁、读写 `preview-status.json`、将产物发布到 `build/`。
3. `@isotope/application` 增加用例：查询状态、ensure/强制构建、读取预览静态资源（含归属校验）。
4. `apps/web`：工作台轮询状态；Idle/Building/Ready/Failed UI；Ready 时 iframe 加载代理后的静态页；手动刷新/失败重试。
5. 打开项目时若尚无成功产物则自动 enqueue；已有 Ready 则直接展示、不重建。

## 2. 非目标

- LLM、Agent 编排、Agent 写文件后自动 enqueue
- SSE / WebSocket 推送
- 完整多 job 队列、取消、按用户/项目并行限流、分布式锁
- `ViewerChrome` / `MessageItem` / `ToolCallRow` 独立组合件拆分
- 版本卡片、视口切换、聊天区插入「可预览」系统消息
- 多实例部署语义

## 3. 已确认的产品决策

| 决策 | 选择 |
|------|------|
| 触发 | 打开工作台：非 `ready` 则 ensure；手动刷新 / Failed 重试强制重建 |
| 状态推送 | 客户端轮询（约 1.5s），终态停止 |
| 产物加载 | Next.js 代理从 `build/` 读文件；iframe 指向该入口 |
| 构建执行 | 真实 `npm` + Vite；本机全局串行（不同项目也排队） |
| 状态持久化 | `data/projects/<id>/preview-status.json`（不改 SQLite） |
| 架构 | 薄 application 编排 → preview → sandbox；workspace 只暴露路径 |

## 4. 架构与依赖

```text
apps/web
  → @isotope/application
      → @isotope/workspace   # 归属 + getProjectPaths
      → @isotope/preview
          → @isotope/sandbox
          → @isotope/workspace（路径解析）
```

禁止：

- UI / API route 直接 `child_process` 或读写 `data/projects/**`
- `workspace` → `preview` / `sandbox` / `web`
- 将构建产物拷到 `apps/web/public` 绕过权限

### 4.1 职责

| 层 | 职责 |
|----|------|
| `workspace` | 现有持久化；新增只读 `getProjectPaths(projectId) → { workspaceDir, buildDir }` |
| `sandbox` | 在给定 `workspaceDir` 跑 install/build；返回成功或带摘要错误 |
| `preview` | 状态机、串行锁、status JSON、发布产物到 `buildDir` |
| `application` | 归属校验后调用 preview；对外稳定用例 |
| `web` | HTTP API、轮询、Viewer UI、iframe |

### 4.2 存储布局

```text
data/projects/<id>/
  workspace/              # 源码（已有）
  build/                  # 静态产物（本步写入）
  preview-status.json     # 本步新增
```

### 4.3 端到端流程

1. 打开工作台 → `GET preview?ensure=1`
2. 非 ready → preview 置 `building`，等全局锁 → sandbox 构建 → 发布 `build/` → `ready` 或 `failed`
3. 前端轮询至终态；ready → iframe 加载 files 入口（带 `revision` cache-bust）
4. 再次打开已 ready 的项目 → 直接展示，不重建
5. 刷新/重试 → `POST preview/build` → 同构建流程

多用户：项目按 owner 隔离；构建全局串行，后到者等待，不互相覆盖 `build/`。

## 5. 状态模型

`preview-status.json`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `idle` \| `building` \| `ready` \| `failed` | UI 映射同名 Badge |
| `revision` | string | 成功构建标识，供 iframe cache-bust |
| `error` | string \| null | 失败摘要（截断）；其它为 null |
| `updatedAt` | string | ISO-8601 |

规则：

- 文件不存在 → 视为 `idle`
- 已 `building` 时 ensure / 重复 POST → 返回当前状态，不启第二进程
- 进程崩溃停在 `building`：下次 ensure 视为可重新入队（启动时或带超时阈值）
- 超时（建议 5 分钟）→ `failed`，错误「构建超时」

## 6. application 用例与 HTTP

| 用例 | HTTP | 行为 |
|------|------|------|
| `getPreviewStatus` | `GET /api/projects/:id/preview` | 返回状态；`?ensure=1` 时非 ready 则入队 |
| `enqueuePreviewBuild` | `POST /api/projects/:id/preview/build` | 强制重新构建 |
| `readPreviewAsset` | `GET /api/projects/:id/preview/files/[[...path]]` | 仅 ready 时读 `build/`；默认 `index.html` |

归属：非 owner 与现有项目 API 一致（404 / `notFound()`），不暴露 403 细节（若现有消息 API 用 404，本步对齐）。

iframe `src` 示例：`/api/projects/:id/preview/files/?r=<revision>`

## 7. Sandbox 细节

输入：`{ workspaceDir, buildDir }`（可选 abort/timeout）。

步骤：

1. 若无 `node_modules` → `npm install`（`cwd = workspaceDir`）
2. `npm run build`
3. 将 Vite 产物发布到 `buildDir`（清空后拷贝 `dist/`，或配置 `outDir` 直出；实现选更稳方案）

其它：

- 捕获 stdout/stderr；失败摘要截断约 2KB
- 模板 `vite.config` 设 `base: './'`，保证挂在 API 子路径下资源可加载
- 路径防穿越：只允许读 `buildDir` 内相对路径

## 8. UI（Workbench 右栏）

遵循 `docs/ui/ai-surfaces.md` App Viewer 状态机；组件：现有 `PanelHeader` + `StatusBadge` + `EmptyState` + Button；**不**新建 `ViewerChrome`。

| 状态 | 展示 |
|------|------|
| Idle | EmptyState「尚未构建预览」 |
| Building | Badge + Skeleton/文案「构建中」 |
| Ready | 全高 iframe；顶栏刷新 |
| Failed | 错误文案 +「重试」 |

轮询约 1.5s；`ready` / `failed` / 卸载时停止。

## 9. 错误处理

| 情况 | 行为 |
|------|------|
| npm/vite 非 0 | `failed` + 日志摘要；不假装 ready |
| 超时 | `failed`「构建超时」 |
| 未 ready 请求 files | 404 或 409 |
| 非所有者 | 与现有项目 API 一致（当作不存在） |
| Building 中再 POST | 返回 building，不并行 |

## 10. 测试与验收

### 测试（最小）

- preview/sandbox：成功构建与失败摘要（可用临时目录；install 可测或 mock 边界按实现定）
- application：归属；ensure 对已 ready 幂等（不重建）
- 路径穿越拒绝

### 验收

1. 新项目打开 → Building → Ready，iframe 可见模板且可交互
2. 刷新浏览器仍 Ready（不重建）
3. 手动刷新触发重建并更新
4. 破坏 `package.json` 再构建 → Failed；重试修复后可恢复

## 11. 实现顺序（建议）

1. workspace `getProjectPaths` + 模板 `base: './'`
2. sandbox 最小实现 + 单测
3. preview 状态机 / 锁 / 发布 + 单测
4. application 三用例 + 依赖声明
5. web API + Workbench Viewer 接线
6. 手动走通验收清单
