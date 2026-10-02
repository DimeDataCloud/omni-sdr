"""Score a laya checkpoint locally, on CPU, against the golden sets and the built test splits. No decider, no cloud.

    node services/decider/bench/prep.mjs > DATA/golden_prep.json
    python services/decider/bench/score.py --model english [--data ~/omni-sdr-training] [--n 300] [--threads 4]

Golden sets (training/golden/*.jsonl, held out): stop and meet at the registry's thresholds (reply_triage@2:
0.30 / 0.30) plus a sweep, on the raw message and on the cleanReplyBody output production sends, alone and OR-ed
with the shipped rules; the 9-way label. Test splits (DATA/build/<task>/test.jsonl): a seeded sample of N rows per
task, stratified by source; each row's own questions; choice = argmax vs gold, noul at 0.5 (stop/meet at the
registry thresholds). Writes DATA/score/<model>.json and prints a summary.
"""
import argparse, collections, json, os, random, time

import torch
import laya

REPOS = {"english": ("convaiinnovations/laya", "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"),
         "multilingual": ("convaiinnovations/laya-multilingual", "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67")}
# Must match packages/ai/src/registry.mjs REPLY_TRIAGE (reply_triage@2) and training/tasks.py REPLY_TRIAGE.
THRESH = {"stop": 0.30, "meet": 0.30}
RT_QUESTIONS = None  # filled from tasks.py so the wording is the trained wording


def pr(pairs):
    tp = sum(p and t for p, t in pairs); fp = sum(p and not t for p, t in pairs); fn = sum(t and not p for p, t in pairs)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": round(tp / (tp + fp), 3) if tp + fp else None,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None}


def fmt(m):
    p = "-" if m["precision"] is None else f"{m['precision']:.2f}"
    r = "-" if m["recall"] is None else f"{m['recall']:.2f}"
    return f"P {p} R {r} (tp {m['tp']} fp {m['fp']} fn {m['fn']})"


def score_golden(model, rows):
    out = []
    for r in rows:
        res = {}
        for view in ("raw", "clean"):
            body = r["body"] if view == "raw" else r["clean"]
            a = model.predict({"subject": r["subject"][:998], "body": body[:8000]}, RT_QUESTIONS)
            res[view] = {"stop": a["answers"]["stop"]["noul"], "meet": a["answers"]["meet"]["noul"],
                         "label": a["answers"]["label"]["choice"], "label_p": a["answers"]["label"]["answer_confidence"],
                         "tokens": a.get("usage", {}).get("input_tokens")}
        out.append({"id": r["id"], "truth": {"stop": r["stop"], "meet": r["meet"], "label": r["label"]}, "rules": r["rules"], **res})
    summary = {}
    for view in ("raw", "clean"):
        s = {}
        for q in ("stop", "meet"):
            s[q] = pr([(o[view][q] >= THRESH[q], o["truth"][q]) for o in out])
            rule = "unsubscribe" if q == "stop" else "meeting_request"
            s[q + "_or_rules"] = pr([(o[view][q] >= THRESH[q] or o["rules"] == rule, o["truth"][q]) for o in out])
            s[q + "_sweep"] = {str(t): pr([(o[view][q] >= t, o["truth"][q]) for o in out]) for t in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7)}
        s["label_acc"] = round(sum(o[view]["label"] == o["truth"]["label"] for o in out) / len(out), 3)
        s["tokens_mean"] = round(sum(o[view]["tokens"] or 0 for o in out) / len(out), 1)
        summary[view] = s
    summary["rules_stop"] = pr([(o["rules"] == "unsubscribe", o["truth"]["stop"]) for o in out])
    summary["rules_meet"] = pr([(o["rules"] == "meeting_request", o["truth"]["meet"]) for o in out])
    summary["rules_label_acc"] = round(sum(o["rules"] == o["truth"]["label"] for o in out) / len(out), 3)
    return summary, out


def sample(rows, n, seed):
    by = collections.defaultdict(list)
    for r in rows:
        by[r["source"]].append(r)
    rng, picked = random.Random(seed), []
    per = max(1, n // max(1, len(by)))
    for src in sorted(by):
        rng.shuffle(by[src])
        picked += by[src][:per]
    rest = [r for src in sorted(by) for r in by[src][per:]]
    rng.shuffle(rest)
    return picked + rest[: max(0, n - len(picked))]


def score_task(model, rows):
    per_q = collections.defaultdict(list)
    for r in rows:
        qs, gold = json.loads(r["questions"]), json.loads(r["gold"])
        a = model.predict(json.loads(r["state"]), qs)["answers"]
        for qid, g in gold.items():
            probs = g["probabilities"]
            want = max(probs, key=probs.get)
            if qs[qid]["type"] == "noul":
                p = a[qid]["noul"]
                got = "true" if p >= THRESH.get(qid, 0.5) else "false"
            else:
                got = a[qid]["choice"]
            per_q[qid].append({"source": r["source"], "want": want, "got": got})
    out = {}
    for qid, xs in per_q.items():
        labels = sorted({x["want"] for x in xs} | {x["got"] for x in xs})
        out[qid] = {"n": len(xs), "acc": round(sum(x["want"] == x["got"] for x in xs) / len(xs), 3),
                    "by_label": {l: pr([(x["got"] == l, x["want"] == l) for x in xs]) for l in labels},
                    "by_source": {s: round(sum(x["want"] == x["got"] for x in xs if x["source"] == s) / sum(1 for x in xs if x["source"] == s), 3)
                                  for s in sorted({x["source"] for x in xs})}}
    return out


def main():
    global RT_QUESTIONS
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="english", choices=sorted(REPOS))
    ap.add_argument("--data", default=os.path.join(os.path.expanduser("~"), "omni-sdr-training"))
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--tasks", default="reply_triage@1,booking@1,ivr_route@1,icp_department@1,icp_industry@1")
    args = ap.parse_args()
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "training"))
    import tasks as T
    RT_QUESTIONS = T.REPLY_TRIAGE["questions"]

    torch.set_num_threads(args.threads)
    repo, rev = REPOS[args.model]
    model = laya.load(repo, device="cpu", revision=rev)
    report = {"model": args.model, "repo": repo, "revision": rev, "thresholds": THRESH, "golden": {}, "tasks": {}}
    t0 = time.time()

    prep = json.load(open(os.path.join(args.data, "golden_prep.json"), encoding="utf-8"))
    for name, rows in sorted(prep.items()):
        summary, detail = score_golden(model, rows)
        report["golden"][name] = {"n": len(rows), "summary": summary, "detail": detail}
        print(f"\n== golden {name} ({len(rows)}; {sum(r['stop'] for r in rows)} stop, {sum(r['meet'] for r in rows)} meet)")
        for view in ("raw", "clean"):
            s = summary[view]
            print(f"  {view:5} STOP {fmt(s['stop'])} | +rules {fmt(s['stop_or_rules'])}")
            print(f"  {view:5} MEET {fmt(s['meet'])} | +rules {fmt(s['meet_or_rules'])}")
            print(f"  {view:5} label acc {s['label_acc']}  tokens {s['tokens_mean']}")
        print(f"  rules alone: STOP {fmt(summary['rules_stop'])} | MEET {fmt(summary['rules_meet'])} | label acc {summary['rules_label_acc']}")

    for task in filter(None, args.tasks.split(",")):
        p = os.path.join(args.data, "build", task, "test.jsonl")
        if not os.path.exists(p):
            continue
        rows = sample([json.loads(l) for l in open(p, encoding="utf-8")], args.n, args.seed)
        res = score_task(model, rows)
        report["tasks"][task] = res
        print(f"\n== {task} test sample {len(rows)}")
        for qid, r in res.items():
            weak = sorted(((l, m["recall"]) for l, m in r["by_label"].items() if m["recall"] is not None), key=lambda x: x[1])[:3]
            print(f"  {qid:11} acc {r['acc']}  weakest recall {weak}  by source {r['by_source']}")

    report["seconds"] = round(time.time() - t0)
    os.makedirs(os.path.join(args.data, "score"), exist_ok=True)
    with open(os.path.join(args.data, "score", f"{args.model}.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1)
    print(f"\n{report['seconds']} s")


if __name__ == "__main__":
    main()
