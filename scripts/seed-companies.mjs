// Adds the career boards already verified in the Command Center to the public
// scan list. Only company names and public board links are copied. Re-running
// skips boards that are already listed; the hourly scan reads the new ones.
//
//   node scripts/seed-companies.mjs

import { readFileSync } from "node:fs";
import { d1 } from "./cloud.mjs";

const CC = process.env.COMMAND_CENTER ?? "/Users/fakhruddinkhambaty/Desktop/FK";
const boards = JSON.parse(readFileSync(`${CC}/engine/config.json`, "utf8")).boards;

function tidy(token) {
  return token
    .replace(/\d+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function greenhouseName(token) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  } catch {
    return null;
  }
}

const rows = [];
for (const token of boards.greenhouse?.companies ?? []) {
  rows.push({ ats: "greenhouse", token, url: `https://boards.greenhouse.io/${token}`, name: (await greenhouseName(token)) ?? tidy(token) });
}
for (const token of boards.lever?.companies ?? []) {
  rows.push({ ats: "lever", token, url: `https://jobs.lever.co/${token}`, name: tidy(token) });
}
for (const token of boards.ashby?.companies ?? []) {
  rows.push({ ats: "ashby", token, url: `https://jobs.ashbyhq.com/${token}`, name: tidy(token) });
}
for (const token of boards.workable?.companies ?? []) {
  rows.push({ ats: "workable", token, url: `https://apply.workable.com/${token}`, name: tidy(token) });
}
for (const token of boards.smartrecruiters?.companies ?? []) {
  rows.push({ ats: "smartrecruiters", token, url: `https://jobs.smartrecruiters.com/${token}`, name: tidy(token) });
}
for (const [tenant, site] of boards.workday?.tenants ?? []) {
  const host = `${tenant}.myworkdayjobs.com`;
  rows.push({ ats: "workday", token: host, url: `https://${host}/${site}`, name: tidy(tenant.split(".")[0]) });
}

let added = 0;
for (const r of rows) {
  const existing = await d1("SELECT id FROM companies WHERE career_url = ?", [r.url]);
  if (existing.length) continue;
  await d1("INSERT INTO companies (id, name, career_url, ats, board_token) VALUES (?, ?, ?, ?, ?)", [
    crypto.randomUUID(),
    r.name,
    r.url,
    r.ats,
    r.token,
  ]);
  added++;
}
console.log(`${rows.length} verified boards found, ${added} added to the scan list.`);
