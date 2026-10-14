export interface Term {
  name: string;
  aliases: string[];
}

// Canonical name first, then the spellings a job description might use instead.
// Short or ambiguous aliases ("go", "r", "js") are deliberately absent: they match ordinary prose.
export const SKILL_CATALOGUE: Term[] = [
  // Languages
  { name: "Python", aliases: ["python"] },
  { name: "SQL", aliases: ["sql"] },
  { name: "Java", aliases: ["java"] },
  { name: "JavaScript", aliases: ["javascript"] },
  { name: "TypeScript", aliases: ["typescript"] },
  { name: "Golang", aliases: ["golang"] },
  { name: "Scala", aliases: ["scala"] },
  { name: "C++", aliases: ["c++"] },
  { name: "C#", aliases: ["c#"] },
  { name: ".NET", aliases: [".net", "dotnet"] },
  { name: "Rust", aliases: ["rust"] },
  { name: "Kotlin", aliases: ["kotlin"] },
  { name: "Swift", aliases: ["swift"] },
  { name: "PHP", aliases: ["php"] },
  { name: "Ruby", aliases: ["ruby", "ruby on rails"] },
  { name: "R programming", aliases: ["r programming", "rstudio"] },
  { name: "Bash", aliases: ["bash", "shell scripting"] },
  // Web
  { name: "React", aliases: ["react", "react.js", "reactjs"] },
  { name: "Angular", aliases: ["angular"] },
  { name: "Vue", aliases: ["vue", "vue.js"] },
  { name: "Next.js", aliases: ["next.js", "nextjs"] },
  { name: "Node.js", aliases: ["node.js", "nodejs"] },
  { name: "HTML", aliases: ["html", "html5"] },
  { name: "CSS", aliases: ["css", "css3", "tailwind"] },
  { name: "REST APIs", aliases: ["rest api", "rest apis", "restful"] },
  { name: "GraphQL", aliases: ["graphql"] },
  { name: "Django", aliases: ["django"] },
  { name: "Flask", aliases: ["flask"] },
  { name: "FastAPI", aliases: ["fastapi"] },
  { name: "Spring Boot", aliases: ["spring boot", "springboot"] },
  // Data platforms
  { name: "Snowflake", aliases: ["snowflake"] },
  { name: "dbt", aliases: ["dbt"] },
  { name: "Databricks", aliases: ["databricks"] },
  { name: "Apache Spark", aliases: ["spark", "apache spark"] },
  { name: "PySpark", aliases: ["pyspark"] },
  { name: "Kafka", aliases: ["kafka"] },
  { name: "Airflow", aliases: ["airflow"] },
  { name: "Redshift", aliases: ["redshift"] },
  { name: "BigQuery", aliases: ["bigquery"] },
  { name: "PostgreSQL", aliases: ["postgresql", "postgres"] },
  { name: "MySQL", aliases: ["mysql"] },
  { name: "SQL Server", aliases: ["sql server", "mssql", "ms sql"] },
  { name: "Oracle", aliases: ["oracle db", "oracle database", "pl/sql"] },
  { name: "MongoDB", aliases: ["mongodb"] },
  { name: "Redis", aliases: ["redis"] },
  { name: "Elasticsearch", aliases: ["elasticsearch", "opensearch"] },
  { name: "Data Modelling", aliases: ["data modelling", "data modeling", "dimensional model", "star schema"] },
  { name: "Data Warehousing", aliases: ["data warehouse", "data warehousing", "edw"] },
  { name: "ETL", aliases: ["etl", "elt"] },
  { name: "Data Pipelines", aliases: ["data pipeline", "data pipelines"] },
  { name: "Data Governance", aliases: ["data governance", "data quality"] },
  { name: "Informatica", aliases: ["informatica"] },
  { name: "SSIS", aliases: ["ssis"] },
  { name: "Fivetran", aliases: ["fivetran"] },
  // BI
  { name: "Power BI", aliases: ["power bi", "powerbi"] },
  { name: "DAX", aliases: ["dax"] },
  { name: "Tableau", aliases: ["tableau"] },
  { name: "Looker", aliases: ["looker"] },
  { name: "Qlik", aliases: ["qlik", "qlikview", "qlik sense"] },
  { name: "Excel", aliases: ["excel", "advanced excel"] },
  { name: "Microsoft Fabric", aliases: ["microsoft fabric"] },
  // Cloud and DevOps
  { name: "AWS", aliases: ["aws", "amazon web services"] },
  { name: "Azure", aliases: ["azure"] },
  { name: "GCP", aliases: ["gcp", "google cloud"] },
  { name: "Docker", aliases: ["docker"] },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { name: "Terraform", aliases: ["terraform"] },
  { name: "CI/CD", aliases: ["ci/cd", "continuous integration", "github actions", "jenkins"] },
  { name: "Git", aliases: ["git", "github", "gitlab"] },
  { name: "Linux", aliases: ["linux", "unix"] },
  { name: "Microservices", aliases: ["microservices", "microservice"] },
  // AI and ML
  { name: "Machine Learning", aliases: ["machine learning"] },
  { name: "Deep Learning", aliases: ["deep learning"] },
  { name: "NLP", aliases: ["nlp", "natural language processing"] },
  { name: "LLMs", aliases: ["llm", "llms", "large language model", "large language models"] },
  { name: "Generative AI", aliases: ["generative ai", "genai", "gen ai"] },
  { name: "RAG", aliases: ["rag", "retrieval augmented generation", "retrieval-augmented generation"] },
  { name: "TensorFlow", aliases: ["tensorflow"] },
  { name: "PyTorch", aliases: ["pytorch"] },
  { name: "scikit-learn", aliases: ["scikit-learn", "sklearn"] },
  { name: "MLOps", aliases: ["mlops"] },
  { name: "Statistics", aliases: ["statistics", "statistical analysis", "a/b testing"] },
  { name: "Pandas", aliases: ["pandas"] },
  // Enterprise and business
  { name: "SAP", aliases: ["sap"] },
  { name: "Salesforce", aliases: ["salesforce"] },
  { name: "ServiceNow", aliases: ["servicenow"] },
  { name: "Workday", aliases: ["workday hcm", "workday financials"] },
  { name: "Jira", aliases: ["jira"] },
  { name: "Agile", aliases: ["agile", "scrum", "kanban"] },
  { name: "Project Management", aliases: ["project management", "pmp", "programme management", "program management"] },
  { name: "Product Management", aliases: ["product management", "product roadmap"] },
  { name: "Stakeholder Management", aliases: ["stakeholder management", "stakeholders"] },
  { name: "Team Leadership", aliases: ["team leadership", "people management", "team lead", "mentoring"] },
  { name: "Client Delivery", aliases: ["client delivery", "client-facing", "customer-facing"] },
  { name: "Presales", aliases: ["presales", "pre-sales", "solution consulting", "rfp"] },
  { name: "Procurement", aliases: ["procurement", "source-to-pay", "procure-to-pay"] },
  { name: "Supply Chain", aliases: ["supply chain"] },
  { name: "Financial Analysis", aliases: ["financial analysis", "financial modelling", "financial modeling", "fp&a"] },
  { name: "Accounting", aliases: ["accounting", "ifrs", "gaap"] },
  { name: "Digital Marketing", aliases: ["digital marketing", "seo", "sem", "google ads"] },
  { name: "Content Writing", aliases: ["content writing", "copywriting"] },
  { name: "Sales", aliases: ["b2b sales", "inside sales", "business development"] },
  { name: "Customer Success", aliases: ["customer success", "account management"] },
  { name: "Recruitment", aliases: ["recruitment", "talent acquisition"] },
  { name: "Figma", aliases: ["figma"] },
  { name: "UX Design", aliases: ["ux design", "user experience", "ui/ux"] },
  { name: "Testing", aliases: ["selenium", "playwright", "cypress", "test automation", "qa automation"] },
  { name: "Security", aliases: ["cybersecurity", "information security", "soc 2", "iso 27001"] },
  // Cross-field vocabulary. A term is held only when the profile already says it.
  // License names recognise a posting; they are never added unless the person wrote them.
  { name: "Patient Care", aliases: ["patient care", "bedside care"] },
  { name: "Nursing license", aliases: ["nursing license", "nursing licence", "registered nurse license", "rn license", "rn licence", "nmc pin"] },
  { name: "Medical license", aliases: ["medical license", "medical licence", "licensed physician"] },
  { name: "Law license", aliases: ["bar admission", "practising certificate", "practicing certificate", "law license", "law licence"] },
  { name: "Teaching credential", aliases: ["teaching credential", "teaching licence", "teaching license", "qualified teacher status", "qts"] },
  { name: "Commercial driving licence", aliases: ["cdl", "commercial driver's license", "commercial drivers license", "hgv licence", "hgv license"] },
  { name: "Electrician license", aliases: ["electrician license", "electrician licence", "electrical licence"] },
  { name: "Food safety", aliases: ["food safety", "food hygiene", "servsafe"] },
  { name: "First aid", aliases: ["first aid", "basic life support"] },
  { name: "Cash handling", aliases: ["cash handling", "till operation"] },
  { name: "Inventory", aliases: ["inventory management", "stock control"] },
  { name: "Lesson planning", aliases: ["lesson planning", "lesson plans"] },
  { name: "Classroom management", aliases: ["classroom management"] },
  { name: "Case management", aliases: ["case management", "safeguarding"] },
  { name: "Fundraising", aliases: ["fundraising", "donor stewardship"] },
  { name: "Grant writing", aliases: ["grant writing", "grant proposals"] },
  { name: "Welding", aliases: ["welding"] },
  { name: "Electrical installation", aliases: ["electrical installation", "electrical wiring"] },
  { name: "Plumbing", aliases: ["plumbing"] },
  { name: "Carpentry", aliases: ["carpentry"] },
  { name: "Machine operation", aliases: ["machine operation", "cnc machining"] },
  { name: "Quality control", aliases: ["quality control", "quality inspection"] },
  { name: "Driving", aliases: ["safe driving", "delivery driving"] },
  { name: "Customer service", aliases: ["customer service", "guest service"] },
  { name: "Scheduling", aliases: ["staff scheduling", "rostering"] },
  { name: "Health and safety", aliases: ["health and safety", "workplace safety", "osha"] },
  { name: "Childcare", aliases: ["childcare", "child care"] },
  { name: "Cooking", aliases: ["cooking", "food preparation"] },
  { name: "Housekeeping", aliases: ["housekeeping"] },
  { name: "Livestock care", aliases: ["livestock", "animal husbandry"] },
  { name: "Crop production", aliases: ["crop production", "crop harvesting"] },
  { name: "Forklift certification", aliases: ["forklift certification", "forklift licence", "forklift license"] },
  { name: "Bookkeeping", aliases: ["bookkeeping"] },
  { name: "Payroll", aliases: ["payroll"] },
  { name: "Care planning", aliases: ["care planning", "care plans"] },
  { name: "Emergency response", aliases: ["emergency response", "firefighting"] },
  { name: "Microsoft Office", aliases: ["microsoft office", "ms office"] },
];

export function normalise(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

// Word-boundary matching that survives "c++", "c#", ".net" and "node.js": a term must not be
// glued to another word character on either side, but a trailing full stop is allowed.
export function termPattern(alias: string): RegExp {
  const key = alias.toLowerCase();
  let re = patternCache.get(key);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9+#])${escapeRegex(key)}(?![a-z0-9+#]|\\.[a-z0-9])`, "i");
    patternCache.set(key, re);
  }
  return re;
}

// Same character class as termPattern, including A-Z because that pattern is case-insensitive.
function isTermChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 43 || code === 35;
}

function isAsciiAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function leftBoundary(text: string, index: number): boolean {
  return index === 0 || !isTermChar(text.charCodeAt(index - 1));
}

function rightBoundary(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const code = text.charCodeAt(index);
  if (isTermChar(code)) return false;
  return !(code === 46 && index + 1 < text.length && isAsciiAlnum(text.charCodeAt(index + 1)));
}

function containsAlias(haystack: string, alias: string): boolean {
  if (!alias) return false;
  let from = 0;
  while (from <= haystack.length - alias.length) {
    const at = haystack.indexOf(alias, from);
    if (at < 0) return false;
    if (leftBoundary(haystack, at) && rightBoundary(haystack, at + alias.length)) return true;
    from = at + 1;
  }
  return false;
}

/** Literal word-boundary check. `text` may be mixed case; matching follows termPattern. */
export function hasAlias(text: string, alias: string): boolean {
  return containsAlias(text.toLowerCase(), alias.toLowerCase());
}

export function mentions(normalisedText: string, term: Term): boolean {
  const haystack = normalisedText.toLowerCase();
  return term.aliases.some((alias) => containsAlias(haystack, alias.toLowerCase()));
}

interface TermNode {
  next: Map<number, TermNode>;
  names: string[] | null;
}

function buildTermIndex(terms: Term[]): TermNode {
  const root: TermNode = { next: new Map(), names: null };
  for (const term of terms) {
    for (const alias of term.aliases) {
      const key = alias.toLowerCase();
      if (!key) continue;
      let node = root;
      for (let i = 0; i < key.length; i++) {
        const code = key.charCodeAt(i);
        let child = node.next.get(code);
        if (!child) {
          child = { next: new Map(), names: null };
          node.next.set(code, child);
        }
        node = child;
      }
      if (!node.names) node.names = [term.name];
      else if (!node.names.includes(term.name)) node.names.push(term.name);
    }
  }
  return root;
}

const CATALOGUE_INDEX = buildTermIndex(SKILL_CATALOGUE);

function scanTermIndex(text: string, root: TermNode): Set<string> {
  const found = new Set<string>();
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (!leftBoundary(text, i)) {
      i++;
      continue;
    }
    const startCode = text.charCodeAt(i);
    let node = root;
    let j = i;
    while (j < n) {
      const child = node.next.get(text.charCodeAt(j));
      if (!child) break;
      node = child;
      j++;
      if (node.names && rightBoundary(text, j)) {
        for (const name of node.names) found.add(name);
      }
    }
    if (isTermChar(startCode)) {
      i++;
      while (i < n && isTermChar(text.charCodeAt(i))) i++;
    } else {
      i++;
    }
  }
  return found;
}

/**
 * Names of `terms` that occur in already-normalised text.
 * One walk handles every alias, including overlaps such as "sql" inside "sql server".
 */
export function mentionedNamesIn(texts: readonly string[], terms: Term[]): Set<string>[] {
  if (terms.length === 0) return texts.map(() => new Set<string>());
  const index = terms === SKILL_CATALOGUE ? CATALOGUE_INDEX : buildTermIndex(terms);
  return texts.map((text) => (text ? scanTermIndex(text, index) : new Set<string>()));
}

const CATALOGUE_BY_KEY = new Map<string, Term>();
for (const term of SKILL_CATALOGUE) {
  for (const key of [term.name.toLowerCase(), ...term.aliases]) {
    const normalised = key.toLowerCase();
    if (!CATALOGUE_BY_KEY.has(normalised)) CATALOGUE_BY_KEY.set(normalised, term);
  }
}

export function catalogueEntryFor(name: string): Term | undefined {
  return CATALOGUE_BY_KEY.get(name.trim().toLowerCase());
}

// A user skill expands to its catalogue aliases, so "Postgres" on a profile matches "PostgreSQL" in a JD.
export function termForName(name: string): Term {
  const entry = catalogueEntryFor(name);
  const own = name.trim().toLowerCase();
  if (!entry) return { name: name.trim(), aliases: [own] };
  return { name: entry.name, aliases: Array.from(new Set([own, entry.name.toLowerCase(), ...entry.aliases])) };
}

export function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
