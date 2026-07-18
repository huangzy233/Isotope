export type TurnHubListener = (event: unknown) => void;

const MAX_BUFFER_EVENTS = 200;

type Hub = {
  buffer: unknown[];
  listeners: Set<TurnHubListener>;
};

const hubs = new Map<string, Hub>();

export function ensureTurnHub(projectId: string): void {
  if (hubs.has(projectId)) return;
  hubs.set(projectId, { buffer: [], listeners: new Set() });
}

export function destroyTurnHub(projectId: string): void {
  hubs.delete(projectId);
}

export function isTurnHubActive(projectId: string): boolean {
  return hubs.has(projectId);
}

export function publishTurnEvent(projectId: string, event: unknown): void {
  const hub = hubs.get(projectId);
  if (!hub) return;
  hub.buffer.push(event);
  if (hub.buffer.length > MAX_BUFFER_EVENTS) {
    hub.buffer.splice(0, hub.buffer.length - MAX_BUFFER_EVENTS);
  }
  for (const listener of [...hub.listeners]) {
    try {
      listener(event);
    } catch {
      hub.listeners.delete(listener);
    }
  }
}

export function subscribeTurn(
  projectId: string,
  listener: TurnHubListener,
): (() => void) | null {
  const hub = hubs.get(projectId);
  if (!hub) return null;
  for (const event of hub.buffer) {
    try {
      listener(event);
    } catch {
      return () => {};
    }
  }
  hub.listeners.add(listener);
  return () => {
    hub.listeners.delete(listener);
  };
}
