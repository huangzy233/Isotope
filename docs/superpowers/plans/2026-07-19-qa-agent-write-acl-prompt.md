# QA 质检闭环 + write ACL + Prompt 五段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Engineer/Team 增加 Alex→QA 质检硬环与 `write_file` 路径白名单，并按五段骨架重写 Mike/Pat/Alex/QA prompt，使类型错误可闭环修复、配置文件不可被 coder 误改。

**Architecture:** ACL 挂在 coder `write_file` 端口（yaml allow）；`runTurn` 返回 `writtenPaths`；应用层 `runQualityLoop` 在改码后跑 QA，以 **`run_check` tool 的 exit 结果**判定 PASS/FAIL（不解析 LLM 文案）；PASS 才 `enqueuePreviewBuild`；FAIL 则把 QA 报告注入下一轮 Alex，最多再修 2 次；耗尽则提示用户且跳过 Mike summary。

**Tech Stack:** TypeScript、pnpm workspace、vitest、现有 agent-runtime / agents / application / sandbox / apps/web。

**Spec:** `docs/superpowers/specs/2026-07-19-qa-agent-write-acl-prompt-design.md`

## Global Constraints

- 沟通与用户可见文案：简体中文。
- 依赖方向：`web → application → …`；Agent 不直碰 `data/**`；禁止 TS 硬编码长 Prompt。
- QA **不是** `Task.assignee`；仍为编排阶段。
- `.project/memory/**` 不进 `write_file` allow；记忆专用 tool 仍直写 workspace。
- PASS/FAIL：**编排看 `run_check` 是否成功执行且 exit 0**；QA 文案仅展示/回灌。
- 未调用 `run_check` ⇒ 编排判定 FAIL（文案：「质检未执行 run_check」）。
- `maxRepairRounds = 2`：首次 Alex 之后，因 QA FAIL 再开 Alex 的次数上限为 2。
- **未经用户要求不要 git commit**（下文若有 commit 步骤一律跳过）。
- 外科手术式改动；测试优先（TDD）。

## File Structure

| 路径 | 职责 |
|------|------|
| `configs/workspace/write-policy.yaml` | allow 名单 |
| `packages/application/src/projects/write-policy.ts` | 加载 + glob 匹配 + `createWritePolicyPort` |
| `packages/application/src/projects/write-policy.test.ts` | ACL 单测 |
| `packages/agent-runtime/src/domain/types.ts` | `RunTurnResult.writtenPaths` |
| `packages/agent-runtime/src/app/run-turn.ts` | 收集成功 `write_file` 路径 |
| `packages/agent-runtime/src/app/run-turn.test.ts` | writtenPaths 测 |
| `packages/sandbox/src/domain/types.ts` | `typecheck` API |
| `packages/sandbox/src/infra/local-sandbox.ts` | 实现 `npx tsc -b` |
| `packages/sandbox/src/infra/local-sandbox.test.ts` | typecheck 测（可用 fixture 或 mock spawn） |
| `packages/agents/src/qa/tools.ts` | `run_check` / `read_file` / `list_files` |
| `packages/agents/src/qa/index.ts` | `createQaAgent`、`QA_DISPLAY_NAME` |
| `packages/agents/src/qa/tools.test.ts` | tool 单测 |
| `packages/agents/src/index.ts` | 导出 QA |
| `prompts/review/qa-system.v1.md` | QA 五段 prompt |
| `prompts/review/qa-system.v1.meta.yaml` | model/tools |
| `prompts/coding/alex-system.v1.md` | 五段重写 |
| `prompts/leader/mike-system.v1.md` | 五段重写 |
| `prompts/leader/mike-summary.v1.md` | 极简五段 |
| `prompts/requirement/pat-system.v1.md` | 五段重写（保留示例） |
| `packages/application/src/projects/run-quality-loop.ts` | 共享质检环 |
| `packages/application/src/projects/run-quality-loop.test.ts` | 环测（mock LLM/agent） |
| `packages/application/src/projects/stream-engineer-turn.ts` | 接环；延后 preview |
| `packages/application/src/projects/stream-team-turn.ts` | 接环；FAIL 跳过 summary |
| `packages/application/src/projects/stream-*.test.ts` | 回归 |
| `apps/web/lib/agent.ts` | 装配 QA deps |
| `apps/web/lib/paths.ts` | `writePolicyPath` / configs root |
| `apps/web/lib/sandbox.ts` 或既有 preview 装配 | `runTypecheck(projectId)` |
| `apps/web/components/agent-identity.ts` | `QA` → `质检` |
| `apps/web/app/api/.../stream/route.ts` | speaker 透传 QA（若需） |

**常量（锁定）：**

```ts
export const MAX_REPAIR_ROUNDS = 2;
export const CHECK_LOG_TAIL_CHARS = 4096;
export const QA_DISPLAY_NAME = "QA";
```

**write-policy.yaml（锁定）：**

```yaml
allow:
  - "src/**"
  - "index.html"
```

---

### Task 1: write-policy 加载与端口包装

**Files:**
- Create: `configs/workspace/write-policy.yaml`
- Create: `packages/application/src/projects/write-policy.ts`
- Create: `packages/application/src/projects/write-policy.test.ts`
- Modify: `packages/application/src/index.ts`（若需导出；可不导出）

**Interfaces:**
- Produces:
  ```ts
  export type WritePolicy = { allow: string[] };

  export function loadWritePolicy(filePath: string): WritePolicy;

  /** path 为 workspace 相对路径，正斜杠。 */
  export function isPathAllowed(policy: WritePolicy, relativePath: string): boolean;

  export function createWritePolicyPort<T extends { writeFile(path: string, content: string): void }>(
    policy: WritePolicy,
    port: T,
  ): T;
  ```
- 拒绝时：`throw new Error(\`不允许修改受保护文件：${relativePath}；请只改允许路径（如 src/）\`)`（coder `executeTool` catch → `ok: false`）。

- [ ] **Step 1: 写失败测**

`write-policy.test.ts`：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWritePolicyPort,
  isPathAllowed,
  loadWritePolicy,
} from "./write-policy.js";

describe("write-policy", () => {
  it("allows src and index.html, denies config and memory", () => {
    const policy = { allow: ["src/**", "index.html"] };
    expect(isPathAllowed(policy, "src/App.tsx")).toBe(true);
    expect(isPathAllowed(policy, "src/components/Button.tsx")).toBe(true);
    expect(isPathAllowed(policy, "index.html")).toBe(true);
    expect(isPathAllowed(policy, "vite.config.ts")).toBe(false);
    expect(isPathAllowed(policy, "package.json")).toBe(false);
    expect(isPathAllowed(policy, ".project/memory/decisions.md")).toBe(false);
  });

  it("createWritePolicyPort blocks denied writes", () => {
    const writes: string[] = [];
    const port = createWritePolicyPort(
      { allow: ["src/**", "index.html"] },
      {
        writeFile: (p: string, c: string) => {
          writes.push(p);
        },
      },
    );
    port.writeFile("src/App.tsx", "x");
    expect(writes).toEqual(["src/App.tsx"]);
    expect(() => port.writeFile("vite.config.ts", "x")).toThrow(/不允许修改/);
  });

  it("loadWritePolicy reads yaml allow list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-"));
    const file = path.join(dir, "write-policy.yaml");
    fs.writeFileSync(file, "allow:\n  - \"src/**\"\n  - \"index.html\"\n");
    expect(loadWritePolicy(file).allow).toEqual(["src/**", "index.html"]);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/application test -- src/projects/write-policy.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`configs/workspace/write-policy.yaml`：如上锁定内容。

`write-policy.ts`：用现有依赖解析 yaml（查 monorepo 是否已有 `yaml` 包；`apps/web` / llm 配置加载方式复用）。若 application 无 yaml：加 `yaml` workspace 依赖，或从 web 注入已解析 `WritePolicy`、application 只做 `isPathAllowed` + port——**优先**：application 依赖 `yaml`（与 llm 配置加载一致则跟它）。

匹配实现（无新 glob 库）：

```ts
function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchAllow(pattern: string, rel: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3); // "src"
    return rel === prefix || rel.startsWith(prefix + "/");
  }
  return rel === pattern;
}
```

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/application test -- src/projects/write-policy.test.ts`  
Expected: PASS

---

### Task 2: `runTurn` 收集 `writtenPaths`

**Files:**
- Modify: `packages/agent-runtime/src/domain/types.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.ts`
- Modify: `packages/agent-runtime/src/app/run-turn.test.ts`

**Interfaces:**
- Produces: `RunTurnResult = { assistantText; filesChanged; writtenPaths: string[]; process }`
- `writtenPaths`：本回合 `write_file` 且 `outcome.ok` 的 path，去重保序；从 tool args JSON 解析 `path` 字段。

- [ ] **Step 1: 扩展现有测**

在 `run-turn.test.ts` 的成功 `write_file` 用例中断言：

```ts
expect(result.writtenPaths).toEqual(["src/App.tsx"]);
expect(result.filesChanged).toBe(true);
```

无写文件的用例：`writtenPaths` 为 `[]`。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @isotope/agent-runtime test -- src/app/run-turn.test.ts`  
Expected: FAIL（无 `writtenPaths`）

- [ ] **Step 3: 实现**

在 `run-turn.ts` 维护 `const writtenPaths: string[] = []`；成功 write 时：

```ts
if (call.function.name === "write_file" && outcome.ok) {
  filesChanged = true;
  try {
    const path = JSON.parse(call.function.arguments).path;
    if (typeof path === "string" && path && !writtenPaths.includes(path)) {
      writtenPaths.push(path);
    }
  } catch { /* ignore */ }
}
```

所有 return 带上 `writtenPaths`。

- [ ] **Step 4: 跑测通过**

Run: `pnpm --filter @isotope/agent-runtime test -- src/app/run-turn.test.ts`  
Expected: PASS

---

### Task 3: Sandbox `typecheck`

**Files:**
- Modify: `packages/sandbox/src/domain/types.ts`
- Modify: `packages/sandbox/src/infra/local-sandbox.ts`
- Modify: `packages/sandbox/src/infra/local-sandbox.test.ts`
- Modify: `packages/sandbox/src/index.ts`（若需）

**Interfaces:**
- Produces:
  ```ts
  export type SandboxTypecheckInput = {
    workspaceDir: string;
    timeoutMs?: number; // default 120_000
  };

  export type SandboxTypecheckResult = {
    ok: boolean;
    log: string; // 尾部截断 CHECK_LOG_TAIL_CHARS
  };

  export type Sandbox = {
    build(input: SandboxBuildInput): Promise<void>;
    typecheck(input: SandboxTypecheckInput): Promise<SandboxTypecheckResult>;
  };
  ```
- 实现：按需 `npm install`（与 build 相同条件）→ `npx tsc -b --pretty false`（或 `npm exec -- tsc -b --pretty false`）；不抛，返回 `{ ok: code===0, log }`。
- 复用现有 `runNpm`；可抽 `runCommand`。

- [ ] **Step 1: 写测**

对临时目录写最小会失败的 `tsconfig` + 坏 ts，或 mock——优先用真实小 fixture：

```ts
it("typecheck returns ok:false with log on error", async () => {
  // 准备含错误的迷你 ts 项目，或复用 templates 改一处
  const result = await sandbox.typecheck({ workspaceDir, timeoutMs: 60_000 });
  expect(result.ok).toBe(false);
  expect(result.log.length).toBeGreaterThan(0);
});
```

若 CI 太慢：单测 mock `spawn`；另保留一个可选集成测。P0 允许用 mock 验证参数与 ok 映射，集成测可选。

- [ ] **Step 2: 实现并跑通**

Run: `pnpm --filter @isotope/sandbox test`  
Expected: PASS

---

### Task 4: QA agent 插件

**Files:**
- Create: `packages/agents/src/qa/tools.ts`
- Create: `packages/agents/src/qa/index.ts`
- Create: `packages/agents/src/qa/tools.test.ts`
- Modify: `packages/agents/src/index.ts`
- Create: `prompts/review/qa-system.v1.md`
- Create: `prompts/review/qa-system.v1.meta.yaml`

**Interfaces:**
- Produces:
  ```ts
  export const QA_DISPLAY_NAME = "QA";

  export type QaToolPort = {
    listFiles(relativeDir?: string): string[];
    readFile(relativePath: string): string;
    runCheck(): { ok: boolean; log: string }; // sync OK if sandbox async wrapped at call site
  };
  ```
  若 sandbox 异步：port 用同步包装不可行 → **`runCheck(): Promise<{ok,log}>` 不行**（现有 `executeTool` 同步）。

  **锁定：** `executeTool` 保持同步；`runCheck` 在 port 上为同步，由 application 在调 `runTurn` 前把异步 typecheck 结果缓存进闭包 **不可**——必须先扩展 runtime 支持 async tools，或 QA 的 `run_check` 在 application 外预跑。

  **P0 选定（简单、与 spec 编排权威一致）：**

  方案 **编排预跑 typecheck + QA 只读报告** 会削弱「QA 必调 run_check」。

  方案 **`run_check` 同步调用已注入的 `() => SandboxTypecheckResult`，web 装配时用 `deasync` 禁止**。

  **选定：扩展 `executeTool` / `runTurn` 支持 async executeTool（Promise）。**  
  若改动面过大：**P0 折中**——`QaToolPort.runCheck` 同步，application 传入：

  ```ts
  let last: { ok: boolean; log: string } | null = null;
  // 在 QA runTurn 之前不预跑；
  // port.runCheck = () => { throw if not set };
  ```

  查 `run-turn.ts`：`executeTool` 目前同步。最小改动：

  ```ts
  const outcome = await Promise.resolve(agent.executeTool(...));
  ```

  Agent 的 `executeTool` 返回类型改为可返回 `Promise<...>`。Coder/Leader/Pat 仍同步返回；QA 的 `run_check` case `return await port.runCheck()` 若 port 异步则：

  ```ts
  export type QaToolPort = {
    listFiles(...): string[];
    readFile(...): string;
    runCheck(): Promise<{ ok: boolean; log: string }> | { ok: boolean; log: string };
  };
  ```

  并在 `executeTool` 标 `async`，`runTurn` 已有 async 循环则 `await executeTool`。

- [ ] **Step 1: 改 runtime 支持 await executeTool**（可并入本 Task 或极小先行）

`run-turn.ts`：`const outcome = await Promise.resolve(agent.executeTool(...))`。

- [ ] **Step 2: QA tools + 测**

```ts
// tools.test.ts
it("run_check returns log", async () => {
  const r = await executeQaTool("run_check", "{}", {
    listFiles: () => [],
    readFile: () => "",
    runCheck: async () => ({ ok: false, log: "error TS" }),
  });
  expect(r.ok).toBe(true);
  expect(r.result).toContain("ok: false");
  expect(r.result).toContain("error TS");
});
```

`run_check` 成功调用时 result JSON：`{"ok":false,"log":"..."}` 以便编排解析。

- [ ] **Step 3: prompt + meta**

`qa-system.v1.meta.yaml`：

```yaml
id: review/qa-system
version: v1
tools:
  - run_check
  - read_file
  - list_files
```

`qa-system.v1.md`：按 spec §8.3 五段 + 报告格式 + 否定式。

- [ ] **Step 4: 导出并跑测**

Run: `pnpm --filter @isotope/agents test`  
Expected: PASS

---

### Task 5: `runQualityLoop` 共享编排

**Files:**
- Create: `packages/application/src/projects/run-quality-loop.ts`
- Create: `packages/application/src/projects/run-quality-loop.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_REPAIR_ROUNDS = 2;

  export type QualityLoopResult = {
    passed: boolean;
    writtenPaths: string[];
    qaReport: string | null; // 最后一轮 QA 文本
    repairRoundsUsed: number;
    /** 是否应 enqueue preview */
    shouldEnqueuePreview: boolean;
  };

  export async function runQualityLoop(input: {
    projectId: string;
    ownerUserId: string;
    /** 已完成的首次 Alex 结果 */
    initial: { writtenPaths: string[]; assistantText: string };
    maxRepairRounds?: number; // default 2
    runAlexRepair: (extraUserContent: string) => Promise<{
      writtenPaths: string[];
      assistantText: string;
    }>;
    runQa: (changedPaths: string[]) => Promise<{
      assistantText: string;
      checkRan: boolean;
      checkOk: boolean;
    }>;
    onQaMessage?: (text: string) => void; // 可选：已写入消息后回调
  }): Promise<QualityLoopResult>;
  ```

**算法：**

```text
paths = unique(initial.writtenPaths)
if paths.length === 0 → { passed: true, shouldEnqueuePreview: false, ... }

repair = 0
loop:
  qa = await runQa(paths)
  passed = qa.checkRan && qa.checkOk
  if passed → return { passed: true, shouldEnqueuePreview: true, qaReport: qa.assistantText, repairRoundsUsed: repair }
  if repair >= maxRepairRounds → return { passed: false, shouldEnqueuePreview: false, qaReport: ... }
  alex = await runAlexRepair(qa.assistantText 或标准【质检结果】包装)
  paths = unique(paths + alex.writtenPaths)
  repair++
```

- [ ] **Step 1: 单测（mock）**

```ts
it("passes on first QA checkOk", async () => {
  const r = await runQualityLoop({
    projectId: "p",
    ownerUserId: "u",
    initial: { writtenPaths: ["src/App.tsx"], assistantText: "done" },
    runAlexRepair: async () => { throw new Error("should not repair"); },
    runQa: async () => ({
      assistantText: "【质检结果】PASS\n检查：typecheck\n问题：无",
      checkRan: true,
      checkOk: true,
    }),
  });
  expect(r.passed).toBe(true);
  expect(r.shouldEnqueuePreview).toBe(true);
});

it("repairs then passes", async () => { /* QA fail once then ok */ });
it("exhausts repairs without preview", async () => { /* always fail */ });
it("skips when no written paths", async () => { /* no runQa */ });
```

- [ ] **Step 2: 实现并 PASS**

Run: `pnpm --filter @isotope/application test -- src/projects/run-quality-loop.test.ts`

---

### Task 6: 接入 Engineer turn

**Files:**
- Modify: `packages/application/src/projects/stream-engineer-turn.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.test.ts`
- Modify: deps 类型（同文件内 `EngineerTurnDeps`）

**Interfaces:**
- `EngineerTurnDeps` 增加：
  ```ts
  writePolicy: WritePolicy;
  qa: QaAgent; // TurnAgent
  qaModel: string;
  runTypecheck: (projectId: string) => Promise<{ ok: boolean; log: string }>;
  ```
- 流程：
  1. Alex `runTurn` 用 `createWritePolicyPort(policy, createPlanGatedWritePort(...))`（顺序：Plan 先于 ACL，或 ACL 在外——**锁定：外层 Plan，内层 ACL**，与「未确认禁止」一致：`createPlanGatedWritePort(project, createWritePolicyPort(policy, base))`）。
  2. **移除** Alex 成功后立即 `enqueuePreviewBuild`。
  3. 若 `writtenPaths.length`：跑 `runQualityLoop`；`runQa` 内 appendMessage agentName `QA`、publish speaker、history 注入 `【本轮变更】`、port.runCheck → `runTypecheck`；从 tool 事件或 port 包装追踪 `checkRan/checkOk`。
  4. `shouldEnqueuePreview` 时再 enqueue。
  5. 未通过：最终 assistant/系统可见 QA 报告（已有 QA 消息即可）；`done.filesChanged` 语义保持「曾改文件」；可加 `previewEnqueued: false`。

**追踪 checkRan/checkOk：**

```ts
let checkRan = false;
let checkOk = false;
const qaPort = {
  listFiles: ...,
  readFile: ...,
  runCheck: async () => {
    checkRan = true;
    const r = await deps.runTypecheck(projectId);
    checkOk = r.ok;
    return r;
  },
};
```

- [ ] **Step 1: 测——mock QA pass 才 enqueue**

扩展 engineer 测：写文件后 preview enqueue 次数在 QA pass 为 1；QA 耗尽为 0。

- [ ] **Step 2: 实现接入**

- [ ] **Step 3: 跑** `pnpm --filter @isotope/application test -- src/projects/stream-engineer-turn.test.ts`

---

### Task 7: 接入 Team turn

**Files:**
- Modify: `packages/application/src/projects/stream-team-turn.ts`
- Modify: `packages/application/src/projects/stream-team-turn.test.ts`

**Interfaces:**
- `TeamTurnDeps` 同样增加 `writePolicy`、`qa`、`qaModel`、`runTypecheck`。
- `TeamTurnEvent` speaker：`"Mike" | "Alex" | "QA"`。
- `runAlexForTask`：挂 ACL；**去掉**内部立即 enqueue；返回 `writtenPaths`。
- Alex 后：`runQualityLoop`；仅 `shouldEnqueuePreview` 时 enqueue。
- `passed === false`：**不调用** `maybeRunMikeSummary`。
- `passed === true` 或无改文件：保持现有 summary 条件。

- [ ] **Step 1: 测**

- QA FAIL 耗尽：无 summary 消息、无 preview。  
- QA PASS：有 preview（若 filesChanged）、可有 summary。

- [ ] **Step 2: 实现并跑测**

Run: `pnpm --filter @isotope/application test -- src/projects/stream-team-turn.test.ts`

---

### Task 8: Web 装配 + UI 身份

**Files:**
- Modify: `apps/web/lib/paths.ts` — `writePolicyPath()` → `configs/workspace/write-policy.yaml`
- Modify: `apps/web/lib/agent.ts` — `createTurnDeps` / `createTeamTurnDeps` 加载 policy、QA bundle、`createQaAgent`
- Modify: preview/sandbox 装配处 — 实现 `runTypecheck(projectId)`（解析 workspaceDir，调 `sandbox.typecheck`）
- Modify: `apps/web/components/agent-identity.ts` — `QA` → `质检`
- Modify: stream route / workbench 若 agentName 联合类型需含 `QA`

- [ ] **Step 1: 装配编译通过**

Run: `pnpm --filter @isotope/web typecheck`（或 repo 等价命令）

- [ ] **Step 2: agent-identity 单测或手工断言**

```ts
expect(agentRoleLabel("QA")).toBe("质检");
```

---

### Task 9: 重写各角色 Prompt（五段）

**Files:**
- Modify: `prompts/coding/alex-system.v1.md`
- Modify: `prompts/leader/mike-system.v1.md`
- Modify: `prompts/leader/mike-summary.v1.md`
- Modify: `prompts/requirement/pat-system.v1.md`
- （Task 4 已建 QA；本 Task 可再润色）

按 spec §8 写入五段标题，例如：

```markdown
## 身份
...
## 职责
...
## 流程
...
## 上下文
...
## 交流
...
## 不要
- ...
```

Pat **保留**选项提问示例代码块。  
无自动化测：依赖人工过目 + 既有 loader 测仍能 load。

- [ ] **Step 1: 改写四个 md**
- [ ] **Step 2:** `pnpm --filter @isotope/web test -- lib/prompt-loader.test.ts`（若有）仍 PASS

---

### Task 10: 端到端回归与 AC 核对

- [ ] **Step 1: 跑相关包测试**

```bash
pnpm --filter @isotope/agent-runtime test
pnpm --filter @isotope/agents test
pnpm --filter @isotope/sandbox test
pnpm --filter @isotope/application test
```

- [ ] **Step 2: 对照 spec §10 AC 清单逐条打勾**（文档注释或 PR 描述）

| AC | 覆盖 Task |
|----|-----------|
| ACL 拒配置/memory，允 src | 1, 6 |
| remember_decision 仍可写 | 6（不经 ACL） |
| Engineer 质检环 + preview 时机 | 5, 6 |
| Team 环 + 跳过 summary | 5, 7 |
| 无改文件不跑 QA | 5 |
| QA 报告格式 | 4, 9 |
| Prompt 五段 | 9 |

---

## Spec coverage self-check

| Spec 项 | Task |
|---------|------|
| 方案 A 硬环 | 5–7 |
| Engineer 过 QA | 6 |
| 重试 2、耗尽提示不 failed | 5–7 |
| 不 preview / 跳过 Mike summary | 6–7 |
| yaml ACL | 1, 8 |
| memory 不进 allow | 1 |
| writtenPaths 注入 | 2, 5–7 |
| run_check typecheck | 3–4 |
| 编排权威判定 | 5 |
| Prompt 五段全角色 | 4, 9 |
| UI QA 标签 | 8 |

## Placeholder scan

无 TBD；`run_check` 异步路径已锁定为 `await Promise.resolve(executeTool)`。

## Type consistency

- `QA_DISPLAY_NAME = "QA"` 与 speaker / `agentName` 一致。  
- `WritePolicy` / `MAX_REPAIR_ROUNDS` 单处定义。  
- `RunTurnResult.writtenPaths` 全调用点更新。
