// Labeled-log eval. Labels come from independent public sources, not from our classifier:
//  human    = 2,000 real browser UAs sampled from intoli/user-agents
//  ai_agent = crawler-user-agents instances whose pattern names an agent listed in ai-robots-txt/ai.robots.txt
//  other_bot= all other crawler-user-agents instances
import fs from "node:fs";
import { classifyVisit } from "../src/classify.js";
const rd = (f) => JSON.parse(fs.readFileSync(new URL("./data/" + f, import.meta.url), "utf8"));
const ai = Object.keys(rd("airobots.json")).map((s) => s.toLowerCase());
const rows = [];
for (const c of rd("crawlers.json")) { const pat = c.pattern.toLowerCase().replace(/\\/g, ""); const isAI = ai.some((a) => pat.includes(a) || a.includes(pat)); for (const ua of c.instances || []) rows.push({ ua, y: isAI ? "ai_agent" : "other_bot" }); }
const H = rd("ua.json"); let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
H.map((h) => [rnd(), h.userAgent]).sort((a, b) => a[0] - b[0]).slice(0, 2000).forEach(([, ua]) => rows.push({ ua, y: "human" }));
const K = ["human", "ai_agent", "other_bot"], cm = Object.fromEntries(K.map((a) => [a, Object.fromEntries(K.map((b) => [b, 0]))]));
let ok = 0; for (const r of rows) { const p = classifyVisit({ ua: r.ua }).kind; cm[r.y][p]++; if (p === r.y) ok++; }
const per = Object.fromEntries(K.map((k) => { const tp = cm[k][k], fp = K.reduce((a, j) => a + (j !== k ? cm[j][k] : 0), 0), fn = K.reduce((a, j) => a + (j !== k ? cm[k][j] : 0), 0); const P = tp / (tp + fp || 1), R = tp / (tp + fn || 1); return [k, { support: tp + fn, precision: P, recall: R, f1: (2 * P * R) / (P + R || 1) }]; }));
const hb = rows.filter((r) => (r.y === "human") === (classifyVisit({ ua: r.ua }).kind === "human")).length;
const res = { n: rows.length, accuracy_3class: ok / rows.length, accuracy_human_vs_bot: hb / rows.length, confusion_matrix_rows_true_cols_pred: cm, per_class: per, sources: ["intoli/user-agents", "monperrus/crawler-user-agents", "ai-robots-txt/ai.robots.txt"], caveat: "AI label is derived from ai.robots.txt names; our hand list overlaps that list by design, so AI recall measures coverage of known agents, not generalisation.", run_at: new Date().toISOString() };
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ n: res.n, acc3: res.accuracy_3class, accHB: res.accuracy_human_vs_bot, cm, per }));
