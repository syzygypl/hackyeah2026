#!/usr/bin/env python3
"""Centrum timeline (Oś czasu) in headless Chrome: Gantt rows, markers with a tooltip, a marker opens Historia at that
clock (/app ?time=hist&t=HH:MM), scrub and play move the cursor, Na żywo resets, phone (390 px) opens the Gantt with a
button and does not scroll sideways, no JS exceptions. Read-only: GET pages only, no state is written.

    python3 rescue/integration/test_centrum_timeline.py [--rebuild] [--server <binary>]
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
from test_exercise_ui import CHROME, Cdp  # noqa: E402  (same minimal DevTools client)

if "--server" in sys.argv:
    lib.BIN = os.path.abspath(sys.argv[sys.argv.index("--server") + 1])

FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


def open_page(c, url, w, h, mobile):
    c.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
    c.call("Page.navigate", {"url": url})
    c.until("document.readyState==='complete'", 20)


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-centrum-tl-")
    srv = Server(free_port(8799), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    port = free_port(9360)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        # desktop: rows, markers, tooltip
        open_page(c, f"{srv.base}/app/centrum.html", 1440, 900, False)
        rows = c.until("(()=>{const t=document.getElementById('tl');return t&&!t.hidden?document.querySelectorAll('#tl .tlr').length:0})()", 60)
        check("timeline_rows", bool(rows), f"{rows} incident rows")
        marks = c.until("document.querySelectorAll('#tl .tlr .tlk[data-at]').length", 10)
        check("markers_have_clock", bool(marks), f"{marks} markers")
        tip = c.js("(()=>{const k=document.querySelector('#tl .tlr:not(.off) .tlk[data-at]');k.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));"
                   "const t=[...document.querySelectorAll('body > .tltip')].pop();return t&&!t.hidden?t.innerText:''})()")
        check("marker_tooltip", bool(tip) and ":" in tip and "Historia" in tip, (tip or "").replace("\n", " | ")[:90])

        # scrub on the mini strip, play, Na żywo
        c.js("document.getElementById('tl').classList.add('peek')")
        x = c.js("(()=>{const r=document.querySelector('#tlMini .trk').getBoundingClientRect();const b=document.getElementById('tlBody');"
                 "const o={clientX:r.left+r.width*0.5,clientY:r.top+r.height/2,bubbles:true,button:0,pointerId:1};"
                 "b.dispatchEvent(new PointerEvent('pointerdown',o));b.dispatchEvent(new PointerEvent('pointerup',o));return document.getElementById('tlNow').innerText})()")
        check("scrub_sets_cursor", bool(x) and "Na żywo" not in x and not c.js("document.getElementById('tlCur').hidden"), (x or "")[:60])
        p0 = c.js("getComputedStyle(document.getElementById('tlCur')).getPropertyValue('--p')")
        c.js("document.getElementById('tlPlay').click()")
        time.sleep(1.5)
        p1 = c.js("getComputedStyle(document.getElementById('tlCur')).getPropertyValue('--p')")
        c.js("document.getElementById('tlPlay').click()")
        check("play_moves_cursor", p0 is not None and p1 is not None and float(p1 or 0) > float(p0 or 0), f"{p0} -> {p1}")
        c.js("document.getElementById('tlLive').click()")
        check("live_resets", "Na żywo" in (c.js("document.getElementById('tlNow').innerText") or "") and c.js("document.getElementById('tlCur').hidden") is True)

        # a marker opens Historia at that clock
        tgt = c.js("(()=>{const k=document.querySelector('#tl .tlr:not(.off) .tlk[data-at]');return {sc:k.dataset.sc,at:k.dataset.at}})()")
        c.js("document.querySelector('#tl .tlr:not(.off) .tlk[data-at]').click()")
        url = c.until("location.pathname.endsWith('/app/') || location.pathname.endsWith('/app/index.html') ? location.href : ''", 20) or ""
        check("marker_opens_historia", f"sc={tgt['sc']}" in url and "time=hist" in url and "t=" in url, url[-90:])
        clock = c.until("(()=>{const d=document.getElementById('dkStep');return d&&/\\d\\d:\\d\\d/.test(d.innerText)?d.innerText:''})()", 60) or ""
        check("historia_at_marker_clock", tgt["at"][:5] in clock, f"marker {tgt['at']} dock '{clock[:30]}'")
        errs_desktop = list(c.errors)

        # phone: a button opens the Gantt, no sideways scroll
        c.errors.clear()
        open_page(c, f"{srv.base}/app/centrum.html", 390, 844, True)
        c.until("(()=>{const t=document.getElementById('tl');return t&&!t.hidden})()", 60)
        c.js("document.getElementById('tlMore').click()")
        check("phone_button_opens_gantt", c.js("document.getElementById('tl').classList.contains('peek') && document.querySelectorAll('#tl .tlr').length>0") is True)
        sw = c.js("[document.documentElement.scrollWidth, innerWidth]")
        check("phone_no_sideways_scroll", bool(sw) and sw[0] <= sw[1] + 1, json.dumps(sw))
        check("no_js_exceptions", not errs_desktop and not c.errors, "; ".join(map(str, errs_desktop + c.errors))[:200])
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
