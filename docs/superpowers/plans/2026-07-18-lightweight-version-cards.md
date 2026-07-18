# Lightweight Version Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 改码构建成功后，聊天流出现持久化「版本 N」卡片（LLM/兜底摘要）。

**Architecture:** `workspace` 存 versions + pending + message.version_id；`preview` fire-and-forget `onBuildComplete`；`application` takePending → LLM 摘要 → recordVersion + appendMessage；web `VersionCard` + ready 后 refetch messages。

**Tech Stack:** TypeScript, better-sqlite3, vitest, Next.js, shadcn, `@isotope/llm`

## Global Constraints

- 用户可见文案：简体中文
- Prompt 放 `prompts/`，禁止硬编码摘要模板正文
- Agent 不直接碰 `data/**`
- 不做 git 回滚 / 点卡切预览；`snapshotRef` 恒 null
- 仅 `filesChanged` enqueue 路径登记 pending；手动 build/ensure 不建版本

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/workspace/src/domain/types.ts` | `Version` + `Message.versionId` / `versionNumber` |
| `packages/workspace/src/infra/db.ts` | versions / pending / version_id 迁移 |
| `packages/workspace/src/app/workspace-store.ts` | pending + recordVersion + listMessages join |
| `packages/preview/src/domain/types.ts` | `BuildCompleteResult` + opts hook 类型 |
| `packages/preview/src/app/preview-service.ts` | fire-and-forget onBuildComplete |
| `packages/application/src/projects/enqueue-preview-build.ts` | 可选登记 pending |
| `packages/application/src/projects/record-version-on-build.ts` | 成功/失败处理 + LLM 摘要 |
| `packages/application/src/projects/summarize-version.ts` | 摘要生成（LLM + 兜底） |
| `prompts/workspace/version-summary.v1.md` | 摘要 prompt |
| `apps/web/lib/preview.ts` | 注册 onBuildComplete |
| `apps/web/components/version-card.tsx` | VersionCard UI |
| `apps/web/components/workbench-shell.tsx` | 渲染 + refetch |

---

### Task 1: workspace versions + pending

**Files:**
- Modify: `packages/workspace/src/domain/types.ts`
- Modify: `packages/workspace/src/infra/db.ts`
- Modify: `packages/workspace/src/app/workspace-store.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/src/app/workspace-store.test.ts`

**Interfaces:**
- Produces:
  - `Version = { id, projectId, number, summary, previewRevision?: string | null, snapshotRef?: string | null, createdAt }`
  - `Message.versionId?`, `Message.versionNumber?`
  - `upsertPendingVersionIntent(projectId): void`
  - `takePendingVersionIntent(projectId): boolean` (true if had pending)
  - `recordVersion(input: { projectId, summary, previewRevision?: string | null }): Version`
  - `appendMessage({ ..., versionId?: string | null })`
  - `listMessages` joins `version.number` → `versionNumber`

- [ ] **Step 1: Write failing tests** for pending upsert/take、recordVersion 递增、appendMessage+listMessages 带 versionId/versionNumber、deleteProject 清理

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @isotope/workspace test -- workspace-store.test.ts`

- [ ] **Step 3: Implement db + store + types**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(workspace): add versions and pending version intents`

---

### Task 2: preview onBuildComplete

**Files:**
- Modify: `packages/preview/src/domain/types.ts`
- Modify: `packages/preview/src/app/preview-service.ts`
- Modify: `packages/preview/src/index.ts` (if needed)
- Test: `packages/preview/src/app/preview-service.test.ts`

**Interfaces:**
- Produces: `createPreviewService({ onBuildComplete?: (projectId, { ok, revision, error }) => void })`
- Hook 在 writeStatus ready/failed **之后** fire-and-forget（`void Promise.resolve().then(() => cb(...)).catch(() => {})`）

- [ ] **Step 1: Write failing tests** — ready 与 failed 各触发一次；callback throw 不破坏 queue

- [ ] **Step 2–4: Implement + pass**

- [ ] **Step 5: Commit** `feat(preview): fire onBuildComplete after build terminal state`

---

### Task 3: application record version + enqueue pending

**Files:**
- Create: `packages/application/src/projects/summarize-version.ts`
- Create: `packages/application/src/projects/record-version-on-build.ts`
- Modify: `packages/application/src/projects/enqueue-preview-build.ts`
- Modify: `packages/application/src/projects/stream-engineer-turn.ts` / `stream-team-turn.ts`（若 pending 放在 enqueue 内则可能无需改 turn，只要 enqueue 带 `recordVersionIntent: true`）
- Modify: `packages/application/src/index.ts`
- Create: `prompts/workspace/version-summary.v1.md`
- Test: `packages/application/src/projects/record-version-on-build.test.ts`（+ 更新 preview.test mock 若类型变）

**Interfaces:**
- `enqueuePreviewBuild(input, workspace, preview, opts?: { recordVersionIntent?: boolean })`
  - `recordVersionIntent: true` 时先 upsert pending 再 enqueue
- `handlePreviewBuildComplete({ projectId, ok, revision }, workspace, llm, opts: { promptTemplate: string })`
  - fail → takePending discard
  - ok → takePending；无则 return；有则 summarize → recordVersion → appendMessage(system)

**摘要兜底：** 最近非空 assistant content > 最近 user content > 「代码已更新」；截断 ≤80 字。LLM 失败用兜底。

- [ ] **Step 1–4: TDD 实现**

- [ ] **Step 5: Commit** `feat(application): record version card after successful agent build`

---

### Task 4: web wire + VersionCard + refetch

**Files:**
- Modify: `apps/web/lib/preview.ts`
- Modify: `apps/web/lib/paths.ts`
- Create: `apps/web/components/version-card.tsx`
- Modify: `apps/web/components/workbench-shell.tsx`
- Modify: stream/engineer/team call sites to pass `recordVersionIntent: true` if not inside enqueue helper used only by agent paths

**Note:** 手动 `POST preview/build` 继续调无 intent 的 enqueue。

- [ ] Wire `getPreview()` with `onBuildComplete` → `handlePreviewBuildComplete`
- [ ] `VersionCard` + `MessageRow` 分支
- [ ] `building → ready` 后 refetch messages（短重试）
- [ ] typecheck
- [ ] Commit `feat(web): show version cards and refetch after preview ready`

---

### Task 5: Verify AC + typecheck

- [ ] `pnpm --filter @isotope/workspace test`
- [ ] `pnpm --filter @isotope/preview test`
- [ ] `pnpm --filter @isotope/application test`
- [ ] 相关 typecheck
- [ ] 对照 AC1–AC3
