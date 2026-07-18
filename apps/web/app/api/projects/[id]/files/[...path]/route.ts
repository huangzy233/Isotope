import { readWorkspaceSourceFile } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id, path: segments = [] } = await context.params;
  if (!segments.length) {
    return NextResponse.json({ error: "缺少文件路径" }, { status: 400 });
  }

  const relativePath = segments.join("/");
  const result = readWorkspaceSourceFile(
    {
      ownerUserId: session.username,
      projectId: id,
      relativePath,
    },
    getWorkspace(),
  );
  if (!result) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }

  return NextResponse.json({ path: result.path, content: result.content });
}
