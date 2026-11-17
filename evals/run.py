"""Labeled-log eval. Labels come from independent public sources, not from our classifier:
 human     = 2,000 real browser UAs sampled from intoli/user-agents
 ai_agent  = crawler-user-agents instances whose pattern names an agent listed in ai-robots-txt/ai.robots.txt
 other_bot = all other crawler-user-agents instances"""
import json, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "src"))
from agent16.classify import classify_visit  # noqa: E402

rd = lambda f: json.loads((root / "data" / f).read_text(encoding="utf-8"))
ai = [s.lower() for s in rd("airobots.json").keys()]
rows = []
for c in rd("crawlers.json"):
    pat = c["pattern"].lower().replace("\\", "")
    is_ai = any(a in pat or pat in a for a in ai)
    for ua in c.get("instances") or []:
        rows.append({"ua": ua, "y": "ai_agent" if is_ai else "other_bot"})
H = rd("ua.json")
s = [7]
def rnd():
    s[0] = ((((s[0] * 1103515245) & 0xFFFFFFFF) + 12345) & 0xFFFFFFFF)
    return s[0] / 2 ** 32
for _, ua in sorted(([rnd(), h["userAgent"]] for h in H), key=lambda x: x[0])[:2000]:
    rows.append({"ua": ua, "y": "human"})
K = ["human", "ai_agent", "other_bot"]
cm = {a: {b: 0 for b in K} for a in K}
ok = 0
preds = []
for r in rows:
    p = classify_visit(r["ua"])["kind"]
    preds.append(p)
    cm[r["y"]][p] += 1
    ok += p == r["y"]
def per(k):
    tp = cm[k][k]
    fp = sum(cm[j][k] for j in K if j != k)
    fn = sum(cm[k][j] for j in K if j != k)
    P = tp / ((tp + fp) or 1); R = tp / ((tp + fn) or 1)
    return {"support": tp + fn, "precision": P, "recall": R, "f1": (2 * P * R) / ((P + R) or 1)}
hb = sum(1 for r, p in zip(rows, preds) if (r["y"] == "human") == (p == "human"))
old = json.loads((root / "evals" / "results.json").read_text()) if (root / "evals" / "results.json").exists() else {}
res = {"n": len(rows), "accuracy_3class": ok / len(rows), "accuracy_human_vs_bot": hb / len(rows), "confusion_matrix_rows_true_cols_pred": cm, "per_class": {k: per(k) for k in K},
       "sources": ["intoli/user-agents", "monperrus/crawler-user-agents", "ai-robots-txt/ai.robots.txt"], "caveat": old.get("caveat", "")}
out = root / ("evals/results.json" if "--write" in sys.argv else "evals/results.check.json")
out.write_text(json.dumps(res, indent=2))
print(json.dumps({"n": res["n"], "acc3": res["accuracy_3class"], "accHB": res["accuracy_human_vs_bot"], "cm": cm}))
