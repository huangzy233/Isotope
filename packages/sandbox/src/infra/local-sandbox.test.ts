import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSandbox, SandboxBuildError } from "../index.js";

describe("createLocalSandbox", () => {
  let root: string;
  let workspaceDir: string;
  let buildDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "iso-sbx-"));
    workspaceDir = path.join(root, "workspace");
    buildDir = path.join(root, "build");
    fs.mkdirSync(workspaceDir);
    fs.mkdirSync(buildDir);
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: {
          build:
            "node -e \"require('fs').mkdirSync('../build',{recursive:true});require('fs').writeFileSync('../build/index.html','ok')\"",
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs build and leaves artifact in buildDir", async () => {
    const sandbox = createLocalSandbox();
    await sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 });
    expect(fs.readFileSync(path.join(buildDir, "index.html"), "utf8")).toBe("ok");
  });

  it("throws SandboxBuildError with log on failure", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { build: "node -e \"process.exit(1)\"" },
      }),
    );
    const sandbox = createLocalSandbox();
    await expect(
      sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(SandboxBuildError);
  });

  it("copies workspace/dist to buildDir when vite defaults to dist", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: {
          build:
            "node -e \"const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','from-dist')\"",
        },
      }),
    );
    const sandbox = createLocalSandbox();
    await sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 });
    expect(fs.readFileSync(path.join(buildDir, "index.html"), "utf8")).toBe(
      "from-dist",
    );
  });

  it("rewrites absolute /assets URLs to relative for iframe preview", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: {
          build:
            "node -e \"const fs=require('fs');const p=require('path');const b=p.join('..','build');fs.mkdirSync(p.join(b,'assets'),{recursive:true});fs.writeFileSync(p.join(b,'assets','app.js'),'1');fs.writeFileSync(p.join(b,'index.html'),'<!doctype html><script type=\\\"module\\\" src=\\\"/assets/app.js\\\"></script>')\"",
        },
      }),
    );
    const sandbox = createLocalSandbox();
    await sandbox.build({ workspaceDir, buildDir, timeoutMs: 60_000 });
    const html = fs.readFileSync(path.join(buildDir, "index.html"), "utf8");
    expect(html).toContain('src="./assets/app.js"');
    expect(html).not.toContain('src="/assets/app.js"');
  });
});
