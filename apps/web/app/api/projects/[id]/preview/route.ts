import { getPreviewStatus } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getPreview } from "@/lib/preview";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const snapshot = getPreviewStatus(
    {
      ownerUserId: session.username,
      projectId: id,
      ensure: url.searchParams.get("ensure") === "1",
    },
    getWorkspace(),
    getPreview(),
  );
  if (!snapshot) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ preview: snapshot });
}
