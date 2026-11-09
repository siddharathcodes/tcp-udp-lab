"""Network impairment proxies (loopback "bad network" in a box).

UDPProxy sits between a UDP client and server and, per direction, can drop,
duplicate, delay, jitter and reorder datagrams.
"""
import heapq
import itertools
import random
import select
import socket
import threading
import time
from dataclasses import dataclass


@dataclass
class Impairment:
    loss: float = 0.0        # probability a datagram is dropped (0..1), each direction
    dup: float = 0.0         # probability a datagram is duplicated
    reorder: float = 0.0     # probability a datagram is held back (arrives late)
    delay_ms: float = 0.0    # fixed one-way delay
    jitter_ms: float = 0.0   # extra random 0..jitter delay


class UDPProxy(threading.Thread):
    def __init__(self, server_addr, imp: Impairment, seed: int = 1):
        super().__init__(daemon=True)
        self.front = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.front.bind(("127.0.0.1", 0))
        self.back = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.back.bind(("127.0.0.1", 0))
        self.server_addr = server_addr
        self.imp = imp
        self.rng = random.Random(seed)
        self.client = None
        self.heap = []
        self.counter = itertools.count()
        self.stats = {d: {"in": 0, "dropped": 0, "duplicated": 0, "reordered": 0}
                      for d in ("c2s", "s2c")}
        self._stop_evt = threading.Event()

    @property
    def addr(self):
        return self.front.getsockname()

    def _schedule(self, direction, data):
        s, imp, rng = self.stats[direction], self.imp, self.rng
        s["in"] += 1
        if rng.random() < imp.loss:
            s["dropped"] += 1
            return
        copies = 1
        if rng.random() < imp.dup:
            copies = 2
            s["duplicated"] += 1
        for _ in range(copies):
            d = imp.delay_ms + rng.uniform(0, imp.jitter_ms)
            if rng.random() < imp.reorder:
                d += imp.delay_ms * 2 + 10 + rng.uniform(0, 10)
                s["reordered"] += 1
            heapq.heappush(self.heap, (time.monotonic() + d / 1000.0,
                                       next(self.counter), direction, data))

    def run(self):
        while not self._stop_evt.is_set():
            timeout = 0.05
            if self.heap:
                timeout = max(0.0, min(timeout, self.heap[0][0] - time.monotonic()))
            readable, _, _ = select.select([self.front, self.back], [], [], timeout)
            for s in readable:
                try:
                    data, addr = s.recvfrom(65535)
                except OSError:
                    continue
                if s is self.front:
                    self.client = addr
                    self._schedule("c2s", data)
                else:
                    self._schedule("s2c", data)
            now = time.monotonic()
            while self.heap and self.heap[0][0] <= now:
                _, _, direction, data = heapq.heappop(self.heap)
                try:
                    if direction == "c2s":
                        self.back.sendto(data, self.server_addr)
                    elif self.client:
                        self.front.sendto(data, self.client)
                except OSError:
                    pass

    def close(self):
        self._stop_evt.set()
        self.join(timeout=1)
        self.front.close()
        self.back.close()
