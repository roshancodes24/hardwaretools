import { useEffect, useRef } from "react";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmBg =
    variant === "danger" ? "var(--danger-strong)" : "var(--accent)";

  const icon =
    variant === "default" ? null : (
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          marginBottom: 16,
          background:
            variant === "danger"
              ? "var(--danger-soft)"
              : "var(--accent-soft)",
          color: variant === "danger" ? "var(--danger-strong)" : "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.14" />
          <path
            d="M12 6v8M12 17.5v.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "inherit",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "28px 28px 20px",
          width: 400,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.18)",
        }}
      >
        {icon}
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 8,
            lineHeight: 1.35,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            color: "var(--muted)",
            lineHeight: 1.6,
            marginBottom: 24,
            whiteSpace: "pre-line",
          }}
        >
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface-subtle)",
              color: "var(--text)",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              border: "none",
              background: confirmBg,
              color: "var(--on-accent)",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
