import {
  canonicalProductEvent,
  shouldRecordAnalytics,
  usageColumn,
  utcDay,
  type ProductEventName,
  type UsageField,
} from "../shared/commercial";

/** Best-effort. A missing stats row must not undo a fit check the person already paid for. */
export async function noteUsage(db: D1Database, userId: string, field: UsageField, nowMs = Date.now()): Promise<void> {
  const column = usageColumn(field);
  try {
    await db.prepare(
      `INSERT INTO usage_snapshots (user_id, day, ${column}) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET ${column} = ${column} + 1`,
    ).bind(userId, utcDay(nowMs)).run();
  } catch (err) {
    console.error("usage snapshot failed", err);
  }
}

export async function noteProductEvent(db: D1Database, userId: string | null, name: ProductEventName, nowMs = Date.now()): Promise<void> {
  try {
    if (!userId) return;
    const consent = await db.prepare("SELECT cookies FROM consent_preferences WHERE user_id = ?")
      .bind(userId)
      .first<{ cookies: string }>();
    if (!shouldRecordAnalytics(consent?.cookies)) return;
    await db.prepare("INSERT INTO product_events (user_id, name, day) VALUES (NULL, ?, ?)")
      .bind(canonicalProductEvent(name), utcDay(nowMs))
      .run();
  } catch (err) {
    console.error("product event failed", err);
  }
}
