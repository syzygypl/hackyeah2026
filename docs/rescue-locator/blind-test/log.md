# Test na ślepo ("gra w chowanego") - dziennik

Dziennik na żywo, pisany dla ludzi. Czas: Kraków (CEST), sobota 3 października 2026. Źródło: wątek "HackYeah 2026 - temat 2" w kanale Technologia. Marketingowa wersja tej historii: [`story.md`](story.md).

Zasada dla autorów silnika: nikt z szukających (ludzie ani AI) nie zagląda do `rescue/blindtest/` przed odsłonięciem. Ten dziennik powstaje wyłącznie z wiadomości w wątku.

## Dlaczego to robimy

- **14:33** - AI Denisa publikuje backtest: miejsce odnalezienia w top 3 po fuzji we wszystkich scenariuszach, średnio poniżej 1% obszaru do przeszukania zamiast około 18% z samymi pierścieniami Koestera.
- **14:35** - AI Marcina, na prośbę Marcina, podważa te liczby. Dwa zarzuty:
  1. Wszystkie trzy scenariusze kończą się pingiem GPS z aplikacji Ratunek (Zawrat 20:05, Kasprowy 16:45, Morskie Oko też). Dramatyczne zakończenie robi GPS, a nie nasz silnik.
  2. Scenariusze pisali autorzy, którzy znali odpowiedź. Miejsca odnalezienia i punkty segmentów leżą tam, gdzie silnik i tak by patrzył. To nie dowodzi, że aplikacja działa.
  Propozycja: test na ślepo, czyli gra w chowanego.
- **14:36** - AI Mateusza przyjmuje krytykę w całości. Doprecyzowanie: liczby z backtestu mierzyły stan przed pingiem (Zawrat 19:35), ale stronniczość autorów jest prawdziwa. Od tej chwili wszystkie liczby w pitchu i slajdach są oznaczone "tymczasowe - do czasu testu na ślepo", a do pitchu idzie wynik serii, także porażki.
- **14:37** - w repo: liczby oznaczone jako tymczasowe, demo kończy się meldunkiem patrolu "ZNALEZIONO", ping Ratunek zostaje tylko jako opcjonalny epilog (commit fc34299).
- **Później** - AI Denisa powtarza backtest na prawdziwym terenie OSM + DEM dla wszystkich trzech scenariuszy (24a7370, 988ecf4): top 3 w 3/3, średnio 1,73% obszaru wobec 15,2% z samymi pierścieniami. Morskie Oko kończy się teraz śladem od psa i patrolu, nie pingiem (6d71893). Liczby nadal tymczasowe do wyniku testu na ślepo.
- **Jeszcze później** - backtest rozszerzony do 9 fikcyjnych scenariuszy w 5 rejonach (Tatry, Bieszczady, Karkonosze, Śniardwy, Morzycko, Międzyzdroje): top 3 w 8/9, średnio 2,18% obszaru wobec 20,0%. Uczciwe porażki: Karkonosze (poza top 3, 2,86% wobec 1,8%) i Kasprowy (4,94% wobec 4,2%).

## Zasady

Pełne zasady AI Marcina z 14:35.

| Rola | Kto | Co robi |
|---|---|---|
| Chowający | AI Marcina | Wybiera tajne miejsce i historię zachowania (np. zejście ze szlaku we mgle, upadek, zabłądzenie). Miejsca nie są losowane z pierścieni Koestera: generator nie używa żadnych parametrów silnika. Wybiera je jak prawdziwe błędy turystów, czasem "złośliwie", poza strefą 50%. |
| Sędzia | AI Marcina (ta sama rola co chowający) | Odpowiada na każdy patrol tak, jak odpowiedziałby teren: "nic" albo "ślad / znaleziony", z prawdopodobieństwem wykrycia (POD) dla prawdziwego segmentu. Odpowiedzi wracają jako live-events, więc po każdym "nic" silnik przelicza plan. |
| Szukający | silnik + AI Mateusza + AI Denisa (w blind-01 także AI Michała) | Uruchamiają aplikację na samych wskazówkach i wysyłają patrole do segmentów. Autorzy silnika nie zaglądają do generatora ani do prawdy przed odsłonięciem. |

**Wskazówki: tylko realistyczne i zaszumione**, takie, które naprawdę by istniały:
- plan wycieczki od rodziny, który różni się od faktycznej trasy,
- auto na parkingu przy szlaku,
- ostatni sektor BTS z błędem,
- świadek w schronisku z godziną,
- telefon gaśnie o godzinie T,
- pogoda.

Bez pingu GPS.

**Zobowiązanie:** w repo ląduje scenariusz bez prawdy oraz SHA-256(miejsce + sól). Prawda zostaje poza repo.

**Odsłonięcie:** prawda i sól (każdy sam sprawdza hash) oraz metryki:
1. ranga prawdziwego segmentu przed pierwszym patrolem,
2. procent obszaru przeszukany do znalezienia,
3. czas do znalezienia w porównaniu z naiwnym przeszukiwaniem,
4. odległość od szczytu mapy prawdopodobieństwa.

**Seria:** 3-5 ukrytych miejsc. Porażki raportujemy uczciwie. Ta liczba idzie do pitchu.

## Przebieg

- **Runda 1 na main:** b628d8a (ukryty scenariusz, zobowiązanie, sędzia, odsłonięcie) i 291a655 (prawdziwy teren OSM + DEM, ten sam obszar co zawrat). Agent szukający uruchamia silnik.

## Runda blind-01

*Uzupełniane na żywo z wątku.*

- **Start:** 14:40, sędzia AI Marcina.
- **Zobowiązanie (SHA-256):** `fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474`, liczone z `{"round","at","salt"}`. Opublikowane 14:40.
- **Commity:** b628d8a, 291a655 (teren OSM + DEM, obszar jak zawrat). Mapa podkładowa offline: jeden plik tatry.pmtiles dla wszystkich scenariuszy tatrzańskich (5,4 MB, 562 kafelki, AI Michała, ce56137).
- **Sprawa:** Ewa K. (osoba fikcyjna), 34 lata, sama, dobra kondycja. Zgłoszenie od partnera o 18:15. Planowana pętla Palenica - Roztoka (...). Bez GPS.
- **Szukający:** AI Mateusza, AI Denisa, AI Michała.
- **Format patrolu:** `[AI ...] ASSIGN-PATROL: <zespół> -> <segmenty>, start HH:MM, POD 0.x`. Zespoły i ich gotowość wynikają z zasobów w scenariuszu.
- **Odpowiedź sędziego:** "nic" albo ZNALEZIONO.
- **Koniec rundy:** przy ZNALEZIONO albo po 6 h czasu scenariusza (01:00). Potem sól i `reveal.py`: sprawdzenie hasha i metryki.
- **Uwaga sędziego o uczciwości:** miejsce wybrane jako realistyczny błąd turysty, nie z pierścieni Koestera.

### Wskazówki

Z odsłoniętego przebiegu (`rescue/blindtest/blind-01-result.md`). Kolumny "segment" i "obszar" pokazują, jak każda wskazówka zmieniała rangę prawdziwego segmentu S12 i procent obszaru do przeszukania przed trafieniem w prawdziwą komórkę.

| Czas zgłoszenia | Wskazówka | Typ | Ranga S12 | Obszar do trafienia |
|---|---|---|---|---|
| 18:15 | Teren: szlaki, potoki, schroniska | teren | #11 | 9,58% |
| 18:15 | Trudność terenu | teren | #12 | 16,36% |
| 18:15 | Warunki: mgła 40 m, wiatr 9 m/s | pogoda | #12 | 16,36% |
| 18:15 | Koester: turysta pieszy, góry (od schroniska) | statystyka | #11 | 18,69% |
| 18:20 | Plan od partnera: pętla przez ... | plan | #7 | 9,50% |
| 18:30 | Auto nadal na parkingu Palenica | auto | #6 | 9,25% |
| 18:45 | Świadek: para turystów widzi ją o 13:40 (S5) | świadek | #7 | 9,92% |
| 18:55 | CPR 112: ostatni sektor BTS (14:48) | BTS | #5 | 4,75% |
| 19:00 | IMGW: mgła, mżawka, zmrok | pogoda | #5 | 4,08% |

Telefon wyłączony od 15:05 (z historii chowającego). Najbardziej pomógł sektor BTS: komórka z rangi 342 na 171, segment z #7 na #5.

### Co pokazała mapa

**19:00** (wszystkie wskazówki, prawdziwy teren OSM + DEM, 50 szlaków). Top 3 = 60% POA na 18% obszaru.

| # | Segment | POA | Obszar |
|---|---|---|---|
| 1 | S3 Schronisko i Przedni Staw | 27,2% | 3,8% |
| 2 | S2 Siklawa / Roztoka górna | 17,3% | 6,0% |
| 3 | S13 Morskie Oko | 16,0% | 8,4% |
| 4 | S4 Wielki Staw | 13,7% | 3,0% |
| 5 | S12 Szpiglasowa Przełęcz | 8,3% | 4,6% |
| 6 | S5 Czarny Staw Polski | 8,2% | ... |

### Patrole

**Fala 1** (wysłana w wątku ok. 14:47).

Uzasadnienie agenta-szukającego AI Mateusza: pierścienie Koestera mają szczyt przy schronisku, ale świadek i sektor telefonu wskazują trasę na przełęcz. Mgła powyżej 1800 m od 13:30, a przełęcz leży na ok. 2110 m, czyli tam, gdzie na piargu gubi się szlak.

**Uczciwie:** agent-szukający AI Mateusza odszedł od planera w 2 z 4 przydziałów. Decyzję podjęło AI, nie człowiek. Zapisujemy oba warianty, żeby odsłonięcie pokazało, czy to pomogło.

| # | Start | Zespół | Planer proponował | Wysłane | POD | Dlaczego | Odpowiedź sędziego |
|---|---|---|---|---|---|---|---|
| 1 | 19:00 | Patrol TOPR A | S2 | **S5, S12** (odejście od planera) | 0,45 | Świadek i BTS wskazują żółty szlak na przełęcz | nic (S5, S12) |
| 2 | 19:05 | Dron | S3 | S3 (jak planer) | 0,27 | Najwyższe POA | nic |
| 3 | 19:10 | Patrol TOPR B | S5 (z Murowańca, 115 min) | **S13, S12** (odejście od planera) | 0,45 | Zamyka przełęcz od południa; S5 z Murowańca za daleko | nic (S13, S12) |
| 4 | 19:15 | Pies | S4 | S4 (jak planer) | 0,55 | Plan planera | nic |

**14:48, odpowiedź sędziego na falę 1:** wszędzie "nic" (S5, S12, S3, S13, S12, S4). Puste wróciły zarówno przydziały zgodne z planerem, jak i te, w których agent odszedł od planera. Po fali 1 nie da się więc powiedzieć, które podejście było lepsze.

**Niezależny przebieg AI Denisa** (dołącza jako szukający): własne uruchomienie silnika na 19:00 dało identyczne top 3 (S3 27% / 4%, S2 17% / 6%, S13 16% / 8%). Silnik jest deterministyczny między maszynami. AI Denisa proponuje S2 jako następny cel.

**Fala 2** (wysłana w wątku ok. 14:56). Fala 1 wpisana jako "nic". S12 dostał dwa przejścia, łączny POD ok. 0,70.

Mapa o **23:00** (S12 spadł z 8,3% do 3,7%):

| # | Segment | POA | Obszar |
|---|---|---|---|
| 1 | S3 Schronisko i Przedni Staw | 29,0% | 3,8% |
| 2 | S2 Siklawa / Roztoka górna | 25,3% | 6,0% |
| 3 | S13 Morskie Oko | 12,8% | 8,4% |
| 4 | S4 Wielki Staw | 9,0% | 3,0% |
| 5 | S5 Czarny Staw Polski | 6,6% | 3,2% |

| # | Start | Zespół | Planer proponował | Wysłane | POD | Dlaczego | Odpowiedź sędziego |
|---|---|---|---|---|---|---|---|
| 5 | 19:20 | Dron | S3 | S3 (jak planer) | 0,27 | Nadal najwyższe POA | nic |
| 6 | 20:25 | Pies | S2 | S2 (jak planer i AI Denisa) | 0,56 | Drugie POA, propozycja AI Denisa | nic |
| 7 | 21:30 | Patrol TOPR A | S13 (już pokryty przez B) | **S18 Dolina za Mnichem** (odejście od planera) | 0,40 | Zejście żlebem po zgubieniu szlaku we mgle | nic |
| 8 | 23:00 | Patrol TOPR B | S4 | S4, S6 (S6 = rozwidlenie na Zawrat) | 0,46 | Planer + domknięcie rozwidlenia | nic (S4, S6) |

Agent-szukający AI Mateusza odszedł od planera w 1 z 4 przydziałów fali 2 (TOPR A).

**14:53, odpowiedź sędziego na falę 2:** wszędzie "nic" (S3 dron, S2 pies, S18 TOPR A, S4 i S6 TOPR B). Po dwóch falach osiem przydziałów, zero śladów. Ewa K. jest w terenie już w nocy.

**14:52, błąd silnika wskazany przez AI Michała:** pierścienie Koestera startują od schroniska o 11:50, a nie od ostatniego znanego punktu (świadek o 13:40 w S5). Zasada samego Koestera: punkt startu planowania (IPP) = ostatni znany punkt (LKP). To pozycja 1 w backlogu poniżej.

**Decyzja AI Mateusza jako koordynatora:** silnik zostaje zamrożony do odsłonięcia. Szukający mogą stosować zasadę LKP ręcznie przy wyborze patroli, a każde odejście od planera jest zapisywane z powodem.

**Fala 3** (wysłana w wątku ok. 14:57 przez AI Mateusza, z agenta-szukającego).

Uzasadnienie agenta-szukającego: punkt startu = ostatni znany punkt (świadek 13:40, S5), zastosowany ręcznie zgodnie z zasadą zamrożonego silnika. Nocleg w pobliżu miejsca, gdzie gubi się szlak. S12 i S13 dominują w części okręgu BTS, która leży w siatce (spostrzeżenie AI Michała).

Rozważany i nie wysłany wariant: dron S5, pies S12 + górna część S13, TOPR A poza siatką, TOPR B S7. Sędzia orzekł, że zaginiona jest w obrębie mapy (nie poza siatką).

| # | Start | Zespół | Planer proponował | Wysłane | POD | Odpowiedź sędziego |
|---|---|---|---|---|---|---|
| 9 | 19:35 | Dron | S3 (trzeci raz) | **S12** (odejście od planera) | 0,35 | **ZNALEZIONO w S12** |
| 10 | 21:50 | Pies | S2 | **S5** (odejście od planera) | 0,55 | nic |
| 11 | 23:10 | Patrol TOPR A | S4 | S4 (jak planer) | 0,46 | nic |
| 12 | 00:55 | Patrol TOPR B | S5 | **S7** (odejście od planera) | 0,40 | nic |

**ok. 14:58, wynik rundy:** ZNALEZIONO w fali 3, przy 12. przydziale łącznie. Dron w S12, start 19:35.

**Podsumowanie (sformułowanie koordynatora):** blind-01: znaleziona w 3. fali (12 przydziałów). Zadecydował agent-szukający AI, który ręcznie zastosował zasadę Koestera IPP = ostatni pewny punkt (świadek 13:40), której zamrożony silnik jeszcze nie miał; planer sam wysłałby drona nad S3. Wniosek: poprawka #1 trafia do silnika i sprawdzamy ją w blind-02/03.

S12 miał wcześniej dwa przejścia we mgle (POD 0,45 każde), które jej nie znalazły: realistyczny POD poniżej 1. Decyzję podjęło AI, nie człowiek.

**Zegary zespołów:** czasy są liczone osobno dla każdego zespołu. Fala 3 drona ruszyła o 19:35, zaraz po jego przelocie z fali 2, więc kolejność jest spójna w obrębie zespołu. W odtworzeniu sortujemy po czasie i pokazujemy zespół.

**Odsłonięcie:** sól, `reveal.py`, metryki i pełna oś czasu (po odsłonięciu).

### Uwagi do silnika (backlog, wdrażane dopiero po odsłonięciu)

Znalezione w trakcie rundy. Nie poprawiamy silnika w trakcie gry, żeby nie dopasować go do ukrytego miejsca.

Po odsłonięciu (lista sędziego):

- **(1)** Pierścienie Koestera liczone od schroniska (11:50) zamiast od ostatniego znanego punktu (świadek 13:40, S5). Koester: IPP = LKP. Zgłosił AI Michała, 14:52.
- Planer nie wie, które zespoły są zajęte (proponuje segment, który już ktoś przeszukuje).
- Dron zapętla się na S3 po przelocie z niskim POD.
- Brak zachowania "zgubiony szlak we mgle -> zejście żlebem".
- Słabe zdarzenie "znaleziono": wskazówka z promieniem 50 m w miejscu odnalezienia daje komórce tylko rangę 83. Potrzebny osobny typ zdarzenia "Found", który zamyka akcję.
- Godziny po północy sortowane przed wieczornymi (00:55 przed 18:15).
- Obszar mapy dopasowany do wskazówek, a nie skopiowany z innego scenariusza.


### Odsłonięcie

**14:59, AI Marcina, commit ad2ced5.**

- **Miejsce:** 49.19597, 20.04655 (komórka r58 c30, segment S12).
- **Sól:** `3746db96b11d2df56179ef326b6c29b3`
- **Weryfikacja hasha:** zgodny. `python3 rescue/blindtest/reveal.py --round blind-01 --at 49.19597,20.04655 --salt 3746db96b11d2df56179ef326b6c29b3 --run rescue/out/blind-01-replay.run.json` -> `commitment OK fdd079df...b474`.
- **Historia chowającego:** zgubiła żółty szlak we mgle tuż za Szpiglasową Przełęczą, przy zejściu w stronę Morskiego Oka. Zeszła za daleko na południowy zachód, w piarg nad Stawami Staszica. Poślizg, uraz kostki. Siedzi pod blokiem skalnym ok. 280 m od szlaku. Żywa, nie może iść, telefon wyłączony od 15:05.
- **Wynik:** ZNALEZIONO o 19:35 w S12, dron termowizyjny, fala 3. W kolejności czasu było to 8. przeszukanie segmentu w akcji.

### Metryki

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, 19:35, S12, dron, fala 3 |
| Liczba patroli do znalezienia | 8. przeszukanie segmentu w kolejności czasu (12 przydziałów wysłanych w 3 falach) |
| Ranga prawdziwego segmentu przed pierwszym patrolem | #5 z 20 (8,3% POA); same teren + pierścienie: #11 |
| Procent obszaru przeszukany do znalezienia (19:00, w kolejności POA) | 4,1% (komórka 147 / 3600); same pierścienie: 18,7% |
| Naiwne przeszukiwanie od schroniska (IPP) | 32,3% obszaru, czyli silnik ok. 8x lepiej |
| Odległość od szczytu mapy | 1,95 km (szczyt przy schronisku, S3 27%: top 1 planera był błędny) |

### Co z tego wynika

**To jedna runda, nie liczba do pitchu** (sędzia). Liczba do pitchu to wynik serii 3-5 rund.

1. **Silnik dobrze zawęża, ale nie trafia w top.** Prawdziwa komórka w najlepszych ok. 4% obszaru, ok. 8x lepiej niż naiwnie od schroniska. Ale segment dopiero #5, a szczyt mapy 1,95 km obok.
2. **Główna słabość: stały punkt startu.** Pierścienie Koestera liczone od schroniska (11:50) przeważają nad późniejszymi wskazówkami (świadek 13:40, BTS 14:48). Zauważył to AI Michała (14:52), a agent-szukający AI Mateusza zastosował to ręcznie w fali 3, co dało znalezienie.
3. **Znalezienie przyszło z decyzji agenta-szukającego AI wbrew planerowi.** Planer w tym czasie dawał drona trzeci raz nad S3 i sam by jej nie znalazł.
4. **POD poniżej 1 jest realny.** S12 przeszły dwa patrole we mgle (POD 0,45 każdy) i jej nie zauważyły.
5. **Błąd projektu rundy (sędzia):** obszar mapy skopiowany z zawrat.json. Ukryte miejsce leżało w 2. rzędzie od południowej krawędzi, a część koła BTS wypadła poza mapę. Od blind-02 obszar jest dopasowany do wskazówek.

## Runda blind-02

Pierwsza runda na poprawionym silniku (aa18405, poprawki z blind-01). Odsłonięta (a0476e0).

- **Zobowiązanie (SHA-256):** `4af5d1ccfbe25f9c76429dda75a3c452a93606fd6f3657cbd17250c24d8e92f7`
- **Sprawa:** Stanisław M. (osoba fikcyjna), 79 lat, wczesna demencja, bez telefonu. Wyszedł z pensjonatu przy Drodze pod Reglami ok. 14:30. Córka zgłasza o 16:40.
- **Nowa zasada sędziego:** zapieczętowana tabela wykrywalności dla każdego zespołu (hash `16d6659a3639a43d0e7bb3456b8fb002ff412d38292a2eafff6ec3fa69fbbcd8`). Sędzia rozstrzyga według niej. POD, który deklarujemy, kształtuje tylko naszą mapę.
- **Szukający:** agent-szukający AI Mateusza, AI Denisa, AI Michała.

### Co pokazała mapa

**17:45:** D13 (Dolina ku Dziurze, gdzie znaleziono jego czapkę) 87% POA. Dron (AI Denisa) -> D13: nic.

### Patrole

| Fala | Zespół | Wysłane | Planer czy odejście | Odpowiedź sędziego |
|---|---|---|---|---|
| przed 1 | Dron (AI Denisa) | D13 | planer (87%) | nic |
| 1 (18:00) | Śmigłowiec | D12 | ... | nic |
| 1 | Pies | D13, od czapki | ... | nic |
| 1 | TOPR A | D13, dolina i jaskinia | ... | nic |
| 1 | TOPR B | D12, D17 | ... | nic |
| 2 | Pies | D8 (pensjonat) | **odejście od planera** | nic |
| 2 | TOPR A | D14 | planer | nic |
| 2 | TOPR B | D7 | planer | nic |
| 2 | Śmigłowiec | uziemiony po zmroku | - | - |
| 3 | Pies | D3 | planer | nic |
| 3 | TOPR A | **D18**, stromy las za Jaskinią Dziura | **odejście od planera** (planer powtarzał D14) | **ZNALEZIONO o 21:20** |
| 3 | TOPR B | D12, D11 (na zachód od świadka) | **odejście od planera** | nic |
| 3 | Dron (AI Denisa) | zbocza D13, termowizja nocą | ... | nic |

Uzasadnienie TOPR A w fali 3 (agent-szukający AI Mateusza): czapka leżała na początku szlaku, a osoba z demencją idzie prosto, aż utknie.

**15:34 (Kraków), wynik:** ZNALEZIONO przez TOPR A w D18 o 21:20, fala 3.

**Ujęcie koordynatora (AI Mateusza):** Dwie rundy na ślepo, obie znalezione w 3. fali, obie dzięki decyzji agenta-szukającego AI, który odszedł od planera, stosując wiedzę o zachowaniu zaginionych (LKP Koestera, demencja: prosto do utknięcia), której silnik jeszcze nie miał. Każdą lekcję wpisujemy do silnika i mierzymy w kolejnej rundzie. Wartość dziś: aplikacja + ocena ratownika, a nie sam planer.

**Drobny błąd szablonu sędziego:** tekst zdarzenia o znalezieniu brzmi "Poszkodowana odnaleziona", a zaginiony jest mężczyzną.

### Uwagi do silnika z blind-02 (backlog 11-16)

- Znaleziony ślad to nie to samo co obserwacja osoby.
- POD zależny od pokrycia terenu, pogody i światła dziennego.
- Okno dostępności śmigłowca.
- Hipotermia liczona z minimalnej temperatury nocą i wieku.
- Warstwa zachowania przy demencji.

### Odsłonięcie

**AI Marcina, a0476e0.** Źródło: `rescue/blindtest/blind-02-result.md`.

- **Miejsce:** 49.27003, 19.93961 (komórka r33 c25, segment D18).
- **Sól:** `015f869f614028292cef1826ca988a5a`
- **Zapieczętowana tabela wykrywalności:** naziemny 0,45, pies 0,6, dron 0,25, śmigłowiec 0,15.
- **Weryfikacja:** oba hashe zgodne (zobowiązanie i tabela). `python3 rescue/blindtest/reveal.py --round blind-02 --at 49.27003,19.93961 --salt 015f869f614028292cef1826ca988a5a --run rescue/out/blind-02-replay.run.json` -> `commitment OK 4af5d1cc...e92f7`.
- **Historia chowającego:** poszedł Drogą pod Reglami na zachód, dalej niż zwykle. Skręcił w niebieski szlak do Doliny ku Dziurze, zgubił czapkę przy wejściu. Zszedł ze szlaku w las w górę Potoku ku Dziurze, zaplątał się w młodnik nad potokiem i usiadł zmarznięty ok. 200 m od szlaku. Żywy, wychłodzony, bez telefonu.
- **Dlaczego taka tabela:** gęsty młodnik, zmierzch i deszcz, osoba skulona pod gałęziami. Termowizja z góry słabo widzi przez korony, pies na świeżym tropie dobrze, tyraliera wolno, ale skutecznie.
- **Wynik:** ZNALEZIONO o 21:20 w D18 przez patrol A, ok. 6,8 h po wyjściu z pensjonatu. W kolejności czasu było to 13. przeszukanie segmentu. D13 (obok) przeszukany 3 razy i poprawnie pusty.

### Metryki

Stan silnika o 17:45, wszystkie wskazówki, przed patrolami:

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, 21:20, D18, patrol A |
| Przeszukanie segmentu, które znalazło | 13. w kolejności czasu |
| Ranga prawdziwego segmentu D18 | #8 z 20 (same pierścienie: #10) |
| Procent obszaru do trafienia | 37,4% |
| Naiwnie od pensjonatu (IPP) | 35,7% |
| Odległość od szczytu mapy | ok. 1,0 km |
| Po zdarzeniu "Found" | komórka #3, szczyt 75 m od miejsca |

**"Tym razem sama mapa nie pomogła"** (sędzia): silnik wypadł nie lepiej niż naiwne szukanie od pensjonatu. Top 3 planera AI Denisa o 17:45: D13, D8, D12. D18 nie było w top 3. Nocny przelot drona AI Denisa nad D13 nie został oceniony.

**Rozbieżności nazw i numeracji:** w pliku sędziego zespoły to `gopr-a` i `gopr-b` (w wątku TOPR A i B), a fale są numerowane od przelotu drona o 17:45 jako fali 1, więc nasza "3. fala" to tam fala 4.

### Co z tego wynika

**N = 2, nie liczba do pitchu** (sędzia).

1. Seria po 2 rundach: 2/2 znalezione, oba razy przez decyzję agenta-szukającego AI wbrew planerowi. Silnik sam: runda 1 = 4,1% obszaru (8x lepiej niż naiwnie), runda 2 = 37% (jak naiwnie).
2. Słabość przy demencji: czapka i świadek ciągną szczyt na szlak i drogę, a nie w "prosto do utknięcia" (las i potok za ostatnim śladem). Kandydat do backlogu: rozkład kierunkowy od ostatniego śladu plus przyciąganie potoku i młodnika dla kategorii demencja.
3. Planer: POD drona w lesie o zmierzchu 0,72 (za wysoko), proponował śmigłowiec po zmroku (błąd).
4. Projekt rundy (sędzia): nazwy segmentów od najbliższego obiektu bywały mylące (D13). Od rundy 3 nazwy od środka ciężkości i lista obiektów.

## Runda blind-03

*Szablon jak w blind-01.*

## Rundy blind-04, blind-05 (opcjonalne)

*Jeśli starczy czasu.*

## Podsumowanie serii

Po 2 rundach. Wpis koordynatora do pitchu (tymczasowy do blind-03): "Test na ślepo: 2/2 rundy znalezione w 3. fali, obie dzięki decyzji agenta-szukającego AI wbrew planerowi - w rundzie 2 sama mapa nie pomogła. Każdą lekcję wpisujemy do silnika (14 poprawek)."

| Runda | Znaleziony | Patrole | Ranga przed 1. patrolem | Obszar do znalezienia | Czas vs naiwne | Odległość od szczytu |
|---|---|---|---|---|---|---|
| blind-01 | tak (19:35, dron, S12) | 8. przeszukanie segmentu | #5 z 20 | 4,1% (naiwnie 32,3%) | ok. 8x mniej obszaru niż naiwnie | 1,95 km |
| blind-02 | tak (21:20, patrol A, D18, fala 3) | 13. przeszukanie segmentu | #8 z 20 | 37,4% (naiwnie 35,7%) | bez poprawy wobec naiwnego | ok. 1,0 km |
| blind-03 | | | | | | |
