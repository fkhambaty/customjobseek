export type SortDirection = "asc" | "desc";

export type SortKind = "string" | "number" | "date" | "status";

/** A missing value sorts after every real value, in either direction. */
export type SortScalar = string | number | null;

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

interface SortColumnBase<T, K extends string> {
  key: K;
  /** Direction used the first time this column is chosen. */
  defaultDirection: SortDirection;
  value: (row: T) => SortScalar | readonly SortScalar[];
}

export type SortColumn<T, K extends string> =
  | (SortColumnBase<T, K> & { kind: "string" | "number" | "date" })
  | (SortColumnBase<T, K> & { kind: "status"; statusOrder: readonly string[] });

export type ColumnMap<T, K extends string> = { readonly [P in K]: SortColumn<T, P> };

/**
 * Application tables are datasets and can sort. Markdown tables are document
 * content and stay in the order the author wrote.
 */
export type TableSource = "application" | "markdown";

export function oppositeDirection(direction: SortDirection): SortDirection {
  switch (direction) {
    case "asc":
      return "desc";
    case "desc":
      return "asc";
    default: {
      const never: never = direction;
      return never;
    }
  }
}

/** Same column flips direction. A new column starts at its default direction. */
export function nextSort<K extends string>(current: SortState<K> | null, column: K, defaultDirection: SortDirection): SortState<K> {
  if (current?.key !== column) return { key: column, direction: defaultDirection };
  return { key: column, direction: oppositeDirection(current.direction) };
}

export function shouldSortTable(source: TableSource): boolean {
  switch (source) {
    case "application":
      return true;
    case "markdown":
      return false;
    default: {
      const never: never = source;
      return never;
    }
  }
}

export function rowsInTableOrder<T, K extends string>(
  source: TableSource,
  rows: readonly T[],
  columns: ColumnMap<T, K>,
  state: SortState<K> | null,
): T[] {
  switch (source) {
    case "application":
      return sortByColumn(rows, columns, state);
    case "markdown":
      return rows.slice();
    default: {
      const never: never = source;
      return never;
    }
  }
}

export function sortByColumn<T, K extends string>(rows: readonly T[], columns: ColumnMap<T, K>, state: SortState<K> | null): T[] {
  if (state === null) return rows.slice();
  const column = columns[state.key];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const difference = compareList(column, state.direction, scalars(column.value(left.row)), scalars(column.value(right.row)));
      return difference === 0 ? left.index - right.index : difference;
    })
    .map((item) => item.row);
}

function scalars(value: SortScalar | readonly SortScalar[]): readonly SortScalar[] {
  if (value === null || typeof value === "string" || typeof value === "number") return [value];
  return value;
}

function compareList<T, K extends string>(
  column: SortColumn<T, K>,
  direction: SortDirection,
  left: readonly SortScalar[],
  right: readonly SortScalar[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = compareSortValues(column, direction, left[index] ?? null, right[index] ?? null);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareSortValues<T, K extends string>(column: SortColumn<T, K>, direction: SortDirection, left: SortScalar, right: SortScalar): number {
  const leftMissing = isMissing(column, left);
  const rightMissing = isMissing(column, right);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }
  const difference = comparePresent(column, left, right);
  switch (direction) {
    case "asc":
      return difference;
    case "desc":
      return -difference;
    default: {
      const never: never = direction;
      return never;
    }
  }
}

function isMissing<T, K extends string>(column: SortColumn<T, K>, value: SortScalar): boolean {
  switch (column.kind) {
    case "string":
      return stringValue(value) === null;
    case "number":
      return numberValue(value) === null;
    case "date":
      return dateRank(value) === null;
    case "status":
      return statusRank(value, column.statusOrder) === null;
    default: {
      const never: never = column;
      return never;
    }
  }
}

function comparePresent<T, K extends string>(column: SortColumn<T, K>, left: SortScalar, right: SortScalar): number {
  switch (column.kind) {
    case "string":
      return (stringValue(left) ?? "").localeCompare(stringValue(right) ?? "", "en", { numeric: true, sensitivity: "base" });
    case "number":
      return (numberValue(left) ?? 0) - (numberValue(right) ?? 0);
    case "date":
      return (dateRank(left) ?? 0) - (dateRank(right) ?? 0);
    case "status":
      return (statusRank(left, column.statusOrder) ?? 0) - (statusRank(right, column.statusOrder) ?? 0);
    default: {
      const never: never = column;
      return never;
    }
  }
}

function stringValue(value: SortScalar): string | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const text = value.trim();
  return text ? text : null;
}

function numberValue(value: SortScalar): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateRank(value: SortScalar): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null) return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? "" : "Z"));
  return Number.isNaN(parsed) ? null : parsed;
}

function statusRank(value: SortScalar, order: readonly string[]): number | null {
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const index = order.indexOf(text);
  return index === -1 ? order.length : index;
}
