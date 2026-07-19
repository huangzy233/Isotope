import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  CHECK_LOG_TAIL_CHARS,
  createLocalSandbox,
} from "../index.js";

describe("createLocalSandbox typecheck", () => {
  let root: string;
  let workspaceDir: string;

  function fakeChild(code: number, output: string) {
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    Object.assign(child, {
      stdout,
      stderr,
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      if (output) stdout.emit("data", Buffer.from(output));
      child.emit("close", code);
    });
    return child;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "iso-sbx-tc-"));
    workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir);
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
    );
    spawnMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("typecheck returns ok:false with log on error", async () => {
    spawnMock.mockImplementation(() =>
      fakeChild(1, "error TS2322: Type 'string' is not assignable"),
    );

    const sandbox = createLocalSandbox();
    const result = await sandbox.typecheck({
      workspaceDir,
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(false);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log).toContain("TS2322");
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["exec", "--", "tsc", "-b", "--pretty", "false"],
      expect.objectContaining({ cwd: workspaceDir }),
    );
  });

  it("typecheck returns ok:true with log on success", async () => {
    spawnMock.mockImplementation(() => fakeChild(0, "tsc done"));

    const sandbox = createLocalSandbox();
    const result = await sandbox.typecheck({
      workspaceDir,
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(true);
    expect(result.log).toContain("tsc done");
  });

  it("typecheck truncates log to CHECK_LOG_TAIL_CHARS", async () => {
    const long = "x".repeat(CHECK_LOG_TAIL_CHARS + 500);
    spawnMock.mockImplementation(() => fakeChild(1, long));

    const sandbox = createLocalSandbox();
    const result = await sandbox.typecheck({
      workspaceDir,
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(false);
    expect(result.log.length).toBe(CHECK_LOG_TAIL_CHARS);
    expect(result.log).toBe(long.slice(-CHECK_LOG_TAIL_CHARS));
  });
});
