import {
  deleteProject,
  getProject,
  updateProjectFlags,
  updateProjectMode,
} from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { ensureTaskRuntime } from "@/lib/task-runtime";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string }> };

function parseMode(v: unknown): "engineer" | "team" | null {
  return v === "engineer" || v === "team" ? v : null;
}

function parseBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const project = getProject(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  ensureTaskRuntime();
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    planEnabled?: unknown;
    teamEnabled?: unknown;
    mode?: unknown;
  } | null;

  const planEnabled = parseBool(body?.planEnabled);
  const teamEnabled = parseBool(body?.teamEnabled);
  const mode = parseMode(body?.mode);
  const hasFlags = planEnabled !== undefined || teamEnabled !== undefined;

  if (!hasFlags && !mode) {
    return NextResponse.json({ error: "模式无效" }, { status: 400 });
  }

  const workspace = getWorkspace();
  const project = hasFlags
    ? updateProjectFlags(
        {
          ownerUserId: session.username,
          projectId: id,
          ...(planEnabled !== undefined ? { planEnabled } : {}),
          ...(teamEnabled !== undefined ? { teamEnabled } : {}),
        },
        workspace,
      )
    : updateProjectMode(
        { ownerUserId: session.username, projectId: id, mode: mode! },
        workspace,
      );

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = deleteProject(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!result) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
