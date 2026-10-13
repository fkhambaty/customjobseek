import { readFileSync } from "node:fs";
import { detectBoard } from "../shared/engine/boards";
import { dedupeEmployers, employerKey, type EmployerSeed } from "../shared/engine/catalog";
import { d1, ROOT } from "./cloud.mjs";

async function verify(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "CustomJobSeek catalog verifier/1.0", range: "bytes=0-1024" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const path = new URL("shared/data/india-employers.json", ROOT);
  const supplied = JSON.parse(readFileSync(path, "utf8")) as EmployerSeed[];
  const catalog = dedupeEmployers(supplied);
  const verified = new Map<string, boolean>();
  const concurrency = 8;
  for (let start = 0; start < catalog.length; start += concurrency) {
    await Promise.all(catalog.slice(start, start + concurrency).map(async (employer) => {
      verified.set(employer.careerUrl, await verify(employer.careerUrl));
    }));
  }

  let added = 0;
  let updated = 0;
  let offline = 0;
  for (const employer of catalog) {
    const board = detectBoard(employer.careerUrl);
    if (!board) continue;
    const careerUrl = board.ats === "website" ? employer.careerUrl : board.careerUrl;
    const key = employerKey(employer.careerUrl);
    if (!key) continue;
    const isVerified = verified.get(employer.careerUrl) === true;
    if (!isVerified) offline++;
    const existing = await d1(
      `SELECT id FROM companies
       WHERE career_url = ? OR (ats = ? AND board_token = ?) OR (normalized_domain != '' AND normalized_domain = ?)
       LIMIT 1`,
      [careerUrl, board.ats, board.token, key],
    ) as { id: string }[];
    const now = new Date().toISOString();
    if (existing[0]) {
      await d1(
        `UPDATE companies SET name = ?, country = 'IN', sectors = ?, source_url = ?, normalized_domain = ?,
         verified_at = CASE WHEN ? = 1 THEN ? ELSE verified_at END,
         active = CASE WHEN ? = 1 THEN 1 ELSE active END, scan_priority = MAX(scan_priority, 10)
         WHERE id = ?`,
        [employer.name, JSON.stringify(employer.sectors), employer.careerUrl, key, isVerified ? 1 : 0, now, isVerified ? 1 : 0, existing[0].id],
      );
      updated++;
      continue;
    }
    await d1(
      `INSERT INTO companies
       (id, name, career_url, ats, board_token, country, sectors, source_url, normalized_domain, verified_at, active, scan_priority)
       VALUES (?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, 10)`,
      [
        crypto.randomUUID(), employer.name, careerUrl, board.ats, board.token, JSON.stringify(employer.sectors),
        employer.careerUrl, key, isVerified ? now : null, isVerified ? 1 : 0,
      ],
    );
    added++;
  }
  await d1(
    `UPDATE companies SET country = 'IN', source_url = CASE WHEN source_url = '' THEN career_url ELSE source_url END,
     verified_at = COALESCE(verified_at, ?), active = 1, scan_priority = MAX(scan_priority, 5)
     WHERE EXISTS (
       SELECT 1 FROM openings o WHERE o.company_id = companies.id AND (
         LOWER(o.location) LIKE '%india%' OR LOWER(o.location) LIKE '%bengaluru%' OR
         LOWER(o.location) LIKE '%bangalore%' OR LOWER(o.location) LIKE '%hyderabad%' OR
         LOWER(o.location) LIKE '%pune%' OR LOWER(o.location) LIKE '%gurugram%' OR
         LOWER(o.location) LIKE '%gurgaon%' OR LOWER(o.location) LIKE '%noida%' OR
         LOWER(o.location) LIKE '%mumbai%' OR LOWER(o.location) LIKE '%chennai%' OR
         LOWER(o.location) LIKE '%kolkata%' OR LOWER(o.location) LIKE '%ahmedabad%'
       )
     )`,
    [new Date().toISOString()],
  );
  console.log(`${catalog.length} India employers checked: ${added} added, ${updated} updated, ${offline} need URL review.`);
}

void main();
