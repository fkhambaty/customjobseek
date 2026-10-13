import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { TailoredResume } from "../../shared/types";
import { api } from "../api";
import { Resume } from "../components/Resume";

export function PrintResume() {
  const { id = "" } = useParams();
  const [resume, setResume] = useState<TailoredResume | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (id === "master" ? api.masterResume() : api.getResume(id)).then(setResume, (e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!resume) return;
    // The PDF title becomes the default file name; it stays the candidate's name so no employer leaks into it.
    document.title = resume.fullName.replace(/\s+/g, "") || "Resume";
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [resume]);

  if (error) return <p style={{ padding: 24 }}>{error}</p>;
  if (!resume) return <p style={{ padding: 24 }}>Preparing your resume…</p>;
  return (
    <div className="print-shell">
      <div className="print-hint no-print">
        In the print dialog choose <strong>Save as PDF</strong>, paper <strong>A4</strong>, and turn off headers and footers.
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print again</button>
      </div>
      <Resume resume={resume} />
    </div>
  );
}
