import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AccountPage } from "./pages/AccountPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { AuthPage } from "./pages/AuthPage";
import { JobPage } from "./pages/JobPage";
import { JobsPage } from "./pages/JobsPage";
import { Landing } from "./pages/Landing";
import { NewJobPage } from "./pages/NewJobPage";
import { PricingPage } from "./pages/PricingPage";
import { PrintResume } from "./pages/PrintResume";
import { ResetPage, VerifyPage } from "./pages/VerifyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SessionProvider, useSession } from "./session";

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark" aria-hidden>
        <svg viewBox="0 0 32 32" width="26" height="26">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M9 17l4.5 4.5L23 11" stroke="white" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      CustomJobSeek
    </Link>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Header() {
  const { account, signOut } = useSession();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="nav">
          {account ? (
            <>
              <NavLink to="/jobs">Jobs</NavLink>
              <NavLink to="/companies">Companies</NavLink>
              <NavLink to="/profile">Profile</NavLink>
              <NavLink to="/pricing">Plans</NavLink>
              <NavLink to="/account" className="credits-pill" title="Fit checks / tailored resumes left">
                {plural(account.evalCredits, "check")} · {plural(account.resumeCredits, "resume")}
              </NavLink>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/companies">Companies</NavLink>
              <a href="/#faq">FAQ</a>
              <NavLink to="/pricing">Pricing</NavLink>
              <NavLink to="/login">Sign in</NavLink>
              <Link to="/signup" className="btn btn-primary">
                Start free
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { account, loading } = useSession();
  const location = useLocation();
  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!account) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} CustomJobSeek</span>
          <span className="footer-links">
            <Link to="/companies">Companies we scan</Link>
            <a href="/#faq">FAQ</a>
          </span>
          <span className="muted">Your data is encrypted and yours to delete at any time.</span>
        </div>
      </footer>
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/print/:id" element={<RequireAuth><PrintResume /></RequireAuth>} />
        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/signup" element={<AuthPage mode="signup" />} />
                <Route path="/verify" element={<VerifyPage />} />
                <Route path="/reset" element={<ResetPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
                <Route path="/jobs" element={<RequireAuth><JobsPage /></RequireAuth>} />
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/jobs/new" element={<RequireAuth><NewJobPage /></RequireAuth>} />
                <Route path="/jobs/:id" element={<RequireAuth><JobPage /></RequireAuth>} />
                <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>
    </SessionProvider>
  );
}
