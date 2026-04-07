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
    variant === "danger" ? "#111827" : variant === "warning" ? "#2563eb" : "#1c1917";

  const icon =
    variant === "default" ? null : (
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          marginBottom: 16,
          background: variant === "danger" ? "#f3f4f6" : "#eff6ff",
          color: variant === "danger" ? "#111827" : "#2563eb",
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
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "28px 28px 20px",
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "none",
        }}
      >
        {icon}
        <div style={{ fontSize: 16, fontWeight: 500, color: "#1c1917", marginBottom: 8 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#78716c",
            lineHeight: 1.6,
            marginBottom: 24,
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
              border: "1px solid #e7e5e4",
              background: "#fff",
              color: "#1c1917",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 14,
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
              color: "#fff",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 14,
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
