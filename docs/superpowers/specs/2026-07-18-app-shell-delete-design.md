# 设计：全局 AppShell + 项目删除

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：可收起全局侧栏（项目列表 + 左下用户）+ 硬删除项目；不接 LLM / preview

## 1. 目标

1. 登录后壳层改为 ChatGPT/Cursor 风格：**左侧**可收起侧栏（项目列表 + **左下角**用户/退出），**右侧**为主内容。
2. 首页右侧：创建入口（模式 + 需求 Composer）；工作台右侧：保持现有对话 | App Viewer。
3. 支持删除项目：确认 Dialog → 硬删除（SQLite + `data/projects/<id>/`）；归属隔离。

## 2. 非目标

- 软删除 / 回收站 / 批量删除
- 工作台内再改双栏结构（对话|预览保持）
- LLM、Agent、preview、版本卡片
- 开放注册

## 3. 已确认决策

| 决策 | 选择 |
|------|------|
| 布局 | 左栏项目 + 左下用户；右为主区（方案 A） |
| 范围 | 登录后**全局**壳（首页 + 工作台） |
| 侧栏 | 可收起；状态 `localStorage`（`isotope.sidebarCollapsed`） |
| 删除 | 悬停删按钮 → Dialog 确认 → 硬删除 |
| 实现结构 | 方案 1：`(app)/layout` 全局 `AppShell`，去掉顶栏 `AppHeader` |

## 4. 信息架构

```text
(app)/layout
├── AppSidebar（可收起）
│   ├── 顶：Isotope + 收起/展开
│   ├── 中：项目列表（当前路由高亮；悬停显示删除）
│   └── 底：username + 退出
└── main
    ├── / ：创建 Composer
    └── /projects/[id] ：Workbench（对话 | App Viewer）
```

- 品牌与退出从顶栏下沉到侧栏；不再渲染全局 `AppHeader`。
- 项目列表由 layout/壳经 `listProjects` 注入；创建/删除后 `router.refresh()`。
- 依赖：`web` → `application` → `workspace`；UI 不写归属/删库规则。
- UI：遵守 `docs/UI_GUIDE.md`（Neutral Tool、shadcn；缺则补 Dialog）。

## 5. 删除

### 5.1 Workspace

`deleteProject(id: string): void`

1. 删除该 `project_id` 的全部 `messages`
2. 删除 `projects` 行
3. `fs.rmSync(dataRoot/projects/<id>, { recursive: true, force: true })`

id 不存在：安全 no-op（或仅跳过 FS）。

### 5.2 Application

`deleteProject({ ownerUserId, projectId }, workspace) → { ok: true } | null`

- 先按 owner 校验（同 `getProject`）；失败 → `null`
- 成功 → 调 `workspace.deleteProject`

### 5.3 API

`DELETE /api/projects/[id]`

| 情况 | 响应 |
|------|------|
| 未登录 | 401 |
| 非 owner / 不存在 | 404 |
| 成功 | 204 或 `{ ok: true }` |
| 磁盘/DB 失败 | 500，短文案 |

### 5.4 UI

- Dialog 文案：「确定删除「{name}」？此操作不可恢复。」
- 成功：`router.refresh()`；若当前路径为该项目工作台 → `router.push('/')`

## 6. 侧栏交互

- 点击项目 → `/projects/[id]`
- 当前 `pathname` 匹配则高亮
- 收起：窄条（展开控件）；列表与用户区隐藏或仅保留必要图标
- 空列表：侧栏内「暂无项目」类短文案
- 首页主区不再重复大块「我的项目」列表（列表只在侧栏）

## 7. 验收

- [ ] 全局左栏：项目 + 左下用户/退出；可收起且刷新保持
- [ ] 首页右侧创建；工作台右侧对话|预览
- [ ] 删除经确认后列表与磁盘/DB 清除；他人 404
- [ ] 工作台删当前项目 → 回首页
- [ ] `pnpm --filter @isotope/web typecheck` 通过
- [ ] 无 LLM / preview / 软删除

## 8. 实现顺序建议

1. `workspace.deleteProject` + `application.deleteProject` + 单测  
2. `DELETE /api/projects/[id]`  
3. `AppSidebar` + `(app)/layout` AppShell；首页去掉重复列表  
4. 删除 Dialog + 收起状态  
5. typecheck + 手动验收  

## 9. 与既有文档关系

- 延续 `2026-07-18-workspace-persistence-design.md` 的持久化与归属模型。
- 本步仅扩展删除端口与呈现壳层。
