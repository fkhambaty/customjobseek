import { readFileSync, existsSync } from "node:fs";
import { detectBoard } from "../shared/engine/boards";
import { employerKey } from "../shared/engine/catalog";
import type { CatalogEmployer } from "../shared/engine/sourceCatalog";
import { sourceById } from "../shared/engine/sources";
import { d1, ROOT } from "./cloud.mjs";

async function upsertEmployers(supplied: CatalogEmployer[], scanPriority: number): Promise<{ added: number; updated: number; skipped: number }> {
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
    const existing = (await d1(
      `SELECT id, sectors FROM companies
       WHERE career_url = ? OR (ats = ? AND lower(board_token) = lower(?))
       LIMIT 1`,
      [board.careerUrl, board.ats, board.token],
    )) as { id: string; sectors: string }[];
    const now = new Date().toISOString();
    const sectorsJson = JSON.stringify(employer.sectors);
    if (existing[0]) {
      // Prefer non-empty curated sectors when the live row is still untagged.
      let sectors = sectorsJson;
      try {
        const current = JSON.parse(existing[0].sectors || "[]");
        if (Array.isArray(current) && current.length > 0 && (!employer.sectors || !employer.sectors.length)) {
          sectors = existing[0].sectors;
        }
      } catch {
        /* keep curated */
      }
      await d1(
        `UPDATE companies SET name = ?, country = ?, sectors = ?, source_url = ?, normalized_domain = ?,
         verified_at = COALESCE(verified_at, ?), active = 1, scan_priority = MAX(scan_priority, ?)
         WHERE id = ?`,
        [employer.name, employer.country, sectors, employer.careerUrl, key, now, scanPriority, existing[0].id],
      );
      updated++;
      continue;
    }
    await d1(
      `INSERT INTO companies
       (id, name, career_url, ats, board_token, country, sectors, source_url, normalized_domain, verified_at, active, scan_priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        crypto.randomUUID(),
        employer.name,
        board.careerUrl,
        board.ats,
        board.token,
        employer.country,
        sectorsJson,
        employer.careerUrl,
        key,
        now,
        scanPriority,
      ],
    );
    added++;
  }
  return { added, updated, skipped };
}

async function main(): Promise<void> {
  const curatedPath = new URL("shared/data/source-catalog.json", ROOT);
  const industryPath = new URL("shared/data/industry-employer-catalog.json", ROOT);
  const commandcenterPath = new URL("shared/data/commandcenter-boards.json", ROOT);
  const curated = JSON.parse(readFileSync(curatedPath, "utf8")) as CatalogEmployer[];
  const industry = existsSync(industryPath) ? (JSON.parse(readFileSync(industryPath, "utf8")) as CatalogEmployer[]) : [];
  const commandcenter = existsSync(commandcenterPath) ? (JSON.parse(readFileSync(commandcenterPath, "utf8")) as CatalogEmployer[]) : [];

  const a = await upsertEmployers(curated, 10);
  console.log(`Curated boards (${curated.length}): ${a.added} added, ${a.updated} updated, ${a.skipped} skipped.`);

  if (industry.length) {
    const b = await upsertEmployers(industry, 6);
    console.log(`Industry boards (${industry.length}): ${b.added} added, ${b.updated} updated, ${b.skipped} skipped.`);
  }
  if (commandcenter.length) {
    const c = await upsertEmployers(commandcenter, 8);
    console.log(`Command Center boards (${commandcenter.length}): ${c.added} added, ${c.updated} updated, ${c.skipped} skipped.`);
  }
}

void main();
