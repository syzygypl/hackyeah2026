#!/usr/bin/env python3
"""Czat (chat mode) UI smoke test: headless Chrome over the DevTools protocol, stdlib only (Cdp from test_exercise_ui).

    python3 rescue/integration/test_chat_ui.py                         # own rescue-server on a free port (loopback: live writes allowed)
    python3 rescue/integration/test_chat_ui.py --base https://rescue-locator.vercel.app [--shots docs/rescue-locator/shots]

Walks the chat like a user, 4 example messages each:
  1. /app Historia: message -> confirmation card (mini map) -> "Dodaj (symulacja)" -> new top 3 + moves; the shell shows the
     what-if run (store.runUrl is a blob:); "Cofnij" on the last one.
  2. /app Na żywo (own server only, loopback = no key): sighting -> POST /api/clue -> top 3 -> "Cofnij" (clue weight 0).
  0. Safe failure: an incomprehensible, an empty and an absurd entry -> a chat message, no card, run and view unchanged.
  3. czat.html (casual view): "Widziałem kogoś" -> asks where -> "przy Wielkim Stawie" -> card -> Dodaj -> top 3.
Fails on any uncaught page exception. Screenshots: czat-*.jpg into --shots when given.
"""
import base64
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
MSGS = [
    "Turystka widziała go o 14:20 przy Czarnym Stawie, szedł w stronę Zawratu",
    "Zespół B przeszukał S3, nic",
    "Znaleziono plecak 200 m na północ od schroniska",
    "Mgła od 16:00, widoczność 50 m",
]


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:300], flush=True)
    if not cond:
        FAILS.append(name)


def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


def shot(c, shots, name):
    if not shots:
        return
    r = c.call("Page.captureScreenshot", {"format": "jpeg", "quality": 72})
    if r and r.get("data"):
        os.makedirs(shots, exist_ok=True)
        with open(os.path.join(shots, name), "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("    shot", os.path.join(shots, name))


LAST_RES = "(()=>{const r=[...document.querySelectorAll('.ch-msg.res')].pop();return r?r.innerText:''})()"
N_RES = "document.querySelectorAll('.ch-msg.res').length"
N_CARD = "document.querySelectorAll('.ch-card').length"


def send(c, text, add=True, timeout=60):
    n0, r0 = c.js(N_CARD) or 0, c.js(N_RES) or 0
    c.js(f"window.rescueChat.chat.onText({text!r})")
    ok = c.until(f"{N_CARD} > {n0}", 20)
    card = c.js("(()=>{const k=[...document.querySelectorAll('.ch-card')].pop();return k?k.innerText:''})()") or ""
    if not ok or not add:
        return card, ""
    c.js("[...document.querySelectorAll('.ch-card .ch-add')].pop().click()")
    c.until(f"{N_RES} > {r0}", timeout)
    return card, c.js(LAST_RES) or ""


def main():
    base, shots = arg("--base"), arg("--shots")
    tmp = tempfile.mkdtemp(prefix="rescue-chat-ui-")
    srv = None
    if not base:
        ensure_binary("--rebuild" in sys.argv)
        srv = Server(free_port(8799), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                     log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
        srv.start()
        base = f"http://127.0.0.1:{srv.port}"
    port = free_port(9360)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        c.call("Page.enable")
        # ---- 1. /app Historia (what-if)
        print(f"/app Historia ({base})")
        c.call("Page.navigate", {"url": f"{base}/app/?sc=zawrat&role=operator&time=hist&mode=akcja&view=2d&chat=1"})
        check("app + chat loaded", c.until("!!(window.rescueChat && window.rescueStore && window.rescueStore.run && document.querySelector('.ch-chip'))", 60))
        c.until("document.getElementById('frame2d').contentWindow.document.body.dataset.state==='ready'", 40)
        # safe failure: an incomprehensible, an empty and an absurd entry leave the run and the view untouched
        c.js("window.__chk = window.rescueStore.run; window.__chkUrl = window.rescueStore.runUrl")
        n0 = c.js(N_CARD) or 0
        c.js("window.rescueChat.chat.onText('asdf qwerty zzz')")
        check("garbage -> message, no card", c.until("[...document.querySelectorAll('.ch-msg.bot')].some(e=>e.textContent.includes('Nie rozpoznałem'))", 10) and (c.js(N_CARD) or 0) == n0)
        c.js("window.rescueChat.chat.onText('')")
        check("empty -> hint, no card", c.until("!!document.querySelector('.ch-msg.empty')", 10) and (c.js(N_CARD) or 0) == n0)
        c.js("window.rescueChat.chat.onText('x'.repeat(5000) + ' 99:99 S999 ' + '%'.repeat(200))")
        time.sleep(1)
        check("absurd entry -> no card", (c.js(N_CARD) or 0) == n0)
        check("run and view unchanged", c.js("window.rescueStore.run === window.__chk && window.rescueStore.runUrl === window.__chkUrl"))
        # no blank 2D: sample the visible 2D frame every 40 ms; the double buffer keeps a ready map on screen the whole time
        c.js("window.__blank=0;window.__blankT=setInterval(()=>{try{const f=document.getElementById('frame2d');if(!f||f.contentWindow.document.body.dataset.state!=='ready')window.__blank++}catch(e){window.__blank++}},40)")
        for i, m in enumerate(MSGS, 1):
            t0 = time.time()
            card, res = send(c, m)
            check(f"H{i} card", "zaznaczę" in card or "Oznaczę" in card or "pogody" in card, card.replace("\n", " | ")[:200])
            check(f"H{i} top 3", "obszaru" in res and "%" in res, res.replace("\n", " | ")[:220])
            check(f"H{i} no POA %", "POA" not in res)
            if i == 1:
                check("H1 shell shows the what-if run", c.js("String(window.rescueStore.runUrl||'').startsWith('blob:')"))
                check("H1 mini map drawn", c.js("!!document.querySelector('.ch-card svg.ch-mini path')"))
            time.sleep(2.5)   # the 2D view reloads with the what-if run: shoot once it is ready again
            c.until("(()=>{try{const w=document.getElementById('frame2d').contentWindow;return w.location.href.includes(encodeURIComponent(window.rescueStore.runUrl))&&w.document.body.dataset.state==='ready'}catch(e){return false}})()", 60)
            if i == 1:
                print(f"    H1 message -> new 2D heat map on screen: {time.time() - t0 - 2.5:.1f} s (incl. the server run)")
                check("H1 dock marks the chat event", c.until("!!document.querySelector('#tlMarks .tlk.chat')", 10))
            time.sleep(1.5)
            shot(c, shots, f"czat-{i}.jpg")
        check("no blank 2D during 4 changes", (c.js("(clearInterval(window.__blankT),window.__blank)") or 0) == 0, f"blank samples: {c.js('window.__blank')}")
        # several events in one message -> several cards, one "Dodaj wszystkie"
        n0, r0 = c.js(N_CARD) or 0, c.js(N_RES) or 0
        c.js("window.rescueChat.chat.onText('Zespół B przeszukał S3 i S4, nic, a o 15:10 turystka widziała go przy Zawracie')")
        check("multi -> 2 cards", c.until(f"{N_CARD} >= {n0 + 2} && !!document.querySelector('.ch-addall')", 15), str((c.js(N_CARD) or 0) - n0))
        c.js("[...document.querySelectorAll('.ch-addall')].pop().click()")
        c.until(f"{N_RES} > {r0}", 60)
        res = c.js(LAST_RES) or ""
        check("multi -> one answer with top 3", "obszaru" in res and "Cofnij wszystkie" in res, res.replace("\n", " | ")[:200])
        c.js("[...document.querySelectorAll('[data-undo]')].pop().click()")
        check("H undo", c.until("[...document.querySelectorAll('.ch-msg .ok')].some(e=>e.textContent.includes('Cofnięto'))", 40))
        c.js("[...document.querySelectorAll('[data-focus]')][0].click()")
        time.sleep(1)
        check("H focus selects the sector", c.js("!!window.rescueStore.selSeg"), str(c.js("window.rescueStore.selSeg")))
        # ---- 2. /app Na żywo (only against our own loopback server: shared production state stays clean)
        if srv:
            print("/app Na żywo")
            c.call("Page.navigate", {"url": f"{base}/app/?sc=zawrat&role=operator&time=live&mode=akcja&view=2d&chat=1"})
            check("live app loaded", c.until("!!(window.rescueChat && window.rescueStore && window.rescueStore.run && window.rescueChat.host.mode()==='live')", 60))
            card, res = send(c, "Czerwona czapka w żlebie pod Zawratem, o 19:10")
            check("L1 live clue added", "obszaru" in res, res.replace("\n", " | ")[:200])
            check("L1 undo offered", c.js("!!document.querySelector('[data-undo]')"))
            shot(c, shots, "czat-live.jpg")
            c.js("[...document.querySelectorAll('[data-undo]')].pop().click()")
            check("L1 undo (weight 0)", c.until("[...document.querySelectorAll('.ch-msg .ok')].some(e=>e.textContent.includes('Cofnięto'))", 40))
            card, res = send(c, "Zespół A przeszukał S4, nic")
            check("L2 live search report", "obszaru" in res, res.replace("\n", " | ")[:200])
        # ---- 3. czat.html (casual)
        print("czat.html")
        c.call("Page.navigate", {"url": f"{base}/app/czat.html?sc=zawrat&nointro=1"})
        check("czat.html loaded", c.until("!!(window.rescueChat && document.querySelector('.ch-chip'))", 60))
        c.until("(()=>{try{return document.getElementById('czMap').contentWindow.document.body.dataset.state==='ready'}catch(e){return false}})()", 40)
        card, _ = send(c, "Widziałem kogoś", add=False)
        check("C asks where", "Gdzie" in card, card.replace("\n", " | ")[:160])
        card, res = send(c, "przy Wielkim Stawie 20 min temu")
        check("C follow-up fills the place", "Wielki Staw" in card, card.replace("\n", " | ")[:160])
        check("C top 3", "obszaru" in res, res.replace("\n", " | ")[:200])
        card, res = send(c, "Dron przeleciał nad Zmarzłym Stawem i Kozią Dolinką, nic")
        check("C drone search", "obszaru" in res, res.replace("\n", " | ")[:200])
        time.sleep(3)
        c.until("(()=>{try{const w=document.getElementById('czMap').contentWindow;return w.location.href.includes('blob')&&w.document.body.dataset.state==='ready'}catch(e){return false}})()", 60)
        time.sleep(1.5)
        shot(c, shots, "czat-casual.jpg")
        check("C share button", c.js("!!document.getElementById('czShare')"))
        check("C summary text", "Gdzie szukać najpierw" in (c.js("window.rescueChat.chat.summaryText()") or ""), (c.js("window.rescueChat.chat.summaryText()") or "")[:160].replace("\n", " | "))
        check("no uncaught page errors", not c.errors, "; ".join(map(str, c.errors))[:300])
    finally:
        chrome.terminate()
        if srv:
            srv.stop()
    print("FAIL: " + ", ".join(FAILS) if FAILS else "OK")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
