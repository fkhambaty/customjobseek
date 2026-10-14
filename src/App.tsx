import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { needsGuidedOnboarding } from "../shared/onboardingWizard";
import { profileReadiness } from "../shared/validate";
import type { CapacityPause } from "../shared/dbCapacity";
import { AppShell } from "./components/AppShell";
import { CapacityNotice } from "./components/CapacityNotice";
import { SiteLinks } from "./components/SiteLinks";
import { JobsProvider, useJobs } from "./data";
import { AccountPage } from "./pages/AccountPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuthPage } from "./pages/AuthPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { JobPage } from "./pages/JobPage";
import { Landing } from "./pages/Landing";
import { LegalPage } from "./pages/LegalPage";
import { NewJobPage } from "./pages/NewJobPage";
import { OutreachPage } from "./pages/OutreachPage";
import { PipelinePage } from "./pages/PipelinePage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { PricingPage } from "./pages/PricingPage";
import { CheckoutReturnPage } from "./pages/CheckoutReturnPage";
import { PrintResume } from "./pages/PrintResume";
import { ProfilePage } from "./pages/ProfilePage";
import { ResumeViewerPage } from "./pages/ResumeViewerPage";
import { ResumesPage } from "./pages/ResumesPage";
import { SearchPathsPage } from "./pages/SearchPathsPage";
import { SupportPage } from "./pages/SupportPage";
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
          <nav className="nav" aria-label="Site">
            <NavLink className="nav-extra" to="/companies">Companies we scan</NavLink>
            <a className="nav-extra" href="/#faq">Questions</a>
            <NavLink to="/pricing">Pricing</NavLink>
            {account ? (
              <Link to="/today" className="btn btn-primary btn-sm">Open your search</Link>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/signup" className="btn btn-primary btn-sm">Start free</Link>
              </>
            )}
            <details className="nav-fold">
              <summary>Menu</summary>
              <NavLink to="/companies">Companies we scan</NavLink>
              <a href="/#faq">Questions</a>
            </details>
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
            <span className="footer-policies"><SiteLinks /></span>
          </span>
          <details className="legal-fold">
            <summary>Privacy, terms, and support</summary>
            <span className="footer-links"><SiteLinks /></span>
          </details>
          <span className="muted">Your data is encrypted and yours to delete.</span>
        </div>
      </footer>
    </>
  );
}

const OPEN_PATHS = new Set(["/pricing", "/companies"]);

function PausedPage({ pause }: { pause: CapacityPause }) {
  return (
    <PublicShell>
      <div className="capacity-page"><CapacityNotice pause={pause} /></div>
    </PublicShell>
  );
}

function SignedIn({ children }: { children: ReactNode }) {
  const { account, loading, pause } = useSession();
  const location = useLocation();
  if (loading) return <div className="boot">Opening your search…</div>;
  if (!account && pause) return <PausedPage pause={pause} />;
  if (!account) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

/** Completed setup stays on Today. Anyone still in the wizard, or a legacy profile that is not scan-ready, resumes setup. */
function TodayGate() {
  const { onboardingStep } = useSession();
  const { profile, error } = useJobs();
  if (!profile && !error) return <div className="boot">Opening your search…</div>;
  if (profile && needsGuidedOnboarding(onboardingStep, profileReadiness(profile).length === 0)) {
    return <Navigate to="/onboarding" replace />;
  }
  return <TodayPage />;
}

/**
 * One layout for every signed-in page so the job list loads once and the sidebar never remounts.
 * Pricing and the companies list are readable signed out, in the public frame.
 */
function AppLayout() {
  const { account, loading, pause } = useSession();
  const location = useLocation();
  if (loading) return <div className="boot">Opening your search…</div>;
  if (!account) {
    if (OPEN_PATHS.has(location.pathname)) return <PublicShell><Outlet /></PublicShell>;
    if (pause) return <PausedPage pause={pause} />;
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return (
    <JobsProvider>
      <AppShell>
        {pause && <CapacityNotice pause={pause} compact />}
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
        <Route path="/privacy" element={<PublicShell><LegalPage doc="privacy" /></PublicShell>} />
        <Route path="/terms" element={<PublicShell><LegalPage doc="terms" /></PublicShell>} />
        <Route path="/cookies" element={<PublicShell><LegalPage doc="cookies" /></PublicShell>} />
        <Route path="/refunds" element={<PublicShell><LegalPage doc="refunds" /></PublicShell>} />
        <Route path="/support" element={<PublicShell><SupportPage /></PublicShell>} />
        <Route path="/onboarding" element={<SignedIn><OnboardingPage /></SignedIn>} />
        <Route element={<AppLayout />}>
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/checkout/return" element={<CheckoutReturnPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/today" element={<TodayGate />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/outreach" element={<OutreachPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          <Route path="/resumes/view/:kind/:id" element={<ResumeViewerPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/search-paths" element={<SearchPathsPage />} />
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
