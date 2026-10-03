# Rescue w mieście - analiza rozszerzenia pod Smart City (2026-10-03)

Pytanie: jak rozszerzyć `rescue/` (Rescue Locator, góry) o miasto, żeby pasował do zadania SMART CITY. Kryteria Smart City: pomysł 30%, związek z kategorią 20%, użyteczność 20%, design 20%, kompletność 10% - takie same jak DEFENCE i ARTIFICIAL INTELLIGENCE.

## Teza

Ten sam silnik, nowy przypadek: **zaginiony senior z demencją w mieście**. To nie jest naciągane - Koester zaczynał swoje badania właśnie od zaginięć osób z demencją, a kategoria `dementia` już jest w `koesterCategories` (`ModuleRegistry.swift`).

## Dlaczego to dobry problem miejski

- Policja: ok. 1700-2000 zaginięć osób 65+ rocznie w Polsce, kilka dziennie; ok. 11% wszystkich spraw (dane 2019-2024, sprawdzić najnowsze).
- Do 40% osób z demencją kiedyś się zgubi (Puls Medycyny); 6 na 10 według Alzheimer's Association.
- Koester: osoby z demencją Alzheimera znajdowane w 89% przypadków w promieniu 1 mili (1,6 km) od miejsca, gdzie widziano je ostatnio; mediana 0,8 km. Nie wołają, nie odpowiadają, zostawiają mało śladów, często idą do dawnego domu, przechodzą przez ulice.
- **Wszyscy znalezieni w ciągu 24 h przeżyli, po 24 h - tylko 54%.** To jest nasza liczba wartości.
- Łączy się z wcześniejszym researchem: starzenie się miast (28% osób 60+ w 2030), upał 2026 zabił głównie osoby 65+ - zegar przeżycia w upale.
- Kategoria Smart City wprost: reagowanie kryzysowe, usługi publiczne, dane miejskie, komunikacja z mieszkańcami.

Źródła: [Puls Medycyny](https://pulsmedycyny.pl/medycyna/neurologia/demencja-seniorow-powazny-problem-co-roku-gubi-sie-ok-15-tys-osob-65-plus/), [policja.pl - zaginięcia seniorów](https://policja.pl/pol/aktualnosci/194674,Wyszedl-z-domu-i-nie-powrocil-zaginiecia-seniorow-jako-narastajacy-problem-spole.html), [policja.pl #JestemTuCZEKAM](https://policja.pl/pol/aktualnosci/250828,JestemTuCZEKAM-co-zrobic-aby-zapobiec-zaginieciu-seniora.html), [dbS - Lost Alzheimer's subject](https://www.dbs-sar.com/SAR_Research/lost_alzheimer.htm), [dbS - profiles and statistics](https://dbs-sar.com/SAR_Research/Response.htm), [PMC - persons with dementia missing in the community](https://pmc.ncbi.nlm.nih.gov/articles/PMC3141319/).

## Mapowanie: co już mamy -> co w mieście

| Teraz (góry) | W mieście | Praca |
|---|---|---|
| `KoesterRings` hiker | kategoria `dementia` (0,3 / 0,8 / 1,6 / 3,2 km) - już jest | zero |
| `Terrain`: szlaki, potoki, schroniska | parki, zarośla, ogródki działkowe, bulwary i Wisła, przystanki MPK, kościoły, sklepy, dawny adres; Koester: demencja - zarośla i krzaki przy drogach, budynki | nowe zapytanie Overpass w `osm_terrain.py` + wagi w `TerrainProvider` |
| `TripPlan` (trasa od rodziny) | wywiad z rodziną: "codziennie chodził do kościoła na X, 30 lat mieszkał na Y" -> korytarz do dawnego domu i stałych miejsc | ten sam provider, inny scenariusz; `tools/interview` do sprawdzenia |
| `TrailheadCar` | "bilet MPK / portfel zabrany albo został w domu" -> rozszerza albo zawęża obszar | ten sam mechanizm, inny tekst |
| `Cell112Fix` | sektor BTS - w mieście mniejsze komórki (200-500 m) | zero, tylko promień |
| `Weather` / `WeatherConditions` + zegar hipotermii | upał lub mróz, noc; zegar przeżycia: 24 h + upał | dodać próg upału obok hipotermii |
| `SegmentSearched` | patrol policji / straży miejskiej przeszedł kwartał, nic | zero |
| `DronePassEmpty` | dron policji z termowizją nad parkiem; bramka: strefa lotniska Balice, zakaz nad centrum | nowa bramka w `SearchPlanner` |
| `RatunekPing` | opaska GPS / lokalizator seniora, telefon | zero, inny opis |
| `Clue` (znalezisko) | **zgłoszenie od mieszkańca "widziałem"**, zgłoszenie od motorniczego MPK, sprawdzenie kamery monitoringu miejskiego przez operatora | ścieżka meldunków z `rescue-field` + publiczny formularz |
| `TerrainDifficulty` (szlak, piarg, kosodrzewina) | klasy miejskie: ulica, park, zarośla, ogródki działkowe, tereny kolejowe, brzeg rzeki, zabudowa | nowe klasy + etykiety |
| Zespoły: ground / dog / drone / heli | patrol pieszy, radiowóz, straż miejska, pies, dron, wolontariusze | profile w `SearchPlanner` |
| `field.html`, `web/patrol` (meldunki, kolejka offline) | to samo dla patroli + **publiczna strona "Widziałem" przez kod QR / link w alercie** | nowa strona, ten sam parser |
| Studio "Opowiedz historię" | dyżurny opowiada zgłoszenie rodziny | gazetteer Krakowa zamiast tatrzańskiego |
| Mapa offline (PMTiles Tatry) | wycinek PMTiles dla Krakowa | pobranie danych (decyzja: duży plik) |
| Widok 3D | budynki z OSM w 3D | opcjonalne |

## Co nowego dokłada miasto (i czego nie ma w górach)

1. **Mieszkańcy jako czujniki.** Miasto wysyła lokalny alert do ludzi w promieniu z mapy (nie do całego miasta): zdjęcie, opis, "widziałeś? kliknij". Zgłoszenie po polsku -> lokalny model (już mamy parser) -> punkt na mapie z wagą wiarygodności -> mapa się przelicza. Pętla z najlepszych segmentów: alert idzie tam, gdzie prawdopodobieństwo największe.
2. **Służby miejskie w jednym obrazie.** Policja, straż miejska, MPK (motorniczowie i kontrolerzy), operatorzy monitoringu, MOPS. Każdy dostaje swój segment, a mapa uwzględnia, co sprawdzili.
3. **Kamery bez rozpoznawania twarzy.** Silnik mówi operatorowi monitoringu, które kamery sprawdzić najpierw i dla jakiego okna czasowego. Człowiek patrzy, wynik wraca jako "segment sprawdzony" albo "znalezisko". Zero automatycznej biometrii (RODO, AI Act).
4. **Dane dla miasta po akcji.** Mapa miejsc, gdzie seniorzy się gubią i gdzie się ich znajduje -> profilaktyka (opaski GPS dla zagrożonych, oznakowanie, szkolenie motorniczych).

## Proponowany scenariusz demo

- **Kto:** dyżurny policji / Centrum Zarządzania Kryzysowego Krakowa.
- **Problem:** Pan Józef, 81 lat, demencja, wyszedł z domu na os. Na Kozłówce w Nowej Hucie o 13:00 w upale (34°C). Córka zgłasza o 16:30. Osoba fikcyjna.
- **Kroki:**
  1. Dyżurny opowiada zgłoszenie (Studio) -> pierścienie dla demencji, korytarz do dawnego domu w Podgórzu i do kościoła, sektor BTS.
  2. Plan: patrole do 3 najlepszych segmentów (ogródki działkowe, zarośla przy Zalewie Nowohuckim, przystanek tramwajowy), operator monitoringu dostaje listę kamer.
  3. Alert do mieszkańców w promieniu 1 km; przychodzą zgłoszenia "widziałem" (w tym fałszywe) -> AI je czyta, mapa się przelicza, segmenty sprawdzone gasną.
  4. Motorniczy linii 4 melduje "starszy pan w kapciach wysiadł na X" -> mapa się przesuwa -> patrol znajduje go w zaroślach przy bulwarach o 18:40.
- **Wow:** mapa Krakowa, która "oddycha" na żywo z każdym zgłoszeniem mieszkańca, plus zegar przeżycia w upale.
- **Liczba:** "Obszar do sprawdzenia w kolejności prawdopodobieństwa: X% z mapą vs Y% z samymi pierścieniami" (ten sam test historyczny co dla Zawratu) + "24 h = granica przeżycia: 100% vs 54%".

## Praca (szacunek, kolejność)

| # | Krok | Czas | Pokazywalne po |
|---|---|---|---|
| 1 | Scenariusz `scenarios/krakow-nowa-huta.json`: bbox ok. 6 x 6 km, kategoria `dementia`, zdarzenia, zespoły miejskie | 45 min | `swift run rescue-demo` na mapie online |
| 2 | Teren miejski: zapytanie Overpass w `osm_terrain.py` (parki, zarośla, ogródki, woda, przystanki, kościoły) + wagi w `TerrainProvider`, `--no-dem` (płasko; uwaga: narzędzie DEM odrzuca bbox przecinający 50°N, a Kraków leży na 50°N) | 60-90 min | heatmapa w miejskich miejscach |
| 3 | Profile zespołów miejskich + bramka drona (strefa Balice) + próg upału w zegarze | 45 min | karty zespołów z ETA |
| 4 | Publiczna strona "Widziałem" (kopia `field.html`, uproszczona) + alert w promieniu | 60-90 min | zgłoszenie z telefonu z widowni przelicza mapę |
| 5 | Etykiety klas terenu i UI po miejsku | 30 min | |
| 6 | Mapa offline Krakowa (PMTiles) | 30-60 min + pobranie | demo bez wifi |

Razem ok. 5-7 h jednej osoby z agentem; kroki 1-3 dają działający pokaz po ok. 3 h.

## Ryzyka i odpowiedzi dla jury

- **"To zadanie dla DEFENCE, nie Smart City."** Ten sam silnik pasuje do obu; w Smart City opowiadamy o usługach miasta, mieszkańcach, MPK, monitoringu i danych do profilaktyki. Decyzja o kategorii: ludzie, do `DECISIONS.md`.
- **Prywatność.** Żadnej biometrii, żadnego skanowania telefonów; alert idzie od miasta, zgłoszenia od mieszkańców są dobrowolne; dane osoby zaginionej znikają po zamknięciu sprawy.
- **Liczby Koestera są amerykańskie i przybliżone.** Mówimy "ilustracyjne", tak jak w Zawracie.
- **Strefy lotów dronów i procedury policji** - sprawdzić przed slajdem.
- **Czy dwa demo (góry + miasto) to nie za dużo?** Na pitch: miasto jako główna historia, góry jako jedno zdanie "ten sam silnik działa w Tatrach".
