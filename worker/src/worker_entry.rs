//! Cloudflare Worker entry (wasm32 only). Same routes and JSON as the old src/index.js (D1 `DB` binding).
use crate::classify::{handle, Db, SCHEMA};
use crate::page::PAGE;
use serde_json::Value;
use worker::*;

struct D1(worker::D1Database);
impl Db for D1 {
    async fn recent(&self) -> Vec<Value> {
        match self.0.prepare("SELECT path, kind, agent, intent FROM visits ORDER BY id DESC LIMIT 5000").all().await {
            Ok(r) => r.results::<Value>().unwrap_or_default(),
            Err(_) => vec![],
        }
    }
    async fn log(&self, ts: &str, path: &str, ua: &str, kind: &str, agent: Option<&str>, intent: Option<&str>, country: Option<&str>) -> std::result::Result<(), String> {
        let opt = |o: Option<&str>| o.map_or(wasm_bindgen::JsValue::NULL, |s| s.into());
        let ins = self.0.prepare("INSERT INTO visits (ts,path,ua,kind,agent,intent,country) VALUES (?,?,?,?,?,?,?)")
            .bind(&[ts.into(), path.into(), ua.into(), kind.into(), opt(agent), opt(intent), opt(country)]).map_err(|e| e.to_string())?;
        self.0.batch(vec![self.0.prepare(SCHEMA), ins]).await.map(|_| ()).map_err(|e| e.to_string())
    }
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let url = req.url()?;
    let headers = req.headers();
    let ua = headers.get("user-agent")?.unwrap_or_default();
    let al = headers.get("accept-language")?;
    let q_ua: Option<String> = url.query_pairs().find(|(k, _)| k == "ua").map(|(_, v)| v.to_string());
    let country = req.cf().and_then(|c| c.country());
    let db = env.d1("DB").ok().map(D1);
    let now = String::from(js_sys::Date::new_0().to_iso_string());
    let (status, v) = handle(db.as_ref(), url.path(), q_ua.as_deref(), &ua, al.as_deref(), country.as_deref(), &now).await;
    match status {
        0 => {
            let h = Headers::new();
            h.set("content-type", "text/html;charset=utf-8")?;
            Ok(Response::ok(PAGE)?.with_headers(h))
        }
        204 => Ok(Response::empty()?.with_status(204)),
        _ => Ok(Response::from_json(&v)?.with_status(status)),
    }
}
