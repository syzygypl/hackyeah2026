#!/usr/bin/env python3
"""Monitoring demo: rescue-server + 3 simulated patrol phones + one silent team + a bad-PIN attacker.

    python3 rescue/monitoring/demo.py              # ~3 min, then keeps the server up until Ctrl-C
    python3 rescue/monitoring/demo.py --fast       # same story in ~60 s (for the pitch video)
    python3 rescue/monitoring/demo.py --rules      # force rules parsing (RESCUE_LLM_OFF=1), no Ollama needed
    python3 rescue/monitoring/demo.py --exit       # stop the server when the story ends

Open http://127.0.0.1:8772/ops.html (built-in) and, if Docker is up, Grafana http://127.0.0.1:3000.
The server binds 127.0.0.1 only. RESCUE_GUARD_STRICT=1 + --pin make loopback clients behave like phones on
the hotspot, so the attacker hits the real PIN guard without exposing anything on the network.
Reports go to a temp live-events file (RESCUE_LIVE_FILE), never to rescue/out/live-events.json. Stdlib only.
"""
import json, os, random, signal, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error

PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8772   # own port: never collides with a real rescue-server on 8780
PIN = str(random.randint(100000, 999999))
FAST = "--fast" in sys.argv
SCALE = 1 / 3 if FAST else 1.0                         # story time multiplier
SILENT = 20 if FAST else 60                            # demo threshold for "client silent" (production: 600)
BASE = f"http://127.0.0.1:{PORT}"

# (client_id, team, reports) - realistic radio-style Polish reports from the Zawrat scenario
CLIENTS = {
    "topr-a": ("topr-a", [
        "Patrol 1: wyszliśmy ze schroniska, kierunek Przedni Staw, widoczność 200 m",
        "Patrol 1: Przedni Staw przeszukany, nic, wiatr 8 m/s",
        "Patrol 1: Wielki Staw obchodzimy od wschodu, pusto",
        "Patrol 1: znaleziono rękawiczkę na szlaku niebieskim ok. 300 m nad stawem",
        "Patrol 1: podchodzimy szlakiem niebieskim pod Zawrat, widoczność 50 m, mgła",
        "Patrol 1: szlak niebieski pod Zawratem przeszukany, nic, zaczyna padać śnieg",
        "Patrol 1: schodzimy do żlebu, asekuracja na linie",
        "Patrol 1: żleb pod Zawratem, dolna część pusto, idziemy wyżej",
    ]),
    "topr-b": ("topr-b", [
        "Patrol 2: start z Palenicy, Dolina Roztoki, wszystko w normie",
        "Patrol 2: Dolina Roztoki dolna przeszukana, nic",
        "Patrol 2: Siklawa, brak śladów, widoczność 100 m",
        "Patrol 2: Czarny Staw i Zadni Staw przeszukane, pusto, wiatr 12 m/s",
        "Patrol 2: Zmarzły Staw, brak śladów, słychać gwizd od strony Zawratu",
        "Patrol 2: idziemy w stronę Koziej Dolinki, wiatr 14 m/s",
        "Patrol 2: Kozia Dolinka pusto, zawracamy pod Zawrat",
        "Patrol 2: dołączamy do Patrolu 1 pod żlebem",
    ]),
    "dog": ("psy", [
        "Pies: zaczynamy od schroniska, pies pracuje",
        "Pies zaznaczył przy Czarnym Stawie",
        "Pies: Czarny Staw obejście zakończone, ślad urywa się przy szlaku",
        "Pies: pies zmęczony, krótka przerwa przy Zadnim Stawie",
    ]),
}
SILENT_CLIENT = "dog"   # stops after its 4th report: the "team went quiet" moment


def say(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def post(text, client, team, pin=PIN):
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(BASE + "/report", data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Rescue-Pin": pin, "X-Rescue-Client": client,
        "X-Rescue-Team": team, "X-Rescue-Source": "patrol-sim"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # noqa
        return 0, str(e)


def wait_up():
    for _ in range(120):
        try:
            urllib.request.urlopen(BASE + "/health", timeout=1).read(); return True
        except Exception:
            time.sleep(0.5)
    return False


def patrol(client, team, reports, start, gap, stop_at=None):
    time.sleep(start * SCALE)
    for i, text in enumerate(reports):
        if stop_at is not None and i >= stop_at:
            break
        code, rep = post(text, client, team)
        how = (rep or {}).get("parsedBy", "?") if isinstance(rep, dict) else rep
        say(f"{client:7s} -> {code} {how:<14.14s} {text}")
        time.sleep(gap * SCALE * random.uniform(0.85, 1.15))
    if stop_at is not None:
        say(f"{client}: ZESPÓŁ MILKNIE (brak meldunków; alarm po {SILENT} s ciszy)")


def attacker(start, n, every):
    time.sleep(start * SCALE)
    say(f"ATAK: ktoś z sieci zgaduje PIN ({n} prób)")
    codes = {}
    for _ in range(n):
        code, _ = post("test", "x", "x", pin=str(random.randint(0, 999999)).zfill(6))
        codes[code] = codes.get(code, 0) + 1
        time.sleep(every * SCALE)
    say(f"ATAK zakończony: odpowiedzi serwera {codes} (żaden meldunek nie wszedł)")


def main():
    if not os.path.exists(os.path.join(PKG, ".build/debug/rescue-server")) or "--no-build" not in sys.argv:
        say("swift build ...")
        subprocess.run(["swift", "build", "--product", "rescue-server"], cwd=PKG, check=True, stdout=subprocess.DEVNULL)
    live = os.path.join(tempfile.mkdtemp(prefix="rescue-demo-"), "live-events.json")
    env = dict(os.environ, RESCUE_GUARD_STRICT="1", RESCUE_SILENT_SECONDS=str(SILENT), RESCUE_LIVE_FILE=live, RESCUE_RATE_PER_MIN="60")
    if "--rules" in sys.argv:
        env["RESCUE_LLM_OFF"] = "1"
    log = open(live + ".server.log", "w")
    srv = subprocess.Popen([os.path.join(PKG, ".build/debug/rescue-server"), str(PORT), "--host", "127.0.0.1", "--pin", PIN],
                           cwd=PKG, env=env, stdout=log, stderr=subprocess.STDOUT)
    signal.signal(signal.SIGINT, lambda *_: (srv.terminate(), sys.exit(0)))
    if not wait_up():
        print(open(live + ".server.log").read()); srv.terminate(); sys.exit(f"rescue-server did not start on :{PORT} (port busy?)")
    say(f"rescue-server na {BASE} (PIN {PIN}, próg ciszy {SILENT} s, live file {live})")
    say(f"Otwórz: {BASE}/ops.html   |   Grafana: http://127.0.0.1:3000 (jeśli docker compose up)")

    # story: 3 teams report; dog goes quiet at ~75 s; attacker at ~120 s; patrols continue to ~180 s
    threads = [
        threading.Thread(target=patrol, args=("topr-a", "topr-a", CLIENTS["topr-a"][1], 2, 22)),
        threading.Thread(target=patrol, args=("topr-b", "topr-b", CLIENTS["topr-b"][1], 9, 22)),
        threading.Thread(target=patrol, args=("dog", "psy", CLIENTS["dog"][1], 5, 22, 4)),
        threading.Thread(target=attacker, args=(120, 40, 0.5)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    say("Historia zakończona. Na ops.html: 'dog' na czerwono (CISZA), skok odrzuceń 'zły PIN', meldunki/min.")
    if "--exit" in sys.argv:
        srv.terminate(); return
    say("Serwer działa dalej (Ctrl-C kończy). Log serwera: " + live + ".server.log")
    srv.wait()


if __name__ == "__main__":
    main()
