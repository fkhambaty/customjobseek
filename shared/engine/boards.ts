export type Ats = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "workday" | "website";

export interface BoardRef {
  ats: Ats;
  token: string;
  careerUrl: string;
  nameHint: string;
}

function tidy(token: string): string {
  return token.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  if (url.protocol === "https:" || url.protocol === "http:") {
    return { ats: "website", token: host, careerUrl: url.origin, nameHint: tidy(host.replace(/^www\./, "").split(".")[0] ?? host) };
  }
  return null;
}
