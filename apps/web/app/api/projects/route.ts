import {
  createProject,
  listProjects,
} from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

function parseMode(v: unknown): "engineer" | "team" | null {
  return v === "engineer" || v === "team" ? v : null;
}

function parseBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export async function GET() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const projects = listProjects(
    { ownerUserId: session.username },
    getWorkspace(),
  );
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    requirement?: unknown;
    planEnabled?: unknown;
    teamEnabled?: unknown;
    mode?: unknown;
  } | null;

  const requirement =
    typeof body?.requirement === "string" ? body.requirement : "";
  const planEnabled = parseBool(body?.planEnabled);
  const teamEnabled = parseBool(body?.teamEnabled);
  const mode = parseMode(body?.mode);
  const hasFlags = planEnabled !== undefined || teamEnabled !== undefined;

  if (!hasFlags && !mode) {
    return NextResponse.json({ error: "模式无效" }, { status: 400 });
  }

  try {
    const { project } = createProject(
      hasFlags
        ? {
            ownerUserId: session.username,
            requirement,
            planEnabled: planEnabled ?? false,
            teamEnabled: teamEnabled ?? false,
          }
        : {
            ownerUserId: session.username,
            requirement,
            mode: mode!,
          },
      getWorkspace(),
    );
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
