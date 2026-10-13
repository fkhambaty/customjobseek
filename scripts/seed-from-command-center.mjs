// Reads the private Command Center on this machine and copies this user's own
// profile and job history into their CustomJobSeek account. It never writes
// back to the Command Center, and it does not copy recruiter contact details.
//
//   node scripts/seed-from-command-center.mjs
//
// Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and a database id in wrangler.jsonc.
// After it runs, the account password is unset: use "Forgot password" with the same email.

import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { ROOT, d1, envFile } from "./cloud.mjs";

const CC = process.env.COMMAND_CENTER ?? "/Users/fakhruddinkhambaty/Desktop/FK";

const dev = envFile(new URL(".dev.vars", ROOT));

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${b64(salt)}$${b64(await pbkdf2(password, salt))}`;
}

async function encryptJson(value) {
  const raw = fromB64(dev.DATA_KEY);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(ct)}`;
}

function strip(s) {
  return String(s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

const profileJson = JSON.parse(readFileSync(`${CC}/engine/profile.json`, "utf8"));
const config = JSON.parse(readFileSync(`${CC}/engine/config.json`, "utf8"));
const jobs = JSON.parse(readFileSync(`${CC}/engine/jobs.json`, "utf8")).jobs;

const skills = [];
for (const items of Object.values(profileJson.capabilities ?? {})) {
  if (!Array.isArray(items)) continue;
  for (const item of items) {
    const name = strip(item).slice(0, 60);
    if (name && !skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) skills.push({ name, level: "working" });
  }
}

const experience = (profileJson.experience ?? []).map((exp, i) => {
  let dates = strip(exp.dates);
  const place = strip(exp.place);
  if (place && dates.includes(place)) dates = dates.replace(place, "").trim();
  const [start, end] = dates.split(/\s+[–—-]\s+/);
  return {
    id: `exp${i}`,
    company: strip(exp.company),
    title: strip(exp.title),
    location: place,
    start: start ?? "",
    end: (end ?? "").trim(),
    bullets: (exp.bullets ?? []).map((b, j) => ({ id: `exp${i}b${j}`, text: strip(b.text).slice(0, 400) })).filter((b) => b.text),
  };
});

const cities = (config.allowed_locations ?? [])
  .filter((c) => !["Remote", "OtherIndia"].includes(c))
  .map((c) => (c === "Bangalore" ? "Bengaluru" : c));

const profile = {
  fullName: profileJson.name,
  headline: strip(profileJson.headlines?.analytics_engineer ?? ""),
  email: profileJson.email,
  phone: profileJson.phone,
  links: [profileJson.linkedin, profileJson.youtube].filter(Boolean),
  summary: strip(profileJson.profile_paragraph).slice(0, 1500),
  totalYears: profileJson.years_experience ?? null,
  skills: skills.slice(0, 80),
  neverClaim: (config.claim_ceiling?.banned_phrases ?? []).map(strip).filter((s) => s.length <= 80),
  experience,
  education: strip(profileJson.education)
    .split("|")
    .map((part, i) => {
      const [degree, institution] = part.split(/\s+[—–-]\s+/);
      return { id: `edu${i}`, degree: strip(degree), institution: strip(institution), year: (part.match(/\b(19|20)\d{2}\b/) ?? [""])[0] };
    })
    .filter((e) => e.degree),
  certifications: (profileJson.certifications_catalog ?? []).map((c, i) => ({
    id: `cert${i}`,
    name: strip(c.name),
    issuer: strip(c.issuer),
    year: strip(c.issued),
  })),
  preferences: {
    country: "IN",
    cities,
    remoteOk: true,
    currency: "INR",
    // The private search has a higher floor in some cities. 30 is the lowest figure it still accepts.
    minSalary: 30,
    maxSalary: null,
    salaryPeriod: "lpa",
    targetRoles: ["Analytics Engineer", "Data Engineer", "BI Manager", "Data Architect"],
    excludedTitleWords: ["Intern", "Apprentice"],
  },
};

const STATUS = { applied: "applied", rejected: "rejected", closed: "closed", toapply: "evaluated", blocked: "withdrawn" };

const email = profile.email.toLowerCase();
const existing = await d1("SELECT id FROM users WHERE email = ?", [email]);
let userId = existing[0]?.id;
if (!userId) {
  userId = crypto.randomUUID();
  const password = b64(crypto.getRandomValues(new Uint8Array(24)));
  await d1(
    "INSERT INTO users (id, email, password_hash, email_verified, plan, eval_credits, resume_credits) VALUES (?, ?, ?, 0, 'free', 30, 15)",
    [userId, email, await hashPassword(password)],
  );
  await d1(
    "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, note) VALUES (?, 'grant', 30, 15, 'account created from existing search records')",
    [userId],
  );
}

await d1(
  `INSERT INTO profiles (user_id, ciphertext, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
  [userId, await encryptJson(profile)],
);

const fit = JSON.stringify({
  score: 0,
  decision: "stretch",
  imported: true,
  matchedRequired: [],
  matchedOther: [],
  missingRequired: [],
  missingOther: [],
  blockers: [],
  notes: ["Imported from your existing search records. Use Re-check fit to score this job."],
  jdYearsRequired: null,
  parsedSalary: null,
});

let n = 0;
const usedIds = new Set();
for (const job of jobs) {
  const status = STATUS[job.status] ?? "evaluated";
  let id = `cc:${job.id}`.slice(0, 170);
  while (usedIds.has(id)) id = `${id}-${usedIds.size}`.slice(0, 180);
  usedIds.add(id);
  const low = job.salary_low ?? job.band_low;
  const high = job.salary_high ?? job.band_high;
  const salary = low && high ? `${low}–${high} LPA` : low ? `${low} LPA` : "";
  const description = [`${job.role} at ${job.company}`, job.location ? `Location: ${job.location}` : "", strip(job.compensation).slice(0, 400)]
    .filter(Boolean)
    .join("\n");
  await d1(
    `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, status, fit_json, notes, applied_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, fit_json = excluded.fit_json, salary_text = excluded.salary_text,
       description = excluded.description, updated_at = datetime('now')`,
    [
      id,
      userId,
      strip(job.role).slice(0, 200) || "Untitled",
      strip(job.company).slice(0, 200),
      strip(job.location).slice(0, 200),
      strip(job.apply_url).slice(0, 1000),
      salary.slice(0, 200),
      description.slice(0, 5000),
      status,
      fit,
      status === "applied" ? `${job.added}T00:00:00.000Z` : null,
      `${job.added}T00:00:00.000Z`,
    ],
  );
  n += 1;
}

if (process.env.SITE_URL) {
  const res = await fetch(`${process.env.SITE_URL}/api/auth/forgot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) console.error("Could not send the password email", res.status);
}

console.log(`Imported profile and ${n} jobs for ${email}. A code to set the password is in that inbox when SITE_URL is set.`);
