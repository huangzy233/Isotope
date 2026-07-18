# 设计：Next.js 初始化 + 最小内置登录 + 页面壳

- 日期：2026-07-18
- 状态：已批准（对话确认）
- 范围：P0 第 1 步 only（不做 LLM / 真实构建 / Agent / 注册）

## 1. 目标

在现有 pnpm monorepo 骨架上：

1. 初始化 `apps/web`（Next.js App Router），接入 workspace。
2. 实现最小内置登录（无注册；演示账号来自 `configs/app`，支持多组；未登录不可进工作台）。
3. 搭好三页壳：登录页、首页、项目工作台双栏（聊天 / App Viewer 占位）。
4. 保持 `packages/*` 领域边界；业务规则不进 UI 组件。

## 2. 非目标

- LLM 对话、真实 Agent、真实 vite build / 预览刷新
- 开放注册、Race、Deep Research、上传、Publish
- 真实项目 CRUD / workspace 持久化（本步首页「我的项目」与发起入口均为 mock）

## 3. 架构与依赖

采用方案 1（已确认）：

```text
apps/web
  → @isotope/application   # login / logout / getSession
      → @isotope/identity  # verifyDemoUser + sign/verify session cookie
          → @isotope/kernel（按需；本步可极少用）
```

禁止：`web` 组件内直接写密码比对或会话签名逻辑；禁止本步触碰 `data/**`。

## 4. 鉴权（签名 Cookie，方案 A）

### 4.1 演示账号配置（多组）

路径：`configs/app/demo-users.yaml`（进 git，Demo 可明文）：

```yaml
users:
  - username: demo
    password: demo
  - username: reviewer
    password: reviewer
```

规则：
- **支持多组** `{username, password}`；登录时在列表中精确匹配（用户名大小写敏感，除非另定）
- **无注册**：只能命中配置中的账号；改账号 = 改 YAML，重启/热读即可（本步实现为进程内读文件，请求时或启动时加载一次均可；推荐启动/首次登录时加载并缓存，文件变更需重启——Demo 够用）
- 根 `README.md` 写明默认演示账号列表；登录页不展示密码
- 账号属行为配置（`configs/**`）；**不**再用 `DEMO_USER` / `DEMO_PASSWORD` 环境变量

### 4.2 环境变量（仅会话密钥）

| 变量 | 用途 |
|------|------|
| `SESSION_SECRET` | HMAC 签名密钥 |

- 本地：`apps/web/.env.local`（gitignore）
- 仓库提供 `apps/web/.env.example`

### 4.3 会话模型

- 校验成功后签发 **httpOnly** cookie（`SameSite=Lax`，`path=/`）
- Payload：`sub`（用户名）+ `exp`；签名：HMAC-SHA256（Node `crypto`）
- 登出：清除 cookie
- 无注册路由 / 表单 / API

### 4.4 门禁

- Next.js `middleware`：保护 `/`、`/projects/*`
- 未登录 → `/login`
- 已登录访问 `/login` → `/`
- API：`POST /api/auth/login`、`POST /api/auth/logout`；经 `application`，不进 React 组件

### 4.5 identity / application 表面（最小）

**`@isotope/identity`**

- `verifyUser(username, password, users) → ok | invalid`（`users` 为配置加载后的列表）
- `createSessionToken(payload, secret) → string`
- `verifySessionToken(token, secret) → payload | null`
- infra（或 web 薄适配）：从 `configs/app/demo-users.yaml` 加载用户列表（路径相对 monorepo 根，由调用方注入 `configPath` 或 `users`）

**`@isotope/application`**

- `login({ username, password, users, sessionSecret }) → { ok: true, token } | { ok: false, error }`
- `getSession(token, sessionSecret) → { username } | null`

约定：
- 密码校验与 token 签验在 `identity`；用例编排在 `application`。
- **cookie 读写只在 `apps/web`**；YAML 加载可在 `identity` infra 或 `web/lib`，最终把 `users` 传入 application/identity，**不要**在 UI 组件里读配置。
- 登出 = web 清 cookie。

## 5. 页面与 UI

### 5.1 路由

| 路由 | 鉴权 | 内容 |
|------|------|------|
| `/login` | 公开 | 用户名+密码；错误提示；无注册 |
| `/` | 需登录 | 顶栏（产品名 + 登出）；需求输入框；Engineer/Team 模式选择（仅 UI）；「我的项目」空列表占位 |
| `/projects/[id]` | 需登录 | 左聊天占位；右 App Viewer 占位 |

首页「发起」可链到固定 mock 路径 `/projects/demo`（不实现真实创建）。

### 5.2 UI 技术（已确认）

- **shadcn/ui + Tailwind CSS**
- 主题：中性灰 + 单一强调色（避免紫粉渐变默认脸）
- 仅引入本步需要的组件（如 Button、Input、Label、Card、Tabs 或等价切换）
- 组件放 `apps/web/components`（纯 UI）与 `components/ui`（shadcn）；无领域规则

## 6. 目录清单

```text
apps/web/
  app/
    layout.tsx
    globals.css
    login/page.tsx
    page.tsx
    projects/[id]/page.tsx
    api/auth/login/route.ts
    api/auth/logout/route.ts
  components/           # LoginForm、HomeShell、WorkbenchShell 等
  components/ui/        # shadcn
  lib/                  # 调 application、cookie 辅助
  middleware.ts
  .env.example              # 仅 SESSION_SECRET
  package.json
  next.config.ts|js
  tailwind / postcss / components.json
  tsconfig.json

configs/app/
  demo-users.yaml           # 多组演示账号

packages/identity/src/
  domain/ | app/ | infra/   # 按最小需要分层
  index.ts

packages/application/src/
  auth/…
  index.ts
```

根 `README.md`：补充 `SESSION_SECRET`、`configs/app/demo-users.yaml` 默认账号、`pnpm --filter @isotope/web dev`。

## 7. 验收标准

- [ ] `pnpm install && pnpm --filter @isotope/web dev` 可启动
- [ ] 错误密码无法登录；正确密码进入首页
- [ ] 登出后 `/` 与 `/projects/*` 不可用（重定向登录）
- [ ] 无 LLM / 真实构建 / Agent / 注册实现

## 8. 决策记录

| 决策 | 选择 |
|------|------|
| 会话 | 签名 Cookie（HMAC） |
| 演示账号 | `configs/app/demo-users.yaml`，支持多组；非 env |
| 会话密钥 | 仅 `SESSION_SECRET` 走 env |
| 分层 | web → application → identity |
| UI | shadcn/ui + Tailwind |
| 项目数据 | 本步 mock only |
