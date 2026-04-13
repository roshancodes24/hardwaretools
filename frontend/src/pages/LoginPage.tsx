import { useState } from "react";
import { api, setActingUserId, setAuthToken } from "../api/client";
import { isApiError } from "../api/errors";

type LoginPageProps = {
  onLoggedIn: () => void;
};

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBannerError(null);
    const u = username.trim();
    if (!u) {
      setFormError("Username is required.");
      return;
    }
    if (!password) {
      setFormError("Password is required.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.login({ username: u, password });
      setAuthToken(res.token);
      setActingUserId(res.user.id);
      onLoggedIn();
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setBannerError("Invalid credentials");
      } else if (isApiError(err) && err.status === 422 && err.details?.length) {
        setBannerError(
          err.details.map((d) => `${d.field}: ${d.message}`).join(" · ")
        );
      } else {
        setBannerError(
          isApiError(err) ? err.message : "Could not sign in. Try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 42,
    padding: "0 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    fontSize: 14,
    outline: "none",
    background: "var(--surface)",
    color: "var(--text)",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "28px 26px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.06)",
        }}
      >
        <h1
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          Raj Hardware, Electrical and Paint
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "var(--muted)" }}>
          Sign in to continue
        </p>

        {bannerError ? (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(220,38,38,0.08)",
              border: "1px solid rgba(220,38,38,0.25)",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            {bannerError}
          </div>
        ) : null}

        <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label
              htmlFor="login-username"
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}
            >
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              style={inputStyle}
              placeholder="e.g. admin"
            />
          </div>
          <div>
            <label
              htmlFor="login-password"
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={inputStyle}
            />
          </div>
          {formError ? (
            <div style={{ fontSize: 12, color: "#b91c1c" }}>{formError}</div>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 6,
              height: 44,
              borderRadius: 10,
              border: "none",
              background: loading ? "var(--border)" : "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    border: "2px solid rgba(255,255,255,0.35)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "login-spin 0.7s linear infinite",
                  }}
                />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
        <style>{`@keyframes login-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
