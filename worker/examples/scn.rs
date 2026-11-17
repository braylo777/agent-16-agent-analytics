use agent_16_agent_analytics::classify::classify_visit;
use serde_json::json;
fn main() {
    let t: Vec<String> = serde_json::from_str(&std::fs::read_to_string("/tmp/ua16.json").unwrap()).unwrap();
    let a: Vec<_> = t.iter().map(|u| classify_visit(u, None)).collect();
    let b: Vec<_> = t.iter().take(50).map(|u| classify_visit(u, Some(""))).collect();
    println!("{}", serde_json::to_string(&json!({"a": a, "b": b})).unwrap());
}
