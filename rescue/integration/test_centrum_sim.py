#!/usr/bin/env python3
"""Symulacja 24/7 (schedule + Centrum notifications): the schedule file (>= 100 entries a day, every scenario 3-6 times, unique ids,
no scenario overlapping itself across midnight, clusters keep their offsets, generator deterministic), then headless Chrome on
Centrum with the clock pinned (?simAt=HH:MM): a fresh entry -> toast + bell badge, Potwierdź -> the ACK survives a reload,
> 5 min unacked -> escalation style, the virtual-live cards, no sideways scroll on a phone, no JS exceptions.

    python3 rescue/integration/test_centrum_sim.py [--rebuild] [--server <binary>]
"""
import json
import os
import re
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


def check_schedule():
    d = json.load(open(SCHED))
    es = d["entries"]
    check("schema", d.get("schema") == "rescue-schedule/1" and d.get("tz") == "Europe/Warsaw")
    check("at_least_100", len(es) >= 100, f"{len(es)} entries")
    ids = [e["id"] for e in es]
    check("unique_ids", len(ids) == len(set(ids)))
    check("id_format", all(e["id"] == f"{e['sc']}@{e['start'].replace(':', '')}" for e in es))
    check("times_valid", all(re.fullmatch(r"\d\d:\d\d", e["start"]) and 0 <= mins(e["start"]) < 1440 and e["durationMin"] > 0 for e in es))
    by = {}
    for e in es:
        by.setdefault(e["sc"], []).append(e)
    check("each_scenario_3_to_6", all(3 <= len(v) <= 6 for v in by.values()), json.dumps({k: len(v) for k, v in by.items() if not 3 <= len(v) <= 6}))
    scen = {f[:-5] for f in os.listdir(os.path.join(lib.RESCUE, "scenarios")) if f.endswith(".json") and not f.endswith("-terrain.json")
            and not f.startswith("blind-") and f[:-5] not in ("night-test", "morzycko")}
    check("every_scenario_scheduled", scen <= set(by), str(sorted(scen - set(by))))
    bad = []
    for sc, v in by.items():   # the same scenario never runs twice at once, also across midnight (the day loops)
        iv = sorted((mins(e["start"]), mins(e["start"]) + e["durationMin"]) for e in v)
        for i, (a0, a1) in enumerate(iv):
            for b0, b1 in iv[i + 1:]:
                if b0 < a1 or b1 - 1440 > a0:
                    bad.append(sc)
        if iv[-1][1] - 1440 > iv[0][0]:
            bad.append(sc + " (midnight)")
    check("no_self_overlap_looping", not bad, str(bad[:5]))
    groups = {}
    for e in es:
        if e.get("group"):
            groups.setdefault(e["group"], []).append(e)
    ok = True
    for g, v in groups.items():   # cluster members keep their real relative offsets
        sc0 = {e["sc"]: e for e in v}
        files = {sc: json.load(open(os.path.join(lib.RESCUE, "scenarios", sc + ".json"))) for sc in sc0}
        base = min(files, key=lambda s: (files[s].get("date") or "", mins(files[s]["startClock"])))
        for sc, e in sc0.items():
            real = (mins(files[sc]["startClock"]) - mins(files[base]["startClock"])) % 1440
            ok &= (mins(e["start"]) - mins(sc0[base]["start"])) % 1440 == real
    check("clusters_keep_offsets", bool(groups) and ok, f"{len(groups)} cluster instances")
    tmp = tempfile.mktemp(suffix=".json")
    subprocess.run([sys.executable, os.path.join(lib.RESCUE, "tools", "make_schedule.py"), "--out", tmp], check=True, capture_output=True)
    check("generator_deterministic", json.load(open(tmp)) == d)
    os.remove(tmp)
    return es


def open_page(c, url, w, h, mobile):
    c.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
    c.call("Page.navigate", {"url": url})
    c.until("document.readyState==='complete'", 20)


def main():
    es = check_schedule()
    ensure_binary("--rebuild" in sys.argv)
    # an entry with no other entry starting within 20 min before it: the toast at start + 2 min is exactly this one
    starts = sorted({mins(e["start"]) for e in es})
    e = next(e for e in es if all(not (0 < (mins(e["start"]) - s) % 1440 <= 20) for s in starts) and e["durationMin"] >= 30 and 60 < mins(e["start"]) < 1380)
    at = hhmm(mins(e["start"]) + 2)
    tmp = tempfile.mkdtemp(prefix="rescue-centrum-sim-")
    srv = Server(free_port(8805), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    port = free_port(9370)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        url = f"{srv.base}/app/centrum.html?dyzurny=0&simAt={at}"
        open_page(c, url, 1440, 900, False)
        c.js("localStorage.removeItem('rescue-live-acks');localStorage.removeItem('rescue-sim247')")
        open_page(c, url, 1440, 900, False)
        on = c.until("(()=>{const b=document.getElementById('simTog');return b&&b.getAttribute('aria-pressed')==='true'&&document.getElementById('simNote').offsetParent?document.getElementById('simNote').innerText:''})()", 30)
        check("sim_on_by_default_with_label", bool(on) and "fikcyjne" in on, on or "")
        key = f"{e['id']}|"
        toast = c.until(f"(()=>{{const t=[...document.querySelectorAll('.lftoast')].find(x=>x.querySelector('[data-key^=\"{key}\"]'));return t&&/\\S/.test(t.querySelector('.lfn b').innerText)&&!/^{re.escape(e['sc'])}$/.test(t.querySelector('.lfn b').innerText)?t.innerText:''}})()", 30)
        check("toast_for_new_entry", bool(toast) and "Otwórz" in toast and "Potwierdź" in toast, f"{e['id']} at {at}: " + (toast or "").replace("\n", " | ")[:120])
        badge = c.js("(()=>{const b=document.querySelector('.lfbadge');return b&&!b.hidden?+b.textContent:0})()")
        check("bell_badge", (badge or 0) >= 1, f"badge {badge}")
        c.js("document.querySelector('.lfbell').click()")
        item = c.until(f"(()=>{{const i=document.querySelector('.lfpanel:not([hidden]) .lfi[data-key^=\"{key}\"]');return i?i.innerText:''}})()", 10)
        check("bell_list_entry", bool(item) and e["start"] in item, (item or "").replace("\n", " | ")[:120])
        href = c.js(f"(()=>{{let u='';const o=location.assign;const i=document.querySelector('.lfi[data-key^=\"{key}\"]');return i?i.querySelector('.lfopen')?1:0:0}})()")
        check("open_button", href == 1)
        c.js("document.querySelector('.lfbell').click()")
        c.js(f"document.querySelector('.lftoast [data-key^=\"{key}\"] .lfack').click()")
        time.sleep(0.5)
        acked = c.js(f"Object.keys(JSON.parse(localStorage.getItem('rescue-live-acks')||'{{}}')).some(k=>k.startsWith('{key}'))")
        check("ack_stored", acked is True)
        open_page(c, url, 1440, 900, False)
        c.until("document.querySelector('.lfbell')?1:0", 30)
        time.sleep(2)
        again = c.js(f"!!document.querySelector('.lftoast [data-key^=\"{key}\"]')")
        c.js("document.querySelector('.lfbell').click()")
        still = c.until(f"(()=>{{const i=document.querySelector('.lfi[data-key^=\"{key}\"]');return i?i.className:''}})()", 10)
        check("ack_persists_after_reload", again is False and "acked" in (still or ""), f"toast again={again} item={still}")
        # escalation: the same entry 7 min after its start, not acked
        c.js("localStorage.removeItem('rescue-live-acks')")
        open_page(c, f"{srv.base}/app/centrum.html?dyzurny=0&simAt={hhmm(mins(e['start']) + 7)}", 1440, 900, False)
        late = c.until(f"(()=>{{const t=document.querySelector('.lftoast [data-key^=\"{key}\"]');return t&&t.classList.contains('late')&&document.querySelector('.lfbell.late')?1:0}})()", 30)
        check("escalation_after_5_min", late == 1)
        # virtual-live: the entry is a live card (one card per occurrence), Grafik 24/7 ("Doba") is the default timeline mode
        # sens-funkcji #6: Doba ends at now - only rows with an occurrence reported so far, no future bars; Tryb pokazu = the whole day
        cards = c.until(f"(()=>{{const k=[...document.querySelectorAll('#simCards .card.simc')].map(x=>x.dataset.key);return k.some(x=>x.startsWith('{key}'))?k:null}})()", 30)
        check("sim_live_card", bool(cards) and len(cards) == len(set(cards)), f"{len(cards or [])} cards")
        gantt = c.until("(()=>{const b=document.querySelector('#tl [data-mode=sim]');return b&&!b.hidden&&b.classList.contains('on')?document.querySelectorAll('#tl .tlr').length:0})()", 20)
        check("gantt_sim_default", (gantt or 0) >= 1, f"{gantt} rows")
        fut = c.js("(()=>{const r=window.rescueCentrum.tl;return [r.hi, Math.max(0,...[...document.querySelectorAll('#tl .sb')].map(b=>+b.dataset.a))]})()")
        check("doba_ends_now_no_future", bool(fut) and fut[0] < 1440 and fut[1] < fut[0], json.dumps(fut))
        btns = c.js("[...document.querySelectorAll('#tl [data-mode]')].filter(b=>!b.hidden).map(b=>b.textContent)")
        c.js("document.getElementById('tlShow').click()")
        show = c.js("[window.rescueCentrum.tl.hi, document.querySelectorAll('#tl .tlr').length, [...document.querySelectorAll('#tl [data-mode]')].filter(b=>!b.hidden).map(b=>b.textContent)]")
        c.js("document.getElementById('tlShow').click()")
        check("tryb_pokazu_whole_day", btns == ["Doba"] and bool(show) and show[0] == 1440 and show[1] >= 25 and "Dzień w Centrum" in show[2], json.dumps([btns, show], ensure_ascii=False))
        dot = c.js(f"(()=>{{const m=window.rescueCentrum.map;return [...document.querySelectorAll('.mk.live')].length}})()")
        check("sim_live_dots", (dot or 0) >= 1, f"{dot} live dots")
        # scrub in Grafik 24/7 moves the virtual clock: the cards follow the cursor
        c.js("document.getElementById('tl').classList.add('peek')")
        h = c.js("(()=>{const r=document.querySelector('#tlMini .trk').getBoundingClientRect();const b=document.getElementById('tlBody');"
                 "const o={clientX:r.left+r.width*0.25,clientY:r.top+r.height/2,bubbles:true,button:0,pointerId:1};"
                 "b.dispatchEvent(new PointerEvent('pointerdown',o));b.dispatchEvent(new PointerEvent('pointerup',o));return document.querySelector('#simCards .cgrp').innerText})()")
        check("scrub_moves_sim_clock", bool(h) and re.search(r"O \d\d:\d\d", h.upper()) is not None, (h or "").replace("\n", " ")[:80])
        c.js("document.getElementById('tlLive').click()")
        # calls: an incoming call inside a running occurrence is its own note (Zgłoszenie), filter works
        zw = next(x for x in es if x["sc"] == "zawrat" and 30 < mins(x["start"]) < 1380)
        open_page(c, f"{srv.base}/app/centrum.html?dyzurny=0&simAt={hhmm(mins(zw['start']) + 26)}", 1440, 900, False)
        c.until("document.querySelector('.lfbell')?1:0", 30)
        c.js("document.querySelector('.lfbell').click();document.querySelector('.lffil [data-f=call]').click()")
        call = c.until(f"(()=>{{const i=document.querySelector('.lfi.t-call[data-key^=\"{zw['id']}#1805\"]');return i?i.innerText:''}})()", 20)
        check("call_note", bool(call) and "CPR" in call and "Zgłoszenie".upper() in call.upper(), (call or "").replace("\n", " | ")[:120])
        only = c.js("[...document.querySelectorAll('.lflist .lfi')].every(x=>x.classList.contains('t-call'))")
        check("filter_calls_only", only is True)
        # virtual dispatcher (sens-funkcji #5, default): sim notes acked after 1-3 min, at most 1 toast on load, almost no red cards
        c.js("localStorage.removeItem('rescue-live-acks')")
        open_page(c, f"{srv.base}/app/centrum.html?simAt={hhmm(mins(e['start']) + 4)}", 1440, 900, False)
        c.until("document.querySelector('#simCards .card')?1:0", 30)
        time.sleep(4)
        vd = c.js("[document.querySelectorAll('.lftoast').length, document.querySelectorAll('#simCards .card.esc').length, document.querySelectorAll('#simCards .card').length]")
        check("vd_calm_start", bool(vd) and vd[0] <= 1 and vd[1] <= 2, f"toasts, red cards, cards = {vd}")
        c.js("document.querySelector('.lfbell').click()")
        vi = c.until("(()=>{const i=[...document.querySelectorAll('.lfpanel .lfi.acked')].find(x=>/wirtualny/.test(x.innerText));const k=document.querySelector('.lfpanel .lfkpi');return i&&k&&!k.hidden&&/Symulacja/.test(k.innerText)?k.innerText:''})()", 10)
        check("vd_acks_labelled", bool(vi), vi or "")
        errs_desktop = list(c.errors)
        # phone
        c.errors.clear()
        open_page(c, url, 390, 844, True)
        c.until("document.querySelector('.lfbell')?1:0", 30)
        time.sleep(2)
        sz = c.js("(()=>{const b=document.querySelector('.lfbell').getBoundingClientRect();return [b.width,b.height]})()")
        check("phone_44px_bell", bool(sz) and sz[0] >= 44 and sz[1] >= 44, json.dumps(sz))
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
