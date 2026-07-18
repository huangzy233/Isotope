"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ASSISTANT_PLACEHOLDER } from "@isotope/application/placeholder";
import type { Message, Project } from "@isotope/workspace";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { PanelHeader } from "@/components/panel-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DEFAULT_CHAT_PCT = 33.333;
const MIN_CHAT_PCT = 22;
const MAX_CHAT_PCT = 55;
const SPLIT_STORAGE_KEY = "isotope.workbench.chatPct";

type PreviewSnapshot = {
  status: "idle" | "building" | "ready" | "failed";
  revision: string | null;
  error: string | null;
  updatedAt: string;
};

function clampChatPct(value: number) {
  return Math.min(MAX_CHAT_PCT, Math.max(MIN_CHAT_PCT, value));
}

type StreamHandlers = {
  onToken: (text: string) => void;
  onDone: (data: {
    messageId: string;
    filesChanged: boolean;
    previewEnqueued: boolean;
  }) => void;
  onError: (message: string) => void;
};

/** Strict Mode remount: first continue owns the SSE; later mounts rebind handlers. */
const continueFlightByProject = new Map<string, { handlers: StreamHandlers }>();
/** Projects with an open continue SSE body (409 from a duplicate continue is ignored). */
const continueSseOpen = new Set<string>();

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
          handlers.onError("连接中断，请重试");
          return;
        }
        if (event === "token" && typeof data.text === "string") {
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
      handlers.onError("连接中断，请重试");
    }
  } catch {
    handlers.onError("连接中断，请重试");
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
  const [error, setError] = useState<string | null>(null);
  const [chatPct, setChatPct] = useState(DEFAULT_CHAT_PCT);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const continuedRef = useRef(false);
  const continueInFlightRef = useRef(false);

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
    continuedRef.current = true;
    continueInFlightRef.current = true;
    setSubmitting(true);
    setMessages((prev) => {
      const copy = [...prev];
      const i = copy.length - 1;
      copy[i] = { ...copy[i]!, content: "" };
      return copy;
    });

    const handlers: StreamHandlers = {
      onToken: (text) => {
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          copy[i] = {
            ...copy[i]!,
            content: (copy[i]?.content ?? "") + text,
          };
          return copy;
        });
      },
      onDone: (data) => {
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          copy[i] = { ...copy[i]!, id: data.messageId };
          return copy;
        });
        setSubmitting(false);
        continueInFlightRef.current = false;
        if (data.previewEnqueued) void fetchPreview(false);
      },
      onError: (message) => {
        setError(message);
        setMessages((prev) => {
          const copy = [...prev];
          const i = copy.length - 1;
          if (copy[i]) {
            const cur = copy[i]!.content;
            const emptyOrPlaceholder =
              !cur || cur === ASSISTANT_PLACEHOLDER;
            copy[i] = {
              ...copy[i]!,
              content: emptyOrPlaceholder ? message : cur,
            };
          }
          return copy;
        });
        setSubmitting(false);
        continueInFlightRef.current = false;
      },
    };

    const existing = continueFlightByProject.get(project.id);
    if (existing) {
      // Strict Mode remount: adopt in-flight stream; do not start a second continue.
      existing.handlers = handlers;
      return;
    }

    continueFlightByProject.set(project.id, { handlers });
    void consumeEngineerStream(project.id, { action: "continue" }, {
      onToken: (text) =>
        continueFlightByProject.get(project.id)?.handlers.onToken(text),
      onDone: (data) => {
        continueFlightByProject.get(project.id)?.handlers.onDone(data);
        continueFlightByProject.delete(project.id);
      },
      onError: (message) => {
        continueFlightByProject.get(project.id)?.handlers.onError(message);
        continueFlightByProject.delete(project.id);
      },
    }).finally(() => {
      continueFlightByProject.delete(project.id);
    });
  }, [project.id, initialMessages, fetchPreview]);

  async function handleRebuild() {
    await fetch(`/api/projects/${project.id}/preview/build`, {
      method: "POST",
    });
    await fetchPreview(false);
  }

  async function handleSend() {
    if (!draft.trim() || submitting) return;
    const content = draft.trim();
    setSubmitting(true);
    setError(null);
    setDraft("");
    const tempUser = {
      id: `local_user_${Date.now()}`,
      projectId: project.id,
      role: "user" as const,
      content,
      createdAt: new Date().toISOString(),
    };
    const tempAssistant = {
      id: `local_asst_${Date.now()}`,
      projectId: project.id,
      role: "assistant" as const,
      content: "",
      createdAt: new Date().toISOString(),
      agentName: "Alex",
    };
    setMessages((prev) => [...prev, tempUser, tempAssistant]);

    await consumeEngineerStream(
      project.id,
      { action: "send", content },
      {
        onToken: (text) => {
          setMessages((prev) => {
            const copy = [...prev];
            const i = copy.length - 1;
            copy[i] = {
              ...copy[i]!,
              content: (copy[i]?.content ?? "") + text,
            };
            return copy;
          });
        },
        onDone: (data) => {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...copy[copy.length - 1]!,
              id: data.messageId,
            };
            return copy;
          });
          setSubmitting(false);
          if (data.previewEnqueued) void fetchPreview(false);
        },
        onError: (message) => {
          setError(message);
          setMessages((prev) => {
            const copy = [...prev];
            const i = copy.length - 1;
            if (copy[i]?.role === "assistant") {
              copy[i] = {
                ...copy[i]!,
                content: copy[i]!.content || message,
              };
            }
            return copy;
          });
          setSubmitting(false);
        },
      },
    );
  }

  const chatWidthStyle = {
    ["--chat-pct" as string]: `${chatPct}%`,
  } as CSSProperties;

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
            trailing={<StatusBadge status="idle" />}
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
                  <MessageRow key={message.id} message={message} />
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
          <PanelHeader
            title="App Viewer"
            trailing={
              <>
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
              </>
            }
          />
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col bg-background",
              preview?.status === "ready" ? "" : "justify-center p-4",
            )}
          >
            {preview?.status === "building" ? (
              <div className="flex flex-col items-center gap-4">
                <Skeleton className="h-40 w-full max-w-md" />
                <p className="text-sm text-muted-foreground">正在构建预览…</p>
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
        </section>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const label = isUser ? "你" : (message.agentName ?? "Alex");

  return (
    <li
      className={
        isUser
          ? "ml-8 flex flex-col items-end gap-1"
          : "mr-8 flex flex-col items-start gap-1"
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div
        className={
          isUser
            ? "rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
            : "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        }
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </li>
  );
}
