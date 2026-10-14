import { useCallback, useState } from "react";
import { nextSort, type SortDirection, type SortState } from "./tableSort";

export function useTableSort<K extends string>(initial: SortState<K> | null) {
  const [sort, setSort] = useState<SortState<K> | null>(initial);
  const toggle = useCallback((column: K, defaultDirection: SortDirection) => {
    setSort((current) => nextSort(current, column, defaultDirection));
  }, []);
  return { sort, setSort, toggle };
}
