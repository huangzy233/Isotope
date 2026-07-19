import {
  ASSISTANT_PLACEHOLDER,
  beginEngineerTurn,
  beginPlanTurn,
  beginTeamTurn,
  getProject,
  isTransportDisconnectError,
  isTurnHubActive,
  resolveTurnKind,
  subscribeTurn,
  type EngineerTurnEvent,
  type PlanTurnEvent,
  type TeamTurnEvent,
} from "@isotope/application";
import { readSession } from "@/lib/auth";
import {
  createPlanTurnDeps,
  createTeamTurnDeps,
  createTurnDeps,
} from "@/lib/agent";
import { getPreview } from "@/lib/preview";
import { ensureTaskRuntime, getTaskBus } from "@/lib/task-runtime";
import { getWorkspace } from "@/lib/workspace";

/** Task 4 stub; Task 7 replaces with getPreferenceStore singleton. */
const preferencesStub = {
  getPreferences: () => ({}),
  upsertPreference: () => {},
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type TurnEvent = EngineerTurnEvent | TeamTurnEvent | PlanTurnEvent;

function forwardTurnEvent(
  send: (event: string, data: unknown) => void,
  ev: TurnEvent,
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
        ...("planConfirmed" in ev && ev.planConfirmed !== undefined
          ? { planConfirmed: ev.planConfirmed }
          : {}),
        ...("nextTurn" in ev && ev.nextTurn !== undefined
          ? { nextTurn: ev.nextTurn }
          : {}),
      });
      break;
    case "error":
      send("error", { message: ev.message });
      break;
  }
}

function openTurnSse(projectId: string): Response {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch (err) {
          if (isTransportDisconnectError(err)) {
            unsub?.();
            unsub = null;
            return;
          }
          throw err;
        }
      };
      unsub = subscribeTurn(projectId, (ev) => {
        forwardTurnEvent(send, ev as TurnEvent);
        const type = (ev as { type?: string }).type;
        if (type === "done" || type === "error") {
          unsub?.();
          unsub = null;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
      if (!unsub) {
        send("error", { message: "回合不存在或已结束" });
        controller.close();
      }
    },
    cancel() {
      unsub?.();
      unsub = null;
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

export async function POST(request: Request, context: RouteContext) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    content?: string;
    silentHandoff?: boolean;
  } | null;

  if (!body || (body.action !== "continue" && body.action !== "send")) {
    return Response.json({ error: "请求无效" }, { status: 400 });
  }
  const silentHandoff = body.silentHandoff === true;
  if (
    body.action === "send" &&
    !silentHandoff &&
    !String(body.content ?? "").trim()
  ) {
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

  if (body.action === "continue" && isTurnHubActive(id)) {
    return openTurnSse(id);
  }

  if (body.action === "send" && isTurnHubActive(id)) {
    return Response.json({ error: "回合进行中" }, { status: 409 });
  }

  const turnInput =
    body.action === "continue"
      ? {
          ownerUserId: session.username,
          projectId: id,
          action: "continue" as const,
        }
      : silentHandoff
        ? {
            ownerUserId: session.username,
            projectId: id,
            action: "send" as const,
            content: String(body.content ?? ""),
            silentHandoff: true as const,
          }
        : {
            ownerUserId: session.username,
            projectId: id,
            action: "send" as const,
            content: String(body.content),
          };

  const writeConfigError = (msg: string) => {
    const fresh =
      getProject(
        { ownerUserId: session.username, projectId: id },
        workspace,
      ) ?? project;
    const errorKind = resolveTurnKind(fresh);
    const agentName =
      errorKind === "plan_clarify"
        ? "Pat"
        : errorKind === "team"
          ? "Mike"
          : "Alex";
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
        agentName,
      });
    }
  };

  const kind = resolveTurnKind(project);

  let begun:
    | ReturnType<typeof beginPlanTurn>
    | ReturnType<typeof beginTeamTurn>
    | ReturnType<typeof beginEngineerTurn>;

  if (kind === "plan_clarify") {
    let planDeps;
    try {
      planDeps = createPlanTurnDeps();
    } catch (err) {
      const msg =
        "生成失败：" +
        (err instanceof Error ? err.message : "LLM 配置无效").slice(0, 300);
      writeConfigError(msg);
      return Response.json({ error: msg }, { status: 500 });
    }
    begun = beginPlanTurn(turnInput, {
      workspace,
      preferences: preferencesStub,
      ...planDeps,
    });
  } else if (kind === "team") {
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
      preferences: preferencesStub,
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
      preferences: preferencesStub,
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

  void begun.run();
  return openTurnSse(id);
}
