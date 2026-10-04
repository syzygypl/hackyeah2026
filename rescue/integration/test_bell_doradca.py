#!/usr/bin/env python3
"""Doradca ALARM in the bell (Centrum, Symulacja 24/7; livefeed.js extraNotes + centrum.js advNotes): with the clock pinned after the
2nd dam incident starts, the bell holds a Doradca note (time = that start, title = the hypothesis), a toast shows it, Otwórz opens the
Doradca panel on that hypothesis, Potwierdź keeps it acked after a reload (local only: no 404 that would switch shared ACKs off),
and before the 2nd start there is no such note. No JS exceptions.

    python3 rescue/integration/test_bell_doradca.py [--rebuild] [--server <binary>]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Server, ensure_binary, free_port  # noqa: E402
from test_exercise_ui import CHROME, Cdp  # noqa: E402

if "--server" in sys.argv:
    lib.BIN = os.path.abspath(sys.argv[sys.argv.index("--server") + 1])

FAILS = []
SCHED = os.path.join(lib.RESCUE, "scenarios", "schedule", "schedule-24h.json")


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


def mins(c):
    h, m = c.split(":")
    return int(h) * 60 + int(m)


def hhmm(m):
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def open_page(c, url):
    c.call("Page.navigate", {"url": url})
    c.until("document.readyState==='complete'", 20)


def main():
    es = json.load(open(SCHED))["entries"]
    # the morning dam cluster: its 2nd start is when Doradca can link the incidents
    grp = next(e["group"] for e in es if e.get("group", "").startswith("zapora@") and 360 <= mins(e["start"]) <= 600)
    starts = sorted(mins(e["start"]) for e in es if e.get("group") == grp)
    second = starts[1]
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-bell-doradca-")
    srv = Server(free_port(8895), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    port = free_port(9455)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    notes = "JSON.stringify((window.rescueSim&&rescueSim.bell?rescueSim.bell.notes:[]).filter(n=>n.type==='adv').map(n=>[n.key,n.title,n.ms]))"
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        base = f"{srv.base}/app/centrum.html?sim=1"
        open_page(c, base)
        c.js("localStorage.removeItem('rescue-live-acks');localStorage.setItem('rescue-advisor-open','0')")
        # before the 2nd start: no Doradca note
        open_page(c, f"{base}&simAt={hhmm(second - 3)}")
        c.until("window.rescueSim&&rescueSim.bell?1:0", 30)
        time.sleep(12)
        pre = json.loads(c.js(notes) or "[]")
        check("no_note_before_2nd_start", not pre, f"{grp} 2nd start {hhmm(second)}: {pre}")
        # 4 min after it: the note, its toast, Otwórz opens Doradca on it
        open_page(c, f"{base}&simAt={hhmm(second + 4)}")
        got = c.until(f"(()=>{{const n=JSON.parse({notes});return n.length?JSON.stringify(n):''}})()", 60)
        lst = json.loads(got or "[]")
        t0 = c.js("window.rescueSim.lf.warsaw(%d).min" % (lst[0][2] if lst else 0)) if lst else None
        check("note_at_2nd_start", bool(lst) and t0 is not None and int(t0) == second, f"{lst[:1]} at minute {t0}, want {second}")
        key = lst[0][0] if lst else "none"
        toast = c.until(f"(()=>{{const t=document.querySelector('.lftoast.t-adv [data-key=\"{key}\"]');return t?t.innerText:''}})()", 20)
        check("toast_shows_doradca", bool(toast) and "doradca" in toast.lower() and "otwórz" in toast.lower(), (toast or "").replace("\n", " | ")[:120])
        c.js(f"document.querySelector('.lftoast [data-key=\"{key}\"] .lfopen').click()")
        op = c.until("(()=>{const a=document.getElementById('advisor');return a&&!a.classList.contains('closed')&&a.querySelector('.advtabs button.on, h3')?a.querySelector('h3').innerText:''})()", 15)
        check("open_selects_hypothesis", bool(op) and lst and op.strip() == lst[0][1].strip(), f"panel '{op}' vs note '{lst[0][1] if lst else ''}'")
        # ACK, local only, survives a reload; no server 404 on an adv id
        c.js("document.querySelector('.lfbell').click()")
        c.until(f"document.querySelector('.lfpanel:not([hidden]) [data-key=\"{key}\"] .lfack')?1:0", 10)
        c.js(f"document.querySelector('.lfpanel [data-key=\"{key}\"] .lfack').click()")
        time.sleep(0.5)
        open_page(c, f"{base}&simAt={hhmm(second + 4)}")
        c.until(f"(()=>{{const n=JSON.parse({notes});return n.length?1:0}})()", 60)
        acked = c.js(f"!!window.rescueSim.lf.acks.get({json.dumps(key)})")
        again = c.js(f"!!document.querySelector('.lftoast [data-key=\"{key}\"]')")
        check("ack_persists_no_toast", acked is True and again is False, f"acked={acked} toast again={again}")
        check("no_js_exceptions", not c.errors, "; ".join(map(str, c.errors))[:200])
    finally:
        chrome.terminate()
        try:
            chrome.wait(5)
        except Exception:
            chrome.kill()
        srv.stop()
        shutil.rmtree(tmp, ignore_errors=True)
    print(("OK" if not FAILS else "FAIL") + f": {len(FAILS)} failed {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
