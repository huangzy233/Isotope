"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FolderKanban,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Trash2,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type SidebarProject = {
  id: string;
  name: string;
  mode: string;
  updatedAt: string;
};

export function AppSidebar({
  username,
  projects,
  collapsed,
  onToggleCollapsed,
}: {
  username: string;
  projects: SidebarProject[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<SidebarProject | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setPendingDelete(null);
      router.refresh();
      if (pathname === `/projects/${id}`) {
        router.push("/");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "justify-between gap-2 px-3",
          )}
        >
          {!collapsed ? (
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2 transition-opacity duration-150 hover:opacity-80"
            >
              <BrandMark className="h-6 w-6 shrink-0" />
              <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                Isotope
              </span>
            </Link>
          ) : (
            <Link
              href="/"
              className="flex h-7 w-7 items-center justify-center transition-opacity duration-150 hover:opacity-80"
              aria-label="Isotope"
            >
              <BrandMark className="h-6 w-6" />
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {!collapsed ? (
            <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              项目
            </p>
          ) : null}
          {projects.length === 0 ? (
            !collapsed ? (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">
                暂无项目
              </p>
            ) : null
          ) : (
            <ul className="space-y-1">
              {projects.map((project) => {
                const href = `/projects/${project.id}`;
                const active = pathname === href;
                return (
                  <li key={project.id} className="group relative">
                    <Link
                      href={href}
                      className={cn(
                        "flex items-center rounded-lg text-[15px] font-medium leading-snug transition-colors duration-150",
                        collapsed
                          ? "justify-center px-0 py-2.5"
                          : "gap-2.5 py-2.5 pl-2.5 pr-9",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent/70",
                      )}
                      title={project.name}
                    >
                      <FolderKanban
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      {collapsed ? null : (
                        <span className="min-w-0 truncate">{project.name}</span>
                      )}
                    </Link>
                    {!collapsed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPendingDelete(project);
                        }}
                        aria-label={`删除 ${project.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border p-2",
            collapsed
              ? "flex flex-col items-center gap-1"
              : "flex items-center justify-between gap-2",
          )}
        >
          {!collapsed ? (
            <span className="min-w-0 truncate px-1 text-xs text-muted-foreground">
              {username}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label={loggingOut ? "退出中" : "退出"}
            title={loggingOut ? "退出中…" : "退出"}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </aside>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `确定删除「${pendingDelete.name}」？此操作不可恢复。`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
