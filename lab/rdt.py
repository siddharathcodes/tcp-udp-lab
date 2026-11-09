"""TCP-style reliable transfer built on top of real UDP sockets.

Implements the mechanisms from the Week 10 slides so they can be tested under
injected loss with real datagrams:
  - sequence numbers and cumulative ACKs
  - sliding window, one timer for the oldest unACKed segment
  - EstimatedRTT / DevRTT / TimeoutInterval (RTO), Karn's rule, RTO backoff
  - timeout retransmission of the oldest segment only
  - fast retransmit after 3 duplicate ACKs
  - receiver buffers out-of-order segments and sends duplicate ACKs on gaps
"""
import socket
import struct
import threading
import time

from .impair import Impairment, UDPProxy
from .udp_test import rtt_stats

HDR = struct.Struct("!BII")  # type (0 data, 1 ack), seq or ack number, echoed seq (like a TCP timestamp echo)
ALPHA, BETA = 0.125, 0.25


class Receiver(threading.Thread):
    def __init__(self, stop):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.1)
        self.stop = stop
        self.expected = 0
        self.buffer = {}
        self.delivered = []
        self.dup_segments = 0
        self.out_of_order = 0
        self.acks_sent = 0

    @property
    def addr(self):
        return self.sock.getsockname()

    def run(self):
        while not self.stop.is_set():
            try:
                data, addr = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            kind, seq, _ = HDR.unpack(data[:HDR.size])
            if kind != 0:
                continue
            if seq == self.expected:
                self.delivered.append(seq)
                self.expected += 1
                while self.expected in self.buffer:
                    self.buffer.pop(self.expected)
                    self.delivered.append(self.expected)
                    self.expected += 1
            elif seq > self.expected:
                if seq not in self.buffer:
                    self.out_of_order += 1
                self.buffer[seq] = True
            else:
                self.dup_segments += 1
            self.sock.sendto(HDR.pack(1, self.expected, seq), addr)  # cumulative ACK + echo of triggering seq
            self.acks_sent += 1
        self.sock.close()


def run_rdt(n=200, size=64, imp=None, seed=1, window=16, init_rto=0.2,
            min_rto=0.03, max_rto=1.0, deadline=20.0):
    imp = imp or Impairment()
    stop = threading.Event()
    rx = Receiver(stop)
    rx.start()
    proxy = UDPProxy(rx.addr, imp, seed)
    proxy.start()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    payload = b"x" * max(0, size - HDR.size)

    t0 = time.monotonic()
    base = nxt = 0
    sent_time, retrans = {}, set()
    est = dev = None
    rto = init_rto
    timer = None
    dupacks = 0
    st = {"segments_sent": 0, "timeouts": 0, "fast": 0, "dup_acks": 0}
    samples, rto_series, events = [], [], []

    def ev(kind, seq):
        if len(events) < 400:
            events.append([round((time.monotonic() - t0) * 1000, 1), kind, seq])

    def send(seq, kind="send"):
        sock.sendto(HDR.pack(0, seq, 0) + payload, proxy.addr)
        st["segments_sent"] += 1
        ev(kind, seq)

    while base < n and time.monotonic() - t0 < deadline:
        while nxt < n and nxt < base + window:
            sent_time[nxt] = time.monotonic()
            send(nxt)
            if timer is None:
                timer = time.monotonic() + rto
            nxt += 1
        sock.settimeout(max(0.001, timer - time.monotonic()) if timer else 0.05)
        try:
            data, _ = sock.recvfrom(65535)
            now = time.monotonic()
            kind, ack, echo = HDR.unpack(data[:HDR.size])
            if kind != 1:
                continue
            if echo not in retrans and echo in sent_time:  # Karn's rule + timestamp-echo RTT sample
                s = now - sent_time[echo]
                samples.append(s * 1000)
                if est is None:
                    est, dev = s, s / 2
                else:
                    dev = (1 - BETA) * dev + BETA * abs(s - est)
                    est = (1 - ALPHA) * est + ALPHA * s
                rto_series.append([round((now - t0) * 1000, 1), round(est * 1000, 2),
                                   round(min(max_rto, max(min_rto, est + 4 * dev)) * 1000, 2)])
            if ack > base:
                if est is not None:  # new data ACKed: drop the backoff, recompute RTO
                    rto = min(max_rto, max(min_rto, est + 4 * dev))
                ev("ack", ack)
                base, dupacks = ack, 0
                timer = now + rto if base < nxt else None
            elif ack == base and base < nxt:
                dupacks += 1
                st["dup_acks"] += 1
                ev("dupack", ack)
                if dupacks == 3:
                    st["fast"] += 1
                    retrans.add(base)
                    send(base, "fast_retx")
                    timer = now + rto
        except socket.timeout:
            if timer and time.monotonic() >= timer and base < nxt:
                st["timeouts"] += 1
                retrans.add(base)
                send(base, "timeout_retx")
                rto = min(rto * 2, max_rto)  # exponential backoff
                timer = time.monotonic() + rto
    dur = time.monotonic() - t0
    time.sleep(0.05)
    delivered = list(rx.delivered)
    stop.set()
    proxy.close()
    sock.close()
    ok = delivered == list(range(n))
    retx = st["timeouts"] + st["fast"]
    return {
        "protocol": "tcp_like",
        "label": "TCP-style reliability over UDP",
        "sent": n,
        "received": len(delivered),
        "lost": n - len(delivered),
        "duplicates": rx.dup_segments,
        "reordered": 0,
        "delivery_pct": round(100 * len(delivered) / n, 2),
        "in_order": ok,
        "retransmissions": retx,
        "timeout_retransmissions": st["timeouts"],
        "fast_retransmissions": st["fast"],
        "dup_acks": st["dup_acks"],
        "segments_sent": st["segments_sent"],
        "overhead_pct": round(100 * (st["segments_sent"] - n) / n, 2),
        "receiver_out_of_order": rx.out_of_order,
        "final_rto_ms": round(rto * 1000, 2),
        "duration_s": round(dur, 3),
        "goodput_kbps": round(len(delivered) * size * 8 / max(dur, 1e-6) / 1000, 1),
        "rtt_ms": rtt_stats(samples),
        "rto_series": rto_series[:300],
        "events": events,
        "proxy": proxy.stats,
    }
