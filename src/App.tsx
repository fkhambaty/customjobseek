import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { JobsProvider } from "./data";
import { AccountPage } from "./pages/AccountPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuthPage } from "./pages/AuthPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { JobPage } from "./pages/JobPage";
import { Landing } from "./pages/Landing";
import { NewJobPage } from "./pages/NewJobPage";
import { OutreachPage } from "./pages/OutreachPage";
import { PipelinePage } from "./pages/PipelinePage";
import { PricingPage } from "./pages/PricingPage";
import { PrintResume } from "./pages/PrintResume";
import { ProfilePage } from "./pages/ProfilePage";
import { ResumesPage } from "./pages/ResumesPage";
import { TodayPage } from "./pages/TodayPage";
import { ResetPage, VerifyPage } from "./pages/VerifyPage";
import { SessionProvider, useSession } from "./session";

function PublicShell({ children }: { children: ReactNode }) {
  const { account } = useSession();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark">CustomJobSeek</Link>
          <nav className="nav">
            <NavLink to="/companies">Companies we scan</NavLink>
            <a href="/#faq">Questions</a>
            <NavLink to="/pricing">Pricing</NavLink>
            {account ? (
              <Link to="/today" className="btn btn-primary btn-sm">Open your search</Link>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/signup" className="btn btn-primary btn-sm">Start free</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} CustomJobSeek</span>
          <span className="footer-links">
            <Link to="/companies">Companies we scan</Link>
            <a href="/#faq">Questions</a>
            <Link to="/pricing">Pricing</Link>
          </span>
          <span className="muted">Your data is encrypted and yours to delete.</span>
        </div>
      </footer>
    </>
  );
}

const OPEN_PATHS = new Set(["/pricing", "/companies"]);

/**
 * One layout for every signed-in page so the job list loads once and the sidebar never remounts.
 * Pricing and the companies list are readable signed out, in the public frame.
 */
function AppLayout() {
  const { account, loading } = useSession();
  const location = useLocation();
  if (loading) return <div className="boot">Opening your search…</div>;
  if (!account) {
    if (OPEN_PATHS.has(location.pathname)) return <PublicShell><Outlet /></PublicShell>;
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return (
    <JobsProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </JobsProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/print/:id" element={<PrintResume />} />
        <Route path="/" element={<PublicShell><Landing /></PublicShell>} />
        <Route path="/login" element={<PublicShell><AuthPage mode="login" /></PublicShell>} />
        <Route path="/signup" element={<PublicShell><AuthPage mode="signup" /></PublicShell>} />
        <Route path="/verify" element={<PublicShell><VerifyPage /></PublicShell>} />
        <Route path="/reset" element={<PublicShell><ResetPage /></PublicShell>} />
        <Route element={<AppLayout />}>
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/outreach" element={<OutreachPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/jobs/new" element={<NewJobPage />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
        <Route path="/jobs" element={<Navigate to="/pipeline" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
