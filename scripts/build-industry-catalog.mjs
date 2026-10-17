/**
 * Builds multi-industry employer catalogs from a public ATS board directory.
 * Output:
 *   shared/data/source-catalog.json          — featured-market curated set (imported + UI counts)
 *   shared/data/industry-employer-catalog.json — larger scan pool tagged by industry sectors
 *
 *   node scripts/build-industry-catalog.mjs [path/to/job-board-directory.csv]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { detectBoard } from "../shared/engine/boards.ts";
import { employerKey } from "../shared/engine/catalog.ts";

const ROOT = new URL("../", import.meta.url);
const LIVE = new Set(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "teamtailor", "recruitee"]);
const FEATURED = ["IN", "US", "GB", "CA", "AU", "SG", "NZ", "IE", "ZA"];

/** Keep in sync with shared/industries.ts */
const SECTORS = {
  technology: ["software", "IT services", "technology", "AI", "data", "cloud", "internet", "security", "semiconductors", "networking", "infrastructure", "fintech"],
  healthcare: ["healthcare", "hospital", "pharma", "biotech", "medical", "nutrition", "wellness", "clinical"],
  finance: ["fintech", "payments", "banking", "finance", "insurance", "professional services"],
  education: ["education", "edtech", "training", "university"],
  manufacturing: ["manufacturing", "engineering", "automotive", "industrial", "aerospace", "semiconductors"],
  hospitality: ["hospitality", "food", "restaurant", "hotel", "nutrition", "wellness"],
  retail: ["retail", "ecommerce", "consumer"],
  operations: ["logistics", "operations", "supply chain", "transport", "delivery"],
  creative: ["media", "advertising", "design", "creative technology", "entertainment"],
  legal: ["legal", "compliance", "professional services"],
  public: ["public sector", "government", "nonprofit", "NGO"],
  agriculture: ["agriculture", "agritech", "food"],
  professional: ["consulting", "professional services", "HR"],
};
const INDUSTRY_IDS = Object.keys(SECTORS);

/** Keyword → industry id. Order matters: first match wins for primary industry. */
const RULES = [
  ["healthcare", /\b(health|hospital|clinic|pharma|biotech|medical|nurs|physician|dental|therap|nutrition|diet|wellness|life[\s-]?sciences|cvs|teladoc|moderna|roche|novartis|pfizer|abbvie|astrazeneca|sanofi|bayer|medtronic|stryker|illumina|tempus|practo|pharmeasy|apollo|fortis|manipal|narayana|max healthcare|hca|kaiser|adventist|athenahealth|agilon)\b/i],
  ["education", /\b(educat|university|school|college|edtech|coursera|duolingo|chegg|2u|blackboard|canvas|pearson|khan|tutor|academy|learning)\b/i],
  ["finance", /\b(bank|financ|capital|invest|asset|insur|payment|fintech|credit|lend|wealth|trading|visa|mastercard|stripe|wise|monzo|groww|cred)\b/i],
  ["hospitality", /\b(hotel|hospitality|restaurant|food[\s-]?service|cafe|catering|marriott|hilton|hyatt|airbnb|doordash|deliveroo|uber\s*eats|starbucks|chipotle|sweetgreen|yum|mcdonald)\b/i],
  ["retail", /\b(retail|ecommerce|e-commerce|shopify|wayfair|etsy|walmart|target|costco|nike|adidas|zara|h&m|meesho|flipkart|myntra|consumer\s*goods)\b/i],
  ["operations", /\b(logistics|supply[\s-]?chain|freight|shipping|delivery|warehouse|transport|fleet|ups|fedex|dhl|ninja\s*van|grab)\b/i],
  ["manufacturing", /\b(manufactur|industrial|automotive|aerospace|semiconductor|hardware|robot|factory|boeing|lockheed|rivian|tesla|spacex|3m|siemens|ge\b|caterpillar|john\s*deere)\b/i],
  ["agriculture", /\b(agricultur|agri|farm|crop|livestock|agtech|indigo|bayer\s*crop|syngenta|monsanto|corteva)\b/i],
  ["legal", /\b(law\b|legal|attorney|counsel|compliance|litigation|notary)\b/i],
  ["public", /\b(government|govtech|public\s*sector|nonprofit|non-profit|ngo|municipal|federal|ministry|council)\b/i],
  ["creative", /\b(media|advertis|marketing|design|creative|entertainment|gaming|studio|agency|spotify|netflix|disney|hootsuite|canva)\b/i],
  ["professional", /\b(consult|advisory|staffing|recruit|hr\b|deloitte|accenture|kpmg|pwc|ey\b|mckinsey|bcg)\b/i],
  ["technology", /\b(software|saas|cloud|cyber|security|data|ai\b|tech|internet|platform|devops|semiconductor|chip)\b/i],
];

const REGION_TO_COUNTRY = {
  india: "IN",
  "united states": "US",
  usa: "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  canada: "CA",
  australia: "AU",
  singapore: "SG",
  "new zealand": "NZ",
  ireland: "IE",
  "south africa": "ZA",
};

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function classify(company, boardUrl) {
  const hay = `${company} ${boardUrl}`;
  for (const [id, re] of RULES) {
    if (re.test(hay)) return id;
  }
  return "technology";
}

function countryOf(row) {
  const region = String(row.region || "").trim().toLowerCase();
  if (REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region];
  const url = String(row.board_url || "").toLowerCase();
  if (/\.co\.in\b|india|bangalore|bengaluru|hyderabad|mumbai|pune|delhi/.test(`${row.company} ${url}`)) return "IN";
  if (/\.co\.uk\b|london|britain/.test(`${row.company} ${url}`)) return "GB";
  if (/\.com\.au\b|sydney|melbourne/.test(`${row.company} ${url}`)) return "AU";
  if (/\.co\.nz\b|auckland/.test(`${row.company} ${url}`)) return "NZ";
  if (/\.ca\b|toronto|vancouver|montreal/.test(`${row.company} ${url}`)) return "CA";
  if (/singapore|\.sg\b/.test(`${row.company} ${url}`)) return "SG";
  if (/ireland|dublin|\.ie\b/.test(`${row.company} ${url}`)) return "IE";
  if (/johannesburg|cape\s*town|\.za\b/.test(`${row.company} ${url}`)) return "ZA";
  // Default US for global Workday/Greenhouse boards without a region tag.
  return "US";
}

function prettyName(company) {
  const raw = String(company || "").trim();
  if (!raw) return "Unknown";
  if (/[A-Z]/.test(raw) && /[a-z]/.test(raw)) return raw.slice(0, 80);
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80);
}

/** Extra boards forced into thin industries — only live ATS URLs our scanner can read. */
const HAND_EXTRA = [
  { name: "CVS Health", careerUrl: "https://cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers", country: "US", industry: "healthcare" },
  { name: "Adventist HealthCare", careerUrl: "https://adventisthealthcare.wd1.myworkdayjobs.com/AdventistHealthCareCareers", country: "US", industry: "healthcare" },
  { name: "athenahealth", careerUrl: "https://athenahealth.wd1.myworkdayjobs.com/External", country: "US", industry: "healthcare" },
  { name: "Cityblock Health", careerUrl: "https://cityblockhealth.wd1.myworkdayjobs.com/CityblockExternalCareerSite", country: "US", industry: "healthcare" },
  { name: "Coursera", careerUrl: "https://boards.greenhouse.io/coursera", country: "US", industry: "education" },
  { name: "Duolingo", careerUrl: "https://boards.greenhouse.io/duolingo", country: "US", industry: "education" },
  { name: "Chegg", careerUrl: "https://boards.greenhouse.io/chegg", country: "US", industry: "education" },
  { name: "Outschool", careerUrl: "https://jobs.lever.co/outschool", country: "US", industry: "education" },
  { name: "DoorDash", careerUrl: "https://boards.greenhouse.io/doordashusa", country: "US", industry: "hospitality" },
  { name: "Instacart", careerUrl: "https://boards.greenhouse.io/instacart", country: "US", industry: "hospitality" },
  { name: "Sweetgreen", careerUrl: "https://boards.greenhouse.io/sweetgreen", country: "US", industry: "hospitality" },
  { name: "Rippling Commerce", careerUrl: "https://boards.greenhouse.io/rippling", country: "US", industry: "retail" },
  { name: "Whatnot", careerUrl: "https://boards.greenhouse.io/whatnot", country: "US", industry: "retail" },
  { name: "Faire", careerUrl: "https://boards.greenhouse.io/faire", country: "US", industry: "retail" },
  { name: "Rivian", careerUrl: "https://jobs.lever.co/rivian", country: "US", industry: "manufacturing" },
  { name: "Anduril", careerUrl: "https://boards.greenhouse.io/andurilindustries", country: "US", industry: "manufacturing" },
  { name: "Samsara", careerUrl: "https://boards.greenhouse.io/samsara", country: "US", industry: "operations" },
  { name: "Flexport", careerUrl: "https://boards.greenhouse.io/flexport", country: "US", industry: "operations" },
  { name: "Spotify", careerUrl: "https://boards.greenhouse.io/spotify", country: "US", industry: "creative" },
  { name: "Discord", careerUrl: "https://boards.greenhouse.io/discord", country: "US", industry: "creative" },
  { name: "Notion", careerUrl: "https://boards.greenhouse.io/notion", country: "US", industry: "technology" },
  { name: "GovTech Singapore", careerUrl: "https://boards.greenhouse.io/govtech", country: "SG", industry: "public" },
  { name: "Chan Zuckerberg Initiative", careerUrl: "https://boards.greenhouse.io/chanzuckerberginitiative", country: "US", industry: "public" },
  { name: "Wikimedia Foundation", careerUrl: "https://boards.greenhouse.io/wikimedia", country: "US", industry: "public" },
  { name: "Indigo Ag", careerUrl: "https://boards.greenhouse.io/indigoag", country: "US", industry: "agriculture" },
  { name: "Corteva", careerUrl: "https://corteva.wd1.myworkdayjobs.com/Corteva_External_Careers", country: "US", industry: "agriculture" },
  { name: "Cooley", careerUrl: "https://boards.greenhouse.io/cooley", country: "US", industry: "legal" },
  { name: "Gunderson Dettmer", careerUrl: "https://boards.greenhouse.io/gundersondettmer", country: "US", industry: "legal" },
  { name: "Paradox", careerUrl: "https://boards.greenhouse.io/paradoxai", country: "US", industry: "professional" },
  { name: "Remote.com", careerUrl: "https://boards.greenhouse.io/remotecom", country: "US", industry: "professional" },
];

function main() {
  const candidates = [
    process.argv[2],
    "C:/Users/FK/.cursor/projects/c-Users-FK-Documents-GitHub-customjobseek/agent-tools/97f80689-b377-4d4d-999e-9b4ac8f338d1.txt",
    new URL("./data/public-board-directory.csv", import.meta.url).pathname,
  ].filter(Boolean);

  let text = null;
  let used = null;
  for (const p of candidates) {
    const norm = p.replace(/^\/([A-Za-z]:)/, "$1");
    if (existsSync(norm)) {
      text = readFileSync(norm, "utf8");
      used = norm;
      break;
    }
  }
  if (!text) throw new Error("Pass the job-board-directory.csv path as the first argument.");

  const rows = parseCsv(text);
  const live = rows.filter((r) => LIVE.has(String(r.platform || "").toLowerCase()) && r.board_url);
  const classified = [];
  const seenUrl = new Set();

  for (const r of live) {
    const careerUrl = String(r.board_url).trim().replace(/\/$/, "");
    if (!careerUrl.startsWith("http") || seenUrl.has(careerUrl.toLowerCase())) continue;
    seenUrl.add(careerUrl.toLowerCase());
    const industry = classify(r.company, careerUrl);
    const country = countryOf(r);
    if (!FEATURED.includes(country)) continue;
    classified.push({
      name: prettyName(r.company),
      careerUrl,
      country,
      sectors: SECTORS[industry] ?? SECTORS.technology,
      industry,
      openRoles: Number(r.open_roles) || 0,
      platform: String(r.platform || "").toLowerCase(),
    });
  }

  // Force thin-industry boards into the classified pool (before capping).
  for (const row of HAND_EXTRA) {
    const key = row.careerUrl.toLowerCase();
    if (seenUrl.has(key)) continue;
    seenUrl.add(key);
    classified.push({
      name: row.name,
      careerUrl: row.careerUrl,
      country: row.country,
      sectors: SECTORS[row.industry] ?? SECTORS.technology,
      industry: row.industry,
      openRoles: 9999,
      platform: "hand",
    });
  }

  // Larger scan pool: top boards per industry (by open roles), capped.
  const PER_INDUSTRY = 80;
  const industryPool = [];
  for (const ind of INDUSTRY_IDS) {
    const pool = classified
      .filter((r) => r.industry === ind)
      .sort((a, b) => b.openRoles - a.openRoles);
    industryPool.push(...pool.slice(0, PER_INDUSTRY));
  }

  // Featured curated set: ensure every market + every industry appears.
  const curated = [];
  const curatedKeys = new Set();
  const take = (row) => {
    const board = detectBoard(row.careerUrl);
    const key = employerKey(row.careerUrl) || row.careerUrl.toLowerCase();
    if (!board || curatedKeys.has(key)) return;
    curatedKeys.add(key);
    curated.push({
      name: row.name,
      careerUrl: board.careerUrl,
      country: row.country,
      sectors: row.sectors,
    });
  };

  // Preserve the hand-curated boards first (known-good URLs).
  const previous = JSON.parse(readFileSync(new URL("shared/data/source-catalog.json", ROOT), "utf8"));
  for (const row of previous) take(row);

  for (const country of FEATURED) {
    const inCountry = classified.filter((r) => r.country === country).sort((a, b) => b.openRoles - a.openRoles);
    for (const row of inCountry.slice(0, 8)) take(row);
  }
  for (const ind of INDUSTRY_IDS) {
    const pool = classified.filter((r) => r.industry === ind).sort((a, b) => b.openRoles - a.openRoles);
    for (const row of pool.slice(0, 6)) take(row);
  }

  const industryOut = industryPool.map(({ name, careerUrl, country, sectors }) => ({ name, careerUrl, country, sectors }));
  const indSeen = new Set();
  const industryDeduped = [];
  for (const row of [...industryOut, ...curated]) {
    const board = detectBoard(row.careerUrl);
    if (!board) continue;
    const k = employerKey(row.careerUrl) || board.careerUrl.toLowerCase();
    if (indSeen.has(k)) continue;
    indSeen.add(k);
    industryDeduped.push({ ...row, careerUrl: board.careerUrl });
  }

  writeFileSync(new URL("shared/data/source-catalog.json", ROOT), `${JSON.stringify(curated, null, 2)}\n`);
  writeFileSync(new URL("shared/data/industry-employer-catalog.json", ROOT), `${JSON.stringify(industryDeduped, null, 2)}\n`);

  const byInd = Object.fromEntries(INDUSTRY_IDS.map((id) => [id, 0]));
  for (const row of industryDeduped) {
    const ind = classify(row.name, row.careerUrl);
    byInd[ind] = (byInd[ind] ?? 0) + 1;
  }
  const byCountry = Object.fromEntries(FEATURED.map((c) => [c, curated.filter((r) => r.country === c).length]));
  console.log(`Source CSV: ${used}`);
  console.log(`Live boards classified: ${classified.length}`);
  console.log(`Curated source-catalog: ${curated.length}`, byCountry);
  console.log(`Industry employer catalog: ${industryDeduped.length}`, byInd);
}

main();
