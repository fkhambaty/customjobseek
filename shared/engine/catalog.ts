import { detectBoard } from "./boards";

export interface EmployerSeed {
  name: string;
  careerUrl: string;
  sectors: string[];
}

export function employerKey(rawUrl: string): string | null {
  const board = detectBoard(rawUrl);
  if (!board) return null;
  if (board.ats !== "website") return `${board.ats}:${board.token.toLowerCase()}`;
  return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
}

export function dedupeEmployers(rows: EmployerSeed[]): EmployerSeed[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = employerKey(row.careerUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
