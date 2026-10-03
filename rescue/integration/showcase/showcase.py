#!/usr/bin/env python3
"""Multi-device showcase: a scripted ~3-minute operation on Zawrat with an operator and 3 phones (TOPR A, TOPR B, dog).

    python3 rescue/integration/showcase/showcase.py                       # own server on 127.0.0.1:879x, everything simulated
    python3 rescue/integration/showcase/showcase.py --lan --pin 4821      # own server on 0.0.0.0 (OUR hotspot only), real phones can join
    python3 rescue/integration/showcase/showcase.py --server http://127.0.0.1:8780 --pin 4821   # drive a server that is already running
    python3 rescue/integration/showcase/showcase.py --operator human --human-teams topr-a --wait  # people do those steps, script cues them

The story lives in the Story Studio of rescue-server (`/story`), so the operator app (`/app/?role=operator&sc=studio`) and the
phones see one live, open case (the stock zawrat run ends with the 20:03 find). The story clock follows the wall clock
like the patrol page does (scenario 19:00 = start of the show; --fixed-clock keeps 19:00-19:50). Timeline (speed 1.0, seconds):

  0  setup: new Zawrat story + the known facts until 18:50 (plan from the wife, car at Palenica, 112 BTS sector, fog, dusk)
 10  operator assigns TOPR A -> S4 Wielki Staw, TOPR B -> S6 szlak niebieski, dog -> S5 Czarny Staw   (phones vibrate)
 30  TOPR A: S4 "nic" + visibility                                              (S4 POA drops)
 45  dog:    S5 "pusto"                                                         (dog's LAST report - it goes silent)
 60  TOPR B: weather on the ridge, wind 15 m/s, snow                            (weather step)
 80  TOPR B: S6 "nic"
 95  TOPR B: red glove in the gully under Zawrat                                (S7 jumps to #1)
105  operator re-tasks TOPR A -> S7 Żleb pod Zawratem                           (TOPR A phone vibrates)
110  local LLM "Ocena sytuacji" requested (rules at once, model in ~20-40 s)
~90-120  monitoring: dog silent past the threshold -> red "CISZA" on ops.html and in the app
150  TOPR A: "ZNALEZIONO" in S7 -> operator confirms (Found)                    (case closed, planner stops)
170  summary
"""
import argparse
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib import RESCUE, PatrolQueue, Server, ensure_binary, free_port, http  # noqa: E402

FOUND_POINT = [49.2158, 20.0188]          # Żleb pod Zawratem (same spot as scenarios/zawrat.json Found)
TEAMS = {"topr-a": "TOPR A", "topr-b": "TOPR B", "dog": "Pies (Ratownik z psem)"}

# (t seconds at speed 1, actor, action, data)
TIMELINE = [
    (10, "operator", "assign", {"topr-a": ("S4", "Najwyższe POA na starcie: Wielki Staw"), "topr-b": ("S6", "Szlak niebieski do Zawratu, korytarz BTS"),
                                "dog": ("S5", "Czarny Staw Polski, pies dobry w otwartym terenie")}),
    (30, "topr-a", "report", ("19:00", "TOPR A: przeszukaliśmy Wielki Staw, nic. Widoczność 50 m, mgła")),
    (45, "dog", "report", ("19:05", "Pies: Czarny Staw Polski przeszukany, pusto, pies nic nie podjął")),
    (47, "dog", "silent", None),
    (60, "topr-b", "report", ("19:10", "TOPR B: wiatr 15 m/s na grani, sypie śnieg, widoczność 30 m")),
    (80, "topr-b", "report", ("19:20", "TOPR B: szlak niebieski Wyżnie Solnisko - Zawrat przeszukany, nic")),
    (95, "topr-b", "report", ("19:30", "TOPR B: w Żlebie pod Zawratem czerwona rękawiczka i ślady w śniegu")),
    (105, "operator", "assign", {"topr-a": ("S7", "Rękawiczka w żlebie: S7 na 1. miejscu, zespół linowy z asekuracją")}),
    (110, "operator", "assess", None),
    (150, "topr-a", "report", ("19:50", "TOPR A: ZNALEZIONO! Osoba w Żlebie pod Zawratem, przytomna, wychłodzona, uraz nogi")),
    (153, "operator", "found", ("19:50", "ZNALEZIONO: TOPR A w żlebie pod Zawratem, osoba przytomna")),
    (170, "operator", "summary", None),
]


class Show:
    def __init__(self, a):
        self.a = a
        self.t0 = None
        self.pin = a.pin
        self.lock = threading.Lock()
        self.phones = {}
        self.last_report = {}
        self.silent_after = a.silent
        self.poa_log = []

    # ---------- output
    def say(self, who, msg, screens=None):
        t = time.time() - self.t0 if self.t0 else 0
        with self.lock:
            print(f"[{int(t // 60)}:{int(t % 60):02d}] {who:<9} {msg}", flush=True)
            for s in screens or []:
                print(f"{'':16}-> {s}", flush=True)

    def cue(self, who, msg):
        self.say(who, ">>> " + msg)
        if self.a.wait:
            input("               (Enter when done) ")

    # ---------- API
    def G(self, p, **k):
        return http(self.base, "GET", p, pin=self.pin, **k)

    def P(self, p, body, **k):
        return http(self.base, "POST", p, body, pin=self.pin, **k)

    def story_top(self, run=None):
        run = run or self.G("/story")[1]
        s = run["steps"][-1]
        top = ", ".join(f"{x['id']} {x['name'][:22]} {x['poa'] * 100:.0f}%" for x in s["segments"][:3])
        plan = ", ".join(f"{a['resourceId']}->{a['segmentId']}" for a in s.get("assignments", [])) or \
            ("brak (akcja zamknięta)" if s["kind"] == "found" else "brak")
        return run, s, top, plan

    # ---------- steps
    def setup(self):
        # Story clock = wall clock: the patrol page stamps reports with the phone's HH:MM, so scenario 19:00 = now and the
        # known facts (17:40-18:50) are shifted by the same offset. --fixed-clock keeps the original 19:00-19:50 times.
        lt = time.localtime()
        self.off = 0 if self.a.fixed_clock else (lt.tm_hour * 60 + lt.tm_min) - 19 * 60
        r = self.P("/story/new", {"template": "zawrat", "startClock": self.clock("17:40")})
        assert r[0] == 200, f"/story/new {r[0]} {str(r[1])[:200]}"
        sc = json.load(open(os.path.join(RESCUE, "scenarios", "zawrat.json")))
        facts = [dict(e, at=self.clock(e["at"])) for e in sc["events"]
                 if e["provider"] not in ("Terrain", "TerrainDifficulty", "KoesterRings", "Found", "RatunekPing") and e["at"] <= "18:50"]
        for e in facts:
            st, d, _ = self.P("/story/event", {"event": e})
            if st != 200:
                self.say("setup", f"!! {e['provider']} {st}")
        run, s, top, plan = self.story_top()
        self.seg_names = {x["id"]: x["name"] for x in s["segments"]}
        self.say("setup", f"Studio: nowa historia Zawrat (start {self.clock('17:40')}) + {len(facts)} faktów do {self.clock('18:50')}, {len(run['steps'])} kroków",
                 [f"operator app (Studio): top 3 {top}", f"planner: {plan}", "3D: korytarz od Palenicy do Zawratu, mgła"])

    def clock(self, hhmm):
        h, m = map(int, hhmm.split(":"))
        t = (h * 60 + m + self.off) % 1440
        return f"{t // 60:02d}:{t % 60:02d}"

    def now(self, scenario_at):
        """`at` for a report: the phone's wall clock (like web/patrol), or the scripted time with --fixed-clock."""
        return scenario_at if self.a.fixed_clock else time.strftime("%H:%M")

    def assign(self, data):
        for team, (seg, why) in data.items():
            if self.a.operator == "human":
                self.cue("operator", f"Edycja: przeciągnij {TEAMS[team]} na {seg} {self.seg_names.get(seg, '')}")
                continue
            st, d, _ = self.P("/story/assign", {"resourceId": team, "segmentId": seg, "segmentName": self.seg_names.get(seg), "note": why})
            self.say("operator", f"przydział {team} -> {seg} {self.seg_names.get(seg, '')} ({st})",
                     [f"telefon {team}: 'Nowe zadanie: {seg}' + wibracja (do 10-15 s, polling)", "app Teren/Przegląd zespołów: zadanie (operator)"])

    def report(self, team, at, text):
        at = self.now(at)
        self.last_report[team] = time.time()
        if team in self.a.human_teams:
            self.cue(team, f"na telefonie {team} wyślij meldunek: \"{text}\"")
            return
        q = self.phones.setdefault(team, PatrolQueue(self.base, self.pin, team, f"phone-{team}"))
        e = q.report(text, at)
        if e["status"] != "sent":
            self.say(team, f"BEZ ŁĄCZNOŚCI ({e.get('error')}) - w kolejce ({len(q.queue)}): {text}",
                     ["telefon: plakietka 'BEZ ŁĄCZNOŚCI', meldunek w kolejce, wyśle sam"])
            return
        hints = ", ".join(f"{h['type']}{' ' + h['segmentId'] if h.get('segmentId') else ''}" for h in e.get("hints") or [])
        self.say(team, f"\"{text}\"", [f"parser: {e.get('parsedBy', '?').split(':')[0]} {e.get('latency', 0):.1f} s -> {hints or 'brak wskazówek'}",
                                      "ops.html + app Teren: meldunek, 'ostatni meldunek 0 min temu'"])
        if self.a.operator == "human":
            self.cue("operator", "Teren -> Przegląd zespołów -> 'Dodaj do historii' przy nowym meldunku")
            return
        before = self.story_top()[1]
        st, run, _ = self.P("/story/event", {"event": {"provider": "FieldReport", "text": text, "at": at}}, timeout=120)
        if st != 200 or "steps" not in run:
            self.say("operator", f"!! Dodaj do historii: {st} {str(run)[:120]}")
            return
        _, s, top, plan = self.story_top(run)
        segs = sorted({h.get("segmentId") for h in e.get("hints") or [] if h.get("segmentId")})
        moves = []
        for sg in segs:
            a = next((x["poa"] for x in before["segments"] if x["id"] == sg), 0)
            b = next((x["poa"] for x in s["segments"] if x["id"] == sg), 0)
            moves.append(f"{sg} {a * 100:.0f}% -> {b * 100:.0f}%")
            self.poa_log.append((at, team, sg, a, b))
        self.say("operator", "dodane do historii (Studio FieldReport)",
                 [f"mapa/3D: {'; '.join(moves) or 'warunki'}; top 3 {top}", f"planer: {plan}",
                  "ekran operatora: odśwież (F5) jeśli meldunek dodał skrypt, nie operator"])

    def flush_queues(self):
        # same as the patrol page: queued reports are resent (original time) once the server answers again
        for team, q in self.phones.items():
            if q.queue and q.ping():
                n = q.flush()
                if n:
                    self.say(team, f"łączność wróciła: wysłano {n} z kolejki (z dopiskiem 'wysłane z opóźnieniem', czas zdarzenia zachowany)")

    def silent(self, team):
        self.say(team, f"ZESPÓŁ MILKNIE (brak meldunków). Próg ciszy {self.silent_after} s",
                 [f"za ~{self.silent_after} s: ops.html wiersz {team} na czerwono 'CISZA', baner; app: alert 'CISZA: {team}'"])
        threading.Thread(target=self.watch_silence, args=(team,), daemon=True).start()

    def watch_silence(self, team):
        while time.time() - self.last_report.get(team, time.time()) < self.silent_after:
            time.sleep(1)
        self.say("monitor", f"{team}: CISZA - ostatni meldunek {int(time.time() - self.last_report[team])} s temu",
                 ["ops.html: czerwony wiersz + baner 'Cisza'", "app operatora: alert (odświeżanie co 10 s)"])

    def assess(self):
        if self.a.operator == "human":
            self.cue("operator", "panel 'Ocena sytuacji' (reguły od razu, lokalny model za 20-40 s)")
        n = len(self.G("/story")[1]["steps"])

        def run():
            t = time.time()
            st, d, _ = self.P("/story/assessment", {"step": n}, timeout=200)
            if st != 200:
                self.say("LLM", f"!! ocena {st}")
                return
            A = d.get("assessment", {})
            self.say("LLM", f"Ocena sytuacji: {d.get('source')} w {time.time() - t:.0f} s" + (f" ({d.get('note')})" if d.get("note") else ""),
                     [f"sytuacja: {A.get('sytuacja', '')[:220]}"] + [f"hipoteza: {h.get('segment')} {h.get('opis', '')[:120]}" for h in A.get("hipotezy", [])[:2]]
                     + [f"rekomendacja: {r.get('zespol')} -> {r.get('segment')}: {r.get('dzialanie', '')[:100]}" for r in A.get("rekomendacje", [])[:2]])
        self.say("operator", "prośba o 'Ocena sytuacji' (lokalny model, bez chmury)", ["panel: najpierw reguły, potem tekst modelu"])
        (threading.Thread(target=run, daemon=True) if not self.a.no_llm else threading.Thread(target=lambda: None)).start()

    def found(self, at, title):
        at = self.now(at)
        if self.a.operator == "human":
            self.cue("operator", "Edycja: przeciągnij 'Znaleziono' na Żleb pod Zawratem (S7) - zamyka akcję")
            return
        st, run, _ = self.P("/story/event", {"event": {"provider": "Found", "at": at, "lat": FOUND_POINT[0], "lon": FOUND_POINT[1], "radiusM": 30, "title": title}})
        _, s, top, plan = self.story_top(run)
        self.say("operator", f"potwierdza ZNALEZIONO w S7 ({st})", [f"mapa/3D: S7 100%, akcja zamknięta; planer: {plan}",
                                                                    "telefony: zadania znikają przy następnym odświeżeniu"])

    def summary(self):
        run = self.G("/story")[1]
        v = run.get("value", {})
        self.say("koniec", f"{len(run['steps'])} kroków; znaleziono {v.get('findClock', '?')} w {v.get('findSeg', '?')}; "
                 f"S7 #1 od {v.get('findRank1Since', '?')}")
        for at, team, sg, a, b in self.poa_log:
            print(f"{'':16}{at} {team:<7} {sg:<4} POA {a * 100:5.1f}% -> {b * 100:5.1f}%")
        st, met, _ = http(self.base, "GET", "/metrics")
        rows = [l for l in met.splitlines() if l.startswith("rescue_reports_received_total")]
        for l in rows:
            print(f"{'':16}{l}")

    # ---------- main
    def run(self):
        a = self.a
        srv = None
        if a.server:
            self.base = a.server.rstrip("/")
        else:
            ensure_binary()
            port = a.port or free_port(8790)
            import tempfile
            live = os.path.join(tempfile.mkdtemp(prefix="rescue-showcase-"), "live-events.json")
            env = {"RESCUE_SILENT_SECONDS": str(a.silent)}
            srv = Server(port, a.pin if a.lan else None, live, host="0.0.0.0" if a.lan else "127.0.0.1", strict=False,
                         llm_off=a.no_llm, extra_env=env, log=os.path.join(os.path.dirname(live), "server.log"))
            srv.start()
            self.base = srv.base
            print(f"rescue-server on {'0.0.0.0' if a.lan else '127.0.0.1'}:{port} (silent threshold {a.silent} s, live file {live})")
            if a.lan:
                print(f"  PIN {a.pin}. Phones: http://<laptop IP on the hotspot>:{port}/web/patrol/?team=topr-a&api=http://<IP>:{port}&run=../../out/run.json")
        b = self.base
        print("Screens:")
        print(f"  operator   {b}/app/?role=operator&sc=studio&mode=teren   (Akcja for the map/3D, Teren > Przegląd zespołów for reports)")
        print(f"  3D         {b}/app/?mode=akcja&view=3d&sc=studio   (laptop/second screen, reload after changes)")
        print(f"  ops        {b}/out/ops.html")
        print(f"  phones     {b}/web/patrol/?team=topr-a&api={b}&run=../../out/run.json   (topr-b, dog)")
        if a.ready:
            input("Open the screens, then Enter to start ")
        try:
            self.t0 = time.time()
            self.setup()                       # ~15 s (every fact re-runs the engine); the show clock starts after it
            self.t0 = time.time()
            for t, actor, action, data in TIMELINE:
                due = self.t0 + t / a.speed
                while time.time() < due:
                    time.sleep(0.1)
                self.flush_queues()
                if action == "assign":
                    self.assign(data)
                elif action == "report":
                    self.report(actor, *data)
                elif action == "silent":
                    self.silent(actor)
                elif action == "assess":
                    self.assess()
                elif action == "found":
                    self.found(*data)
                elif action == "summary":
                    end = time.time() + 40
                    while any(q.queue for q in self.phones.values()) and time.time() < end:
                        time.sleep(2)
                        self.flush_queues()
                    self.summary()
            if a.keep and srv:
                input("Server keeps running for the screens. Enter to stop. ")
        finally:
            if srv:
                srv.stop()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--server", help="drive an already running rescue-server (e.g. http://127.0.0.1:8780); default: start our own")
    p.add_argument("--port", type=int, help="port for our own server (default: first free from 8790)")
    p.add_argument("--lan", action="store_true", help="own server on 0.0.0.0 (OUR phone hotspot only), PIN required")
    p.add_argument("--pin", default="4821", help="server PIN (sent by the script; needed with --lan or a strict server)")
    p.add_argument("--speed", type=float, default=1.0, help="2 = twice as fast (~90 s), 0.5 = ~6 min")
    p.add_argument("--silent", type=int, default=45, help="RESCUE_SILENT_SECONDS for our own server (dog turns red after this)")
    p.add_argument("--operator", choices=["auto", "human"], default="auto", help="human: print operator cues instead of calling the API")
    p.add_argument("--human-teams", default="", help="comma list of teams whose reports a person sends from a real phone (cue only)")
    p.add_argument("--wait", action="store_true", help="wait for Enter after each human cue")
    p.add_argument("--ready", action="store_true", help="wait for Enter before starting (time to open the screens)")
    p.add_argument("--keep", action="store_true", help="keep our own server running at the end")
    p.add_argument("--fixed-clock", action="store_true", help="scripted scenario times 19:00-19:50 instead of the wall clock (sim phones only)")
    p.add_argument("--no-llm", action="store_true", help="rules only (own server with RESCUE_LLM_OFF=1, no assessment call)")
    a = p.parse_args()
    a.human_teams = {t.strip() for t in a.human_teams.split(",") if t.strip()}
    Show(a).run()


if __name__ == "__main__":
    main()
