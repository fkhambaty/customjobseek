/**
 * Seeds the Unimorph Data Modeler external outreach role for Fakhruddin.
 *   node scripts/seed-external-unimorph.mjs
 */
import { d1 } from "./cloud.mjs";
import { parseExternalOpportunity } from "../shared/engine/externalOpportunity.ts";

const EMAIL = "fakhruddinkhambaty@gmail.com";
const RAW = `Amol Barsagade
Founder , Director Unimorph Consulting

Hello Fakhruddin,
I have reviewed your profile on LInkedIN, We have below position as Data modeler for Pune loc. Let me know if interested.

Role : Data Modeler
Exp : 7-10 Yrs
Location : Pune
Type : Contractor | Full time

# Key Skills :
enterprise data modeling, dimensional modeling, data warehousing, cloud data platforms, and modern Lakehouse architectures,Modern Data modeling Datavault,
fact & dimension design, unity catalog, logical data modeling, dimensional modeling, lakehouse architecture, relational data modeling, databricks / delta lake, physical data modeling, master & reference data modeling, ER modeling, Data vault modeling, normalization / denormalization

Interested candidates can share resume at "info@unimorphtech.com"`;

const parsed = parseExternalOpportunity(RAW);
const users = await d1("SELECT id FROM users WHERE lower(email) = ?", [EMAIL.toLowerCase()]);
if (!users[0]) throw new Error(`No user ${EMAIL}`);
const userId = users[0].id;

const existing = await d1(
  `SELECT id, status FROM jobs WHERE user_id = ? AND company LIKE '%Unimorph%' AND title LIKE '%Data Modeler%' LIMIT 5`,
  [userId],
);
if (existing[0]) {
  console.log("Already present:", existing[0]);
  process.exit(0);
}

const id = `ext:unimorph-data-modeler-${crypto.randomUUID().slice(0, 8)}`;
const fit = {
  score: 72,
  decision: "apply",
  imported: true,
  matchedRequired: ["data modeling", "dimensional modeling", "data warehousing", "lakehouse"],
  matchedOther: ["databricks", "delta lake"],
  missingRequired: [],
  missingOther: [],
  blockers: [],
  notes: ["External LinkedIn outreach from Amol Barsagade (Unimorph Consulting).", "Contact: info@unimorphtech.com"],
  jdYearsRequired: 7,
  parsedSalary: null,
};

await d1(
  `INSERT INTO jobs (
     id, user_id, title, company, location, url, salary_text, description, status, fit_json, notes,
     lane, route, pay_low, pay_high, pay_estimated, contact_count, details_ciphertext, created_at, updated_at
   ) VALUES (?, ?, ?, ?, ?, '', '', ?, 'resume_ready', ?, ?, 'Pune', 'External', NULL, NULL, 1, 0, '', datetime('now'), datetime('now'))`,
  [
    id,
    userId,
    parsed.title || "Data Modeler",
    parsed.company || "Unimorph Consulting",
    parsed.location || "Pune",
    parsed.description,
    JSON.stringify(fit),
    "LinkedIn outreach · Amol Barsagade · info@unimorphtech.com",
  ],
);

console.log(`Created ${id} for ${EMAIL}: ${parsed.title} @ ${parsed.company}`);
console.log("Open the job in CustomJobSeek and use Resume → Build to tailor the pack (uses your resume credit).");
