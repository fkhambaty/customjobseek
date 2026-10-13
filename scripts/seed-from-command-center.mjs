// Reads the private Command Center on this machine and copies this user's own
// profile, jobs, per-job files, contacts, outreach history and resumes into
// their CustomJobSeek account. It never writes back to the Command Center.
// Contacts and files are encrypted and only ever visible to that account.
//
//   node scripts/seed-from-command-center.mjs
//   OVERWRITE_PROFILE=1 node scripts/seed-from-command-center.mjs   # also replace the profile
//
// Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and a database id in wrangler.jsonc.
// A new account starts with no usable password: use "Forgot password" with the same email.

import { readdirSync, readFileSync } from "node:fs";
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

// The profile is written once. After that it belongs to the person and edits on the site win.
await d1(
  `INSERT INTO profiles (user_id, ciphertext, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(user_id) DO ${process.env.OVERWRITE_PROFILE ? "UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at" : "NOTHING"}`,
  [userId, await encryptJson(profile)],
);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Applied 13 Sep 2026" -> "2026-09-13". */
function flagDate(flag, word) {
  const m = String(flag ?? "").match(new RegExp(`^${word}\\s+(\\d{1,2})\\s+([A-Za-z]{3})[a-z]*\\s+(\\d{4})`));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

function termList(text, label) {
  const m = String(text ?? "").match(new RegExp(`${label}:?\\s*([^.]+)\\.`, "i"));
  return m ? m[1].split(/,\s*/).map((t) => strip(t)).filter((t) => t && t.length < 40) : [];
}

function readIf(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The per-job resume the Command Center tailored, else its standard one. */
function resumeHtml(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith("_Resume.html"));
  const tailored = files.find((f) => f !== "FakhruddinKhambaty_Resume.html");
  const pick = tailored ?? files[0];
  return pick ? readIf(`${dir}${pick}`) : null;
}

function contactsOf(job) {
  const people = (job.contacts ?? [])
    .filter((c) => c && c.name)
    .map((c, i) => ({ id: `p${i}`, name: strip(c.name).slice(0, 120), role: "", url: String(c.url ?? "").startsWith("https://") ? c.url : "", email: "" }));
  const mailboxes = (job.emails ?? [])
    .map(String)
    .filter((e) => !/do not use/i.test(e))
    .map((e, i) => {
      const address = (e.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) ?? [""])[0];
      return { id: `m${i}`, name: "", role: strip(e.replace(address, "").replace(/^[\s—–-]+/, "")).slice(0, 160), url: "", email: address };
    })
    .filter((c) => c.email);
  return [...people, ...mailboxes];
}

const STATUS = { applied: "applied", rejected: "rejected", closed: "closed", toapply: "resume_ready", blocked: "withdrawn" };
const at = (date) => (date ? `${date}T12:00:00.000Z` : null);

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

const usedIds = new Set();
const planned = jobs.map((job) => {
  let id = `cc:${job.id}`.slice(0, 170);
  while (usedIds.has(id)) id = `${id}-${usedIds.size}`.slice(0, 180);
  usedIds.add(id);
  return { job, id };
});

let packs = 0;
await pool(planned, 6, async ({ job, id }) => {
  let status = STATUS[job.status] ?? "evaluated";
  if (job.stage === "interview") status = "interview";
  const appliedOn =
    flagDate(job.flag, "Applied") ?? (["applied", "rejected", "interview"].includes(status) || job.closed_after_apply ? job.added : null);
  const rejectedOn = status === "rejected" ? flagDate(job.flag, "Rejected") : null;
  const closedOn = status === "closed" ? flagDate(job.flag, "Closed") : null;
  const folder = `${CC}/${job.folder.replace(/^\.\//, "")}`;
  const jd = readIf(`${folder}JOB_DESCRIPTION.md`);
  const low = job.salary_low ?? job.band_low;
  const high = job.salary_high ?? job.band_high;
  const salary = job.salary_low && job.salary_high ? `₹${job.salary_low}–${job.salary_high} LPA` : "";
  const description = (jd ?? [`${job.role} at ${job.company}`, job.location ? `Location: ${job.location}` : ""].join("\n")).slice(0, 30000);
  const score = job.screening_score ?? job.screening_probability ?? 0;
  const matched = Object.values(job.screening_matches ?? {}).flat().map(strip);
  const fit = {
    score: Math.max(0, Math.min(100, Math.round(score))),
    decision: score >= 65 ? "apply" : "stretch",
    imported: true,
    matchedRequired: [...new Set([...matched, ...termList(job.fit, "Also matched")])].slice(0, 20),
    matchedOther: [],
    missingRequired: [...new Set([...termList(job.fit, "NOT EVIDENCED in the record"), ...(job.screening_gaps ?? []).map(strip)])].slice(0, 15),
    missingOther: [],
    blockers: [],
    notes: [strip(job.flag), ...(job.screening_gate ? [strip(job.screening_gate)] : [])].filter(Boolean),
    jdYearsRequired: null,
    parsedSalary: null,
  };
  const contacts = contactsOf(job);
  const details = {
    verification: strip(job.verification),
    compensation: strip(job.compensation),
    payNote: strip(job.band_note),
    fitNarrative: strip(job.fit),
    evidence: (job.screening_evidence ?? []).map(strip),
    warnings: (job.warnings ?? []).map(strip),
    contacts,
    liveCheck: job.live_check ? { verdict: job.live_check.verdict ?? "", evidence: job.live_check.evidence ?? "", on: job.live_check.on ?? "" } : null,
  };
  const lakh = (n) => (typeof n === "number" ? n * 100_000 : null);

  await d1(
    `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, status, fit_json, notes,
       applied_at, rejected_at, closed_at, posted_at, lane, requisition, pay_low, pay_high, pay_estimated, contact_count, details_ciphertext,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, fit_json = excluded.fit_json, salary_text = excluded.salary_text,
       description = excluded.description, applied_at = excluded.applied_at, rejected_at = excluded.rejected_at,
       closed_at = excluded.closed_at, posted_at = excluded.posted_at, lane = excluded.lane, requisition = excluded.requisition,
       pay_low = excluded.pay_low, pay_high = excluded.pay_high, pay_estimated = excluded.pay_estimated,
       contact_count = excluded.contact_count, details_ciphertext = excluded.details_ciphertext, updated_at = datetime('now')`,
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
      rejectedOn,
      closedOn,
      /^\d{4}-\d{2}-\d{2}$/.test(job.posted_on ?? "") ? job.posted_on : null,
      strip(job.lane),
      strip(job.requisition_id ?? job.job_id).slice(0, 80),
      lakh(low),
      lakh(high),
      job.salary_low ? 0 : 1,
      contacts.length,
      await encryptJson(details),
      at(job.added),
    ],
  );

  // History rows from the import carry a cc- id so a re-run replaces them without touching events logged on the site.
  await d1("DELETE FROM job_events WHERE job_id = ? AND id LIKE 'cc-%'", [id]);
  const none = { person: "", note: "" };
  const events = [];
  if (appliedOn) events.push(["status", "applied", "", at(appliedOn), none]);
  if (rejectedOn) events.push(["status", "rejected", "", at(rejectedOn), none]);
  if (closedOn) events.push(["status", "closed", "", at(closedOn), none]);
  if (status === "interview") events.push(["status", "interview", "", at(job.stage_on ?? job.added), none]);
  for (const o of job.outreach ?? []) {
    const channel = ["linkedin", "email", "phone", "referral"].includes(o.channel) ? o.channel : "other";
    events.push(["message", "", channel, at(o.on ?? job.added), { person: strip(o.to), note: strip(o.note) }]);
    if (o.reply) {
      const replyOn = typeof o.reply === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.reply) ? o.reply.slice(0, 10) : o.on;
      events.push(["reply", "", channel, at(replyOn ?? job.added), { person: strip(o.to), note: typeof o.reply === "string" ? strip(o.reply) : "" }]);
    }
  }
  if (/^(Recruiter call|Technical screening)/.test(job.flag ?? "")) events.push(["reply", "", "other", at(job.added), { person: "", note: strip(job.flag) }]);
  for (const [i, [kind, st, channel, when, body]] of events.entries()) {
    await d1("INSERT INTO job_events (id, job_id, user_id, kind, status, channel, at, ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      `cc-${i}-${id}`.slice(0, 200),
      id,
      userId,
      kind,
      st,
      channel,
      when ?? at(job.added),
      await encryptJson(body),
    ]);
  }

  const files = [
    ["resume_html", resumeHtml(folder)],
    ["application_md", readIf(`${folder}APPLICATION_PACK.md`)],
    ["jd_md", jd],
    ["status_md", readIf(`${folder}JOB_STATUS.md`)],
  ].filter(([, body]) => body);
  for (const [kind, body] of files) {
    await d1(
      `INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext`,
      [id, userId, kind, await encryptJson(body.slice(0, 400_000))],
    );
    packs++;
  }
});

const bases = [["Generic resume", `${CC}/Generic_Resume_Platinum/FakhruddinKhambaty_Generic_Resume_Platinum.html`]];
for (const dir of readdirSync(`${CC}/Resumes_Standard`, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const label = dir.name.replace(/^\d+_/, "").replace(/_/g, " ");
  bases.push([label, `${CC}/Resumes_Standard/${dir.name}/FakhruddinKhambaty_Resume.html`]);
}
let baseCount = 0;
for (const [i, [label, path]] of bases.entries()) {
  const html = readIf(path);
  if (!html) continue;
  await d1(
    `INSERT INTO resume_uploads (id, user_id, filename, label, format, text_ciphertext) VALUES (?, ?, ?, ?, 'html', ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, text_ciphertext = excluded.text_ciphertext`,
    [`cc-base-${i}-${userId}`, userId, path.split("/").pop(), label, await encryptJson({ text: html })],
  );
  baseCount++;
}
const n = planned.length;
console.log(`${packs} job files and ${baseCount} base resumes stored.`);

if (process.env.SITE_URL) {
  const res = await fetch(`${process.env.SITE_URL}/api/auth/forgot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) console.error("Could not send the password email", res.status);
}

console.log(`Imported profile and ${n} jobs for ${email}. A code to set the password is in that inbox when SITE_URL is set.`);
