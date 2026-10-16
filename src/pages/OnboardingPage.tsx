import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { COUNTRIES, currencies, preferencesForCountry, timeZoneLabel } from "../../shared/geo";
import {
  WIZARD_STEPS,
  needsGuidedOnboarding,
  resumeWizardStep,
  shiftWizardStep,
  shouldPersistSearchPaths,
  wizardContinueBlock,
  wizardCopy,
  wizardStepIndex,
  type WizardStep,
} from "../../shared/onboardingWizard";
import type { Bullet, Experience, Profile, SalaryPeriod } from "../../shared/types";
import { originalPdfLimitMessage } from "../../shared/resumeStorage";
import { profileReadiness } from "../../shared/validate";
import { api } from "../api";
import { CountrySelect, TimeZoneField } from "../components/CountrySelect";
import { OnboardingPaths, SaveCancelled } from "../components/SearchPaths";
import { Field, ListInput, NumberInput, newId } from "../components/fields";
import { IndustryPicker, RoleTargets } from "../components/RoleTargets";
import { industryLabels } from "../../shared/industries";
import { plural } from "../format";
import { useSession } from "../session";

type SaveState = "idle" | "saving" | "saved" | "error";
type RetryKind = "load" | "import" | "scan" | "save";

function periodLabel(period: SalaryPeriod): string {
  switch (period) {
    case "year":
      return "year";
    case "month":
      return "month";
    case "hour":
      return "hour";
    case "lpa":
      return "year, in lakhs";
    default: {
      const unexpected: never = period;
      return unexpected;
    }
  }
}

function countryLabel(code: string): string {
  if (!code) return "Anywhere";
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

function payText(profile: Profile): string {
  const { minSalary, maxSalary, currency, salaryPeriod } = profile.preferences;
  if (minSalary === null && maxSalary === null) return "No pay floor";
  const min = minSalary === null ? "any minimum" : String(minSalary);
  const max = maxSalary === null ? "no maximum" : String(maxSalary);
  return `${min} to ${max} ${currency} per ${periodLabel(salaryPeriod)}`;
}

function BulletInput({ bullets, onChange }: { bullets: Bullet[]; onChange: (next: Bullet[]) => void }) {
  const [raw, setRaw] = useState(bullets.map((bullet) => bullet.text).join("\n"));
  return (
    <textarea
      rows={4}
      value={raw}
      aria-label="Achievements, one per line"
      placeholder={"One achievement per line\nCut reporting from 5 days to 1 by automating the SQL"}
      onChange={(event) => {
        const value = event.target.value;
        setRaw(value);
        const lines = value.split("\n").map((line) => line.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
        onChange(lines.map((text, index) => ({ id: bullets[index]?.id ?? newId("b"), text })));
      }}
    />
  );
}

export function OnboardingPage() {
  const { account, setOnboardingStep, signOut } = useSession();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latest = useRef<Profile | null>(null);
  const lastSaved = useRef("");
  const timer = useRef<number | null>(null);
  const flight = useRef(false);
  const dirty = useRef(false);
  const fileRef = useRef<File | null>(null);
  const pendingImport = useRef<Profile | null>(null);
  const pendingMove = useRef<WizardStep | "done" | null>(null);
  const scanStarted = useRef(false);
  const generation = useRef(0);
  const pathSave = useRef<(() => Promise<void>) | null>(null);
  const rememberPaths = useCallback((save: (() => Promise<void>) | null) => {
    pathSave.current = save;
  }, []);
  const opened = useRef(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retryKind, setRetryKind] = useState<RetryKind | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState("");
  const [rolesKey, setRolesKey] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const flush = useCallback(async () => {
    if (flight.current) {
      dirty.current = true;
      return;
    }
    const snapshot = latest.current;
    if (!snapshot) return;
    const body = JSON.stringify(snapshot);
    if (body === lastSaved.current) return;
    flight.current = true;
    dirty.current = false;
    setSaveState("saving");
    try {
      await api.saveProfile(snapshot);
      lastSaved.current = body;
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      throw err;
    } finally {
      flight.current = false;
      if (dirty.current) await flush();
    }
  }, []);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoadError("");
    setRetryKind(null);
    try {
      const payload = await api.onboarding();
      if (ticket !== generation.current) return;
      const ready = profileReadiness(payload.profile).length === 0;
      if (!needsGuidedOnboarding(payload.onboarding.step, ready)) {
        setOnboardingStep(payload.onboarding.step);
        navigate("/today", { replace: true });
        return;
      }
      const resumed = resumeWizardStep(payload.profile, payload.onboarding.step, payload.onboarding.resume);
      const shown = payload.profile.email || !account?.email ? payload.profile : { ...payload.profile, email: account.email };
      latest.current = shown;
      lastSaved.current = JSON.stringify(payload.profile);
      setProfile(shown);
      setStep(resumed);
      if (payload.onboarding.step !== resumed) {
        const saved = await api.saveOnboardingStep(resumed);
        if (ticket !== generation.current) return;
        setOnboardingStep(saved.onboarding.step);
      } else {
        setOnboardingStep(payload.onboarding.step);
      }
    } catch (err) {
      if (ticket !== generation.current) return;
      setLoadError((err as Error).message);
      setRetryKind("load");
    }
  }, [account?.email, navigate, setOnboardingStep]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    const snapshot = latest.current;
    if (!snapshot || JSON.stringify(snapshot) === lastSaved.current) return;
    void api.saveProfile(snapshot).catch(() => undefined);
  }, []);

  function edit(next: Profile) {
    latest.current = next;
    setProfile(next);
    setActionError("");
    setRetryKind(null);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flush().catch((err: Error) => {
        setActionError(err.message);
        setRetryKind("save");
      });
    }, 650);
  }

  function setPref<K extends keyof Profile["preferences"]>(key: K, value: Profile["preferences"][K]) {
    if (!profile) return;
    edit({ ...profile, preferences: { ...profile.preferences, [key]: value } });
  }

  async function persistPaths(): Promise<boolean> {
    if (step !== "paths") return true;
    if (!pathSave.current) {
      setActionError("Search paths are still loading.");
      return false;
    }
    try {
      await pathSave.current();
      return true;
    } catch (err) {
      if (err instanceof SaveCancelled) return false;
      setActionError((err as Error).message);
      setRetryKind("save");
      return false;
    }
  }

  async function go(next: WizardStep) {
    pendingMove.current = next;
    setBusy("step");
    setActionError("");
    setRetryKind(null);
    if (timer.current) window.clearTimeout(timer.current);
    try {
      await flush();
      const saved = await api.saveOnboardingStep(next);
      pendingMove.current = null;
      setOnboardingStep(saved.onboarding.step);
      setStep(next);
    } catch (err) {
      setActionError((err as Error).message);
      setRetryKind("save");
    } finally {
      setBusy("");
    }
  }

  async function continueStep(event: FormEvent) {
    event.preventDefault();
    if (!profile || busy) return;
    let current = latest.current ?? profile;
    if ((step === "facts" || step === "resume") && !current.email && account?.email) {
      current = { ...current, email: account.email };
      latest.current = current;
      setProfile(current);
    }
    const block = wizardContinueBlock(step, current);
    if (block) {
      setActionError(block);
      setRetryKind(null);
      return;
    }
    const next = shiftWizardStep(step, "continue");
    if (next && await persistPaths()) await go(next);
  }

  async function importPdf(file: File) {
    if (!latest.current) return;
    fileRef.current = file;
    setBusy("import");
    setActionError("");
    setRetryKind(null);
    try {
      let next = pendingImport.current;
      if (!next) {
        const result = await api.importResume(file);
        const current = latest.current;
        if (!current) return;
        next = {
          ...result.profile,
          email: result.profile.email || current.email || account?.email || "",
          preferences: current.preferences,
        };
        pendingImport.current = next;
      }
      latest.current = next;
      setProfile(next);
      if (timer.current) window.clearTimeout(timer.current);
      await flush();
      const saved = await api.saveOnboardingStep("facts");
      pendingImport.current = null;
      setOnboardingStep(saved.onboarding.step);
      setStep("facts");
    } catch (err) {
      setActionError((err as Error).message);
      setRetryKind("import");
    } finally {
      setBusy("");
    }
  }

  async function startScan() {
    setBusy("scan");
    setActionError("");
    setRetryKind(null);
    try {
      if (timer.current) window.clearTimeout(timer.current);
      await flush();
      if (!scanStarted.current) {
        await api.scanDiscover();
        scanStarted.current = true;
      }
      const saved = await api.saveOnboardingStep("done");
      setOnboardingStep(saved.onboarding.step);
      navigate("/discover");
    } catch (err) {
      setActionError((err as Error).message);
      setRetryKind("scan");
    } finally {
      setBusy("");
    }
  }

  async function later() {
    pendingMove.current = "done";
    setBusy("done");
    setActionError("");
    try {
      const saved = await api.saveOnboardingStep("done");
      pendingMove.current = null;
      setOnboardingStep(saved.onboarding.step);
      navigate("/today");
    } catch (err) {
      setActionError((err as Error).message);
      setRetryKind("save");
    } finally {
      setBusy("");
    }
  }

  function retry() {
    switch (retryKind) {
      case "load":
        setAttempt((value) => value + 1);
        return;
      case "import":
        if (fileRef.current) void importPdf(fileRef.current);
        return;
      case "scan":
        void startScan();
        return;
      case "save":
        void (async () => {
          try {
            setActionError("");
            if (timer.current) window.clearTimeout(timer.current);
            await flush();
            const next = pendingMove.current;
            if (next) {
              const saved = await api.saveOnboardingStep(next);
              pendingMove.current = null;
              setOnboardingStep(saved.onboarding.step);
              if (next === "done") navigate("/today");
              else setStep(next);
            }
            setRetryKind(null);
          } catch (err) {
            setActionError((err as Error).message);
            setRetryKind("save");
          }
        })();
        return;
      case null:
        return;
      default: {
        const unexpected: never = retryKind;
        throw new Error(String(unexpected));
      }
    }
  }

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : "Saves as you go";

  return (
    <div className="onboard">
      <header className="onboard-bar">
        <Link to="/" className="wordmark">CustomJobSeek</Link>
        <p className="onboard-save" role="status" aria-live="polite">{profile ? saveLabel : ""}</p>
        <div className="onboard-bar-links">
          <Link to="/profile">Full profile</Link>
          <button
            type="button"
            className="linkish"
            onClick={() => {
              void signOut().then(() => navigate("/"));
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {!profile ? (
        <div className="onboard-card" aria-busy="true">
          <h1>Opening your setup…</h1>
          {loadError ? (
            <>
              <div className="alert alert-error" role="alert">{loadError}</div>
              <button type="button" className="btn btn-primary" onClick={retry}>Try again</button>
            </>
          ) : (
            <p className="muted">Loading the profile saved on this account.</p>
          )}
        </div>
      ) : (
        <Wizard
          profile={profile}
          step={step}
          busy={busy}
          actionError={actionError}
          retryKind={retryKind}
          rolesKey={rolesKey}
          scanLeft={account?.scanRuns ?? 0}
          headingRef={headingRef}
          onEdit={edit}
          onPref={setPref}
          onContinue={continueStep}
          onBack={() => {
            const previous = shiftWizardStep(step, "back");
            if (previous) void go(previous);
          }}
          onJump={(next) => {
            if (!shouldPersistSearchPaths(step, next)) {
              void go(next);
              return;
            }
            void persistPaths().then((ok) => {
              if (ok) void go(next);
            });
          }}
          onImport={(file) => void importPdf(file)}
          onAddRole={(title) => {
            if (profile.preferences.targetRoles.includes(title)) return;
            setPref("targetRoles", [...profile.preferences.targetRoles, title]);
            setRolesKey((value) => value + 1);
          }}
          onStartScan={() => void startScan()}
          onLater={() => void later()}
          onRetry={retry}
          onPathsReady={rememberPaths}
        />
      )}
    </div>
  );
}

function Wizard({
  profile,
  step,
  busy,
  actionError,
  retryKind,
  rolesKey,
  scanLeft,
  headingRef,
  onEdit,
  onPref,
  onContinue,
  onBack,
  onJump,
  onImport,
  onAddRole,
  onStartScan,
  onLater,
  onRetry,
  onPathsReady,
}: {
  profile: Profile;
  step: WizardStep;
  busy: string;
  actionError: string;
  retryKind: RetryKind | null;
  rolesKey: number;
  scanLeft: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onEdit: (next: Profile) => void;
  onPref: <K extends keyof Profile["preferences"]>(key: K, value: Profile["preferences"][K]) => void;
  onContinue: (event: FormEvent) => void;
  onBack: () => void;
  onJump: (step: WizardStep) => void;
  onImport: (file: File) => void;
  onAddRole: (title: string) => void;
  onStartScan: () => void;
  onLater: () => void;
  onRetry: () => void;
  onPathsReady: (save: (() => Promise<void>) | null) => void;
}) {
  const copy = wizardCopy(step);
  const index = wizardStepIndex(step);
  const suggestions = [...new Set(profile.experience.map((role) => role.title.trim()).filter(Boolean))]
    .filter((title) => !profile.preferences.targetRoles.some((role) => role.toLowerCase() === title.toLowerCase()))
    .slice(0, 4);
  const meterStyle = { "--step": index + 1, "--steps": WIZARD_STEPS.length } as CSSProperties;

  return (
    <form className="onboard-card" onSubmit={onContinue} aria-busy={busy !== "" || undefined}>
      <p className="kicker">Step {index + 1} of {WIZARD_STEPS.length}</p>
      <div className="onboard-meter" aria-hidden="true" style={meterStyle}><span /></div>
      <nav aria-label="Setup steps">
        <ol className="onboard-progress">
          {WIZARD_STEPS.map((item, itemIndex) => {
            const itemCopy = wizardCopy(item);
            const ahead = itemIndex > index;
            return (
              <li key={item}>
                <button
                  type="button"
                  className={item === step ? "on" : undefined}
                  aria-current={item === step ? "step" : undefined}
                  aria-label={itemCopy.short}
                  disabled={ahead || busy !== ""}
                  onClick={() => {
                    if (!ahead && item !== step) onJump(item);
                  }}
                >
                  <span className="onboard-num">{itemIndex + 1}</span>
                  <span className="onboard-label">{itemCopy.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div key={step} className="onboard-step">
        <h1 ref={headingRef} tabIndex={-1} id="onboard-title" aria-describedby="onboard-why">{copy.title}</h1>
        <p id="onboard-why" className="onboard-why">{copy.why}</p>
        <StepBody
          step={step}
          profile={profile}
          busy={busy}
          rolesKey={rolesKey}
          suggestions={suggestions}
          scanLeft={scanLeft}
          onEdit={onEdit}
          onPref={onPref}
          onImport={onImport}
          onAddRole={onAddRole}
          onJump={onJump}
          onStartScan={onStartScan}
          onLater={onLater}
          onPathsReady={onPathsReady}
        />
        {actionError && (
          <div className="alert alert-error" role="alert">
            <p>{actionError}</p>
            {retryKind && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>
            )}
          </div>
        )}
      </div>

      <div className="onboard-actions">
        {shiftWizardStep(step, "back") ? (
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy !== ""}>Back</button>
        ) : <span />}
        {step !== "scan" && (
          <button type="submit" className="btn btn-primary" disabled={busy !== ""}>
            {busy === "step" || busy === "import" ? "Saving…" : step === "resume" ? "I’ll type it myself" : "Continue"}
          </button>
        )}
      </div>
    </form>
  );
}

function StepBody({
  step,
  profile,
  busy,
  rolesKey,
  suggestions,
  scanLeft,
  onEdit,
  onPref,
  onImport,
  onAddRole,
  onJump,
  onStartScan,
  onLater,
  onPathsReady,
}: {
  step: WizardStep;
  profile: Profile;
  busy: string;
  rolesKey: number;
  suggestions: string[];
  scanLeft: number;
  onEdit: (next: Profile) => void;
  onPref: <K extends keyof Profile["preferences"]>(key: K, value: Profile["preferences"][K]) => void;
  onImport: (file: File) => void;
  onAddRole: (title: string) => void;
  onJump: (step: WizardStep) => void;
  onStartScan: () => void;
  onLater: () => void;
  onPathsReady: (save: (() => Promise<void>) | null) => void;
}) {
  switch (step) {
    case "welcome":
      return (
        <ul className="onboard-points">
          <li>Bring a resume, or type the jobs you have done.</li>
          <li>Check the facts. We never invent a skill or a result.</li>
          <li>Name the titles, places, and pay you want.</li>
          <li>Start the free scan when the picture looks right.</li>
        </ul>
      );
    case "resume":
      return (
        <div className="onboard-choice">
          <label className="btn btn-primary">
            {busy === "import" ? "Reading your PDF…" : "Upload a PDF"}
            <input
              className="onboard-clip"
              type="file"
              accept="application/pdf"
              disabled={busy !== ""}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onImport(file);
              }}
            />
          </label>
          <p className="muted small">{originalPdfLimitMessage()} After it is read, you still have to press Continue on the next step. Nothing is treated as final until you confirm it.</p>
        </div>
      );
    case "facts":
      return <Facts profile={profile} onEdit={onEdit} />;
    case "roles":
      return (
        <>
          <Field label="Your industry" hint="Optional but important. Scans prefer boards in these industries so a healthcare role is not scored against unrelated technology employers first.">
            <IndustryPicker
              selected={profile.preferences.industries}
              onChange={(value) => onPref("industries", value)}
            />
          </Field>
          <Field label="Job titles you want" hint="Comma-separated. A scan looks for these titles, including any title you type yourself.">
            <ListInput
              key={rolesKey}
              value={profile.preferences.targetRoles}
              onChange={(value) => onPref("targetRoles", value)}
              placeholder="Dietitian, Registered Nurse, Electrician, Teacher"
            />
          </Field>
          <RoleTargets roles={profile.preferences.targetRoles} onAdd={onAddRole} />
          {suggestions.length > 0 && (
            <div className="onboard-suggest">
              <p className="muted small">From your history. Add one if it is a job you still want.</p>
              <div className="chips">
                {suggestions.map((title) => (
                  <button type="button" key={title} className="chip" onClick={() => onAddRole(title)}>{title}</button>
                ))}
              </div>
            </div>
          )}
        </>
      );
    case "market":
      return <Market profile={profile} onEdit={onEdit} onPref={onPref} />;
    case "paths":
      return <OnboardingPaths profile={profile} onReady={onPathsReady} />;
    case "confirm":
      return <Confirm profile={profile} onJump={onJump} />;
    case "scan":
      return (
        <div className="onboard-choice">
          <p>{plural(scanLeft, "scan")} left on this account. The free plan includes one.</p>
          {scanLeft < 1 && <p id="scan-used">The free scan is already used. You can still open Today and paste one job, or add scans from Plans.</p>}
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStartScan}
            disabled={busy !== "" || scanLeft < 1}
            aria-describedby={scanLeft < 1 ? "scan-used" : undefined}
          >
            {busy === "scan" ? "Starting your scan…" : "Start my free scan"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLater} disabled={busy !== ""}>
            {busy === "done" ? "Saving…" : "I’ll do this later"}
          </button>
          <p className="muted small">Starting the scan takes you to Discover, where you can watch it work. Leaving now takes you to Today. Your profile stays saved either way.</p>
        </div>
      );
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}

function Facts({ profile, onEdit }: { profile: Profile; onEdit: (next: Profile) => void }) {
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => onEdit({ ...profile, [key]: value });
  const updateRole = (index: number, role: Experience) => {
    onEdit({ ...profile, experience: profile.experience.map((item, itemIndex) => (itemIndex === index ? role : item)) });
  };
  return (
    <>
      <div className="onboard-grid">
        <Field label="Full name">
          <input autoComplete="name" value={profile.fullName} onChange={(event) => set("fullName", event.target.value)} />
        </Field>
        <Field label="Email on your resume">
          <input type="email" autoComplete="email" inputMode="email" value={profile.email} onChange={(event) => set("email", event.target.value)} />
        </Field>
        <Field label="Phone" hint="Optional. Only printed if you fill it in.">
          <input autoComplete="tel" inputMode="tel" value={profile.phone} onChange={(event) => set("phone", event.target.value)} />
        </Field>
        <Field label="Headline" hint="Optional. One line under your name.">
          <input value={profile.headline} onChange={(event) => set("headline", event.target.value)} />
        </Field>
      </div>
      <Field label="Short summary" hint="Optional. Three or four sentences are enough.">
        <textarea rows={4} value={profile.summary} onChange={(event) => set("summary", event.target.value)} />
      </Field>
      <Field label="Skills you can defend" hint="Comma or line separated. Only list what you could explain in an interview.">
        <ListInput
          multiline
          value={profile.skills.map((skill) => skill.name)}
          onChange={(names) => set("skills", names.map((name) => profile.skills.find((skill) => skill.name === name) ?? { name, level: "working" as const }))}
          placeholder="SQL, Python, dbt"
        />
      </Field>
      <div className="row-between">
        <h2>Roles you have done</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onEdit({
            ...profile,
            experience: [...profile.experience, { id: newId("exp"), company: "", title: "", location: "", start: "", end: "", bullets: [] }],
          })}
        >
          Add a role
        </button>
      </div>
      {profile.experience.length === 0 && <p className="muted">No roles yet. Add the most recent one, with at least one achievement.</p>}
      {profile.experience.map((role, index) => (
        <section className="card sub-card" key={role.id} aria-label={`Role ${index + 1}`}>
          <div className="onboard-grid">
            <Field label="Job title"><input value={role.title} onChange={(event) => updateRole(index, { ...role, title: event.target.value })} /></Field>
            <Field label="Company"><input value={role.company} onChange={(event) => updateRole(index, { ...role, company: event.target.value })} /></Field>
            <Field label="Start"><input value={role.start} placeholder="Jan 2021" onChange={(event) => updateRole(index, { ...role, start: event.target.value })} /></Field>
            <Field label="End"><input value={role.end} placeholder="Present" onChange={(event) => updateRole(index, { ...role, end: event.target.value })} /></Field>
          </div>
          <Field label="Achievements" hint="Your words. The resume will not rewrite them.">
            <BulletInput bullets={role.bullets} onChange={(bullets) => updateRole(index, { ...role, bullets })} />
          </Field>
          <div className="row-end">
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move role ${index + 1} up`} onClick={() => moveRole(profile, index, -1, onEdit)}>Up</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move role ${index + 1} down`} onClick={() => moveRole(profile, index, 1, onEdit)}>Down</button>
            <button type="button" className="btn btn-danger-ghost btn-sm" aria-label={`Remove role ${index + 1}`} onClick={() => onEdit({ ...profile, experience: profile.experience.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
          </div>
        </section>
      ))}
      <p className="muted small">School, certificates, and skills you refuse to claim live in the <Link to="/profile">full profile editor</Link>.</p>
    </>
  );
}

function moveRole(profile: Profile, index: number, direction: -1 | 1, onEdit: (next: Profile) => void) {
  const target = index + direction;
  if (target < 0 || target >= profile.experience.length) return;
  const next = [...profile.experience];
  const current = next[index];
  const swap = next[target];
  if (!current || !swap) return;
  next[index] = swap;
  next[target] = current;
  onEdit({ ...profile, experience: next });
}

function Market({
  profile,
  onEdit,
  onPref,
}: {
  profile: Profile;
  onEdit: (next: Profile) => void;
  onPref: <K extends keyof Profile["preferences"]>(key: K, value: Profile["preferences"][K]) => void;
}) {
  const country = COUNTRIES.find((item) => item.code === profile.preferences.country);
  return (
    <div className="onboard-grid">
      <Field label="Country" hint="Anywhere means a job in any country can match. India, the US, the UK, Canada, Australia, Singapore, New Zealand, Ireland, and South Africa are listed first.">
        <CountrySelect
          value={profile.preferences.country}
          emptyLabel="Anywhere"
          onChange={(code) => onEdit({ ...profile, preferences: preferencesForCountry(profile.preferences, code) })}
        />
      </Field>
      <Field label="Cities" hint="Leave blank to accept the whole country. Comma-separated.">
        <ListInput
          key={profile.preferences.country}
          value={profile.preferences.cities}
          onChange={(value) => onPref("cities", value)}
          placeholder={country?.cities.slice(0, 2).join(", ") || "City names"}
        />
      </Field>
      <Field label="Work mode">
        <select value={profile.preferences.remoteOk ? "yes" : "no"} onChange={(event) => onPref("remoteOk", event.target.value === "yes")}>
          <option value="yes">Remote roles are fine</option>
          <option value="no">No remote roles</option>
        </select>
      </Field>
      <Field label="Currency">
        <select value={profile.preferences.currency} onChange={(event) => onPref("currency", event.target.value)}>
          {currencies().map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </Field>
      <Field label="Pay unit">
        <select value={profile.preferences.salaryPeriod} onChange={(event) => onPref("salaryPeriod", event.target.value as SalaryPeriod)}>
          <option value="year">Per year</option>
          <option value="month">Per month</option>
          <option value="hour">Per hour</option>
          <option value="lpa">Lakhs per year (India)</option>
        </select>
      </Field>
      <Field label="Minimum pay" hint="Blank means no floor.">
        <NumberInput value={profile.preferences.minSalary} onChange={(value) => onPref("minSalary", value)} placeholder="80000" />
      </Field>
      <Field label="Maximum pay" hint="Blank means no ceiling.">
        <NumberInput value={profile.preferences.maxSalary} onChange={(value) => onPref("maxSalary", value)} placeholder="120000" />
      </Field>
      <TimeZoneField
        country={profile.preferences.country}
        value={profile.preferences.timezone}
        onChange={(zone) => onPref("timezone", zone)}
      />
      <Field label="Title words to skip" hint="Optional. A job title containing one of these is a deal-breaker.">
        <ListInput value={profile.preferences.excludedTitleWords} onChange={(value) => onPref("excludedTitleWords", value)} placeholder="Intern, Unpaid" />
      </Field>
    </div>
  );
}

function Confirm({ profile, onJump }: { profile: Profile; onJump: (step: WizardStep) => void }) {
  const missing = profileReadiness(profile);
  return (
    <>
      {missing.length > 0 && <div className="alert alert-info">Still needed: {missing.join(", ")}.</div>}
      <dl className="onboard-facts">
        <div><dt>Name</dt><dd>{profile.fullName || "Not set"}</dd></div>
        <div><dt>Email</dt><dd>{profile.email || "Not set"}</dd></div>
        <div><dt>Skills</dt><dd>{profile.skills.map((skill) => skill.name).join(", ") || "Not set"}</dd></div>
        <div>
          <dt>History</dt>
          <dd>
            {profile.experience.length
              ? profile.experience.map((role) => `${role.title || "Untitled"} at ${role.company || "unknown company"}`).join("; ")
              : "Not set"}
          </dd>
        </div>
        <div><dt>Industry</dt><dd>{industryLabels(profile.preferences.industries).join(", ") || "Not set"}</dd></div>
        <div><dt>Titles to find</dt><dd>{profile.preferences.targetRoles.join(", ") || "Not set"}</dd></div>
        <div><dt>Place</dt><dd>{countryLabel(profile.preferences.country)}{profile.preferences.cities.length ? ` · ${profile.preferences.cities.join(", ")}` : ""} · scans at {timeZoneLabel(profile.preferences.timezone)}</dd></div>
        <div><dt>Work mode</dt><dd>{profile.preferences.remoteOk ? "Remote roles are fine" : "No remote roles"}</dd></div>
        <div><dt>Pay</dt><dd>{payText(profile)}</dd></div>
      </dl>
      <div className="onboard-jumps">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump("facts")}>Edit facts</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump("roles")}>Edit titles</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump("market")}>Edit place and pay</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump("paths")}>Edit search paths</button>
        <Link to="/profile" className="btn btn-ghost btn-sm">Open full editor</Link>
      </div>
    </>
  );
}
