import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SortableHeader } from "../src/components/SortableHeader";
import {
  nextSort,
  rowsInTableOrder,
  type ColumnMap,
  type SortState,
} from "../src/tableSort";

interface Row {
  id: string;
  name: string | null;
  count: number | null;
  when: string | null;
  status: string | null;
}

type Key = "name" | "count" | "when" | "status";

const columns: ColumnMap<Row, Key> = {
  name: { key: "name", kind: "string", defaultDirection: "asc", value: (row) => row.name },
  count: { key: "count", kind: "number", defaultDirection: "desc", value: (row) => row.count },
  when: { key: "when", kind: "date", defaultDirection: "desc", value: (row) => row.when },
  status: { key: "status", kind: "status", defaultDirection: "asc", statusOrder: ["applied", "interview", "rejected"], value: (row) => row.status },
};

function ids(rows: readonly Row[]): string[] {
  return rows.map((row) => row.id);
}

function ordered(rows: readonly Row[], state: SortState<Key> | null): string[] {
  return ids(rowsInTableOrder("application", rows, columns, state));
}

describe("table sort", () => {
  it("toggles direction and starts a new column at its default", () => {
    expect(nextSort(null, "count", "desc")).toEqual({ key: "count", direction: "desc" });
    expect(nextSort({ key: "count", direction: "desc" }, "count", "desc")).toEqual({ key: "count", direction: "asc" });
    expect(nextSort({ key: "count", direction: "asc" }, "count", "desc")).toEqual({ key: "count", direction: "desc" });
    expect(nextSort({ key: "count", direction: "desc" }, "name", "asc")).toEqual({ key: "name", direction: "asc" });
  });

  it("sorts numbers numerically and keeps nulls last", () => {
    const rows: Row[] = [
      { id: "ten", name: "a", count: 10, when: null, status: null },
      { id: "none", name: "b", count: null, when: null, status: null },
      { id: "two", name: "c", count: 2, when: null, status: null },
      { id: "zero", name: "d", count: 0, when: null, status: null },
      { id: "blank", name: "e", count: Number.NaN, when: null, status: null },
    ];
    expect(ordered(rows, { key: "count", direction: "asc" })).toEqual(["zero", "two", "ten", "none", "blank"]);
    expect(ordered(rows, { key: "count", direction: "desc" })).toEqual(["ten", "two", "zero", "none", "blank"]);
  });

  it("sorts dates chronologically and keeps empty or invalid dates last", () => {
    const rows: Row[] = [
      { id: "june", name: null, count: null, when: "2026-06-01", status: null },
      { id: "missing", name: null, count: null, when: "", status: null },
      { id: "morning", name: null, count: null, when: "2026-01-02T09:00:00Z", status: null },
      { id: "evening", name: null, count: null, when: "2026-01-02 18:00:00", status: null },
      { id: "bad", name: null, count: null, when: "not-a-date", status: null },
    ];
    expect(ordered(rows, { key: "when", direction: "asc" })).toEqual(["morning", "evening", "june", "missing", "bad"]);
    expect(ordered(rows, { key: "when", direction: "desc" })).toEqual(["june", "evening", "morning", "missing", "bad"]);
  });

  it("sorts strings without case and keeps blanks last", () => {
    const rows: Row[] = [
      { id: "item10", name: "Item 10", count: null, when: null, status: null },
      { id: "blank", name: "  ", count: null, when: null, status: null },
      { id: "banana", name: "banana", count: null, when: null, status: null },
      { id: "item2", name: "item 2", count: null, when: null, status: null },
      { id: "none", name: null, count: null, when: null, status: null },
    ];
    expect(ordered(rows, { key: "name", direction: "asc" })).toEqual(["banana", "item2", "item10", "blank", "none"]);
    expect(ordered(rows, { key: "name", direction: "desc" })).toEqual(["item10", "item2", "banana", "blank", "none"]);
  });

  it("sorts status by the given order, not the alphabet", () => {
    const rows: Row[] = [
      { id: "rejected", name: null, count: null, when: null, status: "rejected" },
      { id: "unknown", name: null, count: null, when: null, status: "closed" },
      { id: "applied", name: null, count: null, when: null, status: "applied" },
      { id: "missing", name: null, count: null, when: null, status: null },
      { id: "interview", name: null, count: null, when: null, status: "interview" },
    ];
    expect(ordered(rows, { key: "status", direction: "asc" })).toEqual(["applied", "interview", "rejected", "unknown", "missing"]);
    expect(ordered(rows, { key: "status", direction: "desc" })).toEqual(["unknown", "rejected", "interview", "applied", "missing"]);
  });

  it("uses later values when earlier ones tie, and still keeps nulls last", () => {
    const rows = [
      { id: "few", contacts: 1, messages: 0 },
      { id: "many", contacts: 1, messages: 4 },
      { id: "none", contacts: null as number | null, messages: 9 },
    ];
    const people = {
      people: {
        key: "people" as const,
        kind: "number" as const,
        defaultDirection: "desc" as const,
        value: (row: (typeof rows)[number]) => [row.contacts, row.messages],
      },
    };
    expect(rowsInTableOrder("application", rows, people, { key: "people", direction: "desc" }).map((row) => row.id)).toEqual(["many", "few", "none"]);
    expect(rowsInTableOrder("application", rows, people, { key: "people", direction: "asc" }).map((row) => row.id)).toEqual(["few", "many", "none"]);
  });

  it("breaks ties by original order in both directions", () => {
    const rows: Row[] = [
      { id: "a", name: "same", count: 1, when: null, status: null },
      { id: "b", name: "same", count: 2, when: null, status: null },
      { id: "c", name: "same", count: 1, when: null, status: null },
    ];
    expect(ordered(rows, { key: "count", direction: "asc" })).toEqual(["a", "c", "b"]);
    expect(ordered(rows, { key: "count", direction: "desc" })).toEqual(["b", "a", "c"]);
    expect(ordered(rows, { key: "name", direction: "desc" })).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the source rows", () => {
    const rows: Row[] = [
      { id: "b", name: "b", count: null, when: null, status: null },
      { id: "a", name: "a", count: null, when: null, status: null },
    ];
    const before = rows.map((row) => row.id);
    ordered(rows, { key: "name", direction: "asc" });
    expect(rows.map((row) => row.id)).toEqual(before);
  });

  it("leaves markdown document tables in source order", () => {
    const rows: Row[] = [
      { id: "b", name: "b", count: 2, when: null, status: null },
      { id: "a", name: "a", count: 1, when: null, status: null },
    ];
    const sorted = rowsInTableOrder("markdown", rows, columns, { key: "name", direction: "asc" });
    expect(ids(sorted)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(rows);
  });
});

describe("sortable header", () => {
  it("exposes scope, the active direction, and a button label", () => {
    const active = renderToStaticMarkup(createElement(SortableHeader, {
      label: "Pay",
      column: "pay",
      sort: { key: "pay", direction: "desc" },
      defaultDirection: "desc",
      onSort: () => undefined,
      className: "num",
    }));
    expect(active).toContain('scope="col"');
    expect(active).toContain('aria-sort="descending"');
    expect(active).toContain('type="button"');
    expect(active).toContain("Pay, sorted descending. Activate to sort ascending.");
    expect(active).toContain("↓");

    const idle = renderToStaticMarkup(createElement(SortableHeader, {
      label: "Role",
      column: "role",
      sort: { key: "pay", direction: "desc" },
      defaultDirection: "asc",
      onSort: () => undefined,
    }));
    expect(idle).not.toContain("aria-sort");
    expect(idle).toContain("Sort by Role");
    expect(idle).toContain("↕");
  });
});
