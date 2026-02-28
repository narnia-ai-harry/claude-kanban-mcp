export type ConflictRisk = "low" | "medium" | "high";

export interface ConflictSummary {
  ticketFiles: string[];
  commandFiles: string[];
  overlapFiles: string[];
  risk: ConflictRisk;
  reasons: string[];
}

function uniqSorted(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

export function summarizeConflictRisk(ticketFiles: string[], commandFiles: string[]): ConflictSummary {
  const normalizedTicketFiles = uniqSorted(ticketFiles);
  const normalizedCommandFiles = uniqSorted(commandFiles);
  const commandSet = new Set(normalizedCommandFiles);
  const overlapFiles = normalizedTicketFiles.filter((f) => commandSet.has(f));
  const reasons: string[] = [];

  let risk: ConflictRisk = "low";
  if (overlapFiles.length > 0) {
    risk = "high";
    reasons.push(`Overlapping changed files detected (${overlapFiles.length})`);
  } else if (normalizedTicketFiles.length >= 15 || normalizedCommandFiles.length >= 15) {
    risk = "medium";
    reasons.push("Large change set size increases merge complexity");
  } else if (normalizedTicketFiles.length === 0) {
    reasons.push("Ticket branch has no file changes against merge base");
  }

  return {
    ticketFiles: normalizedTicketFiles,
    commandFiles: normalizedCommandFiles,
    overlapFiles,
    risk,
    reasons,
  };
}

