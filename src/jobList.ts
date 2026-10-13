import type { JobRecord } from "../shared/types";

export const JOB_LIST_PAGE_LIMIT = 40;
/** 100 pages of 40. The screen stops here and says so when more jobs remain. */
export const JOB_LIST_CAP = 4_000;

export interface JobListPage {
  jobs: JobRecord[];
  nextCursor: string | null;
}

function isJobRow(value: unknown): value is JobRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/**
 * The current list is `{ jobs, nextCursor }`. An older bare array, or a body that is not that shape, is an error.
 * Callers should show the message. Nothing is deleted.
 */
export function parseJobListResponse(data: unknown): JobListPage {
  if (Array.isArray(data)) {
    throw new Error("The job list came back in an old format. Reload the app. Nothing was deleted.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("The job list could not be read. Reload the app.");
  }
  const body = data as { jobs?: unknown; nextCursor?: unknown };
  if (!Array.isArray(body.jobs) || body.jobs.some((job) => !isJobRow(job))) {
    throw new Error("The job list could not be read. Reload the app.");
  }
  if (body.nextCursor != null && typeof body.nextCursor !== "string") {
    throw new Error("The job list could not be read. Reload the app.");
  }
  return { jobs: body.jobs, nextCursor: body.nextCursor ?? null };
}

export function jobListCapNotice(loaded: number, moreRemain: boolean): string {
  if (loaded >= JOB_LIST_CAP && moreRemain) {
    return `This screen shows the first ${JOB_LIST_CAP.toLocaleString("en-IN")} jobs. The rest are still saved.`;
  }
  return "";
}
