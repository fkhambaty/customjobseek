import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BAD_MATCH_REASONS, INTERVIEW_STAGES, interviewStageLabel, parseBadMatchReason, parseInterviewStage, rowEvidence, type BadMatchReason } from "../../shared/agency";
import { formatSalary } from "../../shared/engine/fit";
import type { MessageSet } from "../../shared/engine/outreach";
import { CHANNELS, type Channel, type Contact, type JobFull, type JobStatus } from "../../shared/types";
import { api, ApiError, type Pack } from "../api";
import { useJobs } from "../data";
import { ago, formatPay, shortDate, today } from "../format";
import { useSession } from "../session";
import { FitCard, statusLabel } from "./FitCard";
import { Markdown } from "./Markdown";
import { Resume } from "./Resume";
import { UpgradePrompt } from "./UpgradePrompt";

export const JOB_TABS = ["overview", "resume", "application", "jd", "people", "history"] as const;
export type JobTab = (typeof JOB_TABS)[number];

function tabLabel(t: JobTab): string {
  switch (t) {
    case "overview":
      return "Overview";
    case "resume":
      return "Resume";
    case "application":
      return "Application";
    case "jd":
      return "Job description";
    case "people":
      return "People & messages";
    case "history":
      return "History";
    default: {
      const never: never = t;
      return never;
    }
  }
}

function channelLabel(c: Channel | ""): string {
  switch (c) {
    case "linkedin":
      return "LinkedIn";
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "referral":
      return "Referral";
    case "other":
      return "Other";
    case "":
      return "";
    default: {
      const never: never = c;
      return never;
    }
  }
}

const STATUS_FLOW: JobStatus[] = ["evaluated", "resume_ready", "applied", "interview", "offer", "rejected", "closed", "withdrawn"];

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="jv-section">
      <header>
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-quiet btn-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function Overview({ job, onChange }: { job: JobFull; onChange: (j: JobFull) => void }) {
  const { currency } = useJobs();
  const [on, setOn] = useState(today());
  const [notes, setNotes] = useState(job.notes);
  const [next, setNext] = useState(job.nextActionAt ?? "");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const d = job.details;

  useEffect(() => {
    setNotes(job.notes);
    setNext(job.nextActionAt ?? "");
  }, [job.id, job.notes, job.nextActionAt]);

  async function setStatus(status: JobStatus) {
    if (status === job.status) return;
    setBusy(true);
    try {
      onChange(await api.updateJob(job.id, { status, on }));
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    onChange(await api.updateJob(job.id, { notes, nextActionAt: next || null }));
    setSaved("Saved");
    setTimeout(() => setSaved(""), 1500);
  }

  const pay = formatPay(job, currency);
  const evidence = rowEvidence(job, today());
  return (
    <>
      <p className="muted small">
        {evidence.stage}
        {" · "}{evidence.freshness.label}
        {evidence.payProvenance !== "unknown" ? ` · ${evidence.payLabel}` : ""}
        {evidence.coverage !== null ? ` · ${evidence.coverage}% of required skills in your profile` : ""}
        {evidence.outreach.note ? ` · ${evidence.outreach.note}` : ""}
      </p>
      <Section title="Where it stands">
        <div className="status-flow" role="radiogroup" aria-label="Status">
          {STATUS_FLOW.map((s) => (
            <button key={s} role="radio" aria-checked={job.status === s} className={job.status === s ? "on" : ""} disabled={busy} onClick={() => setStatus(s)}>
              {statusLabel(s)}
            </button>
          ))}
        </div>
        <div className="jv-inline">
          <label>
            Status changes are dated <input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value || today())} />
          </label>
          {job.appliedAt && <span className="muted">Applied {shortDate(job.appliedAt)} ({ago(job.appliedAt)})</span>}
          {job.rejectedAt && <span className="muted">Rejected {shortDate(job.rejectedAt)}</span>}
          {job.closedAt && <span className="muted">Closed {shortDate(job.closedAt)}</span>}
        </div>
        {(job.status === "interview" || job.status === "offer") && (
          <label className="field">
            <span>Interview round</span>
            <select
              value={job.interviewStage || ""}
              onChange={async (e) => {
                const stage = parseInterviewStage(e.target.value);
                onChange(await api.updateJob(job.id, { interviewStage: stage }));
              }}
            >
              <option value="">Not set</option>
              {INTERVIEW_STAGES.map((stage) => <option key={stage} value={stage}>{interviewStageLabel(stage)}</option>)}
            </select>
          </label>
        )}
      </Section>

      <Section title="Follow-up and notes" aside={saved && <span className="saved">{saved}</span>}>
        <div className="jv-notes">
          <label className="field">
            <span>Follow up on</span>
            <input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Notes</span>
            <textarea rows={3} value={notes} placeholder="Referral, recruiter call, what they asked…" onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={saveNotes} disabled={notes === job.notes && (next || null) === job.nextActionAt}>
          Save
        </button>
      </Section>

      <FitCard fit={job.fit} />

      {(pay || d.payNote || job.salaryText) && (
        <Section title="Pay">
          <p className="jv-big">
            {pay || job.salaryText}
            {job.payEstimated && <span className="tag tag-quiet">estimate</span>}
          </p>
          {d.payNote && <p className="muted">{d.payNote}</p>}
          {job.fit.parsedSalary && <p className="muted">Posting says {formatSalary(job.fit.parsedSalary)}.</p>}
        </Section>
      )}
      {d.warnings.length > 0 && (
        <Section title="Watch out">
          <ul className="jv-warn">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Section>
      )}
      {(d.fitNarrative || d.evidence.length > 0) && (
        <Section title="Why it fits">
          {d.fitNarrative && <p>{d.fitNarrative}</p>}
          {d.evidence.length > 0 && <ul>{d.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
        </Section>
      )}
      {d.compensation && (
        <Section title="Compensation research">
          <p>{d.compensation}</p>
        </Section>
      )}
      {(d.verification || d.liveCheck) && (
        <Section title="Is it real and open?">
          {d.liveCheck && (
            <p>
              <span className={`tag tag-${d.liveCheck.verdict === "live" ? "ok" : "quiet"}`}>{d.liveCheck.verdict || "unchecked"}</span>{" "}
              {d.liveCheck.evidence} {d.liveCheck.on && <span className="muted">· checked {shortDate(d.liveCheck.on)}</span>}
            </p>
          )}
          {d.verification && <p className="muted">{d.verification}</p>}
        </Section>
      )}
      <ReportMatch jobId={job.id} />
    </>
  );
}

function ReportMatch({ jobId }: { jobId: string }) {
  const [reason, setReason] = useState<BadMatchReason>("wrong_role");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await api.reportMatch(jobId, { reason, note });
      setSent(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="quiet-fold">
      <summary>This match looks wrong</summary>
      {sent ? (
        <p>Sent to support. Reference {sent}. We do not share your profile with anyone else.</p>
      ) : (
        <div className="stack">
          <label className="field">
            <span>Why</span>
            <select value={reason} onChange={(e) => {
              const next = parseBadMatchReason(e.target.value);
              if (next) setReason(next);
            }}>
              {(Object.keys(BAD_MATCH_REASONS) as BadMatchReason[]).map((item) => (
                <option key={item} value={item}>{BAD_MATCH_REASONS[item]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Anything else, if you want</span>
            <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="text-error">{error}</p>}
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void submit()}>{busy ? "Sending…" : "Send to support"}</button>
        </div>
      )}
    </details>
  );
}

function ResumeTab({ job, pack, onBuilt }: { job: JobFull; pack: Pack | null; onBuilt: (p: Pack) => void }) {
  const { account, refresh } = useSession();
  const { put } = useJobs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function build() {
    setBusy(true);
    setError("");
    try {
      const made = await api.makeResume(job.id);
      onBuilt({ ...(pack ?? { savedResume: false, applicationNotes: null, jobNotes: null, statusNotes: null }), ...made });
      put({ ...job, hasResume: true, hasPack: true });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 402) await refresh();
    } finally {
      setBusy(false);
    }
  }

  const resume = pack?.resume ?? null;
  const ok = resume && !resume.provenance.untraceableLines.length && !resume.provenance.neverClaimHits.length;
  const canBuild = Boolean(resume) || (account?.resumeCredits ?? 0) > 0;
  return (
    <>
      <div className="jv-toolbar">
        {resume && <a className="btn btn-primary btn-sm" href={`/print/${job.id}`} target="_blank" rel="noreferrer">Download PDF</a>}
        {pack?.savedResume && (
          <a className="btn btn-ghost btn-sm" href={`/api/jobs/${encodeURIComponent(job.id)}/resume.html`} target="_blank" rel="noreferrer">
            Open saved resume
          </a>
        )}
        <button className="btn btn-ghost btn-sm" onClick={build} disabled={busy || !canBuild}>
          {busy ? "Building…" : resume ? "Rebuild from profile (free)" : "Build from profile · 1 credit"}
        </button>
        {!canBuild && job.fit.score <= 0 && <Link to="/pricing" className="small">Out of resume credits</Link>}
      </div>
      {!canBuild && <UpgradePrompt evidence={job.fit.score > 0} blocked="resumes" />}
      {error && <div className="alert alert-error">{error}</div>}
      {resume && (
        <>
          <p className={ok ? "truth ok" : "truth warn"}>
            {ok
              ? "Every line traces to your profile, and nothing on your never-claim list appears."
              : `Truth check: ${resume.provenance.neverClaimHits.length ? `never-claim terms found (${resume.provenance.neverClaimHits.join(", ")}). ` : ""}Fix the profile, then rebuild.`}
          </p>
          <div className="resume-preview"><Resume resume={resume} /></div>
        </>
      )}
      {!resume && pack?.savedResume && (
        <div className="saved-resume">
          <p className="muted small">The resume you prepared for this job, kept exactly as it was.</p>
          <iframe title="Saved resume" sandbox="" src={`/api/jobs/${encodeURIComponent(job.id)}/resume.html`} />
        </div>
      )}
      {!resume && !pack?.savedResume && (
        <div className="empty-note">
          <p>No resume for this job yet.</p>
          <p className="muted">Building one picks and orders your own profile lines for this job. Nothing is invented.</p>
        </div>
      )}
    </>
  );
}

function ApplicationTab({ pack }: { pack: Pack | null }) {
  const app = pack?.application;
  if (!app && !pack?.applicationNotes) {
    return <div className="empty-note"><p>No application file yet.</p><p className="muted">It is made alongside the resume.</p></div>;
  }
  return (
    <>
      {app && (
        <Section title="Application file" aside={<Copy text={app.paragraphs.join("\n\n")} label="Copy text" />}>
          {app.paragraphs.map((p) => <p key={p}>{p}</p>)}
          {app.evidence.length > 0 && <ul>{app.evidence.map((e) => <li key={e.text}><strong>{e.label}.</strong> {e.text}</li>)}</ul>}
          {app.gaps.length > 0 && (
            <>
              <h4>Be ready to discuss</h4>
              <ul>{app.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          )}
        </Section>
      )}
      {pack?.applicationNotes && (
        <Section title="Your application pack">
          <Markdown source={pack.applicationNotes} />
        </Section>
      )}
    </>
  );
}

function JdTab({ job, pack }: { job: JobFull; pack: Pack | null }) {
  const f = pack?.jobFile;
  return (
    <>
      {job.url && (
        <p>
          <a href={job.url} target="_blank" rel="noreferrer">Open the posting ↗</a>
          {job.requisition && <span className="muted"> · ref {job.requisition}</span>}
        </p>
      )}
      {f && (
        <Section title="Summary">
          <p className="muted">
            {[f.location, f.salary ? formatSalary(f.salary) : f.salaryText, f.yearsRequired ? `${f.yearsRequired}+ years` : ""].filter(Boolean).join(" · ")}
          </p>
          {f.requiredSkills.length > 0 && <p><strong>Required:</strong> {f.requiredSkills.join(", ")}</p>}
          {f.preferredSkills.length > 0 && <p><strong>Preferred:</strong> {f.preferredSkills.join(", ")}</p>}
          {f.requirementLines.length > 0 && <ul>{f.requirementLines.map((l) => <li key={l}>{l}</li>)}</ul>}
        </Section>
      )}
      {pack?.jobNotes ? <Markdown source={pack.jobNotes} /> : <div className="jd-text">{job.description}</div>}
    </>
  );
}

function blankContact(): Contact {
  return { id: crypto.randomUUID(), name: "", role: "", url: "", email: "" };
}

function PeopleTab({ job, onChange }: { job: JobFull; onChange: (j: JobFull) => void }) {
  const [editing, setEditing] = useState<Contact[] | null>(null);
  const [messages, setMessages] = useState<MessageSet[] | null>(null);
  const [channel, setChannel] = useState<Channel>("linkedin");
  const [error, setError] = useState("");

  useEffect(() => {
    api.messages(job.id).then(setMessages, () => setMessages([]));
  }, [job.id, job.details.contacts.length]);

  const sentTo = new Set(job.events.filter((e) => e.kind === "message").map((e) => e.person.toLowerCase()));
  const replied = new Set(job.events.filter((e) => e.kind === "reply").map((e) => e.person.toLowerCase()));

  async function saveContacts() {
    if (!editing) return;
    setError("");
    try {
      onChange(await api.saveContacts(job.id, editing.filter((c) => c.name.trim() || c.email.trim())));
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function log(kind: "message" | "reply", person: string) {
    onChange(await api.logEvent(job.id, { kind, person, channel }));
  }

  return (
    <>
      <Section
        title="People"
        aside={!editing && <button className="btn btn-quiet btn-xs" onClick={() => setEditing(job.details.contacts.length ? job.details.contacts : [blankContact()])}>Edit people</button>}
      >
        {editing ? (
          <div className="contact-edit">
            {editing.map((c, i) => (
              <div className="contact-row" key={c.id}>
                {(["name", "role", "url", "email"] as const).map((k) => (
                  <input
                    key={k}
                    placeholder={{ name: "Name", role: "Role", url: "Profile link", email: "Email" }[k]}
                    value={c[k]}
                    onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                  />
                ))}
                <button className="btn btn-quiet btn-xs" onClick={() => setEditing(editing.filter((_, j) => j !== i))} aria-label="Remove">Remove</button>
              </div>
            ))}
            {error && <div className="alert alert-error">{error}</div>}
            <div className="jv-toolbar">
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing([...editing, blankContact()])}>Add a person</button>
              <button className="btn btn-primary btn-sm" onClick={saveContacts}>Save people</button>
              <button className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : job.details.contacts.length ? (
          <ul className="people">
            {job.details.contacts.map((c) => {
              const key = (c.name || c.email).toLowerCase();
              return (
                <li key={c.id}>
                  <div>
                    <strong>{c.name || c.email}</strong>
                    {c.role && <span className="muted"> · {c.role}</span>}
                    {sentTo.has(key) && <span className="tag tag-quiet">messaged</span>}
                    {replied.has(key) && <span className="tag tag-ok">replied</span>}
                  </div>
                  <div className="people-links">
                    {c.url && <a href={c.url} target="_blank" rel="noreferrer">Profile ↗</a>}
                    {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">
            No one saved for this job yet. A hiring manager or recruiter you can name is worth more than another application.
          </p>
        )}
      </Section>

      <Section
        title="Messages"
        aside={
          <label className="jv-channel">
            Sent via{" "}
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
            </select>
          </label>
        }
      >
        <p className="muted small">Written from your own profile lines. Send after you apply, then log it here so follow-ups and reply rates stay honest.</p>
        {messages === null && <p className="muted">Writing…</p>}
        {messages?.map((m) => (
          <div className="msg" key={m.contactId}>
            <div className="msg-head">
              <strong>{m.to || "Hiring team"}</strong>
              <span className="jv-toolbar">
                <button className="btn btn-ghost btn-xs" onClick={() => log("message", m.to)}>Log as sent</button>
                <button className="btn btn-quiet btn-xs" onClick={() => log("reply", m.to)}>They replied</button>
              </span>
            </div>
            <MsgBlock label={`Connection note · ${m.connectionNote.length}/200`} text={m.connectionNote} />
            <MsgBlock label="First message" text={m.firstMessage} />
            <MsgBlock label="Nudge, once, after 7 quiet days" text={m.nudge} />
            <MsgBlock label={`Email · ${m.emailSubject}`} text={m.emailBody} />
          </div>
        ))}
      </Section>
    </>
  );
}

function MsgBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="msg-block">
      <div className="msg-label">
        <span>{label}</span>
        <Copy text={text} />
      </div>
      <p>{text}</p>
    </div>
  );
}

function HistoryTab({ job, pack, onChange }: { job: JobFull; pack: Pack | null; onChange: (j: JobFull) => void }) {
  const [note, setNote] = useState("");
  async function add() {
    if (!note.trim()) return;
    onChange(await api.logEvent(job.id, { kind: "note", note }));
    setNote("");
  }
  return (
    <>
      <div className="jv-addnote">
        <input value={note} placeholder="Add to the history: a call, an email, anything worth remembering" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn btn-ghost btn-sm" onClick={add} disabled={!note.trim()}>Add</button>
      </div>
      <ol className="timeline">
        {job.events.map((e) => (
          <li key={e.id} className={`t-${e.kind}`}>
            <time>{shortDate(e.at)}</time>
            <div>
              {e.kind === "status" && <>Marked <strong>{e.status ? statusLabel(e.status) : ""}</strong></>}
              {e.kind === "message" && <>Messaged <strong>{e.person || "someone"}</strong>{e.channel && ` on ${channelLabel(e.channel)}`}</>}
              {e.kind === "reply" && <>Reply from <strong>{e.person || "the employer"}</strong></>}
              {e.kind === "note" && null}
              {e.note && <p className={e.kind === "note" ? "" : "muted"}>{e.note}</p>}
            </div>
            {e.kind !== "status" && (
              <button className="btn btn-quiet btn-xs" onClick={async () => onChange(await api.deleteEvent(job.id, e.id))} aria-label="Remove">×</button>
            )}
          </li>
        ))}
        <li className="t-status">
          <time>{shortDate(job.createdAt)}</time>
          <div>Added to your list</div>
        </li>
      </ol>
      {pack?.statusNotes && (
        <details className="jv-details">
          <summary>Your full status file</summary>
          <Markdown source={pack.statusNotes} />
        </details>
      )}
    </>
  );
}

export function JobView({ id, tab, onTab, onClose }: { id: string; tab: JobTab; onTab: (t: JobTab) => void; onClose?: () => void }) {
  const { put, drop, currency } = useJobs();
  const [job, setJob] = useState<JobFull | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setJob(null);
    setPack(null);
    setError("");
    api.getJob(id).then(setJob, (e: Error) => setError(e.message));
    api.getPack(id).then(setPack, () => setPack(null));
  }, [id]);

  const change = useCallback(
    (j: JobFull) => {
      setJob(j);
      put(j);
    },
    [put],
  );

  if (error) return <div className="jv"><div className="alert alert-error">{error}</div></div>;
  if (!job) return <div className="jv"><p className="muted jv-loading">Opening…</p></div>;

  const pay = formatPay(job, currency);
  return (
    <div className="jv">
      <header className="jv-head">
        <div className="jv-title">
          <h2>{job.title}</h2>
          <p>
            <strong>{job.company || "Company not set"}</strong>
            {[job.location, pay, job.lane].filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
          </p>
        </div>
        <div className="jv-actions">
          {job.url && <a className="btn btn-primary btn-sm" href={job.url} target="_blank" rel="noreferrer">{job.status === "applied" ? "Posting ↗" : "Apply ↗"}</a>}
          <button
            className="btn btn-quiet btn-sm"
            title="Free. Use after you update your profile."
            onClick={async () => change(await api.rescoreJob(job.id))}
          >
            Re-check fit
          </button>
          <button
            className="btn btn-quiet btn-sm danger"
            onClick={async () => {
              if (!confirm("Delete this job, its files and its history?")) return;
              await api.deleteJob(job.id);
              drop(job.id);
              onClose?.();
            }}
          >
            Delete
          </button>
          {onClose && <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">Close</button>}
        </div>
      </header>
      <nav className="jv-tabs" role="tablist">
        {JOB_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
            {tabLabel(t)}
            {t === "people" && job.details.contacts.length > 0 && <span className="count">{job.details.contacts.length}</span>}
          </button>
        ))}
      </nav>
      <div className="jv-body">
        {tab === "overview" && <Overview job={job} onChange={change} />}
        {tab === "resume" && <ResumeTab job={job} pack={pack} onBuilt={setPack} />}
        {tab === "application" && <ApplicationTab pack={pack} />}
        {tab === "jd" && <JdTab job={job} pack={pack} />}
        {tab === "people" && <PeopleTab job={job} onChange={change} />}
        {tab === "history" && <HistoryTab job={job} pack={pack} onChange={change} />}
      </div>
    </div>
  );
}
