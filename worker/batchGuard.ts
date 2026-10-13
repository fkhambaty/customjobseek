/**
 * D1 rejects `UPDATE` inside `WITH`, and `1/0` returns NULL instead of failing.
 * Inserting `ok = 0` violates `batch_guards.ok CHECK (ok = 1)`.
 * That error rolls back every statement in the same `db.batch()`.
 * A false WHERE inserts nothing, so the batch continues.
 */
export function abortBatchWhen(conditionSql: string): string {
  return `INSERT INTO batch_guards (ok) SELECT 0 WHERE ${conditionSql}`;
}
