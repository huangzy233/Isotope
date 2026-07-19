import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CHECK_LOG_TAIL_CHARS,
  type Sandbox,
  type SandboxBuildInput,
  type SandboxTypecheckInput,
  SandboxBuildError,
} from "../domain/types.js";

function runNpm(
  args: string[],
  cwd: string,
  timeoutMs: number,
  logTailChars = 2048,
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });
    let log = "";
    const append = (buf: Buffer) => {
      log = (log + buf.toString()).slice(-logTailChars);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new SandboxBuildError("构建超时", log));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, log });
    });
  });
}

function needsNpmInstall(workspaceDir: string): boolean {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(workspaceDir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return (
    !fs.existsSync(path.join(workspaceDir, "node_modules")) &&
    Boolean(
      (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
        (pkg.devDependencies && Object.keys(pkg.devDependencies).length),
    )
  );
}

/** Preview iframe is under /api/.../files/; root-absolute /assets break. */
export function rewriteRootAbsoluteAssets(html: string): string {
  return html.replaceAll(
    /(src|href)="\/assets\//g,
    '$1="./assets/',
  );
}

function ensureRelativePreviewAssets(buildDir: string): void {
  const indexPath = path.join(buildDir, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const next = rewriteRootAbsoluteAssets(html);
  if (next !== html) {
    fs.writeFileSync(indexPath, next);
  }
}

export function createLocalSandbox(): Sandbox {
  return {
    async build(input: SandboxBuildInput) {
      const timeoutMs = input.timeoutMs ?? 300_000;
      if (needsNpmInstall(input.workspaceDir)) {
        const install = await runNpm(["install"], input.workspaceDir, timeoutMs);
        if (install.code !== 0) {
          throw new SandboxBuildError("npm install 失败", install.log);
        }
      }
      const built = await runNpm(["run", "build"], input.workspaceDir, timeoutMs);
      if (built.code !== 0) {
        throw new SandboxBuildError("构建失败", built.log);
      }
      const indexInBuild = path.join(input.buildDir, "index.html");
      if (!fs.existsSync(indexInBuild)) {
        // Agents often reset vite outDir to default `dist/`; preview serves `build/`.
        const distDir = path.join(input.workspaceDir, "dist");
        const indexInDist = path.join(distDir, "index.html");
        if (fs.existsSync(indexInDist)) {
          fs.mkdirSync(input.buildDir, { recursive: true });
          fs.cpSync(distDir, input.buildDir, { recursive: true });
        }
      }
      if (!fs.existsSync(indexInBuild)) {
        throw new SandboxBuildError("构建成功但缺少 index.html", built.log);
      }
      ensureRelativePreviewAssets(input.buildDir);
    },

    async typecheck(input: SandboxTypecheckInput) {
      const timeoutMs = input.timeoutMs ?? 120_000;
      if (needsNpmInstall(input.workspaceDir)) {
        const install = await runNpm(
          ["install"],
          input.workspaceDir,
          timeoutMs,
          CHECK_LOG_TAIL_CHARS,
        );
        if (install.code !== 0) {
          throw new SandboxBuildError("npm install 失败", install.log);
        }
      }
      const checked = await runNpm(
        ["exec", "--", "tsc", "-b", "--pretty", "false"],
        input.workspaceDir,
        timeoutMs,
        CHECK_LOG_TAIL_CHARS,
      );
      return { ok: checked.code === 0, log: checked.log };
    },
  };
}
