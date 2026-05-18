import { useState } from "react";

const CORRECT    = import.meta.env.VITE_APP_PASSWORD;
const SESSION_KEY = "wf_auth";

export function LoginGate({ children }) {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "1"
  );
  const [pw,  setPw]  = useState("");
  const [err, setErr] = useState(false);

  if (authed) return children;

  const submit = (e) => {
    e.preventDefault();
    if (pw === CORRECT) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setAuthed(true);
    } else {
      setErr(true);
      setPw("");
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f1f5f9", fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif",
    }}>
      <div style={{
        background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10,
        padding: "40px 36px", width: 340, boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}>
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", letterSpacing: 0.2 }}>
            Miami-Dade Waterfront
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, letterSpacing: 0.3 }}>
            Asset Intelligence · Restricted Access
          </div>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6, letterSpacing: 0.3 }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setErr(false); }}
              autoFocus
              placeholder="Enter password"
              style={{
                width: "100%", boxSizing: "border-box", padding: "10px 12px",
                border: `1px solid ${err ? "#fca5a5" : "#cbd5e1"}`,
                borderRadius: 6, fontSize: 13, outline: "none",
                background: err ? "#fff5f5" : "#fff", color: "#0f172a",
                fontFamily: "inherit", transition: "border-color .15s",
              }}
            />
            {err && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 6 }}>
                Incorrect password. Please try again.
              </div>
            )}
          </div>

          <button type="submit" style={{
            width: "100%", padding: "10px", background: "#0f172a",
            color: "#ffffff", border: "none", borderRadius: 6,
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            letterSpacing: 0.3, transition: "background .15s",
          }}
            onMouseEnter={e => e.target.style.background = "#1e293b"}
            onMouseLeave={e => e.target.style.background = "#0f172a"}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
