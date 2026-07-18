export type PreviewStatus = "idle" | "building" | "ready" | "failed";

export type PreviewStatusSnapshot = {
  status: PreviewStatus;
  revision: string | null;
  error: string | null;
  updatedAt: string;
};

export type PreviewAsset = {
  body: Buffer;
  contentType: string;
};

export type ResolveProjectPaths = (
  projectId: string,
) => { workspaceDir: string; buildDir: string } | null;

export type PreviewService = {
  getStatus(projectId: string): PreviewStatusSnapshot;
  ensureBuild(projectId: string): PreviewStatusSnapshot;
  enqueueBuild(projectId: string): PreviewStatusSnapshot;
  readAsset(
    projectId: string,
    relativePath: string,
  ): PreviewAsset | null; // null if not ready / missing / escape
};
