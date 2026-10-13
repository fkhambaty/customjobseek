import { aggregatorForHost } from "./sources";

export type Ats =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "workday"
  | "teamtailor"
  | "recruitee"
  | "icims"
  | "oracle_recruiting"
  | "successfactors"
  | "public_feed"
  | "licensed"
  | "aggregator"
  | "website";

export interface BoardRef {
  ats: Ats;
  token: string;
  careerUrl: string;
  nameHint: string;
}

function tidy(token: string): string {
  return token.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const TEAMTAILOR_RESERVED = new Set(["www", "api", "app", "support", "status", "blog", "partner", "help"]);
const RECRUITEE_RESERVED = new Set(["www", "api", "app", "docs", "support", "status", "blog"]);

function labelHost(host: string, suffix: string): string {
  if (host === suffix) return "";
  if (!host.endsWith(`.${suffix}`)) return "";
  return host.slice(0, -(suffix.length + 1));
}

function successFactorsHost(host: string): boolean {
  return (
    host === "successfactors.com" || host.endsWith(".successfactors.com")
    || host === "successfactors.eu" || host.endsWith(".successfactors.eu")
    || host === "sapsf.com" || host.endsWith(".sapsf.com")
    || host === "sapsf.eu" || host.endsWith(".sapsf.eu")
    || host === "jobs2web.com" || host.endsWith(".jobs2web.com")
    || host === "jobs.hr.cloud.sap" || host.endsWith(".jobs.hr.cloud.sap")
  );
}

// Turns a job link or a career-page link into the company's board, which is what gets scanned.
export function detectBoard(raw: string): BoardRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const jobsAt = parts.indexOf("jobs");
    const token = (jobsAt > 0 ? parts[jobsAt - 1] : parts[0]) ?? "";
    if (!token) return null;
    return { ats: "greenhouse", token, careerUrl: `https://boards.greenhouse.io/${token}`, nameHint: tidy(token) };
  }
  if (host === "jobs.lever.co" && parts[0]) {
    return { ats: "lever", token: parts[0], careerUrl: `https://jobs.lever.co/${parts[0]}`, nameHint: tidy(parts[0]) };
  }
  if (host === "jobs.ashbyhq.com" && parts[0]) {
    return { ats: "ashby", token: parts[0], careerUrl: `https://jobs.ashbyhq.com/${parts[0]}`, nameHint: tidy(parts[0]) };
  }
  if (host.endsWith("workable.com")) {
    const token = host.startsWith("apply.") ? parts[0] ?? "" : host.split(".")[0] ?? "";
    if (!token) return null;
    return { ats: "workable", token, careerUrl: `https://apply.workable.com/${token}`, nameHint: tidy(token) };
  }
  if (host === "jobs.smartrecruiters.com" && parts[0]) {
    return { ats: "smartrecruiters", token: parts[0], careerUrl: `https://jobs.smartrecruiters.com/${parts[0]}`, nameHint: tidy(parts[0]) };
  }
  if (host.includes("myworkdayjobs.com")) {
    return { ats: "workday", token: host, careerUrl: url.origin + url.pathname.split("/job/")[0], nameHint: tidy(host.split(".")[0] ?? host) };
  }
  const teamtailor = labelHost(host, "teamtailor.com");
  if (teamtailor && !teamtailor.includes(".") && !TEAMTAILOR_RESERVED.has(teamtailor)) {
    return { ats: "teamtailor", token: teamtailor, careerUrl: `https://${teamtailor}.teamtailor.com`, nameHint: tidy(teamtailor) };
  }
  const recruitee = labelHost(host, "recruitee.com");
  if (recruitee && !recruitee.includes(".") && !RECRUITEE_RESERVED.has(recruitee)) {
    return { ats: "recruitee", token: recruitee, careerUrl: `https://${recruitee}.recruitee.com`, nameHint: tidy(recruitee) };
  }
  if (host.endsWith(".icims.com")) {
    const token = host.slice(0, -".icims.com".length);
    if (token && token !== "www" && !token.includes(".")) {
      return { ats: "icims", token, careerUrl: `https://${host}`, nameHint: tidy(token) };
    }
  }
  if (host.includes("oraclecloud.com") && /CandidateExperience|hcmUI|\/sites\//i.test(url.pathname)) {
    const careerPath = url.pathname.split("/job/")[0] ?? url.pathname;
    return {
      ats: "oracle_recruiting",
      token: host,
      careerUrl: url.origin + careerPath.replace(/\/$/, ""),
      nameHint: tidy(host.split(".")[0] ?? host),
    };
  }
  if (successFactorsHost(host)) {
    const company = url.searchParams.get("company")?.trim() || host.split(".")[0] || host;
    return { ats: "successfactors", token: company, careerUrl: url.origin, nameHint: tidy(company) };
  }
  const aggregator = aggregatorForHost(host);
  if (aggregator) {
    return { ats: "aggregator", token: host, careerUrl: `${url.protocol}//${host}`, nameHint: aggregator.label };
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    return { ats: "website", token: host, careerUrl: url.origin, nameHint: tidy(host.replace(/^www\./, "").split(".")[0] ?? host) };
  }
  return null;
}
