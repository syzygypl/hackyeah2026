# Rescue Locator - fact-check materiałów do pitchu

AI Denisa, 2026-10-04 06:50, na prośbę AI Mateusza #2 (ASK 06:45). Tylko odczyt: repo na `aa6d8ce`, produkcja https://rescue-locator.vercel.app (tylko GET, bez klucza, bez zapisów). Materiały nie są edytowane, poprawki wchodzą do pakietu o 08:00.

Sprawdzone pliki: `docs/rescue-locator/pitch-historia.md`, `pitch.md`, `demo-runbook.md`, `docs/submission/hackathon/rescue-locator/video/shotlist.md` i `draft.srt`. Każda liczba i twierdzenie zostały porównane ze źródłem w repo (eval, README, commity) albo z produkcją.

Uwaga: w repo są już paczki `v5` i `v6` (`docs/submission/hackathon/rescue-locator/`), a ASK mówi o v4 jako najnowszej. Przed 08:00 trzeba sprawdzić, która paczka idzie do zgłoszenia.

## Do poprawy przed 08:00 (BŁĄD)

| # | Plik:linia | Twierdzenie | Źródło | Poprawka |
|---|---|---|---|---|
| 1 | pitch.md:101 (pitch PL) | "działa offline" | v4/CHANGELOG.md: bez deklaracji offline, model w pokazie to OpenAI; commit `556a747` "drops the offline promise"; `/health`: `llm-openai` | Usunąć. Np. "model AI w chmurze, a gdy nie odpowiada, meldunki czytają reguły" |
| 2 | pitch.md:83, 135 | "works without internet", "Does it need the internet? No." | j.w.; rescue/README.md: wdrożony serwer + OpenAI wymagają sieci | "Pokaz: tak (Vercel + OpenAI). Lokalny serwer z regułami działa bez sieci, ale tego nie obiecujemy" |
| 3 | pitch.md:70 | "Local qwen3 4B in Ollama, offline" jako ścieżka w demo | rescue/README.md: na produkcji OpenAI, Ollama tylko lokalnie | "Na produkcji OpenAI; lokalnie Ollama qwen3 4B 1,3-1,7 s; reguły ~15 ms" |
| 4 | pitch.md:85, 140-141 | "providers in a Swift package", "Why Swift? ... iPad/Mac, offline" | `6604627` port do Rusta, `324a184` Vercel uruchamia serwer Rust, `785fcf1` Swift tylko jako Dockerfile.swift do wycofania | "Silnik w Ruście na produkcji, Swift jako zapas"; pytanie "Why Swift" przepisać albo usunąć |
| 5 | pitch.md:143 | "Terrain is real OSM + DEM for all three scenarios ... and blind-01" | /health i `/api/scenarios`: 18 scenariuszy; backtest.md: 9/9 "prawdziwy (OSM+DEM)" | "Teren OSM + DEM dla wszystkich scenariuszy na produkcji" |
| 6 | pitch.md:71, 132 | planer: "20% szansy w 1 h 46 min vs 2 h 00 min" | rescue/README.md:46: "after 2 h 15% vs 16%, after 3 h 22% vs 23%: no gain", plan backtest 286 vs 207 min; v2/CHANGELOG.md:9 tę liczbę usunął | "15% vs 16% po 2 h, 22% vs 23% po 3 h - bez zysku" |
| 7 | pitch.md:129 | "the zawrat result (#1) holds for both" (POD 0,6 i 0,75) | rescue/README.md:41: "With 0.6 S7 is #2 at 19:45, with 0.75 ... #1; area 0.07-0.28% vs 34.3%" | "Przy 0,75 S7 jest #1, przy 0,6 #2; obszar 0,07-0,28% vs 34,3% z samymi pierścieniami" |
| 8 | pitch.md:101; runbook:103 | "w pięciu pasmach górskich" / "w 5 pasmach" | results.json: zawrat, kasprowy, morskie-oko (Tatry) + Bieszczady + Karkonosze = 5 rejonów, 3 pasma | "w pięciu rejonach górskich (Tatry, Bieszczady, Karkonosze)" |
| 9 | pitch.md:64 | backtest: "9 fictional scenarios in 5 regions" | validate/backtest.md: 6 górskich (w tym blind-01-replay, to nie nasz scenariusz autorski) + 3 wodne | "9 scenariuszy (6 górskich, 3 wodne)"; zaznaczyć blind-01-replay |
| 10 | pitch-historia.md:23 | "ok. 22 ms" z wątku "nie jest udokumentowane" | wydajnosc.md:184: "`/api/incidents` 22 ms po rozgrzewce (Swift 29.5 s)" - pomiar lokalny, Rust release | "22 ms to pomiar lokalny (wydajnosc.md); w pitchu cytujemy produkcję 34,3 -> 0,43 s" |
| 11 | demo-runbook.md:70 (krok 5) | "18 akcji na mapie Polski (1 LIVE)" | od `aa6d8ce` (06:31) Centrum ukrywa duplikat morzycko: na produkcji 17 akcji, 1 LIVE (`/api/incidents` nadal 18) | "17 akcji na mapie Polski (1 LIVE)" |
| 12 | demo-runbook.md:48, 90 | pierwsze wejście: mapa 15-25 s, `/api/incidents` na zimno ~17 s | linia z `38f25f1` (sob 20:15, Swift). Po porcie: `/api/incidents` p50 0,43 s (wydajnosc.md "Runda 2"); perf-transitions.md Runda 3: Akcja 2D zimno 7,8 s, ciepło 1,8 s | "pierwsze wejście: mapa ok. 4-8 s, lista akcji < 1 s" (rozgrzewanie kart nadal zalecane) |
| 13 | demo-runbook.md:3 | "Stan kodu: b2ed46d", URL-e sprawdzone 2026-10-03 | `b2ed46d` to sob 20:06, HEAD `aa6d8ce` (357 commitów dalej). Wszystkie URL-e sprawdzone ponownie dziś: 200 | "Stan kodu: aa6d8ce. URL-e sprawdzone GET-em (200) 2026-10-04" |

## Brak źródła w repo (BRAK ŹRÓDŁA)

| # | Plik:linia | Twierdzenie | Co jest | Poprawka |
|---|---|---|---|---|
| 14 | demo-runbook.md:36 | "serwer Rust, 545fe02, pomiar AI Marcina 04:59": meldunek ~1-2 s, Potwierdź 0,5 s, ZNALEZIONO w Centrum ~7 s | `545fe02` to commit z dokumentacją Czatu, nie pomiar; linię dopisał `fa87d1e` (05:00). Pomiaru nie ma w repo; qa-demo-path.md ma stare czasy Swift | Dopisać pomiar do repo (np. wydajnosc.md) albo napisać "pomiar z wątku, produkcja 545fe02". Czasy telefonu (co 15 s, 20-25 s) są OK: patrol/index.html `setInterval 15000`, qa-demo-path.md |

## Uwagi drobne (OK z zastrzeżeniem)

- pitch-historia.md:21: "Runda 2, p50 z sali" - p50 dotyczy strony Rust; strona Swift to mediana z 3 albo pierwszy pomiar (34,3 s). Lepiej: "Rust p50 vs Swift z rundy 1". Ten sam punkt ma zakres "do 00:11", a pomiar `402802f` jest z 00:38.
- pitch-historia.md:15: "tego samego popołudnia" - `90bc1e6` jest z 18:14, czyli raczej wieczór.
- pitch.md:49: 4,1% obszaru w blind-01 to silnik z czasu rundy, a 2,1% w tabeli wyżej to obecny silnik (eval/README "2.1% now vs 4.1% then"). Warto to napisać; "Round 1 so far" jest już nieaktualne.
- pitch.md:60, 97: "top 3 = 7% obszaru" to stan na 19:45 (rescue/README.md:37), a w pitchu pada przed pustymi przeszukaniami. Na ekranie zgadza się: Na żywo S7+S4+S3 = 7,04%, Historia z pokryciem S4+S3+S6 = 7,48%, oba zaokrąglone do 7%.
- pitch.md:11: report-land.md podaje silnik `db11391`, a results.json `6f11fb8` - rozbieżność w źródłach, liczby są te same.
- demo-runbook.md:54, 91: plan B lokalny to `swift run rescue-server`; produkcja jest na Ruście. Działa, ale można dodać wariant z `rescue/rs`.
- validate/backtest.md ma nieaktualny dopisek "(tak jak dla zawrat: ranga #1 -> #2)".

## Sprawdzone i zgodne (OK)

**Kalibracja i test na ślepo (pitch.md, runbook sekcja 4, krok 7):**
- Ląd, 1000 przypadków:
  - top 3: 66/56/43% (results.json 0,657/0,563/0,431);
  - obszar: mediana 5,5/6,4/22,6%, p90 29/37/68%;
  - kalibracja procentów: Brier 0,81, segment "45%" trafia w 19%, "85%" w 61%;
  - Bieszczady: 4,7 vs 5,7;
  - mapa wygrywa top 3 w 5/5 rejonów;
  - jedna myląca wskazówka: n = 249, 59% vs 49%;
  - `--features all`: 65,7%.
- Woda, 600 przypadków:
  - top 3: 91/81%;
  - obszar: 0,96/5,9% vs 1,09/11,4%;
  - pływak na jeziorze: Śniardwy 1,15 vs 0,49 (gorzej w 47 z 61), Morzycko 32 z 39.
- Test na ślepo:
  - blind-01: 2,1/4,4/24,1%;
  - blind-02: 37,4/23,2/39,9/35,7%;
  - sam planer: 180 vs 35 min, a w blind-02 nie znajduje w 6 h;
  - blind-01 znaleziona w 3. fali, przy 12. przydziale;
  - reveal `ad2ced5` i `a0476e0`, hashe zgodne;
  - blind-02 znaleziony o 21:20 w D18 przez patrol A, prawdziwy segment #8 z 20, szczyt mapy ok. 1,0 km.
- Ekran demo i backtest:
  - zawrat: #1 vs #20, obszar 0,07% vs 34,3%, o 18:30 #5;
  - backtest: top 3 w 8/9, 2,18% vs 20,0%; Karkonosze i kasprowy jak w pitch.md;
  - qwen 1,3-1,7 s, reguły ~15 ms;
  - AML w Polsce ok. 2027 (research.md).

**Historia projektu (pitch-historia.md):**
- Wszystkie cytowane commity istnieją, a godziny i tematy się zgadzają: od `0a6a87b` 11:33 do `e949d42` 00:01, port Rust `c8ff366`-`71e426a`.
- Liczby wydajności:
  - silnik 11-240 ms vs 2-6 s, `/api/incidents` 29,5 s -> ok. 1,5 s, zgodność 93/105 (`6604627`);
  - przed portem 28-36 s (wydajnosc.md);
  - Runda 2: 34,3 -> 0,43, 9,8 -> 0,32, 7,4 -> 0,85, 7,5 -> 0,29;
  - do 2,6 MB, API w fra1, ok. 0,2 s to sieć.
- perf-transitions.md: hashe i liczby są zgodne z wydajnosc.md.

**Produkcja (runbook, shotlist, draft.srt):**
- Wszystkie URL-e z runbooka i shotlisty zwracają 200, łącznie z URL-em patrolu z `?me=`.
- `/health`: `llm-openai`, `shared`.
- LIVE = Połonina Wetlińska.
- Zawrat:
  - Na żywo stoi na 19:45;
  - ZNALEZIONO śmigłowiec TOPR, S7, 20:03 (zawrat.json, `liveCursor.next`);
  - Historia 19:45: S4/S3/S6; Na żywo i Centrum: S7/S4/S3 (zgodnie z shotlist.md "Known gaps").
- Porównanie:
  - 19:20 S4/S7/S3 -> 19:22 S7/S6/S9;
  - epilog: pies 94,9 min (95), dron 12,4 min (12).
- Odprawa `t=19:45` i `&karty=1` działają.
- Doradca: hipoteza zapory na Sanie (7 scenariuszy `zapora-*`).
- draft.srt: 17 napisów identycznych z shotlistą.
- draft.mp4: 2:06,6, 1440x900, H.264, 25 fps, 37,96 MB.
- Info: `/api/live` ma teraz `seq` 50. Przed pokazem człowiek z kluczem robi **Wyczyść akcję** (runbook to przewiduje).
