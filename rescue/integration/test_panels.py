#!/usr/bin/env python3
"""/app overlay panels collapse the same way (foldPanel in app/dock.js): the right panel 'Gdzie szukać najpierw', the 2D legend and
layer box (web/), the 3D legend and 'Sterowanie 3D' (app/3d/). Headless Chrome on /app Akcja, views 2D, 3D and 2D+3D at 1440x900
and 1100x800: every panel has a collapsed strip (focusable title, aria-expanded), no two panels overlap (shell panels + the frames'
overlays in page coordinates), hover opens, it stays open 3 s after leaving and then closes, the panel keeps its anchor and the
insets / 2D map do not move, focus opens and Esc closes, a tap opens and a tap outside closes, the pin keeps it open across a
reload; the phone (390x844) keeps its bottom sheet (no strips, no sideways scroll); no JS exceptions.

    python3 rescue/integration/test_panels.py [--rebuild] [--server <binary>]
"""
import json
import os
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


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}"[:240], flush=True)
    if not cond:
        FAILS.append(name)


# panel id -> (document expression, element id)
D2 = "document.getElementById('frame2d').contentDocument"
D3 = "document.getElementById('frame3d').contentDocument"
PANELS = {"right": ("document", "right"), "leg2d": (D2, "legend"), "ctl2d": (D2, "mapctl"), "leg3d": (D3, "sceneLegend"), "ctl3d": (D3, "sceneCtl")}
VIEWS = {"2d": ["right", "leg2d", "ctl2d"], "3d": ["right", "leg3d", "ctl3d"], "split": ["right", "leg2d", "ctl2d", "leg3d", "ctl3d"]}

# page-coordinate rects of the shell panels and the frames' overlays (clipped to their frame), visible ones only
RECTS = """(()=>{const out={};const vis=(e,w)=>{if(!e)return false;const s=w.getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0.05&&e.getClientRects().length};
const put=(k,e,w,f)=>{if(!vis(e,w))return;let r=e.getBoundingClientRect(),x=r.left,y=r.top,X=r.right,Y=r.bottom;if(f){x=Math.max(f.left,x+f.left);y=Math.max(f.top,y+f.top);X=Math.min(f.right,X+f.left);Y=Math.min(f.bottom,Y+f.top)}
if(X-x>1&&Y-y>1)out[k]=[x,y,X,Y].map(Math.round)};
for(const id of ['views','right','bottom'])put(id,document.getElementById(id),window);put('header',document.querySelector('header'),window);
for(const [fid,ids] of [['frame2d',{leg2d:'legend',ctl2d:'mapctl',tl2d:'tllegend'}],['frame3d',{leg3d:'sceneLegend',ctl3d:'sceneCtl'}]]){const f=document.getElementById(fid);if(!vis(f,window))continue;
const fr=f.getBoundingClientRect(),w=f.contentWindow;for(const k in ids)put(k,w.document.getElementById(ids[k]),w,fr)}return out})()"""


def el(p):
    d, i = PANELS[p]
    return f"{d}.getElementById('{i}')"


def state(c, p):
    return c.js(f"(()=>{{const e={el(p)};if(!e)return null;const r=e.getBoundingClientRect(),t=e.querySelector(':scope>.fold-head .fold-ttl');"
                f"return {{fold:e.classList.contains('fold'),live:e.classList.contains('fold-live'),peek:e.classList.contains('peek'),pinned:e.classList.contains('pinned'),"
                f"head:!!t&&t.getClientRects().length>0,aria:t?t.getAttribute('aria-expanded'):null,x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}}})()")


def page_xy(c, p):
    """centre of the panel's title button in page coordinates (frames add their offset)"""
    d, _ = PANELS[p]
    off = "{left:0,top:0}" if d == "document" else f"document.getElementById('{'frame2d' if d == D2 else 'frame3d'}').getBoundingClientRect()"
    return c.js(f"(()=>{{const o={off},t={el(p)}.querySelector('.fold-ttl').getBoundingClientRect();return [o.left+t.left+t.width/2,o.top+t.top+t.height/2]}})()")


def mouse(c, x, y):
    c.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})


def tap(c, x, y):
    c.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    c.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def key(c, k, code, vk):
    for t in ("keyDown", "keyUp"):
        c.call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": code, "windowsVirtualKeyCode": vk})


def insets_key(c):
    return c.js(f"(()=>{{const o=[];for(const d of [{D2},{D3}]){{try{{const s=d.documentElement.style;o.push(['t','r','b','l'].map(k=>s.getPropertyValue('--inset-'+k)).join())}}catch(e){{o.push('-')}}}}"
                f"return o.join('|')+'|'+Math.round(document.getElementById('right').getBoundingClientRect().left)}})()")


def map2d(c):
    return c.js("(()=>{try{const m=document.getElementById('frame2d').contentWindow.__rescue2d.map;const p=m.getCenter();return [p.lng.toFixed(6),p.lat.toFixed(6),m.getZoom().toFixed(3)].join()}catch(e){return null}})()")


def overlaps(R):
    ks, bad = sorted(R), []
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            A, B = R[a], R[b]
            if min(A[2], B[2]) - max(A[0], B[0]) > 1 and min(A[3], B[3]) - max(A[1], B[1]) > 1:
                bad.append(f"{a}x{b}")
    return bad


def open_view(c, base, view, w, h, mobile=False):
    c.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": mobile})
    c.call("Emulation.setTouchEmulationEnabled", {"enabled": mobile})
    c.call("Page.navigate", {"url": f"{base}&view={view}"})
    c.until("document.readyState==='complete'", 20)
    c.until("!document.body.classList.contains('booting')", 45)
    if mobile:
        time.sleep(2)
        return True
    want = VIEWS[view]
    ok = c.until("(()=>{try{return [" + ",".join(f"!!({el(p)}&&{el(p)}.querySelector(':scope>.fold-head'))" for p in want) + "].every(Boolean)}catch(e){return false}})()", 60)
    if "leg2d" in want:   # the 2D map is up and both frames got their insets (the "no move" checks compare them)
        c.until("(()=>{try{return !!document.getElementById('frame2d').contentWindow.__rescue2d.map}catch(e){return false}})()", 30)
    c.until(f"(()=>{{try{{return [{D2},{D3}].every((d,i)=>!{json.dumps(want)}.includes(i?'leg3d':'leg2d')||d.documentElement.style.getPropertyValue('--inset-t'))}}catch(e){{return false}}}})()", 20)
    time.sleep(2.5)   # frames settle (fonts, first labels, the 3D camera fly)
    mouse(c, w // 2, h // 2 + 60)
    return ok


def wait_closed(c, p, t=2.5):
    return c.until(f"!{el(p)}.classList.contains('peek')", t)


def main():
    ensure_binary("--rebuild" in sys.argv)
    tmp = tempfile.mkdtemp(prefix="rescue-panels-")
    srv = Server(free_port(8835), None, os.path.join(tmp, "live-events.json"), strict=False, llm_off=True,
                 log=os.path.join(tmp, "server.log"), extra_env={"RESCUE_LIVE_DIR": tmp, "RESCUE_DIR": lib.RESCUE})
    srv.start()
    port = free_port(9400)
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/chrome",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
                               "--window-size=1440,900", "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shots = os.environ.get("PANELS_SHOTS")
    try:
        c = Cdp(port)
        c.call("Runtime.enable")
        base = f"{srv.base}/app/?role=operator&mode=akcja&time=hist&sc=zawrat"
        c.call("Page.navigate", {"url": base})
        c.until("document.readyState==='complete'", 20)
        c.js("['rescue-right-pin','rl2dLegPin','rl2dCtlPin','rl3dLegPin','rl3dCtlPin'].forEach(k=>localStorage.removeItem(k));localStorage.setItem('rescue-app-hint-operator','1')")

        # 1. every view at both desktop sizes: strips, collapsed, no overlap
        for (w, h) in ((1440, 900), (1100, 800)):
            for view, want in VIEWS.items():
                tag = f"{view}_{w}"
                ok = open_view(c, base, view, w, h)
                check(f"strips_ready_{tag}", bool(ok))
                for p in want:
                    s = state(c, p) or {}
                    check(f"strip_{p}_{tag}", s.get("fold") and s.get("live") and s.get("head") and s.get("aria") == "false" and not s.get("peek"),
                          json.dumps(s))
                    if p != "right":   # the right panel keeps its Top 3 when collapsed; the others are one strip
                        check(f"slim_{p}_{tag}", 0 < (s.get("h") or 0) <= 44, f"h={s.get('h')}")
                R = c.js(RECTS) or {}
                bad = overlaps(R)
                if "ctl2d" in R:   # qa #5: the 2D layer switcher (Mapa / Teren / Brak) was under the 2D / 3D / 2D+3D switch in 2D+3D
                    check(f"layer_switch_clear_of_views_{tag}", not [b for b in bad if b in ("ctl2dxviews",)], str(R.get("ctl2d")))
                if "leg3d" in R:   # qa #5: the 3D legend sat over 'Sterowanie 3D'
                    check(f"legend3d_clear_of_ctl3d_{tag}", "ctl3dxleg3d" not in bad, f"{R.get('leg3d')} {R.get('ctl3d')}")
                check(f"no_overlap_{tag}", not bad, f"{bad} {json.dumps(R)}")
                if shots:   # optional (PANELS_SHOTS=dir): screenshots for a human look
                    import base64
                    try:
                        open(os.path.join(shots, f"panels-{tag}.png"), "wb").write(base64.b64decode(c.call("Page.captureScreenshot", {"format": "png"})["data"]))
                    except Exception as e:   # a slow software-rendered frame can time the capture out; the checks do not depend on it
                        print(f"  (no screenshot {tag}: {e})")

        # 2. behaviour on 2D+3D at 1440: hover opens, held 3 s after leaving, closes; anchor, insets and the 2D map stay put
        w, h = 1440, 900
        open_view(c, base, "split", w, h)
        away = (560, 520)   # the 2D map, clear of every panel
        for p in VIEWS["split"]:
            s0, k0, m0 = state(c, p), insets_key(c), map2d(c)
            x, y = page_xy(c, p)
            if p == "right":   # headless Chrome (CDP) sends no pointerenter to a shell element when the pointer comes out of the 2D iframe,
                # with or without a stop in the header (qa2 #10); a real browser does. Here the same events go to #right directly
                c.js(f"{el(p)}.dispatchEvent(new PointerEvent('pointerenter', {{pointerType: 'mouse'}}))")
            else:
                mouse(c, x, y)
            opened = c.until(f"{el(p)}.classList.contains('peek') && {el(p)}.querySelector('[aria-expanded=true]') ? 1 : 0", 8)   # software-rendered frames: a poll can take seconds
            s1 = state(c, p)
            check(f"hover_opens_{p}", bool(opened) and s1["aria"] == "true" and s1["h"] > s0["h"], f"h {s0['h']} -> {s1['h']}")
            check(f"anchor_kept_{p}", (s1["x"], s1["w"]) == (s0["x"], s0["w"]) and (s1["y"] == s0["y"] or s1["y"] + s1["h"] == s0["y"] + s0["h"]), f"{s0} {s1}")
            if p == "right":
                R = c.js(RECTS) or {}
                bad = [b for b in overlaps(R) if "right" in b]
                check("right_open_clear_of_frames", not bad, str(bad))
            if p == "right":
                c.js(f"{el(p)}.dispatchEvent(new PointerEvent('pointerleave', {{pointerType: 'mouse'}}))")
            mouse(c, *away)
            time.sleep(1.2)
            check(f"held_after_leave_{p}", state(c, p)["peek"])
            check(f"closes_after_hold_{p}", bool(c.until(f"!{el(p)}.classList.contains('peek')", 10)))   # timers run late under a loaded software renderer
            check(f"no_move_{p}", insets_key(c) == k0 and map2d(c) == m0, f"{k0} / {m0}")

        # 3. keyboard: focus on the strip opens (aria-expanded), Esc closes
        for p in ("right", "ctl3d", "leg2d"):
            c.js(f"{el(p)}.querySelector('.fold-ttl').focus()")
            ok = c.until(f"{el(p)}.classList.contains('peek')", 4)
            check(f"focus_opens_{p}", bool(ok) and state(c, p)["aria"] == "true")
            key(c, "Escape", "Escape", 27)
            check(f"esc_closes_{p}", bool(wait_closed(c, p)) and state(c, p)["aria"] == "false")
            c.js(f"{el(p)}.querySelector('.fold-ttl').blur()")

        # 4. pin: stays open after leaving, survives a reload, unpins
        for p in ("right", "leg3d", "ctl2d"):
            c.js(f"{el(p)}.querySelector('.fold-pin').click()")
            mouse(c, *away)
            time.sleep(3.6)
            s = state(c, p)
            check(f"pin_keeps_open_{p}", s["pinned"] and s["aria"] == "true" and s["h"] > 44, json.dumps(s))
        open_view(c, base, "split", w, h)
        for p in ("right", "leg3d", "ctl2d"):
            check(f"pin_after_reload_{p}", state(c, p)["pinned"])
        R = c.js(RECTS) or {}
        check("no_overlap_pinned_split", not overlaps(R), str(overlaps(R)))
        for p in ("right", "leg3d", "ctl2d"):
            c.js(f"{el(p)}.querySelector('.fold-pin').click()")
            check(f"unpin_{p}", not state(c, p)["pinned"] and c.js("localStorage.getItem('" + {"right": "rescue-right-pin", "leg3d": "rl3dLegPin", "ctl2d": "rl2dCtlPin"}[p] + "')") == "0")
        mouse(c, *away)
        time.sleep(0.3)

        # 5. touch on a tablet-sized window: a tap opens, a tap outside closes
        open_view(c, base, "3d", 1100, 800)
        c.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        for p in ("ctl3d", "leg3d", "right"):
            x, y = page_xy(c, p)
            tap(c, x, y)
            ok = c.until(f"{el(p)}.classList.contains('peek')", 4)
            if not ok:   # the first touch after the 3D frame had focus can be eaten by the slow software-rendered frame here: one retry
                tap(c, x, y)
                ok = c.until(f"{el(p)}.classList.contains('peek')", 4)
            check(f"tap_opens_{p}", bool(ok))
            tap(c, 400, 600)
            check(f"tap_outside_closes_{p}", bool(wait_closed(c, p, 2.5)))
        c.call("Emulation.setTouchEmulationEnabled", {"enabled": False})

        # 6. phone: the bottom sheet stays, no strips in the shell, no sideways scroll
        open_view(c, base, "2d", 390, 844, mobile=True)
        check("phone_sheet", bool(c.js("!!document.getElementById('mPeek')")))
        check("phone_no_shell_strip", not c.js("!!document.querySelector('#right>.fold-head')"))
        check("phone_no_sideways_scroll", c.js("document.documentElement.scrollWidth<=innerWidth+1"), str(c.js("[document.documentElement.scrollWidth,innerWidth]")))

        check("no_js_exceptions", not c.errors, str(c.errors[:3]))
    finally:
        chrome.terminate()
        srv.stop()
    print("FAIL: " + ", ".join(FAILS) if FAILS else "OK: all panel checks passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
