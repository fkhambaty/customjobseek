// Replaces every imported job's resume, and each standard resume, with the Command Center's
// own printed PDF and its source HTML. Safe to re-run; it never writes to the Command Center.
//
//   node scripts/sync-command-center-resumes.mjs

import { readFileSync } from "node:fs";
import { plannedJobs, standardBases, syncResumeFiles } from "./cc-resume-files.mjs";
import { ROOT, d1, envFile } from "./cloud.mjs";

const CC = process.env.COMMAND_CENTER ?? "/Users/fakhruddinkhambaty/Desktop/FK";
const dev = envFile(new URL(".dev.vars", ROOT));
const profile = JSON.parse(readFileSync(`${CC}/engine/profile.json`, "utf8"));
const jobs = JSON.parse(readFileSync(`${CC}/engine/jobs.json`, "utf8")).jobs;

const [user] = await d1("SELECT id FROM users WHERE email = ?", [String(profile.email).toLowerCase()]);
if (!user) throw new Error("No CustomJobSeek account for the Command Center email. Run the seed script first.");

const result = await syncResumeFiles({
  dataKey: dev.DATA_KEY,
  userId: user.id,
  planned: plannedJobs(jobs, CC),
  bases: standardBases(CC, user.id),
});
console.log(
  `Stored Command Center resume files: ${result.jobs} jobs, ${result.standard} standard resumes. ` +
    `${result.noFile} imported jobs had no resume file; ${result.notImported} Command Center jobs are not imported.`,
);
