// Stores the Command Center's own finished resume files (the exact PDF it printed and the
// HTML it printed from) as each imported job's resume, and for the standard resumes.
// Nothing is redrawn here, so the file a person opens is byte-for-byte the Command Center one.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { d1 } from "./cloud.mjs";

const UPSERT = `INSERT INTO resume_artifacts
  (user_id, artifact_key, kind, job_id, upload_id, filename, html_ciphertext, pdf_ciphertext, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(user_id, artifact_key) DO UPDATE SET
    kind = excluded.kind, job_id = excluded.job_id, upload_id = excluded.upload_id, filename = excluded.filename,
    html_ciphertext = excluded.html_ciphertext, pdf_ciphertext = excluded.pdf_ciphertext, updated_at = datetime('now')`;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

export function isPdfBytes(bytes) {
  return Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");
}

async function encryptBytes(dataKey, bytes) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(Buffer.from(dataKey, "base64")), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return `${b64(iv)}.${b64(ct)}`;
}

async function encryptJson(dataKey, value) {
  return encryptBytes(dataKey, new TextEncoder().encode(JSON.stringify(value)));
}

function read(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

/** The tailored resume pair in a job folder: "X_Resume.html" prints to "X.pdf". */
export function resumePair(dir) {
  const folder = dir.endsWith("/") ? dir : `${dir}/`;
  if (!existsSync(folder)) return null;
  const files = readdirSync(folder);
  const htmls = files.filter((f) => f.endsWith("_Resume.html"));
  const tailored = htmls.find((f) => f !== "FakhruddinKhambaty_Resume.html") ?? htmls[0] ?? null;
  const html = tailored ?? files.find((f) => f.startsWith("FakhruddinKhambaty") && f.endsWith(".html")) ?? null;
  const stem = tailored ? tailored.replace(/_Resume\.html$/, "") : "FakhruddinKhambaty";
  const pdfName = files.includes(`${stem}.pdf`) ? `${stem}.pdf` : files.includes("FakhruddinKhambaty.pdf") ? "FakhruddinKhambaty.pdf" : null;
  if (!pdfName) return null;
  const pdf = read(`${folder}${pdfName}`);
  if (!pdf || !isPdfBytes(pdf)) return null;
  const htmlBytes = html ? read(`${folder}${html}`) : null;
  return { pdf: new Uint8Array(pdf), html: htmlBytes ? htmlBytes.toString("utf8") : null, pdfName };
}

function fallbackHtml(title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><p>Open the PDF for this resume.</p></body></html>`;
}

async function store(dataKey, userId, artifact, pair, filename) {
  const html = pair.html ?? fallbackHtml(filename);
  const [htmlCipher, pdfCipher] = await Promise.all([
    encryptBytes(dataKey, new TextEncoder().encode(html)),
    encryptBytes(dataKey, pair.pdf),
  ]);
  await d1(UPSERT, [userId, artifact.key, artifact.kind, artifact.jobId, artifact.uploadId, filename, htmlCipher, pdfCipher]);
}

/** Job ids exactly as the import assigns them, with each job's folder. */
export function plannedJobs(jobs, CC) {
  const used = new Set();
  return jobs.map((job) => {
    let id = `cc:${job.id}`.slice(0, 170);
    while (used.has(id)) id = `${id}-${used.size}`.slice(0, 180);
    used.add(id);
    return { job, id, folder: `${CC}/${String(job.folder ?? "").replace(/^\.\//, "")}` };
  });
}

/** Standard resumes in import order: the generic one, then each Resumes_Standard folder. */
export function standardBases(CC, userId) {
  const list = [{ label: "Generic resume", dir: `${CC}/Generic_Resume_Platinum`, html: `${CC}/Generic_Resume_Platinum/FakhruddinKhambaty_Generic_Resume_Platinum.html` }];
  for (const dir of readdirSync(`${CC}/Resumes_Standard`, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    list.push({
      label: dir.name.replace(/^\d+_/, "").replace(/_/g, " "),
      dir: `${CC}/Resumes_Standard/${dir.name}`,
      html: `${CC}/Resumes_Standard/${dir.name}/FakhruddinKhambaty_Resume.html`,
    });
  }
  return list.map((base, i) => ({ ...base, id: `cc-base-${i}-${userId}` }));
}

/** planned: [{ id, folder }] for imported jobs. bases: [{ id, dir }] for standard resumes. */
export async function syncResumeFiles({ dataKey, userId, planned, bases, name = "FakhruddinKhambaty" }) {
  const known = new Set((await d1("SELECT id FROM jobs WHERE user_id = ? AND id LIKE 'cc:%'", [userId])).map((r) => r.id));
  let jobs = 0;
  let notImported = 0;
  let noFile = 0;
  for (const { id, folder } of planned) {
    if (!known.has(id)) {
      notImported++;
      continue;
    }
    const pair = resumePair(folder);
    if (!pair) {
      noFile++;
      continue;
    }
    await store(dataKey, userId, { key: `job:${id}`, kind: "job", jobId: id, uploadId: null }, pair, `${name}.pdf`);
    jobs++;
  }
  let standard = 0;
  for (const { id, dir, label, html } of bases) {
    const pair = resumePair(dir);
    if (!pair) continue;
    const source = read(html)?.toString("utf8") ?? pair.html ?? "";
    await d1(
      `INSERT INTO resume_uploads (id, user_id, filename, label, format, text_ciphertext) VALUES (?, ?, ?, ?, 'html', ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, text_ciphertext = excluded.text_ciphertext`,
      [id, userId, String(html).split("/").pop(), label, await encryptJson(dataKey, { text: source })],
    );
    await store(dataKey, userId, { key: `upload:${id}`, kind: "upload", jobId: null, uploadId: id }, pair, `${name}.pdf`);
    standard++;
  }
  return { jobs, notImported, noFile, standard };
}
