# agent-16 · Agent Analytics

**Live demo:** https://agent-16-agent-analytics.braylo777.workers.dev (dashboard) · `/t` tracking pixel · `/api/stats` · `/api/classify?ua=...`

## What
Shows which AI agents visit your site and why. Every request is logged to **Cloudflare D1** and classified as `human`, `ai_agent` (GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User, and more) or `other_bot`. AI visits are clustered by intent (training crawl, AI search, user-triggered fetch) and site section. The results are served as a live dashboard.

## Why
More and more traffic comes from AI agents, and GA-style analytics hide it. Site owners need to know who is training on their content, who is citing it in answers, and who is fetching it on a user's behalf.

## How it was built
- `src/classify.js`: a hand-written list of 36 AI agent tokens, each tagged with its intent, plus bot heuristics (bot, crawler and HTTP-library tokens, contact URLs or emails in the UA, non-browser UA, empty UA). No model.
- `src/index.js`: logs each visit (ts, path, UA, kind, agent, intent, country) to D1 and serves `/api/stats` and its clusters.
- Tests use an in-memory D1 stand-in.

## Results. Real, from `evals/results.json` (`npm run eval`)
The labeled logs come from 4,123 UAs, each labeled by its source rather than by this classifier:
- human: 2,000 real browser UAs from intoli/user-agents
- ai_agent: crawler-user-agents instances whose pattern names an agent in ai-robots-txt
- other_bot: all other crawler-user-agents instances

| | accuracy |
|---|---|
| 3-class | **0.886** |
| human vs bot | **0.923** |

Confusion matrix (rows are the true labels, columns are the predictions):
| true \ pred | human | ai_agent | other_bot |
|---|---|---|---|
| human | 2000 | 0 | 0 |
| ai_agent | 9 | 57 | 147 |
| other_bot | 310 | 2 | 1598 |

| class | precision | recall | F1 |
|---|---|---|---|
| human | 0.862 | 1.000 | 0.926 |
| ai_agent | 0.966 | 0.268 | 0.419 |
| other_bot | 0.916 | 0.837 | 0.874 |

Honest read:
- AI-agent recall is low (0.27) because ai.robots.txt lists about 200 agents and the hand list covers 36. Most misses land in `other_bot`, so they're still flagged as bots.
- 310 bots that use browser-like UAs pass as human. Fixing that needs request-level signals such as JS execution or TLS, which a UA-only eval can't measure.
- One heuristic round (contact URL or email in the UA) was added after the first eval run, which scored 0.787 3-class.

## How it ships
`npm test` (10 tests), then `npm run eval`, then `npm run build`, then deploy with a D1 binding `DB`. Free tier: Workers, D1 and no AI binding. Rollback tag: `v0-rollback`.
