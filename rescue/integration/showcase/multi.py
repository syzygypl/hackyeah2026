#!/usr/bin/env python3
"""Several incidents LIVE at once: Zawrat (Tatry, missing hiker) + Śniardwy (lake, sailor in the water), plus
krakow-nowa-huta if that scenario exists. One shared team roster: the operator moves the drone and the helicopter
between incidents, phones add clues tagged with their incident (`sc`), and after every step the script prints
/api/incidents (top 3 segments, teams per incident) and the roster in a form you can read out to the audience.

    python3 rescue/integration/showcase/multi.py                         # own server on 127.0.0.1:8795+, ~2 min
    python3 rescue/integration/showcase/multi.py --port 8796 --ready --keep    # open the screens first, keep the server
    python3 rescue/integration/showcase/multi.py --server http://127.0.0.1:8790 --pin 4821   # drive a running server
    python3 rescue/integration/showcase/multi.py --lan --pin 4821        # 0.0.0.0, OUR hotspot only (phones can watch)

Contract: rescue/app/CONTRACT.md (several incidents: sc, GET /api/incidents, shared team roster). Needs a rescue-server
with those routes; on an older server it stops at the start and says which route is missing.
Timeline (seconds at --speed 1):
  0  both incidents untouched                         10  roster: TOPR to Zawrat, boats to Śniardwy, drone to Zawrat
 25  operator: segments for the attached teams        40  TOPR B phone (Zawrat): red glove in the gully under Zawrat
 55  WOPR boat phone (Śniardwy): life jacket in the reeds SE   70  operator moves the DRONE Zawrat -> Śniardwy (reeds)
 85  operator sends the HELICOPTER to Zawrat, gully S7         100  summary
"""
import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib import RESCUE, Server, ensure_binary, free_port, http  # noqa: E402

Z, S, K = "zawrat", "sniardwy", "krakow-nowa-huta"

TIMELINE = [
    (0, "operator", "show", "Dwie akcje naraz, nic się jeszcze nie wydarzyło"),
    (10, "operator", "roster", [("topr-a", Z), ("topr-b", Z), ("drone", Z), ("wopr-boat", S), ("psp-boat", S), ("police-shore", S)]),
    (25, "operator", "assign", [("topr-a", Z, "S4"), ("topr-b", Z, "S6"), ("drone", Z, "S5"), ("wopr-boat", S, "W3"), ("psp-boat", S, "W6")]),
    (40, "topr-b", "clue", {"sc": Z, "type": "odziez", "segmentId": "S7", "note": "czerwona rękawiczka w żlebie pod Zawratem"}),
    (55, "wopr-boat", "clue", {"sc": S, "type": "znalezisko", "segmentId": "W5", "note": "kamizelka ratunkowa w trzcinach przy brzegu SE"}),
    (70, "operator", "move", ("drone", S, "W5", "dron z termowizją przerzucony na trzciny: kamizelka")),
    (85, "operator", "move", ("heli", Z, "S7", "śmigłowiec do żlebu: rękawiczka, zespół linowy")),
    (100, "operator", "summary", None),
]


class Multi:
    def __init__(self, a):
        self.a, self.pin, self.t0 = a, a.pin, None
        self.names = {}   # sc -> {segmentId: name}

    def say(self, who, msg):
        t = time.time() - self.t0 if self.t0 else 0
        print(f"[{int(t // 60)}:{int(t % 60):02d}] {who:<12} {msg}", flush=True)

    def G(self, p):
        return http(self.base, "GET", p, pin=self.pin)

    def P(self, p, body, **k):
        return http(self.base, "POST", p, body, pin=self.pin, **k)

    # ---------- what the audience sees
    def board(self, scs):
        st, inc, _ = self.G("/api/incidents")
        st2, teams, _ = self.G("/api/teams")
        if st != 200 or st2 != 200:
            print(f"   (incidents HTTP {st}, teams HTTP {st2})")
            return
        by = {i["sc"]: i for i in inc}
        for sc in scs:
            i = by.get(sc)
            if not i:
                continue
            top = ", ".join(f"{t['segmentId']} {t['name']} {round(t['weight'] * 100)}%" for t in i["top3"]) or "-"
            mine = [t for t in teams if t["sc"] == sc]
            crew = ", ".join(f"{t['id']}" + (f"->{t['segmentId']}" if t["segmentId"] else " (w drodze)") for t in mine) or "nikt"
            print(f"   {('LIVE ' if i['live'] else '     ')}{i['title']} ({i['place']})" + ("  ZNALEZIONO" if i["found"] else ""))
            print(f"        top3: {top}")
            print(f"        zespoły {i['teams']['assigned']}/{i['teams']['total']}: {crew}")
        free = [t["id"] for t in teams if t["sc"] is None]
        print(f"   wolne: {', '.join(free) or '-'}", flush=True)

    # ---------- actions
    def roster(self, moves):
        for team, sc in moves:
            st, d, _ = self.P("/api/teams/assign", {"team": team, "sc": sc, "by": "operator"})
            self.say("operator", f"{team} -> {sc}" + ("" if st == 200 else f"  (HTTP {st}: {str(d)[:120]})"))

    def assign(self, items):
        for team, sc, seg in items:
            st, d, _ = self.P("/api/assignments", {"team": team, "segmentId": seg, "sc": sc, "why": "plan operatora", "by": "operator"})
            self.say("operator", f"{team} -> {sc} {seg} {self.names[sc].get(seg, '')}" + ("" if st == 200 else f"  (HTTP {st})"))

    def clue(self, team, c):
        body = dict(c, by="ratownik", team=team, id=f"multi-{team}-{c['segmentId']}")
        st, d, _ = self.P("/api/clue", body)
        self.say(f"tel. {team}", f"[{c['sc']}] {c['note']}" + (f"  (seq {d.get('seq')})" if st == 200 else f"  (HTTP {st}: {str(d)[:120]})"))

    def move(self, team, sc, seg, why):
        st, _, _ = self.P("/api/teams/assign", {"team": team, "sc": sc, "by": "operator"})
        st2, _, _ = self.P("/api/assignments", {"team": team, "segmentId": seg, "sc": sc, "why": why, "by": "operator"})
        self.say("operator", f"PRZERZUCA {team} -> {sc} {seg} {self.names[sc].get(seg, '')}: {why}"
                 + ("" if st == st2 == 200 else f"  (HTTP {st}/{st2})"))

    def run(self):
        a, srv = self.a, None
        if a.server:
            self.base = a.server.rstrip("/")
        else:
            ensure_binary()
            port = a.port or free_port(8795)
            live = os.path.join(tempfile.mkdtemp(prefix="rescue-multi-show-"), "live-events.json")
            srv = Server(port, a.pin if a.lan else None, live, host="0.0.0.0" if a.lan else "127.0.0.1", strict=False,
                         llm_off=True, extra_env={"RESCUE_LIVE_DIR": os.path.dirname(live)}, log=os.path.join(os.path.dirname(live), "server.log"))
            srv.start()
            self.base = srv.base
            print(f"rescue-server on {'0.0.0.0' if a.lan else '127.0.0.1'}:{port}")
        try:
            missing = [p for p in ("/api/incidents", "/api/teams", "/api/live") if self.G(p)[0] == 404]
            if missing:
                print(f"This server has no {', '.join(missing)} yet (contract: rescue/app/CONTRACT.md, several incidents). Stopping.")
                return 2
            scs = [n for n in (Z, S, K) if os.path.exists(os.path.join(RESCUE, "scenarios", f"{n}.json"))]
            for sc in scs:
                doc = json.load(open(os.path.join(RESCUE, "scenarios", f"{sc}.json"), encoding="utf-8"))
                self.names[sc] = {s["id"]: s["name"] for s in doc.get("segments", [])}
            print(f"Incidents in the show: {', '.join(scs)}. Screens: {self.base}/app/?role=operator&sc=zawrat (and sc=sniardwy)")
            if a.ready:
                input("Open the screens, then Enter to start ")
            self.t0 = time.time()
            for t, actor, action, data in TIMELINE:
                while time.time() < self.t0 + t / a.speed:
                    time.sleep(0.1)
                if action == "show":
                    self.say(actor, data)
                elif action == "roster":
                    self.roster(data)
                elif action == "assign":
                    self.assign(data)
                elif action == "clue":
                    self.clue(actor, data)
                elif action == "move":
                    self.move(*data)
                elif action == "summary":
                    self.say("operator", "PODSUMOWANIE: jeden roster, dwie akcje, ślady trafiają tylko do swojej akcji")
                self.board(scs)
            if a.keep and srv:
                input("Server keeps running for the screens. Enter to stop. ")
            return 0
        finally:
            if srv:
                srv.stop()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--server", help="drive an already running rescue-server; default: start our own")
    p.add_argument("--port", type=int, help="port for our own server (default: first free from 8795; never 8780)")
    p.add_argument("--lan", action="store_true", help="own server on 0.0.0.0 (OUR phone hotspot only), PIN required")
    p.add_argument("--pin", default="4821", help="server PIN (sent by the script)")
    p.add_argument("--speed", type=float, default=1.0, help="2 = twice as fast")
    p.add_argument("--ready", action="store_true", help="wait for Enter before starting")
    p.add_argument("--keep", action="store_true", help="keep our own server running at the end")
    sys.exit(Multi(p.parse_args()).run())


if __name__ == "__main__":
    main()
