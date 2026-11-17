import pytest
from agent16.classify import classify_visit, cluster_intents, handle

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"


class DB:
    def __init__(self): self.rows = []
    def log(self, ts, path, ua, kind, agent, intent, country): self.rows.append({"ts": ts, "path": path, "ua": ua, "kind": kind, "agent": agent, "intent": intent})
    def recent(self): return list(reversed(self.rows))


def test_classes():
    assert classify_visit(CHROME)["kind"] == "human"
    r = classify_visit("Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot")
    assert r["kind"] == "ai_agent" and r["intent"] == "training_crawl"
    assert classify_visit("Mozilla/5.0 (compatible; ChatGPT-User/1.0)")["intent"] == "user_fetch"
    assert classify_visit("PerplexityBot/1.0")["intent"] == "ai_search"
    assert classify_visit("curl/8.5.0")["kind"] == "other_bot"
    assert classify_visit("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")["kind"] == "other_bot"
    assert classify_visit("")["kind"] == "other_bot"


def test_edges():
    assert classify_visit("mozilla/5.0 (compatible; gptbot/1.2)")["kind"] == "ai_agent"
    assert classify_visit("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")["kind"] == "ai_agent"
    classify_visit(None)
    cluster_intents([])


def test_clusters():
    c = cluster_intents([{"kind": "ai_agent", "intent": "training_crawl", "agent": "GPTBot", "path": "/blog/a"}, {"kind": "ai_agent", "intent": "training_crawl", "agent": "CCBot", "path": "/blog/b"}, {"kind": "human", "path": "/"}])
    assert len(c) == 1 and c[0]["visits"] == 2 and sorted(c[0]["agents"]) == ["CCBot", "GPTBot"]


def test_http_logging_stats_pixel_classify():
    db = DB()
    handle(db, "GET", "/docs", headers={"user-agent": "ClaudeBot/1.0"})
    assert handle(db, "GET", "/t", headers={"user-agent": CHROME})[0] == 204
    s = handle(db, "GET", "/api/stats")[1]
    assert s["total"] == 2 and s["by_kind"]["ai_agent"] == 1 and s["clusters"][0]["section"] == "/docs"
    assert handle(None, "GET", "/api/classify", query_ua="GPTBot")[1]["agent"] == "GPTBot"
    assert handle(None, "GET", "/api/stats")[0] == 503 and handle(None, "GET", "/")[0] == 0
