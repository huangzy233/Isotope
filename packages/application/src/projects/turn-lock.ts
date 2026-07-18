const locks = new Set<string>();

export function tryAcquireTurnLock(projectId: string): boolean {
  if (locks.has(projectId)) return false;
  locks.add(projectId);
  return true;
}

export function releaseTurnLock(projectId: string): void {
  locks.delete(projectId);
}
