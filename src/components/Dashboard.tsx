"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Decision { id: number; title: string; context: string; prediction: string; confidence: number; review_date: string; outcome: 0 | 1 | null; lessons: string; resolved_at: string | null }
interface Stats { total: number; open: number; dueForReview: number; resolved: number; hitRate: number | null; brier: number | null; overconfidence: number | null; calibration: { label: string; count: number; hits: number; avgConfidence: number | null; hitRate: number | null }[] }

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } }); }
  catch { throw new Error("네트워크 오류입니다. 연결을 확인하세요."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = "/login"; throw new Error("로그인이 필요합니다"); }
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다");
  return data as T;
}

export default function Dashboard({ email }: { email: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Decision[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"open" | "resolved" | "stats">("open");
  const [loadErr, setLoadErr] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api<Decision[]>("/api/decisions"), api<Stats>("/api/stats")]);
      setItems(d); setStats(s); setLoadErr("");
    } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  const open = items?.filter((d) => d.outcome === null) ?? [];
  const done = items?.filter((d) => d.outcome !== null) ?? [];

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">Hind<span>sight</span></div>
        <div className="row"><span className="mute" style={{ fontSize: ".85rem" }}>{email}</span><button className="btn ghost" onClick={logout}>로그아웃</button></div>
      </header>

      {stats && (
        <div className="grid">
          <div className="card stat"><b>{stats.open}</b><small>진행 중</small></div>
          <div className="card stat"><b style={{ color: stats.dueForReview ? "var(--accent)" : undefined }}>{stats.dueForReview}</b><small>검토 시점 도래</small></div>
          <div className="card stat"><b>{stats.hitRate === null ? "–" : `${stats.hitRate.toFixed(0)}%`}</b><small>적중률 ({stats.resolved}건)</small></div>
          <div className="card stat"><b>{stats.brier === null ? "–" : stats.brier.toFixed(3)}</b><small>Brier 점수 (낮을수록 좋음)</small></div>
        </div>
      )}

      <NewDecision onCreated={() => { notify("결정을 기록했습니다"); load(); }} />

      <div className="tabs" role="tablist">
        {(["open", "resolved", "stats"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`btn ${tab === t ? "" : "ghost"}`} onClick={() => setTab(t)}>
            {t === "open" ? `진행 중 (${open.length})` : t === "resolved" ? `결과 확인됨 (${done.length})` : "보정 분석"}
          </button>
        ))}
      </div>

      {loadErr && <div className="err" role="alert">{loadErr} <button className="btn ghost" onClick={load}>다시 시도</button></div>}
      {!items && !loadErr && <div className="empty">불러오는 중…</div>}

      {items && tab === "open" && (open.length ? open.map((d) => <Item key={d.id} d={d} onChange={load} notify={notify} />) :
        <div className="empty">진행 중인 결정이 없습니다. 위에서 첫 결정을 기록해 보세요.</div>)}
      {items && tab === "resolved" && (done.length ? done.map((d) => <Item key={d.id} d={d} onChange={load} notify={notify} />) :
        <div className="empty">아직 결과를 확인한 결정이 없습니다.</div>)}
      {items && tab === "stats" && stats && <Calibration stats={stats} />}

      {toast && <div role="status" className="card" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)" }}>{toast}</div>}
    </div>
  );
}

function NewDecision({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ title: "", context: "", prediction: "", confidence: 70, review_date: addDays(30) });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api("/api/decisions", { method: "POST", body: JSON.stringify(f) });
      setF({ title: "", context: "", prediction: "", confidence: 70, review_date: addDays(30) }); onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>새 결정 기록</h2>
      <label htmlFor="t">무엇을 결정했나요?</label>
      <input id="t" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 팀 이동 제안을 수락한다" />
      <label htmlFor="c">배경 / 이유 (선택)</label>
      <textarea id="c" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} />
      <label htmlFor="p">검증 가능한 예측</label>
      <input id="p" value={f.prediction} maxLength={1000} onChange={(e) => setF({ ...f, prediction: e.target.value })} placeholder="예: 6개월 안에 리드 역할을 맡게 된다" />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 220px" }}>
          <label htmlFor="conf">확신도: <b>{f.confidence}%</b></label>
          <input id="conf" type="range" min={1} max={99} value={f.confidence} onChange={(e) => setF({ ...f, confidence: Number(e.target.value) })} />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label htmlFor="rd">검토 날짜</label>
          <input id="rd" type="date" min={today()} value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} />
        </div>
        <button className="btn accent" disabled={busy}>{busy ? "저장 중…" : "기록하기"}</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}

function Item({ d, onChange, notify }: { d: Decision; onChange: () => void; notify: (m: string) => void }) {
  const [resolving, setResolving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lessons, setLessons] = useState(d.lessons);
  const [draft, setDraft] = useState({ title: d.title, prediction: d.prediction, context: d.context, confidence: d.confidence, review_date: d.review_date });
  const [err, setErr] = useState("");
  const due = d.outcome === null && d.review_date <= today();

  async function patch(body: object, msg: string) {
    setErr("");
    try { await api(`/api/decisions/${d.id}`, { method: "PATCH", body: JSON.stringify(body) }); notify(msg); setResolving(false); setEditing(false); onChange(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function remove() {
    if (!window.confirm("이 결정을 삭제할까요? 되돌릴 수 없습니다.")) return;
    try { await api(`/api/decisions/${d.id}`, { method: "DELETE" }); notify("삭제했습니다"); onChange(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <article className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{d.title}</h3>
        <div className="row">
          {due && <span className="tag due">검토할 때</span>}
          {d.outcome === 1 && <span className="tag hit">적중</span>}
          {d.outcome === 0 && <span className="tag miss">빗나감</span>}
          <span className="tag">확신 {d.confidence}%</span><span className="tag">검토 {d.review_date}</span>
        </div>
      </div>
      {editing ? (
        <div>
          <label>제목</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <label>예측</label><input value={draft.prediction} onChange={(e) => setDraft({ ...draft, prediction: e.target.value })} />
          <label>배경</label><textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} />
          <label>확신도 {draft.confidence}%</label><input type="range" min={1} max={99} value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: Number(e.target.value) })} />
          <label>검토 날짜</label><input type="date" value={draft.review_date} onChange={(e) => setDraft({ ...draft, review_date: e.target.value })} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => patch(draft, "수정했습니다")}>저장</button>
            <button className="btn ghost" onClick={() => setEditing(false)}>취소</button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: "8px 0 4px" }}><b>예측:</b> {d.prediction}</p>
          {d.context && <p className="mute" style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{d.context}</p>}
          {d.outcome !== null && d.lessons && <p style={{ margin: "4px 0" }}><b>배운 점:</b> {d.lessons}</p>}
        </>
      )}
      {resolving && (
        <div style={{ marginTop: 10 }}>
          <label htmlFor={`l${d.id}`}>배운 점 (선택)</label>
          <textarea id={`l${d.id}`} value={lessons} onChange={(e) => setLessons(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" style={{ background: "var(--ok)" }} onClick={() => patch({ outcome: 1, lessons }, "결과를 기록했습니다")}>예측이 맞았다</button>
            <button className="btn" style={{ background: "var(--bad)" }} onClick={() => patch({ outcome: 0, lessons }, "결과를 기록했습니다")}>빗나갔다</button>
            <button className="btn ghost" onClick={() => setResolving(false)}>취소</button>
          </div>
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {!editing && !resolving && (
        <div className="row" style={{ marginTop: 10 }}>
          {d.outcome === null ? <button className="btn accent" onClick={() => setResolving(true)}>결과 기록</button>
            : <button className="btn ghost" onClick={() => patch({ outcome: null }, "다시 진행 중으로 되돌렸습니다")}>진행 중으로 되돌리기</button>}
          <button className="btn ghost" onClick={() => setEditing(true)}>수정</button>
          <button className="btn danger" onClick={remove}>삭제</button>
        </div>
      )}
    </article>
  );
}

function Calibration({ stats }: { stats: Stats }) {
  if (!stats.resolved) return <div className="empty">결과를 확인한 결정이 생기면 보정 분석이 표시됩니다.</div>;
  const oc = stats.overconfidence;
  return (
    <div className="card">
      <h2>보정 분석</h2>
      <p>
        {oc === null ? "" : Math.abs(oc) < 5 ? "확신도와 실제 적중률이 잘 맞습니다." :
          oc > 0 ? `평균적으로 실제보다 ${oc.toFixed(0)}%p 과신하는 경향이 있습니다.` : `평균적으로 실제보다 ${Math.abs(oc).toFixed(0)}%p 보수적입니다.`}
      </p>
      <p className="mute" style={{ fontSize: ".85rem" }}>막대가 확신도 구간의 실제 적중률입니다. 이상적으로는 구간 평균 확신도와 같아야 합니다. 표본이 적은 구간은 참고용입니다.</p>
      {stats.calibration.map((b) => (
        <div className="cal" key={b.label}>
          <span>{b.label}</span>
          <div className="bar" title={b.count ? `적중 ${b.hits}/${b.count}` : "데이터 없음"}><i style={{ width: `${b.hitRate ?? 0}%` }} /></div>
          <span className="mute">{b.count ? `${b.hitRate!.toFixed(0)}% (${b.hits}/${b.count})` : "–"}</span>
        </div>
      ))}
    </div>
  );
}
