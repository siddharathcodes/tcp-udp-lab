"""Run the three protocol tests with the same workload and the same impairment."""
from .impair import Impairment
from .rdt import run_rdt
from .tcp_test import run_tcp
from .udp_test import run_udp

LIMITS = {"n": (10, 400), "size": (16, 1200), "loss": (0, 0.4), "dup": (0, 0.5),
          "reorder": (0, 0.5), "delay_ms": (0, 100), "jitter_ms": (0, 100)}
PROTOCOLS = ("udp", "tcp", "tcp_like")


def clamp(params):
    out = {}
    defaults = {"n": 200, "size": 64, "loss": 0.05, "dup": 0.0, "reorder": 0.0,
               "delay_ms": 5, "jitter_ms": 2}
    for k, (lo, hi) in LIMITS.items():
        v = float(params.get(k, defaults[k]))
        out[k] = max(lo, min(hi, v))
    out["n"], out["size"] = int(out["n"]), int(out["size"])
    out["seed"] = int(params.get("seed", 1))
    protos = [p for p in params.get("protocols", PROTOCOLS) if p in PROTOCOLS]
    out["protocols"] = protos or list(PROTOCOLS)
    return out


def run_suite(params):
    p = clamp(params)
    imp = Impairment(p["loss"], p["dup"], p["reorder"], p["delay_ms"], p["jitter_ms"])
    results = {}
    if "udp" in p["protocols"]:
        results["udp"] = run_udp(p["n"], p["size"], imp=imp, seed=p["seed"])
    if "tcp" in p["protocols"]:
        results["tcp"] = run_tcp(p["n"], p["size"], imp=imp, seed=p["seed"])
    if "tcp_like" in p["protocols"]:
        results["tcp_like"] = run_rdt(p["n"], p["size"], imp=imp, seed=p["seed"])
    return {"params": p, "results": results}


def run_sweep(params, losses):
    base = clamp(params)
    base["n"] = min(base["n"], 120)
    rows = []
    for loss in losses[:8]:
        loss = max(0.0, min(0.4, float(loss)))
        r = run_suite({**base, "loss": loss})
        rows.append({"loss": loss, "results": {
            k: {m: v[m] for m in ("delivery_pct", "duration_s", "retransmissions",
                                  "duplicates", "reordered", "in_order")}
            for k, v in r["results"].items()}})
    return {"params": base, "rows": rows}
