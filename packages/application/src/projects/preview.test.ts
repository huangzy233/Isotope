import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PreviewAsset,
  PreviewService,
  PreviewStatusSnapshot,
} from "@isotope/preview";
import { createFsSqliteWorkspace } from "@isotope/workspace";
import { createProject } from "./create-project.js";
import { enqueuePreviewBuild } from "./enqueue-preview-build.js";
import { getPreviewStatus } from "./get-preview-status.js";
import { readPreviewAsset } from "./read-preview-asset.js";

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/vite-react",
);

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

describe("preview use cases", () => {
  let dataRoot: string;
  let workspace: ReturnType<typeof createFsSqliteWorkspace>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-app-preview-"));
    workspace = createFsSqliteWorkspace({ dataRoot, templatePath });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("hides preview from non-owners", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const preview = mockPreview();
    expect(
      getPreviewStatus(
        { ownerUserId: "other", projectId: project.id, ensure: true },
        workspace,
        preview,
      ),
    ).toBeNull();
    expect(preview.ensureBuild).not.toHaveBeenCalled();
    expect(preview.getStatus).not.toHaveBeenCalled();
    expect(
      enqueuePreviewBuild(
        { ownerUserId: "other", projectId: project.id },
        workspace,
        preview,
      ),
    ).toBeNull();
    expect(preview.enqueueBuild).not.toHaveBeenCalled();
    expect(
      readPreviewAsset(
        { ownerUserId: "other", projectId: project.id, relativePath: "index.html" },
        workspace,
        preview,
      ),
    ).toBeNull();
    expect(preview.readAsset).not.toHaveBeenCalled();
  });

  it("ensure skips rebuild when service returns ready without enqueue", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const snapshot = readySnapshot();
    const preview = mockPreview({
      ensureBuild: vi.fn(() => snapshot),
    });
    expect(
      getPreviewStatus(
        { ownerUserId: "demo", projectId: project.id, ensure: true },
        workspace,
        preview,
      ),
    ).toEqual(snapshot);
    expect(preview.ensureBuild).toHaveBeenCalledOnce();
    expect(preview.ensureBuild).toHaveBeenCalledWith(project.id);
    expect(preview.enqueueBuild).not.toHaveBeenCalled();
    expect(preview.getStatus).not.toHaveBeenCalled();
  });

  it("getPreviewStatus uses getStatus when ensure is false", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const snapshot = readySnapshot();
    const preview = mockPreview({
      getStatus: vi.fn(() => snapshot),
    });
    expect(
      getPreviewStatus(
        { ownerUserId: "demo", projectId: project.id },
        workspace,
        preview,
      ),
    ).toEqual(snapshot);
    expect(preview.getStatus).toHaveBeenCalledOnce();
    expect(preview.getStatus).toHaveBeenCalledWith(project.id);
    expect(preview.ensureBuild).not.toHaveBeenCalled();
  });

  it("enqueuePreviewBuild calls enqueueBuild for owners", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const snapshot = readySnapshot();
    const preview = mockPreview({
      enqueueBuild: vi.fn(() => snapshot),
    });
    expect(
      enqueuePreviewBuild(
        { ownerUserId: "demo", projectId: project.id },
        workspace,
        preview,
      ),
    ).toEqual(snapshot);
    expect(preview.enqueueBuild).toHaveBeenCalledOnce();
    expect(preview.enqueueBuild).toHaveBeenCalledWith(project.id);
  });

  it("readPreviewAsset returns asset for owners", () => {
    const { project } = createProject(
      { ownerUserId: "demo", requirement: "x", mode: "engineer" },
      workspace,
    );
    const asset: PreviewAsset = {
      body: Buffer.from("hi"),
      contentType: "text/html",
    };
    const preview = mockPreview({
      readAsset: vi.fn(() => asset),
    });
    expect(
      readPreviewAsset(
        { ownerUserId: "demo", projectId: project.id, relativePath: "index.html" },
        workspace,
        preview,
      ),
    ).toEqual(asset);
    expect(preview.readAsset).toHaveBeenCalledOnce();
    expect(preview.readAsset).toHaveBeenCalledWith(project.id, "index.html");
  });
});
