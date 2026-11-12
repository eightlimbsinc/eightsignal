"use client";

/** Last-resort error UI (errors in the root/app layouts). Shows the digest to match server logs. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0b0d12", color: "#e6e9ef", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <title>Error · EightSignal</title>
        <main style={{ maxWidth: 480, margin: "15vh auto", padding: 24, border: "1px solid #3b1d24", borderRadius: 8 }}>
          <h1 style={{ fontSize: 16, margin: 0 }}>EightSignal hit a server error</h1>
          <p style={{ fontSize: 13, color: "#8b95a7" }}>
            Reference: <code style={{ color: "#e6e9ef" }}>{error.digest ?? "none"}</code>
            <br />
            Search this reference in Netlify → Logs → Functions to see the cause.
          </p>
          <button onClick={reset} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, border: "1px solid #232c3c", background: "#172030", color: "#e6e9ef", cursor: "pointer" }}>
            Try again
          </button>
          <a href="/login" style={{ marginLeft: 12, fontSize: 13, color: "#3b82f6" }}>Back to sign in</a>
        </main>
      </body>
    </html>
  );
}
