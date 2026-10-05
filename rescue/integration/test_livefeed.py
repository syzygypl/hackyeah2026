#!/usr/bin/env python3
"""Symulacja 24/7 in /app (appbell.js on livefeed.js): the schedule (>= 100 entries, loops every day: an entry from 23:xx is still
listed after midnight under yesterday's key, today's run of the same id is a new key), then headless Chrome on /app with the
clock pinned (?simAt=HH:MM): a fresh entry -> toast + bell badge in the header, Otwórz switches the scenario in place (no page
load, Historia at the incident's clock), Potwierdź -> the ACK survives a reload, no bell for the rescuer, phone header (44 px
bell, no sideways scroll, list inside the screen), no JS exceptions. Centrum's bell: test_centrum_sim.py.

    python3 rescue/integration/test_livefeed.py [--rebuild] [--server <binary>]
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


def open_page(c, url, w, h, mobile):
    c.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
    c.call("Page.navigate", {"url": url})
    c.until("document.readyState==='complete'", 20)


def main():
    es = json.load(open(SCHED))["entries"]
    check("schedule_at_least_100", len(es) >= 100, f"{len(es)} entries")
    check("schedule_unique_ids", len({e["id"] for e in es}) == len(es))
    ensure_binary("--rebuild" in sys.argv)
    # an entry with nothing else starting within 20 min before it (its toast is the only fresh one), not the start scenario
    starts = sorted({mins(e["start"]) for e in es})
    e = next(e for e in es if all(not (0 < (mins(e["start"]) - s) % 1440 <= 20) for s in starts) and e["durationMin"] >= 30
             and 60 < mins(e["start"]) < 1380 and e["sc"] != "zawrat")
    late_e = max((x for x in es if x["durationMin"] >= 20), key=lambda x: mins(x["start"]))   # the day's last long entry, for the loop
    at = hhmm(mins(e["start"]) - 1)   # the page opens 1 min before the start: only notes after load toast (QA #3), the backlog stays in the list
    sc0 = json.load(open(os.path.join(lib.RESCUE, "scenarios", e["sc"] + ".json")))
    want_clock = hhmm(mins(sc0["startClock"])) if sc0.get("startClock") else None
    tmp = tempfile.mkdtemp(prefix="rescue-livefeed-")
    srv = Server(free_port(8815), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    port = free_port(9380)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        base = f"{srv.base}/app/?role=operator&mode=akcja&time=hist&sc=zawrat&dyzurny=0&bell=all"   # the whole country: Otwórz across incidents (default = this incident only)
        url = f"{base}&simAt={at}"
        open_page(c, url, 1440, 900, False)
        c.js("localStorage.removeItem('rescue-live-acks');localStorage.removeItem('rescue-sim247');localStorage.removeItem('rescue-app-time')")
        open_page(c, url, 1440, 900, False)
        c.until("window.rescueBell&&window.rescueBell.entries.length?1:0", 30)
        # daily loop, on the page's own clock maths: 10 min after midnight the last evening entry is still there under yesterday
        loop = c.js(f"""(()=>{{const lf=rescueBell.lf, es=rescueBell.entries, now=lf.nowMs(), w=lf.warsaw(now);
            const mid=now-w.min*60000, a=lf.instancesAt(es, mid+10*60000, {{pastMin:120}}), b=lf.instancesAt(es, mid+(1440+10)*60000, {{pastMin:120}});
            const x=a.find(i=>i.id==='{late_e['id']}'), y=b.find(i=>i.id==='{late_e['id']}');
            return JSON.stringify({{x:x&&x.key, y:y&&y.key, today:w.day}})}})()""")
        lp = json.loads(loop or "{}")
        check("loops_daily", bool(lp.get("x")) and bool(lp.get("y")) and lp["x"] != lp["y"] and not lp["x"].endswith(lp.get("today", "?")),
              f"{late_e['id']} ({late_e['start']}, {late_e['durationMin']} min) at 00:10: {lp}")
        # the bell sits in the /app header, a fresh entry toasts
        inhdr = c.js("!!document.querySelector('header #lfHost .lfbell')&&document.querySelector('header #lfHost').offsetParent!==null")
        check("bell_in_app_header", inhdr is True)
        time.sleep(3)
        bl = c.js("[document.querySelectorAll('.lftoast').length, (()=>{const b=document.querySelector('header .lfbadge');return b&&!b.hidden?+b.textContent:0})()]")
        check("no_backlog_toasts_on_load", bool(bl) and bl[0] == 0, f"toasts {bl and bl[0]}, badge {bl and bl[1]} (the backlog stays in the bell)")
        key = f"{e['id']}|"
        toast = c.until(f"(()=>{{const t=[...document.querySelectorAll('.lftoast')].find(x=>x.querySelector('[data-key^=\"{key}\"]'));return t&&t.querySelector('.lfn b').innerText!=='{e['sc']}'?t.innerText:''}})()", 120)
        check("toast_for_new_entry", bool(toast) and "Otwórz" in toast and "Potwierdź" in toast, f"{e['id']} at {at}: " + (toast or "").replace("\n", " | ")[:120])
        badge = c.js("(()=>{const b=document.querySelector('header .lfbadge');return b&&!b.hidden?+b.textContent:0})()")
        check("bell_badge", (badge or 0) >= 1, f"badge {badge}")
        # Otwórz: the scenario switches in place (the page marker survives), Historia, the incident's clock
        c.until("(()=>{const d=document.getElementById('dkStep');return d&&/\\d\\d:\\d\\d/.test(d.innerText)?1:0})()", 60)   # the first run is in
        title0 = c.js("document.getElementById('scenTitle').innerText")
        c.js("window.__noReload=1")
        c.js(f"document.querySelector('.lftoast [data-key^=\"{key}\"] .lfopen').click()")
        sw = c.until(f"(()=>{{const q=new URLSearchParams(location.search);return q.get('sc')==='{e['sc']}'&&document.body.classList.contains('time-hist')?location.search:''}})()", 60)
        check("open_switches_in_place", bool(sw) and c.js("window.__noReload===1") is True, sw or c.js("location.search"))
        if want_clock:   # the same step as the Centrum deep link (?t=HH:MM) for that clock
            c.until(f"document.getElementById('scenTitle').innerText!=={json.dumps(title0)}?1:0", 60)   # the new run is in
            time.sleep(1)
            got = c.js("document.getElementById('dkStep').innerText")
            open_page(c, f"{base.replace('sc=zawrat', 'sc=' + e['sc'])}&t={want_clock}&simAt={hhmm(mins(e['start']) + 2)}", 1440, 900, False)
            ref = c.until("(()=>{const d=document.getElementById('dkStep');return d&&/\\d\\d:\\d\\d/.test(d.innerText)?d.innerText:''})()", 60)
            check("open_at_incident_clock", bool(got) and got == ref, f"clock {want_clock}: Otwórz {got!r}, deep link {ref!r}")
        back = c.js("!!document.querySelector('header #lfHost .lfbell')")
        check("bell_survives_switch", back is True)
        # ACK persists across a reload
        c.js("document.querySelector('.lfbell').click()")
        c.until(f"document.querySelector('.lfpanel:not([hidden]) .lfi[data-key^=\"{key}\"]')?1:0", 10)
        c.js(f"document.querySelector('.lfpanel .lfi[data-key^=\"{key}\"] .lfack').click()")
        time.sleep(0.5)
        acked = c.js(f"Object.keys(JSON.parse(localStorage.getItem('rescue-live-acks')||'{{}}')).some(k=>k.startsWith('{key}'))")
        check("ack_stored", acked is True)
        open_page(c, f"{base}&simAt={hhmm(mins(e['start']) + 2)}", 1440, 900, False)   # after the start: the entry is in the list
        c.until("document.querySelector('header .lfbell')?1:0", 30)
        time.sleep(2)
        again = c.js(f"!!document.querySelector('.lftoast [data-key^=\"{key}\"]')")
        c.js("document.querySelector('.lfbell').click()")
        still = c.until(f"(()=>{{const i=document.querySelector('.lfi[data-key^=\"{key}\"]');return i?i.className:''}})()", 10)
        check("ack_persists_after_reload", again is False and "acked" in (still or ""), f"toast again={again} item={still}")
        kp = c.until("(()=>{const k=document.querySelector('.lfpanel .lfkpi');return k&&!k.hidden?k.innerText:''})()", 10)
        check("response_time_in_bell", bool(kp) and "mediana" in kp and "potw." in kp, kp or "")
        nb = c.js("(()=>{const b=document.querySelector('.lfpanel .lfnotify');return b?[b.checked, Notification.permission]:null})()")
        check("system_notify_box_off_by_default", bool(nb) and nb[0] is False, str(nb))
        # the rescuer phone (/web/patrol/, sens-funkcji R2-11): no bell, no toasts
        c.js("localStorage.removeItem('rescue-live-acks')")
        open_page(c, f"{srv.base}/web/patrol/?sc=zawrat&team=topr-a&simAt={at}", 1440, 900, False)
        time.sleep(4)
        vis = c.js("[...document.querySelectorAll('.lfbell,.lftoast')].filter(x=>x.offsetParent!==null||getComputedStyle(x).position==='fixed'&&x.getClientRects().length).length")
        check("no_bell_for_rescuer", vis == 0, f"visible {vis}")
        errs_desktop = list(c.errors)
        # phone: the bell in row 1 of the header, list under it, toasts above the bottom sheet
        c.errors.clear()
        open_page(c, url, 390, 844, True)
        c.until("document.querySelector('header .lfbell')?1:0", 30)
        time.sleep(2)
        sz = c.js("(()=>{const b=document.querySelector('header .lfbell').getBoundingClientRect();return [b.width,b.height,b.top,b.right]})()")
        check("phone_bell_44px_in_header", bool(sz) and sz[0] >= 44 and sz[1] >= 44 and sz[2] < 60 and sz[3] <= 390, json.dumps(sz))
        c.js("document.querySelector('header .lfbell').click()")
        time.sleep(0.4)
        pr = c.js("(()=>{const r=document.querySelector('.lfpanel').getBoundingClientRect();return [r.left,r.right,r.top,r.bottom]})()")
        check("phone_list_on_screen", bool(pr) and pr[0] >= 0 and pr[1] <= 390 and pr[2] >= 80 and pr[3] <= 844, json.dumps(pr))
        sw = c.js("[document.documentElement.scrollWidth, innerWidth]")
        check("phone_no_sideways_scroll", bool(sw) and sw[0] <= sw[1] + 1, json.dumps(sw))
        # sens-funkcji #2: by default the commander's bell holds only the open incident; the toast stays off #right
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        open_page(c, base.replace("&bell=all", "") + f"&simAt={hhmm(mins(e['start']) + 2)}", 1440, 900, False)
        c.until("window.rescueBell&&rescueBell.entries.length?1:0", 30)
        time.sleep(3)
        own = c.js("JSON.stringify([...new Set(rescueBell.bell.notes.map(n=>n.inst&&n.inst.sc))])")
        check("bell_only_this_incident", json.loads(own or "[]") in ([], ["zawrat"]), f"notes from {own}")
        open_page(c, f"{srv.base}/app/?role=operator&mode=akcja&time=hist&sc={e['sc']}&dyzurny=0&simAt={at}", 1440, 900, False)
        tt = c.until(f"(()=>{{const t=[...document.querySelectorAll('.lftoast')].find(x=>x.querySelector('[data-key^=\"{key}\"]'));if(!t)return '';const a=t.getBoundingClientRect(),r=document.getElementById('right').getBoundingClientRect();return JSON.stringify([Math.round(a.right),Math.round(r.left)])}})()", 120)
        tr = json.loads(tt or "[0,0]")
        check("toast_own_incident_not_over_right", bool(tt) and tr[0] <= tr[1], f"toast right {tr[0]} vs #right left {tr[1]}")
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
