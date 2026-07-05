export function Toast({
  status,
}: {
  status: { type: "success" | "error"; msg: string } | null;
}) {
  if (!status) return null;
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        background: status.type === "success" ? "var(--stock-ok-bg)" : "var(--stock-out-bg)",
        color: status.type === "success" ? "var(--success-text)" : "var(--danger-text)",
      }}
    >
      {status.msg}
    </div>
  );
}
