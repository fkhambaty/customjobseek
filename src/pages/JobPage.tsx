import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { JOB_TABS, JobView, type JobTab } from "../components/JobView";

export function JobPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: JobTab = JOB_TABS.includes(raw as JobTab) ? (raw as JobTab) : "overview";
  return (
    <div className="page">
      <Link to="/pipeline" className="back">← Pipeline</Link>
      <JobView id={id} tab={tab} onTab={(t) => setParams({ tab: t })} onClose={() => navigate("/pipeline")} />
    </div>
  );
}
