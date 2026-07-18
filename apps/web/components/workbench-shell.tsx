"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ASSISTANT_PLACEHOLDER } from "@isotope/application/placeholder";
import type {
  Message,
  Project,
  ProjectMode,
  Task,
  TaskStatus,
} from "@isotope/workspace";
import { agentRoleLabel } from "@/components/agent-identity";
import { MarkdownBody } from "@/components/markdown-body";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { PanelHeader } from "@/components/panel-header";
import { StatusBadge } from "@/components/status-badge";
import { TaskCard } from "@/components/task-card";
import { VersionCard } from "@/components/version-card";
import { CheckCircle2, ChevronUp } from "lucide-react";
import { ToolCallGroup } from "@/components/tool-call-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceEditorPane } from "@/components/workspace-editor-pane";
import { ComposerModeMenu } from "@/components/composer-mode-menu";
import { cn } from "@/lib/utils";

const DEFAULT_CHAT_PCT = 33.333;
const MIN_CHAT_PCT = 22;
const MAX_CHAT_PCT = 55;
const SPLIT_STORAGE_KEY = "isotope.workbench.chatPct";
const VIEWER_MODE_KEY = (id: string) =>
  `isotope.workbench.viewerMode:${id}`;

type ViewerMode = "preview" | "editor";

type PreviewSnapshot = {
  status: "idle" | "building" | "ready" | "failed";
  revision: string | null;
  error: string | null;
  updatedAt: string;
};

type AgentStatus = "idle" | "thinking" | "running" | "streaming";

type ToolStreamEvent = {
  id: string;
  name: string;
  state: "start" | "end";
  summary?: string;
  ok?: boolean;
};

function clampChatPct(value: number) {
  return Math.min(MAX_CHAT_PCT, Math.max(MIN_CHAT_PCT, value));
}

type StreamHandlers = {
  onStatus?: (phase: "thinking" | "running" | "streaming") => void;
  onThinking?: (text: string) => void;
  onTool?: (ev: ToolStreamEvent) => void;
  onSpeaker?: (data: { agentName: string; messageId: string }) => void;
  onTask?: (data: {
    taskId: string;
    status: TaskStatus;
    title: string;
    assignee: string;
  }) => void;
  onToken: (text: string) => void;
  onDone: (data: {
    messageId: string;
    filesChanged: boolean;
    previewEnqueued: boolean;
  }) => void;
  onError: (message: string) => void;
  /** Stream ended without a terminal event (or fetch threw). Prefer over onError for transport. */
  onTransportDisconnect?: () => void;
};

type ContinueFlight = {
  handlers: StreamHandlers;
  currentMessageId: string;
};

/** Strict Mode remount: first continue owns the SSE; later mounts rebind handlers. */
const continueFlightByProject = new Map<string, ContinueFlight>();
/** Projects with an open continue SSE body (409 from a duplicate continue is ignored). */
const continueSseOpen = new Set<string>();

function updateMessageById(
  prev: Message[],
  messageId: string,
  updater: (msg: Message) => Message,
): Message[] {
  const i = prev.findIndex((m) => m.id === messageId);
  if (i < 0) return prev;
  const copy = [...prev];
  copy[i] = updater(copy[i]!);
  return copy;
}

function mergeThinking(message: Message, text: string): Message {
  const steps = [...(message.process?.steps ?? [])];
  const last = steps.at(-1);
  if (last?.type === "thinking") {
    steps[steps.length - 1] = { type: "thinking", text: last.text + text };
  } else {
    steps.push({ type: "thinking", text });
  }
  return { ...message, process: { steps } };
}

function applyToolStep(message: Message, ev: ToolStreamEvent): Message {
  const steps = [...(message.process?.steps ?? [])];
  if (ev.state === "start") {
    steps.push({
      type: "tool",
      id: ev.id,
      name: ev.name,
      status: "running",
      summary: ev.summary,
    });
  } else {
    const status = ev.ok === false ? "error" : "done";
    const idx = steps.findIndex((s) => s.type === "tool" && s.id === ev.id);
    if (idx >= 0 && steps[idx]?.type === "tool") {
      const prev = steps[idx];
      steps[idx] = {
        type: "tool",
        id: prev.id,
        name: prev.name,
        status,
        summary: ev.summary ?? prev.summary,
      };
    } else {
      steps.push({
        type: "tool",
        id: ev.id,
        name: ev.name,
        status,
        summary: ev.summary,
      });
    }
  }
  return { ...message, process: { steps } };
}

function signalTransportDisconnect(handlers: StreamHandlers): void {
  if (handlers.onTransportDisconnect) {
    handlers.onTransportDisconnect();
  } else {
    handlers.onError("连接中断，请重试");
  }
}

async function consumeEngineerStream(
  projectId: string,
  body: { action: "continue" } | { action: "send"; content: string },
  handlers: StreamHandlers,
): Promise<void> {
  let terminal = false;
  let openedContinueSse = false;
  try {
    const res = await fetch(`/api/projects/${projectId}/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      // Duplicate continue while this page already owns the stream — no-op.
      if (body.action === "continue" && continueSseOpen.has(projectId)) {
        return;
      }
      handlers.onError("回合进行中，请稍候");
      return;
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      handlers.onError(
        typeof data?.error === "string" ? data.error : "请求失败",
      );
      return;
    }
    if (body.action === "continue") {
      continueSseOpen.add(projectId);
      openedContinueSse = true;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataLine) as Record<string, unknown>;
        } catch {
          signalTransportDisconnect(handlers);
          return;
        }
        if (
          event === "status" &&
          (data.phase === "thinking" ||
            data.phase === "running" ||
            data.phase === "streaming")
        ) {
          handlers.onStatus?.(data.phase);
        } else if (event === "thinking" && typeof data.text === "string") {
          handlers.onThinking?.(data.text);
        } else if (
          event === "tool" &&
          typeof data.id === "string" &&
          typeof data.name === "string" &&
          (data.state === "start" || data.state === "end")
        ) {
          handlers.onTool?.({
            id: data.id,
            name: data.name,
            state: data.state,
            summary:
              typeof data.summary === "string" ? data.summary : undefined,
            ok: typeof data.ok === "boolean" ? data.ok : undefined,
          });
        } else if (
          event === "speaker" &&
          typeof data.agentName === "string" &&
          typeof data.messageId === "string"
        ) {
          handlers.onSpeaker?.({
            agentName: data.agentName,
            messageId: data.messageId,
          });
        } else if (
          event === "task" &&
          typeof data.taskId === "string" &&
          typeof data.status === "string" &&
          typeof data.title === "string" &&
          typeof data.assignee === "string"
        ) {
          handlers.onTask?.({
            taskId: data.taskId,
            status: data.status as TaskStatus,
            title: data.title,
            assignee: data.assignee,
          });
        } else if (event === "token" && typeof data.text === "string") {
          handlers.onToken(data.text);
        } else if (event === "done") {
          terminal = true;
          handlers.onDone(
            data as {
              messageId: string;
              filesChanged: boolean;
              previewEnqueued: boolean;
            },
          );
        } else if (event === "error") {
          terminal = true;
          handlers.onError(String(data.message ?? "生成失败"));
        }
      }
    }
    if (!terminal) {
      signalTransportDisconnect(handlers);
    }
  } catch {
    signalTransportDisconnect(handlers);
  } finally {
    if (openedContinueSse) continueSseOpen.delete(projectId);
  }
}

export function WorkbenchShell({
  project,
  initialMessages,
}: {
  project: Project;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ProjectMode>(project.mode);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [chatPct, setChatPct] = useState(DEFAULT_CHAT_PCT);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const [viewerMode, setViewerMode] = useState<ViewerMode>("preview");
  const splitRef = useRef<HTMLDivElement>(null);
  const continuedRef = useRef(false);
  const continueInFlightRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const continueStartProcessRef = useRef<Message["process"]>(undefined);
  const currentAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
      if (!stored) return;
      const value = Number(stored);
      if (Number.isFinite(value)) {
        setChatPct(clampChatPct(value));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEWER_MODE_KEY(project.id));
      if (stored === "preview" || stored === "editor") {
        setViewerMode(stored);
      } else {
        setViewerMode("preview");
      }
    } catch {
      setViewerMode("preview");
    }
  }, [project.id]);

  function persistViewerMode(next: ViewerMode) {
    setViewerMode(next);
    try {
      localStorage.setItem(VIEWER_MODE_KEY(project.id), next);
    } catch {
      // ignore storage errors
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/tasks`);
        const data = (await res.json().catch(() => null)) as {
          tasks?: Task[];
        } | null;
        if (!res.ok || !Array.isArray(data?.tasks)) return;
        const map: Record<string, Task> = {};
        for (const task of data.tasks) {
          map[task.id] = task;
        }
        setTasks(map);
      } catch {
        // keep empty map on network errors
      }
    })();
  }, [project.id]);

  const applySpeaker = useCallback(
    (data: { agentName: string; messageId: string }) => {
      const prevId = currentAssistantIdRef.current;
      setMessages((prev) => {
        // Hub replay / reconnect: reuse the existing row for this messageId
        // instead of appending a duplicate when the agent name changes.
        const byMessageId = prev.find((m) => m.id === data.messageId);
        if (byMessageId) {
          if ((byMessageId.agentName ?? "Alex") === data.agentName) {
            return prev;
          }
          return updateMessageById(prev, data.messageId, (m) => ({
            ...m,
            agentName: data.agentName,
          }));
        }
        const current = prevId
          ? prev.find((m) => m.id === prevId)
          : undefined;
        if (
          current &&
          (current.agentName ?? "Alex") !== data.agentName
        ) {
          return [
            ...prev,
            {
              id: data.messageId,
              projectId: project.id,
              role: "assistant" as const,
              content: "",
              createdAt: new Date().toISOString(),
              agentName: data.agentName,
            },
          ];
        }
        if (prevId && prevId !== data.messageId) {
          return updateMessageById(prev, prevId, (m) => ({
            ...m,
            id: data.messageId,
            agentName: data.agentName,
          }));
        }
        if (prevId) {
          return updateMessageById(prev, prevId, (m) => ({
            ...m,
            agentName: data.agentName,
          }));
        }
        return prev;
      });
      currentAssistantIdRef.current = data.messageId;
      const flight = continueFlightByProject.get(project.id);
      if (flight) flight.currentMessageId = data.messageId;
    },
    [project.id],
  );

  const applyTaskEvent = useCallback(
    (data: {
      taskId: string;
      status: TaskStatus;
      title: string;
      assignee: string;
    }) => {
      setTasks((prev) => {
        const existing = prev[data.taskId];
        return {
          ...prev,
          [data.taskId]: {
            id: data.taskId,
            projectId: existing?.projectId ?? project.id,
            title: data.title,
            assignee: data.assignee as Task["assignee"],
            status: data.status,
            createdByMessageId: existing?.createdByMessageId,
            assigneeMessageId: existing?.assigneeMessageId,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastProgressAt: new Date().toISOString(),
          },
        };
      });
      setMessages((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i -= 1) {
          if (
            copy[i]!.role === "assistant" &&
            copy[i]!.agentName === "Mike"
          ) {
            copy[i] = { ...copy[i]!, taskId: data.taskId };
            break;
          }
        }
        return copy;
      });
    },
    [project.id],
  );

  const persistChatPct = useCallback((value: number) => {
    const next = clampChatPct(value);
    setChatPct(next);
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
    return next;
  }, []);

  const updateChatPctFromClientX = useCallback((clientX: number) => {
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setChatPct(clampChatPct(((clientX - rect.left) / rect.width) * 100));
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function onMove(event: PointerEvent) {
      updateChatPctFromClientX(event.clientX);
    }

    function onUp() {
      setDragging(false);
      setChatPct((current) => {
        try {
          localStorage.setItem(SPLIT_STORAGE_KEY, String(current));
        } catch {
          // ignore storage errors
        }
        return current;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, updateChatPctFromClientX]);

  const fetchPreview = useCallback(
    async (ensure: boolean) => {
      try {
        const res = await fetch(
          `/api/projects/${project.id}/preview${ensure ? "?ensure=1" : ""}`,
        );
        const data = (await res.json().catch(() => null)) as {
          preview?: PreviewSnapshot;
        } | null;
        if (res.ok && data?.preview) {
          setPreview(data.preview);
        }
      } catch {
        // keep last known preview on network errors
      }
    },
    [project.id],
  );

  useEffect(() => {
    void fetchPreview(true);
  }, [fetchPreview]);

  useEffect(() => {
    if (!preview || preview.status !== "building") return;
    const id = window.setInterval(() => {
      void fetchPreview(false);
    }, 1500);
    return () => window.clearInterval(id);
  }, [preview?.status, fetchPreview]);

  const prevPreviewStatusRef = useRef<PreviewSnapshot["status"] | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const refetchMessagesAfterReady = useCallback(async () => {
    const knownIds = new Set(messagesRef.current.map((m) => m.id));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(`/api/projects/${project.id}/messages`);
        const data = (await res.json().catch(() => null)) as {
          messages?: Message[];
        } | null;
        if (res.ok && data?.messages) {
          setMessages(data.messages);
          const hasNewVersion = data.messages.some(
            (m) => m.versionId && !knownIds.has(m.id),
          );
          if (hasNewVersion || attempt === 3) return;
        }
      } catch {
        // ignore transient errors
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }, [project.id]);

  useEffect(() => {
    const prev = prevPreviewStatusRef.current;
    const next = preview?.status ?? null;
    prevPreviewStatusRef.current = next;
    if (prev === "building" && next === "ready") {
      void refetchMessagesAfterReady();
    }
  }, [preview?.status, refetchMessagesAfterReady]);

  useEffect(() => {
    if (continuedRef.current) return;
    const last = initialMessages.at(-1);
    if (
      !last ||
      last.role !== "assistant" ||
      last.content !== ASSISTANT_PLACEHOLDER
    ) {
      return;
    }
    const lastId = last.id;
    const hasProcessSteps = Boolean(last.process?.steps?.length);
    continuedRef.current = true;
    continueInFlightRef.current = true;
    reconnectAttemptRef.current = 0;
    continueStartProcessRef.current = last.process;
    currentAssistantIdRef.current = lastId;
    setSubmitting(true);
    setAgentStatus(hasProcessSteps ? "running" : "thinking");
    setMessages((prev) => {
      const copy = [...prev];
      const i = copy.length - 1;
      const cur = copy[i]!;
      copy[i] = {
        ...cur,
        content: "",
        process: cur.process,
      };
      return copy;
    });

    const handlers: StreamHandlers = {
      onStatus: (phase) => {
        setAgentStatus(phase);
      },
      onSpeaker: (data) => {
        applySpeaker(data);
      },
      onTask: (data) => {
        applyTaskEvent(data);
      },
      onThinking: (text) => {
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          updateMessageById(prev, id, (m) => mergeThinking(m, text)),
        );
      },
      onTool: (ev) => {
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          updateMessageById(prev, id, (m) => applyToolStep(m, ev)),
        );
      },
      onToken: (text) => {
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          updateMessageById(prev, id, (m) => ({
            ...m,
            content: (m.content ?? "") + text,
          })),
        );
      },
      onDone: (data) => {
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages((prev) =>
            updateMessageById(prev, id, (m) => ({
              ...m,
              id: data.messageId,
            })),
          );
          currentAssistantIdRef.current = data.messageId;
        }
        reconnectAttemptRef.current = 0;
        setError(null);
        setAgentStatus("idle");
        setSubmitting(false);
        continueInFlightRef.current = false;
        if (data.previewEnqueued) void fetchPreview(false);
      },
      onError: (message) => {
        setError(message);
        const transport = message.includes("连接中断");
        if (!transport) {
          const id = currentAssistantIdRef.current;
          if (id) {
            setMessages((prev) =>
              updateMessageById(prev, id, (m) => {
                const cur = m.content;
                const emptyOrPlaceholder =
                  !cur || cur === ASSISTANT_PLACEHOLDER;
                return {
                  ...m,
                  content: emptyOrPlaceholder ? message : cur,
                };
              }),
            );
          }
          setAgentStatus("idle");
          setSubmitting(false);
          continueInFlightRef.current = false;
        }
      },
      onTransportDisconnect: () => {
        setError("连接中断，正在恢复…");
        setAgentStatus("running");
        setSubmitting(true);
        if (reconnectAttemptRef.current < 1) {
          reconnectAttemptRef.current += 1;
          queueMicrotask(() => {
            // Hub subscribeTurn replays the full buffer; clear live deltas so
            // onToken/mergeThinking/tool handlers do not duplicate content/steps.
            const id = currentAssistantIdRef.current ?? lastId;
            setMessages((prev) =>
              updateMessageById(prev, id, (m) => ({
                ...m,
                content: "",
                process: continueStartProcessRef.current,
              })),
            );
            attachContinueStream();
          });
        } else {
          setError("连接中断，请重试");
          setAgentStatus("idle");
          setSubmitting(false);
          continueInFlightRef.current = false;
        }
      },
    };

    function attachContinueStream() {
      const myFlight: ContinueFlight = {
        handlers,
        currentMessageId: currentAssistantIdRef.current ?? lastId,
      };
      continueFlightByProject.set(project.id, myFlight);
      const releaseIfOwned = () => {
        if (continueFlightByProject.get(project.id) === myFlight) {
          continueFlightByProject.delete(project.id);
        }
      };
      void consumeEngineerStream(project.id, { action: "continue" }, {
        onStatus: (phase) =>
          continueFlightByProject.get(project.id)?.handlers.onStatus?.(phase),
        onSpeaker: (data) =>
          continueFlightByProject.get(project.id)?.handlers.onSpeaker?.(data),
        onTask: (data) =>
          continueFlightByProject.get(project.id)?.handlers.onTask?.(data),
        onThinking: (text) =>
          continueFlightByProject.get(project.id)?.handlers.onThinking?.(text),
        onTool: (ev) =>
          continueFlightByProject.get(project.id)?.handlers.onTool?.(ev),
        onToken: (text) =>
          continueFlightByProject.get(project.id)?.handlers.onToken(text),
        onDone: (data) => {
          continueFlightByProject.get(project.id)?.handlers.onDone(data);
          releaseIfOwned();
        },
        onError: (message) => {
          continueFlightByProject.get(project.id)?.handlers.onError(message);
          releaseIfOwned();
        },
        onTransportDisconnect: () => {
          continueFlightByProject
            .get(project.id)
            ?.handlers.onTransportDisconnect?.();
        },
      }).finally(() => {
        // Do not delete a newer reconnect flight that replaced this one.
        releaseIfOwned();
      });
    }

    const existing = continueFlightByProject.get(project.id);
    if (existing) {
      // Strict Mode remount: adopt in-flight stream; do not start a second continue.
      existing.handlers = handlers;
      currentAssistantIdRef.current = existing.currentMessageId;
      return;
    }

    attachContinueStream();
  }, [project.id, initialMessages, fetchPreview, applySpeaker, applyTaskEvent]);

  async function handleRebuild() {
    await fetch(`/api/projects/${project.id}/preview/build`, {
      method: "POST",
    });
    await fetchPreview(false);
  }

  async function handleModeChange(next: string) {
    if (next !== "engineer" && next !== "team") return;
    const prev = mode;
    setMode(next);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) {
        setMode(prev);
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          typeof data?.error === "string" ? data.error : "切换模式失败",
        );
      }
    } catch {
      setMode(prev);
      setError("切换模式失败");
    }
  }

  async function handleSend() {
    if (!draft.trim() || submitting) return;
    const content = draft.trim();
    setSubmitting(true);
    setAgentStatus("thinking");
    setError(null);
    setDraft("");
    const tempUser = {
      id: `local_user_${Date.now()}`,
      projectId: project.id,
      role: "user" as const,
      content,
      createdAt: new Date().toISOString(),
    };
    const tempAsstId = `local_asst_${Date.now()}`;
    const tempAssistant = {
      id: tempAsstId,
      projectId: project.id,
      role: "assistant" as const,
      content: "",
      createdAt: new Date().toISOString(),
      agentName: mode === "team" ? "Mike" : "Alex",
    };
    currentAssistantIdRef.current = tempAsstId;
    setMessages((prev) => [...prev, tempUser, tempAssistant]);

    await consumeEngineerStream(
      project.id,
      { action: "send", content },
      {
        onStatus: (phase) => {
          setAgentStatus(phase);
        },
        onSpeaker: (data) => {
          applySpeaker(data);
        },
        onTask: (data) => {
          applyTaskEvent(data);
        },
        onThinking: (text) => {
          const id = currentAssistantIdRef.current;
          if (!id) return;
          setMessages((prev) =>
            updateMessageById(prev, id, (m) => mergeThinking(m, text)),
          );
        },
        onTool: (ev) => {
          const id = currentAssistantIdRef.current;
          if (!id) return;
          setMessages((prev) =>
            updateMessageById(prev, id, (m) => applyToolStep(m, ev)),
          );
        },
        onToken: (text) => {
          const id = currentAssistantIdRef.current;
          if (!id) return;
          setMessages((prev) =>
            updateMessageById(prev, id, (m) => ({
              ...m,
              content: (m.content ?? "") + text,
            })),
          );
        },
        onDone: (data) => {
          const id = currentAssistantIdRef.current;
          if (id) {
            setMessages((prev) =>
              updateMessageById(prev, id, (m) => ({
                ...m,
                id: data.messageId,
              })),
            );
            currentAssistantIdRef.current = data.messageId;
          }
          setAgentStatus("idle");
          setSubmitting(false);
          if (data.previewEnqueued) void fetchPreview(false);
        },
        onError: (message) => {
          setError(message);
          const transport = message.includes("连接中断");
          if (!transport) {
            const id = currentAssistantIdRef.current;
            if (id) {
              setMessages((prev) =>
                updateMessageById(prev, id, (m) => ({
                  ...m,
                  content: m.content || message,
                })),
              );
            }
          }
          setAgentStatus("idle");
          setSubmitting(false);
        },
        onTransportDisconnect: () => {
          setError("连接中断，请重试");
          setAgentStatus("idle");
          setSubmitting(false);
        },
      },
    );
  }

  const chatWidthStyle = {
    ["--chat-pct" as string]: `${chatPct}%`,
  } as CSSProperties;

  const lastMessageId = messages.at(-1)?.id;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={splitRef}
        className="flex min-h-0 flex-1 flex-col xl:flex-row"
        style={chatWidthStyle}
      >
        <section className="flex min-h-[50vh] w-full min-w-0 flex-col border-b border-border xl:min-h-0 xl:w-[var(--chat-pct)] xl:shrink-0 xl:border-b-0">
          <PanelHeader
            title="对话"
            trailing={<StatusBadge status={agentStatus} />}
          />
          <div className="flex flex-1 flex-col overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center">
                <EmptyState
                  title="暂无消息"
                  description="在下方输入框发送第一条消息。"
                />
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    task={
                      message.taskId ? tasks[message.taskId] : undefined
                    }
                    thinkingOpen={
                      message.id === lastMessageId &&
                      message.role === "assistant" &&
                      agentStatus !== "idle"
                    }
                    showContentSkeleton={
                      message.id === lastMessageId &&
                      message.role === "assistant" &&
                      !message.content &&
                      agentStatus !== "idle"
                    }
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2 border-t border-border p-3">
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={handleSend}
              placeholder="输入消息…"
              submitting={submitting}
              submitLabel="发送"
              toolbar={
                <ComposerModeMenu
                  mode={mode}
                  disabled={submitting}
                  onModeChange={(next) => {
                    void handleModeChange(next);
                  }}
                />
              }
            />
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话与预览宽度"
          aria-valuemin={MIN_CHAT_PCT}
          aria-valuemax={MAX_CHAT_PCT}
          aria-valuenow={Math.round(chatPct)}
          tabIndex={0}
          className={cn(
            "relative z-10 hidden w-0 shrink-0 xl:block",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 after:cursor-col-resize",
            dragging && "before:bg-foreground/40",
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging(true);
            updateChatPctFromClientX(event.clientX);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              persistChatPct(chatPct - 2);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              persistChatPct(chatPct + 2);
            }
          }}
        />

        <section className="flex min-h-[50vh] min-w-0 flex-1 flex-col xl:min-h-0">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <Tabs
              value={viewerMode}
              onValueChange={(v) => {
                if (v === "preview" || v === "editor") persistViewerMode(v);
              }}
            >
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="text-xs">
                  应用查看器
                </TabsTrigger>
                <TabsTrigger value="editor" className="text-xs">
                  编辑器
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {viewerMode === "preview" ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={preview?.status ?? "idle"} />
                {preview?.status === "ready" ||
                preview?.status === "building" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRebuild()}
                  >
                    刷新
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {viewerMode === "editor" ? (
            <WorkspaceEditorPane projectId={project.id} />
          ) : (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col bg-background",
                preview?.status === "ready" ? "" : "justify-center p-4",
              )}
            >
              {preview?.status === "building" ? (
                <div className="flex flex-col items-center gap-4">
                  <Skeleton className="h-40 w-full max-w-md" />
                  <p className="text-sm text-muted-foreground">
                    正在构建预览…
                  </p>
                </div>
              ) : preview?.status === "ready" ? (
                <iframe
                  title="App Viewer"
                  className="h-full w-full flex-1 border-0 bg-background"
                  src={`/api/projects/${project.id}/preview/files/index.html?r=${preview.revision ?? "0"}`}
                />
              ) : preview?.status === "failed" ? (
                <EmptyState
                  title="预览构建失败"
                  description={preview.error ?? "构建失败，请稍后重试。"}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRebuild()}
                    >
                      重试
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="尚未构建预览"
                  description="预览空闲。打开工作台后将自动开始构建。"
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  task,
  thinkingOpen = false,
  showContentSkeleton = false,
}: {
  message: Message;
  task?: Task;
  thinkingOpen?: boolean;
  showContentSkeleton?: boolean;
}) {
  const isUser = message.role === "user";
  const effectiveName = message.agentName ?? "Alex";
  const role = agentRoleLabel(effectiveName);
  const label = isUser
    ? "你"
    : role
      ? `${effectiveName} | ${role}`
      : effectiveName;

  if (message.versionId != null && message.versionNumber != null) {
    return (
      <li className="mr-8 flex flex-col items-start gap-1">
        <VersionCard number={message.versionNumber} summary={message.content} />
      </li>
    );
  }

  if (isUser) {
    return (
      <li className="ml-8 flex flex-col items-end gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
      </li>
    );
  }

  const steps = message.process?.steps ?? [];
  const phases = groupProcessPhases(steps);
  const stepCount = phases.length;

  return (
    <li className="mr-8 flex flex-col items-start gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
        {task ? (
          <TaskCard
            title={task.title}
            assignee={task.assignee}
            status={task.status}
          />
        ) : null}
        {stepCount > 0 ? (
          <details className="group mb-2" open={thinkingOpen}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              {/* Check sits on the same vertical axis as the dashed rail */}
              <CheckCircle2
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">已处理 {stepCount} 步</span>
              <ChevronUp
                aria-hidden
                className="size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-0 -rotate-180"
              />
            </summary>
            {/* ml-[7px] = half of size-3.5 so rail centers under the check */}
            <div className="relative ml-[7px] mt-2">
              <div
                aria-hidden
                className="absolute bottom-2 left-0 top-0 border-l border-dashed border-border/70"
              />
              <ol className="space-y-5 pl-4">
                {phases.map((phase) => (
                  <li key={phase.key} className="relative space-y-1.5">
                    <span
                      aria-hidden
                      className="absolute -left-4 top-1.5 size-1.5 -translate-x-1/2 rounded-full bg-muted-foreground/45 ring-2 ring-card"
                    />
                    {phase.thinking ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                        {phase.thinking}
                      </p>
                    ) : null}
                    {phase.tools.length > 0 ? (
                      <ToolCallGroup tools={phase.tools} />
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ) : null}

        {message.content ? (
          <MarkdownBody content={message.content} />
        ) : showContentSkeleton ? (
          <Skeleton className="h-4 w-2/3" />
        ) : null}
      </div>
    </li>
  );
}

type ToolProcessStep = Extract<
  NonNullable<Message["process"]>["steps"][number],
  { type: "tool" }
>;

type ProcessPhase = {
  key: string;
  thinking?: string;
  tools: ToolProcessStep[];
};

/** Group consecutive thinking + following tools into one timeline step. */
function groupProcessPhases(
  steps: NonNullable<Message["process"]>["steps"],
): ProcessPhase[] {
  const phases: ProcessPhase[] = [];
  let i = 0;
  while (i < steps.length) {
    const start = i;
    const thinkingParts: string[] = [];
    while (i < steps.length && steps[i]!.type === "thinking") {
      thinkingParts.push(
        (steps[i] as { type: "thinking"; text: string }).text,
      );
      i += 1;
    }
    const tools: ToolProcessStep[] = [];
    while (i < steps.length && steps[i]!.type === "tool") {
      tools.push(steps[i] as ToolProcessStep);
      i += 1;
    }
    if (thinkingParts.length === 0 && tools.length === 0) break;
    phases.push({
      key: `phase-${start}`,
      ...(thinkingParts.length > 0
        ? { thinking: thinkingParts.join("\n") }
        : {}),
      tools,
    });
  }
  return phases;
}
