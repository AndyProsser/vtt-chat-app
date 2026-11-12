#!/usr/bin/env python3
"""A small front for whisper.cpp's whisper-server that gives the GPU back when Whisper is idle.

whisper-server loads its model once and keeps it in VRAM for as long as it runs. On a server that is
also somebody's gaming PC that is the wrong trade: transcription runs for an hour after a session, once
a week. So this listens on PORT (default 8080) in front of whisper-server, starts it on the first
request, forwards requests to it, and stops it again after WHISPER_IDLE_SECONDS (default 120) without
one. The price is a model load (seconds) on the first request after a pause. GET /health answers
without starting anything, so a healthcheck never loads the model.

    whisper-idle.py /app/build/bin/whisper-server -m /models/x.bin --inference-path /v1/... -l en

Everything after the script name is the whisper-server command line, without --host/--port.
Standard library only; it runs in the CUDA image next to whisper-server (whisper-cuda.Dockerfile).
"""

import http.client
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
INNER = PORT + 1
IDLE = float(os.environ.get("WHISPER_IDLE_SECONDS", "120"))
COMMAND = sys.argv[1:]
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "upgrade", "proxy-connection"}

lock = threading.Lock()
proc = None
busy = 0
last_used = time.monotonic()


def log(message):
    print(f"whisper-idle: {message}", flush=True)


def running():
    return proc is not None and proc.poll() is None


def ensure_started():
    """Starts whisper-server if it is not running and waits until it answers. Call with `lock` held."""
    global proc
    if running():
        return
    log("starting whisper-server (model load)")
    proc = subprocess.Popen(COMMAND + ["--host", "127.0.0.1", "--port", str(INNER)])
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"whisper-server exited with {proc.returncode}")
        try:
            conn = http.client.HTTPConnection("127.0.0.1", INNER, timeout=2)
            conn.request("GET", "/")
            conn.getresponse().read()
            conn.close()
            log("whisper-server is ready")
            return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError("whisper-server did not start within 600 s")


def stop_server():
    global proc
    if running():
        proc.terminate()
        try:
            proc.wait(30)
        except subprocess.TimeoutExpired:
            proc.kill()
    proc = None


def reaper():
    while True:
        time.sleep(5)
        with lock:
            if running() and busy == 0 and time.monotonic() - last_used > IDLE:
                log(f"idle for {int(IDLE)} s: stopping whisper-server (frees its memory)")
                stop_server()


def read_body(handler):
    if "chunked" in handler.headers.get("Transfer-Encoding", "").lower():
        parts = []
        while True:
            size = int(handler.rfile.readline().split(b";")[0].strip() or b"0", 16)
            if size == 0:
                handler.rfile.readline()
                break
            parts.append(handler.rfile.read(size))
            handler.rfile.readline()
        return b"".join(parts)
    return handler.rfile.read(int(handler.headers.get("Content-Length", "0") or 0))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet: whisper-server logs the work itself
        pass

    def reply(self, status, body, content_type="text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, b'{"status":"ok"}', "application/json")
            return
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        global busy, last_used
        body = read_body(self) if self.command == "POST" else b""
        with lock:
            busy += 1
            try:
                ensure_started()
            except RuntimeError as error:
                busy -= 1
                self.reply(503, str(error).encode())
                return
        try:
            conn = http.client.HTTPConnection("127.0.0.1", INNER, timeout=3600)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            headers["Content-Length"] = str(len(body))
            conn.request(self.command, self.path, body=body, headers=headers)
            response = conn.getresponse()
            data = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in HOP and key.lower() != "content-length":
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except OSError as error:
            self.reply(502, f"whisper-server: {error}".encode())
        finally:
            with lock:
                busy -= 1
                last_used = time.monotonic()


def main():
    if not COMMAND:
        sys.exit("usage: whisper-idle.py <whisper-server> [args...]")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)

    def shutdown(*_):
        with lock:
            stop_server()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    threading.Thread(target=reaper, daemon=True).start()
    log(f"listening on :{PORT}; whisper-server starts on demand, stops after {int(IDLE)} s idle")
    server.serve_forever()


if __name__ == "__main__":
    main()
