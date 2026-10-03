# Rescue Locator - słownik pojęć

2026-10-03. Pojęcia z poszukiwań osób zaginionych (SAR) i z samej aplikacji, wyjaśnione dla osoby, która nie jest ratownikiem. Wszystkie przypadki w aplikacji są fikcyjne lub symulowane, to nie są prawdziwe akcje.

117 pojęć w 5 grupach. Kolumna "W aplikacji" mówi, gdzie pojęcie widać w aplikacji lub w materiałach (pitch, walidacja). PDF do druku: [`slownik-rescue-locator.pdf`](slownik-rescue-locator.pdf).

## 1. Planowanie poszukiwań (teoria)

| Pojęcie | Rozwinięcie | Co to znaczy | W aplikacji |
|---|---|---|---|
| **SAR** | Search and Rescue / poszukiwanie i ratownictwo | Ogólna nazwa działań, w których służby szukają i ratują osobę zaginioną lub w niebezpieczeństwie. | Kontekst całej aplikacji; README, research.md, CalTopo/SARTopo jako narzędzia SAR. |
| **Robert J. Koester** | autor "Lost Person Behavior" (2008) | Badacz, który zebrał statystyki, jak daleko i dokąd idą zaginieni różnych typów. Jego książka to podstawa planowania poszukiwań na lądzie. | Warstwa "Statystyka zaginięć (Koester)"; w uzasadnieniu segmentu np. "Dlaczego S4: podnosi: Koester: turysta pieszy, góry +16 pp". |
| **LPB** | Lost Person Behavior / zachowanie osób zaginionych | Dziedzina i książka Koestera o tym, jak zachowują się zgubieni ludzie (dokąd idą, gdzie się zatrzymują). | research.md; "LPB rings" w opisie CalTopo. W aplikacji jako pierścienie Koestera. |
| **ISRID** | International Search and Rescue Incident Database | Międzynarodowa baza dziesiątek tysięcy zakończonych akcji poszukiwawczych, z której wyliczono statystyki Koestera. | Silnik używa kilku przybliżonych kwantyli z atrybucją (tabele ISRID są chronione prawem autorskim). Dla osoby w wodzie ISRID nie ma tabel. |
| **Kategoria osoby zaginionej** | subject category | Typ osoby (turysta pieszy, grzybiarz, osoba z demencją, dziecko, pływak, żeglarz). Od kategorii zależy, jak daleko i dokąd zwykle odchodzi. | Pole w scenariuszu; wyniki kalibracji osobno dla kategorii (turysta, grzybiarz, demencja, dziecko; na wodzie pływak, łódź). |
| **IPP** | Initial Planning Point / punkt startowy planowania | Punkt, od którego mierzy się wszystkie odległości w planie: zwykle miejsce, gdzie osobę ostatnio widziano lub gdzie na pewno była. | Znacznik "IPP" na mapie, pierścienie wokół niego, "mediana odległości od IPP" w Walidacji. Nowsza pewna obserwacja świadka przesuwa pierścienie (70/30). |
| **PLS** | Point Last Seen / miejsce, gdzie ostatnio widziano | Miejsce i czas, w którym ktoś ostatnio widział zaginionego na własne oczy. | research.md; w scenariuszu Zawrat schronisko w Pięciu Stawach o 12:10 (pole lastContact uruchamia też zegar hipotermii). |
| **LKP** | Last Known Point / ostatni znany punkt | Ostatnie miejsce ustalone pośrednio: auto na parkingu, zdjęcie, logowanie telefonu, punkt wejścia do wody. | Na wodzie od LKP startuje dryf i od niego liczy się baseline "najbliżej LKP"; zasada "IPP = ostatni pewny punkt" z testu na ślepo. |
| **Pierścienie Koestera** | distance rings / pierścienie odległości | Okręgi wokół IPP, w których statystycznie znajduje się 25, 50, 75 i 95% odnalezionych. Dla turysty w górach ok. 1,1 / 3,0 / 5,8 / 11,5 km (przybliżenie). | Pierwsza warstwa mapy (KoesterRings). Porównanie "po fuzji vs same pierścienie Koestera" na ekranie demo. |
| **Typ miejsca odnalezienia** | find location type | Rodzaje miejsc, w których ludzi faktycznie się znajduje: szlaki i inne obiekty liniowe, potoki i żleby, schroniska, woda, zarośla. Turyści trzymają się zwykle blisko szlaku. | Warstwa "Teren (OSM + DEM)": podnosi szlaki, potoki, schroniska, obniża jeziora i ściany. |
| **Segment / sektor** | search segment | Fragment obszaru poszukiwań, który jeden zespół może przeszukać za jednym razem. Zwykle ograniczony naturalnymi granicami. | S1..S20 nazwane od miejsc (np. S7 Żleb pod Zawratem), A1..E5 w nowej historii w Studio. W nagłówkach "sektor" ("Zespoły - przeciągnij na sektor"), w liczbach "segment". |
| **POA** | Probability of Area / prawdopodobieństwo obszaru | Szacunek, jaka część szansy, że osoba tam jest, przypada na dany segment; suma po wszystkich segmentach to 100%. | Procent przy segmencie i mapa ciepła. Uwaga: w aplikacji to "waga mapy", nie prawdziwe prawdopodobieństwo. Powyżej ok. 30% mapa jest zbyt pewna siebie: segment "45%" zawierał osobę w ok. 19% przypadków (report-land.md). Ranking działa, procentów nie czytamy jako szansy. |
| **Waga mapy** | map weight (UI label for POA) | Uczciwa nazwa POA w aplikacji: liczba do ustalania kolejności przeszukiwania, nie szansa znalezienia. | Reguła z ui-design.md: w nagłówkach "waga mapy", nigdy "prawdopodobieństwo". |
| **Mapa ciepła** | heatmap | Kolorowa mapa, na której cieplejszy kolor oznacza większą wagę danego miejsca. | Środek ekranu Akcja (2D i 3D). |
| **Wskazówka / sygnał / dowód** | hint, evidence | Każda informacja o możliwym położeniu: plan wycieczki, auto na parkingu, lokalizacja z 112, pusty przelot drona, ślad. | Karty zdarzeń za przyciskiem "Sygnały"; moduły "Auto na parkingu", "Lokalizacja 112 / BTS", "Świadek", "Ślad (przedmiot)"; w Ocenie sytuacji numerowane E1, E2... |
| **Fuzja wskazówek** | evidence fusion | Łączenie wszystkich wskazówek w jedną mapę: każda jest osobną warstwą, a warstwy się mnoży i normalizuje. | Każda wskazówka to włączany/wyłączany moduł; wyłączenie pokazuje, co wniosła. "Po fuzji" vs "same pierścienie". |
| **POD** | Probability of Detection / prawdopodobieństwo wykrycia | Szansa, że zespół zauważy osobę, jeśli ona naprawdę jest w przeszukiwanym segmencie. Zależy od terenu, pogody, pory i rodzaju zespołu. | Przy każdym przeszukaniu ("POD 60%"); meldunek patrolu daje 0,4 / 0,6 / 0,8; POD drona 0,6 lub 0,75 to założenie, nie specyfikacja sprzętu. |
| **POS** | Probability of Success / szansa powodzenia | Szansa znalezienia w danym przeszukaniu: POA razy POD. | "szansa znalezienia (Σ POA×POD)" w Postępie akcji; "oczekiwane znalezienie" przy przydziale; krzywe POS plan vs naiwnie. |
| **Skumulowany POD** | cumulative POD | Łączna skuteczność kilku przeszukań tego samego miejsca: każde kolejne zmniejsza szansę, że osoba tam jest, ale coraz mniej. | "POD łączny" segmentu w Ocenie sytuacji; planer obniża korzyść z ponownego wysłania zespołu w to samo miejsce. |
| **Aktualizacja bayesowska** | Bayesian update | Przeliczenie mapy po nowej informacji. Po pustym przeszukaniu waga segmentu maleje (razy 1 - POD), a reszta mapy rośnie. | Moment "wow" demo: puste segmenty i dron nad stawami spływają do S7, który wchodzi na #1. |
| **Dowód negatywny** | negative evidence | "Brak wyniku to też informacja": przeszukanie bez znaleziska mówi, gdzie osoby raczej nie ma. | Meldunki "Przeszukane" i "Częściowo", "Dron przeszukał, nic", "Patrol przeszukał, nic". |
| **Pokrycie / szerokość pasa** | coverage, sweep width | Jak gęsto zespół przeczesał teren. Słabe pokrycie oznacza niższe POD. | Przyciski patrolu: "Przeszukane - nic, pokrycie dobre" i "Częściowo - nic, słabe pokrycie"; czas przeszukania (sweep) przy przydziale. |
| **Zadania odruchowe** | reflex tasks | Standardowa lista pierwszej godziny według Koestera: sprawdzić IPP, przejść szlaki, miejsca niebezpieczne i przyciągające, zabezpieczyć wyjścia. | Baseline "heurystyka ekspercka" (eval/expert.py) to plan zadań odruchowych bez mapy. |
| **Szybkie przeszukanie** | hasty search / hasty team | Szybki przemarsz lekkiego zespołu po szlakach i najbardziej prawdopodobnych miejscach, zanim powstanie pełny plan. | Planer wysyła zespół do "rdzenia" segmentu: komórek z 70% jego wagi, maks. 15 ha. |
| **Zabezpieczenie wyjść** | containment | Obstawienie parkingów, schronisk i skrzyżowań, żeby osoba nie wyszła poza obszar albo żeby ją tam zatrzymać. | Warstwa containment: "Auto na parkingu" zmniejsza wagę korytarza wyjścia przez ten parking. |
| **Korytarz przejścia** | travel corridor | Pas wzdłuż szlaków, którymi osoba mogła przejść między ostatnim znanym punktem a miejscem logowania telefonu. | Warstwa liczona z sieci szlaków do sektora BTS, bufor 250 m. |
| **Dryf** | drift, leeway | Przesuwanie osoby lub łodzi na wodzie przez wiatr i prąd. Leeway to część prędkości wiatru, o jaką dryfuje obiekt (człowiek ok. 1,5%, kajak 2,5%, ponton 3%, łódź 4%). | Moduł WaterDrift: smuga od LKP z wiatrem i prądem, to co dopłynie do brzegu ląduje w trzcinach. Liczby ilustracyjne (tabele US Coast Guard). |
| **Hipotermia / zegar przeżycia** | hypothermia, survival clock | Wychłodzenie organizmu. Im dłużej od ostatniego kontaktu, im zimniej, mokrzej i wietrzniej, tym pilniej trzeba znaleźć osobę. | Chip "hipotermia: niski / podwyższony / wysoki / krytyczny". Prosta reguła, nie model medyczny. |

## 2. Akcja i zespoły

| Pojęcie | Rozwinięcie | Co to znaczy | W aplikacji |
|---|---|---|---|
| **Kierownik akcji** | search leader, incident commander | Osoba, która prowadzi poszukiwania: decyduje, gdzie i kogo wysłać. Dziś łączy wskazówki w głowie na papierowej mapie. | Rola "Operator / kierownik akcji": mapa, 3D, plan zespołów, edycja; karta "Przydział od kierownika akcji". Decyzja zawsze należy do człowieka. |
| **Operator** | operator (rola w aplikacji) | Osoba przy laptopie, która prowadzi mapę i plan za kierownika akcji lub razem z nim. | Przełącznik "Rola: operator"; ręczny przydział operatora wygrywa z planem silnika. |
| **Ratownik / patrol** | rescuer, field team | Zespół w terenie, który przeszukuje przydzielony sektor i melduje wynik. | Rola "Ratownik w terenie": telefon z zadaniem, mapą i przyciskami meldunków (widok patrolu). |
| **TOPR** | Tatrzańskie Ochotnicze Pogotowie Ratunkowe | Ratownictwo górskie w Tatrach. | Scenariusz Zawrat (patrole, śmigłowiec TOPR); czerwień TOPR #b8322a to jedyny mocny akcent w interfejsie. |
| **GOPR** | Górskie Ochotnicze Pogotowie Ratunkowe | Ratownictwo górskie w pozostałych polskich górach. | Scenariusze Bieszczady i Karkonosze (patrole GOPR, pies). |
| **WOPR** | Wodne Ochotnicze Pogotowie Ratunkowe | Ratownictwo wodne na jeziorach i morzu. | Scenariusze wodne: Śniardwy, Morzycko, Międzyzdroje (łodzie, skuter WOPR). |
| **PSP / OSP** | Państwowa / Ochotnicza Straż Pożarna | Straż pożarna, która w Polsce także szuka na wodzie (łodzie, nurkowie). | Zasoby w scenariuszach Śniardwy i Morzycko. |
| **LPR** | Lotnicze Pogotowie Ratunkowe | Śmigłowce ratunkowe. | Śmigłowiec LPR w scenariuszach Karkonosze i Śniardwy. |
| **112 / CPR** | numer alarmowy / Centrum Powiadamiania Ratunkowego | Ogólny numer alarmowy i centrum, które przyjmuje zgłoszenia i może przekazać przybliżoną lokalizację telefonu. | Moduł "Lokalizacja 112 / BTS"; w produkcji dane szłyby z CPR (w demo zamockowane). |
| **985 / 601 100 300** | numery ratunkowe w górach | Numery, pod którymi wzywa się GOPR i TOPR. | Pitch: "Żona dzwoni na 985". |
| **BTS / sektor komórkowy** | Base Transceiver Station, cell sector | Stacja bazowa sieci komórkowej. Wiadomo tylko, przez którą antenę telefon się logował, więc lokalizacja jest zgrubna (w górach setki metrów do kilku km). | Warstwa "sektor BTS" o promieniu ok. 1,2-1,5 km; w Karkonoszach telefon zalogował się na czeski BTS. |
| **AML** | Advanced Mobile Location | Automatyczne wysłanie dokładnej pozycji telefonu przy połączeniu z 112. W UE obowiązkowe, w Polsce ma ruszyć ok. 2027. | Nie ma w demo; w pitchu jako "kolejny moduł", który po wdrożeniu po prostu zdominuje mapę. |
| **Ratunek (aplikacja)** | oficjalna aplikacja GOPR/TOPR/WOPR | Aplikacja, która po wezwaniu pomocy wysyła ratownikom pozycję GPS. Działa tylko, jeśli osoba ją ma i jej użyła. | Moduł "Ping Ratunek"; w Zawracie opcjonalny epilog o 20:05, już po znalezieniu. |
| **RECCO** | system odblaskowy RECCO | Pasywny odbłyśnik w odzieży, który wykrywa detektor ratowników z bliska lub ze śmigłowca. | Tylko w pitchu i roadmapie: "AML / RECCO / dron = kolejny moduł". |
| **Zasób / typ zespołu** | resource type | Rodzaj sił: patrol pieszy, pies, dron, śmigłowiec, łódź, nurkowie. Każdy ma inną prędkość, POD i ograniczenia. | Karty zespołów w "Przydział zespołów"; typy ground / dog / drone / heli / boat / diver. |
| **Dron termowizyjny** | thermal drone | Dron z kamerą wykrywającą ciepło ciała, skuteczny na otwartym terenie, słaby w gęstym lesie. | Zdarzenie "Dron termowizyjny: nic"; uziemiony przy wietrze powyżej 12 m/s. |
| **NVG** | Night Vision Goggles / gogle noktowizyjne | Gogle pozwalające załodze śmigłowca latać w nocy. | Warunki pogodowe: "śmigłowiec może lecieć w nocy z NVG". |
| **Bramki zasobów** | resource gates | Reguły, kiedy dany zasób nie może działać: dron przy silnym wietrze, śmigłowiec we mgle lub w nocy przy słabej widoczności, nurkowie w nocy. | "Dron: uziemiony: wiatr 14 m/s > 12 m/s"; plan sam się przelicza. Progi ilustracyjne. |
| **Teren eksponowany / zespół linowy** | exposed terrain, rope team | Strome płyty i ściany, gdzie upadek grozi śmiercią. Przy lodzie lub silnym wietrze wchodzi tam tylko zespół z liną i asekuracją. | Flaga bezpieczeństwa "teren eksponowany + lód: tylko zespół linowy z asekuracją"; tam nie idą psy. |
| **Przydział zespołów** | assignment | Decyzja, który zespół idzie do którego segmentu. | Panel "Przydział zespołów" i karty "Top 3 + przydział"; w trybie Plan przeciąganie zespołu na sektor. |
| **ETA** | Estimated Time of Arrival / przewidywany czas dotarcia | Ile minut zespół potrzebuje, żeby dojść, dojechać lub dolecieć do segmentu. | Na karcie zespołu, np. śmigłowiec do S7 "ETA 15 min"; obok czas przeszukania. |
| **Fala** | wave | Kolejna tura wysłania zespołów po zebraniu meldunków z poprzedniej. | Lista zdarzeń ("· fala 3"), test na ślepo ("znaleziona w 3. fali"). |
| **Meldunek** | field report | Krótka wiadomość zespołu z terenu, jak przez radio: "S6 pusto, widoczność 50 m". | Przyciski patrolu i pole tekstowe; lokalny model zamienia tekst na wskazówki. W Monitoringu "ostatni meldunek X min temu". |
| **Przeszukane / Częściowo** | searched / partially searched | Meldunek, że segment przeszukano i nic nie znaleziono, z dobrym albo słabym pokryciem. | Duże przyciski w widoku patrolu; zmieniają mapę jak dowód negatywny (POD 0,8 lub 0,4). |
| **ŚLAD** | clue | Znaleziony przedmiot, odcisk, zapach dla psa albo relacja świadka, który wskazuje, że osoba tam była. | Przycisk "ŚLAD / ZNALEZIONO", moduły "Ślad (przedmiot)" i "Świadek"; ślad dodaje miękką warstwę 300-800 m. |
| **ZNALEZIONO** | Found | Meldunek o odnalezieniu osoby. Kończy poszukiwania. | Mapa zapada się do punktu odnalezienia, planer pisze "akcja zamknięta: znaleziono". W Zawracie śmigłowiec TOPR o 20:03. |
| **CISZA / w kontakcie** | silent team / in contact | Zespół, który od dłuższego czasu nic nie zameldował, może mieć kłopot albo brak zasięgu. | Monitoring: czerwona plakietka "CISZA" po przekroczeniu progu (domyślnie 10 min), zielona "w kontakcie". |

## 3. Aplikacja (tryby i ekrany)

| Pojęcie | Rozwinięcie | Co to znaczy | W aplikacji |
|---|---|---|---|
| **Akcja** | tryb | Główny ekran w czasie akcji: mapa, jeden panel, oś czasu. | Zakładka "Akcja": przełącznik 2D/3D, panel "Gdzie szukać najpierw", dolny pasek czasu. |
| **Plan** | tryb (klucz edycja) | Ekran do układania akcji: wskazówki i zespoły do przeciągania. | Zakładka "Plan": lewy panel ze wskazówkami i zespołami, karty zdarzeń zawsze widoczne. |
| **Więcej** | zakładka | Podstrony, które nie wymagają mapy. | Zakładka "Więcej" z pod-zakładkami Teren, Monitoring, Walidacja. |
| **Teren** | pod-zakładka | Podgląd tego, co dzieje się w terenie: zespoły, telefon patrolu, wpisywanie meldunków. | Widoki "Przegląd zespołów", "Telefon patrolu", "Meldunek"; każdy meldunek można "Dodaj do historii". |
| **Monitoring** | pod-zakładka | Kto i kiedy ostatnio meldował, ile meldunków na minutę, czy model AI działa, czy ktoś próbuje zgadywać PIN. | Tabela zespołów z "CISZA", wykres meldunków, udział LLM vs reguły, alarmy (ops.html; opcjonalnie Grafana). |
| **Walidacja** | pod-zakładka | Jedna karta, która w kilka sekund mówi, czy silnik pomaga, i gdzie nie pomaga. | Karta validation-summary: duża liczba top 3, baseline obok, wykres obszaru do znalezienia, linia "gdzie nie pomaga", przypis o symulacji. |
| **Ratownik (rola)** | rola | Widok dla telefonu ratownika w terenie. | Jeden ekran: pasek zespołu nad widokiem patrolu (sektor, kierunek, przyciski meldunków). |
| **Widok patrolu** | patrol view | Telefonowy ekran zespołu: moje zadanie, mapa, meldunki; działa też bez zasięgu. | web/patrol; "Kierownik akcji przydzieli Wam sektor - pojawi się tutaj."; kolejka offline. |
| **Kino** | tryb kinowy 3D | Pełnoekranowe ujęcia terenu 3D bez paneli, do prezentacji. | Przycisk "Kino" w widoku 3D; panele się chowają. |
| **Gdzie szukać najpierw** | panel | Najważniejsza odpowiedź aplikacji: od których segmentów zacząć. | Prawy panel w trybie Akcja: Top 3 sektorów z przypisanym zespołem. |
| **Top 3** | trzy pierwsze segmenty | Trzy segmenty z największą wagą mapy. Kluczowa miara: czy osoba jest w jednym z nich. | Panel "Top 3 + przydział"; demo: Top 3 to 7% obszaru; walidacja: właściwy sektor w top 3 w 66% symulacji (góry). |
| **Szczegóły** | rozwijana sekcja | Wszystko, czego nie trzeba widzieć od razu. | "Szczegóły: plan zespołów, postęp, ocena" pod panelem Top 3. |
| **Sygnały** | przycisk | Pokazuje karty wszystkich wskazówek na osi czasu. | Przycisk w dolnym pasku trybu Akcja. |
| **Oś czasu / krok** | timeline, step | Odtwarzanie akcji krok po kroku: każda nowa wskazówka to krok, mapa się przelicza. | Suwak, Play, zegar scenariusza (np. 19:45) w dolnym pasku. |
| **Postęp akcji** | panel | Ile szansy znalezienia już "wybrano" przeszukaniami i jaki obszar przeszukano. | "szansa znalezienia (Σ POA×POD)" i "przeszukany obszar". |
| **Ocena sytuacji** | situation assessment | Krótkie podsumowanie po polsku: sytuacja, hipotezy, rekomendacje na najbliższą godzinę, ryzyka, czego brakuje. | Panel pisany przez lokalny model; zawsze pokazuje źródło ("LLM lokalny" albo "reguły") i czas. |
| **Dlaczego ten segment** | explanation | Wyjaśnienie, które wskazówki podniosły lub obniżyły wagę segmentu i o ile. | "Dlaczego S4: podnosi: Koester: turysta pieszy, góry +16 pp". |
| **pp** | punkty procentowe | Różnica między dwiema wartościami procentowymi (z 10% na 26% to +16 pp). | W uzasadnieniach "Dlaczego". |
| **Story Studio** | "Opowiedz historię" | Edytor, w którym składa się nowy (fikcyjny) przypadek z modułów albo z opisu słownego. | Moduły do dodania, przycisk "Opowiedz historię" (lokalny model zamienia opis na zdarzenia), "Nowa historia: Zawrat". |
| **Tryb ślepy** | blind mode | Scenariusz, w którym aplikacja nie zna miejsca odnalezienia, więc nie pokazuje wyniku porównania. | Napis "Tryb ślepy: scenariusz nie zna miejsca odnalezienia..." zamiast backtestu. |
| **Epilog** | epilogue | Opcjonalne zdarzenie po znalezieniu, pokazane tylko dla historii. | Ping Ratunek o 20:05 w Zawracie, domyślnie wyłączony. |
| **PIN akcji** | PIN | Kod, który telefon ratownika musi podać, żeby wysyłać meldunki do laptopa kierownika przez sieć. | "Podaj PIN akcji (widoczny na laptopie kierownika akcji)"; zły PIN trafia do Monitoringu ("zły PIN", "możliwy atak"). |
| **Motyw papierowy / nocny** | paper / dark theme | Jasne "papierowe" panele nad mapą na dzień, ciemny wariant na noc. | Tokeny --rl-*: tło #ece8df, czerwień TOPR #b8322a, granat #1f4e79. |

## 4. Walidacja i liczby

| Pojęcie | Rozwinięcie | Co to znaczy | W aplikacji |
|---|---|---|---|
| **Symulowane przypadki** | simulated cases | Wygenerowane komputerowo zaginięcia, na których mierzymy silnik. To nie są prawdziwe akcje. | 1000 przypadków w górach (5 regionów po 200) i 600 na wodzie. Symulator i silnik pisała ta sama rodzina AI, więc to test spójności, nie walidacja na realnych akcjach. |
| **Scenariusz fikcyjny** | authored scenario | Wymyślona historia na prawdziwym terenie (np. Tomasz W., 58 lat, Zawrat). Służy do pokazu, nie do liczb wartości. | Zawrat, Kasprowy, Morskie Oko, Bieszczady, Karkonosze, Śniardwy, Morzycko, Międzyzdroje; "Dane scenariusza fikcyjne" w stopce mapy. |
| **Silnik** | engine (rescue-engine-v2.1) | Część aplikacji, która liczy mapę i plan. Do testów jest "zamrożona" wersja, żeby nie dopasowywać jej do wyników. | W Walidacji linia "silnik"; flaga --features all włącza nowsze warstwy. |
| **Baseline naiwny** | naive baseline | Najprostsza strategia do porównania: szukaj od najbliższych miejsc wokół IPP (na wodzie: wokół LKP). | "naiwnie" w Walidacji: top 3 w 43% (góry), 81% (woda). |
| **Heurystyka ekspercka** | expert baseline | Plan doświadczonego kierownika akcji bez mapy: zadania odruchowe w ustalonej kolejności. | "ekspert" w Walidacji: top 3 w 56% (góry), silnik 66%. W Bieszczadach ekspert ma mniejszą medianę obszaru (4,7% vs 5,7%). |
| **Top-k / hit@k** | hit@1, hit@3, hit@5 | Czy właściwy segment jest wśród k pierwszych w rankingu. Top 3 = hit@3. | report-land.md: silnik 36% / 66% / 80% dla top-1/3/5. |
| **% obszaru do znalezienia** | area to find | Jaką część obszaru trzeba przeszukać w kolejności z mapy, zanim trafi się na osobę. Mniej = lepiej. | Wykres "Obszar przeszukany do znalezienia"; demo: 0,07% po fuzji vs 34,3% same pierścienie. |
| **Mediana / p50, p75, p90** | percentyle | p50 (mediana) to typowy przypadek, p90 to trudny: 90% przypadków mieści się poniżej tej wartości. | Góry: 90% osób znalezionych po przeszukaniu 29% obszaru (ekspert 37%, naiwnie 68%); mediana 5,5%. |
| **Krzywa / CDF** | cumulative distribution | Wykres: jaki odsetek przypadków znaleziono po przeszukaniu x% obszaru. | Wykres w karcie Walidacja: linia silnika ciągła, baseline przerywana. |
| **Przedział Wilsona** | 95% Wilson confidence interval | Zakres, w którym z dużą pewnością leży prawdziwa wartość odsetka, biorąc pod uwagę liczbę przypadków. | Małym drukiem przy dużej liczbie: top 3 66% (63-69%). |
| **Kalibracja** | calibration | Sprawdzenie, czy liczba "45%" na mapie naprawdę oznacza, że w 45% takich przypadków osoba tam jest. | "Krzywa kalibracji" w Walidacji. Wynik: mapa jest zbyt pewna siebie powyżej ok. 30% (segment "45%" trafia w ok. 19%, "85%" w ok. 61%). |
| **Brier** | Brier score | Jedna liczba mierząca, jak dobrze prognozy procentowe zgadzają się z rzeczywistością. Niżej = lepiej. | "Brier silnika (niżej = lepiej)"; na lądzie 0,81. |
| **Mylący trop** | misleading clue | Wskazówka, która wskazuje w złe miejsce (np. źle zapamiętana trasa). | Z jednym mylącym tropem top 3 spada z 68% do 59%, nadal powyżej eksperta (49%). |
| **Gdzie nie pomaga** | loss line | Uczciwie pokazana grupa przypadków, w której silnik przegrywa z baseline. | Linia w karcie Walidacja: góry - Bieszczady (ekspert); woda - pływak na jeziorze (lepiej zacząć od LKP). |
| **Test na ślepo** | blind test, "zabawa w chowanego" | Jeden agent ukrywa fikcyjną osobę, drugi szuka tylko z aplikacją. Miejsce jest zapieczętowane hashem, więc nie da się go potem przesunąć. | Dwie rundy (N = 2): runda 1 mapa 2,1% obszaru vs ekspert 4,4% vs naiwnie 24,1%; runda 2 mapa nie pomogła (37,4%). To przypis, nie główna liczba. |
| **Zobowiązanie SHA-256** | commitment | Odcisk cyfrowy kryjówki opublikowany przed poszukiwaniem; po odsłonięciu każdy może sprawdzić, że się zgadza. | "SHA-256 zgodny ze zobowiązaniem: tak"; sędzia losuje wynik patrolu przez HMAC, więc jest ustalony z góry. |
| **Sędzia** | referee | Program, który odpowiada patrolom w teście na ślepo: nic, ŚLAD albo ZNALEZIONO, zależnie od POD. | Test na ślepo; ablacja "planer bez korekt" używa tej samej logiki. |
| **Ablacja** | ablation | Porównanie wersji z i bez danego elementu, żeby zobaczyć, co on wnosi. | eval/ablation.json: silnik, ekspert, naiwnie, planer bez korekt, przebieg rzeczywisty. Planer sam nie znalazł osoby w rundzie 2. |
| **Backtest** | backtest | Sprawdzenie metody na przypadkach ze znanym zakończeniem: na którym miejscu rankingu było miejsce odnalezienia. | "miejsce odnalezienia: po fuzji vs same pierścienie Koestera" na ekranie demo; 9 własnych scenariuszy, więc stronnicze i nie jako główna liczba. |

## 5. Technologia i dane

| Pojęcie | Rozwinięcie | Co to znaczy | W aplikacji |
|---|---|---|---|
| **Siatka / komórka** | probability grid, cell | Mapa podzielona na kratki (zwykle 100 x 100 m); każda kratka ma swoją wagę. | 60 x 60 komórek na 6 x 6 km, w Zawracie rozszerzone do 60 x 72; "obszar" w Walidacji to odsetek komórek. |
| **Obszar planowania (bbox)** | bounding box | Prostokąt, w którym liczy się mapę. Silnik sam go powiększa, jeśli wskazówki wychodzą poza niego. | Komunikat o pokryciu, gdy ponad 5% wskazówek leży poza obszarem. |
| **Moduł / provider** | HintProvider | Jeden plik kodu na jedno źródło wskazówek. Nowe źródło (AML, RECCO, dron na żywo) to nowy moduł, rdzeń się nie zmienia. | Moduły w Studio i warstwy: Koester, Teren, Plan trasy, Auto, 112, Pogoda, Przeszukane, Dron, Ratunek, Dryf. |
| **Planer** | SearchPlanner | Część silnika, która proponuje przydział: kto, dokąd, z jakim ETA i flagami bezpieczeństwa. | Panel "Przydział zespołów". Uczciwie: najsłabszy element; w teście na ślepo oba znalezienia przyszły z decyzji koordynatora. |
| **OSM** | OpenStreetMap | Otwarta mapa świata tworzona przez społeczność: szlaki, potoki, schroniska, ściany, piargi. | Teren wszystkich scenariuszy; atrybucja "© OpenStreetMap contributors". |
| **ODbL** | Open Database License | Licencja danych OSM: wolno używać za podaniem źródła. | Atrybucja "© OpenStreetMap contributors (ODbL)" na mapie. |
| **DEM** | Digital Elevation Model / numeryczny model terenu | Siatka wysokości terenu; z niej liczy się nachylenie i rzeźbę 3D. | Copernicus DEM: "Wczytywanie modelu terenu (Copernicus DEM)..."; nachylenie dzieli teren na klasy trudności. |
| **LiDAR (GUGiK)** | laserowy skan terenu | Bardzo dokładny model terenu z lasera (1 m). W Polsce udostępnia go GUGiK. | Nieużywany w demo; w tabeli mocków jako wersja produkcyjna. |
| **Klasy trudności terenu** | terrain difficulty | Podział terenu: szlak, hala/trawy, kosodrzewina, piarg, płyty/eksponowane, ściana, woda. Wpływa na prędkość, POD i bezpieczeństwo. | Przycisk "Trudność" w 3D; warstwa TerrainDifficulty. |
| **Mapa podkładowa offline / PMTiles** | offline basemap | Mapa zapisana w jednym pliku na laptopie, więc działa bez internetu w górach. | web/basemap/*.pmtiles: Tatry i regionalne wycinki; widok patrolu ładuje mapę z obszaru akcji. |
| **3D** | widok terenu 3D | Ten sam stan akcji na trójwymiarowym modelu gór. | Przełącznik 2D/3D w trybie Akcja; przyciski Kino, Trudność, Las. |
| **Ollama / lokalny LLM** | local language model (qwen3 4B) | Mały model AI działający na laptopie, bez chmury i bez internetu. | Odczytuje meldunki (1,3-1,7 s) i pisze Ocenę sytuacji; etykieta "LLM lokalny". |
| **Reguły awaryjne** | rules fallback | Proste reguły słów kluczowych, gdy model AI nie działa. Rozumieją mniej, ale odpowiadają od razu (ok. 15 ms). | Etykieta "reguły" / "reguły awaryjne (przeglądarka)"; Monitoring: "LLM niedostępny - parsują reguły". |
| **Kolejka offline** | offline queue | Meldunki zapisane na telefonie, gdy nie ma połączenia, i wysłane później. | Widok patrolu. |
| **run.json** | kontrakt rescue-run/1 | Plik z pełnym stanem akcji krok po kroku: mapa, segmenty, przydziały, pogoda. | Wszystkie ekrany (2D, 3D, patrol, Walidacja) czytają ten sam plik lub /api/run. |
| **Hotspot** | własna sieć z telefonu | Na pokazie telefon i laptop łączą się przez nasz hotspot, nie przez Wi-Fi hali. | Serwer poza laptopem działa tylko z PIN-em. |
| **Prometheus / Grafana** | monitoring | Narzędzia do zbierania i wykresów metryk (kto melduje, błędy, alarmy). | Opcjonalny dashboard "Rescue Locator - Teren"; bez Dockera to samo pokazuje Monitoring. |
| **Mock / dane zamockowane** | mocked data | Dane udawane na potrzeby pokazu: osoby, czasy, lokalizacje 112, przeloty drona, progi. | Prawdziwe są: silnik fuzji, ranking, planer, teren OSM + DEM i odczyt meldunków. Zamockowane: wszystkie dane wejściowe. |
| **RODO: żywotne interesy** | GDPR art. 6(1)(d), 9(2)(c) | Podstawa prawna przetwarzania danych osoby, która nie może wyrazić zgody, bo jest w niebezpieczeństwie. | Odpowiedź na pytanie jury o legalność; aplikacja nie śledzi nikogo i używa tylko danych, które ratownicy już dostają. |
| **CalTopo / SARTopo** | narzędzie SAR (USA) | Popularna amerykańska mapa do akcji SAR: przydziały, ślady, pierścienie. POA ustawia się tam ręcznie. | Porównanie w pitchu: Rescue Locator automatycznie łączy wskazówki i przelicza ranking po pustym przeszukaniu. |

Źródła: `rescue/README.md`, `rescue/app/`, `rescue/web/`, `docs/rescue-locator/` (pitch.md, research.md, ui-design.md), `rescue/eval/` (SUMMARY.md, README.md, calibration/report-land.md, calibration/WATER.md).
