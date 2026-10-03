# Rescue Locator - demo video shot list

Backup video for the DEFENCE submission (MP4 not required for open tasks, but it covers venue wifi failure and mentor phase-1 review). Target **2:30**, hard max 3:00. Polish voice-over, read from [`pitch.md`](pitch.md). Record by Sun 07:00 (T+20h).

## Setup

- Source: `swift run rescue-demo`, then open `rescue/out/index.html` in Chrome, window 1920x1080, zoom so the heatmap, hints panel and plan panel all fit with no scrolling.
- Screen recorder: QuickTime (File > New Screen Recording) or OBS; record the browser window only, 30 fps, export MP4 H.264.
- Voice: record separately on a phone in a quiet room, lay it over in iMovie / CapCut. Re-record the voice, not the screen, if you stumble.
- Before recording: reset the scenario to its start state, close other tabs, hide bookmarks bar, notifications off (Focus mode).
- Every number spoken must match the screen. Replace every (TBC) in the pitch with the tool's actual output first.

## Shots

| # | Time | On screen | Voice-over (Polish, short) |
|---|---|---|---|
| 1 | 0:00-0:12 | Title card: "Rescue Locator - gdzie szukać najpierw", subtitle "HackYeah 2026, DEFENCE" | "Sobota, 17:40. Mąż, 58 lat, poszedł sam w Gorce i nie wrócił. Za godzinę zachód słońca, od 15:00 mgła." |
| 2 | 0:12-0:30 | Incident open: map of the valley, car pin at the trailhead parking, faint Koester rings heatmap | "Ratownik ma kilka okruchów i łączy je w głowie na papierowej mapie. Zaczynamy od statystyk Koestera: jak daleko zwykle odchodzi turysta w górach." |
| 3 | 0:30-0:55 | Click hint 1 "plan wycieczki: czerwony szlak do schroniska" - heat concentrates on the trail. Click hint 2 "112, 14:12, ~1,5 km" - circle cuts the heat. Click hint 3 "mgła od 15:00" | "Każda wskazówka to osobny moduł. Plan wycieczki. Lokalizacja z sieci sprzed trzech godzin. Mgła. Mapa przelicza się na żywo." |
| 4 | 0:55-1:05 | Toggle the trip-plan hint off and on again, heatmap visibly changes | "Wyłączam wskazówkę i widać, ile wniosła. Nic nie jest czarną skrzynką." |
| 5 | 1:05-1:25 | Zoom / highlight the right panel "Plan pierwszej godziny": top 3 segments with % and a team task each | "Plan pierwszej godziny: trzy sektory, procent prawdopodobieństwa i konkretne zadanie dla każdego zespołu. 30 sekund zamiast 20 minut pracy nad mapą." |
| 6 | 1:25-1:50 | **Wow.** Click "Sektor 3 przeszukany dronem - brak wyniku". Heat drains from segment 3 and flows to the stream below the junction; plan re-ranks | "Najważniejsze: dron przeleciał sektor trzeci i nic nie znalazł. To też jest informacja. Prawdopodobieństwo przepływa do potoku poniżej rozwidlenia." |
| 7 | 1:50-2:05 | Mocked Ratunek ping drops inside the new top segment, pin pulses | "I właśnie tam przychodzi ping z aplikacji Ratunek." |
| 8 | 2:05-2:20 | Slide: architecture - providers -> fused stream -> heatmap + ranking; small "AML / RECCO / dron = kolejny moduł" | "Każde nowe źródło - AML, RECCO, dron na żywo - to po prostu kolejny moduł. Tylko legalne źródła, zero śledzenia, dane w demo są fikcyjne." |
| 9 | 2:20-2:30 | End card: value number, repo link, team, "Reagowanie kryzysowe, gdy informacji jest mało" | "Trzy sektory, około 12 procent obszaru, około 60 procent szansy. Rescue Locator." |

## Checklist before upload

- Length under 3:00, MP4, 1080p, audio level even.
- No real names, phone numbers or real 112 data anywhere on screen; the scenario person is fictitious.
- Repo link and demo link readable on the end card for 3+ seconds.
- File name: `rescue-locator-demo.mp4`; link it from slide 6 and slide 10.
