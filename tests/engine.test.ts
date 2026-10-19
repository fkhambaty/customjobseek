import { describe, expect, it } from "vitest";
import { detectBoard } from "../shared/engine/boards";
import { buildApplication } from "../shared/engine/documents";
import { classifyTerms, evaluateFit, parseCompExtras, parseSalary, parseYearsRequired, titleAlignment, type JobInput } from "../shared/engine/fit";
import { profileFromResumeText } from "../shared/engine/importResume";
import { resumeTextInReadingOrder } from "../shared/engine/resumeLayout";
import { SKILL_CATALOGUE, mentions, normalise, termForName } from "../shared/engine/text";
import { MIN_BULLETS_PER_ROLE, MIN_IMPACT, dropWeakestLine, roleShape, tailorResume } from "../shared/engine/tailor";
import { emptyProfile, type Profile } from "../shared/types";
import { sanitiseProfile } from "../shared/validate";
import { parseJobHtml } from "../worker/jobFetch";
import { contactsFrom, indiaMarketLocation, meaningfulTitleMatch } from "../worker/routes/discover";

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
      industries: ["technology"],
      targetRoles: ["Analytics Engineer", "Data Engineer"],
      excludedTitleWords: ["Intern"],
      timezone: "Asia/Kolkata",
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
    expect(parseYearsRequired("No number is stated")).toBeNull();
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

  it("uses the matching search path pay band instead of profile minimum", () => {
    const wrongProfile = profile({
      preferences: { ...profile().preferences, minSalary: 2_500_000, salaryPeriod: "lpa" },
    });
    const pathPay = {
      payMin: 55,
      payMax: 100,
      currency: "INR",
      salaryPeriod: "lpa" as const,
      label: "India · ₹55–₹100 LPA",
    };
    const fit = evaluateFit(job({ salaryText: "30-48 LPA", location: "Bengaluru, India" }), wrongProfile, {
      hasSearchPaths: true,
      pathPay,
    });
    expect(fit.decision).toBe("skip");
    expect(fit.blockers.some((b) => b.kind === "salary" && b.message.includes("₹55 LPA"))).toBe(true);
    expect(fit.blockers.some((b) => b.message.includes("2,500,000"))).toBe(false);
  });

  it("mentions joining bonus, relocation, and equity when the posting names them", () => {
    const fit = evaluateFit(
      job({
        description: `${JD}\nCompensation includes a joining bonus of 2 LPA, relocation assistance, and RSUs vesting over 4 years.`,
      }),
      profile(),
    );
    expect(fit.notes.some((n) => /joining/i.test(n) && /2\s*lpa/i.test(n))).toBe(true);
    expect(fit.notes.some((n) => /relocation/i.test(n))).toBe(true);
    expect(fit.notes.some((n) => /equity|rsu/i.test(n))).toBe(true);
  });

  it("parseCompExtras ignores unrelated bonus wording in skills", () => {
    expect(parseCompExtras("Nice to have: bonus points for Looker")).toEqual([]);
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

    expect(r.roles[0]!.bullets.map((b) => b.id).slice(0, 2)).toEqual(["b2", "b3"]);
    expect(r.coreStrengths).toEqual(expect.arrayContaining(["SQL", "dbt", "Snowflake"]));
    expect(r.provenance).toEqual({ untraceableLines: [], neverClaimHits: [] });
  });

  it("keeps never-claim skills off the resume and reports any that slip into free text", () => {
    const p = profile({ skills: [...profile().skills, { name: "Databricks", level: "familiar" }], summary: "Power BI developer" });
    const r = tailorResume(p, evaluateFit(job(), p), { id: "j1", title: "x", company: "y" });
    expect(r.skills).not.toContain("Databricks");
    expect(r.provenance.neverClaimHits).toEqual(["Power BI"]);
  });

  it("packages a data engineer in the CommandCenter order even when profile skills are descriptive phrases", () => {
    const p = profile({
      headline: "ANALYTICS ENGINEER | PRODUCTION DBT, WAREHOUSE MODELLING & RECONCILIATION",
      skills: [
        { name: "Snowflake — Dynamic Tables, Streams and Tasks, Staged Ingestion", level: "expert" },
        { name: "dbt — staging, intermediate and mart models, incremental patterns, snapshots, tests and documentation", level: "expert" },
        { name: "Expert SQL", level: "expert" },
        { name: "PostgreSQL", level: "working" },
        { name: "MSSQL", level: "expert" },
        { name: "Apache Airflow", level: "working" },
        { name: "Dimensional and Analytical Data Modelling", level: "expert" },
        { name: "AWS", level: "working" },
        { name: "S3", level: "working" },
      ],
    });
    const fit = {
      ...evaluateFit(job(), p),
      matchedRequired: ["SQL", "Snowflake", "dbt", "Airflow", "Data Modelling", "AWS"],
      matchedOther: ["S3"],
    };
    const r = tailorResume(p, fit, { id: "j1", title: "Senior Data Engineer", company: "Siemens" });
    expect(r.headline).toBe("DATA ENGINEER | SNOWFLAKE, DBT, SQL, AIRFLOW & WAREHOUSE PLATFORMS");
    expect(r.coreStrengths).toEqual([
      "Snowflake",
      "dbt",
      "SQL",
      "Analytics Engineering",
      "PostgreSQL",
      "MSSQL",
      "Apache Airflow",
      "Data Modelling",
    ]);
    expect(r.capabilityGroups?.map((group) => group.name)).toEqual(expect.arrayContaining([
      "Warehousing & Transformation",
      "Data Architecture & Modelling",
      "Governance & Regulated Delivery",
    ]));
    expect(r.selectedImpact).toContain("Built 120 dbt models on Snowflake with tests that fail the build on bad numbers.");
  });
});

describe("CommandCenter role shaping", () => {
  const leadProfile = (): Profile => {
    const p = profile({
      skills: [
        ...profile().skills,
        { name: "Tableau", level: "working" },
        { name: "Hiring and Team Building", level: "expert" },
        { name: "Semantic and Governed Metric Layers", level: "expert" },
        { name: "dbt-Test Data-Quality Frameworks", level: "expert" },
        { name: "Executive Reporting Layers", level: "working" },
        { name: "Executive Reporting", level: "working" },
        { name: "Traceability and Lineage", level: "working" },
      ],
    });
    p.experience[0]!.bullets.push(
      { id: "lead1", text: "Built and managed a team of six engineers — hiring, coaching and delivery standards" },
      { id: "lead2", text: "Own the operating model for the BI function: intake, prioritisation and code review" },
    );
    return p;
  };
  const build = (title: string, description = "") => {
    const p = leadProfile();
    return tailorResume(p, evaluateFit(job({ title, description: description || JD }), p), { id: "j", title, company: "Co", description: description || JD });
  };

  it("reads track and seniority from the title the way CommandCenter does", () => {
    expect(roleShape("Senior Data Engineer")).toEqual({ track: "data_eng", seniority: "ic" });
    expect(roleShape("Data Engineering Manager")).toEqual({ track: "data_eng", seniority: "lead" });
    expect(roleShape("Analytics & BI Manager")).toEqual({ track: "bi", seniority: "lead" });
    expect(roleShape("Technical Product Manager")).toEqual({ track: "product", seniority: "lead" });
    expect(roleShape("Sr. Manager, Data Cloud Applications", "Write the PRD, own the product vision and the MVP backlog")).toEqual({ track: "product", seniority: "lead" });
  });

  it("gives every role family its own headline, using only tools the candidate holds", () => {
    const headlines = [
      build("Senior Data Engineer").headline,
      build("Senior Analytics Engineer").headline,
      build("Data Architect").headline,
      build("Data Engineering Manager").headline,
      build("Analytics & BI Manager").headline,
      build("Technical Product Manager").headline,
    ];
    expect(new Set(headlines).size).toBe(headlines.length);
    expect(headlines[0]).toBe("DATA ENGINEER | SNOWFLAKE, DBT, SQL, AIRFLOW & WAREHOUSE PLATFORMS");
    expect(headlines[3]).toBe("DATA ENGINEERING LEAD | SNOWFLAKE, DBT, AIRFLOW & WAREHOUSE PLATFORMS | TEAM BUILDING & DELIVERY STANDARDS");
    expect(headlines[4]).toBe("ANALYTICS & BI MANAGER | PEOPLE LEADERSHIP, SEMANTIC LAYERS & KPI GOVERNANCE | DBT, TABLEAU");
    for (const h of headlines) expect(h).not.toMatch(/POWER BI|DATABRICKS/);
  });

  it("keeps the candidate's own headline when the title has no known family", () => {
    expect(build("Registered Nurse", "Ward nursing role").headline).toBe("Analytics Engineer");
  });

  it("leads a lead seat with leadership evidence and an IC seat with hands-on evidence", () => {
    const lead = build("Data Engineering Manager");
    const ic = build("Senior Data Engineer");
    expect(["lead1", "lead2"]).toContain(lead.roles[0]!.bullets[0]!.id);
    expect(["lead1", "lead2"]).not.toContain(ic.roles[0]!.bullets[0]!.id);
    expect(lead.capabilityGroups?.[0]?.name).toBe("Technical Leadership");
    const icGroups = (ic.capabilityGroups ?? []).map((g) => g.name).filter((n) => n !== "Additional Capabilities");
    expect(icGroups.at(-1)).toBe("Technical Leadership");
  });

  it("groups capabilities the way CommandCenter does", () => {
    const groups = Object.fromEntries((build("Senior Data Engineer").capabilityGroups ?? []).map((g) => [g.name, g.items]));
    expect(groups["Data Architecture & Modelling"]).toContain("Semantic and Governed Metric Layers");
    expect(groups["Orchestration & Quality"]).toContain("dbt-Test Data-Quality Frameworks");
    expect(groups["Reporting & Enablement"]).toContain("Executive Reporting Layers");
    expect(groups["Technical Leadership"]).toEqual(expect.arrayContaining(["Executive Reporting", "Hiring and Team Building"]));
    expect(groups["Governance & Regulated Delivery"]).toContain("Traceability and Lineage");
  });

  it("uses resume punctuation, a career line, and at most three relevant certifications", () => {
    const p = leadProfile();
    p.certifications = [
      { id: "c1", name: "Snowflake Data Engineering", issuer: "Snowflake", year: "2026" },
      { id: "c2", name: "Apache Airflow", issuer: "Astronomer", year: "2025" },
      { id: "c3", name: "Creating Declarative Data Pipelines with Dynamic Tables", issuer: "Snowflake", year: "2026" },
      { id: "c4", name: "Ivalua P2P Certification", issuer: "Ivalua", year: "2019" },
      { id: "c5", name: "Databricks Lakehouse Fundamentals", issuer: "Databricks", year: "2024" },
    ];
    const r = tailorResume(p, evaluateFit(job(), p), { id: "j", title: "Senior Data Engineer", company: "Co", description: `${JD} Snowflake and Airflow pipelines` });
    expect(r.certifications.length).toBeLessThanOrEqual(3);
    expect(r.certifications.map((c) => c.name)).not.toContain("Databricks Lakehouse Fundamentals");
    expect(r.certifications.map((c) => c.name)).not.toContain("Ivalua P2P Certification");
    expect(r.roles.flatMap((role) => role.bullets).find((b) => b.id === "lead1")?.text ?? "").not.toContain("—");
    expect(r.profileParagraphs?.[1]).toMatch(/^Most recently /);
    expect(r.profileParagraphs?.[1]).not.toContain("..");
    expect(r.provenance).toEqual({ untraceableLines: [], neverClaimHits: [] });
  });

  it("trims the oldest role first, never below the floors", () => {
    const r = build("Senior Data Engineer");
    const before = r.roles.map((role) => role.bullets.length);
    const impactBefore = r.selectedImpact?.length ?? 0;
    expect(dropWeakestLine(r) || before.every((n) => n <= MIN_BULLETS_PER_ROLE)).toBe(true);
    while (dropWeakestLine(r)) { /* drain */ }
    for (const [i, role] of r.roles.entries()) expect(role.bullets.length).toBe(Math.min(before[i]!, MIN_BULLETS_PER_ROLE));
    expect(r.selectedImpact?.length ?? 0).toBe(Math.min(impactBefore, MIN_IMPACT));
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
    expect(detectBoard("https://job-boards.greenhouse.io/anthropic/jobs/4461450008")).toMatchObject({
      ats: "greenhouse",
      token: "anthropic",
      careerUrl: "https://boards.greenhouse.io/anthropic",
    });
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

  it("reads roles whose dates share the title line", () => {
    const text = `Asha Verma
asha@example.com · +91 98765 43210

EXPERIENCE
Senior Software Engineer, Razorpay — Jan 2021 – Present
Cut payment settlement time from 2 days to 4 hours by redesigning the ledger service in Go.
Led a team of 4 engineers that moved 30 services to Kubernetes.
Software Engineer | Flipkart | Jul 2017 - Dec 2020
Built the order events pipeline on Kafka handling 50,000 events per second in 2019.

EDUCATION
B.Tech, Computer Science, NIT Trichy, 2017`;
    const p = profileFromResumeText(text);
    expect(p.experience).toEqual([
      expect.objectContaining({ title: "Senior Software Engineer", company: "Razorpay", start: "Jan 2021", end: "Present" }),
      expect.objectContaining({ title: "Software Engineer", company: "Flipkart", start: "Jul 2017", end: "Dec 2020" }),
    ]);
    expect(p.experience[0]?.bullets).toHaveLength(2);
    expect(p.experience[1]?.bullets.map((b) => b.text)).toEqual([
      "Built the order events pipeline on Kafka handling 50,000 events per second in 2019.",
    ]);
  });

  it("restores a two-column resume before assigning fields", () => {
    const item = (str: string, x: number, y: number) => ({ str, x, y });
    const text = resumeTextInReadingOrder([{
      width: 600,
      items: [
        item("PRIYA SHARMA", 235, 815),
        item("Communications professional passionate about bringing stories to life.", 235, 798),
        item("WORK EXPERIENCE", 235, 767),
        item("Internal Communications Associate Lead", 408, 748),
        item("November 2025- Present", 473, 738),
        item("Infosys is a leading global provider of digital services", 237, 727),
        item("Develop and execute internal communications strategy", 241, 715),
        item("9000000000", 53, 688),
        item("priya@example.com", 53, 675),
        item("Bengaluru, India", 53, 650),
        item("EDUCATION", 39, 625),
        item("Master’s in Media and Communication Studies", 39, 613),
        item("(Advertising and Corporate Communication) - 8.2 / 10 CGPA", 39, 603),
        item("Christ University - 2021 – 2023", 39, 582),
        item("INTERESTS", 38, 506),
        item("Integrated Marketing & Communications", 39, 492),
      ],
    }]);
    const p = profileFromResumeText(text);
    expect(p).toMatchObject({
      fullName: "PRIYA SHARMA",
      email: "priya@example.com",
      phone: "9000000000",
      headline: "Internal Communications Associate Lead",
    });
    expect(p.experience).toEqual([
      expect.objectContaining({
        title: "Internal Communications Associate Lead",
        company: "Infosys",
        start: "November 2025",
        end: "Present",
        bullets: [{ id: "exp0b0", text: "Develop and execute internal communications strategy" }],
      }),
    ]);
    expect(p.education).toEqual([
      expect.objectContaining({
        institution: "Christ University",
        degree: "Master’s in Media and Communication Studies (Advertising and Corporate Communication) - 8.2 / 10 CGPA",
        year: "2021 – 2023",
      }),
    ]);
    expect(p.skills.map((skill) => skill.name)).toContain("Integrated Marketing & Communications");
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

  it("keeps only contacts explicitly printed in a job posting", () => {
    expect(contactsFrom("Questions? Contact Priya Sharma at priya@example.com or jobs@example.com.")).toEqual([
      expect.objectContaining({ name: "Priya Sharma", email: "priya@example.com" }),
      expect.objectContaining({ name: "", email: "jobs@example.com" }),
    ]);
    expect(contactsFrom("Our hiring team will contact shortlisted applicants.")).toEqual([]);
  });

  it("does not call a role relevant because it only shares a generic title word", () => {
    const targets = ["Corporate Communications", "Internal Communications", "Communications Consultant"];
    expect(meaningfulTitleMatch("Manager, Internal Communications", targets)).toBe(1);
    expect(meaningfulTitleMatch("Senior SAP Consultant", targets)).toBe(0);
    expect(meaningfulTitleMatch("Internal Sales Representative", targets)).toBe(0);
    expect(meaningfulTitleMatch("Senior Product Marketing Manager", [...targets, "Product Marketing"])).toBe(1);
  });

  it("keeps an India search out of foreign remote markets", () => {
    expect(indiaMarketLocation("Bengaluru, Karnataka, India")).toBe(true);
    expect(indiaMarketLocation("Remote")).toBe(true);
    expect(indiaMarketLocation("Remote, IN")).toBe(true);
    expect(indiaMarketLocation("Remote, CA")).toBe(false);
    expect(indiaMarketLocation("London, UK")).toBe(false);
  });
});
