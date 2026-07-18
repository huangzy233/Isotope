"use client";

import { Plus, Users } from "lucide-react";
import type { ProjectMode } from "@isotope/workspace";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function ComposerModeMenu({
  mode,
  onModeChange,
  disabled = false,
}: {
  mode: ProjectMode;
  onModeChange: (mode: ProjectMode) => void;
  disabled?: boolean;
}) {
  const teamOn = mode === "team";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          disabled={disabled}
          aria-label="模式与工具"
          title="模式与工具"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-1">
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5",
            "hover:bg-accent/60",
          )}
        >
          <Users
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <label
            htmlFor="composer-team-mode"
            className="min-w-0 flex-1 cursor-pointer text-sm text-foreground"
          >
            团队模式
          </label>
          <Switch
            id="composer-team-mode"
            checked={teamOn}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onModeChange(checked ? "team" : "engineer");
            }}
            aria-label="团队模式"
          />
        </div>
        {teamOn ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            当前：Team（Mike 分配任务）
          </p>
        ) : (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            当前：Engineer（Alex 直改）
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
