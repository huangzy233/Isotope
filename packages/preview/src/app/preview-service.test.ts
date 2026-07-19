import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "@isotope/sandbox";
import { createPreviewService } from "./preview-service.js";

describe("createPreviewService", () => {
  let root: string;
  let workspaceDir: string;
  let buildDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "iso-prev-"));
    workspaceDir = path.join(root, "workspace");
    buildDir = path.join(root, "build");
    fs.mkdirSync(workspaceDir);
    fs.mkdirSync(buildDir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ensureBuild is idempotent when ready", async () => {
    let builds = 0;
    const sandbox: Sandbox = {
      async build() {
        builds += 1;
        fs.writeFileSync(path.join(buildDir, "index.html"), "<html></html>");
      },
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const preview = createPreviewService({
      resolvePaths: (id) =>
        id === "p1" ? { workspaceDir, buildDir } : null,
      sandbox,
    });
    preview.ensureBuild("p1");
    await vi.waitFor(() => expect(preview.getStatus("p1").status).toBe("ready"));
    expect(builds).toBe(1);
    preview.ensureBuild("p1");
    await new Promise((r) => setTimeout(r, 50));
    expect(builds).toBe(1);
  });

  it("enqueueBuild marks failed on sandbox error", async () => {
    const sandbox: Sandbox = {
      async build() {
        const { SandboxBuildError } = await import("@isotope/sandbox");
        throw new SandboxBuildError("构建失败", "boom");
      },
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const preview = createPreviewService({
      resolvePaths: () => ({ workspaceDir, buildDir }),
      sandbox,
    });
    preview.enqueueBuild("p1");
    await vi.waitFor(() => expect(preview.getStatus("p1").status).toBe("failed"));
    expect(preview.getStatus("p1").error).toContain("boom");
  });

  it("readAsset rejects path escape and non-ready", () => {
    const sandbox: Sandbox = {
      async build() {},
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const preview = createPreviewService({
      resolvePaths: () => ({ workspaceDir, buildDir }),
      sandbox,
    });
    expect(preview.readAsset("p1", "index.html")).toBeNull();
    fs.writeFileSync(
      path.join(root, "preview-status.json"),
      JSON.stringify({
        status: "ready",
        revision: "1",
        error: null,
        updatedAt: new Date().toISOString(),
      }),
    );
    fs.writeFileSync(path.join(buildDir, "index.html"), "hi");
    expect(preview.readAsset("p1", "../preview-status.json")).toBeNull();
    expect(preview.readAsset("p1", "index.html")?.body.toString()).toBe("hi");
  });

  it("calls onBuildComplete on ready and failed", async () => {
    const onBuildComplete = vi.fn();
    const okSandbox: Sandbox = {
      async build() {
        fs.writeFileSync(path.join(buildDir, "index.html"), "<html></html>");
      },
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const okPreview = createPreviewService({
      resolvePaths: () => ({ workspaceDir, buildDir }),
      sandbox: okSandbox,
      onBuildComplete,
    });
    okPreview.enqueueBuild("p1");
    await vi.waitFor(() => expect(onBuildComplete).toHaveBeenCalled());
    expect(onBuildComplete).toHaveBeenCalledWith("p1", {
      ok: true,
      revision: expect.any(String),
      error: null,
    });

    onBuildComplete.mockClear();
    const failRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-prev-fail-"));
    const failWorkspace = path.join(failRoot, "workspace");
    const failBuild = path.join(failRoot, "build");
    fs.mkdirSync(failWorkspace);
    fs.mkdirSync(failBuild);
    const failSandbox: Sandbox = {
      async build() {
        const { SandboxBuildError } = await import("@isotope/sandbox");
        throw new SandboxBuildError("构建失败", "boom");
      },
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const failPreview = createPreviewService({
      resolvePaths: () => ({
        workspaceDir: failWorkspace,
        buildDir: failBuild,
      }),
      sandbox: failSandbox,
      onBuildComplete,
    });
    failPreview.enqueueBuild("p2");
    await vi.waitFor(() => expect(onBuildComplete).toHaveBeenCalled());
    expect(onBuildComplete).toHaveBeenCalledWith("p2", {
      ok: false,
      revision: null,
      error: expect.stringContaining("boom"),
    });
    fs.rmSync(failRoot, { recursive: true, force: true });
  });

  it("onBuildComplete throw does not stall the queue", async () => {
    let builds = 0;
    const onBuildComplete = vi.fn(() => {
      throw new Error("hook boom");
    });
    const sandbox: Sandbox = {
      async build() {
        builds += 1;
        fs.writeFileSync(path.join(buildDir, "index.html"), "<html></html>");
      },
      typecheck: async () => ({ ok: true, log: "" }),
    };
    const preview = createPreviewService({
      resolvePaths: (id) =>
        id === "p1" || id === "p2" ? { workspaceDir, buildDir } : null,
      sandbox,
      onBuildComplete,
    });
    preview.enqueueBuild("p1");
    await vi.waitFor(() => expect(preview.getStatus("p1").status).toBe("ready"));
    preview.enqueueBuild("p2");
    await vi.waitFor(() => expect(preview.getStatus("p2").status).toBe("ready"));
    expect(builds).toBe(2);
  });
});
