import { COUNTRIES } from "../../shared/geo";
import { PAY_MIDPOINT_NOTE, type PathCommit } from "../../shared/engine/searchPaths";
import { api } from "../api";
import { SearchPathManager } from "../components/SearchPaths";
import { useJobs } from "../data";

export function SearchPathsPage() {
  const { profile, searchPaths, error, reload } = useJobs();
  const cities = COUNTRIES.find((country) => country.code === profile?.preferences.country)?.cities ?? [];
  const currency = profile?.preferences.currency || "USD";
  const salaryPeriod = profile?.preferences.salaryPeriod || "year";

  async function preview(commit: PathCommit) {
    return api.previewSearchPaths(commit);
  }

  async function commit(next: PathCommit) {
    switch (next.action) {
      case "create":
        await api.createSearchPath({ draft: next.draft, disposition: next.disposition });
        break;
      case "update":
        await api.updateSearchPath(next.id, { draft: next.draft, disposition: next.disposition });
        break;
      case "delete":
        await api.deleteSearchPath(next.id, { disposition: next.disposition, moveToId: next.moveToId });
        break;
      case "reorder":
        await api.reorderSearchPaths({ ids: next.ids, disposition: next.disposition });
        break;
      case "replace":
        await api.replaceSearchPaths({ drafts: next.drafts, disposition: next.disposition });
        break;
      default: {
        const never: never = next;
        throw new Error(String(never));
      }
    }
    await reload();
  }

  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Search paths</h1>
          <p className="lede">Up to six ordered paths. Each one is a city or Remote, and a pay rule. Jobs land on the first path that fits.</p>
        </div>
      </div>
      <p className="muted">{PAY_MIDPOINT_NOTE}</p>
      {error && !profile && <div className="alert alert-error" role="alert">{error}</div>}
      <SearchPathManager
        mode="live"
        paths={searchPaths}
        cities={cities}
        currency={currency}
        salaryPeriod={salaryPeriod}
        onPreview={preview}
        onCommit={commit}
      />
    </div>
  );
}
