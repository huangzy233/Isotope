import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@isotope/llm";
import type { PreviewService, PreviewStatusSnapshot } from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { handlePreviewBuildComplete } from "./record-version-on-build.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

const PROMPT = `上下文：\n{{context}}`;

function readySnapshot(): PreviewStatusSnapshot {
  return {
    status: "ready",
    revision: "rev-1",
    error: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockPreview(
  overrides: Partial<PreviewService> = {},
): PreviewService {
  return {
    getStatus: vi.fn(() => readySnapshot()),
    ensureBuild: vi.fn(() => readySnapshot()),
    enqueueBuild: vi.fn(() => readySnapshot()),
    readAsset: vi.fn(() => null),
    ...overrides,
  };
}

describe("record version on build", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-ver-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("enqueue with recordVersionIntent upserts pending", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const preview = mockPreview();
    enqueuePreviewBuild(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
      preview,
      { recordVersionIntent: true },
    );
    expect(preview.enqueueBuild).toHaveBeenCalledOnce();
    expect(workspace.takePendingVersionIntent(project.id)).toBe(true);
  });

  it("enqueue without intent does not upsert pending", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const preview = mockPreview();
    enqueuePreviewBuild(
      { ownerUserId: "demo", projectId: project.id },
      workspace,
      preview,
    );
    expect(workspace.takePendingVersionIntent(project.id)).toBe(false);
  });

  it("success with pending records version message via LLM", async () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "改标题", mode: "engineer" },
      workspace,
    );
    workspace.appendMessage({
      projectId: project.id,
      role: "user",
      content: "改标题",
    });
    workspace.appendMessage({
      projectId: project.id,
      role: "assistant",
      content: "已把首页标题改为欢迎使用",
      agentName: "Alex",
    });
    workspace.upsertPendingVersionIntent(project.id);

    const llm: LlmClient = {
      async *complete() {
        yield { type: "content_delta", text: "更新了首页标题文案" };
        yield { type: "finished", finishReason: "stop" };
      },
    };

    await handlePreviewBuildComplete(
      { projectId: project.id, ok: true, revision: "r1", error: null },
      workspace,
      llm,
      { promptTemplate: PROMPT },
    );

    expect(workspace.takePendingVersionIntent(project.id)).toBe(false);
    const versions = workspace.listVersions(project.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.number).toBe(1);
    expect(versions[0]?.summary).toBe("更新了首页标题文案");
    expect(versions[0]?.previewRevision).toBe("r1");

    const msgs = workspace.listMessages(project.id);
    const card = msgs.find((m) => m.versionId);
    expect(card?.role).toBe("system");
    expect(card?.content).toBe("更新了首页标题文案");
    expect(card?.versionNumber).toBe(1);
  });

  it("success without pending is noop", async () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const llm: LlmClient = {
      async *complete() {
        yield { type: "content_delta", text: "不应出现" };
      },
    };
    await handlePreviewBuildComplete(
      { projectId: project.id, ok: true, revision: "r1", error: null },
      workspace,
      llm,
      { promptTemplate: PROMPT },
    );
    expect(workspace.listVersions(project.id)).toEqual([]);
  });

  it("failure takes pending and does not record version", async () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.upsertPendingVersionIntent(project.id);
    const llm: LlmClient = {
      async *complete() {
        yield { type: "content_delta", text: "不应出现" };
      },
    };
    await handlePreviewBuildComplete(
      { projectId: project.id, ok: false, revision: null, error: "boom" },
      workspace,
      llm,
      { promptTemplate: PROMPT },
    );
    expect(workspace.takePendingVersionIntent(project.id)).toBe(false);
    expect(workspace.listVersions(project.id)).toEqual([]);
  });

  it("LLM failure falls back to truncated assistant summary", async () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    workspace.appendMessage({
      projectId: project.id,
      role: "assistant",
      content: "已完成按钮颜色调整并保存",
      agentName: "Alex",
    });
    workspace.upsertPendingVersionIntent(project.id);
    const llm: LlmClient = {
      async *complete() {
        throw new Error("timeout");
      },
    };
    await handlePreviewBuildComplete(
      { projectId: project.id, ok: true, revision: "r2", error: null },
      workspace,
      llm,
      { promptTemplate: PROMPT },
    );
    const versions = workspace.listVersions(project.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.summary).toBe("已完成按钮颜色调整并保存");
  });
});
