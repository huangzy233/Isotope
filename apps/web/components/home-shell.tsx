"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function HomeShell() {
  const router = useRouter();
  const [requirement, setRequirement] = useState("");
  const [mode, setMode] = useState("engineer");
  const [submitting, setSubmitting] = useState(false);

  function handleStart() {
    if (!requirement.trim() || submitting) return;
    setSubmitting(true);
    // P0：仍跳转 mock 项目；mode 暂不持久化
    router.push(`/projects/demo?mode=${encodeURIComponent(mode)}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="space-y-8">
        <section className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            从一句话开始构建
          </h1>
          <p className="text-sm text-muted-foreground">
            选择模式，描述需求，进入工作台继续迭代
          </p>
        </section>

        <Composer
          value={requirement}
          onChange={setRequirement}
          onSubmit={handleStart}
          placeholder="例如：做一个待办清单，支持分组与截止时间…"
          submitLabel="开始"
          submittingLabel="进入中…"
          submitting={submitting}
          toolbar={
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="engineer">Engineer</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">我的项目</h2>
            <span className="text-xs text-muted-foreground">即将接入</span>
          </div>
          <EmptyState
            title="还没有项目"
            description="描述需求并点击「开始」，即可进入演示工作台"
          />
        </section>
      </div>
    </main>
  );
}
