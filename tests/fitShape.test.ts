import { describe, expect, it } from "vitest";
import { classifyTerms, evaluateFit, splitLines, type JobInput } from "../shared/engine/fit";
import { SKILL_CATALOGUE, mentions, normalise, termPattern, type Term } from "../shared/engine/text";
import { emptyProfile, type Profile } from "../shared/types";

const PREFERRED_LINE = /\b(nice to have|good to have|preferred|bonus|desirable|an advantage|a plus|is a plus|would be great|optional)\b/i;
const PREFERRED_HEADER = /^\W*(nice to have|good to have|preferred|bonus|desirable|plus points?)\b/i;
const REQUIRED_HEADER = /^\W*(requirements?|qualifications?|must have|what you('| wi)ll need|you have|skills|responsibilities|what we('| a)re looking for|about you)\b/i;

/** The previous line-by-line matcher, kept so a faster scan cannot drift. */
function referenceClassify(description: string, terms: Term[]): { required: string[]; other: string[] } {
  const lines = splitLines(description);
  let inPreferredSection = false;
  const requiredNames = new Set<string>();
  const seenNames = new Set<string>();
  for (const line of lines) {
    if (PREFERRED_HEADER.test(line)) inPreferredSection = true;
    else if (REQUIRED_HEADER.test(line)) inPreferredSection = false;
    const optional = inPreferredSection || PREFERRED_LINE.test(line);
    for (const term of terms) {
      if (!term.aliases.some((alias) => termPattern(alias).test(line))) continue;
      seenNames.add(term.name);
      if (!optional) requiredNames.add(term.name);
    }
  }
  const found = terms.filter((term) => seenNames.has(term.name));
  return {
    required: found.filter((term) => requiredNames.has(term.name)).map((term) => term.name),
    other: found.filter((term) => !requiredNames.has(term.name)).map((term) => term.name),
  };
}

function architectDescription(): string {
  return [
    "At a global agriculture technology company, teams build tools farmers use.",
    "We are seeking a Lead Data Architect to connect enterprise standards with one business domain.",
    "Key Accountabilities",
    "Act as the data architect for the embedded business function.",
    "Knowledge, Experience & Capabilities",
    "Deep knowledge of modern cloud data architectures on AWS, including a Databricks lakehouse.",
    "Solid grounding in data modelling paradigms and data pipelines.",
    "Hands-on experience with data governance, CI/CD, and MLOps.",
    "Proven experience with RAG pipelines and generative AI.",
    "Partner with business stakeholders and product managers.",
    "Bachelor's degree in computer science, information technology, or a related field.",
    "This employer does not discriminate in recruitment.",
    "#LI-Hybrid",
  ].join("\n");
}

function architectJob(description = architectDescription()): JobInput {
  return {
    title: "Lead Data Solutions Architect",
    company: "Syngenta Group",
    location: "Pune, Maharashtra, in",
    salaryText: "",
    description,
  };
}

function wideProfile(): Profile {
  const base = emptyProfile("asha@example.com");
  const names = [
    "Snowflake", "dbt", "SQL", "Python", "Airflow", "Kafka", "Apache Spark", "AWS", "Azure", "Terraform",
    "Docker", "Kubernetes", "Databricks", "Power BI", "Tableau", "Java", "Scala", "PostgreSQL", "MongoDB", "Redis",
  ];
  return {
    ...base,
    fullName: "Asha Rao",
    totalYears: 12,
    skills: Array.from({ length: 65 }, (_, index) => ({
      name: index < names.length ? names[index]! : `Domain skill ${index} platform`,
      level: "working" as const,
    })),
    experience: Array.from({ length: 8 }, (_, index) => ({
      id: `e${index}`,
      company: `Co${index}`,
      title: "Data Architect",
      location: "Pune",
      start: "2016",
      end: "Present",
      bullets: Array.from({ length: 6 }, (_, bullet) => ({
        id: `b${index}_${bullet}`,
        text: "Built SQL Snowflake dbt Airflow Kafka Spark pipelines and led stakeholder reviews across Azure AWS data platforms. Used Python Java Scala PostgreSQL MongoDB Redis Docker Kubernetes Terraform Databricks Tableau Power BI.",
      })),
    })),
    preferences: {
      ...base.preferences,
      country: "IN",
      cities: ["Pune", "Bengaluru"],
      remoteOk: true,
      currency: "INR",
      minSalary: 40,
      maxSalary: 80,
      salaryPeriod: "lpa",
      targetRoles: ["Data Architect", "Solutions Architect", "Data Engineer"],
    },
  };
}

function legacySplit(description: string): string[] {
  return description
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .split(/\n|(?<=[.;])\s+(?=[A-Z])/)
    .map((line) => normalise(line))
    .filter(Boolean);
}

describe("SmartRecruiters architect fit", () => {
  it("splits lines on the same breaks as a newline or a new sentence", () => {
    const samples = [
      architectDescription(),
      "Hello. World stays apart",
      "Hello. world stays together",
      "Hello.\nWorld",
      "Hello.\n\nWorld",
      "Use C++. Next line",
      "End; Next",
      "<p>SQL</p><br>Python",
      "3.14 is not a sentence. Next",
      "  padded  \n\n second ",
      "Mr. Smith visited. Then left",
      `${"Seasons. The next group meets. ".repeat(40)}`,
    ];
    for (const sample of samples) expect(splitLines(sample)).toEqual(legacySplit(sample));
  });

  it("keeps the same required and optional skills as a per-line regex scan", () => {
    const extra: Term[] = wideProfile().skills.map((skill) => ({ name: skill.name, aliases: [skill.name.toLowerCase()] }));
    const samples = [
      architectDescription(),
      "Requirements:\nStrong C++ and .NET\nNice to have:\nPython is a plus\nMust have: SQL Server\nLooker is a plus, and SQL remains required",
      "We use sqlalchemy, node.js, and c++ daily.",
    ];
    for (const description of samples) {
      const terms = [...SKILL_CATALOGUE, ...extra];
      const fit = classifyTerms(description, terms);
      expect({ required: fit.required.map((term) => term.name), other: fit.other.map((term) => term.name) }).toEqual(referenceClassify(description, terms));
    }
  });

  it("matches symbol terms the same way as the word-boundary regex", () => {
    const haystacks = ["strong c++ skills.", "we use .net daily", "sqlalchemy and node.js", "sql server and power bi", "ci/cd for rag pipelines"];
    for (const text of haystacks) {
      for (const term of SKILL_CATALOGUE) {
        expect(mentions(text, term)).toBe(term.aliases.some((alias) => termPattern(alias).test(text)));
      }
    }
  });

  it("scores the Syngenta posting shape for a 65-skill profile", () => {
    const fit = evaluateFit(architectJob(), wideProfile());
    expect(fit.blockers).toEqual([]);
    expect(fit.decision).toBe("skip");
    expect(fit.score).toBe(39);
    expect(fit.matchedRequired).toEqual(["Databricks", "AWS"]);
    expect(fit.missingRequired).toEqual([
      "Data Modelling",
      "Data Pipelines",
      "Data Governance",
      "CI/CD",
      "Generative AI",
      "RAG",
      "MLOps",
      "Stakeholder Management",
      "Recruitment",
    ]);
    expect(fit.matchedOther).toEqual([]);
    expect(fit.notes).toEqual(["Pay is not published. Ask for the band before investing time."]);
    expect(fit.jdYearsRequired).toBeNull();
    expect(fit.parsedSalary).toBeNull();
  });

  it("stays under the budget that the line-by-line scan misses", () => {
    const filler = "The embedded architecture group reviews domain proposals with product managers and keeps delivery moving for growers across seasons. ";
    const heavy = architectJob([architectDescription(), ...Array.from({ length: 200 }, () => filler.repeat(60))].join("\n"));
    const baseline = evaluateFit(architectJob(), wideProfile());
    const started = performance.now();
    const fit = evaluateFit(heavy, wideProfile());
    const elapsed = performance.now() - started;
    expect(fit).toEqual(baseline);
    // This fixture took about 440ms when every line was matched with a regex per skill.
    // 300ms still fails that path, and a slow CI machine stays under it after the scan change.
    expect(elapsed).toBeLessThan(300);
  });
});
