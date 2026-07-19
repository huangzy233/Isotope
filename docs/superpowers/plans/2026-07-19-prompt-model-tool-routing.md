# Prompt Model/Tool Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Prompt/调用阶段指定模型与工具白名单；Prompt/LLM 配置进程内缓存；按 provider 配置、按 model 调用的 LlmRouter。

**Architecture:** Prompt Bundle（`.md` + `.meta.yaml`）经 `PromptLoader` 缓存加载；装配层用 `meta.tools ∩ agent catalog` 过滤工具，并把解析后的 `model` 传入 `runTurn`；`LlmRouter` 按 model 查找 provider client，同 provider 多模型共用连接配置。

**Tech Stack:** TypeScript、pnpm workspace、vitest、yaml、现有 OpenAI-compatible provider。

**Spec:** `docs/superpowers/specs/2026-07-19-prompt-model-tool-routing-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖：`web → application → agent-runtime → agents|llm`；Agent 不直碰 `data/**`；禁止 TS 硬编码长 Prompt。
- 「任务类型」= Prompt/调用阶段；模型来自 meta（缺省：`LLM_MODEL` → `defaultModel`）。
- 配置按 provider；调用按 model。
- 不做：ModePolicy 全量、路径/命令 ACL 可观测、UI 选模型、通用 `{{vars}}` 引擎、故障转移。
- **未经用户要求不要 git commit**（下文若含 commit 步骤一律跳过）。
- 外科手术式改动；测试优先（TDD）。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/llm/src/domain/types.ts` | `LlmClient.complete` 必填 `model`；`OpenAiCompatibleConfig` 去掉固定 model |
| `packages/llm/src/providers/openai-compatible.ts` | 请求体使用 `input.model` |
| `packages/llm/src/providers/openai-compatible.test.ts` | 断言 body.model 来自请求 |
| `packages/llm/src/app/load-providers.ts` | 读 `configs/llm/providers/*.yaml` + default；mtime 缓存 |
| `packages/llm/src/app/create-router.ts` | `createLlmRouter`：model → provider client |
| `packages/llm/src/app/create-router.test.ts` | Router 路由 / 未知 model |
| `packages/llm/src/index.ts` | 导出 Router / loader 类型 |
| `configs/llm/default.yaml` | `defaultModel` + `maxToolRounds`（不再放 baseUrl/model 死绑） |
| `configs/llm/providers/deepseek.yaml` | 当前 DeepSeek provider + models 列表 |
| `apps/web/lib/prompt-loader.ts` | PromptLoader：md+meta、缓存、model 解析 |
| `apps/web/lib/filter-tools.ts` | `filterTools(catalog, names)`；未知名抛错 |
| `apps/web/package.json` | 增加 `vitest` + `"test": "vitest run"`（web 现无测试脚本） |
| `apps/web/lib/prompt-loader.test.ts` | 缓存 / mtime / 缺文件 / model 回退 |
| `apps/web/lib/filter-tools.test.ts` | 白名单求交 |
| `prompts/**/*.v1.meta.yaml` | 五个现有阶段的 meta |
| `packages/agents/src/{coder,leader,requirement}/index.ts` | 工厂接受可选 `tools` |
| `packages/agents/src/index.ts` | 导出 `CODER_TOOLS` / `LEADER_TOOLS` / `REQUIREMENT_TOOLS` |
| `packages/agent-runtime/src/domain/types.ts` | `RunTurnInput.model` |
| `packages/agent-runtime/src/app/run-turn.ts` | `complete({ model, … })` |
| `packages/agent-runtime/src/app/run-turn.test.ts` | 断言传入 model |
| `packages/application/.../stream-*-turn.ts` | deps 带各阶段 `model`；summary 用正式 agent |
| `packages/application/.../summarize-version.ts` | `complete` 传 model |
| `apps/web/lib/agent.ts` | bundle 装配 + Router |
| `apps/web/lib/preview.ts` | 摘要走 Router + bundle |
| `apps/web/lib/paths.ts` | 收敛为 promptsRoot / configs 根路径（可删各 `*PromptPath`） |

---

### Task 1: LlmClient per-request `model`

**Files:**
- Modify: `packages/llm/src/domain/types.ts`
- Modify: `packages/llm/src/providers/openai-compatible.ts`
- Modify: `packages/llm/src/providers/openai-compatible.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LlmClient = {
    complete(input: {
      model: string;
      messages: LlmMessage[];
      tools?: LlmToolDefinition[];
      signal?: AbortSignal;
    }): AsyncIterable<LlmStreamEvent>;
  };

  export type OpenAiCompatibleConfig = {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    fetch?: typeof fetch;
  };
  ```

- [ ] **Step 1: 改测试 — 断言请求 body.model 来自 `complete` 入参**

在 `openai-compatible.test.ts` 里，构造 client **不再传** `model`；调用：

```ts
for await (const _ of client.complete({
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "hi" }],
})) {
  /* drain */
}
```

对 mock `fetch` 解析 `JSON.parse(init.body).model`，期望 `"deepseek-v4-pro"`。再加一次用 `"other-model"` 的调用，期望 body 随之变化。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @isotope/llm test -- src/providers/openai-compatible.test.ts`

Expected: FAIL（仍读 `config.model` 或类型不匹配）

- [ ] **Step 3: 改类型与实现**

`types.ts`：按 Interfaces 更新。  
`openai-compatible.ts`：`body.model = input.model`；删除 config 上的 model。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @isotope/llm test -- src/providers/openai-compatible.test.ts`

Expected: PASS

- [ ] **Step 5: 跳过 commit**（除非用户要求）

---

### Task 2: Provider 配置 + LlmRouter

**Files:**
- Create: `packages/llm/src/app/load-providers.ts`
- Create: `packages/llm/src/app/create-router.ts`
- Create: `packages/llm/src/app/create-router.test.ts`
- Create: `configs/llm/providers/deepseek.yaml`
- Modify: `configs/llm/default.yaml`
- Modify: `packages/llm/src/index.ts`
- Modify: `configs/llm/README.md`（一行说明 providers/）

**Interfaces:**
- Produces:
  ```ts
  export type LlmDefaultConfig = {
    defaultModel: string;
    maxToolRounds: number;
    timeoutMs?: number;
  };

  export type LlmProviderConfig = {
    id: string;
    type: "openai-compatible";
    baseUrl: string;
    apiKeyEnv: string;
    timeoutMs: number;
    models: string[];
  };

  export function loadLlmDefaults(configDir: string): LlmDefaultConfig;
  export function loadLlmProviders(configDir: string): LlmProviderConfig[];
  /** 清缓存（测试用） */
  export function clearLlmConfigCache(): void;

  export function createLlmRouter(input: {
    providers: LlmProviderConfig[];
    resolveApiKey: (envName: string) => string;
    /** 可选：覆盖某 provider 的 baseUrl（映射现网 LLM_BASE_URL） */
    overrideBaseUrl?: string;
    fetch?: typeof fetch;
  }): LlmClient;
  ```

- [ ] **Step 1: 写 `default.yaml` + `providers/deepseek.yaml`**

`configs/llm/default.yaml`:

```yaml
defaultModel: deepseek-v4-pro
timeoutMs: 120000
maxToolRounds: 8
```

`configs/llm/providers/deepseek.yaml`:

```yaml
id: deepseek
type: openai-compatible
baseUrl: https://api.deepseek.com
apiKeyEnv: LLM_API_KEY
timeoutMs: 120000
models:
  - deepseek-v4-pro
  - deepseek-chat
```

（若当前默认 model 名不同，以仓库现网 `configs/llm/default.yaml` 的 model 值为准写入 `defaultModel` 与 `models`。）

- [ ] **Step 2: 写失败测试 `create-router.test.ts`**

```ts
import { createLlmRouter } from "./create-router.js";

describe("createLlmRouter", () => {
  it("routes two models on same provider with different body.model", async () => {
    const bodies: unknown[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        // minimal SSE finished stream — 复制 openai-compatible.test 的成功 fixture
        sseFixture(),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const router = createLlmRouter({
      providers: [
        {
          id: "deepseek",
          type: "openai-compatible",
          baseUrl: "https://example.test",
          apiKeyEnv: "LLM_API_KEY",
          timeoutMs: 5000,
          models: ["m1", "m2"],
        },
      ],
      resolveApiKey: () => "sk-test",
      fetch: fetchFn,
    });
    for await (const _ of router.complete({
      model: "m1",
      messages: [{ role: "user", content: "a" }],
    })) {}
    for await (const _ of router.complete({
      model: "m2",
      messages: [{ role: "user", content: "b" }],
    })) {}
    expect((bodies[0] as { model: string }).model).toBe("m1");
    expect((bodies[1] as { model: string }).model).toBe("m2");
  });

  it("throws on unknown model", async () => {
    const router = createLlmRouter({
      providers: [
        {
          id: "deepseek",
          type: "openai-compatible",
          baseUrl: "https://example.test",
          apiKeyEnv: "LLM_API_KEY",
          timeoutMs: 5000,
          models: ["m1"],
        },
      ],
      resolveApiKey: () => "sk-test",
    });
    const iter = router.complete({
      model: "nope",
      messages: [{ role: "user", content: "x" }],
    });
    await expect(iter.next()).rejects.toThrow(/unknown model/i);
  });
});
```

`sseFixture`：从现有 `openai-compatible.test.ts` 抽出最小可读流字符串复用。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @isotope/llm test -- src/app/create-router.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 load-providers + create-router**

`load-providers.ts`：
- `configDir` 指向含 `default.yaml` 与 `providers/` 的目录（即 monorepo `configs/llm`）。
- 用 `fs.readFileSync` + `yaml.parse`；缓存 `Map` 存 `{ mtimeMs, data }`；对外 `clearLlmConfigCache()`。
- 读 `providers/*.yaml`；校验 `type === "openai-compatible"`；构建 `model → providerId` 索引时若重复 model 抛错。

`create-router.ts`：
- 启动时为每个 provider 建一个 `createOpenAiCompatibleClient`（apiKey 来自 `resolveApiKey(apiKeyEnv)`；空 key 抛与现网一致的中文/英文错误均可，但信息需含 env 名）。
- `overrideBaseUrl` 若设，应用到**所有** provider 的 baseUrl（兼容现网单一 `LLM_BASE_URL`）。
- `complete`：查 model → client；`yield* client.complete(input)`；未知 model：`throw new Error(\`Unknown model: ${model}\`)`。

- [ ] **Step 5: 导出并跑通测试**

`index.ts` 导出上述符号。  
Run: `pnpm --filter @isotope/llm test`

Expected: PASS

- [ ] **Step 6: 跳过 commit**

---

### Task 3: PromptLoader + filterTools + meta 文件

**Files:**
- Create: `apps/web/lib/prompt-loader.ts`
- Create: `apps/web/lib/prompt-loader.test.ts`
- Create: `apps/web/lib/filter-tools.ts`
- Create: `apps/web/lib/filter-tools.test.ts`
- Modify: `apps/web/package.json`（devDependency `vitest` + script `"test": "vitest run"`；必要时加最小 `vitest.config.ts`）
- Create: `prompts/coding/alex-system.v1.meta.yaml`
- Create: `prompts/leader/mike-system.v1.meta.yaml`
- Create: `prompts/leader/mike-summary.v1.meta.yaml`
- Create: `prompts/requirement/pat-system.v1.meta.yaml`
- Create: `prompts/workspace/version-summary.v1.meta.yaml`
- Modify: `apps/web/lib/paths.ts`（增加 `promptsRoot()` / `llmConfigDir()`；保留或删除旧 path helpers）

**Interfaces:**
- Produces:
  ```ts
  export type PromptBundle = {
    id: string;
    version: string;
    system: string;
    model: string;
    tools: string[];
  };

  export function createPromptLoader(input: {
    promptsRoot: string;
    defaultModel: string;
    /** 测试可注入 */
    readFile?: (abs: string) => string;
    statMtimeMs?: (abs: string) => number;
  }): {
    load(id: string, version?: string): PromptBundle;
    clearCache(): void;
  };

  export function filterTools(
    catalog: LlmToolDefinition[],
    allowedNames: string[],
  ): LlmToolDefinition[];
  ```

路径约定：`id = "leader/mike-system"` + `version = "v1"` →  
`promptsRoot/leader/mike-system.v1.md` + `mike-system.v1.meta.yaml`。

- [ ] **Step 1: 写 filterTools 测试与实现**

```ts
it("returns only allowed tools in catalog order", () => {
  const out = filterTools(CODER_TOOLS, ["read_file", "list_files"]);
  expect(out.map((t) => t.function.name)).toEqual(["list_files", "read_file"]);
});

it("throws if meta names unknown tool", () => {
  expect(() => filterTools(CODER_TOOLS, ["nope"])).toThrow(/unknown tool/i);
});

it("empty allowlist yields empty array", () => {
  expect(filterTools(CODER_TOOLS, [])).toEqual([]);
});
```

实现：按 `allowedNames` 顺序从 catalog 取；缺一即抛。

- [ ] **Step 2: 写 PromptLoader 失败测试（内存 fs）**

用内存 Map 模拟文件；`statMtimeMs` 可控。覆盖：
1. 加载 md+meta，`model` 来自 meta  
2. meta 无 model → 用 `defaultModel`  
3. 二次 load 相同 mtime → `readFile` 只调用首次次数（记调用计数）  
4. mtime 变 → 重读  
5. 缺 md 或缺 meta → throw

- [ ] **Step 3: 实现 PromptLoader**

meta 用 `yaml` parse；校验 `tools` 为 `string[]`（可空）。  
`version` 默认 `"v1"`。

`model` 解析（loader 内）：`meta.model ?? defaultModel`。  
（`LLM_MODEL` 在 web 装配传入 `defaultModel` 时处理，不在 loader 读 env。）

- [ ] **Step 4: 添加五个 meta.yaml**

```yaml
# alex-system.v1.meta.yaml
id: coding/alex-system
version: v1
tools:
  - list_files
  - read_file
  - write_file
```

```yaml
# mike-system.v1.meta.yaml
id: leader/mike-system
version: v1
tools:
  - create_task
```

```yaml
# mike-summary.v1.meta.yaml
id: leader/mike-summary
version: v1
tools: []
```

```yaml
# pat-system.v1.meta.yaml
id: requirement/pat-system
version: v1
tools:
  - confirm_requirement
```

```yaml
# version-summary.v1.meta.yaml
id: workspace/version-summary
version: v1
tools: []
```

（本轮 meta **可不写 model**，统一走 defaultModel；至少在**一个** meta 写上 `model:` 与 default 相同或另一已登记 model，以满足 PRD「至少一份声明」——推荐在 `mike-summary` 或 `version-summary` 显式写 `model: <defaultModel>`。）

- [ ] **Step 5: 为 web 加上 vitest 并跑测试**

在 `apps/web/package.json` 增加与其它包同版本的 `vitest`，以及 `"test": "vitest run"`。若需，添加 `apps/web/vitest.config.ts`：`environment: "node"`，`include: ["lib/**/*.test.ts"]`。

Run: `pnpm --filter @isotope/web test -- lib/prompt-loader.test.ts lib/filter-tools.test.ts`

Expected: PASS

- [ ] **Step 6: 跳过 commit**

---

### Task 4: Agents 可注入 tools + 导出 catalog

**Files:**
- Modify: `packages/agents/src/coder/index.ts`
- Modify: `packages/agents/src/leader/index.ts`
- Modify: `packages/agents/src/requirement/index.ts`
- Modify: `packages/agents/src/index.ts`
- Modify: 现有 agents 测试（若有）保持默认全量 tools 行为

**Interfaces:**
- Produces:
  ```ts
  export function createCoderAgent(input: {
    systemPrompt: string;
    tools?: LlmToolDefinition[];
  }): CoderAgent;
  // leader / requirement 同理；默认 tools = 模块 CODER_TOOLS 等
  ```
- 从 `index.ts` 再导出 `CODER_TOOLS`、`LEADER_TOOLS`、`REQUIREMENT_TOOLS`。

- [ ] **Step 1: 改工厂签名并导出 catalog**

```ts
export function createCoderAgent(input: {
  systemPrompt: string;
  tools?: LlmToolDefinition[];
}): CoderAgent {
  return {
    displayName: CODER_DISPLAY_NAME,
    systemPrompt: input.systemPrompt,
    tools: input.tools ?? CODER_TOOLS,
    executeTool,
  };
}
```

leader / requirement 同样。

- [ ] **Step 2: 跑 agents 测试**

Run: `pnpm --filter @isotope/agents test`

Expected: PASS

- [ ] **Step 3: 跳过 commit**

---

### Task 5: `runTurn` 传递 `model`

**Files:**
- Modify: `packages/agent-runtime/src/domain/types.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.test.ts`

**Interfaces:**
- Produces: `RunTurnInput` 增加 `model: string`；`llm.complete({ model: input.model, messages, tools, signal })`。

- [ ] **Step 1: 改 run-turn 测试 — mock 记录 complete 入参含 model**

```ts
const calls: Array<{ model?: string }> = [];
const llm: LlmClient = {
  async *complete(input) {
    calls.push({ model: input.model });
    yield { type: "content_delta", text: "ok" };
    yield { type: "finished", finishReason: "stop" };
  },
};
await runTurn({
  llm,
  model: "test-model",
  agent: createCoderAgent({ systemPrompt: "test" }),
  // ...existing port/history/maxToolRounds/onToken
});
expect(calls[0]?.model).toBe("test-model");
```

更新该文件内所有 `runTurn` / mock `complete` 签名以包含 `model`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @isotope/agent-runtime test`

Expected: FAIL（缺 model 字段或 complete 未传）

- [ ] **Step 3: 实现类型与 run-turn 传参**

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: 跳过 commit**

---

### Task 6: Application 各 turn deps 带 `model`

**Files:**
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-plan-turn.ts`
- Modify: `packages/application/src/projects/stream-team-turn.ts`
- Modify: `packages/application/src/projects/summarize-version.ts`
- Modify: 上述对应 `*.test.ts`（所有 `LlmClient` mock 的 `complete` 接受 `model`；deps 补 `model` / team 多 model）

**Interfaces:**
- Produces:
  ```ts
  // EngineerTurnDeps / PlanTurnDeps
  { …; llm: LlmClient; agent: …; model: string; maxToolRounds: number }

  // TeamTurnDeps
  {
    …;
    llm: LlmClient;
    leader: LeaderAgent;
    leaderModel: string;
    leaderSummary: LeaderAgent; // tools 可为空；由装配注入
    leaderSummaryModel: string;
    coder: CoderAgent;
    coderModel: string;
    maxToolRounds: number;
  }
  ```

- [ ] **Step 1: 更新 deps 类型与所有 `runTurn` 调用传入对应 model**

Engineer / Plan：`model: deps.model`。  
Team：Mike → `deps.leaderModel`；Alex → `deps.coderModel`；summary → `deps.leaderSummaryModel`，agent 用 `deps.leaderSummary`（删除手写 `tools: []` 临时对象与 `leaderSummaryPrompt` 字符串字段）。

- [ ] **Step 2: `summarizeVersionChange` 增加 `model: string` 并传入 `complete`**

```ts
export async function summarizeVersionChange(
  context: string,
  llm: LlmClient,
  promptTemplate: string,
  model: string,
): Promise<string> {
  // …
  for await (const ev of llm.complete({
    model,
    messages: [{ role: "user", content: prompt }],
  })) {
```

更新 `handlePreviewBuildComplete` 调用链（查 `record-version-on-build` / preview complete handler）传入 model。

- [ ] **Step 3: 批量修 application 测试 mock**

所有 `async *complete()` 改为 `async *complete(_input)`（参数含 model 即可，不必断言）。  
构造 deps 时补上 `model: "test-model"` 等。  
Team 测试：`leaderSummary: createLeaderAgent({ systemPrompt: "sum", tools: [] })` + `leaderSummaryModel` / `leaderModel` / `coderModel`。

- [ ] **Step 4: 跑 application 测试**

Run: `pnpm --filter @isotope/application test`

Expected: PASS

- [ ] **Step 5: 跳过 commit**

---

### Task 7: Web 装配接线（Router + PromptLoader）

**Files:**
- Modify: `apps/web/lib/agent.ts`
- Modify: `apps/web/lib/preview.ts`
- Modify: `apps/web/lib/paths.ts`
- Modify: `apps/web/lib/task-runtime.ts`（若仍 `createTeamTurnDeps`）
- Modify: 调用 `summarizeVersionChange` / `handlePreviewBuildComplete` 处

**Interfaces:**
- Consumes: Task 2 Router、Task 3 Loader、Task 4 agents、Task 6 deps 形状

- [ ] **Step 1: 重写 `createSharedLlm` → `createSharedRouter`**

```ts
function resolveDefaultModel(fileDefault: string): string {
  return process.env.LLM_MODEL?.trim() || fileDefault;
}

function createSharedRouter(): { llm: LlmClient; maxToolRounds: number; defaultModel: string } {
  const configDir = llmConfigDir(); // paths: monorepoRoot()/configs/llm
  const defaults = loadLlmDefaults(configDir);
  const providers = loadLlmProviders(configDir);
  const llm = createLlmRouter({
    providers,
    resolveApiKey: (envName) => process.env[envName]?.trim() ?? "",
    overrideBaseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
  });
  return {
    llm,
    maxToolRounds: defaults.maxToolRounds,
    defaultModel: resolveDefaultModel(defaults.defaultModel),
  };
}
```

空 apiKey：在 `resolveApiKey` 或 Router 内保持「未配置 LLM_API_KEY」错误（与现网一致）。

- [ ] **Step 2: 用 PromptLoader 装配 create*TurnDeps**

```ts
const loader = createPromptLoader({
  promptsRoot: promptsRoot(),
  defaultModel, // 来自 createSharedRouter
});

export function createTurnDeps() {
  const { llm, maxToolRounds, defaultModel } = createSharedRouter();
  const loader = createPromptLoader({ promptsRoot: promptsRoot(), defaultModel });
  const bundle = loader.load("coding/alex-system");
  return {
    llm,
    model: bundle.model,
    agent: createCoderAgent({
      systemPrompt: bundle.system,
      tools: filterTools(CODER_TOOLS, bundle.tools),
    }),
    maxToolRounds,
  };
}
```

Team / Plan 同理；Team summary：

```ts
const summaryBundle = loader.load("leader/mike-summary");
leaderSummary: createLeaderAgent({
  systemPrompt: summaryBundle.system,
  tools: filterTools(LEADER_TOOLS, summaryBundle.tools), // [] 
}),
leaderSummaryModel: summaryBundle.model,
```

- [ ] **Step 3: preview 摘要**

```ts
const { llm, defaultModel } = createSharedRouter(); // 或复用单例
const loader = createPromptLoader({ promptsRoot: promptsRoot(), defaultModel });
const bundle = loader.load("workspace/version-summary");
// onBuildComplete → summarizeVersionChange(..., bundle.system, bundle.model)
```

去掉 `LLM_SUMMARY_MODEL` 特例（若需兼容：仅当 `process.env.LLM_SUMMARY_MODEL` 有值时覆盖 `bundle.model`——可选，默认不做）。

进程内可对 router/loader 做模块级单例，避免每次 SSE 重建；**mtime 缓存已在 loader/providers 内**，单例可选。推荐：`let cachedRouter` 惰性单例 + loader 单例，与现 `getPreview` 风格一致。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @isotope/web typecheck`（及 `application` / `agent-runtime` / `llm` / `agents` 若有）

Expected: 无错误

- [ ] **Step 5: 跳过 commit**

---

### Task 8: 回归与验收断言

**Files:**
- Modify: 任何仍因 `complete` 缺 `model` 而失败的测试
- 可选：`packages/llm/src/app/load-providers.test.ts` 覆盖 mtime 缓存（若 Task 2 未充分覆盖）

- [ ] **Step 1: 全仓相关测试**

Run:

```bash
pnpm --filter @isotope/llm test
pnpm --filter @isotope/agents test
pnpm --filter @isotope/agent-runtime test
pnpm --filter @isotope/application test
pnpm --filter @isotope/web test
```

Expected: 全部 PASS

- [ ] **Step 2: 手工验收清单（实现者勾选）**

- [ ] 至少一份 meta 含显式 `model`，抓包或 mock 可见请求 model 一致  
- [ ] meta `tools: []` 的 summary 回合 `complete` 无 tools / 空数组  
- [ ] 连续两次同 bundle `load`，未改文件时不重复读盘（单测已覆盖）  
- [ ] Engineer / Plan / Team 主路径仍可跑通（有 `LLM_API_KEY` 时）

- [ ] **Step 3: 跳过 commit**（用户要求再提交）

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| Prompt Bundle + meta model/tools | 3 |
| 工具白名单 ∩ catalog；装配期未知 tool 抛错 | 3 (`filterTools`) + 7 |
| Prompt/provider 缓存 + mtime | 2, 3 |
| LlmRouter：config by provider, call by model | 2 |
| `complete` / `runTurn` 传 model | 1, 5, 6 |
| Mike summary 经 bundle、`tools: []` | 3, 6, 7 |
| 版本摘要走 Router + bundle | 7 |
| 默认 model 回退 / `LLM_MODEL` | 3, 7 |
| §7.15 / 白名单 AC | 3, 7, 8 |
| 非目标未膨胀 | Global Constraints |

**Placeholder scan:** 无 TBD；测试与配置示例已写明。  
**类型一致性：** `LlmClient.complete.model` → `RunTurnInput.model` → deps `model` / `leaderModel` / … → Router。
