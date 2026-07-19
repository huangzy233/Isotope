export type PreviewLike = {
  status: string;
  revision: string | null;
} | null | undefined;

export type VersionLike = {
  previewRevision: string | null;
};

export function canOpenPreview(
  version: VersionLike,
  preview: PreviewLike,
): boolean {
  return (
    preview?.status === "ready" &&
    version.previewRevision != null &&
    version.previewRevision === preview.revision
  );
}

export function previewAvailabilityLabel(
  version: VersionLike,
  preview: PreviewLike,
): "可预览" | "产物已覆盖" | "无预览" {
  if (version.previewRevision == null) return "无预览";
  if (canOpenPreview(version, preview)) return "可预览";
  return "产物已覆盖";
}
