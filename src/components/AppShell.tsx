import { useEffect, useMemo, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { todayQueues } from "../../shared/engine/insights";
import { useJobs } from "../data";
import { plural, today } from "../format";
import { useSession } from "../session";
import { JOB_TABS, JobView, type JobTab } from "./JobView";

function Item({ to, label, count, hot }: { to: string; label: string; count?: number; hot?: boolean }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? "side-link on" : "side-link")}>
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className={hot ? "side-count hot" : "side-count"}>{count}</span>}
    </NavLink>
  );
}

function Drawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("job");
  const raw = params.get("tab");
  const tab: JobTab = JOB_TABS.includes(raw as JobTab) ? (raw as JobTab) : "overview";

  const close = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("job");
      n.delete("tab");
      return n;
    });

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("drawer-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("drawer-open");
    };
  });

  if (!id) return null;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" aria-label="Job">
        <JobView
          id={id}
          tab={tab}
          onTab={(t) =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.set("tab", t);
              return n;
            })
          }
          onClose={close}
        />
      </aside>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { account, signOut } = useSession();
  const { jobs, profile } = useJobs();
  const navigate = useNavigate();
  const q = useMemo(() => (jobs ? todayQueues(jobs, today()) : null), [jobs]);
  const firstName = profile?.fullName.split(/\s+/)[0] ?? "";

  return (
    <div className="app">
      <aside className="side">
        <Link to="/today" className="wordmark">CustomJobSeek</Link>
        <Link to="/jobs/new" className="btn btn-primary btn-block side-cta">Check a job</Link>
        <nav className="side-nav">
          <Item to="/today" label="Today" count={q ? q.applyNext.length + q.messageNow.length + q.due.length : undefined} hot />
          <Item to="/pipeline" label="Pipeline" count={jobs?.length} />
          <Item to="/outreach" label="Outreach" count={q?.messageNow.length} />
          <Item to="/analytics" label="Analytics" />
          <Item to="/discover" label="Discover" />
          <Item to="/resumes" label="Resumes" />
          <Item to="/companies" label="Companies" />
        </nav>
        <nav className="side-nav side-nav-quiet">
          <Item to="/profile" label="Profile" />
          <Item to="/pricing" label="Plans" />
          <Item to="/account" label="Account" />
        </nav>
        <div className="side-foot">
          {account && (
            <Link to="/account" className="credits">
              {plural(account.scanRuns, "scan")} · {plural(account.evalCredits, "check")} · {plural(account.resumeCredits, "resume")} left
            </Link>
          )}
          <div className="side-user">
            <span>{firstName || account?.email}</span>
            <button
              className="linkish"
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <Drawer />
    </div>
  );
}
