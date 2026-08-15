"use client";

import {useState} from "react";
import {Building2, UserPlus} from "lucide-react";
import {useLocale} from "next-intl";
import {Link} from "@/i18n/navigation";

export function SignupForm() {
  const locale = useLocale();
  const [clinicName, setClinicName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const zh = locale === "zh-TW";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({clinicName, name, email, password}),
    });
    setBusy(false);
    if (response.status === 409) {
      setError(zh ? "這個電子郵件已經註冊過了。" : "An account with this email already exists.");
      return;
    }
    if (!response.ok) {
      setError(zh ? "無法建立帳號，請稍後再試。" : "Could not create the account. Try again.");
      return;
    }
    window.location.assign(locale === "en" ? "/en" : "/zh-TW");
  }

  return (
    <form onSubmit={submit} className="rule-card" style={{maxWidth: 420, margin: "0 auto", padding: 28}}>
      <div className="brand-mark" style={{marginBottom: 18}}><Building2 size={20} /></div>
      <h2>{zh ? "建立診所帳號" : "Create a clinic account"}</h2>
      <p className="hint" style={{marginBottom: 22}}>{zh ? "註冊後即可開始排班，帳號僅屬於這間診所。" : "Sign up to start scheduling. Your account belongs to one clinic."}</p>
      <div className="field" style={{marginBottom: 14}}>
        <label htmlFor="clinicName">{zh ? "診所名稱" : "Clinic name"}</label>
        <input id="clinicName" type="text" autoComplete="organization" required maxLength={200} value={clinicName} onChange={(event) => setClinicName(event.target.value)} />
      </div>
      <div className="field" style={{marginBottom: 14}}>
        <label htmlFor="name">{zh ? "負責人姓名" : "Your name"}</label>
        <input id="name" type="text" autoComplete="name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field" style={{marginBottom: 14}}>
        <label htmlFor="email">{zh ? "電子郵件" : "Email"}</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field" style={{marginBottom: 18}}>
        <label htmlFor="password">{zh ? "密碼" : "Password"}</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {error && <div className="notice" role="alert" style={{marginBottom: 14}}>{error}</div>}
      <button className="button primary" disabled={busy} style={{width: "100%"}}><UserPlus size={16} />{busy ? (zh ? "建立中…" : "Creating…") : (zh ? "建立帳號" : "Create account")}</button>
      <p className="hint" style={{marginTop: 18, textAlign: "center"}}>
        {zh ? "已經有帳號？" : "Already have an account?"}{" "}
        <Link href="/login">{zh ? "登入" : "Sign in"}</Link>
      </p>
    </form>
  );
}
