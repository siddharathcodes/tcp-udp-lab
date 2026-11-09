# TCP vs UDP Reliability Lab

**[▶ Open the live demo](https://tcp-udp-lab.onrender.com)**

The first load can take up to a minute, because the free server sleeps when idle.

Tests how TCP and UDP behave under packet loss, ACK loss, delay, duplication and reordering.

- `static/index.html` dashboard: animated scenarios, loss-sweep experiments, RTT/RTO estimator, header + checksum tools, live lab tab
- `lab/` real Python sockets: UDP echo, kernel TCP echo, TCP-style reliability over UDP, lossy UDP proxy
- `cli.py` command line tests, `app.py` Flask server, `tests/` pytest

## Run
    pip install -r requirements.txt
    python cli.py run --loss 0.1 --n 200
    python cli.py sweep --losses 0 0.05 0.1 0.2
    python -m pytest tests
    python app.py          # http://localhost:5000

## Host online
Push to GitHub, create a Render web service (Docker). `render.yaml` is included.
Static only: upload `static/index.html` to GitHub Pages or Netlify (Live tab shows a captured sample run).

Note: kernel TCP hides loss from apps, so the TCP echo test emulates each lost segment as a 200 ms retransmission stall.
On Linux you can instead use `sudo tc qdisc add dev lo root netem loss 10%`.
