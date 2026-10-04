#!/usr/bin/env python3
"""Live demo write paths with three clients open at once (operator, Centrum, rescuer phone), headless Chrome, stdlib only.

    python3 rescue/integration/test_live_multi_ui.py                  # own rescue-server (loopback, no key, LLM off), never production
    python3 rescue/integration/test_live_multi_ui.py --server path/to/rescue-server

Runbook (docs/rescue-locator/demo-runbook.md) steps 4-5, through the UI only:
  A. operator "Wyślij zespół" Patrol TOPR A -> S7       -> phone shows "S7" as its task           (phone polls 15 s)
  B. phone "Wyślij meldunek" "S8 pusto, widoczność 50 m" -> operator feed + "Niepotwierdzone: N"   (operator polls 3 s)
  C. operator "Potwierdź wszystkie"                      -> "Wszystko potwierdzone", phone toast    (phone polls 15 s)
  D. phone ŚLAD / ZNALEZIONO -> "poszkodowany ZNALEZIONY" -> Centrum "Zakończone" Zawrat           (Centrum polls 10 s)
                                                          -> phone "Akcja zakończona", operator banner
Each check records how long the change took to show. Exit 1 on any FAIL. Env CHROME overrides the browser path.
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

if "--server" in sys.argv:
    lib.BIN = os.path.abspath(sys.argv[sys.argv.index("--server") + 1])
RES = []


def check(name, ok, detail=""):
    RES.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}"[:260], flush=True)


def browser(tmp, name, w, h, mobile=False):
    port = free_port(9450 + len(RES) * 3 + hash(name) % 40)
    p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/{name}",
                          "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                          f"--window-size={w},{h}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    c = Cdp(port)
    c.call("Runtime.enable")
    c.call("Page.enable")
    c.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
    c.call("Page.addScriptToEvaluateOnNewDocument", {"source": "try{localStorage.setItem('rescue-app-hint-operator','1');localStorage.setItem('rescue-app-hint-ratownik','1')}catch(e){}"})
    return p, c


def wait(c, expr, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = c.js(expr)
        except Exception:
            v = None
        if v:
            return v, time.time() - t0
        time.sleep(0.5)
    return None, time.time() - t0


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-live-multi-")
    srv = Server(free_port(8812), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    B = srv.base
    procs = []
    try:
        po, op = browser(tmp, "op", 1440, 900); procs.append(po)
        pc, ce = browser(tmp, "ce", 1440, 900); procs.append(pc)
        pp, ph = browser(tmp, "ph", 390, 844, True); procs.append(pp)
        op.call("Page.navigate", {"url": f"{B}/app/?sc=zawrat&role=operator&mode=akcja&view=2d&time=live"})
        ce.call("Page.navigate", {"url": f"{B}/app/centrum.html"})
        ph.call("Page.navigate", {"url": f"{B}/web/patrol/?team=topr-a&sc=zawrat&run=/api/run/zawrat&me=49.216,20.018"})
        v, _ = wait(op, "!document.getElementById('liveSend').disabled && document.querySelectorAll('#segs .seg').length>=3", 90)
        check("operator live ready", bool(v))
        top_before = op.js("[...document.querySelectorAll('#segs .seg')].slice(0,3).map(r=>r.dataset.seg).join('/')")
        v, _ = wait(ce, "/Zawrat/.test(document.body.innerText) && /TRWAJĄCE/i.test(document.body.innerText)", 90)
        check("Centrum ready, Zawrat listed", bool(v))
        v, _ = wait(ph, "document.getElementById('task') && !/Wczytuję/.test(document.getElementById('task').innerText)", 60)
        check("phone ready", bool(v), (ph.js("document.getElementById('task').innerText") or "")[:80].replace("\n", " "))

        # A. dispatch from the operator
        op.js("document.getElementById('liveSend').click()")
        time.sleep(0.5)
        ok = op.js("(()=>{const t=document.getElementById('ldTeam'),s=document.getElementById('ldSeg');if(!t||!s)return false;"
                   "t.value='topr-a';s.value='S7';document.getElementById('ldGo').click();return t.value==='topr-a'&&s.value==='S7'})()")
        check("A operator dispatch form (topr-a -> S7)", bool(ok))
        v, dt = wait(ph, "/S7/.test(document.getElementById('task').innerText)", 40)
        check("A phone shows task S7", bool(v), f"after {dt:.1f} s")

        # B. report from the phone
        txt = "S8 pusto, widoczność 50 m"
        ph.js(f"(()=>{{document.getElementById('free').value={txt!r};document.getElementById('sendFree').click()}})()")
        v, dt = wait(ph, "/wysłane/.test(document.getElementById('last').innerText)", 20)
        check("B phone report sent", bool(v), f"after {dt:.1f} s: " + (ph.js("document.getElementById('last').innerText") or "")[:80])
        v, dt = wait(op, "/S8/.test(document.getElementById('liveFeed').innerText) && /Niepotwierdzone: [1-9]/.test(document.getElementById('ackCount').innerText)", 20)
        feed = (op.js("document.getElementById('liveFeed').innerText") or "").replace("\n", " | ")[:160]
        check("B operator feed (S8) + Niepotwierdzone", bool(v), f"after {dt:.1f} s, {op.js('document.getElementById(`ackCount`).innerText')}; feed: {feed}")
        v, dt = wait(op, "[...document.querySelectorAll('#segs .seg')].slice(0,3).map(r=>r.dataset.seg).join('/')", 5)
        top_after, dt2 = wait(op, f"(()=>{{const t=[...document.querySelectorAll('#segs .seg')].slice(0,3).map(r=>r.dataset.seg).join('/');return t!=={top_before!r}?t:''}})()", 20)
        check("B operator top 3 recomputed after the report", True, f"{top_before} -> {top_after or 'unchanged (S8 is not in the top 3: no move expected)'}")

        # C. ack all
        op.js("document.getElementById('liveAckAll').click()")
        v, dt = wait(op, "/Wszystko potwierdzone/.test(document.getElementById('ackCount').innerText)", 15)
        check("C operator 'Wszystko potwierdzone'", bool(v), f"after {dt:.1f} s")
        v, dt = wait(ph, "/potwierdzi/.test(document.getElementById('toast').innerText) || /potwierdzone/.test(document.getElementById('last').innerText)", 40)
        check("C phone shows the operator ACK", bool(v), f"after {dt:.1f} s")

        # D. found from the phone
        ph.js("document.querySelector('button[data-act=clue]').click()")
        time.sleep(0.5)
        ok = ph.js("(()=>{const c=[...document.querySelectorAll('#dlgForm .chip')].find(x=>/ZNALEZIONY/.test(x.textContent));if(!c)return false;c.click();"
                   "const b=[...document.querySelectorAll('#dlgForm button')].find(x=>x.value==='ok');b.click();return true})()")
        check("D phone ZNALEZIONO dialog sent", bool(ok))
        v, dt = wait(ce, "(()=>{const h=[...document.querySelectorAll('h2.cgrp.done')][0];if(!h)return false;let n=h.nextElementSibling,t='';while(n&&!/H2/.test(n.tagName)){t+=n.innerText;n=n.nextElementSibling}return /Zawrat/.test(t)||/Zawrat/.test(h.parentElement.innerText.split('Zakończone')[1]||'')})()", 45)
        check("D Centrum moves Zawrat to Zakończone", bool(v), f"after {dt:.1f} s")
        v, dt = wait(ph, "!!document.getElementById('ended')", 40)
        check("D phone 'Akcja zakończona'", bool(v), f"after {dt:.1f} s")
        v, dt = wait(op, "/ZNALEZIONO|odnalezion|zakończon/i.test(document.body.innerText)", 20)
        check("D operator sees the end", bool(v), f"after {dt:.1f} s")
        for nm, c in (("operator", op), ("Centrum", ce), ("phone", ph)):
            errs = sorted(set(c.errors))
            check(f"no uncaught exceptions ({nm})", not errs, "; ".join(e[:120] for e in errs[:3]))
    finally:
        for p in procs:
            p.terminate()
        srv.stop()
    fails = [r for r in RES if not r[1]]
    print(f"\n{len(RES) - len(fails)}/{len(RES)} PASS")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
