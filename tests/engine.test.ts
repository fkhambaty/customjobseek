import { describe, expect, it } from "vitest";
import { detectBoard } from "../shared/engine/boards";
import { buildApplication } from "../shared/engine/documents";
import { classifyTerms, evaluateFit, parseSalary, parseYearsRequired, titleAlignment, type JobInput } from "../shared/engine/fit";
import { profileFromResumeText } from "../shared/engine/importResume";
import { SKILL_CATALOGUE, mentions, normalise, termForName } from "../shared/engine/text";
import { tailorResume } from "../shared/engine/tailor";
import { emptyProfile, type Profile } from "../shared/types";
import { sanitiseProfile } from "../shared/validate";
import { parseJobHtml } from "../worker/jobFetch";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...emptyProfile("asha@example.com"),
    fullName: "Asha Rao",
    headline: "Analytics Engineer",
    summary: "Analytics engineer who turns messy data into models people trust.",
    totalYears: 8,
    skills: [
      { name: "SQL", level: "expert" },
      { name: "dbt", level: "expert" },
      { name: "Snowflake", level: "working" },
      { name: "Postgres", level: "working" },
      { name: "Airflow", level: "working" },
    ],
    neverClaim: ["Power BI", "Databricks"],
    experience: [
      {
        id: "e1",
        company: "Acme",
        title: "Senior Analytics Engineer",
        location: "Pune",
        start: "2021",
        end: "Present",
        bullets: [
          { id: "b1", text: "Ran weekly stakeholder reviews for the finance team" },
          { id: "b2", text: "Built 120 dbt models on Snowflake with tests that fail the build on bad numbers" },
          { id: "b3", text: "Scheduled pipelines in Airflow, cutting late reports by 80%" },
        ],
      },
    ],
    preferences: {
      country: "IN",
      cities: ["Pune", "Bengaluru"],
      remoteOk: true,
      currency: "INR",
      minSalary: 30,
      maxSalary: 50,
      salaryPeriod: "lpa",
      targetRoles: ["Analytics Engineer", "Data Engineer"],
      excludedTitleWords: ["Intern"],
    },
    ...overrides,
  };
}

const JD = `We are hiring an Analytics Engineer.
Requirements:
- 6+ years of experience in analytics engineering
- Strong SQL and dbt
- Experience with Snowflake and PostgreSQL
- Airflow for orchestration
Nice to have:
- Looker
- Python`;

function job(overrides: Partial<JobInput> = {}): JobInput {
  return { title: "Senior Analytics Engineer", company: "Beta", location: "Bengaluru, India", salaryText: "35-45 LPA", description: JD, ...overrides };
}

describe("text matching", () => {
  it("matches symbol-heavy terms on word boundaries", () => {
    const cpp = SKILL_CATALOGUE.find((t) => t.name === "C++")!;
    const dotnet = SKILL_CATALOGUE.find((t) => t.name === ".NET")!;
    expect(mentions(normalise("Strong C++ skills."), cpp)).toBe(true);
    expect(mentions(normalise("We use .NET daily"), dotnet)).toBe(true);
    expect(mentions(normalise("sqlalchemy"), termForName("SQL"))).toBe(false);
  });

  it("expands a profile spelling to catalogue aliases", () => {
    expect(termForName("Postgres").name).toBe("PostgreSQL");
    expect(mentions(normalise("PostgreSQL 15"), termForName("Postgres"))).toBe(true);
  });
});

describe("parsers", () => {
  it("parses pay in the currency and unit the posting used", () => {
    expect(parseSalary("₹30 - 40 LPA")).toMatchObject({ min: 30, max: 40, currency: "INR", period: "lpa" });
    expect(parseSalary("25 lakhs per annum")).toMatchObject({ min: 25, max: 25, currency: "INR" });
    expect(parseSalary("1.2 Cr")).toMatchObject({ min: 120, max: 120, currency: "INR", period: "lpa" });
    expect(parseSalary("$120,000 - $150,000")).toMatchObject({ min: 120000, max: 150000, currency: "USD", period: "year" });
    expect(parseSalary("£60k-£80k")).toMatchObject({ min: 60000, max: 80000, currency: "GBP" });
    expect(parseSalary("SGD 8,000 per month")).toMatchObject({ currency: "SGD", period: "month", annualMin: 96000 });
    expect(parseSalary("3-5 years of experience and $140,000 a year")).toMatchObject({ min: 140000, currency: "USD" });
    expect(parseSalary("Competitive")).toBeNull();
  });

  it("reads the years-of-experience requirement", () => {
    expect(parseYearsRequired("Minimum 7+ years of relevant experience")).toBe(7);
    expect(parseYearsRequired("5-8 years experience in data")).toBe(5);
    expect(parseYearsRequired("Founded 20 years ago")).toBeNull();
  });

  it("scores title alignment by shared words", () => {
    expect(titleAlignment("Senior Analytics Engineer", ["Analytics Engineer"])).toBe(1);
    expect(titleAlignment("Sales Manager", ["Analytics Engineer"])).toBe(0);
  });

  it("separates required skills from nice-to-haves", () => {
    const { required, other } = classifyTerms(JD, SKILL_CATALOGUE);
    expect(required.map((t) => t.name)).toEqual(expect.arrayContaining(["SQL", "dbt", "Snowflake", "PostgreSQL", "Airflow"]));
    expect(other.map((t) => t.name)).toEqual(expect.arrayContaining(["Looker", "Python"]));
  });
});

describe("evaluateFit", () => {
  it("recommends applying to a strong match", () => {
    const fit = evaluateFit(job(), profile());
    expect(fit.blockers).toEqual([]);
    expect(fit.decision).toBe("apply");
    expect(fit.score).toBeGreaterThanOrEqual(80);
    expect(fit.missingRequired).toEqual([]);
    expect(fit.missingOther).toEqual(expect.arrayContaining(["Looker", "Python"]));
  });

  it("blocks pay below the floor", () => {
    const fit = evaluateFit(job({ salaryText: "15-20 LPA" }), profile());
    expect(fit.decision).toBe("skip");
    expect(fit.blockers.map((b) => b.kind)).toContain("salary");
  });

  it("blocks cities and countries the candidate will not work in, and allows remote", () => {
    expect(evaluateFit(job({ location: "Chennai, India" }), profile()).blockers.map((b) => b.kind)).toContain("location");
    expect(evaluateFit(job({ location: "Bengaluru, India" }), profile()).blockers).toEqual([]);
    expect(evaluateFit(job({ location: "Remote, India" }), profile()).blockers).toEqual([]);
    expect(evaluateFit(job({ location: "Berlin, Germany" }), profile()).blockers.map((b) => b.kind)).toContain("location");
    expect(evaluateFit(job({ location: "Remote - United States" }), profile()).blockers.map((b) => b.kind)).toContain("location");
    const noRemote = profile({ preferences: { ...profile().preferences, remoteOk: false } });
    expect(evaluateFit(job({ location: "Remote" }), noRemote).blockers.map((b) => b.kind)).toContain("location");
  });

  it("does not compare pay across currencies", () => {
    const fit = evaluateFit(job({ salaryText: "$150,000 - $180,000" }), profile());
    expect(fit.blockers.map((b) => b.kind)).not.toContain("salary");
    expect(fit.notes.some((n) => n.includes("USD"))).toBe(true);
  });

  it("blocks excluded title words and required never-claim skills", () => {
    expect(evaluateFit(job({ title: "Analytics Engineer Intern" }), profile()).blockers.map((b) => b.kind)).toContain("title");
    const fit = evaluateFit(job({ description: `${JD}\nMust have: Power BI and DAX dashboards` }), profile());
    expect(fit.blockers.map((b) => b.kind)).toContain("never_claim");
    expect(fit.matchedRequired).not.toContain("Power BI");
  });

  it("does not count a never-claim skill as held even if a bullet mentions it", () => {
    const p = profile();
    p.experience[0]!.bullets.push({ id: "b4", text: "Sat in on Power BI training" });
    const fit = evaluateFit(job({ description: `${JD}\nPower BI is a plus` }), p);
    expect(fit.matchedOther).not.toContain("Power BI");
  });

  it("flags a large experience gap", () => {
    const fit = evaluateFit(job(), profile({ totalYears: 2 }));
    expect(fit.blockers.map((b) => b.kind)).toContain("experience");
  });
});

describe("tailorResume", () => {
  it("only uses the candidate's own lines and leads with relevant ones", () => {
    const p = profile();
    const fit = evaluateFit(job(), p);
    const r = tailorResume(p, fit, { id: "j1", title: "Senior Analytics Engineer", company: "Beta" });

    const source = new Set(p.experience.flatMap((e) => e.bullets.map((b) => b.text)));
    for (const role of r.roles) for (const b of role.bullets) expect(source.has(b.text)).toBe(true);

    expect(r.roles[0]!.bullets.map((b) => b.id)).toEqual(["b2", "b3"]);
    expect(r.roles[0]!.omittedBulletCount).toBe(1);
    expect(r.coreStrengths).toEqual(expect.arrayContaining(["SQL", "dbt", "Snowflake"]));
    expect(r.provenance).toEqual({ untraceableLines: [], neverClaimHits: [] });
  });

  it("keeps never-claim skills off the resume and reports any that slip into free text", () => {
    const p = profile({ skills: [...profile().skills, { name: "Databricks", level: "familiar" }], summary: "Power BI developer" });
    const r = tailorResume(p, evaluateFit(job(), p), { id: "j1", title: "x", company: "y" });
    expect(r.skills).not.toContain("Databricks");
    expect(r.provenance.neverClaimHits).toEqual(["Power BI"]);
  });
});

describe("sanitiseProfile", () => {
  it("drops junk and caps sizes", () => {
    const p = sanitiseProfile({ fullName: "  Asha  ", skills: [{ name: "" }, { name: "SQL", level: "god" }], experience: [{}], preferences: { minSalaryLpa: "-5" } });
    expect(p.fullName).toBe("Asha");
    expect(p.skills).toEqual([{ name: "SQL", level: "working" }]);
    expect(p.experience).toEqual([]);
    expect(p.preferences.minSalary).toBeNull();
  });

  it("keeps an older India-only salary floor", () => {
    const p = sanitiseProfile({ preferences: { minSalaryLpa: 30 } });
    expect(p.preferences).toMatchObject({ currency: "INR", salaryPeriod: "lpa", minSalary: 30 });
  });
});

describe("boards, application file, resume import", () => {
  it("turns a job link into the company career page", () => {
    expect(detectBoard("https://job-boards.greenhouse.io/anthropic/jobs/4461450008")).toMatchObject({ ats: "greenhouse", token: "anthropic" });
    expect(detectBoard("https://jobs.lever.co/palantir/abc")?.careerUrl).toBe("https://jobs.lever.co/palantir");
    expect(detectBoard("https://jobs.ashbyhq.com/paxos/f8cbcedf")?.ats).toBe("ashby");
  });

  it("builds the application only from profile lines", () => {
    const p = profile();
    const fit = evaluateFit(job(), p);
    const file = buildApplication(p, fit, tailorResume(p, fit, { id: "j", title: "Senior Analytics Engineer", company: "Beta" }));
    const source = p.experience.flatMap((e) => e.bullets.map((b) => b.text));
    for (const line of file.evidence) expect(source).toContain(line.text);
    expect(file.paragraphs[0]).toContain("Asha Rao");
    expect(file.paragraphs.join(" ")).toContain("SQL");
  });

  it("reads a plain-text resume into a draft profile", () => {
    const text = `Asha Rao
asha@example.com | +91 90000 00000

PROFILE
Analytics engineer who builds tested models.

SKILLS
SQL, dbt, Snowflake

PROFESSIONAL EXPERIENCE
Senior Analytics Engineer, Acme
Jan 2021 – Present
Built 120 dbt models on Snowflake
Scheduled pipelines in Airflow

EDUCATION
B.E. Computer Engineering, Pune University 2016`;
    const p = profileFromResumeText(text);
    expect(p.fullName).toBe("Asha Rao");
    expect(p.email).toBe("asha@example.com");
    expect(p.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["SQL", "dbt", "Snowflake"]));
    expect(p.experience[0]?.company).toContain("Acme");
    expect(p.experience[0]?.bullets.map((b) => b.text)).toEqual([
      "Built 120 dbt models on Snowflake",
      "Scheduled pipelines in Airflow",
    ]);
  });
});

describe("parseJobHtml", () => {
  it("reads a JSON-LD JobPosting", () => {
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Data Engineer",
      hiringOrganization: { name: "Gamma" },
      jobLocation: { address: { addressLocality: "Pune", addressCountry: "IN" } },
      baseSalary: { currency: "INR", value: { minValue: 3000000, maxValue: 4000000, unitText: "YEAR" } },
      description: "<p>" + "Build pipelines in Airflow and dbt. ".repeat(5) + "</p>",
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body></body></html>`;
    const job = parseJobHtml(html)!;
    expect(job.source).toBe("structured");
    expect(job.title).toBe("Data Engineer");
    expect(job.company).toBe("Gamma");
    expect(job.location).toBe("Pune, IN");
    expect(parseSalary(job.salaryText)).toMatchObject({ min: 3000000, max: 4000000, currency: "INR", period: "year" });
  });
});
