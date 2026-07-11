"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import "../globals.css";

export default function LoginPage() {
  const [token,setToken] = useState(""); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  useEffect(() => { void fetch("/api/x/status").then(async (response) => { if (response.ok) { const status = await response.json() as {accessProtected?:boolean}; if (!status.accessProtected) window.location.href = "/"; } }); }, []);
  const submit = async (event:FormEvent) => { event.preventDefault(); setBusy(true); setError(""); const response = await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})}); setBusy(false); if (response.ok) window.location.href="/"; else setError("Invalid access token."); };
  return <main className="login-page"><section><div className="step-icon"><LockKeyhole size={22}/></div><span className="eyebrow">PRIVATE INSTANCE</span><h1>Unlock OpenX Growth</h1><p>Enter the access token configured by the owner of this deployment.</p><form onSubmit={submit}><label>Access token<input type="password" value={token} onChange={(event)=>setToken(event.target.value)} autoComplete="current-password" required/></label>{error && <div className="inline-error">{error}</div>}<button className="primary-btn" disabled={busy}>{busy ? "Checking…" : <>Continue <ArrowRight size={15}/></>}</button></form><p className="login-privacy">By continuing, you acknowledge this instance&apos;s <a href="/privacy">privacy notice</a>. No credentials are sent to the project maintainers.</p></section></main>;
}
