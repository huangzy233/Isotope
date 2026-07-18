import { appendMessage, listMessages } from "@isotope/application";
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
  const messages = listMessages(
    { ownerUserId: session.username, projectId: id },
    getWorkspace(),
  );
  if (!messages) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    content?: unknown;
  } | null;

  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = appendMessage(
    {
      ownerUserId: session.username,
      projectId: id,
      content,
    },
    getWorkspace(),
  );
  if (!result) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ messages: result.messages }, { status: 201 });
}
