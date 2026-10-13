import { useEffect, useState, type ToggleEvent } from "react";
import { companyKey } from "../../shared/agency";
import { CHANNELS, type Channel } from "../../shared/types";
import { api, type CompanyThread, type ThreadMessage } from "../api";
import { useJobs } from "../data";
import { plural, shortDate } from "../format";

function channelLabel(channel: string): string {
  const known: Channel | "" = CHANNELS.includes(channel as Channel) ? channel as Channel : "";
  switch (known) {
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
      const unexpected: never = known;
      return unexpected;
    }
  }
}

function ThreadRow({ thread, onChange }: { thread: CompanyThread; onChange: (threads: CompanyThread[]) => void }) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [followUp, setFollowUp] = useState(thread.followUpOn ?? "");
  const { jobs, reload } = useJobs();
  const roles = (jobs ?? []).filter((job) => companyKey(job.company) === thread.companyKey);
  const [roleId, setRoleId] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [channel, setChannel] = useState<Channel | "">("email");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [followError, setFollowError] = useState("");

  useEffect(() => setFollowUp(thread.followUpOn ?? ""), [thread.followUpOn]);

  async function load() {
    const next = await api.thread(thread.id);
    setMessages(next.messages);
  }

  async function onToggle(event: ToggleEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || messages !== null) return;
    try {
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this thread.");
    }
  }

  async function saveFollowUp(value: string) {
    const previous = followUp;
    setFollowUp(value);
    setFollowError("");
    try {
      const saved = await api.saveThreadFollowUp(thread.id, value || null);
      onChange(saved.threads);
    } catch (err) {
      setFollowUp(previous);
      setFollowError(err instanceof Error ? err.message : "Could not save the follow-up date.");
    }
  }

  async function logMessage() {
    setError("");
    try {
      const saved = await api.logThreadMessage(thread.id, { direction, channel, person, note, jobId: roleId || undefined });
      setMessages(saved.messages);
      if (roleId) await reload();
      setNote("");
      setPerson("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that message.");
    }
  }

  const silence = thread.silenceDays === null ? "" : `${plural(thread.silenceDays, "day")} of silence`;

  return (
    <details className="thread" onToggle={(event) => void onToggle(event)}>
      <summary>
        <span>
          <strong>{thread.company}</strong>
          <span className="l-sub">{plural(thread.openRoles, "open role")} · {plural(thread.messages, "message")}</span>
        </span>
        <span className="muted">{silence || (thread.followUpOn ? `Follow up ${shortDate(thread.followUpOn)}` : "No follow-up set")}</span>
      </summary>
      <div className="thread-body">
          <label className="field">
            <span>Follow up on</span>
            <input
              type="date"
              value={followUp}
              aria-invalid={followError ? true : undefined}
              aria-describedby={followError ? `follow-up-error-${thread.id}` : undefined}
              onChange={(e) => void saveFollowUp(e.target.value)}
            />
          </label>
          {followError && <p id={`follow-up-error-${thread.id}`} className="text-error" role="alert">{followError}</p>}
          {messages === null && <p className="muted">Loading messages…</p>}
          {messages?.length === 0 && <p className="muted">Nothing logged for this company yet.</p>}
          {messages && messages.length > 0 && (
            <ul className="lines">
              {messages.map((message) => (
                <li key={message.id} className="line">
                  <span className="line-main">
                    <span className="line-title">{message.direction === "in" ? "Reply" : "Sent"}{message.person ? ` · ${message.person}` : ""}</span>
                    <span className="line-facts">
                      <span>{shortDate(message.at)}</span>
                      {channelLabel(message.channel) && <span>{channelLabel(message.channel)}</span>}
                      {message.title && <span>{message.title}</span>}
                    </span>
                    {message.note && <span className="l-sub">{message.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="thread-log">
            <div className="filter-row">
              <select value={direction} onChange={(e) => setDirection(e.target.value === "in" ? "in" : "out")} aria-label="Direction">
                <option value="out">I sent this</option>
                <option value="in">They replied</option>
              </select>
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | "")} aria-label="Channel">
                <option value="">Channel</option>
                {CHANNELS.map((item) => <option key={item} value={item}>{channelLabel(item)}</option>)}
              </select>
              <input placeholder="Person" value={person} onChange={(e) => setPerson(e.target.value)} />
              {roles.length > 0 && (
                <select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Role">
                  <option value="">Whole company</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}
                </select>
              )}
            </div>
            <textarea rows={3} placeholder="What was said. This stays on your account." value={note} onChange={(e) => setNote(e.target.value)} />
            {error && <p className="text-error" role="alert">{error}</p>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logMessage()} disabled={!person && !note}>Log message</button>
          </div>
        </div>
    </details>
  );
}

export function CompanyThreads() {
  const [threads, setThreads] = useState<CompanyThread[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.threads().then((next) => setThreads(next.threads)).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load company threads.");
      setThreads([]);
    });
  }, []);

  if (error) return <p className="text-error">{error}</p>;
  if (!threads) return <p className="muted">Loading company threads…</p>;
  if (!threads.length) {
    return <p className="queue-empty">Company threads appear when you log a message on a job. One thread per company, not one per role.</p>;
  }
  const due = threads.filter((thread) => thread.followUpOn && thread.followUpOn <= new Date().toISOString().slice(0, 10));
  return (
    <section className="queue">
      <header>
        <h2>By company <span className="n">{threads.length}</span></h2>
        <p>
          Messages to the same company stay together. {due.length ? `${due.length} follow-up${due.length === 1 ? "" : "s"} due.` : "Set a follow-up when you want a reminder."}
        </p>
      </header>
      {threads.map((thread) => <ThreadRow key={thread.id} thread={thread} onChange={setThreads} />)}
    </section>
  );
}
