/** Full-screen blocking overlay for long-running client or API work. */
export function BusyOverlay({
  open,
  title,
  subtitle,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
}) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, var(--text) 35%, transparent)",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 20px 50px var(--shadow-color)",
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            border: "3px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            display: "inline-block",
            animation: "busy-overlay-spin 0.75s linear infinite",
          }}
        />
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{subtitle}</div>
        ) : null}
      </div>
      <style>{`@keyframes busy-overlay-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** Let React paint the overlay before heavy synchronous/async work. */
export function paintBeforeWork(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
