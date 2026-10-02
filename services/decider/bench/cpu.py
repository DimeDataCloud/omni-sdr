"""CPU cost per decision for laya, across engines, thread counts and input shapes.

Runs inside the bench image (Dockerfile.bench) on Cloud Run, so the numbers are the production CPU. For each
configuration it reports milliseconds per decision, vCPU-seconds per decision (threads x time: what a Cloud Run
instance sized to that many vCPUs would bill), input tokens, and how far the two safety answers move from the
fp32 baseline (max |dp| and how many decisions flip at the REPLY_TRIAGE thresholds).

Output: one JSON line per configuration, prefixed "CPUBENCH ", plus a summary table.
"""
import json, os, statistics, sys, time

import numpy as np
import torch
import laya
from laya.email import clean_email_body

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, "cases.json"), encoding="utf-8"))
LONG = json.load(open(os.path.join(HERE, "long_cases.json"), encoding="utf-8"))
THRESH = {"stop": 0.30, "meet": 0.5}

SAFETY = {
    "stop": {"type": "noul", "instructions": "Does the sender ask us to stop contacting them or remove them from a list?"},
    "meet": {"type": "noul", "instructions": "Does the sender ask for or agree to a meeting, call, demo or times?"},
}
SHORT = {
    "stop": {"type": "noul", "instructions": "Asks us to stop emailing?"},
    "meet": {"type": "noul", "instructions": "Asks for or accepts a meeting?"},
}
ONNX_FP32 = os.environ.get("ONNX_FP32", "/opt/onnx/laya.onnx")
ONNX_INT8 = os.environ.get("ONNX_INT8", "/opt/onnx/laya.int8.onnx")
THREADS = [int(t) for t in os.environ.get("THREADS", "1,2,4,8").split(",")]
REPO = "convaiinnovations/laya"


def states(cases, clean=False):
    return [{"subject": c["subject"], "body": clean_email_body(c["body"]) if clean else c["body"]} for c in cases]


def run(predict, sts, questions, threads, set_threads):
    set_threads(threads)
    predict(sts[0], questions)  # warm this thread count
    ms, out, toks = [], [], []
    for s in sts:
        t0 = time.perf_counter()
        r = predict(s, questions)
        ms.append((time.perf_counter() - t0) * 1000)
        out.append({k: r["answers"][k]["noul"] for k in questions})
        toks.append(r.get("usage", {}).get("input_tokens"))
    return ms, out, toks


def compare(out, base):
    d = max(abs(o[k] - b[k]) for o, b in zip(out, base) for k in THRESH)
    flips = sum((o[k] >= THRESH[k]) != (b[k] >= THRESH[k]) for o, b in zip(out, base) for k in THRESH)
    return round(d, 4), flips


def truth(out, cases):
    stop = sum((o["stop"] >= THRESH["stop"]) == c["stop"] for o, c in zip(out, cases))
    meet = sum((o["meet"] >= THRESH["meet"]) == c["meet"] for o, c in zip(out, cases))
    return f"{stop}/{len(cases)}", f"{meet}/{len(cases)}"


def report(name, threads, ms, out, toks, base, cases):
    med = statistics.median(ms)
    d, flips = compare(out, base) if base else (0.0, 0)
    stop_ok, meet_ok = truth(out, cases)
    row = {"config": name, "threads": threads, "ms_p50": round(med), "ms_p95": round(sorted(ms)[int(0.95 * (len(ms) - 1))]),
           "vcpu_s": round(threads * med / 1000, 3), "tokens": round(statistics.mean(t for t in toks if t is not None)) if any(toks) else None,
           "max_dp": d, "flips": flips, "stop_ok": stop_ok, "meet_ok": meet_ok}
    print("CPUBENCH " + json.dumps(row), flush=True)
    return row


def main():
    rows = []
    sts = states(CASES)
    torch_threads = lambda n: torch.set_num_threads(n)

    fp32 = laya.load(REPO, device="cpu")
    base = {}
    for t in THREADS:
        ms, out, toks = run(fp32.predict, sts, SAFETY, t, torch_threads)
        base.setdefault("out", out)
        rows.append(report("torch-fp32", t, ms, out, toks, base["out"], CASES))
    ref = base["out"]

    # Fewer tokens: the same questions, shorter instructions.
    ms, out, toks = run(fp32.predict, sts, SHORT, 4, torch_threads)
    rows.append(report("torch-fp32 short-q", 4, ms, out, toks, ref, CASES))

    # Real replies carry quoted history, signatures and disclaimers: raw vs laya's own cleaner.
    raw = states(LONG)
    ms, out_raw, toks = run(fp32.predict, raw, SAFETY, 4, torch_threads)
    rows.append(report("torch-fp32 long-raw", 4, ms, out_raw, toks, None, LONG))
    ms, out, toks = run(fp32.predict, states(LONG, clean=True), SAFETY, 4, torch_threads)
    rows.append(report("torch-fp32 long-cleaned", 4, ms, out, toks, out_raw, LONG))

    # torch dynamic INT8 on the encoder's Linears. The decision head is an nn.Transformer layer that reads
    # `linear1.weight.device`, which a quantized Linear doesn't have, so the head stays fp32 (it is small).
    q8 = laya.load(REPO, device="cpu")
    q8.model.encoder = torch.ao.quantization.quantize_dynamic(q8.model.encoder, {torch.nn.Linear}, dtype=torch.qint8)
    for t in THREADS:
        ms, out, toks = run(q8.predict, sts, SAFETY, t, torch_threads)
        rows.append(report("torch-int8-dynamic", t, ms, out, toks, ref, CASES))
    del q8

    # ONNX Runtime, fp32 and INT8 (per-tensor, laya's default since 0.3.23).
    for name, path in (("onnx-fp32", ONNX_FP32), ("onnx-int8", ONNX_INT8)):
        if not os.path.exists(path):
            print(f"CPUBENCH-SKIP {name}: {path} missing", flush=True)
            continue
        import onnxruntime as ort
        from laya.onnx_agent import ONNXAgent
        agent = ONNXAgent(REPO, onnx_path=path)

        def ort_threads(n, agent=agent, path=path):
            so = ort.SessionOptions()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.intra_op_num_threads = n
            so.inter_op_num_threads = 1
            agent.session = ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])

        for t in THREADS:
            ms, out, toks = run(agent.system_one, sts, SAFETY, t, ort_threads)
            rows.append(report(name, t, ms, out, toks, ref, CASES))
        del agent

    # The smaller checkpoint (mmBERT-base): 2x faster per the vendor; accuracy on our questions unknown.
    if os.environ.get("MULTILINGUAL", "1") == "1":
        ml = laya.load("convaiinnovations/laya-multilingual", device="cpu")
        for t in THREADS:
            ms, out, toks = run(ml.predict, sts, SAFETY, t, torch_threads)
            rows.append(report("torch-fp32 multilingual", t, ms, out, toks, ref, CASES))

    print("\nSUMMARY (cheapest vCPU-seconds per decision first)")
    for r in sorted(rows, key=lambda r: r["vcpu_s"]):
        print(f"  {r['config']:26} t={r['threads']}  {r['ms_p50']:>5} ms  {r['vcpu_s']:>6} vCPU-s  tokens={r['tokens']}  "
              f"max_dp={r['max_dp']}  flips={r['flips']}  stop={r['stop_ok']} meet={r['meet_ok']}")


if __name__ == "__main__":
    sys.exit(main())
