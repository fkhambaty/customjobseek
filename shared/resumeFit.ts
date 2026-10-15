import { dropWeakestLine } from "./engine/tailor";
import { PdfGlyphError, resumePageCount } from "./resumePdf";
import type { TailoredResume } from "./types";

export const MAX_RESUME_PAGES = 2;
const MAX_TRIMS = 60;

/** Trims the weakest lines until the PDF fits two pages. Type is never shrunk to make it fit. */
export async function fitResumeToPages(resume: TailoredResume, maxPages = MAX_RESUME_PAGES): Promise<TailoredResume> {
  const fitted: TailoredResume = structuredClone(resume);
  try {
    for (let i = 0; i < MAX_TRIMS; i++) {
      if ((await resumePageCount(fitted)) <= maxPages) break;
      if (!dropWeakestLine(fitted)) break;
    }
  } catch (err) {
    if (err instanceof PdfGlyphError) return resume;
    throw err;
  }
  return fitted;
}
