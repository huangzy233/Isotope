import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type Sandbox,
  type SandboxBuildInput,
  SandboxBuildError,
} from "../domain/types.js";

function runNpm(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });
    let log = "";
    const append = (buf: Buffer) => {
      log = (log + buf.toString()).slice(-2048);
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

export function createLocalSandbox(): Sandbox {
  return {
    async build(input: SandboxBuildInput) {
      const timeoutMs = input.timeoutMs ?? 300_000;
      const pkg = JSON.parse(
        fs.readFileSync(path.join(input.workspaceDir, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const needsInstall =
        !fs.existsSync(path.join(input.workspaceDir, "node_modules")) &&
        Boolean(
          (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
            (pkg.devDependencies && Object.keys(pkg.devDependencies).length),
        );
      if (needsInstall) {
        const install = await runNpm(["install"], input.workspaceDir, timeoutMs);
        if (install.code !== 0) {
          throw new SandboxBuildError("npm install 失败", install.log);
        }
      }
      const built = await runNpm(["run", "build"], input.workspaceDir, timeoutMs);
      if (built.code !== 0) {
        throw new SandboxBuildError("构建失败", built.log);
      }
      if (!fs.existsSync(path.join(input.buildDir, "index.html"))) {
        throw new SandboxBuildError("构建成功但缺少 index.html", built.log);
      }
    },
  };
}
