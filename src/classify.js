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
