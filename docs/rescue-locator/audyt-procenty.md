# Audyt procentów i pokrycia (POA, POD, % obszaru)

Autor: Claude (audyt na prośbę Mateusza), 2026-10-04. Część 1 (POA/Bayes silnika) przejął AI Andrzeja - jego ustalenia mają pierwszeństwo, tu tylko kontrola krzyżowa. Tylko odczyt: kod `origin/main` @ cbdf4b5 (silnik i UI 2D bez zmian od 2bd6542; app3d.js przesunięty, linie zaktualizowane) (Rust `rescue/rs` = produkcja, Swift `rescue/Sources` = wzorzec) oraz produkcja `https://rescue-locator.vercel.app` (`GET /api/run/zawrat?live=0`, `GET /api/run/zawrat?t=19:45`, `GET /api/run/zawrat`, `GET /api/incidents?fast=1`). Liczby przeliczone niezależnie w Pythonie z odpowiedzi API (skrypty w scratchpadzie, opis metody na końcu). Pojęcia jak w `slownik.md`.

## Wynik w skrócie

Rdzeń matematyki jest poprawny (niezależnie potwierdził AI Andrzeja dla części 1): POA sumuje się do 1, agregacja na segmenty jest dokładna, aktualizacja bayesowska po pustym przeszukaniu daje dokładnie POA x (1 - POD) i renormalizację, POD w osi czasu to poprawny model Koopmana, a `% obszaru` to udział komórek 100 x 100 m (w praktyce równy powierzchni geodezyjnej). Problemy są na styku: dwa tryby (kroki vs oś czasu) liczą te same przeszukania inaczej, kilka liczb "przeszukano" i "szansa znalezienia" ma różne definicje w różnych widokach, a dwie formuły w UI i ćwiczeniu są matematycznie błędne.

| # | Znalezisko | Waga | Właściciel |
|---|---|---|---|
| A | Historia (oś czasu, `searchEvents: replace`) wyrzuca WSZYSTKIE meldunki "przeszukano, nic", także te bez śladu GPS. Dlatego o 19:45 Historia pokazuje S4/S3/S6, a reszta aplikacji S7/S4/S3 | **bug** | silnik (AI Andrzeja), dane śladów zawrat (AI Marcina) |
| B | 2D "szansa znalezienia dotąd" sumuje warunkowe przyrosty POA x POD: zawrat 19:35 pokazuje 74,6%, poprawnie 57,3% | **bug** | UI (AI Mateusza / AI Marcina) |
| C | Fix stożka psa 31c2cbc NIE jest w `main` (tylko gałąź `origin/fix/dog-cone-no-wind`); a nawet po scaleniu obrys pola widzenia psa nadal rysuje okrąg 151 m | **bug** | FOV/POD (AI Michała) |
| D | Ćwiczenie: po przeszukaniu "rdzenia" segmentu silnik dostaje `SegmentSearched` z POD rdzenia dla CAŁEGO segmentu (np. S7: 0,42 zamiast ok. 0,20) | **bug** | silnik (AI Andrzeja) |
| E | "Przeszukany obszar" ma 3 definicje: panel i 3D = suma `areaPct` całych segmentów z meldunkiem (zawrat 19:45: 24,8%), legenda 2D i `coverageFinal` = komórki z POD >= 0,1 (1,5%), ćwiczenie = komórki rdzeni | mylące | UI + silnik |
| F | W trybie Historia panel i 3D biorą ranking z klatki osi czasu, a Odprawa (z dopiskiem "nagranie (Historia)"), Porównanie, Centrum i `/api/incidents` z kroku | mylące | UI |
| G | POA nadal widać jako "%" lub "szansę": powód przydziału "POA 10%, POD 42%" (panel zespołu, Szczegóły), 2D standalone (kolumna POA, "top 3 = 46%", "szansa znalezienia" = POA x POD), dymek komórki "POA komórki" | mylące | UI + silnik (tekst powodu) |
| H | POA jest normalizowane do prostokąta planowania: tylko 53% masy pierścieni Koestera leży w obszarze zawrat, a kontrola pokrycia zgłasza 10,3% i potem `worstOutsidePct: 0` | mylące | silnik |
| I | Dwa modele POD dla tej samej akcji: planer (tabela POD na przejście, cap 0,95) i oś czasu (Koopman z fov-params); panel "skuteczność" bierze max zamiast 1 - Π(1 - POD) | mylące | FOV/POD + UI |
| K | Wagi wskazówek działają tylko na żywo: wskazówki ze scenariusza (skrypt) mają wagę 1, chyba że scenariusz włączy `clueWeights`, a te same wskazówki na żywo są ważone źródłem (operator 1,0 ... obywatel niezweryfikowany 0,3). Ta sama informacja daje inną mapę w nagraniu i na żywo (za AI Andrzeja) | mylące | silnik (AI Andrzeja) |
| J | Drobne: `pos`/`cumPod` osi czasu skaczą po ZNALEZIONO (0,119 -> 0,37) i `cumPod` potrafi maleć; przy krawędzi siatki pokrycie jest "przesuwane", a nie tracone; planer karze ponowne przeszukanie drugi raz (POA już spadło) | niska | silnik / FOV |

Wszystko poniżej: jak to działa (wzór + plik:linia), czy jest poprawne, dowód liczbowy, waga, minimalna poprawka.

---

## 1. POA na segment

### Jak działa

- **Siatka i segmenty.** Prostokąt `bbox` dzielony na komórki `cellM` (zawrat: 60 x 72 = 4320 komórek, 100,2 x 100,0 m). Każda komórka należy do segmentu o najbliższym ziarnie (`seed`), więc segmenty to komórki Voronoi pokrywające CAŁY prostokąt, bez dziur i bez "reszty świata". Rust `kit/probability_grid.rs:94-103, 191`; Swift `ProbabilityGrid.swift:96`.
- **Fuzja.** POA_komórki = Π warstw f_k(komórka) / Σ po wszystkich komórkach. Rust `probability_grid.rs:443-460`; Swift `ProbabilityGrid.swift:226-238`. Normalizacja jest po wszystkich komórkach prostokąta (łącznie z tym, co jest "na zewnątrz" segmentów, bo takiego obszaru nie ma).
- **Pierścienie Koestera (prior).** Gęstość na m² = masa pasma / pole pierścienia, masy 25/25/25/20% między kwantylami 25/50/75/95%, ogon 5% rozłożony stałą gęstością na π·3R². Rust `probability_grid.rs:246-263`; Swift `ProbabilityGrid.swift:110-117`. Teren to kolejne mnożniki (szlaki, potoki, schroniska, jeziora x0,15, koszt ścian x0,35, trudność): `probability_grid.rs:287-297, 411-417`.
- **Wagi wskazówek (clue_weights).** waga = wiarygodność(źródło) x dokładność(typ) x 0,5^(wiek / półokres) x potwierdzenie, obcięta do 0..1; warstwa wchodzi jako f^waga. Rust `kit/clue_weights.rs:418-431` (baza), `:493` (kiedy stosowana), `:500` (wykładnik), `probability_grid.rs:430-439`; Swift `ClueWeights.swift`, `ProbabilityGrid.swift:231-232`. Stosowane tylko do wskazówek na żywo, z ręczną wagą operatora albo z `features: clueWeights` / `applyToScripted` (w zawrat wszystkie `applied: false`, więc mapa bez zmian).
- **Bayes po pustym przeszukaniu.** Warstwa `Searched`: (1 - POD) dla wszystkich komórek przeszukanych segmentów, 1 poza nimi, potem ta sama normalizacja. Rust `probability_grid.rs:400-404`; Swift `ProbabilityGrid.swift:204`. Z wagą: (1 - POD)^waga, czyli efektywny POD = 1 - (1 - POD)^waga (np. "Przeszukane - nic" 0,8 od ratownika: 0,77 od razu, 0,52 po 6 h, bo półokres "przeszukanie" = 6 h).
- **Segment.** POA_segmentu = Σ POA komórek; `areaFrac` = liczba komórek / wszystkie. Rust `probability_grid.rs:520-538`; Swift `ProbabilityGrid.swift:243-253`.

### Czy poprawne: TAK (z jednym zastrzeżeniem, H)

Dowód (zawrat, 17 kroków z `?live=0`):

| sprawdzenie | wynik |
|---|---|
| Σ `poaGrid` w każdym kroku | 0,99999-1,00005 (zaokrąglenie do 4 cyfr znaczących) |
| Σ `segments[].poa` | 0,99989-1,00012 |
| max \|Σ POA komórek segmentu - `segments[].poa`\| | 5,4e-5 |
| Bayes 18:40 S1+S2 POD 0,7 | stosunek wewnątrz/na zewnątrz = 0,3000 (oczekiwane 0,3); na zewnątrz x1,0821 = 1/(1 - 0,7 x 0,1084) |
| Bayes 18:50 S3 POD 0,8 | 0,2000; x1,2399 = 1/(1 - 0,8 x 0,2419) |
| Bayes 19:20 S6 POD 0,75 | 0,2500; x1,1795 |
| Bayes 19:35 dron S4+S5 POD 0,75 | 0,2500; x1,4792 = 1/(1 - 0,75 x 0,4319) |

Aktualizacja jest dokładnie P(i | nic) ∝ P(i)·(1 - POD_i). Nie ma podwójnego liczenia w trybie kroków.

### Niezależna kontrola: AI Andrzeja (temat 2, 13:39)

AI Andrzeja przejrzał część 1 niezależnie (tylko odczyt) i potwierdza: Rust i Swift mają te same wzory linia w linię; puste przeszukanie to dokładna aktualizacja bayesowska; "% obszaru" to udział powierzchni, nie prawdopodobieństwo. Zgadza się to z tabelą wyżej (Bayes 0,3 / 0,2 / 0,25 / 0,25, Σ POA = 1) i z punktem 3 (`areaPct` = udział komórek, różnica geodezyjna <= 0,004 pp).

Szczegóły od AI Andrzeja, zgodne z tym audytem: POA = iloczyn warstw normalizowany po wszystkich komórkach prostokąta (`probability_grid.rs:443-460`, Swift `ProbabilityGrid.swift:225-238`), segmenty Voronoi (`:191`), `areaPct` = udział komórek (`run_json.rs:117`); prior Koestera 25/25/25/20 na kwantylach 1,1 / 3,0 / 5,8 / 11,5 km (`koester_rings_provider.rs:24`), poza pierścieniem 95% gęstość nominalna 0,05/(3·π·r95²) (`probability_grid.rs:246-263`); teren 1 + 2,5e^(-dSzlak/120) + 1,5e^(-dPotok/120) + 1,0e^(-dSchronisko/150), jeziora x0,15 (`:287-296`); waga wskazówki = źródło x typ x 0,5^(wiek/półokres) x potwierdzenie (`clue_weights.rs:418-494`), jako warstwa^waga przy wadze < 0,9995 (`probability_grid.rs:430-439`); puste przeszukanie x(1 - POD) i normalizacja (`:400-404`), domyślnie SegmentSearched 0,7, DronePassEmpty 0,6; `parity.py`: 103/105 dokumentów bajt w bajt. Jego zastrzeżenie, że bezwzględne POA zależy od wielkości prostokąta, to ta sama sprawa co punkt H niżej (tylko 53% masy Koestera w prostokącie zawrat).

Rozbieżność do rozstrzygnięcia: AI Andrzeja pisze "UI nigdy nie pokazuje POA jako szansy". Ten audyt (punkt G) znalazł miejsca, gdzie POA lub POA x POD jest pokazane jako % albo "szansa":

| miejsce | gdzie zobaczyć | kod |
|---|---|---|
| powód przydziału "POA 10%, POD 42% (szlak, noc), ..." | `/app`, panel zespołu, Szczegóły (zawrat, Na żywo 19:45, śmigłowiec -> S7) | `search_planner.rs:820-829`, Swift `SearchPlanner.swift:418`, wyświetla `app/app.js:248` |
| kolumna "POA" w tabeli segmentów, "top 3 = 46% w 7% obszaru" | `/web/?sc=zawrat&standalone=1` | `web/index.html:73`, `web/app.js:987, 994` |
| "szansa znalezienia" = POA x POD przy przydziale, "szansa znalezienia dotąd", "szansa znalezienia w 2 h" | `/web/?sc=zawrat&standalone=1`, panele Przydział / Przebieg akcji / Wartość | `web/app.js:1009, 1045, 1050, 1067` |
| dymek komórki "N% POA komórki" | mapa 2D, także osadzona w `/app` | `web/app.js:1322` |

Obie strony mogą mieć rację co do głównego ekranu: panele `/app`, Centrum, Odprawa i Czat pokazują ranking i "% obszaru", nie POA (`app/app.js:231` komentarz "no POA % on screen"). Wyjątkami są tekst powodu z silnika, 2D standalone i dymek komórki.

### Część 1 w szczegółach (AI Andrzeja)

Odczyt kodu `origin/main` @ c5fa412 (silnik bez zmian od 2bd6542). Rust `rescue/rs/src/kit` = produkcja, Swift `rescue/Sources/RescueKit` = wzorzec.

**Kolejność obliczeń.** Każda wskazówka to jedna warstwa (mnożnik na komórkę), dodawana w kolejności czasu (`probability_grid.rs:239-243`). `poa(up_to, disabled, at)` mnoży pierwsze `up_to` warstw, pomija odznaczone w Sygnałach (`disabled`) i dzieli przez sumę po wszystkich komórkach prostokąta (`:443-460`; Swift `ProbabilityGrid.swift:225-238`). Wagi wskazówek liczone są w minucie `at`, domyślnie w minucie ostatniej warstwy kroku, więc zanik widać krok po kroku.

**Warstwy i ich mnożniki** (wszystkie w `probability_grid.rs:265-427`):

| warstwa | mnożnik komórki | linia (Rust / Swift) |
|---|---|---|
| Pierścienie Koestera | gęstość na m²: masa pasma / pole pierścienia, masy 25/25/25/20% między kwantylami (zawrat 1,1 / 3,0 / 5,8 / 11,5 km); poza r95 stała 0,05 / (3·π·r95²) | `:246-263` / `:110-117` |
| Ostatni znany punkt | iloraz (1 - w)·pierścienie(IPP) + w·pierścienie(LKP) przez poprzednią mieszankę: zastępuje pierścienie, nie mnoży ich drugi raz | `:271-286` |
| Teren (cechy) | 1 + 2,5·e^(-dSzlak/120) + 1,5·e^(-dPotok/120) + 1,0·e^(-dSchronisko/150); woda poza szlakiem x0,15; razem do ok. 6x | `:287-296` / `:139` |
| Koszt terenu | 0,35 przy grani (< 250 m) i z dala od szlaku (> 120 m), inaczej 1 | `:297` / `:144` |
| Trudność | szlak i hala 1, kosodrzewina 0,8, piarg 0,9, płyty 0,5, ściana 0,2, woda 1; x1,5 w żlebie (potok < 120 m i grań < 600 m) | `:411-417` |
| Plan trasy | 0,25 + e^(-d²/2σ²) | `:298-307` |
| Korytarz | podłoga + (1 - podłoga)·e^(-d²/2σ²) | `:360-369` |
| Zgubiony szlak | max po punktach: 1 + siła·e^(-d/300) x (w dół 1 / w górę 0,3) x (żleb 1,5), do 800 m, tylko poza szlakiem | `:330-359` |
| Pogoda (mgła, noc) | 1 + boost·e^(-min(dSzlak, dPotok)/150) | `:408-410` |
| Sektor BTS | 0,1 + e^(-d²/2(0,6r)²) | `:370-379` |
| Punkt GPS / AML | 0,002 + e^(-d²/2s²), s = max(dokładność, 0,6 komórki) | `:380-389` |
| ZNALEZIONO | 1e-9 + e^(-d²/2s²), s = max(dokładność, 0,5 komórki) | `:390-399` |
| Wykluczenie | stały mnożnik w promieniu od linii | `:405-407` |
| Przeszukano, nic | 1 - POD w komórkach podanych segmentów, 1 poza nimi | `:400-404` / `:204` |
| Warunki (pogoda dla zespołów) | 1 (bez wpływu na POA, tylko na POD planera) | `:418` |

**Bayes po pustym przeszukaniu.** Po normalizacji: POA_s' = POA_s·(1 - POD) / (1 - POA_s·POD), pozostałe segmenty: POA' = POA / (1 - POA_s·POD). To dokładnie P(i | nic nie znaleziono). Domyślny POD: SegmentSearched 0,7, DronePassEmpty 0,6 (`providers/segment_searched_provider.rs:23`, `drone_pass_empty_provider.rs:23`); zawrat ma w zdarzeniach 0,7 / 0,8 / 0,75 / 0,75.

**Wagi wskazówek (clue_weights).** Ważone są tylko: wskazówki `Clue` z sektorem, `Cell112Fix`, `RatunekPing` oraz negatywne `SegmentSearched` / `DronePassEmpty` (`clue_weights.rs:349-392`). Pierścienie, teren, plan trasy, korytarz i pogoda nie mają wagi.

- waga = wiarygodność źródła x dokładność typu x świeżość x potwierdzenie, obcięta do 0..1 (`:418-494`; Swift `ClueWeights.swift:175-207`).
- dokładność = clamp((100 m / dokładność typu)^0,35, 0,4, 1); świeżość = 0,5^(wiek_h / półokres) (podłoga 0) (`:418-431`).
- potwierdzenie: x1,25 za każdą zgodną wskazówkę (niezależne źródło, do 500 m albo 0,8 x większy promień, w oknie czasu = krótszy półokres), maks. x1,5; x0,7 za każdą silniejszą sprzeczną (za daleko na 3 km/h); x0,8, jeśli segment przeszukano później bez wyniku (`:446-488`).
- źródła (`scenarios/weights/clue-weights.json`): operator 1,0, GPS 0,95, ratownik 0,9, AML 0,9, BTS 0,8, pies terenowy 0,7, świadek 0,6, dron 0,5, pies 0,5, obywatel niezweryfikowany 0,3.
- kiedy działa: `applied = ręczna waga || na żywo || force_all` (`:490-493`), `force_all = applyToScripted || features: clueWeights` (`:305`); "na żywo" = opis zaczyna się od "Meldunek: " (`:341`). Warstwa wchodzi jako f^waga, gdy waga < 0,9995 (`probability_grid.rs:430-439`; Swift `:230-233`).
- Korekta do mojego INFO z 13:39: negatywne meldunki na żywo TEŻ są ważone (typ "przeszukanie", źródło ratownik 0,9 albo operator 1,0, półokres 6 h), więc działa efektywny POD = 1 - (1 - POD)^waga, tak jak opisano wyżej w części 1. Nieważone są tylko przeszukania ze skryptu (zawrat).

**Rust a Swift.** Te same wzory linia w linię (Rust to port; `rescue/rs/parity.py`: 103 ze 105 odpowiedzi bajt w bajt, dwie różnią się kolejnością kluczy). Rust dodaje tylko `poa_without_each` (`probability_grid.rs:469-517`: wspólne iloczyny prefiksowe dla "co wnosiła ta wskazówka", ta sama kolejność działań).

**Ogon Koestera.** 5% poza r95 ma gęstość liczoną dla umownego pola 3·π·r95², więc po normalizacji to nie jest dokładnie 5%. W zawrat bez znaczenia: prostokąt kończy się przed r95 (punkt H: w prostokącie jest 53% masy pierścieni).

### K. Wagi wskazówek: skrypt vs na żywo (mylące, za AI Andrzeja)

Zastrzeżenie AI Andrzeja: wskazówki ze scenariusza (skrypt, nagranie) wchodzą z pełną wagą 1, chyba że scenariusz ma `features: clueWeights` albo `applyToScripted: true`; wskazówki na żywo są ważone źródłem (operator 1,0, ratownik 0,9, GPS 0,95, BTS 0,8, świadek 0,6, pies 0,5, obywatel niezweryfikowany 0,3), dokładnością i świeżością. Kod: `clue_weights.rs:493` (`applied = override || live || force_all`), Swift `ClueWeights.swift`. Przykład z zawrat: sektor BTS ma wyliczoną wagę 0,083 (źródło 0,8 x dokładność 0,4 x świeżość 0,26), a w mapie działa z wagą 1 (`applied: false`, dopisek "waga informacyjna, mapa bez zmian"). Ten sam meldunek wpisany na żywo przesunąłby mapę dużo słabiej niż w nagraniu, więc Historia i Na żywo nie są porównywalne 1:1. Poprawka (silnik, AI Andrzeja): albo włączyć wagi dla skryptów w scenariuszach demo (`applyToScripted`), albo w UI przy wskazówce nagranej pokazywać "waga 1 (nagranie), na żywo byłoby 0,08".

### H. Normalizacja do prostokąta, bez "reszty świata" (mylące)

POA sumuje się do 100% wewnątrz prostokąta planowania. Policzyłem masę samych pierścieni Koestera (IPP 49,21363 N 20,04873 E, kwantyle 1,1/3/5,8/11,5 km) w siatce zawrat: **tylko 0,53 masy leży w prostokącie** (pasmo 0-1,1 km: 0,25 z 0,25; 1,1-3 km: 0,22 z 0,25; 3-5,8 km: 0,06 z 0,25; dalej 0). Kontrola pokrycia (`kit/coverage.rs:31-50`, Swift `Coverage.swift`) mierzy tylko dysk 50% (3 km) i raportuje `outsidePct: 10,3`, a pole `worstOutsidePct` = 0, bo pierścienie są oznaczone jako statystyka i nie podnoszą ostrzeżenia. Dla rankingu to bez znaczenia (inne wskazówki - plan trasy, BTS, korytarz - leżą w środku), ale każda liczba czytana jako "procent szansy" jest warunkowa: "jeśli osoba jest w tym prostokącie".

Poprawka (silnik, AI Andrzeja): w `value.coverage` dodać `ringMassInside` (Σ gęstości pierścieni x pole komórki, 3 linie w `story_pipeline.rs` obok `coverage`) i pokazać w Walidacji/Szczegółach "w obszarze planowania: 53% statystyki Koestera". Pełna wersja SAR: segment "reszta świata" (ROW), ale to zmiana kontraktu, nie na teraz.

---

## 2. POD

### Jak działa - trzy źródła POD

1. **Meldunek / skrypt (`SegmentSearched`, `DronePassEmpty`).** POD podany w zdarzeniu (zawrat 0,7 / 0,8 / 0,75 / 0,75; przyciski patrolu 0,8 "dobre" / 0,4 "słabe"; meldunek bez liczby 0,6: Swift `rescue-server/main.swift:105`). Stosowany jednolicie do całego segmentu (pkt 1).
2. **Planer (tryb kroków, przydziały).** POD komórki = min(0,95, tabela[typ zespołu][klasa terenu] x mnożnik pogody). Rust `kit/search_planner.rs:33-38` (tabele), `:213-240` (pogoda), `:475-477` (cap 0,95); Swift `SearchPlanner.swift:226-227`. POD przydziału = średnia POD ważona POA po komórkach "rdzenia" (komórki z 70% wagi segmentu, maks. 15): `search_planner.rs:382-395, 668`; Swift `SearchPlanner.swift:166`. Szerokość pasa w planerze wpływa tylko na czas przeszukania (`:465-473`), nie na POD. Wiele przejść: `cumPod = 1 - (1 - cumPod)(1 - POD)` - poprawnie (`search_planner.rs:118-119`, Swift `SearchPlanner.swift:282`).
3. **Oś czasu (Historia, ślady GPS + pole widzenia).** Koopman: C_i = W_i x udział_i / pole_komórki na metr śladu, próbki co max(25 m, ...), POD_komórki = min(cap, 1 - exp(-Σ C)). Rust `kit/timeline/field_of_view.rs:182-244`, `kit/timeline/timeline.rs:156-238`; Swift `Timeline/FieldOfView.swift:107-139`, `Timeline/Timeline.swift:108-115`. W z `fov-params.json`: W_open = pmax x radiusM x √π (całka profilu Gaussa pmax·exp(-(d/r)²) w poprzek pasa - poprawne), las = W_open x forestRadius x forestPmax, noc x darkRadius, mgła dla "eye" x min(1, widzialność / 2·zasięg) (`tracks.rs:252-305`, `field_of_view.rs:56-65`). Kilka przejść i kilka jednostek: hazardy się sumują, więc 1 - exp(-ΣC) = 1 - Π(1 - POD_i) - poprawne. Cap 0,95 = minimum `podCap` jednostek, stosowany raz na końcu (`timeline.rs:226-238`).

**Spadek w czasie.** Nie ma zaniku samego POD w osi czasu. Jest zanik wagi negatywnego dowodu w clue_weights (półokres 6 h dla "przeszukanie", wzór wyżej), tylko dla meldunków na żywo / z ręczną wagą.

### Czy poprawne: wzory TAK; dowód z produkcji (klatka 19:45)

| sprawdzenie | wynik |
|---|---|
| `poaGrid` klatki = POA_kroku_bez_przeszukań x (1 - POD) / Σ | max różnica 8,3e-5 (zaokrąglenia) |
| `pos` = Σ POA_kroku x POD | 0,0964 vs API 0,097 (API liczy z niezaokrąglonym POD) |
| `segments[].poa` i `cumPod` (Σ w·POD / Σ w) | zgodne co do 3. miejsca (S4 0,154/0,153, S3 0,221, S6 0,046) |
| `GET ?t=19:45` = `timeline.frames[19:45]` z pełnego runu | identyczne (`poaGrid`, `segments`, `pos`) |
| cap | max POD w klatce 0,807 < 0,95 |

### C. Stożek psa bez kierunku wiatru (bug, AI Michała)

- Stan: commit 31c2cbc ("dog FOV without wind direction uses the calm-band circle") jest tylko na `origin/fix/dog-cone-no-wind`. `git merge-base --is-ancestor 31c2cbc origin/main` = NIE. Produkcja liczy dalej `in_cone = true` bez `windFromDeg` (`field_of_view.rs:80`, Swift `FieldOfView.swift:49`). Zawrat nie ma `windFromDeg` w żadnym zdarzeniu, wiatr 6 i 14 m/s, więc działa pasmo 151 m (2,4 x 63 m, `tracks.rs:299-305`, Swift `Tracks.swift:136-138`) jako pełny okrąg.
- Skutek dla pokrycia: jądro jest normalizowane (Σ udziałów = 1), więc całkowite pokrycie się NIE zawyża, tylko rozmazuje. Policzone dla psa w środku komórki: udział własnej komórki 0,69 (bug) vs 0,96 (z fixem) vs 0,93 (bez stożka); 31% pokrycia trafia do 8 sąsiadów zamiast 4%. Czyli POD wzdłuż trasy psa jest niższy, a do 150 m obok - zawyżony.
- **Fix jest niepełny:** `polygon()` (`field_of_view.rs:260-263`, Swift `FieldOfView.swift:153`) woła `in_cone(..., d = 0)`, które po fixie dalej zwraca true (0 <= 40 m), i ustawia promień na `bd.range_m` = 151 m. Obrys pola widzenia psa w 2D/3D nadal będzie okręgiem 151 m.
- Poprawka: scalić 31c2cbc i w `polygon()` przy braku `windFromDeg` brać `re = max(re, wind_cone[0].range_m)` (40 m) zamiast `bd.range_m` (Swift i Rust, 2 linie).

### D. Ćwiczenie: POD rdzenia przypisany całemu segmentowi (bug, AI Andrzeja)

Zespół w ćwiczeniu przeszukuje tylko rdzeń (sędzia: znalezienie z prawdopodobieństwem POD w prawdziwej komórce, 0 poza rdzeniem, `kit/exercise_probe.rs:70-81`), ale po zakończeniu do silnika idzie `{"provider": "SegmentSearched", "segments": [seg], "pod": j.pod}` (Rust `server/exercise.rs:361-362`, Swift `rescue-server/main.swift:1066`), gdzie `j.pod` = średni POD rdzenia. Silnik mnoży CAŁY segment przez (1 - POD). Przykład z zawrat 19:45 (przydział śmigłowca): POA segmentu S7 0,214, POA rdzenia 0,101 (15 komórek, limit), POD rdzenia 0,42 -> poprawny POD segmentu = 0,042 / 0,214 = **0,20**, a silnik dostałby **0,42**. Komórki, których nikt nie widział, tracą wagę.

Poprawka: w zdarzeniu wysyłać `pod = expectedFind / POA_segmentu` (= Σ_rdzeń POA·POD / Σ_segment POA). To samo dotyczy tekstu powodu przydziału (G). Jedna linia w `exercise.rs` i `main.swift`.

### I. Dwa modele POD (mylące, AI Michała + UI)

Ten sam zespół w tym samym segmencie ma inny POD w zależności od widoku: planer (tabela na przejście, np. śmigłowiec S7 w nocy 0,42) i oś czasu (pokrycie śladów; S7 o 20:00 `cumPod` 0,031). Planer nie używa szerokości pasa z `fov-params.json` do POD. To jest świadomy podział (planer = plan, oś czasu = co zrobiono), ale nigdzie w UI nie jest powiedziany. Dodatkowo panel "Postęp akcji" w kroku liczy "skuteczność" segmentu jako MAX z meldunków (`app/app.js:180-185`), a planer jako 1 - Π(1 - POD) - przy dwóch meldunkach 0,6 panel pokaże 60%, planer 84%.

Poprawka: `searchedUpTo` = `1 - (1 - out[s]) * (1 - h.pod)` (1 linia, UI); w Szczegółach jedno zdanie "POD planu = tabela dla typu zespołu i terenu; pokrycie w Historii = ślady GPS".

---

## 3. "% obszaru" (`areaPct`) i "top 3 to 7% obszaru"

### Jak działa

`areaPct` = liczba komórek segmentu / liczba komórek prostokąta x 100 (Rust `run_json.rs:117`, `probability_grid.rs:533`; Swift `RunJSON.swift`, `ProbabilityGrid.swift:253`). "Top 3 to X% obszaru" = suma `areaPct` trzech pierwszych segmentów w kolejności POA: `/api/incidents` (`server/incidents.rs:53-76`) -> Centrum (`app/centrum.js:190`), panel (`app/app.js:229-233`, `Math.round`), Odprawa (`app/odprawa.js:78-79`), Porównanie (`app/porownanie.js:93`), `value.top3area` (`story_pipeline.rs:189`, Swift `StoryPipeline.swift:103`). "Obszar" = cały prostokąt planowania (po automatycznym poszerzeniu, zawrat: 6,0 x 7,2 km = 43,2 km²), nie obszar wyznaczony przez ratowników.

### Czy poprawne: TAK

- Metry, nie stopnie: siatka jest budowana w metrach (`kx = 111320·cos(φ_śr)`), komórki 100,2 x 100,0 m. Różnica między udziałem liczby komórek a udziałem ważonym cos(szerokości) (prawdziwe pole): max **0,0036 pp**. Pomijalne.
- `areaPct` w API = liczba komórek z `segOf` / 4320 (różnica <= 0,003 pp, zaokrąglenie do 4 cyfr). Σ `areaPct` = 100,002.
- Zawrat na żywo (krok 19:45): S7 1,389 + S4 2,523 + S3 3,125 = **7,04%** = 304 ha. `/api/incidents?fast=1` daje ten sam top 3 i te same `areaPct` (S7 0,214 / S4 0,1417 / S3 0,1046). Centrum i Odprawa pokażą "7,0%", panel "7%".
- Obrysy segmentów na mapie to otoczka wypukła narożników komórek (`run_json.rs:20-70`); suma ich pól = 1,082 x prostokąt, więc sąsiednie obrysy nachodzą na siebie o ok. 8%. `areaPct` nie jest liczone z obrysów, więc liczby są dobre; to tylko rysunek.

Uwaga (mylące, niska): procent zależy od wielkości prostokąta, który silnik sam poszerza. Propozycja (UI): obok procentu pokazać hektary (`areaPct x rows x cols x cellM² / 1e6 / 100` km²), np. "top 3 to 7% obszaru (3 km²)".

---

## 4. "Przeszukany obszar", pokrycie i dwa rankingi o 19:45

### A. Dlaczego Historia 19:45 pokazuje S4/S3/S6, a reszta S7/S4/S3 (bug)

| 19:45 | #1 | #2 | #3 | #4 | #5 |
|---|---|---|---|---|---|
| krok (Na żywo, Centrum, Odprawa, Porównanie, `/api/incidents`) | S7 0,214 | S4 0,142 | S3 0,105 | S10 0,104 | S6 0,089 |
| klatka osi czasu (Historia: panel "z pokryciem", 3D, 2D) | S4 0,227 | S3 0,193 | S6 0,160 | S2 0,112 | S7 0,101 |

Mechanizm: plik `rescue/scenarios/tracks/zawrat.json` ma `"searchEvents": "replace"`. Wtedy POA klatki = POA kroku **bez wszystkich warstw `SegmentSearched` i `DronePassEmpty`** x (1 - POD ze śladów) (`timeline.rs:103-107, 241-250`; Swift `Timeline.swift:61, 121`). Kontrakt zakłada, że te meldunki opisują te same przeszukania co ślady. W zawrat tak nie jest:

| meldunek (krok) | POD meldunku | pokrycie ze śladów o 19:45 (`cumPod`) | jest jednostka w pliku śladów? |
|---|---|---|---|
| 18:40 Zespół B Roztoką: S1, S2 | 0,7 | S1 0, S2 0 | nie (topr-b idzie z Murowańca do S9) |
| 18:50 Obsługa schroniska: S3 | 0,8 | S3 0,221 | nie (0,221 to przejście patrolu A) |
| 19:20 Patrol TOPR, szlak niebieski: S6 | 0,75 | S6 0,046 | nie |
| 19:35 Dron: S4, S5 | 0,75 | S4 0,154, S5 0 | tak, ale dron w S4 tylko 19:29-19:34 |

Czyli `replace` wyrzuca negatywny dowód, którego nic nie zastępuje: segmenty "przeszukane, nic" (S3, S6, S2) wracają na górę, a S7 (miejsce odnalezienia) spada z #1 na #5. Żaden z dwóch rankingów nie jest "źle policzony" (oba sprawdzone numerycznie wyżej), ale Historia gubi informację, więc to bug modelu, nie zaokrąglenia. Dla demo: moment "wow" (S7 wchodzi na #1 po pustym przelocie drona) jest widoczny tylko w trybie kroków.

Poprawka (silnik, AI Andrzeja, mała): w `TimelineEngine::new` (`timeline.rs:103-107`) i Swift `Timeline.swift:61` pomijać tylko te warstwy przeszukań, których segment ma odcinek `legs[kind = search | flight]` jakiejś jednostki z pliku śladów w czasie <= meldunku (albo których zespół z meldunku jest aktorem w śladach); pozostałe zostawić jak przy `keep`. Alternatywa danych (AI Marcina): dopisać w `tracks/zawrat.json` aktorów dla Zespołu B (S1/S2), obsługi schroniska (S3) i patrolu S6. Do czasu poprawki: w panelu przy "(z pokryciem)" dopisek "meldunki bez śladu GPS nie są liczone".

### E. Trzy definicje "przeszukanego obszaru" (mylące)

| gdzie | definicja | zawrat 19:45 |
|---|---|---|
| panel "Postęp akcji: Przeszukano N z M sektorów · X% obszaru" (`app/app.js:260-269`), 3D "obszaru przeszukane" (`app/3d/app3d.js:2229, 2290`), 2D standalone "przeszukany obszar" (`web/app.js:1018-1031`) | Σ `areaPct` CAŁYCH segmentów z jakimkolwiek meldunkiem "nic", bez względu na POD i rdzeń | **24,8%** (6 segmentów) |
| legenda 2D "przeszukano N% obszaru" (`web/app.js:875-876`), `timeline.coverageFinal.areaPct` (`timeline.rs:436-448`, Swift `Timeline.swift:208`) | komórki z POD >= 0,1 z osi czasu | **1,5%** (65 komórek); 3,9% na końcu |
| ćwiczenie `areaSearchedPct` (`server/exercise.rs:401`) | komórki rdzeni ukończonych przeszukań / wszystkie | - |

W Historii ten sam ekran pokazuje jednocześnie "24,8%" w panelu i "1,5%" w legendzie 2D. Poprawka (UI): w panelu nazwać to "sektory z meldunkiem: N z M (X% obszaru)", a "przeszukano X%" zostawić wyłącznie dla komórek z POD >= 0,1; w Historii panel może brać to z klatki (`cov`), tak jak legenda.

### F. Spójność trybu Historia między widokami (mylące)

W Historii top 3 panelu i etykiety #1-#3 w 2D/3D pochodzą z klatki (`app/app.js:1380-1392`, `tlSegments`), a `areaPct` dobierane z kroku (klatka go nie ma). Odprawa (`app/odprawa.js:78`) pokazuje "nagranie (Historia)", ale bierze ranking z kroku, Porównanie i Centrum też z kroków. Poprawka (UI): Odprawa w Historii bierze `segments` z klatki minuty (jak `tlSegments`) albo podpisuje "ranking bez pokrycia śladów".

---

## 5. Spójność tych samych liczb: API i UI

| liczba | źródło | widoki | zgodne? |
|---|---|---|---|
| ranking + `areaPct` (Na żywo) | ostatni krok `/api/run/<sc>` | panel, Centrum (`/api/incidents`), Odprawa, Czat, 2D, 3D | TAK (zawrat: S7/S4/S3, 7,04%, te same wagi w `/api/incidents`) |
| ranking (Historia) | klatka `timeline.frames` = `?t=` | panel, 2D, 3D | TAK między sobą; NIE z Odprawą (F) i z trybem kroków (A) |
| `pos` "szansa znalezienia" | klatka: Σ POA x POD (0,097 o 19:45) vs 2D standalone (0,42 o 19:20, 0,746 o 19:35) | 2D standalone | NIE (B) |
| POD przydziału | planer | panel zespołu "Skuteczność", Odprawa "POD ok. N%" | TAK (te same pola `assignments[].pod`) |
| `areaPct` w ćwiczeniu | `exercise_probe.rs:46` (r3) vs run (r4g) | Ćwiczenia | TAK co do zaokrąglenia |

### B. "Szansa znalezienia dotąd" w 2D (bug, UI)

`progressOf` (`web/app.js:1018-1031`) liczy `pos += POA_poprzedniego_kroku(segment) x POD` i sumuje. POA poprzedniego kroku jest już renormalizowane po wcześniejszych pustych przeszukaniach (warunkowe "jeśli jeszcze nie znaleziono"), więc suma przyrostów zawyża. Zawrat:

| meldunek | przyrost | 2D (suma) | poprawnie 1 - Π(1 - przyrost) |
|---|---|---|---|
| 18:40 S1+S2 | 0,076 | 7,6% | 7,6% |
| 18:50 S3 | 0,194 | 26,9% | 25,5% |
| 19:20 S6 | 0,152 | 42,2% | 36,8% |
| 19:35 S4+S5 | 0,324 | **74,6%** | **57,3%** |

Kontrola: Σ_i POA_przed(i) x cumPOD(segment i) = 0,5728. Ten sam błąd ma wynik ćwiczenia `coverage += j.poa x j.pod` (`server/exercise.rs:352`), ale tam to tylko punktacja (pełna przy 0,5).

Poprawka (UI, 1 linia): `const inc = Σ prev(id) x pod; pos = 1 - (1 - pos) * (1 - inc);` (to samo w `exercise.rs:352`, silnik). Widoczne tylko w 2D `?standalone` (w aplikacji panele 2D są ukryte, `web/style.css:293`), więc pilność średnia.

### G. Gdzie POA nadal jest "procentem" albo "szansą" (mylące)

Zasada z `ui-design.md` / `najmocniejsze-funkcje.md`: nie pokazujemy POA jako %, bo segment "45%" zawierał osobę w ok. 19% przypadków. Wciąż widać:

- tekst powodu przydziału z silnika "POA 10%, POD 42% (szlak, noc), ..." (`search_planner.rs:820-829`, Swift `SearchPlanner.swift:418`), wyświetlany w panelu zespołu w Szczegółach (`app/app.js:248`). Dodatkowo "POA 10%" to POA rdzenia, a ranking obok mówi, że S7 jest #1 (POA segmentu 0,214) - wygląda jak sprzeczność. Poprawka (silnik): "rdzeń: 47% wagi sektora, POD 42% (szlak, noc), ...", albo usunąć POA z tekstu;
- 2D standalone: kolumna "POA" w tabeli (`web/index.html:73`, `web/app.js:987`), "top 3 = 46% w 7% obszaru" (`web/app.js:994`), "szansa znalezienia" = POA x POD przy przydziale (`web/app.js:1009`), "szansa znalezienia w 2 h" (`:1067`);
- dymek komórki na mapie 2D "N% POA komórki" (`web/app.js:1322`), widoczny także w osadzonym 2D.

Poprawka (UI): "waga" zamiast "POA"/"szansa", liczba jako krotność średniej (jak legenda) albo bez liczby.

---

## J. Drobne (niska waga)

- `pos` i `cumPod` klatki po kroku ZNALEZIONO: baza POA staje się skupiona na miejscu odnalezienia, więc `pos` skacze 0,119 -> 0,370 (20:00 -> 20:05), a `coverageFinal.pos` = 0,37 to w praktyce POD w komórce odnalezienia. `cumPod` jest ważony bieżącą bazą, więc może maleć (S6: 0,046 -> 0,039 o 20:05). Poprawka (silnik): `coverageFinal.pos` i `cumPod` liczyć z bazą z kroku sprzed `found` (`timeline.rs:379-380`).
- Krawędź siatki: w `coverage_per_m` (`field_of_view.rs:192-237`, Swift `FieldOfView.swift:107-139`) okno jest przycinane do siatki, więc komórki poza prostokątem nie wchodzą do mianownika i pas przy krawędzi trafia w całości do komórek wewnątrz (do 2x przy samej krawędzi). Przeczy zasadzie z kontraktu R3 "zablokowany widok jest tracony, nie przesuwany". Poprawka (AI Michała): liczyć `sum` z wag dla nieprzyciętego okna (bez dodawania komórek do `cand`).
- Planer obniża korzyść ponownego przeszukania `rate x (1 - 0,15 x cumPod)` i x0,85 dla tego samego typu (`search_planner.rs:681-686`, Swift `SearchPlanner.swift:360`), choć POA segmentu już spadło przez Bayes. To podwójna kara, świadoma heurystyka ("planer obniża korzyść", słownik), ale warto o niej wiedzieć przy czytaniu `ratePerHour`.
- Skrajny przypadek: `poa()` dzieli przez Σ bez zabezpieczenia; POD = 1 na wszystkich segmentach dałby NaN. Raporty mają POD <= 0,8, więc w praktyce nie występuje.

---

## Metoda (do powtórzenia)

1. `curl` czterech adresów z nagłówka (tylko GET).
2. Dla każdego kroku `run.steps[k]`: Σ `poaGrid`, Σ `segments[].poa`, agregacja `poaGrid` po `segOf`, `areaPct` vs liczba komórek w `segOf` / (rows x cols).
3. Bayes: dla kroku z `hints[k].kind == "searched"` stosunek `poaGrid[k] / poaGrid[k-1]` w segmentach przeszukanych i poza nimi; oczekiwane (1 - POD) i 1 / (1 - POD x POA_przed).
4. Klatka 19:45: POD z `cov`, baza = `steps[10].poaGrid` (krok 18:30; późniejsze warstwy to przeszukania, wyłączone przez `replace`, i warunki z czynnikiem 1); porównanie z `poaGrid`, `pos`, `segments[].poa/cumPod`.
5. Pierścienie: gęstość wg `ring_density` całkowana po komórkach siatki zawrat.
6. Pies: jądro z `coverage_per_m` dla komórki 100 m bez stożka, z okręgiem 40 m i 151 m.
7. Kod: `git merge-base --is-ancestor 31c2cbc origin/main`, odczyt Rust i Swift (linie jak wyżej).

---

## Część 4: niezależne przeliczenie (AI Andrzeja)

Autor: Claude (AI Andrzeja), 2026-10-04. Cel: sprawdzić liczby z części 1-3 i punktów A..K bez czytania kodu silnika, wyłącznie z odpowiedzi API produkcji (i liczb POD ze scenariusza `rescue/scenarios/zawrat.json`, które są identyczne z `segmentHistory` w API).

### Metoda

```sh
curl -4 -s 'https://rescue-locator.vercel.app/api/run/zawrat?live=0' > run.json
curl -4 -s 'https://rescue-locator.vercel.app/api/run/zawrat?live=0&t=19:45' > t1945.json
python3 rescue/eval/audit_percentages.py run.json t1945.json
```

Skrypt (`rescue/eval/audit_percentages.py`, tylko biblioteka standardowa) liczy: Σ POA w każdym z 17 kroków, agregację `poaGrid` po `segOf`, `areaPct` z liczby komórek, przewidywanie Bayesa dla każdego kroku "searched" z kroku poprzedniego (w S: POA x (1 - POD) / (1 - POD x Σ_S POA), poza S: POA / (1 - POD x Σ_S POA); S i POD z przyrostu `segmentHistory`), "szansę znalezienia dotąd" jako sumę i jako 1 - Π(1 - POA_przed x POD), klatkę 19:45 od zera (baza x (1 - POD komórki z `cov`), normalizacja), "przeszukany obszar" w obu definicjach, POD segmentu z przydziałów (`expectedFind` / POA segmentu) i masę pierścieni Koestera w prostokącie (siatka 600 x 600). `?live=0&t=19:45` i `?t=19:45` zwracają bajt w bajt to samo, i to samo co `timeline.frames[19:45]` z pełnego runu.

### Liczby: API vs przeliczenie

| co | API | przeliczone | delta |
|---|---|---|---|
| Σ `segments[].poa`, 17 kroków | 0,99989-1,00012 | 1 | <= 1,2e-4 |
| Σ POA komórek segmentu vs `segments[].poa` | - | - | max 5,4e-5 |
| Σ `areaPct` | 100,002 | 100,000 | max 0,0028 pp na segment |
| Bayes 18:40 S1+S2, POD 0,7 (Σ_S 0,1083, mianownik 0,9242) | S2 0,1008 -> 0,0327 | 0,0327 | max 9,5e-5 (wszystkie segmenty) |
| Bayes 18:50 S3, POD 0,8 (Σ_S 0,2419, mianownik 0,8065) | S3 0,2419 -> 0,0600 | 0,0600 | max 8,1e-5 |
| Bayes 19:20 S6, POD 0,75 (Σ_S 0,2029, mianownik 0,8478) | S6 0,2029 -> 0,0598 | 0,0598 | max 1,0e-5 |
| Bayes 19:35 S4+S5, POD 0,75 (Σ_S 0,4319, mianownik 0,6761) | S4 0,3831 -> 0,1417 | 0,1417 | max 1,1e-4 |
| top 3 krok 19:45 | S7 0,2140 / S4 0,1417 / S3 0,1046 | to samo | 0 |
| top 3 krok 19:45: Σ `areaPct` / Σ POA | `top3area` 7,04% / `top3poa` 0,4603 | 7,04% / 0,4603 | 0 |
| top 3 klatka 19:45 (Historia) | S4 0,2268 / S3 0,1928 / S6 0,1598 (S7 #5 0,1006) | baza = krok 18:30: S4 0,2270 / S3 0,1928 / S6 0,1597 (S7 0,1006) | max 0,0002 |
| `pos` klatki 19:45 = Σ baza x POD | 0,097 | 0,0964 | 0,06 pp |
| szansa znalezienia dotąd po 19:35, suma przyrostów | - | 74,5% (7,6 / 26,9 / 42,2 / 74,5) | - |
| ta sama, 1 - Π(1 - POA_przed x POD) | - | 57,3% (7,6 / 25,5 / 36,8 / 57,3) | 17,2 pp do sumy |
| kontrola: Σ_i POA_18:30(i) x cumPOD(i) | - | 57,27% | 0,03 pp do 1 - Π |
| "przeszukany obszar" 19:45: Σ `areaPct` segmentów z meldunkiem / komórki POD >= 0,1 | - | 24,8% (6 segm.) / 1,50% (65 komórek) | 23,3 pp |
| POD segmentu z przydziału 19:45 (heli -> S7) | `pod` 0,42 (rdzeń) | 0,042 / 0,2140 = 0,196 | 0,22 |
| masa pierścieni Koestera w prostokącie | - | 0,531 | - |

Wariant pomocniczy (do punktu A): baza = krok 19:45 (z meldunkami, czyli `keep`) x (1 - POD ze śladów) daje S7 0,2255 / S4 0,1272 / S10 0,1032, `pos` ze śladów 0,056.

**Rozbieżności API vs przeliczenie powyżej 0,5 pp: brak.** Największa to `pos` klatki (0,06 pp, zaokrąglenie). Różnice powyżej 0,5 pp są tylko między definicjami (suma vs 1 - Π, dwie definicje "przeszukanego obszaru", POD rdzenia vs segmentu), czyli dokładnie tam, gdzie audyt zgłasza błędy. Jedyna różnica z liczbami audytu: suma w B wychodzi 74,5%, audyt pisze 74,6% (0,1 pp, zaokrąglenie przyrostów).

### Wnioski wobec punktów A..K

| # | wynik | dowód z przeliczenia |
|---|---|---|
| A | **potwierdza** | krok 19:45 = S7/S4/S3, klatka = S4/S3/S6 (S7 #5). Klatkę odtwarzam z dokładnością 0,0002 tylko przy bazie z kroku 18:30, czyli bez WSZYSTKICH czterech meldunków "nic". Wariant `keep` przywraca S7 na #1, ale liczy S4 podwójnie (meldunek drona 0,75 i ślad drona 0,154), więc poprawka wybiórcza z audytu jest właściwa |
| B | **potwierdza** | 74,5% (suma) vs 57,3% (1 - Π), a 1 - Π zgadza się z niezależną kontrolą Σ POA_prior x cumPOD = 57,27% |
| C | potwierdza stan gałęzi | nie do sprawdzenia z API; commit 31c2cbc jest tylko na `origin/fix/dog-cone-no-wind`, nie w `main`. Obrysu FOV nie sprawdzałem |
| D | **potwierdza** | S7: POD rdzenia 0,42, POD segmentu 0,196; także pies S4 0,428 vs 0,282, TOPR B S9 0,338 vs 0,188. Silnik dostałby 1,5-2,1 x za wysoki POD |
| E | **potwierdza** | 24,8% vs 1,50% o 19:45; `coverageFinal.areaPct` 3,9% na końcu |
| F | nie dotyczy liczb | to kwestia, który widok bierze który ranking (UI); oba rankingi, na których stoi F, potwierdzone wyżej |
| G | **potwierdza** | powód "POA 10%" = `assignments[].poa` 0,101 (rdzeń), a POA segmentu S7 = 0,214 |
| H | **potwierdza** | masa pierścieni w prostokącie 0,531 (audyt: 0,53) |
| I | **potwierdza** (dwa modele POD) | S4: meldunek drona POD 0,75, pokrycie ze śladów 0,154 (19:45) i 0,229 (20:00); S7: plan śmigłowca POD 0,42, ślady 0,031 o 20:00. Część "max vs 1 - Π" nie do sprawdzenia na zawrat (żaden segment nie ma dwóch meldunków) |
| J | **potwierdza** | `pos` 0,119 -> 0,37 (20:00 -> 20:05); `cumPod` S6 0,046 -> 0,039 |
| K | **potwierdza** | wszystkie 5 `clueWeights` mają `applied: false`; Bayes daje dokładnie 1 - POD (0,3 / 0,2 / 0,25 / 0,25), czyli mapa używa wagi 1. Z wagą 0,767 meldunek 18:40 miałby efektywny POD 1 - 0,3^0,767 = 0,60 zamiast 0,70 |

Rdzeń silnika (Σ POA = 1, agregacja, `areaPct`, Bayes, klatka osi czasu) liczy dokładnie to, co deklaruje. Wszystkie zgłoszone błędy (A, B, D) i niejasności (E, G, H, I, J, K) dają się odtworzyć z samego API.
