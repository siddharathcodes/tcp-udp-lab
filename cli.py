#!/usr/bin/env python3
"""Command line reliability test.

  python cli.py run --loss 0.1 --n 200
  python cli.py sweep --losses 0 0.05 0.1 0.2
  python cli.py run --json > result.json
"""
import argparse
import json

from lab.suite import run_suite, run_sweep


def table(results):
    cols = ["label", "delivery_pct", "in_order", "duplicates", "retransmissions", "duration_s"]
    print(f"{'protocol':38}{'deliv%':>8}{'ordered':>9}{'dups':>6}{'retx':>6}{'time(s)':>9}{'rtt avg ms':>12}")
    for r in results.values():
        print(f"{r['label']:38}{r['delivery_pct']:>8}{str(r['in_order']):>9}{r['duplicates']:>6}"
              f"{r['retransmissions']:>6}{r['duration_s']:>9}{str(r['rtt_ms']['avg']):>12}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("cmd", choices=["run", "sweep"])
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--loss", type=float, default=0.05)
    ap.add_argument("--dup", type=float, default=0.0)
    ap.add_argument("--reorder", type=float, default=0.0)
    ap.add_argument("--delay", type=float, default=5, dest="delay_ms")
    ap.add_argument("--jitter", type=float, default=2, dest="jitter_ms")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--losses", type=float, nargs="+", default=[0, 0.02, 0.05, 0.1, 0.2])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    params = {k: getattr(a, k) for k in ("n", "size", "loss", "dup", "reorder", "delay_ms", "jitter_ms", "seed")}
    if a.cmd == "run":
        out = run_suite(params)
        if a.json:
            print(json.dumps(out, indent=2))
        else:
            table(out["results"])
    else:
        out = run_sweep(params, a.losses)
        if a.json:
            print(json.dumps(out, indent=2))
        else:
            for row in out["rows"]:
                print(f"\nloss = {row['loss']*100:.0f}%")
                for k, v in row["results"].items():
                    print(f"  {k:9} delivery {v['delivery_pct']:>6}%  ordered {v['in_order']!s:5}  retx {v['retransmissions']:>3}  time {v['duration_s']}s")


if __name__ == "__main__":
    main()
