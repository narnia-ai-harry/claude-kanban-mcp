import { execFileSync } from "node:child_process";

// ── Helper ──────────────────────────────────────────

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
}

// ── Query ───────────────────────────────────────────

export function getCurrentBranch(cwd?: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export function branchExists(name: string, cwd?: string): boolean {
  try {
    git(["rev-parse", "--verify", name], cwd);
    return true;
  } catch {
    return false;
  }
}

export function getChangedFiles(base: string, head: string, cwd?: string): string[] {
  const out = git(["diff", "--name-only", base, head], cwd);
  return out ? out.split("\n") : [];
}

export function getDiffStat(base: string, head: string, cwd?: string): string {
  return git(["diff", "--stat", base, head], cwd);
}

export function getMergeBase(left: string, right: string, cwd?: string): string {
  return git(["merge-base", left, right], cwd);
}

// ── Validate ────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateCommandBranch(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug "${slug}". Use lowercase alphanumeric + hyphens.`);
  }
  return `feat/${slug}`;
}

export function ticketBranchName(commandBranch: string, ticketId: string): string {
  return `${commandBranch}--${ticketId}`;
}

// ── Checkout ────────────────────────────────────────

export function checkout(branch: string, cwd?: string): void {
  git(["checkout", branch], cwd);
}

// ── Mutate ──────────────────────────────────────────

export function createBranch(name: string, base?: string, cwd?: string): void {
  if (branchExists(name, cwd)) {
    throw new Error(`Branch "${name}" already exists.`);
  }
  const args = ["checkout", "-b", name];
  if (base) args.push(base);
  git(args, cwd);
}

export function createWorktree(
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  cwd?: string
): void {
  if (branchExists(branchName, cwd)) {
    throw new Error(`Branch "${branchName}" already exists.`);
  }
  git(["worktree", "add", worktreePath, "-b", branchName, baseBranch], cwd);
}

const SENSITIVE_PATTERNS = [/\.env/, /\.pem$/, /\.key$/, /credentials/i, /secret/i];

export function commitAll(message: string, cwd?: string): { sha: string; warnings: string[] } {
  git(["add", "-A"], cwd);

  // Check for sensitive files
  const staged = git(["diff", "--cached", "--name-only"], cwd).split("\n").filter(Boolean);
  const warnings: string[] = [];
  for (const file of staged) {
    if (SENSITIVE_PATTERNS.some((p) => p.test(file))) {
      git(["reset", "HEAD", "--", file], cwd);
      warnings.push(`Unstaged sensitive file: ${file}`);
    }
  }

  git(["commit", "-m", message], cwd);
  const sha = git(["rev-parse", "--short", "HEAD"], cwd);
  return { sha, warnings };
}

export function squashMerge(source: string, message: string, cwd?: string): void {
  git(["merge", "--squash", source], cwd);
  git(["commit", "-m", message], cwd);
}

export function mergeNoFf(source: string, message: string, cwd?: string): void {
  git(["merge", "--no-ff", source, "-m", message], cwd);
}
