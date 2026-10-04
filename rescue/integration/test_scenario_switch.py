#!/usr/bin/env python3
"""One app: "Zmień scenariusz" in /app opens the embedded Centrum pick (one iframe, kept) and switches the scenario in place.

    python3 rescue/integration/test_scenario_switch.py                 # own rescue-server on a free port
    python3 rescue/integration/test_scenario_switch.py --base https://rescue-locator.vercel.app

Checks (headless Chrome over CDP, stdlib only; CHROME env = browser path):
1. /app?sc=zawrat&view=3d: 2D and 3D ready. 2. "Zmień scenariusz" -> overlay with the pick iframe (centrum.html?pick=1&embed=1).
3. a click on another scenario in the list -> no page load (window marker and timeOrigin survive), URL ?sc= and #scen follow,
   the overlay closes, 3D and 2D become ready on the new scenario, and the 3D view is never blank meanwhile (double buffer).
4. browser Back -> the previous scenario in place, Forward -> the picked one again, still no page load.
5. the overlay opens again instantly with the same iframe (no reload), Esc closes it. 6. no uncaught page errors.
"""
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Server, ensure_binary, free_port  # noqa: E402
from test_exercise_ui import Cdp, CHROME  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


READY = "(()=>{{try{{return document.getElementById('{f}').contentWindow.document.body.dataset.state==='ready'&&new URL(document.getElementById('{f}').src).searchParams.get('sc')==='{sc}'}}catch(e){{return false}}}})()"
PICKW = "document.querySelector('#pickLayer iframe').contentWindow"


def main():
    base = arg("--base")
    tmp = tempfile.mkdtemp(prefix="rescue-switch-")
    srv = None
    if not base:
        ensure_binary("--rebuild" in sys.argv)
        srv = Server(free_port(8799), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                     log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
        srv.start()
        base = f"http://127.0.0.1:{srv.port}"
    port = free_port(9370)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        c.call("Page.enable")
        print(f"/app scenario switch ({base})")
        c.call("Page.navigate", {"url": f"{base}/app/?sc=zawrat&role=operator&time=hist&mode=akcja&view=3d&nointro=1"})
        check("boot: 3D ready on zawrat", c.until(READY.format(f="frame3d", sc="zawrat"), 180))
        c.js("window.__switchMarker = 42")
        origin = c.js("performance.timeOrigin")
        # 2. the overlay with the pick iframe
        c.js("document.getElementById('scenPick').click()")
        check("overlay shown", c.until("(()=>{const l=document.getElementById('pickLayer');return !!l&&!l.hidden})()", 10))
        check("pick iframe is the embedded Centrum", "pick=1" in (c.js("document.querySelector('#pickLayer iframe').src") or "") and "embed=1" in (c.js("document.querySelector('#pickLayer iframe').src") or ""))
        other = c.until(f"(()=>{{try{{return [...{PICKW}.document.querySelectorAll('#cards .pk[data-sc]')].map(e=>e.dataset.sc).find(s=>s!=='zawrat'&&s!=='studio'&&!/^zapora-tlo/.test(s))||null}}catch(e){{return null}}}})()", 180)
        check("pick list lists another scenario", bool(other), str(other))
        iframe_origin = c.js(f"{PICKW}.performance.timeOrigin")
        # 3. pick -> in place; sample the visible 3D view meanwhile (blank = the frame with id frame3d is not ready)
        c.js("window.__blank3d=0;window.__t3d=setInterval(()=>{try{const f=document.getElementById('frame3d');if(!f||f.contentWindow.document.body.dataset.state!=='ready')window.__blank3d++}catch(e){window.__blank3d++}},50)")
        c.js(f"[...{PICKW}.document.querySelectorAll('#cards .pk[data-sc]')].find(e=>e.dataset.sc==={other!r}).click()")
        check("overlay closes on pick", c.until("document.getElementById('pickLayer').hidden", 10))
        check("URL follows (?sc=)", c.until(f"new URLSearchParams(location.search).get('sc')==={other!r}", 10), c.js("location.search"))
        check("scenario select follows", c.until(f"document.getElementById('scen').value==={other!r}", 30))
        check("3D ready on the new scenario", c.until(READY.format(f="frame3d", sc=other), 240))
        blank = c.js("(clearInterval(window.__t3d),window.__blank3d)") or 0
        check("3D never blank during the switch (double buffer)", blank == 0, f"blank samples: {blank}")
        check("no page load (marker + timeOrigin)", c.js("window.__switchMarker") == 42 and c.js("performance.timeOrigin") == origin)
        # 4. Back / Forward in place
        c.js("history.back()")
        check("Back -> zawrat in place", c.until("document.getElementById('scen').value==='zawrat'&&new URLSearchParams(location.search).get('sc')==='zawrat'", 30))
        check("Back: 3D ready on zawrat", c.until(READY.format(f="frame3d", sc="zawrat"), 240))
        c.js("history.forward()")
        check("Forward -> picked scenario again", c.until(f"document.getElementById('scen').value==={other!r}", 30))
        check("Back/Forward: no page load", c.js("window.__switchMarker") == 42 and c.js("performance.timeOrigin") == origin)
        # 2D on the current scenario (view switch: the warm 2D view takes the new run)
        c.js("window.rescueApp.setView ? window.rescueApp.setView('2d') : document.querySelector('[data-view=\"2d\"]')?.click()")
        check("2D ready on the picked scenario", c.until(READY.format(f="frame2d", sc=other), 120))
        # 5. reopen: the same iframe (no reload), Esc closes
        c.js("document.getElementById('scenPick').click()")
        check("overlay reopens", c.until("!document.getElementById('pickLayer').hidden", 5))
        check("same pick iframe, not reloaded", c.js(f"{PICKW}.performance.timeOrigin") == iframe_origin and c.js("document.querySelectorAll('#pickLayer iframe').length") == 1)
        c.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
        c.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
        check("Esc closes the overlay", c.until("document.getElementById('pickLayer').hidden", 5))
        time.sleep(1)
        c.js("1")
        errs = [e for e in c.errors if "version.json" not in str(e)]
        check("no uncaught page errors", not errs, "; ".join(map(str, errs))[:300])
    finally:
        chrome.kill()
        if srv:
            srv.stop()
    print("FAIL: " + ", ".join(FAILS) if FAILS else "OK")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
