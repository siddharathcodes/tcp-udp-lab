"""Flask server: serves the dashboard and runs the real-socket lab on demand."""
import os
import threading

from flask import Flask, jsonify, request, send_from_directory

from lab.suite import run_suite, run_sweep

app = Flask(__name__, static_folder="static", static_url_path="/static")
_lock = threading.Lock()  # one lab run at a time keeps timings honest


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/health")
def health():
    return jsonify(ok=True, service="tcp-udp-reliability-lab")


def _locked(fn):
    if not _lock.acquire(timeout=30):
        return jsonify(error="Lab is busy, try again in a few seconds"), 429
    try:
        return jsonify(fn())
    finally:
        _lock.release()


@app.post("/api/run")
def api_run():
    body = request.get_json(silent=True) or {}
    return _locked(lambda: run_suite(body))


@app.post("/api/sweep")
def api_sweep():
    body = request.get_json(silent=True) or {}
    losses = body.get("losses") or [0, 0.02, 0.05, 0.1, 0.2]
    return _locked(lambda: run_sweep(body, losses))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), threaded=True)
