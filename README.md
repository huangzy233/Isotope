# Isotope

多智能体应用生成 Demo（Atoms 风格）—— TypeScript **模块化单体**。

对话驱动生成 Web 应用，支持 **Engineer / Plan / Team** 模式组合、Agent 记忆、自动构建与 App Viewer 实时预览。内置账号登录，不开放注册。

## 核心能力

- **内置登录**：演示账号见 `configs/app/demo-users.yaml`（默认 `demo`/`demo`、`reviewer`/`reviewer`）
- **对话生成**：多轮对话驱动改码；助手消息支持流式输出
- **模式开关**（可独立组合；都关 = Engineer）
  - **Engineer**：Alex 直接改码
  - **Plan**：Pat 澄清需求 → 推荐路径 → 规格说明 → 用户确认后再执行
  - **Team**：Mike（Leader）拆分任务并分配给工程师
  - **Plan ∧ Team**：确认后交 Mike → Alex
- **记忆**：短期上下文压缩；长期用户 Preference + 项目内 Product Spec / Decision
- **预览闭环**：Workspace 写入 → 构建队列 → Sandbox 执行 → `build/` 产物 → App Viewer
- **版本卡**：轻量版本记录；刷新后项目 / 会话 / 状态可恢复（含断线重连）

产品范围与验收见 [docs/PRD.md](docs/PRD.md)。

## 技术栈

| 层 | 选型 |
|----|------|
| 语言 / 包管理 | TypeScript、pnpm workspace（`pnpm@9`） |
| 呈现层 | Next.js 15（`apps/web`）、React 19 |
| 领域 | `packages/*` 按业务能力分包 |
| LLM | OpenAI-compatible Chat Completions（`@isotope/llm`） |
| 测试 | Vitest（各包 `pnpm --filter <pkg> test`） |

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp apps/web/.env.example apps/web/.env.local
```

编辑 `apps/web/.env.local`：

| 变量 | 说明 |
|------|------|
| `SESSION_SECRET` | 会话签名密钥（本地可先用示例值） |
| `LLM_API_KEY` | 模型 API Key（**勿提交仓库**） |
| `LLM_BASE_URL` | OpenAI-compatible 接口根地址（如 DeepSeek：`https://api.deepseek.com`） |
| `LLM_MODEL` | 默认模型名（如 `deepseek-v4-pro`） |

未配置 LLM 时，登录与静态页可用，但对话回合无法真正调用模型。

### 3. 启动开发服务

```bash
pnpm dev
# 等价于
pnpm --filter @isotope/web dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，用演示账号登录。

### 4. 建议体验路径

1. 登录 → 首页发起或打开项目  
2. 右侧 App Viewer 观察预览；左侧与 Agent 对话迭代  
3. 打开 **Plan** 体验 Pat 澄清与确认后再执行  
4. 打开 **Team**（或 Plan+Team）体验 Mike 任务分配  
5. 刷新页面，确认项目、对话与进行中状态可恢复  

## 仓库结构

```text
isotope/
├── apps/web/                 # Next.js UI / BFF（不含领域规则）
├── packages/
│   ├── kernel/               # Id / Result / Event / Error
│   ├── identity/             # 内置登录与会话
│   ├── workspace/            # 项目、文件、消息、版本、模式
│   ├── agent-runtime/        # 回合编排、模式策略、Tool 端口
│   ├── agents/               # Agent 插件（Mike / Alex / Pat / …）
│   ├── llm/                  # LLM Provider
│   ├── preview/              # 构建队列 + 预览产物
│   ├── sandbox/              # 构建 / 命令执行环境
│   ├── memory/               # Preference；项目 Spec/Decision 在 workspace
│   ├── deploy/               # 发布能力占位（后续）
│   └── application/          # 跨领域用例
├── prompts/<domain>/         # 版本化 Prompt（禁止在 TS 里硬编码）
├── configs/<area>/           # YAML/JSON 行为配置
├── templates/vite-react/     # 新建项目时复制的 Workspace 模板
├── data/projects/<id>/       # 运行时（gitignore）：workspace/ + build/
└── docs/                     # 产品、架构、UI、实现计划
```

包内常见分层（`agents` / `llm` / `sandbox` / `deploy` 以 plugin 为主，可不套满）：

```text
packages/<name>/src/
├── domain/     # 实体、不变量、端口
├── app/        # 本领域用例
├── infra/      # 适配器（FS、DB、进程）
└── index.ts    # 对外窄公共表面
```

完整目录与演进说明见 [docs/architecture/PROJECT_SKELETON.md](docs/architecture/PROJECT_SKELETON.md)。

## 包职责速查

| 需求 | 包 |
|------|-----|
| 登录 / 会话 | `@isotope/identity` |
| 项目、对话、文件、版本 | `@isotope/workspace` |
| 模式切换、回合编排 | `@isotope/agent-runtime` |
| Mike / Alex / Pat / … 行为 | `@isotope/agents` |
| 模型调用 | `@isotope/llm` |
| 自动构建 + 实时预览 | `@isotope/preview` + `@isotope/sandbox` |
| 用户 Preference / 记忆相关 | `@isotope/memory` |
| 串联用例 | `@isotope/application` |
| UI 路由与组件 | `@isotope/web`（`apps/web`） |
| 共享原语 | `@isotope/kernel` |

## 架构硬规则

在本仓库改代码时请遵守（摘要；细则以骨架文档为准）：

1. **以 Workspace 为中心**  
   Agent 不得直接碰 `data/**` 或本地 FS。文件 / 项目 I/O 必须经 `@isotope/workspace` 端口。

2. **禁止硬编码 Prompt**  
   Prompt 放 `prompts/`，按 id / version / vars 加载；行为配置放 `configs/`。

3. **依赖向内**  
   `apps/web` → `application` → 领域包 → `kernel`。  
   禁止 `workspace` → `agents` / `preview` / `web` 等反向依赖。

4. **插件式扩展**  
   新 Agent / LLM / Sandbox / Deploy = 新 provider + 配置注册，而不是散落的 `if/else`。

5. **预览闭环**  
   经 workspace 写入 → `preview` 入队 → `sandbox` 执行 → 产物进 `build/` → App Viewer。

6. **目录约定**  
   有意义目录深度 ≤ 4；一个目录只负责一件事。

扩展方式速查：

| 扩展 | 做法 |
|------|------|
| 新 Agent | `packages/agents` + `configs/agents/` + `prompts/<domain>/` |
| 新 Tool | `agent-runtime` 定义端口，插件实现并注册 |
| 新 LLM Provider | `packages/llm` + `configs/llm/` |
| 新模式 | `configs/modes/` + runtime 读取策略 |
| 新模板 | `templates/<id>/` |

## 常用命令

```bash
# 开发
pnpm install
pnpm dev

# 全仓构建 / 类型检查
pnpm build
pnpm typecheck

# 单包测试（示例）
pnpm --filter @isotope/agent-runtime test
pnpm --filter @isotope/application test
pnpm --filter @isotope/web test
```

## 文档

| 文档 | 说明 |
|------|------|
| [docs/README.md](docs/README.md) | 文档索引入口 |
| [docs/PRD.md](docs/PRD.md) | 产品需求与验收范围 |
| [docs/architecture/PROJECT_SKELETON.md](docs/architecture/PROJECT_SKELETON.md) | 包边界、依赖与演进 |
| [docs/ui/README.md](docs/ui/README.md) | AI Native UI Playbook |

设计决策原文在 `docs/superpowers/specs/`，**不**挂入文档索引；实现计划见 `docs/superpowers/plans/`。

## 说明

本仓库为可体验的 Demo 原型：内置账号、本地 / 文件型持久化、预览构建闭环。P2 能力（真实 Publish、开放注册、云端多租户等）见 PRD，当前未作为交付目标。
