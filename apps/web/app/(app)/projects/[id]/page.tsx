import { notFound } from "next/navigation";
import { getProject, listMessages } from "@isotope/application";
import { WorkbenchShell } from "@/components/workbench-shell";
import { readSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await readSession();
  if (!session) notFound();
  const workspace = getWorkspace();
  const project = getProject(
    { ownerUserId: session.username, projectId: id },
    workspace,
  );
  if (!project) notFound();
  const messages =
    listMessages(
      { ownerUserId: session.username, projectId: id },
      workspace,
    ) ?? [];
  return <WorkbenchShell project={project} initialMessages={messages} />;
}
