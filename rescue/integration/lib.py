"""Shared helpers for the integration suite and the showcase: start our own rescue-server, talk HTTP. Stdlib only."""
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(HERE)                       # rescue/
REPO = os.path.dirname(RESCUE)
SWIFT_BIN = os.path.join(RESCUE, ".build", "debug", "rescue-server")
RUST_BIN = os.path.join(RESCUE, "rs", "target", "release", "rescue-server")
MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def default_binary():
    """Env RESCUE_SERVER, else the Swift build (macOS, or wherever swift is installed or already built), else the Rust port."""
    if os.environ.get("RESCUE_SERVER"):
        return os.path.abspath(os.environ["RESCUE_SERVER"])
    if os.path.exists(SWIFT_BIN) or shutil.which("swift"):
        return SWIFT_BIN
    return RUST_BIN


BIN = default_binary()


def find_chrome():
    """Browser for the headless UI tests. Env CHROME (or CHROME_PATH) wins; then macOS Google Chrome (unchanged default);
    then google-chrome / chromium on PATH; then Playwright's bundled Chromium (~/.cache/ms-playwright, PLAYWRIGHT_BROWSERS_PATH)."""
    for k in ("CHROME", "CHROME_PATH"):
        if os.environ.get(k):
            return os.environ[k]
    if sys.platform == "darwin" or os.path.exists(MAC_CHROME):
        return MAC_CHROME
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        p = shutil.which(name)
        if p:
            return p
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or os.path.expanduser("~/.cache/ms-playwright")
    ver = lambda p: int((re.search(r"-(\d+)/", p) or [0, 0])[1])   # noqa: E731  chromium-1243/... -> 1243
    for pat in ("chromium-*/chrome-linux*/chrome", "chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell"):
        hits = sorted(glob.glob(os.path.join(root, pat)), key=ver, reverse=True)
        if hits:
            return hits[0]
    return MAC_CHROME   # nothing found: the launch fails and Cdp says to set CHROME


CHROME = find_chrome()


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
    """Build BIN when missing (or on rebuild): swift for the Swift server, cargo --release for the Rust port (rescue/rs)."""
    if not (rebuild or not os.path.exists(BIN)):
        return BIN
    if os.path.abspath(BIN) == SWIFT_BIN:
        print("swift build --product rescue-server ...", flush=True)
        subprocess.run(["swift", "build", "--product", "rescue-server"], cwd=RESCUE, check=True)
    elif os.path.abspath(BIN) == RUST_BIN:
        cargo = shutil.which("cargo") or os.path.expanduser("~/.cargo/bin/cargo")
        print(f"{cargo} build --release --bin rescue-server (rescue/rs) ...", flush=True)
        subprocess.run([cargo, "build", "--release", "--bin", "rescue-server"], cwd=os.path.join(RESCUE, "rs"), check=True)
    elif not os.path.exists(BIN):
        raise RuntimeError(f"rescue-server binary not found: {BIN}")
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
        env.setdefault("RESCUE_DIR", RESCUE)   # serve this checkout (same meaning in Swift and Rust)
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
