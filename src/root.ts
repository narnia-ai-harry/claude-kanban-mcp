import { execFileSync } from "node:child_process";

let cached: string | undefined;

export function projectRoot(): string {
  if (cached) return cached;
  if (process.env.KANBAN_ROOT) {
    cached = process.env.KANBAN_ROOT;
    return cached;
  }
  try {
    cached = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
    return cached;
  } catch {
    cached = process.cwd();
    return cached;
  }
}
