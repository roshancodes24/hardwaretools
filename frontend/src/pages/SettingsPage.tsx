import { useTheme } from "../ThemeProvider";
import type { ThemePreference } from "../lib/theme";

const OPTIONS: {
  id: ThemePreference;
  label: string;
  description: string;
}[] = [
  {
    id: "light",
    label: "Light",
    description: "Bright backgrounds for well-lit counters and offices.",
  },
  {
    id: "dark",
    label: "Dark",
    description: "Reduced glare for low-light environments.",
  },
  {
    id: "system",
    label: "System",
    description: "Follows your device or browser appearance setting.",
  },
];

export function SettingsPage() {
  const { preference, effectiveTheme, setPreference } = useTheme();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 640,
        width: "100%",
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Settings
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Personal preferences for this browser. Changes are saved locally.
        </p>
      </div>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            Appearance
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Currently using{" "}
            <strong style={{ color: "var(--text)" }}>
              {effectiveTheme === "dark" ? "dark" : "light"}
            </strong>
            {preference === "system" ? " (from system)" : ""} mode.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Theme"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {OPTIONS.map((opt) => {
            const selected = preference === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreference(opt.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: selected
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: selected ? "var(--accent-soft)" : "var(--surface-subtle)",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 1,
                    borderRadius: "50%",
                    border: selected
                      ? "5px solid var(--accent)"
                      : "2px solid var(--border)",
                    background: "var(--surface)",
                    flexShrink: 0,
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 2,
                    }}
                  >
                    {opt.label}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                    {opt.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
