import { INDUSTRY_CATEGORIES } from "../../shared/industries";
import { describeRole, familyExamples, resolveRole } from "../../shared/engine/occupations";

export function IndustryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const taken = new Set(selected);
  return (
    <div className="role-targets">
      <p className="muted small">
        Pick the industries you work in. Scans prefer employer boards in those industries, so a dietitian is not matched against unrelated software boards first.
      </p>
      <div className="chips">
        {INDUSTRY_CATEGORIES.map((item) => {
          const on = taken.has(item.id);
          return (
            <button
              type="button"
              key={item.id}
              className={`chip ${on ? "chip-on" : ""}`}
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RoleTargets({ roles, onAdd }: { roles: string[]; onAdd: (title: string) => void }) {
  const taken = new Set(roles.map((role) => role.toLowerCase()));
  return (
    <div className="role-targets">
      <p className="muted small">Examples from each field. Type any other title in the box. A title that is not listed is still used.</p>
      <div className="chips">
        {familyExamples().map((item) => (
          <button
            type="button"
            key={item.family}
            className="chip"
            disabled={taken.has(item.title.toLowerCase())}
            onClick={() => onAdd(item.title)}
          >
            {item.label}: {item.title}
          </button>
        ))}
      </div>
      {roles.length > 0 && (
        <ul className="role-read">
          {roles.map((role) => {
            const resolved = resolveRole(role);
            return (
              <li key={role}>
                <strong>{role}</strong>
                <span className="muted"> · {describeRole(resolved)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
