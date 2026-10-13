import { describeRole, familyExamples, resolveRole } from "../../shared/engine/occupations";

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
