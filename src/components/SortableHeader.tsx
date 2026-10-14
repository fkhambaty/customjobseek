import type { SortDirection, SortState } from "../tableSort";

function arrow(direction: SortDirection | null): string {
  switch (direction) {
    case "asc":
      return "↑";
    case "desc":
      return "↓";
    case null:
      return "↕";
    default: {
      const never: never = direction;
      return never;
    }
  }
}

function ariaSort(direction: SortDirection | null): "ascending" | "descending" | undefined {
  switch (direction) {
    case "asc":
      return "ascending";
    case "desc":
      return "descending";
    case null:
      return undefined;
    default: {
      const never: never = direction;
      return never;
    }
  }
}

function buttonLabel(label: string, direction: SortDirection | null): string {
  switch (direction) {
    case "asc":
      return `${label}, sorted ascending. Activate to sort descending.`;
    case "desc":
      return `${label}, sorted descending. Activate to sort ascending.`;
    case null:
      return `Sort by ${label}`;
    default: {
      const never: never = direction;
      return never;
    }
  }
}

export function SortableHeader<K extends string>({
  label,
  column,
  sort,
  defaultDirection,
  onSort,
  className,
}: {
  label: string;
  column: K;
  sort: SortState<K> | null;
  defaultDirection: SortDirection;
  onSort: (column: K, defaultDirection: SortDirection) => void;
  className?: string;
}) {
  const direction = sort?.key === column ? sort.direction : null;
  return (
    <th scope="col" className={className} aria-sort={ariaSort(direction)}>
      <button
        type="button"
        className="sort-btn"
        aria-label={buttonLabel(label, direction)}
        onClick={(event) => {
          event.stopPropagation();
          onSort(column, defaultDirection);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
      >
        {label}
        <span className={direction ? "sort-arrow" : "sort-arrow idle"} aria-hidden="true">{arrow(direction)}</span>
      </button>
    </th>
  );
}
