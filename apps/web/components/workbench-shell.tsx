"use client";

import { useState } from "react";
import type { Message, Project } from "@isotope/workspace";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { PanelHeader } from "@/components/panel-header";
import { StatusBadge } from "@/components/status-badge";

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

  async function handleSend() {
    if (!draft.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${project.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        messages?: Message[];
        error?: string;
      } | null;

      if (!res.ok || !data?.messages?.length) {
        setError(
          typeof data?.error === "string" ? data.error : "发送失败，请稍后重试",
        );
        setSubmitting(false);
        return;
      }

      setMessages((prev) => [...prev, ...data.messages!]);
      setDraft("");
    } catch {
      setError("发送失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">项目</p>
          <h1 className="truncate text-sm font-semibold text-foreground">
            {project.name}
          </h1>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          模式：{project.mode}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-[50vh] flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
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
          <div className="space-y-2 border-t border-border p-4">
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

        <section className="flex min-h-[50vh] flex-col lg:min-h-0">
          <PanelHeader
            title="App Viewer"
            trailing={<StatusBadge status="idle" />}
          />
          <div className="flex flex-1 flex-col justify-center bg-background p-4">
            <EmptyState
              title="预览区"
              description="下一步接入 preview / 自动构建"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const label = isUser
    ? "你"
    : (message.agentName ?? "Alex");

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
