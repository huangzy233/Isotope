# Isotope 项目骨架与架构设计

> 本文描述工程骨架、模块职责、依赖与演进方式。**不含业务实现代码。**

---

## 1. 推荐的项目目录树

```text
isotope/
├── apps/
│   └── web/                         # Presentation：Next.js 全栈 UI / BFF 入口
│       ├── app/                     # 路由与页面
│       ├── components/              # 纯 UI（无领域规则）
│       ├── lib/                     # 对 application 的薄适配
│       └── public/
│
├── packages/
│   ├── kernel/                      # 共享内核：Error / Event / Result / Id
│   ├── identity/                    # 身份与会话（内置账号登录）
│   ├── workspace/                   # 核心资源：项目、文件、消息、版本、模式
│   ├── agent-runtime/               # Agent 运行时：编排、模式、Tool 端口
│   ├── agents/                      # Agent 插件实现（leader/coder/...）
│   ├── llm/                         # LLM Provider 插件
│   ├── preview/                     # 构建队列 + 预览发布
│   ├── sandbox/                     # 运行环境抽象（本地进程等）
│   ├── deploy/                      # 发布 Provider（后续）
│   ├── memory/                      # 长期记忆（后续）
│   └── application/                 # 跨领域用例（Application 层）
│
├── prompts/                         # Prompt 资产（禁止硬编码进业务代码）
│   ├── requirement/
│   ├── planner/
│   ├── coding/
│   ├── review/
│   ├── testing/
│   ├── leader/
│   └── deploy/
│
├── configs/                         # 配置驱动
│   ├── app/
│   ├── agents/
│   ├── modes/                       # engineer / team
│   ├── llm/
│   ├── preview/
│   └── deploy/
│
├── templates/                       # Workspace 起始模板
│   └── vite-react/
│
├── data/                            # 运行时数据（gitignore）
│   └── projects/<projectId>/
│       ├── workspace/               # 源码（Agent 只经 Workspace 端口读写）
│       └── build/                   # 预览产物
│
├── docs/
│   ├── PRD.md
│   └── architecture/
│       └── PROJECT_SKELETON.md      # 本文件
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .gitignore
```

包内统一分层（不超过四层有意义目录）：

```text
packages/<domain>/
└── src/
    ├── domain/          # 实体、不变量、端口（Ports）
    ├── app/             # 本领域用例
    ├── infra/           # 适配器（FS / DB / 进程）
    └── index.ts         # 对外窄接口（深模块表面）
```

`agents`、`llm`、`sandbox`、`deploy` 以 **plugins/providers** 为主，不强行套满三层。

---

## 2. 每个目录职责

| 路径 | 职责 |
|------|------|
| `apps/web` | 登录页、首页、工作台 UI；HTTP/SSE 入口；调用 `application`，不含核心业务规则 |
| `packages/kernel` | 跨模块稳定原语：实体 Id、领域事件、Result/Error、时间等 |
| `packages/identity` | 内置用户校验、会话签发/校验、鉴权端口 |
| `packages/workspace` | Workspace 生命周期、元数据、消息、版本摘要、模式持久化、**文件端口**（唯一读写入口） |
| `packages/agent-runtime` | 回合编排、Engineer/Team 模式策略、Tool 注册表、与 Workspace/Preview 的协作端口 |
| `packages/agents` | 具体 Agent 插件：leader / requirement / planner / coder / reviewer / tester |
| `packages/llm` | LLM Provider 抽象与实现（OpenAI 等）；模型路由 |
| `packages/preview` | Build Queue、构建状态、预览 revision、静态产物发布 |
| `packages/sandbox` | 「在哪执行构建/命令」的抽象（本机子进程 → 未来容器） |
| `packages/deploy` | 发布上线 Provider 端口（P2，先留骨架） |
| `packages/memory` | 跨项目长期记忆端口（P2，先留骨架） |
| `packages/application` | 跨领域用例：`Login`、`CreateProject`、`SendMessage`、`CompleteTask`、`RebuildPreview` |
| `prompts/*` | 按领域版本化 Prompt 模板 |
| `configs/*` | Agent/模式/LLM/预览等 YAML·JSON 配置 |
| `templates/*` | 新 Workspace 的受控脚手架 |
| `data/projects` | 运行时项目落盘根目录 |

---

## 3. 为什么这样划分

1. **Domain First**：按 Workspace / Agent / Preview 等业务能力分包，而不是 controller/service/dao。
2. **Workspace Oriented**：所有 Agent 通过 `workspace` 端口读写；禁止 Agent 直接 `fs` 扫盘。
3. **深模块**：每个 package 只暴露 `index.ts` 窄接口，实现细节留在 domain/app/infra。
4. **插件友好**：新 Agent / LLM / Sandbox / Deploy = 新 provider 注册，而不是改散落 if/else。
5. **配置与 Prompt 外置**：行为与提示词可版本化、可 A/B，不绑死在 TS 字符串里。
6. **可拆分**：当前是 pnpm 模块化单体；包边界即未来 Package/服务边界。
7. **AI 友好**：命名统一、目录 ≤4 层、一目录一职责，便于检索与生成。

---

## 4. 后续扩展方式

| 扩展类型 | 做法 |
|----------|------|
| 新 Agent | 在 `packages/agents/src/<name>` 实现 + `configs/agents/<name>.yaml` 注册 + `prompts/<domain>/` |
| 新 Tool | 在 `agent-runtime` 定义 Tool Port，插件侧实现并注册 |
| 新 LLM Provider | `packages/llm/src/providers/<name>` + `configs/llm/` |
| 新 Runtime | `packages/sandbox/src/providers/<name>`（如 Docker） |
| 新 Deploy | `packages/deploy/src/providers/<name>` |
| 新模式 | `configs/modes/<mode>.yaml` 描述参与 Agent 与编排策略，runtime 读取 |
| 新模板 | `templates/<template-id>/`，创建项目时选择 |

注册表模式（示意，非代码）：

```text
configs/agents/*.yaml  →  AgentRegistry
configs/llm/*.yaml     →  LlmProviderRegistry
configs/modes/*.yaml   →  ModePolicy
```

---

## 5. 哪些模块适合拆 Package（当前已是 Package）

**现在就以 workspace package 存在，并适合独立版本发布：**

- `@isotope/kernel`
- `@isotope/workspace`
- `@isotope/agent-runtime`
- `@isotope/llm`
- `@isotope/preview`

**可随稳定度提升再严格 semver 对外：**

- `@isotope/agents`（或拆成 `@isotope/agent-coder` 等）
- `@isotope/identity`
- `@isotope/sandbox`

`application` 与 `apps/web` 通常留在产品仓，不强行 npm 发布。

---

## 6. 哪些模块未来适合拆微服务

| 模块 | 拆分动机 | 建议时机 |
|------|----------|----------|
| `preview` + `sandbox` | CPU/内存密集、需隔离恶意构建 | 多租户或构建队列成为瓶颈时 |
| `llm`（或 model gateway） | 统一限流、密钥、观测 | 多产品共用模型网关时 |
| `agent-runtime` | 长任务、独立扩缩容 | 回合耗时与 Web 流量模型不同时 |
| `deploy` | 对接多云、凭证隔离 | 真正做发布平台时 |
| `memory` | 向量库/检索独立扩缩 | 记忆成为核心能力时 |
| `workspace` 文件存储 | 大文件对象存储 | 工作区体积与 IO 压力上升时 |

**不建议过早拆：** `identity`（Demo 体量）、`application`（用例层）、`apps/web` 的页面。

优先保持 **模块化单体 + 清晰端口**；流量与隔离需求出现后再拆。

---

## 7. Prompt 如何组织

```text
prompts/
  <domain>/
    system.v1.md          # System Prompt
    user.v1.md            # User 模板（含 {{variables}}）
    fewshot.v1.md         # 可选 few-shot
    meta.yaml             # 版本、适用 agent、变量声明、模型提示
```

约定：

- **禁止**在 `packages/**` 内硬编码大段 Prompt。
- Runtime 通过 `promptId + version + vars` 加载。
- 同一 domain 可并存 `v1` / `v2` 做 A/B（由 `configs/agents` 指向版本）。
- Team Leader 使用 `prompts/leader/`；编码使用 `prompts/coding/`。

`meta.yaml` 建议字段：`id`、`version`、`domain`、`variables[]`、`ownerAgent`、`changelog`。

---

## 8. Configuration 如何组织

```text
configs/
  app/           # 端口、data 根路径、演示账号引用方式等
  agents/        # 每个 agent：角色、可用 tools、默认 prompt 版本
  modes/         # engineer.yaml / team.yaml：参与者与编排
  llm/           # provider、model、timeout、路由
  preview/       # 构建超时、并发、模板、预览路径规则
  deploy/        # 发布 provider（后续）
```

原则：

- 环境相关（密钥、演示密码）→ `.env` / 部署密钥，**不进** git。
- 行为相关（模式谁上场、构建超时）→ `configs/**` 进 git。
- 代码只读配置，不写死 Provider 名称分支林立。

---

## 9. 模块依赖关系

### 9.1 允许的依赖方向

```text
apps/web
  → application
      → identity
      → workspace
      → agent-runtime
      → preview
      → memory (optional)
      → deploy (optional)

agent-runtime
  → workspace          # 唯一文件/项目入口
  → agents             # 插件
  → llm
  → kernel

agents
  → agent-runtime (ports/types only)
  → workspace (ports only)
  → llm (ports only)
  → kernel

preview
  → workspace (读源码树 meta / 触发点)
  → sandbox            # 真正执行 build
  → kernel

sandbox → kernel
deploy  → workspace (ports) → kernel
memory  → workspace (ports) → kernel
identity → kernel
llm → kernel
workspace → kernel
```

### 9.2 依赖图（简化）

```text
                    ┌─────────────┐
                    │  apps/web   │
                    └──────┬──────┘
                           ▼
                  ┌────────────────┐
                  │  application   │
                  └────────┬───────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐  ┌──────────────┐  ┌─────────┐
     │ identity │  │agent-runtime │  │ preview │
     └──────────┘  └──────┬───────┘  └────┬────┘
                          │               │
              ┌───────────┼───────┐       ▼
              ▼           ▼       ▼  ┌─────────┐
        ┌─────────┐ ┌────────┐ ┌─────┤ sandbox │
        │workspace│ │ agents │ │llm  └─────────┘
        └────┬────┘ └────────┘ └─────
             ▼
        ┌─────────┐
        │ kernel  │
        └─────────┘
```

### 9.3 禁止的依赖

- `workspace` ✗→ `agents` / `preview` / `web`（避免循环）
- `agents` ✗→ `apps/web`
- `llm` ✗→ `workspace`（模型层不感知项目）
- 任意包 ✗→ 直接读写 `data/**`（必须经 workspace / preview 端口）

### 9.4 核心运行时序（概念）

```text
User message
  → application.SendMessage
  → agent-runtime.runTurn(mode)
      → (team) leader agent → create task → coder agent
      → agents 经 workspace 端口写文件
  → application 触发 preview.enqueueBuild
  → sandbox 执行 vite build
  → preview 发布 build/ + 通知 web 刷新 iframe
```

---

## 10. 与当前 PRD 的映射（落地优先级）

| PRD 能力 | 落点模块 |
|----------|----------|
| 内置登录 | `identity` + `apps/web` |
| 项目/对话持久化 | `workspace` |
| Engineer / Team | `configs/modes` + `agent-runtime` |
| Leader 任务分配 | `agents/leader` + `prompts/leader` |
| 自动构建 + 实时预览 | `preview` + `sandbox` + `apps/web` App Viewer |
| 版本卡片 | `workspace` versions |
| Publish / Memory 等 | `deploy` / `memory` 骨架预留 |

---

## 11. 骨架已生成说明

仓库内已创建上述目录与 package 清单（`pnpm-workspace.yaml`、各 `@isotope/*` 的 `package.json`）。`src/index.ts` 仅为占位表面，**无业务逻辑**。下一步可在此骨架上初始化 Next.js（`apps/web`）并实现 `workspace` + `preview` 闭环。
