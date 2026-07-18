"use client";

import { useState } from "react";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { PanelHeader } from "@/components/panel-header";
import { StatusBadge } from "@/components/status-badge";

export function WorkbenchShell({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSend() {
    if (!draft.trim() || submitting) return;

    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setDraft("");
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">项目</p>
          <h1 className="truncate text-sm font-semibold text-foreground">
            {projectId}
          </h1>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-[50vh] flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
          <PanelHeader
            title="对话"
            trailing={<StatusBadge status="idle" />}
          />
          <div className="flex flex-1 flex-col justify-center overflow-y-auto p-4">
            <EmptyState
              title="暂无消息"
              description="下一步将接入 Agent 对话。可先在下方输入框预览发送区交互。"
            />
          </div>
          <div className="border-t border-border p-4">
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
              description="构建产物将在此实时展示"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
