import { listTasks } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { ensureTaskRuntime } from "@/lib/task-runtime";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  ensureTaskRuntime();
  const { id } = await context.params;
  const tasks = listTasks(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!tasks) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ tasks });
}
