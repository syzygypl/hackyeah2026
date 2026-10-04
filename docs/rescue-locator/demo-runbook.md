# Rescue Locator - runbook pokazu na żywo (3 min)

Dla każdego z zespołu, do przeczytania pod stresem. Źródła: [`najmocniejsze-funkcje.md`](najmocniejsze-funkcje.md) (kolejność), [`pitch.md`](pitch.md) (liczby i odpowiedzi), [`demo-review.md`](demo-review.md) (znane problemy), `rescue/app/CONTRACT.md`, `rescue/README.md`. Stan kodu: `b2ed46d`. Wszystkie URL-e niżej sprawdzone GET-em (200) 2026-10-03.

## 1. Przygotowanie (T-30 min)

**Sprzęt**
- Laptop operatora (Chrome, ładowarka, przejściówka HDMI/USB-C) + projektor.
- Telefon 1 (ratownik, zespół `topr-a`) na danych komórkowych, nie na Wi-Fi hali. Telefon 2 (opcjonalnie) do "Widziałem".
- Drugi telefon z hotspotem w kieszeni (plan B). Nagranie wideo (backup) na pulpicie.

**Adresy**
| Co | URL |
|---|---|
| Operator, Historia od początku | https://rescue-locator.vercel.app/app/?sc=zawrat&role=operator&mode=akcja&view=2d&time=hist&step=0 |
| Operator, Na żywo | https://rescue-locator.vercel.app/app/?sc=zawrat&role=operator&mode=akcja&view=2d&time=live |
| Centrum | https://rescue-locator.vercel.app/app/centrum.html |
| Ratownik (bez klucza, tylko podgląd) | https://rescue-locator.vercel.app/app/?role=ratownik |
| Widziałem (mieszkańcy, Kraków) | https://rescue-locator.vercel.app/web/seen/ |
| Porównanie (jedna relacja zmienia top 3) | https://rescue-locator.vercel.app/app/porownanie.html |
| Odprawa (A4 dla kierownika) | https://rescue-locator.vercel.app/app/odprawa.html?sc=zawrat |
| Ktoś zaginął (rodzina) | https://rescue-locator.vercel.app/app/rodzina.html |
| Stan serwera | https://rescue-locator.vercel.app/health (ma być `"llm":"llm-openai"`, `"store":"shared"`) |

**Klucz akcji (zapis).** Na Vercel odczyt jest otwarty, każdy zapis wymaga klucza. Dwa klucze żyją tylko w zmiennych Vercel: operatora `RESCUE_PIN` (wszystko) i terenowy `RESCUE_FIELD_PIN` (tylko meldunki i ślady). Klucz operatora weź od Mateusza prywatnie (nigdy w wątku ani w repo).
1. **Zanim podłączysz projektor**: w aplikacji operatora wpisz klucz w pole **Klucz** w pasku (pole pokazuje go jawnie). Zostaje w `localStorage`.
2. Kliknij **Udostępnij**. Dialog pokazuje 3 kody QR: *Ratownik (telefon)* z kluczem terenowym, *Operator (drugi komputer)* z kluczem operatora (nie na rzutnik), *Podgląd (jury)* bez klucza. Brak klucza na laptopie = komunikat "linki są tylko do podglądu".
3. Telefonem 1 zeskanuj QR **Ratownik**. Klucz zapisuje się w telefonie i znika z paska adresu. Wybierz zespół **Patrol TOPR A**.

**Lista T-10 min (robi człowiek z kluczem operatora, nie agent).** Klucz dostajesz od Mateusza prywatnie, nigdy w repo ani w wątku.
1. [ ] **Udostępnij -> Wyczyść akcję -> OK** (albo `curl` z `POST /api/reset` niżej) -> `/api/live` ma `"seq": 0`, `/api/incidents` wszystkie `"ended": false`.
2. [ ] Na żywo, Zawrat: **Wyślij zespół** -> Patrol TOPR A -> S7. Telefon 1 w ciągu ~15 s pokazuje "S7".
3. [ ] Karty rozgrzane (niżej), Historia otwarta z `&step=0`, telefon na danych komórkowych, "Nie przeszkadzać" włączone.
4. [ ] Od teraz nikt z zespołu nie pisze na produkcję.

Czasy (serwer Rust, `545fe02`, pomiar AI Marcina 04:59): meldunek u operatora **~1-2 s**, Potwierdź wszystkie -> "Wszystko potwierdzone" 0,5 s, ZNALEZIONO w Centrum **~7 s**, u operatora od razu. Czeka się tylko na telefon (odpytuje co 15 s): przydział ~10-15 s, potwierdzenie i "Akcja zakończona" **~20-25 s**. Na te chwile masz zdania w tabeli niżej.

**Czyszczenie stanu (obowiązkowo po każdej próbie i 10 min przed pokazem).** Mechanizm: `POST /api/reset` (klucz operatora). Czyści meldunki, ślady, feed LIVE, przydziały, potwierdzenia (ACK), kursor "Następne zdarzenie", pulę zespołów i listę akcji zakończonych, a także bieżącą historię Studio (Plan). **Nie** usuwa zapisanych historii Studio (`scn:*`).
- Przycisk: **Udostępnij -> Wyczyść akcję -> OK** (działa tylko z kluczem operatora na urządzeniu).
- Albo z terminala: `curl -X POST https://rescue-locator.vercel.app/api/reset -H 'Content-Type: application/json' -H "X-Rescue-Pin: $RESCUE_PIN" -d '{}'` -> `{"reset":true}`.
- Sprawdź: https://rescue-locator.vercel.app/api/incidents - wszystkie `"ended": false`; https://rescue-locator.vercel.app/api/live - `"seq": 0`. Zawrat na żywo stoi na 19:45.
- Produkcja jest wspólna: każdy, kto ma klucz, może coś dopisać. Poproś zespół, żeby nikt nie pisał na produkcję od T-15 min.

**Po resecie: jeden przydział.** Na żywo, Zawrat, panel *Na żywo* -> **Wyślij zespół** -> Patrol TOPR A -> S7 Żleb pod Zawratem. Telefon w ciągu 10-15 s pokazuje "Moje zadanie: S7".

**Zawsze jawne `sc=zawrat`.** Na produkcji akcja LIVE w Centrum to inny scenariusz (2026-10-04 01:30: Połonina Wetlińska), a aplikacja bez `sc=` pamięta ostatni scenariusz i tryb. Historia bez `&step=0` otwiera się na **końcu** nagrania (20:03 ZNALEZIONO): użyj URL-a z tabeli albo kliknij ⏮ w doku przed pokazem.

**Rozgrzanie (pierwsze wejście jest wolne: mapa 15-25 s, `/api/incidents` na zimno ~17 s).** Otwórz i zostaw w kartach: (1) operator Zawrat w **Historia**, (2) Centrum, (3) operator `?sc=sniardwy`, (4) `?sc=krakow-nowa-huta`. Na telefonie: ekran ratownika + karta z Widziałem.

**Ekran.** Chrome w pełnym ekranie (Ctrl+Cmd+F), zoom 100% (pasek mieści się w 1 wierszu od 1280 px; jeśli się łamie: 90%). Zakładki zakładek ukryte, inne karty zamknięte. macOS: Centrum sterowania -> **Skupienie -> Nie przeszkadzać**; na telefonach też. Jasność telefonu max, blokada ekranu wyłączona.

**Plan B lokalnie (bez internetu).**
```sh
cd rescue && swift build && swift run rescue-server          # http://127.0.0.1:8780/app/ - z loopback bez klucza
swift run rescue-server 8780 --host 0.0.0.0 --pin 4821       # gdy telefon ma się podłączyć: TYLKO przez nasz hotspot
ipconfig getifaddr en0                                       # IP laptopa; telefon: http://<IP>:8780/app/?role=ratownik&sc=zawrat, poda PIN raz
```
`swift build` zrób przed pokazem (kilka minut). Lokalnie meldunki czyta Ollama, jeśli działa, inaczej reguły. Nigdy nie wystawiaj serwera na Wi-Fi hali; po pokazie Ctrl-C.

## 2. Pokaz 3 min

Kryteria (DEFENCE): **I** innowacja 30%, **K** związek z kategorią 20%, **U** użyteczność 20%, **D** design 20%, **C** kompletność 10%.

| # | Czas | Klik / URL | Co widać | Zdanie (PL) | Kryt. |
|---|---|---|---|---|---|
| 1 | 0:00-0:20 | Karta 1: Zawrat, **Historia**, oś na początku (URL z `&step=0` albo ⏮) | mapa Doliny Pięciu Stawów, IPP przy schronisku, pierścienie | "Sobota 17:40, żona dzwoni: mąż poszedł sam na Zawrat. Mgła, zaraz zmrok, a ratownik ma tylko okruchy informacji." | K |
| 2 | 0:20-0:50 | Przesuń oś czasu do 18:30 (plan trasy, auto na Palenicy, BTS 14:12, mgła); odznacz jedną wskazówkę w Sygnałach (☰ w doku) i zaznacz z powrotem | mapa przelicza się po każdej wskazówce, top 3 sektory po prawej | "Każda wskazówka to osobny moduł, mapa liczy się na żywo i od razu mówi, gdzie szukać najpierw." | I, D |
| 3 | 0:50-1:20 | **▶** albo przesuń oś 18:40 -> 20:03 | sektory wracają puste, dron nic, Żleb pod Zawratem wskakuje na #1, śmigłowiec, **ZNALEZIONO** | "Brak wyniku to też informacja. Prawdopodobieństwo spływa do żlebu, plan wysyła tam śmigłowiec - 20:03, znaleziony." | I |
| 4 | 1:20-1:55 | Przełącz na **Na żywo** (19:45). Telefon: **Pogoda · status · meldunek** -> wpisz `S8 pusto, widoczność 50 m` -> **Wyślij meldunek** | na laptopie po **~1-2 s** wpis w panelu *Na żywo* (podświetlony, "Niepotwierdzone: 1"), mapa się przelicza; kliknij **Potwierdź wszystkie** -> na telefonie po **~20-25 s** "Operator potwierdził Twój meldunek ✓" | "Ratownik pisze zwykłym zdaniem, model zamienia to w dowód, kierownik potwierdza jednym klikiem." Meldunek jest od razu: pokaż wpis i powiedz "model przeczytał zdanie: sektor S8, przeszukany, nic, widoczność 50 metrów - nikt tego nie przepisuje". Potwierdzenie na telefonie przychodzi po ~20-25 s: nie czekaj, idź do kroku 5, telefon pokaż na końcu kroku 5 (będą na nim już oba: potwierdzenie i koniec akcji). | U, C |
| 5 | 1:55-2:15 | Link **Centrum - wszystkie akcje** (karta 2). Przeciągnij wolny zespół na kartę Morskiego Oka. Telefon: **ŚLAD / ZNALEZIONO** -> **poszkodowany ZNALEZIONY** -> Wyślij | 18 akcji na mapie Polski (1 LIVE); po **~7 s** Zawrat przechodzi do **Zakończone**, zespoły wracają do puli, telefon: "Akcja zakończona" po **~20-25 s** | "Centrala widzi wszystkie akcje i jedną pulę zespołów. Znalezienie w terenie zamyka akcję i zwalnia ludzi do następnej." Przez ~7 s do "Zakończone" mów: "Kilka zespołów jest w terenie przy innych akcjach. Gdy jedna się kończy, centrala od razu widzi, kto jest wolny." Telefon ("Akcja zakończona" po ~20-25 s) pokaż na końcu kroku albo na początku kroku 6. | K, U |
| 6 | 2:15-2:35 | Karta 3 (Śniardwy), karta 4 (Kraków). Telefon 2: Widziałem -> wskaż miejsce -> **Wyślij zgłoszenie**. Opcjonalnie 3 s widoku 3D | dryf łodzi na jeziorze; senior w Nowej Hucie, zgłoszenie mieszkańca wpada do feedu | "Ten sam silnik na wodzie i w mieście - mieszkaniec zgłasza, że widział seniora, i to staje się dowodem." | K, D |
| 7 | 2:35-3:00 | Bez klikania (albo slajd z liczbami) | - | "Na tysiącu symulowanych zaginięć właściwy sektor jest w pierwszej trójce w 66%, u doświadczonego kierownika w 56%, od ostatniego punktu w 43%. To symulacja, nie prawdziwe akcje. Planer jest najsłabszy - decyduje człowiek. Rescue Locator: gdzie szukać najpierw." | C |

Jeśli zostaje czas albo jury pyta (każde ~10 s):
- **Czat** (czerwony przycisk w prawym dolnym rogu operatora, `?chat=1`): zdarzenie zwykłym zdaniem, karta z mini mapą, po "Dodaj" nowe top 3 i co się przesunęło. W Historii to "co by było, gdyby", bez zapisu.
- **Porównanie** (`porownanie.html`): ta sama akcja o 19:22 bez i z relacją turystki, top 3 zmienia się z S4/S7/S3 na S7/S6/S9.
- **Odprawa** (`odprawa.html?sc=zawrat`): cała odprawa kierownika na jednej stronie A4 do druku.
- **Rodzina** (`rodzina.html`): "Ktoś zaginął - co robić": najpierw 112, potem lista tego, o co pyta dyspozytor.

Krok 2 na produkcji (`4973b34`, z 33a6ad6): odznaczenie wskazówki w **Sygnałach (☰ w doku)**, np. "CPR 112: ostatni sektor BTS 14:12" o 18:05, przelicza panel, mapę 2D i 3D na to samo top 3 (S4/S3/S6 -> S3/S2/S4), a ↺ przywraca. Sprawdzone headless 02:10.

Nie pokazujemy: procentów POA jako szansy, trybu Walidacja, oceny LLM, Monitoringu, "+ Nowa akcja" (patrz `najmocniejsze-funkcje.md`, "Czego NIE pokazywać").

Uwaga do kroku 5: ZNALEZIONO z telefonu kończy Zawrat dla wszystkich. Przed kolejną próbą: **Wyczyść akcję** i ponownie przydział TOPR A -> S7. Zapas: na laptopie, Na żywo, **Następne zdarzenie ▶** (Zawrat: następne to 20:03 ZNALEZIONO ze śmigłowca) też kończy akcję.

## 3. Co może pójść źle

| Problem | Ratunek w jednej linii |
|---|---|
| Pierwsza mapa ładuje się 15-25 s, Centrum ~17 s | Karty otwarte i rozgrzane w T-30; nigdy nie otwieraj nowej karty na scenie. |
| Brak Wi-Fi / Vercel nie odpowiada | Laptop i telefony na hotspot; dalej źle: lokalny `swift run rescue-server` (wyżej), a jak i to nie - nagranie wideo. |
| "Zmiany wymagają klucza akcji" / 401 | Na laptopie wpisz klucz w pole Klucz (odłącz projektor); telefon: zeskanuj ponownie QR Ratownik. |
| Cudze dane: obce ślady, zakończone akcje, inne przydziały | **Udostępnij -> Wyczyść akcję**, potem przydział TOPR A -> S7; "Test nocny" na liście ignoruj (znany problem #1). |
| Telefon bez GPS / w hali brak fixa | https://rescue-locator.vercel.app/web/patrol/?sc=zawrat&run=/api/run/zawrat&team=topr-a&me=49.216,20.018 (`?me=lat,lon` udaje pozycję; klucz już jest w telefonie z QR). |
| Strzałka kierunku "nie tak" | Od c0ee99f strzałka obraca się wg kompasu telefonu (na iPhonie najpierw "Włącz kompas"). Bez kompasu pokazuje "▲N · północ u góry": trzymaj telefon północą do góry. Na pokazie bez GPS: ?me=lat,lon, a kierunek: ?heading=NN. |
| Model AI nie odpowiada (`/health` bez `llm-openai`, offline) | Meldunki czytają reguły (~15 ms), etykieta pokazuje "reguły"; pisz krótko: "S8 pusto", "znaleziony w S7". |
| ACK nie dochodzi na telefon | Telefon sprawdza co 15 s - mów dalej i wróć; zapis widać i tak na laptopie ("Wszystko potwierdzone"). |
| Zawrat nie przechodzi do Zakończone | Odśwież Centrum (Cmd+R); dalej nic: na laptopie Na żywo -> **Następne zdarzenie ▶** (20:03). |
| Widziałem: "w kolejce" | Telefon nie ma klucza (strona dziedziczy klucz z QR Ratownik na tym samym telefonie) - pomiń krok, powiedz zdanie. |

## 4. Pytania jury - krótkie odpowiedzi

1. **Skąd wiecie, że to działa?** Kalibracja na 1000 symulowanych zaginięć w 5 pasmach: top 3 66% vs ekspert 56% vs od ostatniego punktu 43%; 90% osób na 29% obszaru vs 37% vs 68%. Woda, 600 przypadków: top 3 91% vs 81%. To symulacja, nie prawdziwe akcje.
2. **Symulator i silnik pisał ten sam zespół?** Tak, ta sama rodzina AI - to test spójności, nie walidacja. Na wodzie oba używają tych samych tabel dryfu, więc ten wynik jest zawyżony. Następny krok: backtest na anonimizowanych akcjach GOPR/TOPR.
3. **"45%" na sektorze to szansa, że tam jest?** Nie. Ranking działa, procenty są przesadnie pewne: sektor "45%" trafiał w ~19% (Brier 0,81). Czytaj mapę jako kolejność szukania; dlatego w panelach nie pokazujemy procentów jako szansy.
4. **Test na ślepo?** AI Marcina chowa osobę i publikuje hash SHA-256 miejsca przed startem. Dwie rundy, obie znalezione, ale oba razy przez decyzję koordynatora wbrew planerowi; sama mapa raz pomogła (2,1% obszaru), raz nie (37,4% vs 35,7% naiwnie). N = 2, to przypis.
5. **Czy planer znajduje szybciej?** Nie i mówimy to wprost. Jego wartość to ETA, bramki bezpieczeństwa (dron przy wietrze, lina na oblodzeniu) i natychmiastowe przeliczenie. Decyduje człowiek.
6. **Gdzie nie pomaga?** Pływak na jeziorze: lepiej zacząć od miejsca wejścia do wody. W Bieszczadach ekspert ma niższą medianę obszaru (4,7% vs 5,7%).
7. **Czy to śledzenie ludzi? RODO?** Nie. Tylko wskazówki, które ratownicy już legalnie dostają (rodzina, auto, lokalizacja z 112). Art. 6(1)(d) i 9(2)(c) RODO. Dane w demo są fikcyjne.
8. **Co jest prawdziwe, co zamockowane?** Prawdziwe: fuzja, ranking, przeliczenie po pustym przeszukaniu, teren OSM + DEM, serwer na Vercel + Neon, meldunki przez model AI (reguły jako zapas). Zamockowane: scenariusze, osoby, sygnały, progi POD i pogody.
