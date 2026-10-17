import { writeFileSync } from "node:fs";
import { parseExternalOpportunity } from "../shared/engine/externalOpportunity.ts";

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

Interested candidates can share resume at info@unimorphtech.com`;

const p = parseExternalOpportunity(RAW);
const id = "ext:unimorph-data-modeler-2026-10-17";
const esc = (s) => String(s).replace(/'/g, "''");
const fit = esc(
  JSON.stringify({
    score: 72,
    decision: "apply",
    imported: true,
    matchedRequired: ["data modeling", "dimensional modeling", "data warehousing", "lakehouse"],
    matchedOther: ["databricks", "delta lake"],
    missingRequired: [],
    missingOther: [],
    blockers: [],
    notes: [
      "External LinkedIn outreach from Amol Barsagade (Unimorph Consulting).",
      "Contact: info@unimorphtech.com",
    ],
    jdYearsRequired: 7,
    parsedSalary: null,
  }),
);

const sql = `DELETE FROM jobs WHERE user_id = '1b0eb504-c61b-4f34-a4f5-6e8ac1b6a061' AND id = '${id}';
INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, status, fit_json, notes, lane, route, pay_low, pay_high, pay_estimated, contact_count, details_ciphertext, created_at, updated_at)
VALUES ('${id}', '1b0eb504-c61b-4f34-a4f5-6e8ac1b6a061', '${esc(p.title || "Data Modeler")}', '${esc(p.company || "Unimorph Consulting")}', '${esc(p.location || "Pune")}', '', '', '${esc(p.description)}', 'resume_ready', '${fit}', '${esc("LinkedIn outreach · Amol Barsagade · info@unimorphtech.com")}', 'Pune', 'External', NULL, NULL, 1, 0, '', datetime('now'), datetime('now'));
SELECT id, title, company, status, route FROM jobs WHERE id = '${id}';
`;

writeFileSync(new URL("./_seed-unimorph.sql", import.meta.url), sql);
console.log("OK", p.title, p.company, p.description.length);
