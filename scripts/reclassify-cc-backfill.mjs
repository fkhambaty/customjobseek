/**
 * For fakhruddinkhambaty@gmail.com:
 * - Restore applied/rejected/closed/interview visibility (clear accidental archive).
 * - Move CC to-apply rows that fail current pay/path filters → status `backfill`.
 * - Re-apply interview stage from Command Center when present.
 *
 *   COMMAND_CENTER=... node scripts/reclassify-cc-backfill.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { d1 } from "./cloud.mjs";

const CC = process.env.COMMAND_CENTER ?? "C:/Users/FK/Documents/GitHub/commandcenter";
const EMAIL = (process.env.SEED_EMAIL ?? "fakhruddinkhambaty@gmail.com").toLowerCase();
/** Roles under this midpoint (₹ LPA) do not qualify for current targeting. */
const FLOOR_LPA = Number(process.env.BACKFILL_FLOOR_LPA ?? 25);

const users = await d1("SELECT id, email FROM users WHERE lower(email) = ?", [EMAIL]);
if (!users[0]) throw new Error(`No user for ${EMAIL}`);
const userId = users[0].id;

const jobs = await d1(
  `SELECT id, title, company, status, lane, pay_low, pay_high, archived_at
   FROM jobs WHERE user_id = ?`,
  [userId],
);

function midLpa(row) {
  const low = row.pay_low == null ? null : Number(row.pay_low) / 100_000;
  const high = row.pay_high == null ? null : Number(row.pay_high) / 100_000;
  if (low != null && high != null) return (low + high) / 2;
  if (low != null) return low;
  if (high != null) return high;
  return null;
}

function failsFilters(row) {
  const lane = String(row.lane ?? "");
  if (/below the line/i.test(lane)) return true;
  const mid = midLpa(row);
  if (mid != null && mid < FLOOR_LPA) return true;
  return false;
}

let toBackfill = 0;
let unarchived = 0;
let keptTodo = 0;

for (const row of jobs) {
  const openTodo = row.status === "resume_ready" || row.status === "evaluated";
  if (openTodo && failsFilters(row)) {
    await d1(
      `UPDATE jobs SET status = 'backfill', archived_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [row.id, userId],
    );
    toBackfill++;
    continue;
  }
  if (row.archived_at && ["applied", "rejected", "closed", "withdrawn", "interview", "offer", "resume_ready", "evaluated"].includes(row.status)) {
    await d1(`UPDATE jobs SET archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [row.id, userId]);
    unarchived++;
  }
  if (openTodo) keptTodo++;
}

// Restore interview from Command Center when CJS lost the stage.
if (existsSync(`${CC}/engine/jobs.json`)) {
  const ccJobs = JSON.parse(readFileSync(`${CC}/engine/jobs.json`, "utf8")).jobs ?? [];
  let interviews = 0;
  for (const job of ccJobs) {
    if (job.stage !== "interview" && job.status !== "interview") continue;
    const id = `cc:${job.id}`.slice(0, 170);
    const hit = await d1(
      `UPDATE jobs SET status = 'interview', archived_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
    if (hit) interviews++;
  }
  console.log(`Interview rows restored from CC: ${interviews}`);
}

const counts = await d1(
  `SELECT status, COUNT(*) AS n, SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS open_n
   FROM jobs WHERE user_id = ? GROUP BY status ORDER BY n DESC`,
  [userId],
);
console.log(`User ${EMAIL}`);
console.log(`Moved to backfill: ${toBackfill}. Unarchived history: ${unarchived}. Still to-apply: ${keptTodo}.`);
console.log("Status counts:", Object.fromEntries(counts.map((r) => [r.status, `${r.n} (${r.open_n} open)`])));
