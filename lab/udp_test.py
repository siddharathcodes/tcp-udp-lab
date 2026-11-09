"""Real UDP echo test (slide 32) through the impairment proxy."""
import socket
import statistics
import struct
import threading
import time

from .impair import Impairment, UDPProxy

PKT = struct.Struct("!IQ")  # seq, send timestamp (ns)


def _echo_server(stop):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(0.1)

    def loop():
        while not stop.is_set():
            try:
                data, addr = s.recvfrom(65535)
                s.sendto(data, addr)
            except socket.timeout:
                pass
            except OSError:
                break
        s.close()

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return s.getsockname(), t


def rtt_stats(rtts):
    if not rtts:
        return {"avg": None, "p50": None, "p95": None, "max": None}
    r = sorted(rtts)
    return {"avg": round(statistics.fmean(r), 3),
            "p50": round(r[len(r) // 2], 3),
            "p95": round(r[min(len(r) - 1, int(len(r) * 0.95))], 3),
            "max": round(r[-1], 3)}


def run_udp(n=200, size=64, interval_ms=1.0, imp=None, seed=1, idle=0.5, deadline=15.0):
    imp = imp or Impairment()
    stop = threading.Event()
    server_addr, srv_thread = _echo_server(stop)
    proxy = UDPProxy(server_addr, imp, seed)
    proxy.start()
    cli = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    cli.settimeout(0.05)
    pad = b"x" * max(0, size - PKT.size)
    sending_done = threading.Event()

    def sender():
        for i in range(n):
            cli.sendto(PKT.pack(i, time.monotonic_ns()) + pad, proxy.addr)
            time.sleep(interval_ms / 1000.0)
        sending_done.set()

    t0 = time.monotonic()
    threading.Thread(target=sender, daemon=True).start()
    seen, rtt_by_seq = set(), {}
    dups = reordered = 0
    max_seq = -1
    last_rx = time.monotonic()
    while time.monotonic() - t0 < deadline:
        try:
            data, _ = cli.recvfrom(65535)
        except socket.timeout:
            if sending_done.is_set() and time.monotonic() - last_rx > idle:
                break
            continue
        last_rx = time.monotonic()
        seq, ts = PKT.unpack(data[:PKT.size])
        if seq in seen:
            dups += 1
            continue
        if seq < max_seq:
            reordered += 1
        max_seq = max(max_seq, seq)
        seen.add(seq)
        rtt_by_seq[seq] = (time.monotonic_ns() - ts) / 1e6
    dur = time.monotonic() - t0 - (idle if len(seen) < n else 0)
    stop.set()
    proxy.close()
    cli.close()
    return {
        "protocol": "udp",
        "label": "UDP echo (real sockets)",
        "sent": n,
        "received": len(seen),
        "lost": n - len(seen),
        "duplicates": dups,
        "reordered": reordered,
        "delivery_pct": round(100 * len(seen) / n, 2),
        "in_order": reordered == 0,
        "retransmissions": 0,
        "duration_s": round(max(dur, 0.0), 3),
        "rtt_ms": rtt_stats(list(rtt_by_seq.values())),
        "rtt_series": [round(rtt_by_seq[i], 2) if i in rtt_by_seq else None for i in range(n)],
        "proxy": proxy.stats,
    }
