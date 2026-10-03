# Showcase on real devices (pitch)

One laptop is the server; phones and screens join **our own phone hotspot**, never the hall Wi-Fi.

## Setup (10 min before)

1. Laptop + 2-3 phones + optional tablet join the hotspot. Laptop IP: `ipconfig getifaddr en0` (below: `IP`).
2. Ollama running with `qwen3:4b-instruct-2507-q4_K_M` warm (send one report first). Nothing else heavy on Ollama: a busy model makes reports time out on the phones (they queue and resend, see Fallback).
3. Start server + story (one command, keeps the server for the screens):
   ```sh
   python3 rescue/integration/showcase/showcase.py --lan --pin 4821 --port 8790 --ready --keep
   ```
   (or drive an already running `swift run rescue-server 8790 --host 0.0.0.0 --pin 4821` with `--server http://127.0.0.1:8790 --pin 4821`; start it with `RESCUE_SILENT_SECONDS=45` so the silent team turns red during the show). Use a PIN without a leading zero.
4. Screens (laptop ones are loopback, no PIN):
   - Laptop (projector): `http://127.0.0.1:8790/app/?role=operator&sc=studio` - Akcja for map/3D, Teren > Przegląd zespołów for team cards and reports.
   - Second screen on the laptop: `http://127.0.0.1:8790/web/3d/?run=/story&scenario=/story/scenario&sc=zawrat&standalone=1` and `http://127.0.0.1:8790/out/ops.html`.
   - Phones: `http://IP:8790/web/patrol/?team=topr-a&api=http://IP:8790&run=../../out/run.json` (also `team=topr-b`, `team=dog`). Type the URL or make a QR from it with any QR app; the first report asks for the PIN once.
   - Tablet (optional): `http://IP:8790/out/ops.html` (asks for the PIN).
   Why not `/app/?role=ratownik` and 3D on the tablet: today the embedded map/patrol and the 3D fetch the run without the PIN and get 401 on LAN (see `rescue/integration/report.md`). The task card works; use the patrol URL above until fixed.
5. Press Enter in the terminal to start. ~3 min at `--speed 1`.

## Minute by minute

| Time | What happens | Say / do |
|---|---|---|
| 0:00 | Story: plan from the wife, car at Palenica, 112 sector, fog, dusk | "Kierownik ma tylko poszlaki. Mapa mówi, gdzie najpierw." |
| 0:10 | Operator assigns TOPR A -> S4, TOPR B -> S6, dog -> S5 | Phones vibrate within 10-15 s: "Nowe zadanie" |
| 0:30-1:20 | Phones report "nic", weather | Map: searched segments drop; ops: last report 0 min |
| 0:47 | Dog goes silent | ~45 s later ops.html row red "CISZA" + banner |
| 1:35 | TOPR B: red glove in the gully under Zawrat | S7 jumps to ~70% |
| 1:45 | Operator re-tasks TOPR A -> S7 | TOPR A phone vibrates |
| 1:50 | "Ocena sytuacji": rules at once, local model in 20-40 s | "Model lokalny, bez chmury, nie wymyśla segmentów" |
| 2:30 | TOPR A: ZNALEZIONO; operator confirms | S7 100%, planner stops |

For a human-driven take: `--operator human --human-teams topr-a --wait` prints cues ("drag TOPR A onto S7", "send report X from the phone") and waits for Enter. In auto mode the operator screen needs F5 after script changes (the app does not poll the story); in human mode the operator's own clicks update it live.

## Fallback

- Ollama slow/busy: reports still parse by rules (`--no-llm` forces it); the assessment shows the rules version with "reguły".
- Network drops: phones show "BEZ ŁĄCZNOŚCI", reports queue and resend automatically with the original time. Demo it: airplane mode on one phone, send a report, airplane off.
- After a server restart operator assignments are gone (in memory): re-assign.
- After the demo: Ctrl-C the server, never leave it on 0.0.0.0.
