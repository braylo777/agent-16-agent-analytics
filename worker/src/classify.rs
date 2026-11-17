//! Hand-written visitor classifier: AI agent vs other bot vs human, from the user agent plus request heuristics. No model.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, ts TEXT, path TEXT, ua TEXT, kind TEXT, agent TEXT, intent TEXT, country TEXT)";

pub fn ai_agents() -> &'static Vec<(String, String)> {
    static A: OnceLock<Vec<(String, String)>> = OnceLock::new();
    A.get_or_init(|| serde_json::from_str::<Vec<(String, String)>>(include_str!("../data/ai_agents.json")).unwrap())
}

fn bot_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)bot(?-u:\b)|bot[/;-]|crawl|spider|slurp|scrap|fetch|archiver|indexer|monitor|checker|preview|curl/|wget|python-|python/|httpx|aiohttp|go-http|java/|okhttp|node-fetch|axios|libwww|scrapy|headless|phantom|lighthouse|feed|rss|validator|http_request|ruby|perl|php/|https?://|@|\.(com|org|net|io)(?-u:\b)").unwrap())
}

/// `accept_language`: Some("") only when the header is present and empty.
pub fn classify_visit(ua: &str, accept_language: Option<&str>) -> Value {
    let u = ua.to_lowercase();
    for (name, intent) in ai_agents() {
        if u.contains(&name.to_lowercase()) {
            return json!({"kind": "ai_agent", "agent": name, "intent": intent, "reasons": [format!("ua:{name}")]});
        }
    }
    let mut reasons: Vec<&str> = vec![];
    if u.is_empty() { reasons.push("empty_ua"); }
    if bot_re().is_match(&u) { reasons.push("ua_bot_token"); }
    if !u.contains("mozilla/5.0") && !u.is_empty() { reasons.push("non_browser_ua"); }
    if accept_language == Some("") { reasons.push("no_accept_language"); }
    if reasons.contains(&"ua_bot_token") || reasons.contains(&"empty_ua") || reasons.len() >= 2 {
        return json!({"kind": "other_bot", "agent": null, "intent": "other", "reasons": reasons});
    }
    json!({"kind": "human", "agent": null, "intent": null, "reasons": reasons})
}

/// Group AI-agent visits by (declared intent, path section) and rank clusters by volume.
pub fn cluster_intents(rows: &[Value]) -> Vec<Value> {
    let mut order: Vec<String> = vec![];
    let mut m: HashMap<String, (String, String, i64, Vec<Value>)> = HashMap::new();
    for r in rows.iter().filter(|r| r["kind"] == "ai_agent") {
        let path = r["path"].as_str().filter(|p| !p.is_empty()).unwrap_or("/");
        let sec = format!("/{}", path.split('/').nth(1).unwrap_or(""));
        let intent = r["intent"].as_str().unwrap_or("").to_string();
        let k = format!("{intent} {sec}");
        if !m.contains_key(&k) {
            order.push(k.clone());
        }
        let c = m.entry(k).or_insert((intent, sec, 0, vec![]));
        c.2 += 1;
        if !c.3.contains(&r["agent"]) {
            c.3.push(r["agent"].clone());
        }
    }
    let mut v: Vec<Value> = order.iter().map(|k| { let c = &m[k]; json!({"intent": c.0, "section": c.1, "visits": c.2, "agents": c.3}) }).collect();
    v.sort_by(|a, b| b["visits"].as_i64().cmp(&a["visits"].as_i64())); // stable
    v
}

/// D1 (or a test stand-in).
#[allow(async_fn_in_trait)]
pub trait Db {
    async fn recent(&self) -> Vec<Value>;
    async fn log(&self, ts: &str, path: &str, ua: &str, kind: &str, agent: Option<&str>, intent: Option<&str>, country: Option<&str>) -> Result<(), String>;
}

fn count(rows: &[Value], f: &str) -> Value {
    let mut order: Vec<String> = vec![];
    let mut m: HashMap<String, i64> = HashMap::new();
    for r in rows {
        let k = r[f].as_str().unwrap_or("-").to_string();
        if !m.contains_key(&k) { order.push(k.clone()); }
        *m.entry(k).or_insert(0) += 1;
    }
    Value::Object(order.into_iter().map(|k| { let n = m[&k]; (k, json!(n)) }).collect::<Map<_, _>>())
}

/// Pure router: (status, json); status 0 = serve the page, 204 = pixel.
pub async fn handle<D: Db>(db: Option<&D>, path: &str, query_ua: Option<&str>, ua_header: &str, accept_language: Option<&str>, country: Option<&str>, now_iso: &str) -> (u16, Value) {
    if path == "/api/classify" {
        return (200, classify_visit(query_ua.unwrap_or(ua_header), accept_language));
    }
    if path == "/api/stats" {
        let Some(db) = db else { return (503, json!({"error": "no D1 binding"})) };
        let results = db.recent().await;
        return (200, json!({"total": results.len(), "by_kind": count(&results, "kind"), "by_agent": count(&results, "agent"), "clusters": cluster_intents(&results)}));
    }
    let c = classify_visit(ua_header, accept_language);
    if let Some(db) = db {
        let _ = db.log(now_iso, &path.chars().take(200).collect::<String>(), &ua_header.chars().take(300).collect::<String>(), c["kind"].as_str().unwrap(), c["agent"].as_str(), c["intent"].as_str(), country).await;
    }
    if path == "/t" {
        return (204, Value::Null);
    }
    (0, Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;
    use std::cell::RefCell;

    const CHROME: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    #[derive(Default)]
    struct D(RefCell<Vec<Value>>);
    impl Db for D {
        async fn recent(&self) -> Vec<Value> { self.0.borrow().iter().rev().cloned().collect() }
        async fn log(&self, ts: &str, path: &str, ua: &str, kind: &str, agent: Option<&str>, intent: Option<&str>, _c: Option<&str>) -> Result<(), String> {
            self.0.borrow_mut().push(json!({"ts": ts, "path": path, "ua": ua, "kind": kind, "agent": agent, "intent": intent}));
            Ok(())
        }
    }
    fn k(ua: &str) -> Value { classify_visit(ua, None) }

    #[test]
    fn classes_and_edges() {
        assert_eq!(k(CHROME)["kind"], "human");
        let r = k("Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot");
        assert_eq!((r["kind"].as_str(), r["intent"].as_str()), (Some("ai_agent"), Some("training_crawl")));
        assert_eq!(k("Mozilla/5.0 (compatible; ChatGPT-User/1.0)")["intent"], "user_fetch");
        assert_eq!(k("PerplexityBot/1.0")["intent"], "ai_search");
        assert_eq!(k("curl/8.5.0")["kind"], "other_bot");
        assert_eq!(k("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")["kind"], "other_bot");
        assert_eq!(k("")["kind"], "other_bot");
        assert_eq!(k("mozilla/5.0 (compatible; gptbot/1.2)")["kind"], "ai_agent");
        assert_eq!(k("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")["kind"], "ai_agent");
        assert!(cluster_intents(&[]).is_empty());
        let c = cluster_intents(&[json!({"kind":"ai_agent","intent":"training_crawl","agent":"GPTBot","path":"/blog/a"}), json!({"kind":"ai_agent","intent":"training_crawl","agent":"CCBot","path":"/blog/b"}), json!({"kind":"human","path":"/"})]);
        assert_eq!((c.len(), c[0]["visits"].as_i64(), c[0]["agents"].as_array().unwrap().len()), (1, Some(2), 2));
    }
    #[test]
    fn http_logging_stats_pixel() {
        let db = D::default();
        block_on(handle(Some(&db), "/docs", None, "ClaudeBot/1.0", None, None, "t"));
        assert_eq!(block_on(handle(Some(&db), "/t", None, CHROME, None, None, "t")).0, 204);
        let (_, s) = block_on(handle(Some(&db), "/api/stats", None, "", None, None, "t"));
        assert_eq!((s["total"].as_i64(), s["by_kind"]["ai_agent"].as_i64(), s["clusters"][0]["section"].as_str()), (Some(2), Some(1), Some("/docs")));
        assert_eq!(block_on(handle::<D>(None, "/api/classify", Some("GPTBot"), "", None, None, "t")).1["agent"], "GPTBot");
        assert_eq!(block_on(handle::<D>(None, "/api/stats", None, "", None, None, "t")).0, 503);
        assert_eq!(block_on(handle::<D>(None, "/", None, "", None, None, "t")).0, 0);
    }
}
