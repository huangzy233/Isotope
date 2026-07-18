import {
  ASSISTANT_PLACEHOLDER,
  beginEngineerTurn,
} from "@isotope/application";
import { readSession } from "@/lib/auth";
import { createTurnDeps } from "@/lib/agent";
import { getPreview } from "@/lib/preview";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    content?: string;
  } | null;

  if (!body || (body.action !== "continue" && body.action !== "send")) {
    return Response.json({ error: "请求无效" }, { status: 400 });
  }
  if (body.action === "send" && !String(body.content ?? "").trim()) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  let turnDeps;
  try {
    turnDeps = createTurnDeps();
  } catch (err) {
    const msg =
      "生成失败：" +
      (err instanceof Error ? err.message : "LLM 配置无效").slice(0, 300);
    const workspace = getWorkspace();
    const messages = workspace.listMessages(id);
    if (body.action === "continue") {
      const last = messages.at(-1);
      if (last?.role === "assistant" && last.content === ASSISTANT_PLACEHOLDER) {
        workspace.updateMessage(last.id, { content: msg });
      }
    } else {
      workspace.appendMessage({
        projectId: id,
        role: "assistant",
        content: msg,
        agentName: "Alex",
      });
    }
    return Response.json({ error: msg }, { status: 500 });
  }

  const begun = beginEngineerTurn(
    body.action === "continue"
      ? {
          ownerUserId: session.username,
          projectId: id,
          action: "continue",
        }
      : {
          ownerUserId: session.username,
          projectId: id,
          action: "send",
          content: String(body.content),
        },
    {
      workspace: getWorkspace(),
      preview: getPreview(),
      ...turnDeps,
    },
  );

  if (!begun.ok) {
    const status =
      begun.status === "conflict"
        ? 409
        : begun.status === "not_found"
          ? 404
          : 400;
    const error =
      begun.status === "conflict"
        ? "回合进行中"
        : begun.status === "not_found"
          ? "项目不存在"
          : "请求无效";
    return Response.json({ error }, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };
      try {
        await begun.run((ev) => {
          if (ev.type === "token") send("token", { text: ev.text });
          else if (ev.type === "done") {
            send("done", {
              messageId: ev.messageId,
              filesChanged: ev.filesChanged,
              previewEnqueued: ev.previewEnqueued,
            });
          } else send("error", { message: ev.message });
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
