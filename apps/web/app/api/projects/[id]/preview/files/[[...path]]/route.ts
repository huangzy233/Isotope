import { readPreviewAsset } from "@isotope/application";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getPreview } from "@/lib/preview";
import { getWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id, path: segments = [] } = await context.params;
  const relativePath = segments.length ? segments.join("/") : "index.html";
  const asset = readPreviewAsset(
    {
      ownerUserId: session.username,
      projectId: id,
      relativePath,
    },
    getWorkspace(),
    getPreview(),
  );
  if (!asset) {
    return NextResponse.json({ error: "预览不可用" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.body), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "no-cache",
    },
  });
}
