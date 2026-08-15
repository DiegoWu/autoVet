"use client";

import {useState} from "react";
import {LockKeyhole, LogIn} from "lucide-react";
import {useLocale} from "next-intl";
import {Link} from "@/i18n/navigation";

export function LoginForm() {
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const zh = locale === "zh-TW";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({email, password}),
    });
    setBusy(false);
    if (!response.ok) {
      setError(zh ? "登入失敗，請確認帳號與密碼。" : "Sign-in failed. Check your credentials.");
      return;
    }
    window.location.assign(locale === "en" ? "/en" : "/zh-TW");
  }

  return (
    <form onSubmit={submit} className="rule-card" style={{maxWidth: 420, margin: "0 auto", padding: 28}}>
      <div className="brand-mark" style={{marginBottom: 18}}><LockKeyhole size={20} /></div>
      <h2>{zh ? "登入" : "Sign in"}</h2>
      <p className="hint" style={{marginBottom: 22}}>{zh ? "使用診所帳號繼續。" : "Continue with your clinic account."}</p>
      <div className="field" style={{marginBottom: 14}}>
        <label htmlFor="email">{zh ? "電子郵件" : "Email"}</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field" style={{marginBottom: 18}}>
        <label htmlFor="password">{zh ? "密碼" : "Password"}</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error && <div className="notice" role="alert" style={{marginBottom: 14}}>{error}</div>}
      <button className="button primary" disabled={busy} style={{width: "100%"}}><LogIn size={16} />{busy ? (zh ? "登入中…" : "Signing in…") : (zh ? "登入" : "Sign in")}</button>
      <p className="hint" style={{marginTop: 18, textAlign: "center"}}>
        {zh ? "還沒有帳號？" : "New to autoVet?"}{" "}
        <Link href="/signup">{zh ? "建立診所帳號" : "Create a clinic account"}</Link>
      </p>
    </form>
  );
}
