import { createLocalSandbox, SandboxBuildError } from "@isotope/sandbox";
import { getWorkspace } from "./workspace";

let sandbox: ReturnType<typeof createLocalSandbox> | null = null;

function getSandbox() {
  if (!sandbox) {
    sandbox = createLocalSandbox();
  }
  return sandbox;
}

/** Resolve project workspaceDir the same way preview enqueueBuild does. */
export async function runTypecheck(
  projectId: string,
): Promise<{ ok: boolean; log: string }> {
  const paths = getWorkspace().getProjectPaths(projectId);
  if (!paths) {
    return { ok: false, log: `项目不存在：${projectId}` };
  }
  try {
    return await getSandbox().typecheck({
      workspaceDir: paths.workspaceDir,
    });
  } catch (err) {
    if (err instanceof SandboxBuildError) {
      return { ok: false, log: err.logTail || err.message };
    }
    return {
      ok: false,
      log: err instanceof Error ? err.message : String(err),
    };
  }
}
