import { deleteProject, getProject } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string }> };

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
