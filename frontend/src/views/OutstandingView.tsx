import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { OutstandingSaleSummary } from "../api/types";
import { fmt, parseMoneyField } from "../lib/formatMoney";
import { formatIndiaDateTime } from "../lib/indiaTime";
import { resolveSplitPayment } from "../lib/splitPayment";
import { inputStyle } from "../styles/formStyles";

export function OutstandingView({ actingUserId }: { actingUserId: string }) {
  const recordedById = actingUserId;
  const [rows, setRows] = useState<OutstandingSaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<OutstandingSaleSummary | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "online_banking">("cash");
  const [paySplitPayment, setPaySplitPayment] = useState(false);
  const [payCashStr, setPayCashStr] = useState("");
  const [payOnlineStr, setPayOnlineStr] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payMsg, setPayMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOutstandingSales();
      setRows(data);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Failed to load outstanding sales");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (payFor) {
      const bal = Number(payFor.balanceAmount).toFixed(2);
      setPayAmount(bal);
      setPayNote("");
      setPayMethod("cash");
      setPaySplitPayment(false);
      setPayCashStr("");
      setPayOnlineStr("");
      setPayMsg(null);
    }
  }, [payFor]);

  const submitPayment = async () => {
    if (!payFor || !recordedById) return;
    const maxBal = Number(payFor.balanceAmount);
    let totalPay = 0;
    let payload:
      | {
          amount: number;
          paymentMethod: "cash" | "online_banking";
        }
      | {
          amount: number;
          payments: Array<{ method: "cash" | "online_banking"; amount: number }>;
        };

    if (paySplitPayment) {
      const split = resolveSplitPayment(
        payCashStr,
        payOnlineStr,
        maxBal,
        "Total received cannot exceed balance due."
      );
      if (!split.ok) {
        setPayMsg({ type: "err", text: split.error });
        return;
      }
      totalPay = split.clampedPaid;
      payload = { amount: totalPay, payments: split.initialPayments };
    } else {
      const amt = parseMoneyField(payAmount);
      if (amt == null || amt <= 0) {
        setPayMsg({ type: "err", text: "Enter a valid payment amount." });
        return;
      }
      totalPay = Math.round(amt * 100) / 100;
      if (totalPay > maxBal + 1e-6) {
        setPayMsg({ type: "err", text: "Amount cannot exceed balance due." });
        return;
      }
      payload = { amount: totalPay, paymentMethod: payMethod };
    }

    setPayLoading(true);
    setPayMsg(null);
    try {
      await api.recordSalePayment(payFor.id, {
        ...payload,
        createdById: recordedById,
        note: payNote.trim() || undefined,
      });
      setPayFor(null);
      await load();
    } catch (e) {
      setPayMsg({
        type: "err",
        text: isApiError(e) ? e.message : "Payment failed",
      });
    } finally {
      setPayLoading(false);
    }
  };

  if (!recordedById) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", fontSize: 14 }}>
        Session user IDs are missing, so payments cannot be recorded. Reload the
        app after the API is running.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 960,
        width: "100%",
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
          Outstanding balances
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Completed sales with an unpaid balance. Goods already left inventory;
          record payments here when the customer settles up.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            height: 36,
            padding: "0 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
        {loading ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--surface)",
            color: "var(--danger)",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div style={{ fontSize: 14, color: "var(--muted)" }}>
          No outstanding balances.
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "var(--surface-subtle)", color: "var(--muted)" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Sale</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Date</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Customer</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Total</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Paid</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Balance</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cust =
                  r.customerName?.trim() ||
                  (r.customerPhone ? `Phone ${r.customerPhone}` : "—");
                const dt = new Date(r.createdAt);
                return (
                  <tr
                    key={r.id}
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                      {r.saleNumber}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>
                      {Number.isNaN(dt.getTime())
                        ? r.createdAt
                        : formatIndiaDateTime(dt)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{cust}</td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmt(Number(r.totalAmount))}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        color: "var(--muted)",
                      }}
                    >
                      {fmt(Number(r.paidAmount))}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "var(--accent)",
                      }}
                    >
                      {fmt(Number(r.balanceAmount))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => setPayFor(r)}
                        style={{
                          height: 32,
                          padding: "0 12px",
                          borderRadius: 8,
                          border: "none",
                          background: "var(--accent)",
                          color: "var(--on-accent)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Pay
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {payFor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay-scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !payLoading && setPayFor(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !payLoading) setPayFor(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 400,
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: 20,
              boxShadow: "0 20px 50px var(--shadow-color)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              id="pay-modal-title"
              style={{ margin: "0 0 4px", fontSize: 17, color: "var(--text)" }}
            >
              Record payment
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--muted)" }}>
              {payFor.saleNumber} · Balance {fmt(Number(payFor.balanceAmount))}
            </p>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                cursor: payLoading ? "not-allowed" : "pointer",
                userSelect: "none",
                fontSize: 12,
                color: "var(--text)",
                lineHeight: 1.35,
                marginBottom: 12,
                opacity: payLoading ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={paySplitPayment}
                disabled={payLoading}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on) {
                    const received = parseMoneyField(payAmount);
                    const bal = Number(payFor.balanceAmount);
                    if (received != null && received > 0) {
                      if (payMethod === "cash") {
                        setPayCashStr(Math.min(received, bal).toFixed(2));
                        setPayOnlineStr("");
                      } else {
                        setPayCashStr("");
                        setPayOnlineStr(Math.min(received, bal).toFixed(2));
                      }
                    } else {
                      setPayCashStr("");
                      setPayOnlineStr("");
                    }
                  } else {
                    const cash = parseMoneyField(payCashStr) ?? 0;
                    const online = parseMoneyField(payOnlineStr) ?? 0;
                    const sum = Math.max(0, cash) + Math.max(0, online);
                    setPayAmount(
                      sum > 0
                        ? sum.toFixed(2)
                        : Number(payFor.balanceAmount).toFixed(2)
                    );
                  }
                  setPaySplitPayment(on);
                }}
                style={{
                  width: 16,
                  height: 16,
                  marginTop: 2,
                  cursor: payLoading ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              />
              <span>Split payment (cash + online banking)</span>
            </label>
            {paySplitPayment ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                  Enter only what is collected now. Any shortfall stays on the balance — it is
                  not assigned to the other method.
                </p>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--muted)",
                      marginBottom: 6,
                    }}
                  >
                    Cash (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={payCashStr}
                    onChange={(e) => setPayCashStr(e.target.value)}
                    placeholder="0"
                    disabled={payLoading}
                    style={{
                      ...inputStyle,
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--muted)",
                      marginBottom: 6,
                    }}
                  >
                    Online banking (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={payOnlineStr}
                    onChange={(e) => setPayOnlineStr(e.target.value)}
                    placeholder="0"
                    disabled={payLoading}
                    style={{
                      ...inputStyle,
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                {(() => {
                  const cash = parseMoneyField(payCashStr);
                  const online = parseMoneyField(payOnlineStr);
                  if (cash == null || online == null || cash < 0 || online < 0) {
                    return null;
                  }
                  const received =
                    Math.round((Math.max(0, cash) + Math.max(0, online)) * 100) / 100;
                  const maxBal = Number(payFor.balanceAmount);
                  const remaining = Math.max(0, maxBal - received);
                  return (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 13,
                          color: "var(--muted)",
                        }}
                      >
                        <span>Total received</span>
                        <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                          {fmt(received)}
                        </span>
                      </div>
                      {remaining >= 0.005 ? (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--accent)",
                            fontWeight: 600,
                          }}
                        >
                          Remaining balance: {fmt(remaining)}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : (
              <>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted)",
                    marginBottom: 6,
                  }}
                >
                  Amount
                </label>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    boxSizing: "border-box",
                    marginBottom: 12,
                  }}
                />
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted)",
                    marginBottom: 6,
                  }}
                >
                  Payment method
                </span>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {(
                    [
                      ["cash", "Cash"],
                      ["online_banking", "Online banking"],
                    ] as const
                  ).map(([value, label]) => {
                    const selected = payMethod === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={payLoading}
                        onClick={() => setPayMethod(value)}
                        style={{
                          flex: 1,
                          height: 36,
                          borderRadius: 8,
                          border: selected
                            ? "1px solid var(--accent)"
                            : "1px solid var(--border)",
                          background: selected ? "var(--accent)" : "var(--surface)",
                          color: selected ? "var(--surface)" : "var(--text)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: payLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const amt = parseMoneyField(payAmount);
                  if (amt == null || amt <= 0) return null;
                  const maxBal = Number(payFor.balanceAmount);
                  const remaining = Math.max(0, maxBal - amt);
                  if (remaining < 0.005) return null;
                  return (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--accent)",
                        fontWeight: 600,
                        marginBottom: 12,
                      }}
                    >
                      Remaining balance: {fmt(remaining)}
                    </div>
                  );
                })()}
              </>
            )}
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Note (optional)
            </label>
            <input
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="e.g. UPI ref"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 12 }}
            />
            {payMsg?.type === "err" ? (
              <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 12 }}>
                {payMsg.text}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={payLoading}
                onClick={() => setPayFor(null)}
                style={{
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: payLoading ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={payLoading}
                onClick={() => void submitPayment()}
                style={{
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: payLoading ? "not-allowed" : "pointer",
                }}
              >
                {payLoading ? "Saving…" : "Apply payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}