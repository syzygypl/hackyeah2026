# Rescue Locator - pitch 3 min (vFINAL, PL)

Do czytania na głos. Jeden mówca, drugi klika (ścieżka kliknięć: `video-shotlist.md`, pełny runbook: `docs/rescue-locator/demo-runbook.md`). Wszystkie scenariusze i osoby są fikcyjne, teren jest prawdziwy.

**Wow moment:** świadek mówi jedno zdanie, mapa się przesuwa (Czat albo `porownanie.html`).
**Jedna liczba:** 95 min -> 12 min. Tyle trwa dojście pierwszego zespołu do miejsca znalezienia bez relacji turystki i z nią (scenariusz fikcyjny, ten sam silnik; źródło `porownanie-data/zawrat-*.json`, `cf5a36c`).
**Dwie publiczności:** ratownicy (GOPR, TOPR, WOPR, straż, policja) i zwykli ludzie (rodziny, turyści, świadkowie).

| Czas | Ekran | Mówimy |
|---|---|---|
| 0:00-0:20 | Slajd 1, potem slajd 2 (Problem) | **Hak.** "Sobota, 17:40. Żona dzwoni, że mąż poszedł sam na Zawrat i nie wrócił. Mgła, zmrok. Kierownik akcji ma auto na parkingu, plan wycieczki i sektor z sieci komórkowej z dokładnością półtora kilometra. Łączy to w głowie, na papierowej mapie. W Polsce nie ma jeszcze AML przy 112." |
| 0:20-0:35 | Strona startowa, dwa wejścia | "Rescue Locator ma dwa wejścia. Dla ratowników: kierownik akcji, ratownik z telefonem i Centrum. Dla rodzin i turystów: co robić, gdy ktoś zaginął, i 'Widziałem kogoś'. Jedna mapa łączy oba światy." |
| 0:35-1:05 | `/app/?sc=zawrat&role=operator&mode=akcja&time=hist&step=15&view=2d`, potem 3D i z powrotem | "To kierownik akcji. Mapa na prawdziwym terenie, OpenStreetMap i model wysokości Copernicus. Każda wskazówka mnoży mapę przez swoją wiarygodność, a każdy pusty przeszukany sektor oddaje wagę innym. Wynik to kolejność: trzy sektory, około 7% obszaru, i każdy zespół ma swój sektor i czas dojścia." |
| 1:05-1:40 | Czat: wpisz relację turystki, **Dodaj** | **Wow.** "O 19:22 dzwoni turystka: 'minęłam starszego pana w czerwonej kurtce na zakosach niebieskiego szlaku pod Zawratem, o 14:35'. Operator wpisuje to zwykłym zdaniem. Czat pokazuje, co zrozumiał, i po 'Dodaj' mapa przelicza się w niecałą sekundę. Żleb pod Zawratem wskakuje na pierwsze miejsce." |
| 1:40-2:00 | `/app/porownanie.html` | **Liczba.** "Ta sama akcja, ten sam silnik, policzona bez tej relacji i z nią. Bez relacji pierwszy zespół, który dociera do miejsca znalezienia, to pies po 95 minutach. Z relacją to dron termowizyjny po 12 minutach. To nasz fikcyjny scenariusz, nie statystyka, ale pokazuje, ile znaczy jedno zdanie świadka." |
| 2:00-2:20 | Telefon ratownika, potem Centrum | "Ratownik dostaje sektor na telefon i melduje jednym przyciskiem albo zdaniem. Meldunek jest u kierownika po 1-2 sekundach. Centrum widzi wszystkie akcje w Polsce i wspólną pulę zespołów, a Doradca łączy kilka akcji w jedną przyczynę, np. falę po awarii zapory." |
| 2:20-2:35 | `/app/rodzina.html` (albo Odprawa A4) | "A rodzina? Strona 'Ktoś zaginął' mówi: najpierw 112, potem odpowiedz na pytania dyżurnego. Z odpowiedzi powstaje gotowy tekst do przeczytania przez telefon. Nic nie jest wysyłane. Kierownik akcji drukuje odprawę na jednej kartce A4." |
| 2:35-2:50 | Slajd 8 (przypis) | **Uczciwie.** "Dane są fikcyjne, procent przy sektorze to waga mapy, nie szansa. Silnik sprawdziliśmy na symulacji, nie na prawdziwych akcjach. Następny krok to backtest na zanonimizowanych akcjach GOPR i TOPR. Model językowy w pokazie jest w chmurze, a gdy nie odpowiada, meldunki czytają reguły." |
| 2:50-3:00 | Slajd 10 (linki) | "Zaczęliśmy ten hackathon od czegoś zupełnie innego, a po dwóch godzinach zapytaliśmy: gdzie nasz kod najbardziej pomoże? Rescue Locator. Gdzie szukać najpierw. Wszystko działa na rescue-locator.vercel.app." |

## Kryteria oceny -> moment pitchu (DEFENCE i Smart City, te same kryteria domyślne)

| Kryterium | Moment | Slajd |
|---|---|---|
| Idea & Innovation 30% | Fuzja wskazówek, pusty sektor też jest informacją, relacja zwykłym zdaniem przesuwa mapę (1:05-2:00) | 4, 5, 8 |
| Relation to Category 20% | DEFENCE: "information is incomplete, resources are limited" (0:00-0:20). Smart City: Kraków, Nowa Huta, mieszkańcy jako czujniki (wariant smartcity) | 2, 9 |
| Usability 20% | Telefon ratownika, Czat, rodzina.html, Odprawa A4 (2:00-2:35) | 3, 6, 7 |
| Design 20% | Mapa 2D/3D na prawdziwym terenie, Centrum, druk A4 (0:35-1:05) | 5, 6, 7 |
| Completeness 10% | Działa na produkcji, wiele urządzeń naraz, uczciwa lista tego, co zamockowane (2:35-3:00) | 10 |

## Źródła liczb (nie mówimy nic poza tym)

- 95 vs 12 min, top 3 S4/S7/S3 (7,0%) -> S7/S6/S9 (5,4%): `/app/porownanie.html`, `porownanie-data/zawrat-*.json` (`cf5a36c`, `8c838ab`), fact-check `393f1a6` (pies 94,9 min, dron 12,4 min).
- "7% obszaru": panel top 3 (fact-check: 7,04% Na żywo, 7,48% Historia).
- Mapa po "Dodaj" po ok. 0,9 s: `docs/rescue-locator/czat.md`, `545fe02`.
- Meldunek u operatora ok. 1-2 s: `demo-runbook.md`, `qa-demo-path.md` (`f351976`, serwer Rust).
- Produkcja na Ruście, `/api/incidents` 34,3 s -> 0,43 s (p50): `402802f`, `wydajnosc.md` Runda 2. Nie mówimy "22 ms" (pomiar lokalny).
- Nie mówimy: "offline", "66%" w głównym przekazie (tylko przypis na slajdzie 8 i odpowiedź na pytanie jury), "szansa znalezienia" o procencie sektora.

## Wersja Smart City (podmiana 0:00-0:35 i 2:20-2:35)

Hak: "Upał w Nowej Hucie. Starszy pan z demencją wychodzi z domu. Córka zgłasza zaginięcie po trzech godzinach." Ekran: `/app/?role=operator&mode=akcja&view=2d&sc=krakow-nowa-huta&time=live`, potem `/web/seen/` ("Widziałem" od mieszkańca z GPS). Reszta jak wyżej; liczby z Krakowa tylko ze slajdu 7 wariantu smartcity (`city-extension.md`).
