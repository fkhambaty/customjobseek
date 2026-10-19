import { readFileSync, writeFileSync } from "node:fs";

const CC = process.env.COMMAND_CENTER ?? "C:/Users/FK/Documents/GitHub/commandcenter";
const cfg = JSON.parse(readFileSync(`${CC}/engine/config.json`, "utf8"));
const boards = cfg.boards ?? {};
const sectors = ["data", "software", "IT services", "technology", "cloud"];
const rows = [];
const seen = new Set();

function add(name, careerUrl, country = "IN") {
  const key = careerUrl.toLowerCase().replace(/\/$/, "");
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ name, careerUrl, country, sectors });
}

function title(slug) {
  return String(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

for (const slug of boards.greenhouse?.companies ?? []) {
  add(title(slug), `https://boards.greenhouse.io/${slug}`);
}
for (const slug of boards.ashby?.companies ?? []) {
  add(title(slug), `https://jobs.ashbyhq.com/${slug}`);
}
for (const slug of boards.lever?.companies ?? []) {
  add(title(slug), `https://jobs.lever.co/${slug}`);
}
for (const slug of boards.workable?.companies ?? []) {
  add(title(slug), `https://apply.workable.com/${slug}`);
}
for (const slug of boards.smartrecruiters?.companies ?? []) {
  add(title(slug), `https://jobs.smartrecruiters.com/${slug}`);
}
const workdaySites = {
  "barclays.wd3": "External_Career_Site_Barclays",
};
for (const tenant of boards.workday?.tenants ?? []) {
  const host = tenant[0];
  const site = workdaySites[host] || tenant[1];
  if (!host || !site) continue;
  const name = host.split(".")[0];
  add(title(name), `https://${host}.myworkdayjobs.com/${site}`);
}

add("Siemens", "https://jobs.siemens.com/en_US/externaljobs");
add("HCA Healthcare", "https://hcahr.darwinbox.in/ms/candidatev2/main/careers");
add("UKG", "https://apply.ukg.com/careers");
add("EULER", "https://euler.breezy.hr");
add("Lear Corporation", "https://jobs.lear.com");
add("Woolworths Group", "https://careers.woolworthsgroup.com.au");
add("phData", "https://boards.greenhouse.io/phdata");

const out = new URL("../shared/data/commandcenter-boards.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Wrote ${rows.length} boards to ${out.pathname}`);
