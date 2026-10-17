/**
 * Backfills fakhruddinkhambaty@gmail.com pipeline rows from the local Command Center.
 * Updates status / applied / rejected / closed timestamps from CC (source of truth for cc: jobs).
 * Does not need DATA_KEY for plaintext fields; encrypted packs/details are left alone when already present.
 *
 *   COMMAND_CENTER=C:\Users\FK\Documents\GitHub\commandcenter node scripts/backfill-from-command-center.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { d1, envFile, ROOT } from "./cloud.mjs";

const CC = process.env.COMMAND_CENTER ?? "C:/Users/FK/Documents/GitHub/commandcenter";
const EMAIL = (process.env.SEED_EMAIL ?? "fakhruddinkhambaty@gmail.com").toLowerCase();

const STATUS = { applied: "applied", rejected: "rejected", closed: "closed", toapply: "resume_ready", blocked: "withdrawn" };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function strip(s) {
  return String(s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function flagDate(flag, word) {
  const m = String(flag ?? "").match(new RegExp(`^${word}\\s+(\\d{1,2})\\s+([A-Za-z]{3})[a-z]*\\s+(\\d{4})`));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

function at(date) {
  return date ? `${date}T12:00:00.000Z` : null;
}

function readIf(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function plannedJobs(jobs) {
  const used = new Set();
  return jobs.map((job) => {
    let id = `cc:${job.id}`.slice(0, 170);
    while (used.has(id)) id = `${id}-${used.size}`.slice(0, 180);
    used.add(id);
    return { job, id, folder: `${CC}/${String(job.folder ?? "").replace(/^\.\//, "")}` };
  });
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

if (!existsSync(`${CC}/engine/jobs.json`)) {
  throw new Error(`Command Center jobs.json not found at ${CC}/engine/jobs.json`);
}

const jobs = JSON.parse(readFileSync(`${CC}/engine/jobs.json`, "utf8")).jobs;
const users = await d1("SELECT id, email FROM users WHERE lower(email) = ?", [EMAIL]);
if (!users[0]) throw new Error(`No CustomJobSeek user for ${EMAIL}`);
const userId = users[0].id;
const planned = plannedJobs(jobs);

let inserted = 0;
let updated = 0;
const byStatus = {};

await pool(planned, 8, async ({ job, id, folder }) => {
  let status = STATUS[job.status] ?? "evaluated";
  if (job.stage === "interview") status = "interview";
  byStatus[status] = (byStatus[status] ?? 0) + 1;

  const appliedOn =
    flagDate(job.flag, "Applied") ?? (["applied", "rejected", "interview"].includes(status) || job.closed_after_apply ? job.added : null);
  const rejectedOn = status === "rejected" ? flagDate(job.flag, "Rejected") : null;
  const closedOn = status === "closed" ? flagDate(job.flag, "Closed") : null;
  const jd = readIf(`${folder}/JOB_DESCRIPTION.md`) ?? readIf(`${folder}JOB_DESCRIPTION.md`);
  const description = (jd ?? `${job.role} at ${job.company}\nLocation: ${job.location ?? ""}`).slice(0, 30000);
  const low = job.salary_low ?? job.band_low;
  const high = job.salary_high ?? job.band_high;
  const salary = job.salary_low && job.salary_high ? `₹${job.salary_low}–${job.salary_high} LPA` : "";
  const score = job.screening_score ?? job.screening_probability ?? 0;
  const fit = {
    score: Math.max(0, Math.min(100, Math.round(score))),
    decision: score >= 65 ? "apply" : "stretch",
    imported: true,
    matchedRequired: [],
    matchedOther: [],
    missingRequired: [],
    missingOther: [],
    blockers: [],
    notes: [strip(job.flag)].filter(Boolean),
    jdYearsRequired: null,
    parsedSalary: null,
  };
  const lakh = (n) => (typeof n === "number" ? n * 100_000 : null);
  const existing = await d1("SELECT id FROM jobs WHERE id = ? AND user_id = ?", [id, userId]);

  if (existing[0]) {
    await d1(
      `UPDATE jobs SET title = ?, company = ?, location = ?, url = ?, salary_text = ?,
        description = CASE WHEN length(description) >= 150 THEN description ELSE ? END,
        status = ?, fit_json = ?, applied_at = ?, rejected_at = ?, closed_at = ?,
        posted_at = ?, lane = ?, requisition = ?,
        pay_low = COALESCE(?, pay_low), pay_high = COALESCE(?, pay_high),
        pay_estimated = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [
        strip(job.role).slice(0, 200) || "Untitled",
        strip(job.company).slice(0, 200),
        strip(job.location).slice(0, 200),
        strip(job.apply_url).slice(0, 1000),
        salary,
        description,
        status,
        JSON.stringify(fit),
        at(appliedOn),
        rejectedOn ? at(rejectedOn) : null,
        closedOn ? at(closedOn) : null,
        /^\d{4}-\d{2}-\d{2}$/.test(job.posted_on ?? "") ? job.posted_on : null,
        strip(job.lane),
        strip(job.requisition_id ?? job.job_id).slice(0, 80),
        lakh(low),
        lakh(high),
        job.salary_low ? 0 : 1,
        id,
        userId,
      ],
    );
    updated++;
  } else {
    await d1(
      `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, status, fit_json, notes,
         applied_at, rejected_at, closed_at, posted_at, lane, requisition, pay_low, pay_high, pay_estimated, contact_count, details_ciphertext,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, datetime('now'))`,
      [
        id,
        userId,
        strip(job.role).slice(0, 200) || "Untitled",
        strip(job.company).slice(0, 200),
        strip(job.location).slice(0, 200),
        strip(job.apply_url).slice(0, 1000),
        salary,
        description,
        status,
        JSON.stringify(fit),
        at(appliedOn),
        rejectedOn ? at(rejectedOn) : null,
        closedOn ? at(closedOn) : null,
        /^\d{4}-\d{2}-\d{2}$/.test(job.posted_on ?? "") ? job.posted_on : null,
        strip(job.lane),
        strip(job.requisition_id ?? job.job_id).slice(0, 80),
        lakh(low),
        lakh(high),
        job.salary_low ? 0 : 1,
        at(job.added) ?? new Date().toISOString(),
      ],
    );
    inserted++;
  }
});

const counts = await d1(
  `SELECT status, COUNT(*) AS n FROM jobs WHERE user_id = ? AND id LIKE 'cc:%' GROUP BY status ORDER BY n DESC`,
  [userId],
);
console.log(`Backfill for ${EMAIL} (${userId}) from ${CC}`);
console.log(`CC jobs: ${planned.length}. Inserted ${inserted}, updated ${updated}.`);
console.log("CC status mix:", byStatus);
console.log("CJS cc: status counts:", Object.fromEntries(counts.map((r) => [r.status, r.n])));
