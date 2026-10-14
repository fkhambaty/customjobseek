import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { SearchPath } from "../shared/engine/searchPaths";
import type { JobRecord, Profile } from "../shared/types";
import { api } from "./api";

interface JobsValue {
  jobs: JobRecord[] | null;
  error: string;
  notice: string;
  profile: Profile | null;
  searchPaths: SearchPath[];
  currency: string;
  reload: () => Promise<void>;
  /** Replaces one job in the list after an edit, so every view updates without a refetch. */
  put: (job: JobRecord) => void;
  drop: (id: string) => void;
  open: (id: string, tab?: string) => void;
}

const JobsContext = createContext<JobsValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [searchPaths, setSearchPaths] = useState<SearchPath[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [, setParams] = useSearchParams();

  const reload = useCallback(async () => {
    try {
      const [list, p, paths] = await Promise.all([api.listJobs(), api.getProfile(), api.listSearchPaths()]);
      setJobs(list.jobs);
      setNotice(list.notice);
      setProfile(p.profile);
      setSearchPaths(paths.paths);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const put = useCallback((job: JobRecord) => {
    setJobs((list) => {
      if (!list) return list;
      const i = list.findIndex((j) => j.id === job.id);
      if (i === -1) return [job, ...list];
      const next = list.slice();
      next[i] = job;
      return next;
    });
  }, []);

  const drop = useCallback((id: string) => setJobs((list) => list?.filter((j) => j.id !== id) ?? list), []);

  const open = useCallback(
    (id: string, tab?: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("job", id);
        if (tab) next.set("tab", tab);
        else next.delete("tab");
        return next;
      }),
    [setParams],
  );

  const value = useMemo(
    () => ({ jobs, error, notice, profile, searchPaths, currency: profile?.preferences.currency || "USD", reload, put, drop, open }),
    [jobs, error, notice, profile, searchPaths, reload, put, drop, open],
  );
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobsOptional(): JobsValue | null {
  return useContext(JobsContext);
}

export function useJobs(): JobsValue {
  const v = useContext(JobsContext);
  if (!v) throw new Error("useJobs outside JobsProvider");
  return v;
}
