import type { ReactNode } from "react";

export function FormErrorBanner({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: "var(--danger-soft-solid)",
        color: "var(--danger-text)",
        padding: "8px 10px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        border: "1px solid var(--danger-border-solid)",
      }}
    >
      {text}
    </div>
  );
}

export function FieldWrap({
  label,
  children,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  errorId?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-strong)" }}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={errorId} style={{ fontSize: 11, color: "var(--danger-text)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
