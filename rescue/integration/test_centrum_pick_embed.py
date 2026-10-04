#!/usr/bin/env python3
"""Centrum pick mode embedded in an iframe (centrum.html?pick=1&embed=1, CONTRACT.md "Centrum pick mode, embedded") in headless
Chrome: a same-origin parent page hosts the iframe and checks the postMessage contract. rl-pick-ready on load, no header,
rl-pick-current marks another scenario without reloading the iframe, a click posts rl-pick (no navigation), polling pauses
while hidden and rl-pick-show refreshes in the background, Esc and Wróć post rl-pick-cancel. Then the old full-page flow
(pick=1 without embed) still navigates back with ?sc=. Read-only: GET pages only, no state is written.

    python3 rescue/integration/test_centrum_pick_embed.py [--rebuild] [--server <binary>]
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


W = "document.getElementById('f').contentWindow"
D = f"{W}.document"
MSGS = "JSON.stringify(window.msgs||[])"
N_INC = f"{W}.performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/incidents')).length"
N_ADV = f"{W}.performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/advisor')).length"


def msgs(c):
    return json.loads(c.js(MSGS) or "[]")


def post(c, m):
    c.js(f"{W}.postMessage({json.dumps(m)}, location.origin)")


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-centrum-pick-")
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
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        # parent: any same-origin document, replaced by a page that only holds the iframe and records its messages
        c.call("Page.navigate", {"url": f"{srv.base}/app/__pick-embed-parent"})
        c.until("document.readyState==='complete'", 20)
        c.js("document.open();document.write('<!doctype html><body style=\"margin:0;background:#123\"><iframe id=\"f\" "
             "src=\"/app/centrum.html?pick=1&embed=1&sc=zawrat\" style=\"width:1400px;height:860px;border:0\"></iframe></body>');document.close();"
             "window.msgs=[];addEventListener('message',e=>{if(e.source===document.getElementById('f').contentWindow)msgs.push(e.data)});true")
        ready = c.until(f"(window.msgs||[]).some(m=>m.type==='rl-pick-ready')", 20)
        check("ready_message", bool(ready), c.js(MSGS))
        n = c.until(f"(()=>{{try{{return {D}.querySelectorAll('#cards .pk[data-sc]').length}}catch(e){{return 0}}}})()", 60)
        check("list_renders", bool(n), f"{n} scenarios")
        c.js(f"{W}.performance.setResourceTimingBufferSize(100000)")   # map tiles would fill the default 250 entries
        ui = c.js(f"(()=>{{const d={D},w={W};return {{bar:w.getComputedStyle(d.getElementById('bar')).display,"
                  f"bg:w.getComputedStyle(d.body).backgroundColor,back:!!d.querySelector('#list h2 #pickBack'),cls:d.body.className}}}})()")
        check("no_header_chrome", ui and ui["bar"] == "none" and ui["back"], json.dumps(ui))
        check("transparent_background", ui and ui["bg"] in ("rgba(0, 0, 0, 0)", "transparent"), ui and ui["bg"])
        cur = c.until(f"(()=>{{const e={D}.querySelector('#cards .pk.cur');return e&&e.dataset.sc}})()", 10)
        check("current_from_url", cur == "zawrat", str(cur))
        origin = c.js(f"{W}.performance.timeOrigin")
        other = c.js(f"[...{D}.querySelectorAll('#cards .pk[data-sc]')].map(e=>e.dataset.sc).find(s=>s!=='zawrat'&&s!=='studio')")
        post(c, {"type": "rl-pick-current", "sc": other})
        cur2 = c.until(f"(()=>{{const e={D}.querySelector('#cards .pk.cur');return e&&e.dataset.sc==={json.dumps(other)}&&e.dataset.sc}})()", 5)
        check("rl_pick_current_marks_without_reload", cur2 == other and c.js(f"{W}.performance.timeOrigin") == origin, f"{other}")
        # a click posts rl-pick and does not navigate
        href0 = c.js(f"{W}.location.href")
        c.js(f"{D}.querySelector('#cards .pk[data-sc={json.dumps(other)}]').click()")
        got = c.until(f"(window.msgs||[]).find(m=>m.type==='rl-pick')", 5)
        time.sleep(0.5)
        check("click_posts_rl_pick", bool(got) and got.get("sc") == other, json.dumps(got))
        check("click_does_not_navigate", c.js(f"{W}.location.href") == href0 and c.js(f"{W}.performance.timeOrigin") == origin)
        # hidden after the pick: no polling; rl-pick-show refreshes in the background, the list stays on screen meanwhile
        c.js("document.getElementById('f').style.display='none'")
        i0, a0 = c.js(N_INC), c.js(N_ADV)
        time.sleep(11.5)   # POLL_MS = 10 s
        i1 = c.js(N_INC)
        check("no_polling_while_hidden", i1 == i0, f"/api/incidents {i0} -> {i1}")
        c.js("document.getElementById('f').style.display=''")
        post(c, {"type": "rl-pick-show", "sc": other})
        listed = c.js(f"{D}.querySelectorAll('#cards .pk[data-sc]').length")
        check("reopen_shows_cached_list", bool(listed), f"{listed} scenarios at once")
        refreshed = c.until(f"{N_INC} > {i1} && {N_ADV} > {a0}", 10)
        check("show_refreshes_in_background", bool(refreshed), f"/api/incidents {i1} -> {c.js(N_INC)}, /api/advisor {a0} -> {c.js(N_ADV)}")
        check("reopen_does_not_reload", c.js(f"{W}.performance.timeOrigin") == origin)
        # Esc and Wróć post rl-pick-cancel
        c.js("window.msgs=[]")
        c.js(f"(()=>{{const w={W};return w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{{key:'Escape',bubbles:true}}))}})()")
        esc = c.until("(window.msgs||[]).some(m=>m.type==='rl-pick-cancel')", 5)
        check("esc_posts_cancel", bool(esc), c.js(MSGS))
        post(c, {"type": "rl-pick-show"})
        c.js("window.msgs=[]")
        c.js(f"{D}.getElementById('pickBack').click()")
        back = c.until("(window.msgs||[]).some(m=>m.type==='rl-pick-cancel')", 5)
        check("wroc_posts_cancel", bool(back) and c.js(f"{W}.performance.timeOrigin") == origin, c.js(MSGS))
        # a map dot posts rl-pick too (when the map came up in headless)
        mk = c.until(f"{D}.querySelectorAll('.mk').length", 20)
        if mk:
            c.js("window.msgs=[]")
            c.js(f"{D}.querySelector('.mk').click()")
            got = c.until("(window.msgs||[]).find(m=>m.type==='rl-pick')", 5)
            check("map_dot_posts_rl_pick", bool(got) and bool(got.get("sc")), json.dumps(got))
        errs = list(c.errors)
        # fallback: pick=1 without embed keeps the full-page flow back to /app with ?sc=
        c.call("Page.navigate", {"url": f"{srv.base}/app/centrum.html?pick=1&return=" + "%2Fapp%2F%3Frole%3Doperator%26sc%3Dzawrat"})
        c.until("document.readyState==='complete'", 20)
        n = c.until("document.querySelectorAll('#cards .pk[data-sc]').length", 60)
        fb = c.js("(()=>({bar:getComputedStyle(document.getElementById('bar')).display,embed:document.body.classList.contains('embed')}))()")
        check("fallback_has_header", bool(n) and fb["bar"] != "none" and not fb["embed"], json.dumps(fb))
        sc = c.js(f"[...document.querySelectorAll('#cards .pk[data-sc]')].map(e=>e.dataset.sc).find(s=>s!=='zawrat'&&s!=='studio')")
        c.js(f"document.querySelector('#cards .pk[data-sc={json.dumps(sc)}]').click()")
        nav = c.until(f"location.pathname.endsWith('/app/') && new URLSearchParams(location.search).get('sc')==={json.dumps(sc)} && location.href", 20)
        check("fallback_click_navigates_back", bool(nav), str(nav))
        check("no_js_exceptions", not errs, "; ".join(map(str, errs))[:200])
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
