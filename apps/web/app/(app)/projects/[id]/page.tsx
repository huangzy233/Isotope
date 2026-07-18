import { WorkbenchShell } from "@/components/workbench-shell";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkbenchShell projectId={id} />;
}
