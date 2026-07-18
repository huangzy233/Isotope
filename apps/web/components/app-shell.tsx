"use client";

import { useEffect, useState } from "react";
import {
  AppSidebar,
  type SidebarProject,
} from "@/components/app-sidebar";

const SIDEBAR_COLLAPSED_KEY = "isotope.sidebarCollapsed";

export function AppShell({
  username,
  projects,
  children,
}: {
  username: string;
  projects: SidebarProject[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === "true") setCollapsed(true);
      if (stored === "false") setCollapsed(false);
    } catch {
      // ignore storage errors
    }
  }, []);

  function handleToggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar
        username={username}
        projects={projects}
        collapsed={collapsed}
        onToggleCollapsed={handleToggleCollapsed}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {children}
      </main>
    </div>
  );
}
