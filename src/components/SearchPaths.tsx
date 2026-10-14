import { useEffect, useRef, useState } from "react";
import { COUNTRIES, currencies } from "../../shared/geo";
import {
  PAY_MIDPOINT_NOTE,
  SEARCH_PATH_LIMIT,
  draftWithCurrency,
  draftWithPeriod,
  searchPathLabel,
  suggestSearchPaths,
  validateSearchPathDraft,
  type EditDisposition,
  type JobDisposition,
  type PathCommit,
  type PathPreview,
  type PayDirection,
  type SearchPath,
  type SearchPathDraft,
} from "../../shared/engine/searchPaths";
import type { Profile, SalaryPeriod } from "../../shared/types";
import { api } from "../api";
import { Field, NumberInput } from "./fields";

export class SaveCancelled extends Error {
  constructor() {
    super("Save cancelled");
  }
}

function renumber(paths: SearchPath[]): SearchPath[] {
  return paths.map((path, sortOrder) => {
    const next = { ...path, sortOrder };
    next.name = searchPathLabel(next);
    return next;
  });
}

function toPath(draft: SearchPathDraft, id: string): SearchPath {
  const next: SearchPath = {
    id,
    name: "",
    locationMode: draft.locationMode,
    city: draft.locationMode === "remote" ? "" : draft.city.trim(),
    payDirection: draft.payDirection,
    payAmount: draft.payDirection === "any" ? null : draft.payAmount,
    currency: draft.currency,
    salaryPeriod: draft.salaryPeriod,
    sortOrder: draft.sortOrder,
    revision: 0,
    createdAt: "",
    updatedAt: "",
  };
  next.name = searchPathLabel(next);
  return next;
}

function toDraft(path: SearchPath, index: number): SearchPathDraft {
  return {
    id: path.id.startsWith("draft-") ? undefined : path.id,
    locationMode: path.locationMode,
    city: path.city,
    payDirection: path.payDirection,
    payAmount: path.payAmount,
    currency: path.currency,
    salaryPeriod: path.salaryPeriod,
    sortOrder: index,
  };
}

function blankDraft(currency: string, salaryPeriod: SalaryPeriod, sortOrder: number): SearchPathDraft {
  return { locationMode: "city", city: "", payDirection: "any", payAmount: null, currency, salaryPeriod, sortOrder };
}

function pathsBesides(paths: SearchPath[], commit: PathCommit): SearchPath[] {
  switch (commit.action) {
    case "delete":
      return paths.filter((path) => path.id !== commit.id);
    case "create":
    case "update":
    case "reorder":
    case "replace":
      return [];
    default: {
      const never: never = commit;
      return never;
    }
  }
}

function withDisposition(commit: PathCommit, disposition: JobDisposition, moveToId: string | null): PathCommit {
  switch (commit.action) {
    case "delete":
      return { ...commit, disposition, moveToId };
    case "create":
    case "update":
    case "reorder":
    case "replace":
      if (disposition === "move") return commit;
      return { ...commit, disposition };
    default: {
      const never: never = commit;
      return never;
    }
  }
}

export function SearchPathEditor({
  draft,
  cities,
  onChange,
}: {
  draft: SearchPathDraft;
  cities: string[];
  onChange: (draft: SearchPathDraft) => void;
}) {
  const label = searchPathLabel({
    ...draft,
    city: draft.locationMode === "remote" ? "" : draft.city,
    payAmount: draft.payDirection === "any" ? null : draft.payAmount,
  });
  return (
    <div className="path-editor">
      <Field label="Place">
        <select
          aria-label="Place"
          value={draft.locationMode}
          onChange={(event) => {
            const locationMode = event.target.value === "remote" ? "remote" : "city";
            onChange({ ...draft, locationMode, city: locationMode === "remote" ? "" : draft.city });
          }}
        >
          <option value="city">One city</option>
          <option value="remote">Remote</option>
        </select>
      </Field>
      {draft.locationMode === "city" && (
        <Field label="City" hint="One city for this path. Remote is its own path.">
          <input
            aria-label="City"
            list="search-path-cities"
            value={draft.city}
            onChange={(event) => onChange({ ...draft, city: event.target.value })}
            placeholder="Pune"
          />
          <datalist id="search-path-cities">
            {cities.map((city) => <option key={city} value={city} />)}
          </datalist>
        </Field>
      )}
      <Field label="Pay rule">
        <select
          aria-label="Pay rule"
          value={draft.payDirection}
          onChange={(event) => {
            const payDirection = event.target.value as PayDirection;
            onChange({ ...draft, payDirection, payAmount: payDirection === "any" ? null : draft.payAmount });
          }}
        >
          <option value="above">Above threshold</option>
          <option value="below">Below threshold</option>
          <option value="any">Any pay</option>
        </select>
      </Field>
      {draft.payDirection !== "any" && (
        <Field label="Threshold" hint="Compared with the midpoint of the published range.">
          <NumberInput value={draft.payAmount} onChange={(payAmount) => onChange({ ...draft, payAmount })} placeholder="35" />
        </Field>
      )}
      <Field label="Currency">
        <select aria-label="Currency" value={draft.currency} onChange={(event) => onChange(draftWithCurrency(draft, event.target.value))}>
          {currencies().map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </Field>
      <Field label="Pay period">
        <select
          aria-label="Pay period"
          value={draft.salaryPeriod}
          onChange={(event) => onChange(draftWithPeriod(draft, event.target.value as SalaryPeriod))}
        >
          <option value="year">Per year</option>
          <option value="month">Per month</option>
          <option value="hour">Per hour</option>
          <option value="lpa">Lakhs per year (LPA)</option>
        </select>
      </Field>
      <p className="path-preview">This path will be called <strong>{label}</strong>.</p>
      <p className="muted small">{PAY_MIDPOINT_NOTE}</p>
    </div>
  );
}

function effectCopy(preview: PathPreview | null, previewing: boolean, needsDestination: boolean): string {
  if (needsDestination) return "Choose a search path to move the jobs to.";
  if (previewing || !preview) return "Checking which saved jobs this change touches…";
  if (preview.affected === 0) return "No saved jobs change.";
  if (preview.assigned === 0 && preview.archived === 0) {
    return `${preview.affected} saved jobs will keep their history and use the older place labels again.`;
  }
  const jobs = preview.affected === 1 ? "1 saved job is" : `${preview.affected} saved jobs are`;
  return `${jobs} affected. ${preview.assigned} will sit on a search path. ${preview.archived} will be archived. Archived jobs stay in your history. Nothing is deleted.`;
}

function DispositionDialog({
  preview,
  previewing,
  needsDestination,
  disposition,
  allowMove,
  moveChoices,
  moveToId,
  busy,
  onDisposition,
  onMoveTo,
  onConfirm,
  onCancel,
}: {
  preview: PathPreview | null;
  previewing: boolean;
  needsDestination: boolean;
  disposition: JobDisposition;
  allowMove: boolean;
  moveChoices: SearchPath[];
  moveToId: string;
  busy: boolean;
  onDisposition: (disposition: JobDisposition) => void;
  onMoveTo: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmDisabled = busy || previewing || needsDestination || !preview || (disposition === "move" && !moveToId);
  return (
    <>
      <button type="button" className="scrim" aria-label="Close" onClick={onCancel} />
      <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="path-dialog-title">
        <div className="modal-card">
          <h2 id="path-dialog-title">What should happen to the jobs?</h2>
          <p>{effectCopy(preview, previewing, needsDestination)}</p>
          <fieldset className="path-choices">
            <legend className="clip">Job disposition</legend>
            <label className="checkline">
              <input type="radio" name="disposition" checked={disposition === "reclassify"} onChange={() => onDisposition("reclassify")} />
              <span><strong>Reclassify</strong> (recommended). Move each affected job to the first search path that still fits. Archive the ones that fit none.</span>
            </label>
            <label className="checkline">
              <input type="radio" name="disposition" checked={disposition === "archive"} onChange={() => onDisposition("archive")} />
              <span><strong>Archive.</strong> Keep the jobs, mark them archived, and leave the current path name on them.</span>
            </label>
            {allowMove && (
              <label className="checkline">
                <input type="radio" name="disposition" checked={disposition === "move"} onChange={() => onDisposition("move")} />
                <span><strong>Move all</strong> jobs from the deleted path onto another path you own.</span>
              </label>
            )}
          </fieldset>
          {disposition === "move" && (
            <Field label="Move jobs to">
              <select aria-label="Move jobs to" value={moveToId} onChange={(event) => onMoveTo(event.target.value)}>
                <option value="">Choose a search path</option>
                {moveChoices.map((path) => <option key={path.id} value={path.id}>{path.name}</option>)}
              </select>
            </Field>
          )}
          <div className="row-end">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={confirmDisabled}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function SearchPathManager({
  paths,
  cities,
  currency,
  salaryPeriod,
  mode,
  onChange,
  onPreview,
  onCommit,
}: {
  paths: SearchPath[];
  cities: string[];
  currency: string;
  salaryPeriod: SalaryPeriod;
  mode: "local" | "live";
  onChange?: (paths: SearchPath[]) => void;
  onPreview?: (commit: PathCommit) => Promise<PathPreview>;
  onCommit?: (commit: PathCommit) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string | null; draft: SearchPathDraft } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    commit: PathCommit;
    preview: PathPreview | null;
    disposition: JobDisposition;
    moveToId: string;
    previewing: boolean;
    needsDestination: boolean;
  } | null>(null);
  const previewTicket = useRef(0);

  function editDraft(next: SearchPathDraft) {
    setEditing((current) => (current ? { ...current, draft: next } : current));
  }

  async function commitLive(commit: PathCommit) {
    if (!onPreview || !onCommit) return;
    setBusy(true);
    setError("");
    try {
      const preview = await onPreview(commit);
      if (preview.affected === 0) {
        await onCommit(commit);
        setEditing(null);
        return;
      }
      setPending({
        commit,
        preview,
        disposition: commit.disposition === "move" ? "move" : commit.disposition,
        moveToId: commit.action === "delete" ? commit.moveToId ?? "" : "",
        previewing: false,
        needsDestination: false,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveEditor() {
    if (!editing) return;
    const draft = {
      ...editing.draft,
      city: editing.draft.locationMode === "remote" ? "" : editing.draft.city.trim(),
      payAmount: editing.draft.payDirection === "any" ? null : editing.draft.payAmount,
      sortOrder: editing.id ? paths.find((path) => path.id === editing.id)?.sortOrder ?? editing.draft.sortOrder : paths.length,
    };
    const problem = validateSearchPathDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (mode === "local") {
      const id = editing.id ?? `draft-${crypto.randomUUID()}`;
      const next = editing.id
        ? paths.map((path) => (path.id === editing.id ? toPath(draft, path.id) : path))
        : [...paths, toPath(draft, id)];
      onChange?.(renumber(next));
      setEditing(null);
      return;
    }
    const commit: PathCommit = editing.id
      ? { action: "update", id: editing.id, draft, disposition: "reclassify" }
      : { action: "create", draft, disposition: "reclassify" };
    void commitLive(commit);
  }

  function remove(path: SearchPath) {
    if (mode === "local") {
      onChange?.(renumber(paths.filter((item) => item.id !== path.id)));
      return;
    }
    void commitLive({ action: "delete", id: path.id, disposition: "reclassify", moveToId: null });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= paths.length) return;
    const next = paths.slice();
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    const ordered = renumber(next);
    if (mode === "local") {
      onChange?.(ordered);
      return;
    }
    void commitLive({ action: "reorder", ids: ordered.map((path) => path.id), disposition: "reclassify" });
  }

  async function previewDisposition(disposition: JobDisposition, moveToId: string) {
    if (!onPreview) return;
    const base = pending?.commit;
    if (!base) return;
    const needsDestination = disposition === "move" && !moveToId;
    const commit = withDisposition(base, disposition, moveToId || null);
    if (needsDestination) {
      previewTicket.current += 1;
      setPending({ commit, preview: null, disposition, moveToId, previewing: false, needsDestination: true });
      return;
    }
    const ticket = ++previewTicket.current;
    setPending({ commit, preview: null, disposition, moveToId, previewing: true, needsDestination: false });
    try {
      const preview = await onPreview(commit);
      if (ticket !== previewTicket.current) return;
      setPending({ commit, preview, disposition, moveToId, previewing: false, needsDestination: false });
    } catch (err) {
      if (ticket !== previewTicket.current) return;
      setError((err as Error).message);
      setPending(null);
    }
  }

  return (
    <div className="path-manager">
      <div className="row-between">
        <p className="path-count" aria-live="polite">{paths.length} of {SEARCH_PATH_LIMIT} search paths</p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={paths.length >= SEARCH_PATH_LIMIT || busy}
          onClick={() => {
            setError("");
            setEditing({ id: null, draft: blankDraft(currency, salaryPeriod, paths.length) });
          }}
        >
          Add a search path
        </button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {editing && (
        <section className="card sub-card" aria-label={editing.id ? "Edit search path" : "New search path"}>
          <SearchPathEditor draft={editing.draft} cities={cities} onChange={editDraft} />
          <div className="row-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveEditor} disabled={busy}>{busy ? "Saving…" : "Save path"}</button>
          </div>
        </section>
      )}
      {paths.length === 0 && !editing && (
        <div className="card path-empty">
          <h2>No search paths yet</h2>
          <p>Add up to six. Each one is a city or Remote, plus a pay rule. Until you save one, jobs keep the older place-and-floor labels.</p>
          <p className="muted small">Examples: Pune · Below ₹35 LPA, Bengaluru · Above ₹50 LPA, Remote · Above ₹30 LPA.</p>
        </div>
      )}
      <ol className="path-list">
        {paths.map((path, index) => (
          <li className="card path-card" key={path.id}>
            <div>
              <h2>{path.name}</h2>
              <p className="muted small">{path.locationMode === "remote" ? "Remote" : path.city} · {path.payDirection === "any" ? "Any pay" : path.payDirection === "above" ? "Above threshold" : "Below threshold"}</p>
            </div>
            <div className="path-card-actions">
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${path.name} up`} disabled={index === 0 || busy} onClick={() => move(index, -1)}>Up</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${path.name} down`} disabled={index === paths.length - 1 || busy} onClick={() => move(index, 1)}>Down</button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setError("");
                  setEditing({ id: path.id, draft: toDraft(path, index) });
                }}
              >
                Edit
              </button>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => remove(path)} disabled={busy}>Delete</button>
            </div>
          </li>
        ))}
      </ol>
      {pending && (
        <DispositionDialog
          preview={pending.preview}
          previewing={pending.previewing}
          needsDestination={pending.needsDestination}
          disposition={pending.disposition}
          allowMove={pathsBesides(paths, pending.commit).length > 0}
          moveChoices={pathsBesides(paths, pending.commit)}
          moveToId={pending.moveToId}
          busy={busy}
          onDisposition={(disposition) => void previewDisposition(disposition, disposition === "move" ? pending.moveToId : "")}
          onMoveTo={(id) => void previewDisposition("move", id)}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (!onCommit || !pending || pending.previewing || pending.needsDestination || !pending.preview) return;
            const commit = pending.commit;
            setBusy(true);
            void onCommit(commit)
              .then(() => {
                setPending(null);
                setEditing(null);
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}

export function OnboardingPaths({
  profile,
  onReady,
}: {
  profile: Profile;
  onReady: (save: (() => Promise<void>) | null) => void;
}) {
  const [paths, setPaths] = useState<SearchPath[] | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const edited = useRef(false);
  const previewTicket = useRef(0);
  const [confirm, setConfirm] = useState<{
    drafts: SearchPathDraft[];
    preview: PathPreview | null;
    disposition: EditDisposition;
    previewing: boolean;
    resolve: () => void;
    reject: (err: Error) => void;
  } | null>(null);
  const cities = COUNTRIES.find((country) => country.code === profile.preferences.country)?.cities ?? [];
  const suggestionKey = [
    profile.preferences.cities.join("|"),
    profile.preferences.remoteOk ? "remote" : "local",
    profile.preferences.minSalary ?? "",
    profile.preferences.currency,
    profile.preferences.salaryPeriod,
  ].join("~");

  useEffect(() => {
    let cancelled = false;
    edited.current = false;
    setPaths(null);
    setSavedCount(null);
    api.listSearchPaths().then((data) => {
      if (cancelled) return;
      setSavedCount(data.paths.length);
      if (data.paths.length) setPaths(data.paths);
    }, (err: Error) => {
      if (cancelled) return;
      edited.current = true;
      setSavedCount(0);
      setPaths([]);
      onReady(async () => {
        throw err;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  useEffect(() => {
    if (savedCount !== 0 || edited.current) return;
    setPaths(suggestSearchPaths(profile.preferences).map((draft, index) => toPath(draft, `draft-${index + 1}`)));
  }, [savedCount, suggestionKey, profile.preferences]);

  useEffect(() => {
    if (!paths) {
      onReady(null);
      return;
    }
    onReady(async () => {
      const drafts = paths.map(toDraft);
      const preview = await api.previewSearchPaths({ action: "replace", drafts, disposition: "reclassify" });
      if (preview.affected === 0) {
        await api.replaceSearchPaths({ drafts, disposition: "reclassify" });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        setConfirm({ drafts, preview, disposition: "reclassify", previewing: false, resolve, reject });
      });
    });
  }, [paths, onReady]);

  if (!paths) return <p className="muted">Loading search paths…</p>;
  return (
    <>
      <div className="path-examples">
        <p>Start from your cities and remote choice. If you set a pay floor, each suggestion is Above that amount. Edit them before you continue.</p>
        <ul className="onboard-points">
          <li>Pune · Below ₹35 LPA</li>
          <li>Bengaluru · Above ₹50 LPA</li>
          <li>Remote · Above ₹30 LPA</li>
        </ul>
      </div>
      <SearchPathManager
        mode="local"
        paths={paths}
        cities={cities}
        currency={profile.preferences.currency}
        salaryPeriod={profile.preferences.salaryPeriod}
        onChange={(next) => {
          edited.current = true;
          setPaths(next);
        }}
      />
      {confirm && (
        <DispositionDialog
          preview={confirm.preview}
          previewing={confirm.previewing}
          needsDestination={false}
          disposition={confirm.disposition}
          allowMove={false}
          moveChoices={[]}
          moveToId=""
          busy={false}
          onDisposition={(disposition) => {
            if (disposition === "move" || !confirm) return;
            const drafts = confirm.drafts;
            const ticket = ++previewTicket.current;
            setConfirm({ ...confirm, disposition, preview: null, previewing: true });
            void api.previewSearchPaths({ action: "replace", drafts, disposition }).then((preview) => {
              if (ticket !== previewTicket.current) return;
              setConfirm((current) => (current ? { ...current, preview, previewing: false, disposition } : current));
            }, (err: Error) => {
              if (ticket !== previewTicket.current) return;
              confirm.reject(err);
              setConfirm(null);
            });
          }}
          onMoveTo={() => undefined}
          onCancel={() => {
            confirm.reject(new SaveCancelled());
            setConfirm(null);
          }}
          onConfirm={() => {
            if (confirm.previewing || !confirm.preview) return;
            const pending = confirm;
            setConfirm(null);
            void api.replaceSearchPaths({ drafts: pending.drafts, disposition: pending.disposition })
              .then(() => pending.resolve())
              .catch((err: Error) => pending.reject(err));
          }}
        />
      )}
    </>
  );
}
