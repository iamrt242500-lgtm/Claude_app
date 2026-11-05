// HTTP smoke/integration test. Usage: BASE=http://localhost:3100 node scripts/smoke.mjs
const BASE = process.env.BASE || "http://localhost:3100";
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : " " + extra}`); if (!ok) failed++; };

class Client {
  cookie = "";
  async req(method, path, body) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(this.cookie && { Cookie: this.cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, loc: res.headers.get("location") };
  }
}
const run = Date.now();
const a = new Client(), b = new Client(), anon = new Client();

check("anon / redirects to /login", (await anon.req("GET", "/")).loc?.includes("/login"));
check("anon API 401", (await anon.req("GET", "/api/decisions")).status === 401);
check("register invalid email 400", (await anon.req("POST", "/api/auth/register", { email: "x", password: "password1" })).status === 400);
check("register short pw 400", (await anon.req("POST", "/api/auth/register", { email: `s${run}@t.com`, password: "short" })).status === 400);
check("register A 201", (await a.req("POST", "/api/auth/register", { email: `a${run}@t.com`, password: "password1" })).status === 201);
check("duplicate register 409", (await anon.req("POST", "/api/auth/register", { email: `a${run}@t.com`, password: "password1" })).status === 409);
check("register B 201", (await b.req("POST", "/api/auth/register", { email: `b${run}@t.com`, password: "password1" })).status === 201);
check("bad login 401", (await anon.req("POST", "/api/auth/login", { email: `a${run}@t.com`, password: "nope" })).status === 401);

check("invalid decision 400", (await a.req("POST", "/api/decisions", { title: "", prediction: "x", confidence: 50, review_date: "2030-01-01" })).status === 400);
check("confidence 100 rejected", (await a.req("POST", "/api/decisions", { title: "t", prediction: "x", confidence: 100, review_date: "2030-01-01" })).status === 400);
const c = await a.req("POST", "/api/decisions", { title: "팀 이동", prediction: "리드가 된다", confidence: 80, review_date: "2020-01-01", context: "ctx" });
check("create 201", c.status === 201 && c.data.id > 0);
const id = c.data.id;
check("list has 1", (await a.req("GET", "/api/decisions")).data.length === 1);
check("stats dueForReview 1", (await a.req("GET", "/api/stats")).data.dueForReview === 1);
check("edit", (await a.req("PATCH", `/api/decisions/${id}`, { title: "팀 이동 v2" })).data.title === "팀 이동 v2");
const r = await a.req("PATCH", `/api/decisions/${id}`, { outcome: 0, lessons: "과신" });
check("resolve", r.data.outcome === 0 && r.data.resolved_at);
const s = (await a.req("GET", "/api/stats")).data;
check("brier 0.64", Math.abs(s.brier - 0.64) < 1e-9 && s.hitRate === 0 && s.resolved === 1, JSON.stringify(s));
check("user B cannot read", (await b.req("GET", `/api/decisions/${id}`)).status === 404);
check("user B cannot patch", (await b.req("PATCH", `/api/decisions/${id}`, { title: "x" })).status === 404);
check("user B cannot delete", (await b.req("DELETE", `/api/decisions/${id}`)).status === 404);
check("user B list empty", (await b.req("GET", "/api/decisions")).data.length === 0);
check("bad id 400/404", [400, 404].includes((await a.req("GET", "/api/decisions/abc")).status));
check("persisted across re-login", await (async () => { const a2 = new Client(); await a2.req("POST", "/api/auth/login", { email: `a${run}@t.com`, password: "password1" }); return (await a2.req("GET", "/api/decisions")).data.length === 1; })());
check("delete", (await a.req("DELETE", `/api/decisions/${id}`)).status === 200);
check("logout invalidates", await (async () => { const t = a.cookie; await a.req("POST", "/api/auth/logout"); const x = new Client(); x.cookie = t; return (await x.req("GET", "/api/decisions")).status === 401; })());
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
