function fileQuery(opts?: { download?: boolean; version?: string }): string {
  const query = new URLSearchParams();
  if (opts?.download) query.set("download", "1");
  if (opts?.version) query.set("v", opts.version);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function coverLetterPdfPath(jobId: string, opts?: { download?: boolean; version?: string }): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/cover-letter/pdf${fileQuery(opts)}`;
}

export function coverLetterHtmlPath(jobId: string, opts?: { version?: string }): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/cover-letter/html${fileQuery({ version: opts?.version })}`;
}

export function coverLetterFileLinks(jobId: string, version?: string) {
  return {
    pdf: coverLetterPdfPath(jobId, { version }),
    download: coverLetterPdfPath(jobId, { download: true, version }),
    html: coverLetterHtmlPath(jobId, { version }),
  };
}
