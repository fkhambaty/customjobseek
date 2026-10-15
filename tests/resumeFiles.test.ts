import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToResumeBlocks, htmlToVisibleText, renderPlainTextHtml, renderResumeHtml } from "../shared/resumeHtml";
import { fitResumeToPages } from "../shared/resumeFit";
import {
  PDF_A4,
  PDF_FONT_BYTES,
  PDF_FONT_LIMIT,
  PdfGlyphError,
  pdfRefusalBytes,
  pdfRefusalMessage,
  renderHtmlResumePdf,
  renderResumePdf,
  renderTextPdf,
  resumePageCount,
} from "../shared/resumePdf";
import {
  artifactIdentity,
  contentDisposition,
  parseResumeFileRoute,
  resumeFileHeaders,
  resumeFileLinks,
  safeResumeFilename,
  sameOwner,
  toPublicResumeUpload,
  visibleToOwner,
} from "../shared/resumeFile";
import type { TailoredResume } from "../shared/types";
import { decryptBytes, encryptBytes } from "../worker/crypto";
import { INSERT_RESUME_ARTIFACT } from "../worker/resumeArtifacts";
import { chargeGatedInsert } from "../worker/discoverMatch";

function resume(overrides: Partial<TailoredResume> = {}): TailoredResume {
  return {
    fullName: "Asha Rao",
    headline: "Analytics Engineer",
    contact: ["asha@example.com", "Pune"],
    summary: "Analytics engineer who turns messy data into models people trust.",
    coreStrengths: ["SQL", "Stakeholder reviews"],
    skills: ["SQL", "dbt"],
    roles: [
      {
        experienceId: "e1",
        company: "Acme",
        title: "Senior Analytics Engineer",
        location: "Pune",
        start: "2021",
        end: "Present",
        omittedBulletCount: 0,
        bullets: [{ id: "b1", text: "Built 120 dbt models on Snowflake." }],
      },
    ],
    education: [{ id: "ed1", degree: "B.Sc.", institution: "Pune University", year: "2014" }],
    certifications: [{ id: "c1", name: "dbt", issuer: "dbt Labs", year: "2022" }],
    provenance: { untraceableLines: [], neverClaimHits: [] },
    generatedFor: { jobId: "master", title: "", company: "" },
    ...overrides,
  };
}

describe("resume file names and routes", () => {
  const jobId = "123e4567-e89b-12d3-a456-426614174000";

  it("keeps filenames free of paths, quotes, and header breaks", () => {
    expect(safeResumeFilename("../../etc/passwd\r\n.pdf", "pdf")).toBe("etcpasswd.pdf");
    expect(safeResumeFilename("Asha/Rao:resume", "html")).toBe("AshaRaoresume.html");
    const header = contentDisposition("attachment", 'Asha "Rao"\r\n.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="Asha Rao.pdf"');
    expect(header.startsWith("attachment;")).toBe(true);
  });

  it("parses owned file routes and refuses other shapes", () => {
    expect(parseResumeFileRoute("job", jobId, "pdf", "1")).toEqual({
      kind: "job",
      id: jobId,
      format: "pdf",
      disposition: "attachment",
    });
    expect(parseResumeFileRoute("job", jobId, "pdf", null)?.disposition).toBe("inline");
    expect(parseResumeFileRoute("master", "master", "html", "1")?.disposition).toBe("inline");
    expect(parseResumeFileRoute("upload", jobId, "pdf", "true")?.disposition).toBe("attachment");
    expect(parseResumeFileRoute("master", "other", "pdf", null)).toBeNull();
    expect(parseResumeFileRoute("job", "../secret", "pdf", null)).toBeNull();
    expect(parseResumeFileRoute("job", "..", "pdf", null)).toBeNull();
    expect(parseResumeFileRoute("job", "a\nb", "pdf", null)).toBeNull();
    expect(parseResumeFileRoute("job", "x".repeat(201), "pdf", null)).toBeNull();
    expect(parseResumeFileRoute("note", jobId, "pdf", null)).toBeNull();
    expect(artifactIdentity("job", jobId)).toEqual({ kind: "job", artifactKey: `job:${jobId}`, jobId, uploadId: null });
    expect(artifactIdentity("upload", jobId).artifactKey).toBe(`upload:${jobId}`);
    expect(artifactIdentity("master", "master")).toEqual({ kind: "master", artifactKey: "master", jobId: null, uploadId: null });
    expect(() => artifactIdentity("job", "../x")).toThrow(/Invalid job id/);
  });

  it("accepts the ids that imported and scanned jobs really use", async () => {
    const ids = [
      "cc:Citi|26995386|Citi_Analytics_and_Insights_Lead_Vice_President",
      "cc:Morgan Stanley|PT-JR041807|MorganStanley_Business_Analyst_Director_Change_Analytics_Strategy_PT-JR041807",
      "cc:Jobgether (partner company undisclosed)|44fb299f|Jobgether_partner_company_undisclosed_Business_I",
      "cc:A/B Testing Co|req.1|Lead_Analyst",
      "cc:100% Remote Ltd|7|Analyst",
      `cc:${"x".repeat(167)}`,
    ];
    const app = new Hono().get("/api/resumes/files/:kind/:id/:format", (c) => {
      const route = parseResumeFileRoute(c.req.param("kind"), c.req.param("id"), c.req.param("format"), c.req.query("download") ?? null);
      return route ? c.json(route) : c.text("missing", 404);
    });
    for (const id of ids) {
      expect(artifactIdentity("job", id)).toEqual({ kind: "job", artifactKey: `job:${id}`, jobId: id, uploadId: null });
      const links = resumeFileLinks("job", id);
      for (const path of [links.pdf, links.download, links.html]) {
        const res = await app.request(path);
        expect(res.status, `${id} via ${path}`).toBe(200);
        expect(((await res.json()) as { id: string }).id).toBe(id);
      }
    }
  });

  it("shows an artifact only to its owner", () => {
    expect(sameOwner("user-a", "user-a")).toBe(true);
    expect(sameOwner("user-a", "user-b")).toBe(false);
    expect(sameOwner("", "user-a")).toBe(false);
    expect(visibleToOwner({ user_id: "user-a", filename: "Asha Rao.pdf" }, "user-b")).toBeNull();
    expect(visibleToOwner({ user_id: "user-a", filename: "Asha Rao.pdf" }, "user-a")?.filename).toBe("Asha Rao.pdf");
  });

  it("keeps ciphertext and pdf bytes out of library JSON", () => {
    const cipher = "iv.ciphervalue";
    const row = toPublicResumeUpload({
      id: "up-1",
      label: "",
      filename: "Asha Rao.pdf",
      format: "pdf",
      created_at: "2026-01-01 00:00:00",
      text_ciphertext: cipher,
      html_ciphertext: cipher,
      pdf_ciphertext: "JVBERi0base64",
    });
    expect(row).toEqual({ id: "up-1", label: "Asha Rao.pdf", format: "pdf", createdAt: "2026-01-01 00:00:00" });
    const json = JSON.stringify(row);
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("JVBERi0");
    expect(JSON.stringify(resumeFileLinks("job", jobId))).not.toContain("ciphertext");
  });

  it("sets download, HTML, and framing headers that survive the API security middleware", async () => {
    const app = new Hono();
    app.use("*", secureHeaders());
    app.get("/pdf", (c) => c.body(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 200, resumeFileHeaders({ format: "pdf", disposition: "attachment" }, "Asha Rao")));
    app.get("/html", (c) => c.body("<p>ok</p>", 200, resumeFileHeaders({ format: "html", disposition: "inline" }, "Asha Rao")));
    const pdf = await app.request("http://localhost/pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("attachment");
    expect(pdf.headers.get("content-disposition")).toContain("Asha Rao.pdf");
    expect(pdf.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(pdf.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    expect(pdf.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const html = await app.request("http://localhost/html");
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("content-disposition")).toContain("inline");
    expect(html.headers.get("content-disposition")).toContain("Asha Rao.html");
    expect(html.headers.get("content-security-policy")).toContain("style-src 'unsafe-inline'");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("cache-control")).toBe("private, no-store");
  });

  it("gates scan inserts for resume files the same way as other pack rows", () => {
    const sql = chargeGatedInsert(INSERT_RESUME_ARTIFACT);
    expect(sql).toContain("INSERT INTO resume_artifacts");
    expect(sql).toContain("SELECT ?, ?, ?, ?, ?, ?, ?, ?");
    expect(sql).not.toContain("VALUES");
  });
});

describe("resume HTML", () => {
  it("escapes text and repeats the current resume styling", () => {
    const html = renderResumeHtml(resume({ fullName: `<img src=x onerror=alert(1)>`, summary: `Tom & "Jerry" <script>` }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img");
    expect(html).toContain("&#38;");
    expect(html).toContain('class="resume"');
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(html).toContain("@media screen and (max-width: 800px)");
    expect(html).toContain("#0b4f8a");
    expect(html).toContain("Professional Experience");
    expect(html).toContain("Acme");
    expect(renderResumeHtml(resume())).toBe(renderResumeHtml(resume()));
    const plain = renderPlainTextHtml("Notes", "<b>kept as text</b>");
    expect(plain).not.toContain("<b>");
    expect(plain).toContain("&#60;b&#62;");
    expect(htmlToVisibleText("<style>h1{}</style><script>alert(1)</script><p>Hello &amp; welcome</p>")).toContain("Hello & welcome");
    expect(htmlToVisibleText("<script>alert(1)</script><p>Hello</p>")).not.toContain("alert");
  });

  it("reads a stored CommandCenter HTML resume as structured blocks, never a text dump", async () => {
    const stored = [
      "<!doctype html><html><head><meta charset='utf-8'><title>Fakhruddin Khambaty - Resume</title><style>h1{color:red}</style></head><body>",
      "<header><h1>Fakhruddin Khambaty</h1><div class=\"headline\">Snowflake Data Engineer | SQL, dbt</div>",
      "<div class=\"contact\">+91 98335 65272&nbsp;&nbsp;|&nbsp;&nbsp;fk@example.com</div></header>",
      "<h2>Profile</h2><p>Snowflake engineer&nbsp;with <strong>about six years</strong> on the platform &amp; dbt.</p>",
      "<h2>Selected Impact</h2><ul class=\"impact\"><li>Built <strong>10</strong> models</li><li>Cut cost</li></ul>",
      "<h2>Core Capabilities</h2><p class=\"cap\"><strong>Warehousing:</strong> Snowflake, dbt</p>",
      "<h2>Experience</h2><div class=\"role\"><div class=\"rh\"><span class=\"rc\">OpenGov Inc., Senior Engineer</span><span class=\"rd\">Aug 2025 to Present</span></div>",
      "<div class=\"sub\">Functional Lead &middot; Pune</div><ul><li>Own <strong>dbt</strong> layers&nbsp;on Snowflake.</li></ul>",
      "<div class=\"env\"><strong>Environment:</strong> Snowflake, dbt</div></div>",
      "<h2>Education</h2><p class=\"edu\">B.Sc. Computer Science&nbsp;&nbsp;|&nbsp;&nbsp;University of Mumbai</p>",
      "</body></html>",
    ].join("");
    const blocks = htmlToResumeBlocks(stored);
    expect(blocks).toEqual([
      { kind: "name", text: "Fakhruddin Khambaty" },
      { kind: "headline", text: "Snowflake Data Engineer | SQL, dbt" },
      { kind: "contact", text: "+91 98335 65272 | fk@example.com" },
      { kind: "heading", text: "Profile" },
      { kind: "text", text: "Snowflake engineer with about six years on the platform & dbt." },
      { kind: "heading", text: "Selected Impact" },
      { kind: "impact", text: "Built 10 models" },
      { kind: "impact", text: "Cut cost" },
      { kind: "heading", text: "Core Capabilities" },
      { kind: "labelled", label: "Warehousing", text: "Snowflake, dbt" },
      { kind: "heading", text: "Experience" },
      { kind: "role", text: "OpenGov Inc., Senior Engineer", right: "Aug 2025 to Present" },
      { kind: "sub", text: "Functional Lead · Pune" },
      { kind: "bullet", text: "Own dbt layers on Snowflake." },
      { kind: "labelled", label: "Environment", text: "Snowflake, dbt" },
      { kind: "heading", text: "Education" },
      { kind: "text", text: "B.Sc. Computer Science | University of Mumbai" },
    ]);
    const visible = htmlToVisibleText(stored);
    expect(visible).not.toMatch(/&nbsp;|&amp;|&middot;|<|Resume<\/title>|color:red/);
    expect(visible.startsWith("Fakhruddin Khambaty\n")).toBe(true);
    expect(decodeEntities("a&nbsp;b &#x2013; &#8212; &rsquo;")).toBe("a b – — ’");

    const pdf = await renderHtmlResumePdf("Resume", stored);
    const text = (await extractText(await getDocumentProxy(pdf), { mergePages: true })).text;
    expect(text).toContain("FAKHRUDDIN KHAMBATY");
    expect(text).toContain("SELECTED IMPACT");
    expect(text).toContain("Aug 2025 to Present");
    expect(text).not.toMatch(/&nbsp;|RESUME|Fakhruddin Khambaty - Resume/);
  });

  it("renders the CommandCenter section order and role environment", () => {
    const html = renderResumeHtml(resume({
      selectedImpact: ["Built 120 dbt models on Snowflake."],
      capabilityGroups: [
        { name: "Warehousing & Transformation", items: ["Snowflake", "dbt", "SQL"] },
        { name: "Orchestration & Quality", items: ["Apache Airflow", "Data Quality"] },
      ],
      aiAssistedDelivery: "Used AI-assisted development with human review before merge.",
      roles: resume().roles.map((role) => ({ ...role, environment: ["Snowflake", "dbt", "SQL"] })),
    }));
    expect(html.indexOf("Selected Impact")).toBeLessThan(html.indexOf("Core Capabilities"));
    expect(html.indexOf("Core Capabilities")).toBeLessThan(html.indexOf("AI-Assisted Delivery"));
    expect(html.indexOf("AI-Assisted Delivery")).toBeLessThan(html.indexOf("Professional Experience"));
    expect(html).toContain("<strong>Environment:</strong> Snowflake, dbt, SQL");
    expect(html).toContain("Education &amp; Certifications");
    expect(html).not.toContain("<h2>Skills</h2>");
  });
});

async function pdfText(pdf: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(pdf);
  const extracted = await extractText(doc, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

describe("resume PDF", () => {
  it("embeds accented Latin, the rupee sign, and Devanagari", async () => {
    expect(PDF_FONT_LIMIT).toContain("Devanagari");
    expect(PDF_FONT_LIMIT).not.toContain("?");
    expect(PDF_FONT_BYTES).toBeLessThan(120_000);
    const pdf = await renderResumePdf(resume({
      fullName: "मोहन Café",
      headline: "नमस्ते",
      summary: "Offer ₹ 80,000 for café work.",
    }));
    expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe("%PDF-");
    const text = await pdfText(pdf);
    expect(text).toContain("café");
    expect(text).toContain("₹");
    expect(text).toContain("नमस्ते");
    expect(text).toContain("मोहन");
    expect(text).not.toContain("?");
  });

  it("refuses an unsupported script before saving a PDF", async () => {
    const html = renderResumeHtml(resume({ summary: "Hello 你好" }));
    expect(html).toContain("你好");
    await expect(renderResumePdf(resume({ summary: "Hello 你好" }))).rejects.toBeInstanceOf(PdfGlyphError);
    await expect(renderTextPdf("Notes", "Hello 你好")).rejects.toThrow(/exact HTML resume/);
    try {
      await renderTextPdf("Notes", "你好");
    } catch (err) {
      expect(err).toBeInstanceOf(PdfGlyphError);
      expect((err as PdfGlyphError).message).toContain("你");
      expect((err as PdfGlyphError).message).not.toContain("?");
    }
    const marker = pdfRefusalBytes("This PDF cannot draw these characters: 你. The exact HTML resume is unchanged and still available.");
    expect(pdfRefusalMessage(marker)).toContain("你");
    expect(pdfRefusalMessage(marker)).toContain("HTML");
    expect(String.fromCharCode(...marker.subarray(0, 5))).not.toBe("%PDF-");
  });

  it("writes a valid multi-page A4 file and round-trips the bytes", async () => {
    const long = resume({
      roles: Array.from({ length: 24 }, (_, role) => ({
        experienceId: `e${role}`,
        company: "Acme Analytics",
        title: "Senior Analytics Engineer",
        location: "Pune",
        start: "2018",
        end: "2024",
        omittedBulletCount: 0,
        bullets: Array.from({ length: 6 }, (_, bullet) => ({
          id: `b${role}-${bullet}`,
          text: "Built warehouse models, reconciled finance numbers, and wrote tests that stop a bad build before the weekly review.",
        })),
      })),
    });
    const pdf = await renderResumePdf(long);
    expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe("%PDF-");
    expect(new TextDecoder().decode(pdf.subarray(pdf.length - 16))).toContain("%%EOF");
    const opened = await PDFDocument.load(pdf);
    expect(opened.getPageCount()).toBeGreaterThan(1);
    for (let page = 0; page < opened.getPageCount(); page++) {
      const size = opened.getPage(page).getSize();
      expect(size.width).toBeCloseTo(PDF_A4.width, 2);
      expect(size.height).toBeCloseTo(PDF_A4.height, 2);
    }
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const cipher = await encryptBytes(secret, pdf);
    expect(cipher.includes(".")).toBe(true);
    expect(JSON.stringify({ ok: true })).not.toContain(cipher);
    const back = await decryptBytes(secret, cipher);
    expect(back).toEqual(pdf);
  });

  it("fits a long resume to two pages by trimming lines, oldest role first", async () => {
    const text = "Built warehouse models, reconciled finance numbers, and wrote tests that stop a bad build before the weekly review.";
    const long = resume({
      selectedImpact: Array.from({ length: 6 }, (_, i) => `Cut reporting time by ${i + 10}% across the finance estate.`),
      roles: Array.from({ length: 6 }, (_, role) => ({
        experienceId: `e${role}`,
        company: `Company ${role}`,
        title: "Senior Analytics Engineer",
        location: "Pune",
        start: "Jan 2018",
        end: "Dec 2024",
        omittedBulletCount: 0,
        bullets: Array.from({ length: 9 }, (_, bullet) => ({ id: `b${role}-${bullet}`, text })),
      })),
    });
    expect(await resumePageCount(long)).toBeGreaterThan(2);
    const fitted = await fitResumeToPages(long);
    expect(await resumePageCount(fitted)).toBeLessThanOrEqual(2);
    expect(fitted.roles.every((role) => role.bullets.length >= 2)).toBe(true);
    expect(fitted.roles[0]!.bullets.length).toBeGreaterThanOrEqual(fitted.roles[5]!.bullets.length);
    expect(fitted.roles[5]!.bullets).toHaveLength(2);
    expect(long.roles[5]!.bullets).toHaveLength(9);
    const pdf = await renderResumePdf(fitted);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeLessThanOrEqual(2);
    const html = renderResumeHtml(fitted);
    expect(html).toContain("Company 0, Senior Analytics Engineer");
    expect(html).toContain("Jan 2018 to Dec 2024 | Pune");
  });
});
