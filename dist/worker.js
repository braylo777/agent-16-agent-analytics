// Shared helpers: Workers AI (free tier), rate limiting, JSON responses.
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const EMBED = "@cf/baai/bge-base-en-v1.5";
export const json = (o, status = 200) => Response.json(o, { status });
export const text = (r) => (typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r));
export async function chat(env, messages, opts = {}) {
  return env.AI.run(opts.model || MODEL, { messages, max_tokens: opts.max_tokens || 400, ...(opts.tools ? { tools: opts.tools } : {}) });
}
export async function ask(env, system, user, opts) { return text(await chat(env, [{ role: "system", content: system }, { role: "user", content: user }], opts)); }
export function parseJSON(s, fallback = null) {
  const m = String(s).match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
}
// Free-tier guard: per-IP limit via the Workers Rate Limiting binding.
export async function limited(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  return env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: ip })).success;
}
export async function body(req) { return req.json().catch(() => ({})); }
export function cap(s, n = 500) { return typeof s === "string" && s.trim() && s.length <= n; }

// Hand-written visitor classifier: AI agent vs other bot vs human, from the user agent plus request heuristics. No model.
export const AI_AGENTS = [
  ["GPTBot", "training_crawl"], ["ChatGPT-User", "user_fetch"], ["OAI-SearchBot", "ai_search"], ["ClaudeBot", "training_crawl"], ["Claude-User", "user_fetch"], ["Claude-SearchBot", "ai_search"], ["claude-web", "training_crawl"], ["anthropic-ai", "training_crawl"],
  ["PerplexityBot", "ai_search"], ["Perplexity-User", "user_fetch"], ["Google-Extended", "training_crawl"], ["Google-CloudVertexBot", "training_crawl"], ["Applebot-Extended", "training_crawl"], ["CCBot", "training_crawl"], ["Bytespider", "training_crawl"],
  ["Amazonbot", "ai_search"], ["meta-externalagent", "training_crawl"], ["meta-externalfetcher", "user_fetch"], ["FacebookBot", "training_crawl"], ["cohere-ai", "training_crawl"], ["cohere-training-data-crawler", "training_crawl"], ["Diffbot", "training_crawl"],
  ["YouBot", "ai_search"], ["DuckAssistBot", "ai_search"], ["MistralAI-User", "user_fetch"], ["Timpibot", "training_crawl"], ["ImagesiftBot", "training_crawl"], ["omgili", "training_crawl"], ["PetalBot", "ai_search"], ["AI2Bot", "training_crawl"], ["Kangaroo Bot", "training_crawl"], ["iaskspider", "ai_search"], ["PanguBot", "training_crawl"], ["Webzio-Extended", "training_crawl"], ["xAI", "user_fetch"], ["GrokBot", "user_fetch"],
];
const BOT_RE = /bot\b|bot[\/;-]|crawl|spider|slurp|scrap|fetch|archiver|indexer|monitor|checker|preview|curl\/|wget|python-|python\/|httpx|aiohttp|go-http|java\/|okhttp|node-fetch|axios|libwww|scrapy|headless|phantom|lighthouse|feed|rss|validator|http_request|ruby|perl|php\/|https?:\/\/|@|\.(com|org|net|io)\b/i;
export function classifyVisit({ ua = "", headers = {} } = {}) {
  const u = String(ua).toLowerCase();
  for (const [name, intent] of AI_AGENTS) if (u.includes(name.toLowerCase())) return { kind: "ai_agent", agent: name, intent, reasons: ["ua:" + name] };
  const reasons = [];
  if (!u) reasons.push("empty_ua");
  if (BOT_RE.test(u)) reasons.push("ua_bot_token");
  if (!/mozilla\/5\.0/.test(u) && u) reasons.push("non_browser_ua");
  if (headers["accept-language"] === "" ) reasons.push("no_accept_language");
  if (reasons.includes("ua_bot_token") || reasons.includes("empty_ua") || (reasons.length >= 2)) return { kind: "other_bot", agent: null, intent: "other", reasons };
  return { kind: "human", agent: null, intent: null, reasons };
}
// Intent clustering: group AI-agent visits by (declared intent, path section) and rank clusters by volume.
export function clusterIntents(rows) {
  const m = new Map();
  for (const r of rows) if (r.kind === "ai_agent") { const sec = "/" + (String(r.path || "/").split("/")[1] || ""); const k = r.intent + " " + sec; const c = m.get(k) || { intent: r.intent, section: sec, visits: 0, agents: new Set() }; c.visits++; c.agents.add(r.agent); m.set(k, c); }
  return [...m.values()].map((c) => ({ ...c, agents: [...c.agents] })).sort((a, b) => b.visits - a.visits);
}

const page = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Agent Analytics</title>\n<style>body{font-family:system-ui;max-width:820px;margin:40px auto;padding:0 16px;background:#0e1116;color:#e6e6e6}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #333;padding:6px;text-align:left}.card{background:#161b22;padding:14px;border-radius:8px;margin:12px 0}input{width:75%;padding:8px;background:#0e1116;color:#eee;border:1px solid #333;border-radius:6px}button{padding:8px 12px;border:0;border-radius:6px;background:#c9a227}</style></head>\n<body><h1>Agent Analytics</h1><p>Which AI agents visit this site, and why. Every visit to this page is logged to D1 and classified as human, AI agent or other bot.</p>\n<div class=\"card\"><b>Your visit:</b> <span id=\"me\"></span></div>\n<div class=\"card\"><b>Try a user agent</b><br><input id=\"ua\" value=\"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)\"> <button onclick=\"tr()\">Classify</button><pre id=\"tro\"></pre></div>\n<div class=\"card\"><b>Traffic</b><div id=\"k\"></div><h3>AI agent intent clusters</h3><table id=\"c\"></table></div>\n<script>\nfetch('/api/classify').then(r=>r.json()).then(j=>me.textContent=j.kind+(j.agent?' ('+j.agent+')':''));\nasync function tr(){tro.textContent=JSON.stringify(await (await fetch('/api/classify?ua='+encodeURIComponent(ua.value))).json(),null,2)}\nfetch('/api/stats').then(r=>r.json()).then(s=>{k.textContent='Total '+s.total+' · '+Object.entries(s.by_kind||{}).map(e=>e.join(': ')).join(' · ');c.innerHTML='<tr><th>Intent</th><th>Section</th><th>Visits</th><th>Agents</th></tr>'+(s.clusters||[]).map(x=>`<tr><td>${x.intent}</td><td>${x.section}</td><td>${x.visits}</td><td>${x.agents.join(', ')}</td></tr>`).join('')});\n</script></body></html>\n";
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
