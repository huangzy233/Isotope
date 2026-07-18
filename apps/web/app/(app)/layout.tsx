import { listProjects } from "@isotope/application";
import { AppShell } from "@/components/app-shell";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const projects = listProjects(
    { ownerUserId: session.username },
    getWorkspace(),
  ).map((p) => ({
    id: p.id,
    name: p.name,
    mode: p.mode,
    updatedAt: p.updatedAt,
  }));

  return (
    <AppShell username={session.username} projects={projects}>
      {children}
    </AppShell>
  );
}
