"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer";
import { ComposerModeChips } from "@/components/composer-mode-chips";
import { ComposerModeMenu } from "@/components/composer-mode-menu";
import { Button } from "@/components/ui/button";
import { HOME_QUICK_STARTS } from "@/lib/home-quick-starts";

export function HomeShell() {
  const router = useRouter();
  const [requirement, setRequirement] = useState("");
  const [planEnabled, setPlanEnabled] = useState(false);
  const [teamEnabled, setTeamEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFlagsChange(next: {
    planEnabled: boolean;
    teamEnabled: boolean;
  }) {
    setPlanEnabled(next.planEnabled);
    setTeamEnabled(next.teamEnabled);
  }

  async function handleStart() {
    if (!requirement.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement, planEnabled, teamEnabled }),
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
      <div className="space-y-8">
        <section className="space-y-2 pt-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
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
            chips={
              <ComposerModeChips
                planEnabled={planEnabled}
                teamEnabled={teamEnabled}
                disabled={submitting}
                onFlagsChange={handleFlagsChange}
              />
            }
            toolbar={
              <ComposerModeMenu
                planEnabled={planEnabled}
                teamEnabled={teamEnabled}
                disabled={submitting}
                onFlagsChange={handleFlagsChange}
              />
            }
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">快捷开始</h2>
          <div className="flex flex-wrap gap-2">
            {HOME_QUICK_STARTS.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => setRequirement(item.prompt)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
