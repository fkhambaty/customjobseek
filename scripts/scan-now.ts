// Scans every supported board once, from this machine, using the same reader as the hourly job.
// Run: npx esbuild scripts/scan-now.ts --bundle --platform=node --format=esm --external:./cloud.mjs --outfile=scripts/.scan-now.mjs && node scripts/.scan-now.mjs; rm scripts/.scan-now.mjs
import type { Ats } from "../shared/engine/boards";
import { listOpenings } from "../worker/scan";
// @ts-expect-error plain JS helper shared with the seed scripts
import { d1 } from "./cloud.mjs";

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const query = d1 as Query;

interface Company {
  id: string;
  name: string;
  ats: Ats;
  board_token: string;
  career_url: string;
}

const ROWS_PER_INSERT = 15;

async function save(company: Company, openings: Awaited<ReturnType<typeof listOpenings>>): Promise<number> {
  const now = new Date().toISOString();
  const listed = openings.filter((o) => o.externalId && o.title).slice(0, 2000);
  await query("DELETE FROM openings WHERE company_id = ?", [company.id]);
  for (let i = 0; i < listed.length; i += ROWS_PER_INSERT) {
    const chunk = listed.slice(i, i + ROWS_PER_INSERT);
    await query(
      `INSERT OR REPLACE INTO openings (company_id, external_id, title, location, url, updated_at) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      chunk.flatMap((o) => [company.id, o.externalId, o.title.slice(0, 200), o.location.slice(0, 200), o.url.slice(0, 1000), now]),
    );
  }
  await query("UPDATE companies SET scan_status = 'ok', last_error = '', opening_count = ?, last_scan_at = ? WHERE id = ?", [listed.length, now, company.id]);
  return listed.length;
}

async function scan(company: Company): Promise<void> {
  try {
    const openings = await listOpenings({ ats: company.ats, token: company.board_token, careerUrl: company.career_url, nameHint: company.name });
    console.log(`${company.name.padEnd(32)} ${String(await save(company, openings)).padStart(5)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await query("UPDATE companies SET scan_status = 'error', last_error = ?, last_scan_at = ? WHERE id = ?", [message.slice(0, 300), new Date().toISOString(), company.id]);
    console.log(`${company.name.padEnd(32)} error: ${message}`);
  }
}

const companies = (await query(
  "SELECT id, name, ats, board_token, career_url FROM companies WHERE ats IN ('greenhouse','lever','ashby','workable','smartrecruiters') ORDER BY last_scan_at IS NOT NULL, last_scan_at",
)) as unknown as Company[];

const queue = [...companies];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) await scan(c);
}));
const [total] = await query("SELECT count(*) AS n FROM openings");
console.log(`\n${companies.length} boards read, ${String(total?.n)} openings stored.`);
