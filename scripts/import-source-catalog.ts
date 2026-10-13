import { readFileSync } from "node:fs";
import { detectBoard } from "../shared/engine/boards";
import { employerKey } from "../shared/engine/catalog";
import type { CatalogEmployer } from "../shared/engine/sourceCatalog";
import { sourceById } from "../shared/engine/sources";
import { d1, ROOT } from "./cloud.mjs";

async function main(): Promise<void> {
  const path = new URL("shared/data/source-catalog.json", ROOT);
  const supplied = JSON.parse(readFileSync(path, "utf8")) as CatalogEmployer[];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const employer of supplied) {
    const board = detectBoard(employer.careerUrl);
    if (!board || sourceById(board.ats).listing !== "live") {
      skipped++;
      continue;
    }
    const key = employerKey(employer.careerUrl);
    if (!key) {
      skipped++;
      continue;
    }
    const existing = await d1(
      `SELECT id FROM companies
       WHERE career_url = ? OR (ats = ? AND lower(board_token) = lower(?))
       LIMIT 1`,
      [board.careerUrl, board.ats, board.token],
    ) as { id: string }[];
    const now = new Date().toISOString();
    if (existing[0]) {
      await d1(
        `UPDATE companies SET name = ?, country = ?, sectors = ?, source_url = ?, normalized_domain = ?,
         verified_at = COALESCE(verified_at, ?), active = 1, scan_priority = MAX(scan_priority, 10)
         WHERE id = ?`,
        [employer.name, employer.country, JSON.stringify(employer.sectors), employer.careerUrl, key, now, existing[0].id],
      );
      updated++;
      continue;
    }
    await d1(
      `INSERT INTO companies
       (id, name, career_url, ats, board_token, country, sectors, source_url, normalized_domain, verified_at, active, scan_priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 10)`,
      [
        crypto.randomUUID(), employer.name, board.careerUrl, board.ats, board.token, employer.country,
        JSON.stringify(employer.sectors), employer.careerUrl, key, now,
      ],
    );
    added++;
  }
  console.log(`${supplied.length} curated boards: ${added} added, ${updated} updated, ${skipped} skipped.`);
}

void main();
