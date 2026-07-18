"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function HomeShell() {
  const [requirement, setRequirement] = useState("");
  const [mode, setMode] = useState("engineer");

  return (
    <main className="mx-auto w-full max-w-page px-6 py-16">
      <div className="mx-auto max-w-2xl space-y-16">
        <section className="space-y-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            从一句话开始构建
          </h1>
          <p className="text-sm text-muted-foreground">
            选择模式，描述需求，进入工作台继续迭代
          </p>
        </section>

        <section className="space-y-6 rounded-lg border border-border bg-card p-8 shadow-soft">
          <div className="space-y-2">
            <label
              htmlFor="requirement"
              className="text-sm font-medium text-foreground"
            >
              需求描述
            </label>
            <Textarea
              id="requirement"
              placeholder="例如：做一个待办清单，支持分组与截止时间…"
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="engineer">Engineer</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button asChild className="sm:min-w-28">
              <Link href="/projects/demo">开始</Link>
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">我的项目</h2>
            <span className="text-xs text-muted-foreground">即将接入</span>
          </div>
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/60 px-6 text-center">
            <p className="text-sm font-medium text-foreground">还没有项目</p>
            <p className="text-sm text-muted-foreground">
              描述需求并点击「开始」，即可进入演示工作台
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
