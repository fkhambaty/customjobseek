import { Link, useParams } from "react-router-dom";
import { parseResumeFileRoute } from "../../shared/resumeFile";
import { ResumeFileView } from "../components/ResumeFileView";

export function ResumeViewerPage() {
  const { kind = "", id = "" } = useParams();
  const route = parseResumeFileRoute(kind, id, "pdf", null);

  return (
    <div className="page">
      <Link to="/resumes" className="back">← Resumes</Link>
      <div className="page-top">
        <div>
          <h1 className="page-title">Resume</h1>
          <p className="lede">Read the PDF here. Open it when you want to print, download a copy, or look at the HTML.</p>
        </div>
      </div>
      {route ? (
        <ResumeFileView kind={route.kind} id={route.id} />
      ) : (
        <div className="alert alert-error">That resume link is not valid.</div>
      )}
    </div>
  );
}
