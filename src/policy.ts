function normalizeActor(by: string): string {
  return by.trim().toLowerCase();
}

export function assertQualityCaller(tool: string, by: string): void {
  const caller = normalizeActor(by);
  if (caller !== "quality") {
    throw new Error(`${tool} can only be called by quality. Received by="${by}".`);
  }
}

export function assertLeaderCaller(tool: string, by: string): void {
  const caller = normalizeActor(by);
  if (caller !== "leader") {
    throw new Error(`${tool} can only be called by leader. Received by="${by}".`);
  }
}

