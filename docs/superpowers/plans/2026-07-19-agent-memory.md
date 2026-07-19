# Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地短期 `buildTurnContext` 窗口压缩，以及长期 Preference（DB）+ Product Spec / Decision（`.project/memory`），并确定性注入每回合 LLM context。

**Architecture:** `@isotope/memory` 管用户 Preference；项目 Spec/Decision 经 workspace 写 `.project/memory/*`；`application.buildTurnContext` 统一组装 history；`runTurn` 截断超大 tool result；Alex/Mike 挂 `set_preference` / `remember_decision`；Pat 确认时双写 `product-spec.md`。

**Tech Stack:** TypeScript、pnpm workspace、better-sqlite3、vitest、现有 agent-runtime tool loop。

**Spec:** `docs/superpowers/specs/2026-07-19-agent-memory-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖：`web → application → memory|workspace|agent-runtime|agents|llm`；Agent 不直碰 `data/**`；禁止 TS 硬编码长 Prompt。
- Preference **唯一**落库长期记忆；Spec/Decision **只**在 `.project/memory/`。
- 无向量检索；无静默全文挖记忆。
- 去掉每回合单独 unshift `【已确认需求】`；并入 `【记忆】` 合成块。
- **未经用户要求不要 git commit**（下文 commit 步骤一律跳过）。
- 外科手术式改动；测试优先。

## File Structure

| 路径 | 职责 |
|------|------|
| `packages/memory/package.json` | 加 sqlite / vitest 依赖与 test 脚本 |
| `packages/memory/src/domain/types.ts` | `PreferenceKey`、白名单 |
| `packages/memory/src/infra/db.ts` | 打开同库 `isotope.sqlite`，建 `user_preferences` |
| `packages/memory/src/app/preference-store.ts` | `createPreferenceStore` |
| `packages/memory/src/app/preference-store.test.ts` | 隔离 / 白名单 / upsert |
| `packages/memory/src/index.ts` | 导出 |
| `packages/application/src/projects/project-memory-paths.ts` | 路径常量 |
| `packages/application/src/projects/build-turn-context.ts` | 窗口 + 记忆注入 |
| `packages/application/src/projects/build-turn-context.test.ts` | 组装单测 |
| `packages/application/src/projects/write-product-spec.ts` | 写 `product-spec.md` |
| `packages/application/src/projects/append-decision.ts` | 追加 `decisions.md` |
| `packages/application/src/projects/stream-plan-turn.ts` | 确认时双写 Spec |
| `packages/application/src/projects/stream-engineer-turn.ts` | 用 `buildTurnContext`；挂 memory port |
| `packages/application/src/projects/stream-team-turn.ts` | 同上 |
| `packages/application/package.json` | 依赖 `@isotope/memory` |
| `packages/application/src/index.ts` | 按需导出 |
| `packages/agents/src/coder/tools.ts` | `set_preference` / `remember_decision` |
| `packages/agents/src/coder/index.ts` | 扩展 `CoderToolPort` |
| `packages/agents/src/leader/tools.ts` | `remember_decision`（+ 可选 `set_preference`） |
| `packages/agents/src/leader/index.ts` | 扩展 port |
| `packages/agent-runtime/src/app/run-turn.ts` | tool result 截断 |
| `packages/agent-runtime/src/app/run-turn.test.ts` | 截断测 |
| `apps/web/lib/memory.ts` | `getPreferenceStore` 单例 |
| `apps/web/lib/agent.ts` | meta 增加新 tools |
| `prompts/coding/alex-system.v1.meta.yaml` | tools 列表 |
| `prompts/leader/mike-system.v1.meta.yaml` | tools 列表（若存在） |
| `docs/architecture/PROJECT_SKELETON.md` | memory 一行从「骨架」改为 Preference 落库说明 |

**常量（锁定）：**

```ts
export const PRODUCT_SPEC_PATH = ".project/memory/product-spec.md";
export const DECISIONS_PATH = ".project/memory/decisions.md";
export const HISTORY_WINDOW_N = 20;
export const DECISIONS_TAIL_K = 20;
export const DIGEST_MAX_CHARS = 2000;
export const TOOL_RESULT_MAX_CHARS = 8000;
export const PREFERENCE_VALUE_MAX = 500;
```

**Preference keys（锁定）：** `ui_language` | `explanation_verbosity` | `code_style_notes`

---

### Task 1: `@isotope/memory` PreferenceStore

**Files:**
- Modify: `packages/memory/package.json`
- Create: `packages/memory/src/domain/types.ts`
- Create: `packages/memory/src/infra/db.ts`
- Create: `packages/memory/src/app/preference-store.ts`
- Create: `packages/memory/src/app/preference-store.test.ts`
- Modify: `packages/memory/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PreferenceKey =
    | "ui_language"
    | "explanation_verbosity"
    | "code_style_notes";

  export const PREFERENCE_KEYS: readonly PreferenceKey[];

  export function isPreferenceKey(k: string): k is PreferenceKey;

  export type PreferenceStore = {
    getPreferences(userId: string): Partial<Record<PreferenceKey, string>>;
    upsertPreference(
      userId: string,
      key: PreferenceKey,
      value: string,
    ): void;
  };

  export function createPreferenceStore(opts: {
    dataRoot: string;
  }): PreferenceStore;
  ```

- [ ] **Step 1: 写失败测**

`packages/memory/src/app/preference-store.test.ts`：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPreferenceStore } from "./preference-store.js";

describe("PreferenceStore", () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-mem-"));
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("isolates preferences by userId", () => {
    const store = createPreferenceStore({ dataRoot });
    store.upsertPreference("a", "ui_language", "zh");
    store.upsertPreference("b", "ui_language", "en");
    expect(store.getPreferences("a").ui_language).toBe("zh");
    expect(store.getPreferences("b").ui_language).toBe("en");
  });

  it("rejects unknown key via isPreferenceKey guard in upsert callers", () => {
    const store = createPreferenceStore({ dataRoot });
    expect(() =>
      store.upsertPreference("a", "not_a_key" as "ui_language", "x"),
    ).not.toThrow(); // 类型层拒绝；运行时 upsert 仅接受 PreferenceKey
    // 运行时校验放在 agent tool；此处测覆盖：
    store.upsertPreference("a", "code_style_notes", "prefer const");
    expect(store.getPreferences("a").code_style_notes).toBe("prefer const");
    store.upsertPreference("a", "code_style_notes", "prefer let");
    expect(store.getPreferences("a").code_style_notes).toBe("prefer let");
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/memory test`  
Expected: FAIL（无实现 / 无 test 脚本）

- [ ] **Step 3: 实现**

`package.json` 增加依赖 `better-sqlite3`、`@types/better-sqlite3`、vitest、typescript、`@types/node`；scripts：`"test": "vitest run"`。

`db.ts`：打开 `path.join(dataRoot, "isotope.sqlite")`，`CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, key))`。

`preference-store.ts`：`upsert` 用 `INSERT ... ON CONFLICT DO UPDATE`；`getPreferences` 返回该用户所有行映射到 Partial Record；value trim，空串拒绝 throw 或 no-op——锁定 **trim 后空则 throw Error("value empty")**；长度 > 500 则截断或 throw——锁定 **throw Error("value too long")**。

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/memory test`  
Expected: PASS

- [ ] **Step 5: Commit**（跳过，除非用户要求）

---

### Task 2: 项目 memory 路径 + 写 Spec / 追加 Decision

**Files:**
- Create: `packages/application/src/projects/project-memory-paths.ts`
- Create: `packages/application/src/projects/write-product-spec.ts`
- Create: `packages/application/src/projects/append-decision.ts`
- Create: `packages/application/src/projects/project-memory-files.test.ts`
- Modify: `packages/application/package.json`（加 `@isotope/memory`）

**Interfaces:**
- Produces:
  ```ts
  // project-memory-paths.ts
  export const PRODUCT_SPEC_PATH = ".project/memory/product-spec.md";
  export const DECISIONS_PATH = ".project/memory/decisions.md";

  // write-product-spec.ts
  export function writeProductSpec(
    workspace: WorkspaceStore,
    projectId: string,
    summary: string,
  ): void; // writeFile PRODUCT_SPEC_PATH, content = summary.trim() + "\n"

  // append-decision.ts
  export function appendDecision(
    workspace: WorkspaceStore,
    projectId: string,
    text: string,
    nowIso?: string,
  ): void;
  // 读旧（缺文件当 ""），追加：
  // `\n## ${nowIso}\n${text.trim()}\n`
  ```

- [ ] **Step 1: 写失败测**

```ts
it("writeProductSpec creates product-spec.md", () => {
  // createProject → writeProductSpec → readFile 等于摘要+"\n"
});

it("appendDecision appends dated sections", () => {
  appendDecision(ws, id, "用本地存储", "2026-07-19T00:00:00.000Z");
  appendDecision(ws, id, "不做登录", "2026-07-19T01:00:00.000Z");
  const body = ws.readFile(id, DECISIONS_PATH);
  expect(body).toContain("## 2026-07-19T00:00:00.000Z");
  expect(body).toContain("用本地存储");
  expect(body).toContain("不做登录");
});
```

- [ ] **Step 2: 跑测失败 → Step 3 实现 → Step 4 通过**

Run: `pnpm --filter @isotope/application test project-memory-files`

- [ ] **Step 5: Commit**（跳过）

---

### Task 3: `buildTurnContext`

**Files:**
- Create: `packages/application/src/projects/build-turn-context.ts`
- Create: `packages/application/src/projects/build-turn-context.test.ts`

**Interfaces:**
- Consumes: `PRODUCT_SPEC_PATH`, `DECISIONS_PATH`, `PreferenceStore`, `Message`, `Project`
- Produces:
  ```ts
  export type BuildTurnContextInput = {
    messages: Message[];
    project: Project;
    preferences: Partial<Record<PreferenceKey, string>>;
    readProjectFile: (relativePath: string) => string | null; // 不存在 → null
    windowN?: number;       // default 20
    decisionsTailK?: number; // default 20
    digestMaxChars?: number; // default 2000
  };

  export type TurnContext = {
    history: Array<{ role: "user" | "assistant"; content: string }>;
  };

  export function buildTurnContext(input: BuildTurnContextInput): TurnContext;
  ```

**组装算法（锁定）：**

1. 过滤 `user|assistant` 且 `content !== ASSISTANT_PLACEHOLDER`。
2. map：assistant 若有 `agentName`，`content = `[${agentName}] ${content}``。
3. 若长度 > N：`older = all.slice(0, -N)`，`recent = all.slice(-N)`；否则 `recent = all`，无 digest。
4. digest：把 older 压成一行文本 `role: content` 拼接，超 `digestMaxChars` 则尾部截断加 `…`；合成 `{ role: "user", content: "【对话摘要】\n" + digest }`。
5. 记忆块字符串：
   - Pref 段：非空 key 列表 `"- key: value"`，有则加 `### 用户偏好\n...`
   - Spec：`readProjectFile(PRODUCT_SPEC_PATH)` ?? `project.confirmedRequirement`；有则 `### 产品规格\n...`
   - Decisions：读文件，按 `/^## /m` 分块取尾 K；有则 `### 决策\n...`
   - 若任一段非空：首条 `{ role: "user", content: "【记忆】\n" + parts.join("\n\n") }`
6. `history = [...memory?, ...digest?, ...recent]`
7. **不**再单独插入 `【已确认需求】`。

- [ ] **Step 1: 单测覆盖**

```ts
it("filters placeholder and process is irrelevant (content only)");
it("prefixes agentName on assistant lines");
it("windows to N and inserts digest for older");
it("injects memory block with pref + spec file + decisions tail");
it("falls back to confirmedRequirement when spec file missing");
it("omits memory block when empty");
it("does not insert 【已确认需求】 prefix");
```

- [ ] **Step 2–4: 红 → 绿**

Run: `pnpm --filter @isotope/application test build-turn-context`

- [ ] **Step 5: Commit**（跳过）

---

### Task 4: Plan 确认双写 + 三路 turn 改用 `buildTurnContext`

**Files:**
- Modify: `packages/application/src/projects/stream-plan-turn.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-team-turn.ts`
- Modify: `packages/application/src/projects/stream-plan-turn.test.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.test.ts`
- Modify: deps 类型：各 `begin*Turn` deps 增加可选/必选 `preferences: PreferenceStore`（P0 **必选**，测试传入内存/临时 store）

**Interfaces:**
- `beginEngineerTurn` / `beginTeamTurn` / `beginPlanTurn` deps:
  ```ts
  preferences: PreferenceStore;
  // ownerUserId 已有 → getPreferences(ownerUserId)
  ```

- [ ] **Step 1: Plan 确认双写测**

在 `stream-plan-turn.test.ts`：mock `confirm_requirement` 成功后：

```ts
expect(workspace.readFile(project.id, PRODUCT_SPEC_PATH)).toContain(
  summary.trim(),
);
```

并断言后续 engineer silentHandoff 捕获的 messages **含**规格内容，且 **不含** 独立前缀 `【已确认需求】`（可含在 `【记忆】` 内）。

- [ ] **Step 2: 改 `confirmRequirement` port**

```ts
confirmRequirement(summary: string) {
  // 现有 updateProjectMeta...
  writeProductSpec(deps.workspace, input.projectId, summary);
  ...
}
```

- [ ] **Step 3: 替换 history 组装**

删除 `historyForProject` 内 `confirmedRequirement` unshift；engineer/plan/team 改为：

```ts
const { history } = buildTurnContext({
  messages: deps.workspace.listMessages(input.projectId),
  project: deps.workspace.getProject(input.projectId) ?? owned,
  preferences: deps.preferences.getPreferences(input.ownerUserId),
  readProjectFile: (p) => {
    try {
      return deps.workspace.readFile(input.projectId, p);
    } catch {
      return null;
    }
  },
});
```

（若 `readFile` 抛错而非返回——查 workspace 实现；不存在时应返回 null 或捕获。）

- [ ] **Step 4: 更新所有 turn 测试的 deps**，传入 `createPreferenceStore({ dataRoot: tmp })` 或测试用 fake：

```ts
const preferences: PreferenceStore = {
  getPreferences: () => ({}),
  upsertPreference: () => {},
};
```

- [ ] **Step 5: 跑相关测**

Run: `pnpm --filter @isotope/application test`

Expected: PASS

- [ ] **Step 6: Commit**（跳过）

---

### Task 5: Agent tools — `set_preference` / `remember_decision`

**Files:**
- Modify: `packages/agents/src/coder/tools.ts`
- Modify: `packages/agents/src/coder/index.ts`
- Modify: `packages/agents/src/leader/tools.ts`
- Modify: `packages/agents/src/leader/index.ts`
- Modify: `packages/agents/src/index.ts`（导出新类型）
- Create/Modify: tools 单测
- Modify: `prompts/coding/alex-system.v1.meta.yaml` — tools 加 `set_preference`, `remember_decision`
- Modify: leader meta yaml 加 `remember_decision`（及 `set_preference` 若挂载）
- Modify: stream-engineer-turn / stream-team-turn 组装 port

**Interfaces:**
- Produces:
  ```ts
  export type CoderToolPort = WorkspaceToolPort & {
    setPreference(
      key: string,
      value: string,
    ): { ok: true } | { ok: false; error: string };
    rememberDecision(
      text: string,
    ): { ok: true } | { ok: false; error: string };
  };

  // LeaderTaskPort / TaskToolPort 扩展 rememberDecision（+ setPreference 同 Alex）
  ```

- Tool 定义：

```ts
{
  name: "set_preference",
  description: "Save a user preference for future projects (ui_language | explanation_verbosity | code_style_notes).",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", enum: ["ui_language", "explanation_verbosity", "code_style_notes"] },
      value: { type: "string" },
    },
    required: ["key", "value"],
  },
},
{
  name: "remember_decision",
  description: "Append a product decision to project long-term memory.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "One-line decision." },
    },
    required: ["text"],
  },
},
```

- `executeTool` switch 调用 `port.setPreference` / `port.rememberDecision`。
- application 组装：

```ts
setPreference(key, value) {
  if (!isPreferenceKey(key)) return { ok: false, error: "unknown key" };
  try {
    deps.preferences.upsertPreference(input.ownerUserId, key, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: ... };
  }
},
rememberDecision(text) {
  try {
    appendDecision(deps.workspace, input.projectId, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: ... };
  }
},
```

- [ ] **Step 1: agents 单测**（未知 key、成功调用 port）
- [ ] **Step 2: application 集成测** — send 回合 mock tool `remember_decision` → 文件存在；`set_preference` → 另一 `getPreferences` 可读
- [ ] **Step 3: 更新 meta.yaml tools 列表**（否则 `filterTools` 会剥掉）
- [ ] **Step 4: 跑测**

Run: `pnpm --filter @isotope/agents test && pnpm --filter @isotope/application test`

- [ ] **Step 5: Commit**（跳过）

---

### Task 6: `runTurn` tool result 截断

**Files:**
- Modify: `packages/agent-runtime/src/app/run-turn.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.test.ts`
- Optional: `packages/agent-runtime/src/domain/types.ts` 增加 `toolResultMaxChars?: number`（默认 8000）

**实现：**

```ts
function clipToolContent(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + "\n…(已截断，可再 read_file)";
}
```

在 `messages.push({ role: "tool", ... content: clipToolContent(...) })` 使用。

- [ ] **Step 1: 测** — mock tool 返回 9000 字符；捕获 llm 第二次 `complete` 的 messages，断言 tool content 含截断标记且 length 合理
- [ ] **Step 2–4: 红 → 实现 → 绿**

Run: `pnpm --filter @isotope/agent-runtime test`

- [ ] **Step 5: Commit**（跳过）

---

### Task 7: Web 接线

**Files:**
- Create: `apps/web/lib/memory.ts`
- Modify: `apps/web/app/api/projects/[id]/messages/stream/route.ts`（传入 `preferences: getPreferenceStore()`）
- Modify: 任何其它调用 `begin*Turn` 的入口

```ts
// apps/web/lib/memory.ts
import { createPreferenceStore, type PreferenceStore } from "@isotope/memory";
import { dataRoot } from "./paths";

let store: PreferenceStore | null = null;
export function getPreferenceStore(): PreferenceStore {
  if (!store) store = createPreferenceStore({ dataRoot: dataRoot() });
  return store;
}
```

确认 `apps/web/package.json` / 依赖图能解析 `@isotope/memory`（经 application 传递即可；若 route 直接 import memory，给 web 加 dependency）。

- [ ] **Step 1: typecheck**

Run: `pnpm --filter @isotope/web typecheck`（或仓库惯用命令）

Expected: PASS

- [ ] **Step 2: Commit**（跳过）

---

### Task 8: 骨架文档一行 + 全量验证

**Files:**
- Modify: `docs/architecture/PROJECT_SKELETON.md` — `packages/memory` 描述改为「用户 Preference 落库；项目 Spec/Decision 在 workspace `.project/memory`」

- [ ] **Step 1: 跑全量相关测**

```bash
pnpm --filter @isotope/memory test
pnpm --filter @isotope/agent-runtime test
pnpm --filter @isotope/agents test
pnpm --filter @isotope/application test
```

Expected: PASS

- [ ] **Step 2: 自检 spec 覆盖**

| Spec 要求 | Task |
|-----------|------|
| PreferenceStore + 隔离 | 1 |
| product-spec / decisions 文件 | 2 |
| buildTurnContext 窗口/记忆块 | 3 |
| 确认双写 + 三路接入 | 4 |
| set_preference / remember_decision | 5 |
| tool 截断 | 6 |
| web 接线 | 7 |

- [ ] **Step 3: Commit**（跳过）

---

## Spec Coverage Check

- Preference 落库、白名单 3 key、用户隔离 → Task 1/5/7  
- `.project/memory/product-spec.md` + Plan 双写 → Task 2/4  
- `decisions.md` 追加 + 注入尾 K → Task 2/3/5  
- 短期窗口 N + 摘要 + 去 `【已确认需求】` → Task 3/4  
- tool result 截断 → Task 6  
- 无向量 / 无 UI 面板 → 不做  

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-agent-memory.md`. Two execution options:

1. **Subagent-Driven（推荐）** — 每任务新鲜子代理 + 任务间审查  
2. **Inline Execution** — 本会话按 executing-plans 批量执行并设检查点  

Which approach?
