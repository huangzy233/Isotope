# Web Login Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化 Next.js（`apps/web`）+ 多组配置账号登录 + 登录/首页/工作台三页壳，满足第 1 步验收。

**Architecture:** `web` → `application`（login/getSession）→ `identity`（用户校验 + HMAC 会话 token）。演示账号来自 `configs/app/demo-users.yaml`；仅 `SESSION_SECRET` 走 env。Cookie 读写留在 `apps/web`。UI：shadcn/ui + Tailwind。

**Tech Stack:** Next.js 15 App Router、React 19、Tailwind 4 或 3（以 shadcn init 默认为准）、shadcn/ui、`yaml`（解析配置）、Node `crypto`、vitest（identity 单测）、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-18-web-login-shell-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文；不做注册 / LLM / 真实构建 / Agent。
- 依赖方向：`web` → `application` → `identity` → `kernel`；禁止 UI 内写密码比对或签验。
- Agent/代码禁止直接读写 `data/**`（本步不碰）。
- Prompt 禁止硬编码（本步无 Prompt）。
- **未经用户要求不要 git commit**（忽略下文若出现的 commit 步骤，一律跳过）。
- 外科手术式改动：不重构无关骨架包。

## File Structure

| 路径 | 职责 |
|------|------|
| `configs/app/demo-users.yaml` | 多组演示账号 |
| `packages/identity/src/domain/types.ts` | `DemoUser`、`SessionPayload` |
| `packages/identity/src/app/verify-user.ts` | 用户名密码匹配 |
| `packages/identity/src/app/session.ts` | create/verify session token |
| `packages/identity/src/infra/load-demo-users.ts` | 读 YAML |
| `packages/identity/src/index.ts` | 窄导出 |
| `packages/identity/src/**/*.test.ts` | vitest |
| `packages/application/src/auth/login.ts` | login 用例 |
| `packages/application/src/auth/get-session.ts` | getSession 用例 |
| `packages/application/src/index.ts` | 导出 |
| `apps/web/*` | Next 应用、API、middleware、页面壳、shadcn |
| `apps/web/lib/auth.ts` | cookie 名、读写、加载 users、调 application |
| `README.md` | 启动与演示账号说明 |

---

### Task 1: demo-users 配置 + identity 核心

**Files:**
- Create: `configs/app/demo-users.yaml`
- Create: `packages/identity/src/domain/types.ts`
- Create: `packages/identity/src/app/verify-user.ts`
- Create: `packages/identity/src/app/session.ts`
- Create: `packages/identity/src/infra/load-demo-users.ts`
- Create: `packages/identity/src/app/verify-user.test.ts`
- Create: `packages/identity/src/app/session.test.ts`
- Modify: `packages/identity/src/index.ts`
- Modify: `packages/identity/package.json`（加 `yaml`、`vitest`、`test` script）

**Interfaces:**
- Produces:
  - `type DemoUser = { username: string; password: string }`
  - `type SessionPayload = { sub: string; exp: number }`
  - `verifyUser(username: string, password: string, users: DemoUser[]): boolean`
  - `createSessionToken(payload: SessionPayload, secret: string): string`
  - `verifySessionToken(token: string, secret: string): SessionPayload | null`
  - `loadDemoUsers(configPath: string): DemoUser[]`

- [ ] **Step 1: 写入演示账号配置**

```yaml
# configs/app/demo-users.yaml
users:
  - username: demo
    password: demo
  - username: reviewer
    password: reviewer
```

- [ ] **Step 2: 写失败测试（verify + session）**

```ts
// packages/identity/src/app/verify-user.test.ts
import { describe, expect, it } from "vitest";
import { verifyUser } from "./verify-user.js";

const users = [
  { username: "demo", password: "demo" },
  { username: "reviewer", password: "reviewer" },
];

describe("verifyUser", () => {
  it("accepts a configured pair", () => {
    expect(verifyUser("demo", "demo", users)).toBe(true);
    expect(verifyUser("reviewer", "reviewer", users)).toBe(true);
  });
  it("rejects wrong password or unknown user", () => {
    expect(verifyUser("demo", "wrong", users)).toBe(false);
    expect(verifyUser("nope", "demo", users)).toBe(false);
  });
});
```

```ts
// packages/identity/src/app/session.test.ts
import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session.js";

const secret = "test-secret";

describe("session token", () => {
  it("round-trips a valid payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createSessionToken({ sub: "demo", exp }, secret);
    expect(verifySessionToken(token, secret)).toEqual({ sub: "demo", exp });
  });
  it("returns null for tampered or expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const expired = createSessionToken({ sub: "demo", exp }, secret);
    expect(verifySessionToken(expired, secret)).toBeNull();
    const valid = createSessionToken(
      { sub: "demo", exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    expect(verifySessionToken(valid + "x", secret)).toBeNull();
    expect(verifySessionToken(valid, "other")).toBeNull();
  });
});
```

- [ ] **Step 3: 配置 vitest 并确认测试失败**

在 `packages/identity/package.json` 增加依赖与脚本：

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "yaml": "^2.6.0"
  }
}
```

在 monorepo 根：`pnpm install`，然后：

Run: `pnpm --filter @isotope/identity test`  
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 identity**

```ts
// packages/identity/src/domain/types.ts
export type DemoUser = { username: string; password: string };
export type SessionPayload = { sub: string; exp: number };
```

```ts
// packages/identity/src/app/verify-user.ts
import type { DemoUser } from "../domain/types.js";

export function verifyUser(
  username: string,
  password: string,
  users: DemoUser[],
): boolean {
  return users.some((u) => u.username === username && u.password === password);
}
```

```ts
// packages/identity/src/app/session.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "../domain/types.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(
  payload: SessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
```

```ts
// packages/identity/src/infra/load-demo-users.ts
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { DemoUser } from "../domain/types.js";

type FileShape = { users?: DemoUser[] };

export function loadDemoUsers(configPath: string): DemoUser[] {
  const raw = readFileSync(configPath, "utf8");
  const data = parse(raw) as FileShape;
  if (!data?.users || !Array.isArray(data.users)) {
    throw new Error(`Invalid demo users config: ${configPath}`);
  }
  for (const u of data.users) {
    if (!u?.username || !u?.password) {
      throw new Error(`Invalid demo user entry in ${configPath}`);
    }
  }
  return data.users;
}
```

```ts
// packages/identity/src/index.ts
export type { DemoUser, SessionPayload } from "./domain/types.js";
export { verifyUser } from "./app/verify-user.js";
export { createSessionToken, verifySessionToken } from "./app/session.js";
export { loadDemoUsers } from "./infra/load-demo-users.js";
```

- [ ] **Step 5: 跑测试通过**

Run: `pnpm --filter @isotope/identity test`  
Expected: PASS

---

### Task 2: application 登录用例

**Files:**
- Create: `packages/application/src/auth/login.ts`
- Create: `packages/application/src/auth/get-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/package.json`（依赖 `@isotope/identity`）

**Interfaces:**
- Consumes: `verifyUser`, `createSessionToken`, `verifySessionToken`, `DemoUser`
- Produces:
  - `login(input: { username: string; password: string; users: DemoUser[]; sessionSecret: string; ttlSeconds?: number }): { ok: true; token: string } | { ok: false; error: string }`
  - `getSession(token: string, sessionSecret: string): { username: string } | null`

- [ ] **Step 1: 实现 login / getSession**

```ts
// packages/application/src/auth/login.ts
import {
  createSessionToken,
  verifyUser,
  type DemoUser,
} from "@isotope/identity";

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export function login(input: {
  username: string;
  password: string;
  users: DemoUser[];
  sessionSecret: string;
  ttlSeconds?: number;
}): LoginResult {
  const { username, password, users, sessionSecret, ttlSeconds = 60 * 60 * 24 * 7 } =
    input;
  if (!username || !password) {
    return { ok: false, error: "请输入用户名和密码" };
  }
  if (!verifyUser(username, password, users)) {
    return { ok: false, error: "用户名或密码错误" };
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = createSessionToken({ sub: username, exp }, sessionSecret);
  return { ok: true, token };
}
```

```ts
// packages/application/src/auth/get-session.ts
import { verifySessionToken } from "@isotope/identity";

export function getSession(
  token: string,
  sessionSecret: string,
): { username: string } | null {
  const payload = verifySessionToken(token, sessionSecret);
  if (!payload) return null;
  return { username: payload.sub };
}
```

```ts
// packages/application/src/index.ts
export { login, type LoginResult } from "./auth/login.js";
export { getSession } from "./auth/get-session.js";
```

`packages/application/package.json` 增加：

```json
"dependencies": {
  "@isotope/identity": "workspace:*"
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm install && pnpm --filter @isotope/application typecheck`  
Expected: PASS（若 identity 无 types 路径问题则修好 exports）

---

### Task 3: 初始化 Next.js + Tailwind + shadcn + workspace 依赖

**Files:**
- Replace/Create under `apps/web/`：Next App Router 脚手架、`package.json`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`components.json`、`app/globals.css`、`app/layout.tsx`、`lib/utils.ts`、`components/ui/*`（button、input、label、card、tabs）
- Modify: 根或 web 的依赖解析（transpilePackages）

**Interfaces:**
- Produces: `pnpm --filter @isotope/web dev` 能起空应用（临时 page 可随后替换）

- [ ] **Step 1: 手写/脚手架 Next 应用（不要覆盖 monorepo 根）**

`apps/web/package.json`：

```json
{
  "name": "@isotope/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@isotope/application": "workspace:*",
    "@isotope/identity": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.469.0",
    "tailwind-merge": "^2.6.0",
    "yaml": "^2.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.2",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20"
  }
}
```

`next.config.ts`：

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@isotope/application", "@isotope/identity", "@isotope/kernel"],
};

export default nextConfig;
```

配置 Tailwind（中性灰 + 石板蓝强调色，避免紫粉渐变）、`app/layout.tsx` 基础字体与 `lang="zh-CN"`。

用 shadcn CLI（在 `apps/web` 下）初始化并添加：`button` `input` `label` `card` `tabs`。若 CLI 不便，可手工放入等价 shadcn 组件源码。

- [ ] **Step 2: 安装并验证启动**

Run:

```bash
pnpm install
pnpm --filter @isotope/web dev
```

Expected: 能打开 `http://localhost:3000`（可先有占位页）

---

### Task 4: auth 适配层 + API + middleware

**Files:**
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/lib/paths.ts`（解析 monorepo 根与 demo-users 路径）
- Create: `apps/web/app/api/auth/login/route.ts`
- Create: `apps/web/app/api/auth/logout/route.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/.env.example`
- Create: `apps/web/.env.local`（本地，gitignore）

**Interfaces:**
- Consumes: `login`, `getSession`, `loadDemoUsers`
- Cookie 名：`isotope_session`
- `getSessionSecret(): string` — 读 `process.env.SESSION_SECRET`，缺失则抛错（dev 可用 `.env.local` 默认值）

- [ ] **Step 1: paths + auth helpers**

```ts
// apps/web/lib/paths.ts
import path from "node:path";

export function monorepoRoot(): string {
  // next dev cwd = apps/web
  return path.resolve(process.cwd(), "../..");
}

export function demoUsersConfigPath(): string {
  return path.join(monorepoRoot(), "configs/app/demo-users.yaml");
}
```

```ts
// apps/web/lib/auth.ts
import { cookies } from "next/headers";
import { getSession, login as appLogin } from "@isotope/application";
import { loadDemoUsers } from "@isotope/identity";
import { demoUsersConfigPath } from "./paths";

export const SESSION_COOKIE = "isotope_session";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

let cachedUsers: ReturnType<typeof loadDemoUsers> | null = null;

export function getDemoUsers() {
  if (!cachedUsers) cachedUsers = loadDemoUsers(demoUsersConfigPath());
  return cachedUsers;
}

export async function readSession(): Promise<{ username: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSession(token, getSessionSecret());
}

export function loginWithPassword(username: string, password: string) {
  return appLogin({
    username,
    password,
    users: getDemoUsers(),
    sessionSecret: getSessionSecret(),
  });
}
```

- [ ] **Step 2: API routes**

`POST /api/auth/login`：JSON `{ username, password }` → 成功 `Set-Cookie` + `{ ok: true }`；失败 401 + `{ ok: false, error }`。

`POST /api/auth/logout`：删除 cookie → `{ ok: true }`。

Cookie 属性：`httpOnly: true`、`sameSite: "lax"`、`path: "/"`、`secure: process.env.NODE_ENV === "production"`。

- [ ] **Step 3: middleware**

用 `verifySessionToken`（从 `@isotope/identity`）在 Edge/Node middleware 校验 cookie。注意：若 middleware 默认 Edge 且 `node:crypto` 不可用，则二选一：

1. `middleware` 仅检查 cookie **存在**，真实校验放在 Server Component / layout（简单但不严谨）；或
2. 实现 **Web Crypto** 版 HMAC 校验给 middleware 用；或
3. `export const runtime` / 配置 middleware matcher，把鉴权放在 `app/(app)/layout.tsx` server 侧 redirect。

**本计划选定：方案 3（推荐，最省事）** — 不用 Edge middleware 做 HMAC；用 route group：

- `app/(public)/login/page.tsx`
- `app/(app)/layout.tsx`：`readSession()`，无会话则 `redirect("/login")`
- `app/(app)/page.tsx`、`app/(app)/projects/[id]/page.tsx`
- 可选轻量 `middleware.ts`：无 cookie 时提前 redirect（可再在 layout 验签）

已登录访问 `/login`：login page server 组件若有 session 则 `redirect("/")`。

- [ ] **Step 4: env 文件**

`.env.example` / `.env.local`：

```
SESSION_SECRET=dev-session-secret-change-me
```

---

### Task 5: 登录页 UI

**Files:**
- Create: `apps/web/components/login-form.tsx`
- Create: `apps/web/app/(public)/login/page.tsx`
- Create: `apps/web/app/(public)/layout.tsx`（可选居中壳）

- [ ] **Step 1: LoginForm 客户端组件**

- 用户名、密码 Input；提交调 `POST /api/auth/login`
- 失败展示 `error` 文案；成功 `router.push("/")` + `router.refresh()`
- **无注册入口**

- [ ] **Step 2: 页面**

居中 Card：「Isotope」标题 + LoginForm。已登录则 redirect `/`。

---

### Task 6: 首页 + 工作台壳

**Files:**
- Create: `apps/web/components/app-header.tsx`（产品名 + 登出）
- Create: `apps/web/components/home-shell.tsx`
- Create: `apps/web/components/workbench-shell.tsx`
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/app/(app)/page.tsx`
- Create: `apps/web/app/(app)/projects/[id]/page.tsx`

- [ ] **Step 1: Header**

显示「Isotope」与当前用户；登出按钮 → `POST /api/auth/logout` → `/login`。

- [ ] **Step 2: 首页**

- 需求 Textarea/Input（占位）
- Engineer / Team：`Tabs` 切换（仅 UI state）
- 「开始」链接或按钮 → `/projects/demo`（mock）
- 「我的项目」空状态文案

- [ ] **Step 3: 工作台**

双栏：左「聊天占位」+ 禁用输入；右「App Viewer 占位」。桌面 `grid` 两列；窄屏可上下堆叠。

---

### Task 7: README + 端到端验收

**Files:**
- Modify: `README.md`
- Modify: `configs/app/README.md`（一句指向 demo-users.yaml）

- [ ] **Step 1: 更新 README**

说明：

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @isotope/web dev
```

演示账号见 `configs/app/demo-users.yaml`（默认 `demo`/`demo`、`reviewer`/`reviewer`）。

- [ ] **Step 2: 手工验收**

1. 错密：停留登录页且有错误提示  
2. `demo`/`demo`：进入首页  
3. 打开 `/projects/demo`：双栏壳可见  
4. 登出后再访 `/` 与 `/projects/demo`：回到登录  
5. 确认无 LLM/构建/Agent 代码路径被启用  

Run: `pnpm --filter @isotope/identity test` 与 `pnpm --filter @isotope/web typecheck`  
Expected: PASS

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| Next.js + workspace | T3 |
| 多组账号 YAML | T1 |
| 签名 Cookie + SESSION_SECRET | T1, T4 |
| 无注册 / 门禁 | T4–T5 |
| 三页壳 + mock 项目 | T5–T6 |
| application/identity 边界 | T1–T2 |
| README | T7 |
| 验收 | T7 |

无 TBD；cookie 鉴权采用 **(app) layout 验签**（非 Edge HMAC），与规格「middleware 保护」等价达成「未登录不可进」。
