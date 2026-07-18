# CLAUDE.md

用于减少常见 LLM 编码失误的行为准则。可与项目特定说明合并使用。

## 0. 语言偏好

- **用户语言偏好：中文（简体）**
- 与用户沟通（解释、提问、计划、总结、评审意见）默认使用**简体中文**
- 代码标识符、API、包名、提交信息中的专有名词可保持英文；用户可见文案优先中文
- 仅当用户明确要求使用其他语言时再切换

**权衡：** 本准则偏向谨慎而非速度。对琐碎任务可自行判断尺度。

## 1. 编码前先思考

**不要臆测。不要隐瞒困惑。把权衡摆到台面上。**

动手实现前：
- 明确说出你的假设；不确定就问。
- 若存在多种理解，列出来——不要默默选一个。
- 若有更简单的做法，说出来；该反对时要反对。
- 有不清楚的地方就停下：指出困惑点，再提问。

## 2. 简单优先

**用最少的代码解决问题。不做臆测性扩展。**

- 不实现未要求的功能。
- 不为「只用一次」的代码引入抽象。
- 不添加未被要求的「灵活性」或「可配置性」。
- 不为不可能发生的情况写错误处理。
- 若写了 200 行而 50 行就够，重写。

自问：「资深工程师会不会觉得这过度复杂？」若会，就简化。

## 3. 外科手术式修改

**只动必须动的。只清理自己制造的脏乱。**

修改已有代码时：
- 不要「顺手改进」邻近代码、注释或格式。
- 不要重构并未损坏的东西。
- 匹配现有风格，即使你个人会写成另一种样子。
- 若发现无关死代码，可以提及——但不要擅自删除。

当你的改动产生孤儿时：
- 删除因**你的改动**而不再使用的 import / 变量 / 函数。
- 除非被要求，否则不要删除原本就存在的死代码。

检验标准：每一行变更都应能直接追溯到用户请求。

## 4. 目标驱动执行

**定义成功标准。验证通过再结束。**

把任务变成可验证目标：
- 「加校验」→「先为非法输入写测试，再让测试通过」
- 「修 bug」→「先写能复现的测试，再让它通过」
- 「重构 X」→「重构前后测试都通过」

多步骤任务给出简短计划：
```
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

成功标准要强，才能独立闭环；弱标准（「弄好就行」）只会不断需要澄清。

---

**准则生效的表现：** diff 里少有无关改动；少因过度设计而返工；澄清问题出现在实现之前，而不是出错之后。

---

## 5. 项目结构

Isotope 是 TypeScript **模块化单体**（pnpm workspace）：领域包 + Next.js 呈现层。完整设计见 `docs/architecture/PROJECT_SKELETON.md`。产品范围见 `docs/PRD.md`。

### 目录布局

```text
apps/web/                 # 呈现层（Next.js UI / BFF）。不含领域规则
packages/
  kernel/                 # 共享原语（Id、Result、Event、Error）
  identity/               # 内置登录与会话
  workspace/              # 核心：项目、文件、消息、版本、模式
  agent-runtime/          # 编排、Engineer/Team 模式、Tool 端口
  agents/                 # Agent 插件（leader、coder、planner、…）
  llm/                    # LLM Provider 插件
  preview/                # 构建队列 + App Viewer 产物
  sandbox/                # 构建/命令的执行环境
  deploy/ · memory/       # 后续能力占位
  application/            # 跨领域用例
prompts/<domain>/         # 版本化 Prompt 模板（禁止在 TS 里硬编码）
configs/<area>/           # YAML/JSON 行为配置
templates/vite-react/     # 新建项目时复制的 Workspace 模板
data/projects/<id>/       # 运行时：workspace/（源码）+ build/（预览）
```

领域包内部（适用时）：

```text
packages/<name>/src/
  domain/    # 实体、不变量、端口
  app/       # 本领域用例
  infra/     # 适配器（FS、DB、进程）
  index.ts   # 仅暴露窄公共表面
```

### 在此仓库编码的硬规则

1. **以 Workspace 为中心：** Agent 不得直接碰 `data/**` 或本地 FS。所有文件/项目 I/O 必须经 `@isotope/workspace` 端口。
2. **禁止硬编码 Prompt：** Prompt 放 `prompts/`，按 id/version/vars 加载；配置放 `configs/`。
3. **依赖向内：** `apps/web` → `application` → 领域包 → `kernel`。禁止 `workspace` → `agents` / `preview` / `web`（避免循环依赖）。
4. **插件式扩展：** 新 agent / LLM / sandbox / deploy = 新 provider + 配置注册，而不是散落的 `if/else`。
5. **预览闭环：** 经 workspace 写入 → `preview` 入队构建 → `sandbox` 执行构建 → 产物进 `build/` → App Viewer iframe。
6. **有意义目录深度 ≤ 4 层；** 一个目录只负责一件事。

### 包速查

| 需求 | 包 |
|------|-----|
| 登录 / 会话 | `@isotope/identity` |
| 项目、对话、文件、版本 | `@isotope/workspace` |
| 模式切换、回合编排 | `@isotope/agent-runtime` |
| Mike / Alex / … 行为 | `@isotope/agents` |
| 模型调用 | `@isotope/llm` |
| 自动构建 + 实时预览 | `@isotope/preview` + `@isotope/sandbox` |
| 串联用例 | `@isotope/application` |
| UI 路由与组件 | `@isotope/web`（`apps/web`） |
