import {
  ASSISTANT_PLACEHOLDER,
  beginEngineerTurn,
  beginTeamTurn,
  getProject,
  type EngineerTurnEvent,
  type TeamTurnEvent,
} from "@isotope/application";
import { readSession } from "@/lib/auth";
import { createTeamTurnDeps, createTurnDeps } from "@/lib/agent";
import { getPreview } from "@/lib/preview";
import { ensureTaskRuntime, getTaskBus } from "@/lib/task-runtime";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function sendSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

function forwardTurnEvent(
  send: (event: string, data: unknown) => void,
  ev: EngineerTurnEvent | TeamTurnEvent,
) {
  switch (ev.type) {
    case "speaker":
      send("speaker", { agentName: ev.agentName, messageId: ev.messageId });
      break;
    case "status":
      send("status", { phase: ev.phase });
      break;
    case "thinking":
      send("thinking", { text: ev.text });
      break;
    case "tool":
      send("tool", {
        id: ev.id,
        name: ev.name,
        state: ev.state,
        summary: ev.summary,
        ...(ev.ok !== undefined ? { ok: ev.ok } : {}),
      });
      break;
    case "token":
      send("token", { text: ev.text });
      break;
    case "task":
      send("task", {
        taskId: ev.taskId,
        status: ev.status,
        title: ev.title,
        assignee: ev.assignee,
      });
      break;
    case "done":
      send("done", {
        messageId: ev.messageId,
        filesChanged: ev.filesChanged,
        previewEnqueued: ev.previewEnqueued,
        ...("taskId" in ev && ev.taskId ? { taskId: ev.taskId } : {}),
      });
      break;
    case "error":
      send("error", { message: ev.message });
      break;
  }
}

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

  ensureTaskRuntime();
  const workspace = getWorkspace();
  const project = getProject(
    { ownerUserId: session.username, projectId: id },
    workspace,
  );
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const turnInput =
    body.action === "continue"
      ? {
          ownerUserId: session.username,
          projectId: id,
          action: "continue" as const,
        }
      : {
          ownerUserId: session.username,
          projectId: id,
          action: "send" as const,
          content: String(body.content),
        };

  const writeConfigError = (msg: string) => {
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
        agentName: project.mode === "team" ? "Mike" : "Alex",
      });
    }
  };

  let begun:
    | ReturnType<typeof beginTeamTurn>
    | ReturnType<typeof beginEngineerTurn>;

  if (project.mode === "team") {
    let teamDeps;
    try {
      teamDeps = createTeamTurnDeps();
    } catch (err) {
      const msg =
        "生成失败：" +
        (err instanceof Error ? err.message : "LLM 配置无效").slice(0, 300);
      writeConfigError(msg);
      return Response.json({ error: msg }, { status: 500 });
    }
    begun = beginTeamTurn(turnInput, {
      workspace,
      preview: getPreview(),
      bus: getTaskBus(),
      ...teamDeps,
    });
  } else {
    let turnDeps;
    try {
      turnDeps = createTurnDeps();
    } catch (err) {
      const msg =
        "生成失败：" +
        (err instanceof Error ? err.message : "LLM 配置无效").slice(0, 300);
      writeConfigError(msg);
      return Response.json({ error: msg }, { status: 500 });
    }
    begun = beginEngineerTurn(turnInput, {
      workspace,
      preview: getPreview(),
      ...turnDeps,
    });
  }

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
      const send = (event: string, data: unknown) =>
        sendSse(controller, encoder, event, data);
      try {
        await begun.run((ev) => forwardTurnEvent(send, ev));
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
