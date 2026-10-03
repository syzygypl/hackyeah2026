"""Shared helpers for the integration suite and the showcase: start our own rescue-server, talk HTTP. Stdlib only."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(HERE)                       # rescue/
REPO = os.path.dirname(RESCUE)
BIN = os.path.join(RESCUE, ".build", "debug", "rescue-server")


def free_port(start=8790):
    """First port >= start that nobody listens on (never touches other agents' servers)."""
    for p in range(start, start + 200):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError("no free port")


def ensure_binary(rebuild=False):
    if rebuild or not os.path.exists(BIN):
        print("swift build --product rescue-server ...", flush=True)
        subprocess.run(["swift", "build", "--product", "rescue-server"], cwd=RESCUE, check=True)
    return BIN


class Server:
    """Our own rescue-server process. Default: loopback bind, PIN enforced via RESCUE_GUARD_STRICT=1 (behaves like a LAN)."""

    def __init__(self, port, pin, live_file, host="127.0.0.1", strict=True, llm_off=False, extra_env=None, log=None):
        self.port, self.pin, self.live_file, self.host = port, pin, live_file, host
        self.strict, self.llm_off, self.extra_env = strict, llm_off, extra_env or {}
        self.log = log
        self.proc = None

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"

    def start(self, timeout=30):
        env = dict(os.environ)
        env["RESCUE_LIVE_FILE"] = self.live_file
        env["RESCUE_RATE_PER_MIN"] = env.get("RESCUE_RATE_PER_MIN", "1000")   # strict loopback is rate limited like LAN
        if self.strict:
            env["RESCUE_GUARD_STRICT"] = "1"
        if self.llm_off:
            env["RESCUE_LLM_OFF"] = "1"
        else:
            env.pop("RESCUE_LLM_OFF", None)
        env.update(self.extra_env)
        args = [BIN, str(self.port), "--host", self.host]
        if self.pin:
            args += ["--pin", self.pin]
        out = open(self.log, "a") if self.log else subprocess.DEVNULL
        self.proc = subprocess.Popen(args, env=env, stdout=out, stderr=subprocess.STDOUT)
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"rescue-server exited with {self.proc.returncode} (port {self.port})")
            try:
                with urllib.request.urlopen(self.base + "/health", timeout=1) as r:
                    if r.status == 200:
                        return time.time() - t0
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("rescue-server did not answer /health")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None


def http(base, method, path, body=None, headers=None, pin=None, timeout=300, raw=False):
    """-> (status, parsed JSON or text, seconds). Never raises on HTTP errors; raises on connection errors."""
    h = {"Content-Type": "application/json"}
    if pin:
        h["X-Rescue-Pin"] = pin
    h.update(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(base + path, data=data, headers=h, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b, st = r.read(), r.status
    except urllib.error.HTTPError as e:
        b, st = e.read(), e.code
    dt = time.time() - t0
    if raw:
        return st, b, dt
    txt = b.decode("utf-8", "replace")
    try:
        return st, json.loads(txt), dt
    except ValueError:
        return st, txt, dt


def prom(text):
    """Prometheus text -> list of (name, labels dict, value)."""
    out = []
    import re
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        m = re.match(r"^(\w+)(\{([^}]*)\})?\s+(\S+)", line)
        if not m:
            continue
        lab = dict(re.findall(r'(\w+)="([^"]*)"', m.group(3) or ""))
        out.append((m.group(1), lab, float(m.group(4))))
    return out


def metric(text, name, **labels):
    return sum(v for n, l, v in prom(text) if n == name and all(l.get(k) == str(x) for k, x in labels.items()))


def ollama_up(url="http://localhost:11434"):
    try:
        with urllib.request.urlopen(url + "/api/tags", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


class PatrolQueue:
    """Python copy of web/patrol/index.html offline semantics: POST /report (20 s timeout); on any failure the report goes to a
    local queue; flush() (every 8 s on the phone, and after /health answers) resends in order with the suffix
    "(wysłane z opóźnieniem, zdarzenie o HH:MM)" and the ORIGINAL `at`; stops at the first failure."""

    def __init__(self, base, pin, team, client_id):
        self.base, self.pin, self.team, self.client_id = base, pin, team, client_id
        self.queue, self.log, self.online = [], [], True

    def headers(self):
        return {"X-Rescue-Client": self.client_id, "X-Rescue-Team": self.team, "X-Rescue-Source": "patrol"}

    def _post(self, text, at):
        st, d, dt = http(self.base, "POST", "/report", {"text": text, "at": at}, self.headers(), pin=self.pin, timeout=20)
        if st != 200:
            raise RuntimeError(f"HTTP {st}")
        return d, dt

    def report(self, text, at):
        e = {"text": text, "at": at, "status": "sending"}
        self.log.append(e)
        try:
            d, dt = self._post(text, at)
            e.update(status="sent", parsedBy=d.get("parsedBy"), hints=d.get("hints"), latency=dt)
            self.online = True
        except Exception as ex:
            e.update(status="queued", error=str(ex))
            self.queue.append(e)
            self.online = False
        return e

    def ping(self):
        try:
            with urllib.request.urlopen(self.base + "/health", timeout=3):
                self.online = True
        except Exception:
            self.online = False
        return self.online

    def flush(self):
        sent = 0
        for e in list(self.queue):
            try:
                d, dt = self._post(e["text"] + f" (wysłane z opóźnieniem, zdarzenie o {e['at']})", e["at"])
                e.update(status="sent", parsedBy=d.get("parsedBy"), hints=d.get("hints"), latency=dt)
                self.queue.remove(e)
                sent += 1
                self.online = True
            except Exception:
                self.online = False
                break
        return sent
