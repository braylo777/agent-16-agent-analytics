"""Hand-written visitor classifier: AI agent vs other bot vs human, from the user agent plus request heuristics. No model."""
import json, re
from pathlib import Path

AI_AGENTS = [tuple(x) for x in json.loads((Path(__file__).resolve().parents[2] / "data" / "ai_agents.json").read_text())]
_AI_LOWER = [(n.lower(), n, i) for n, i in AI_AGENTS]
BOT_RE = re.compile(r"bot\b|bot[/;-]|crawl|spider|slurp|scrap|fetch|archiver|indexer|monitor|checker|preview|curl/|wget|python-|python/|httpx|aiohttp|go-http|java/|okhttp|node-fetch|axios|libwww|scrapy|headless|phantom|lighthouse|feed|rss|validator|http_request|ruby|perl|php/|https?://|@|\.(com|org|net|io)\b", re.I | re.ASCII)
_MOZ = re.compile(r"mozilla/5\.0")


def classify_visit(ua="", headers=None):
    headers = headers or {}
    u = ("" if ua is None else str(ua)).lower()
    for low, name, intent in _AI_LOWER:
        if low in u:
            return {"kind": "ai_agent", "agent": name, "intent": intent, "reasons": ["ua:" + name]}
    reasons = []
    if not u:
        reasons.append("empty_ua")
    if BOT_RE.search(u):
        reasons.append("ua_bot_token")
    if not _MOZ.search(u) and u:
        reasons.append("non_browser_ua")
    if headers.get("accept-language") == "":
        reasons.append("no_accept_language")
    if "ua_bot_token" in reasons or "empty_ua" in reasons or len(reasons) >= 2:
        return {"kind": "other_bot", "agent": None, "intent": "other", "reasons": reasons}
    return {"kind": "human", "agent": None, "intent": None, "reasons": reasons}


def cluster_intents(rows):
    """Group AI-agent visits by (declared intent, path section) and rank clusters by volume."""
    m = {}
    for r in rows:
        if r.get("kind") == "ai_agent":
            parts = str(r.get("path") or "/").split("/")
            sec = "/" + (parts[1] if len(parts) > 1 else "")
            k = f"{r['intent']} {sec}"
            c = m.setdefault(k, {"intent": r["intent"], "section": sec, "visits": 0, "agents": []})
            c["visits"] += 1
            if r.get("agent") not in c["agents"]:
                c["agents"].append(r.get("agent"))
    return sorted(m.values(), key=lambda c: -c["visits"])


SCHEMA = "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, ts TEXT, path TEXT, ua TEXT, kind TEXT, agent TEXT, intent TEXT, country TEXT)"


def handle(db, method, path, query_ua=None, headers=None, country=None, now_iso=""):
    """Pure router: (status, json|None); status 0 = serve the page, 204 = pixel. `db` has recent() and log(...), or is None."""
    headers = headers or {}
    if path == "/api/classify":
        ua = query_ua if query_ua is not None else headers.get("user-agent", "")
        return 200, classify_visit(ua, headers)
    if path == "/api/stats":
        if db is None:
            return 503, {"error": "no D1 binding"}
        results = db.recent()
        by = lambda f: _count(results, f)
        return 200, {"total": len(results), "by_kind": by("kind"), "by_agent": by("agent"), "clusters": cluster_intents(results)}
    c = classify_visit(headers.get("user-agent", ""), headers)
    if db is not None:
        try:
            db.log(now_iso, path[:200], headers.get("user-agent", "")[:300], c["kind"], c["agent"], c["intent"], country)
        except Exception:
            pass
    if path == "/t":
        return 204, None
    return 0, None


def _count(rows, f):
    out = {}
    for r in rows:
        k = r.get(f)
        k = "-" if k is None else k
        out[k] = out.get(k, 0) + 1
    return out
