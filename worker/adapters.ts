import { adapterEnabled, complianceFor, parseAts } from "../shared/commercial";
import { sourceById } from "../shared/engine/sources";
import type { Env } from "./env";
import { notifyOwner } from "./notify";

const ALERT_AFTER_FAILURES = 5;

/** Tracks reader health. The stored error is generic so a board token never lands in this table or in owner mail. */
export async function noteAdapter(env: Env, ats: string, ok: boolean): Promise<void> {
  try {
    const known = parseAts(ats);
    if (!known || !adapterEnabled(known)) return;
    const now = new Date().toISOString();
    const source = sourceById(known);
    await env.DB.prepare(
      `INSERT INTO source_adapters
       (ats, enabled, compliance, notes, capabilities, countries, freshness_hours, listing, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ats) DO NOTHING`,
    ).bind(
      known,
      complianceFor(known),
      source.notes,
      JSON.stringify(source.capabilities),
      JSON.stringify(source.countries),
      source.freshnessHours,
      source.listing,
      now,
    ).run();
    if (ok) {
      await env.DB.prepare(
        `UPDATE source_adapters
         SET last_ok_at = ?, consecutive_failures = 0, last_error = '', updated_at = ? WHERE ats = ?`,
      ).bind(now, now, known).run();
      return;
    }
    const row = await env.DB.prepare(
      `UPDATE source_adapters
       SET last_error_at = ?, last_error = 'Reader failed', consecutive_failures = consecutive_failures + 1, updated_at = ?
       WHERE ats = ? RETURNING consecutive_failures`,
    ).bind(now, now, known).first<{ consecutive_failures: number }>();
    if ((row?.consecutive_failures ?? 0) < ALERT_AFTER_FAILURES) return;
    await notifyOwner(env, {
      kind: "source_unhealthy",
      dedupeKey: `adapter:${known}`,
      summary: `The ${known} job-board reader has failed several times in a row.`,
    });
  } catch (err) {
    console.error("adapter health failed", err);
  }
}
