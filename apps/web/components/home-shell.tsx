"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectMode } from "@isotope/workspace";
import { Composer } from "@/components/composer";
import { ComposerModeMenu } from "@/components/composer-mode-menu";

export function HomeShell() {
  const router = useRouter();
  const [requirement, setRequirement] = useState("");
  const [mode, setMode] = useState<ProjectMode>("engineer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!requirement.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement, mode }),
      });
      const data = (await res.json().catch(() => null)) as {
        project?: { id: string };
        error?: string;
      } | null;

      if (!res.ok || !data?.project?.id) {
        setError(
          typeof data?.error === "string" ? data.error : "创建失败，请稍后重试",
        );
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${data.project.id}`);
    } catch {
      setError("创建失败，请稍后重试");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="space-y-6">
        <section className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            从一句话开始构建
          </h1>
          <p className="text-sm text-muted-foreground">
            选择模式，描述需求，进入工作台继续迭代
          </p>
        </section>

        <div className="space-y-2">
          <Composer
            value={requirement}
            onChange={setRequirement}
            onSubmit={handleStart}
            placeholder="例如：做一个待办清单，支持分组与截止时间…"
            submitLabel="开始"
            submittingLabel="创建中…"
            submitting={submitting}
            toolbar={
              <ComposerModeMenu
                mode={mode}
                disabled={submitting}
                onModeChange={setMode}
              />
            }
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
