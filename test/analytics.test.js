import test from "node:test";
import assert from "node:assert/strict";
import { classifyVisit, clusterIntents } from "../src/classify.js";
import worker from "../src/index.js";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
// Minimal in-memory D1 stand-in.
function fakeDB() { const rows = []; const st = (sql) => ({ bind: (...a) => ({ sql, a }), all: async () => ({ results: [...rows].reverse() }), sql, a: [] });
  return { rows, prepare: st, batch: async (ss) => { for (const s of ss) if (/^INSERT/.test(s.sql)) { const [ts, path, ua, kind, agent, intent] = s.a; rows.push({ ts, path, ua, kind, agent, intent }); } } }; }
test("Chrome is human", () => assert.equal(classifyVisit({ ua: CHROME }).kind, "human"));
test("GPTBot is an AI training crawler", () => { const r = classifyVisit({ ua: "Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot" }); assert.equal(r.kind, "ai_agent"); assert.equal(r.intent, "training_crawl"); });
test("ChatGPT-User is a user-triggered fetch", () => assert.equal(classifyVisit({ ua: "Mozilla/5.0 (compatible; ChatGPT-User/1.0)" }).intent, "user_fetch"));
test("PerplexityBot is AI search", () => assert.equal(classifyVisit({ ua: "PerplexityBot/1.0" }).intent, "ai_search"));
test("curl and Googlebot are other bots", () => { assert.equal(classifyVisit({ ua: "curl/8.5.0" }).kind, "other_bot"); assert.equal(classifyVisit({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }).kind, "other_bot"); });
test("empty UA is a bot", () => assert.equal(classifyVisit({ ua: "" }).kind, "other_bot"));
test("clusters group AI visits by intent and section", () => { const c = clusterIntents([{ kind: "ai_agent", intent: "training_crawl", agent: "GPTBot", path: "/blog/a" }, { kind: "ai_agent", intent: "training_crawl", agent: "CCBot", path: "/blog/b" }, { kind: "human", path: "/" }]); assert.equal(c.length, 1); assert.equal(c[0].visits, 2); assert.deepEqual(c[0].agents.sort(), ["CCBot", "GPTBot"]); });
test("visits are logged to D1 and show up in stats", async () => { const DB = fakeDB(); const env = { DB };
  await worker.fetch(new Request("http://x/docs", { headers: { "user-agent": "ClaudeBot/1.0" } }), env);
  await worker.fetch(new Request("http://x/t", { headers: { "user-agent": CHROME } }), env);
  const s = await (await worker.fetch(new Request("http://x/api/stats"), env)).json();
  assert.equal(s.total, 2); assert.equal(s.by_kind.ai_agent, 1); assert.equal(s.clusters[0].section, "/docs"); });
test("pixel returns 204", async () => assert.equal((await worker.fetch(new Request("http://x/t"), { DB: fakeDB() })).status, 204));
test("classify API reads ?ua=", async () => assert.equal((await (await worker.fetch(new Request("http://x/api/classify?ua=GPTBot"), {})).json()).agent, "GPTBot"));
