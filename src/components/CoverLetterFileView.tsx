import { useEffect, useState } from "react";
import { coverLetterFileLinks } from "../../shared/coverLetterFile";
import { filenameFromContentDisposition, isPdf } from "../../shared/resumeFile";

export function CoverLetterFileView({ jobId, version = "" }: { jobId: string; version?: string }) {
  const links = coverLetterFileLinks(jobId, version);
  const [src, setSrc] = useState("");
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    let objectUrl = "";
    let cancelled = false;
    setLoading(true);
    setError("");
    setSrc("");
    fetch(links.pdf, { credentials: "same-origin", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "The cover letter could not be opened.");
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!isPdf(bytes)) throw new Error("This cover letter did not come back as a PDF.");
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setFilename(filenameFromContentDisposition(res.headers.get("content-disposition")) || "Cover letter.pdf");
        setSrc(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "The cover letter could not be opened.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [links.pdf]);

  return (
    <div className="resume-file">
      <div className="resume-file-actions">
        <a className="btn btn-primary btn-sm" href={links.pdf} target="_blank" rel="noreferrer">View / Print</a>
        <a className="btn btn-ghost btn-sm" href={links.download}>Download PDF</a>
        <a className="btn btn-ghost btn-sm" href={links.html} target="_blank" rel="noreferrer">HTML</a>
      </div>
      {filename && <p className="muted small">{filename}</p>}
      {loading && !error && <p className="muted">Opening the PDF…</p>}
      {error && <div className="alert alert-error">{error}</div>}
      {src && (
        <object className="resume-file-frame" data={src} type="application/pdf" aria-label={filename || "Cover letter PDF"}>
          <iframe className="resume-file-frame" title={filename || "Cover letter PDF"} src={src} />
        </object>
      )}
    </div>
  );
}
