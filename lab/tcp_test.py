"""Real TCP echo test (slide 31) over the kernel TCP stack.

The kernel hides packet loss from applications, so loss cannot be injected by
dropping bytes in a user-space relay (that would break the stream). Instead the
relay adds real latency/jitter, and for each simulated lost segment it stalls the
stream for one retransmission timeout (Linux minimum RTO = 200 ms). That is what
a lost segment does to a real TCP stream: head-of-line blocking until the retransmit.
Those events are reported as `emulated_retransmissions`.
"""
import math
import random
import socket
import struct
import threading
import time

from .impair import Impairment
from .udp_test import rtt_stats

PKT = struct.Struct("!IQ")
MSS = 1460
KERNEL_MIN_RTO = 0.2


def _server(stop):
    ls = socket.socket()
    ls.bind(("127.0.0.1", 0))
    ls.listen(4)
    ls.settimeout(0.2)

    def handle(c):
        c.settimeout(0.2)
        while not stop.is_set():
            try:
                d = c.recv(65535)
                if not d:
                    break
                c.sendall(d)
            except socket.timeout:
                continue
            except OSError:
                break
        c.close()

    def loop():
        while not stop.is_set():
            try:
                c, _ = ls.accept()
                threading.Thread(target=handle, args=(c,), daemon=True).start()
            except socket.timeout:
                continue
            except OSError:
                break
        ls.close()

    threading.Thread(target=loop, daemon=True).start()
    return ls.getsockname()


class TCPRelay:
    def __init__(self, server_addr, imp: Impairment, seed, stop):
        self.imp, self.rng, self.stop = imp, random.Random(seed), stop
        self.server_addr = server_addr
        self.ls = socket.socket()
        self.ls.bind(("127.0.0.1", 0))
        self.ls.listen(1)
        self.ls.settimeout(0.2)
        self.stalls = 0
        threading.Thread(target=self._accept, daemon=True).start()

    @property
    def addr(self):
        return self.ls.getsockname()

    def _accept(self):
        while not self.stop.is_set():
            try:
                c, _ = self.ls.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            s = socket.create_connection(self.server_addr)
            for a, b in ((c, s), (s, c)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    def _pump(self, src, dst):
        src.settimeout(0.2)
        imp = self.imp
        while not self.stop.is_set():
            try:
                data = src.recv(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            if not data:
                break
            segs = max(1, math.ceil(len(data) / MSS))
            lost = sum(self.rng.random() < imp.loss for _ in range(segs))
            if lost:
                self.stalls += lost
                time.sleep(KERNEL_MIN_RTO)
            time.sleep((imp.delay_ms + self.rng.uniform(0, imp.jitter_ms)) / 1000.0)
            try:
                dst.sendall(data)
            except OSError:
                break
        for x in (src, dst):
            try:
                x.close()
            except OSError:
                pass


def run_tcp(n=200, size=64, interval_ms=1.0, imp=None, seed=1, deadline=15.0):
    imp = imp or Impairment()
    stop = threading.Event()
    server_addr = _server(stop)
    relay = TCPRelay(server_addr, imp, seed, stop)
    cli = socket.create_connection(relay.addr)
    cli.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    cli.settimeout(0.1)
    pad = b"x" * max(0, size - PKT.size)
    sent_at = {}

    def sender():
        for i in range(n):
            ts = time.monotonic_ns()
            sent_at[i] = ts
            try:
                cli.sendall(PKT.pack(i, ts) + pad)
            except OSError:
                return
            time.sleep(interval_ms / 1000.0)

    t0 = time.monotonic()
    threading.Thread(target=sender, daemon=True).start()
    buf, got, rtts, expected, out_of_order = b"", 0, {}, 0, 0
    while got < n and time.monotonic() - t0 < deadline:
        try:
            d = cli.recv(65535)
        except socket.timeout:
            continue
        if not d:
            break
        buf += d
        while len(buf) >= size:
            msg, buf = buf[:size], buf[size:]
            seq, ts = PKT.unpack(msg[:PKT.size])
            if seq != expected:
                out_of_order += 1
            expected = seq + 1
            rtts[seq] = (time.monotonic_ns() - ts) / 1e6
            got += 1
    dur = time.monotonic() - t0
    stop.set()
    cli.close()
    return {
        "protocol": "tcp",
        "label": "TCP echo (real kernel TCP)",
        "sent": n,
        "received": got,
        "lost": n - got,
        "duplicates": 0,
        "reordered": out_of_order,
        "delivery_pct": round(100 * got / n, 2),
        "in_order": out_of_order == 0 and got == n,
        "retransmissions": relay.stalls,
        "emulated_retransmissions": relay.stalls,
        "duration_s": round(dur, 3),
        "rtt_ms": rtt_stats(list(rtts.values())),
        "rtt_series": [round(rtts[i], 2) if i in rtts else None for i in range(n)],
        "proxy": {"stalls": relay.stalls},
    }
