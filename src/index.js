import { json } from "./core.js";
import { classifyVisit, clusterIntents } from "./classify.js";
import page from "./page.html";
const SCHEMA = "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, ts TEXT, path TEXT, ua TEXT, kind TEXT, agent TEXT, intent TEXT, country TEXT)";
export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    const headers = Object.fromEntries(req.headers);
    if (p === "/api/classify") return json(classifyVisit({ ua: url.searchParams.get("ua") ?? headers["user-agent"] ?? "", headers }));
    if (p === "/api/stats") {
      if (!env.DB) return json({ error: "no D1 binding" }, 503);
      const { results } = await env.DB.prepare("SELECT path, kind, agent, intent FROM visits ORDER BY id DESC LIMIT 5000").all();
      const by = (f) => results.reduce((a, r) => ((a[r[f] ?? "-"] = (a[r[f] ?? "-"] || 0) + 1), a), {});
      return json({ total: results.length, by_kind: by("kind"), by_agent: by("agent"), clusters: clusterIntents(results) });
    }
    // Every other request is a tracked visit (the demo site itself + /t pixel for other sites).
    const c = classifyVisit({ ua: headers["user-agent"] || "", headers });
    if (env.DB) { const w = env.DB.batch([env.DB.prepare(SCHEMA), env.DB.prepare("INSERT INTO visits (ts,path,ua,kind,agent,intent,country) VALUES (?,?,?,?,?,?,?)").bind(new Date().toISOString(), p.slice(0, 200), (headers["user-agent"] || "").slice(0, 300), c.kind, c.agent, c.intent, req.cf?.country || null)]); try { await w; } catch {} }
    if (p === "/t") return new Response(null, { status: 204 });
    return new Response(page, { headers: { "content-type": "text/html;charset=utf-8" } });
  },
};
