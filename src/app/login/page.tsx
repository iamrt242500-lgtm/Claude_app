"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "요청에 실패했습니다"); return; }
      router.push("/"); router.refresh();
    } catch { setError("네트워크 오류입니다. 잠시 후 다시 시도하세요."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth">
      <div className="brand" style={{ marginBottom: 6 }}>Hind<span>sight</span></div>
      <p className="mute">결정할 때 예측을 적고, 나중에 맞았는지 확인해 판단력을 보정하세요.</p>
      <form className="card" onSubmit={submit} noValidate>
        <h2>{mode === "login" ? "로그인" : "회원가입"}</h2>
        <label htmlFor="email">이메일</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="pw">비밀번호 {mode === "register" && "(8자 이상)"}</label>
        <input id="pw" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row between" style={{ marginTop: 14 }}>
          <button className="btn accent" disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}</button>
          <button type="button" className="btn ghost" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "계정 만들기" : "로그인으로"}
          </button>
        </div>
      </form>
    </main>
  );
}
