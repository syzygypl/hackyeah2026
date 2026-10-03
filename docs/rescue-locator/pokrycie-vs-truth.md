# Pokrycie timeline: szacunek vs prawda (pomiar FOV)

Autor: Claude (AI Michała), 2026-10-03. Pytanie: czy pokrycie (POD) liczone w trybie timeline jest sensowne i czy parametry pola widzenia (`rescue/scenarios/fov/fov-params.json`) trzeba stroić.

**Wynik w skrócie:** parametry FOV są w porządku, nic nie zmieniam. Pojedyncze przejście pieszego w dzień daje 0,34-0,50 POD na komórkach, przez które szedł (kontrakt: 0,45-0,55), śmigłowiec i łódź nie zaliczają nieprawdopodobnie dużych obszarów, a noc działa zgodnie z założeniami. Fałszywe pokrycie (komórki, które uznajemy za przeszukane, a nikt ich nie przeszukał) wynosi średnio 12% (maks. 17%) i bierze się ze **szacowania śladu** między fixami co 5 min, a nie z promieni FOV. Dlatego poprawki należą do estymatora i silnika, nie do parametrów.

## Metoda

- Serwer `rescue-server` (build z `main` @ f5aeadf) z `RESCUE_DIR` ustawionym na kopię roboczą `rescue/` w scratchpadzie (do repo nic nie trafiło). Dla każdego z 10 scenariuszy z plikiem `scenarios/tracks/<sc>.json` powstały warianty:
  - `<sc>-E` = plik oryginalny (fixy GPS co 5 min z błędem i lukami; to widzi operator, a silnik liczy z nich ślad szacowany),
  - `<sc>-T` = ten sam plik, ale fixy każdej jednostki zastąpione jej `truth` (pozycja co 1 min, accM 5, bez luk) = pokrycie, jakie dałby prawdziwy przebieg,
  - `<sc>-E-<rodzaj>` i `<sc>-T-<rodzaj>` = tylko jednostki jednego rodzaju (ground, dog, drone, heli, boat, diver), żeby zmierzyć każdy FOV osobno.
  DEM, teren i `fov-params.json` identyczne we wszystkich wariantach.
- Odczyt: `GET /api/run/<wariant>?live=0&frames=0` (`timeline.coverageFinal`), a pełna mapa pokrycia z jednej klatki `?t=<endMinute>` (`cov` = POD per komórka 100 m).
- Komórka "przeszukana" = POD > 0,3. **IoU** = |E ∩ T| / |E ∪ T|. **Fałszywe pokrycie** = komórki przeszukane wg szacunku, a nie wg prawdy, jako % komórek przeszukanych wg szacunku (niebezpieczne: obszar uznany za przeszukany, a nieprzeszukany). **Pominięte** = odwrotnie, % komórek z prawdy (bezpieczne, tylko zachowawcze). **Nadwyżka POD** = suma max(0, POD_E - POD_T) po komórkach / suma POD_E.
- POD osoby: komórka miejsca odnalezienia (`truth.at` scenariusza, to samo co `found.point` w tracks), na końcu osi czasu i w minucie odnalezienia (`found.minute`). Pozycja osoby nie jest w pliku tracks (zgodnie z kontraktem), bierzemy ją ze scenariusza tylko do metryk.
- Dla każdego rodzaju jednostki z wariantu `-T-<rodzaj>`: max POD, mediana POD na komórkach, przez które jednostka naprawdę przeszła, oraz "szerokość pasa" = (liczba komórek > 0,3 lub > 0,1) x 100 m x 100 m / długość trasy `truth`. Długość trasy liczy też odcinki poza siatką (dojazd śmigłowca), więc dla śmigłowca szerokość jest zaniżona.
- Noc (`dark: true` w WeatherConditions): bieszczady-wetlinska, karkonosze-sniezka, kasprowy, zawrat (od zmroku), morzycko i tragedia-w-moryniu (cały czas). Mgła: zawrat 80 m do 19:45, karkonosze 30 m, kasprowy 150 m.

## Wyniki per scenariusz

| Scenariusz | Noc | areaPct E / T | pos E / T | komórki >0,3 E / T | IoU | fałszywe pokrycie | pominięte | nadwyżka POD | POD osoby (koniec) E / T | POD osoby (minuta odnalezienia) E / T |
|---|---|---|---|---|---|---|---|---|---|---|
| bieszczady-wetlinska | tak | 2,9 / 2,9 | 0,295 / 0,237 | 53 / 49 | 0,79 | 15% | 8% | 11% | 0,26 / 0,17 | 0,19 / 0,17 |
| karkonosze-sniezka | tak | 2,6 / 2,3 | 0,246 / 0,187 | 39 / 34 | 0,87 | 13% | 0% | 13% | 0,17 / 0,11 | 0 / 0,11 |
| kasprowy | tak | 1,4 / 1,4 | 0,014 / 0,011 | 23 / 24 | 0,68 | 17% | 21% | 16% | 0 / 0 | - (nie odnaleziono) |
| krakow-nowa-huta | nie | 7,1 / 7,7 | 0,002 / 0,267 | 165 / 179 | 0,69 | 15% | 21% | 14% | 0 / 0,32 | 0 / 0,32 |
| miedzyzdroje | nie | 2,5 / 3,2 | 0,540 / 0,643 | 74 / 98 | 0,69 | 5% | 29% | 4% | 0,80 / 0,90 | 0,80 / 0,90 |
| morskie-oko | nie | 5,1 / 4,9 | 0,417 / 0,496 | 112 / 107 | 0,77 | 15% | 11% | 13% | 0,49 / 0,78 | - (nie odnaleziono) |
| morzycko | tak | 2,2 / 3,6 | 0,237 / 0,307 | 55 / 98 | 0,44 | 15% | 52% | 14% | 0,21 / 0,09 | 0,13 / 0,09 |
| sniardwy | nie | 6,0 / 6,5 | 0,729 / 0,693 | 158 / 170 | 0,85 | 4% | 11% | 4% | 0,86 / 0,82 | 0 / 0,82 |
| tragedia-w-moryniu | tak | 3,1 / 3,6 | 0,269 / 0,307 | 79 / 98 | 0,75 | 4% | 22% | 6% | 0,25 / 0,09 | 0,10 / 0,09 |
| zawrat | tak | 3,9 / 4,1 | 0,370 / 0,452 | 75 / 82 | 0,67 | 16% | 23% | 11% | 0,45 / 0,39 | 0 / 0,39 |
| **średnio** | | | | | **0,72** | **12%** (maks. 17%) | 20% | 11% | | |

Odczyt:
- Przeszukany obszar (areaPct) z szacunku jest bardzo bliski prawdzie (różnica do 1,4 pkt proc.). Kształt pokrycia zgadza się w ~72% (IoU), resztę stanowią przesunięcia o 1-2 komórki wzdłuż trasy.
- W minucie odnalezienia prawdziwe pokrycie komórki osoby to 0,09-0,90; szacunek daje tam 0 w 4 z 8 przypadków (zawrat, karkonosze, krakow, sniardwy). Ostatni fix znalazcy jest sprzed wejścia do komórki (fixy co 5 min), więc szacunek "jeszcze go tam nie ma". To efekt opóźnienia fixów, nie FOV.
- krakow-nowa-huta, pos E 0,002 przy areaPct 7,1: po kroku "odnaleziony" stepPOA skupia się w miejscu odnalezienia, więc `pos` mierzy już tylko tę jedną komórkę (E 0 vs T 0,32). Wartość `pos` po ostatnim kroku jest zdegenerowana, patrz rekomendacje.
- morzycko: najniższe IoU (0,44) i 52% pominiętych. Szacunek ignoruje śmigłowiec (0 komórek, w prawdzie 26), bo jego ostatni fix (min. 95) jest jeszcze w drodze, a potem jest luka "brak zasięgu". Błąd zachowawczy (nie zaliczamy przeszukania), czyli bezpieczny.

## Wyniki per rodzaj jednostki (warianty z jednym rodzajem)

| Scenariusz | Rodzaj | max POD prawda / szac. | mediana POD na trasie (prawda) | komórki >0,3 prawda / szac. | pas >0,3 / >0,1 [m] | trasa łącznie [km] | fałszywe pokrycie | IoU |
|---|---|---|---|---|---|---|---|---|
| bieszczady-wetlinska | pies | 0,55 / 0,57 | 0,47 | 25 / 25 | 127 / 183 | 2,0 | 4% | 0,92 |
| bieszczady-wetlinska | dron | 0,80 / 0,78 | 0,39 | 27 / 27 | 62 / 84 | 4,4 | 19% | 0,69 |
| bieszczady-wetlinska | pieszy (noc) | 0,25 / 0,40 | 0,16 | 0 / 2 | 0 / 85 | 5,1 | 100% (2 kom.) | 0 |
| karkonosze-sniezka | pies | 0,55 / 0,69 | 0,45 | 33 / 37 | 107 / 182 | 3,1 | 11% | 0,89 |
| karkonosze-sniezka | dron (uziemiony) | 0 / 0,57 | 0 | 0 / 1 | - | 0 | 100% (1 kom.) | 0 |
| karkonosze-sniezka | pieszy (noc, mgła 30 m) | 0,47 / 0,43 | 0,08 | 1 / 1 | 1 / 31 | 8,4 | 0% | 1,00 |
| kasprowy | pies | 0,66 / 0,81 | 0,50 | 15 / 11 | 103 / 131 | 1,5 | 0% | 0,73 |
| kasprowy | dron (uziemiony) | 0 / 0,33 | 0 | 0 / 1 | - | 0 | 100% (1 kom.) | 0 |
| kasprowy | pieszy (noc) | 0,56 / 0,67 | 0,16 | 10 / 11 | 15 / 61 | 6,7 | 18% | 0,75 |
| krakow-nowa-huta | pies | 0,59 / 0,54 | 0,49 | 26 / 26 | 125 / 193 | 2,1 | 8% | 0,86 |
| krakow-nowa-huta | dron | 0,63 / 0,63 | 0,39 | 86 / 71 | 63 / 107 | 13,5 | 24% | 0,52 |
| krakow-nowa-huta | pieszy | 0,88 / 0,89 | 0,44 | 84 / 82 | 69 / 80 | 12,1 | 9% | 0,82 |
| miedzyzdroje | łódź | 0,95 / 0,95 | 0,94 | 70 / 57 | 36 / 40 | 19,6 | 0% | 0,81 |
| miedzyzdroje | dron | 0,54 / 0,47 | 0,33 | 24 / 7 | 79 / 116 | 3,0 | 43% | 0,15 |
| miedzyzdroje | pieszy | 0,88 / 0,88 | 0,50 | 12 / 12 | 41 / 55 | 2,9 | 8% | 0,85 |
| miedzyzdroje | śmigłowiec (cała trasa poza siatką) | 0 / 0 | - | 0 / 0 | 0 / 0 | 75,9 | 0% | - |
| morskie-oko | pies | 0,69 / 0,65 | 0,47 | 10 / 10 | 98 / 157 | 1,0 | 0% | 1,00 |
| morskie-oko | dron | 0,87 / 0,78 | 0,59 | 9 / 7 | 48 / 48 | 1,9 | 0% | 0,78 |
| morskie-oko | pieszy | 0,91 / 0,95 | 0,34 | 18 / 18 | 53 / 79 | 3,4 | 17% | 0,71 |
| morskie-oko | śmigłowiec | 0,95 / 0,78 | 0,43 | 75 / 76 | 58 / 105 | 12,8 | 16% | 0,74 |
| morzycko | łódź (noc) | 0,84 / 0,92 | 0,44 | 51 / 40 | 45 / 53 | 11,4 | 20% | 0,54 |
| morzycko | dron | 0,75 / 0,78 | 0,34 | 24 / 18 | 60 / 101 | 4,0 | 6% | 0,68 |
| morzycko | pieszy (noc) | 0,14 / 0,21 | 0,08 | 0 / 0 | 0 / 5 | 1,8 | 0% | - |
| morzycko | śmigłowiec (noc) | 0,87 / 0 | 0,41 | 26 / 0 | 4 / 6 | 62,9 | 0% | 0 |
| sniardwy | łódź | 0,95 / 0,95 | 0,94 | 107 / 111 | 44 / 57 | 24,3 | 5% | 0,93 |
| sniardwy | dron | 0,82 / 0,62 | 0,35 | 50 / 34 | 52 / 87 | 9,6 | 3% | 0,65 |
| sniardwy | pieszy | 0,43 / 0,43 | 0,23 | 1 / 1 | 3 / 116 | 3,8 | 0% | 1,00 |
| sniardwy | śmigłowiec | 0,95 / 0,95 | 0,67 | 15 / 14 | 2 / 3 | 87,2 | 0% | 0,93 |
| tragedia-w-moryniu | łódź (noc) | 0,84 / 0,91 | 0,44 | 51 / 34 | 45 / 53 | 11,4 | 6% | 0,60 |
| tragedia-w-moryniu | dron | 0,75 / 0,80 | 0,34 | 24 / 22 | 60 / 101 | 4,0 | 9% | 0,77 |
| tragedia-w-moryniu | pieszy (noc) | 0,14 / 0,25 | 0,08 | 0 / 0 | 0 / 5 | 1,8 | 0% | - |
| tragedia-w-moryniu | śmigłowiec (noc) | 0,87 / 0,89 | 0,41 | 26 / 26 | 4 / 6 | 62,9 | 0% | 1,00 |
| zawrat | pies | 0,73 / 0,70 | 0,49 | 13 / 14 | 99 / 168 | 1,3 | 7% | 0,93 |
| zawrat | dron | 0,60 / 0,46 | 0,36 | 32 / 20 | 73 / 115 | 4,4 | 35% | 0,33 |
| zawrat | pieszy (mgła 80 m, noc) | 0,24 / 0,41 | 0,13 | 0 / 3 | 0 / 94 | 5,1 | 100% (3 kom.) | 0 |
| zawrat | śmigłowiec | 0,72 / 0,73 | 0,36 | 39 / 36 | 41 / 79 | 9,5 | 0% | 0,92 |

Fałszywe pokrycie zsumowane po scenariuszach: dron 38 z 208 komórek (18%), pieszy 18/130 (14%), śmigłowiec 12/152 (8%), łódź 16/242 (7%), pies 8/123 (7%). Max POD w prawdzie: pieszy 0,91, pies 0,73, dron 0,87, śmigłowiec 0,95, łódź 0,95 (0,95 = `pod.cap`).

## Sprawdzenie parametrów

- **Pieszy, jedno przejście w dzień:** mediana POD na komórkach trasy 0,34-0,50 (krakow 0,44, miedzyzdroje 0,50, morskie-oko 0,34 w kosówce i piargach). Z modelu: W 80 m na 100 m komórki daje 1 - e^-0,8 = 0,55 w otwartym terenie. Zgodne z kontraktem (0,45-0,55); w trudniejszym terenie mniej, tak ma być.
- **Noc:** pieszy po zmroku x0,34 daje 0,08-0,16 na przejście (zawrat dodatkowo mgła 80 m x0,8: W ok. 22 m, 1 - e^-0,22 = 0,20). Łódź w nocy (x0,3) mediana 0,44 vs 0,94 w dzień. Śmigłowiec w nocy (x0,5) mediana 0,41 vs 0,43-0,67 w dzień przy wielu przelotach. Dron termowizyjny bez kary nocnej. Wszystko zgodnie z `pole-widzenia.md`. Mnożniki działają, a mgła kumuluje się z nocą (WeatherConditions przenosi pola między zdarzeniami).
- **Śmigłowiec (radiusM 280, W 297 m):** pas > 0,1 to 79-105 m na km trasy w siatce, czyli wyraźnie mniej niż W. Gaussowskie jądro rozkłada W na kilka komórek, a linia wzroku i las (W 30 m) obcinają resztę. Nie zalicza nieprawdopodobnie dużych obszarów. Fałszywe pokrycie 0-16%. Promień zostaje.
- **Łódź (radiusM 240, W 300 m na wodzie):** pas > 0,1 to 40-57 m na km. Łódź pływa wielokrotnie po tych samych pasach, więc pojedyncze komórki dochodzą do 0,95, a obszar nie puchnie. Na lądzie W 0 (land: false), więc brzeg nie jest zaliczany. Fałszywe pokrycie 0-20% (20% = morzycko w nocy, 8 komórek, przesunięcie trasy). Promień zostaje.
- **Pies (stożek):** pas > 0,3 to 98-127 m, a > 0,1 to 131-193 m na km. Pies daje szersze pokrycie niż W 95, bo stożek pod wiatr sięga 151 m (2,4 x 63 m). Max POD 0,55-0,73, fałszywe pokrycie 0-11%, IoU 0,73-1,0. Wiarygodnie. Jedna uwaga: przy wietrze 10-15 m/s (kasprowy, zawrat) stożek nadal ma 151 m, a badania mówią o krótszym zasięgu w silnym wietrze. Kształt `kinds` ma tylko dwa pasma (cisza 40 m / reszta 151 m). Patrz rekomendacje (to zmiana silnika, nie parametru).
- **Dron (W 60 m):** pas > 0,3 to 48-79 m, zgodnie z W. Najwyższe fałszywe pokrycie (do 43%), ale ono nie zależy od promienia (patrz niżej).

**Zmiany parametrów: brak.** Żaden parametr nie jest wyraźnie zawyżony. Fałszywe pokrycie nie rośnie z promieniem: śmigłowiec i łódź (największe W) mają go najmniej, a najwięcej ma dron (małe W) i pieszy w nocy. Zmniejszenie promieni obniżyłoby POD wszędzie, nie usuwając źródła błędu.

## Skąd się bierze fałszywe pokrycie (diagnoza)

1. **Dron, interpolacja prostą:** dron leci 25 km/h, więc między fixami co 5 min pokonuje ok. 2 km w szachownicy, a estymator rysuje prostą. Zaliczamy pas wzdłuż cięciwy, a prawdziwe meandry pomijamy (miedzyzdroje IoU 0,15, zawrat 0,33).
2. **Jitter GPS jednostki stojącej:** dron uziemiony w karkonosze i kasprowy ma w prawdzie 0 km trasy, a szacunek 1 komórkę z POD 0,57 / 0,33. Błąd fixów (accM 5-30 m) co 5 min to ok. 20-40 m "ruchu", który przez 2 h sumuje się do kilkuset metrów fikcyjnego przeszukania w bazie. To samo daje 2-3 fałszywe komórki pieszych w zawrat i bieszczady.
3. **Opóźnienie fixów przy odnalezieniu:** znalazca wchodzi do komórki osoby między fixami, więc szacunek daje POD 0 w minucie odnalezienia w 4 z 8 scenariuszy (bezpieczne, ale demo pokazuje "nieprzeszukane" tam, gdzie właśnie znaleziono osobę).
4. **Brak fixów po luce / dojeździe:** morzycko, śmigłowiec 0 komórek w szacunku vs 26 w prawdzie (bezpieczne, zachowawcze).

## Rekomendacje

Dla AI Mateusza (silnik, `RescueKit/Timeline/`):
- **Martwa strefa dla jittera:** przesunięcie między kolejnymi fixami mniejsze niż accA + accB (lub max 30 m) traktować jako postój: zero dystansu i zero pokrycia. To usuwa fałszywe pokrycie jednostek stojących (dron uziemiony 0,57 POD w bazie).
- **Pokrycie ważone dokładnością:** dla próbek `est` mnożyć wkład pokrycia przez min(1, W_open / (2 x accM)) albo pomijać próbki z accM > 2 x W. Zasada: "nie wiemy, gdzie był = nie zaliczamy jako przeszukane". To zbije fałszywe pokrycie drona z 18% (do 43%) bez ruszania W.
- **`pos` / `coverageFinal.pos`:** liczyć względem kroku sprzed zdarzenia "odnaleziony" (albo raportować oba). Po odnalezieniu stepPOA skupia się w jednym punkcie i `pos` spada do 0,002 (krakow), co w demo wygląda jak "nic nie przeszukano".
- **Stożek psa przy silnym wietrze:** dodać trzecie pasmo (np. > 8 m/s zasięg 80 m) przy czytaniu `kinds` albo czytać pasma `windCone` z `fov-research.json` (shape b). Obecnie 151 m obowiązuje także przy 14-15 m/s.

Dla AI Denisa (estymator, fixy z raportów):
- **Raport odnalezienia = fix:** zdarzenie "odnaleziony przez X" (`found.by`, `found.point`, `found.minute`) powinno trafiać jako fix `src: report` jednostki X. Wtedy pokrycie komórki osoby w minucie odnalezienia nie wynosi 0 (dziś 0 w 4 z 8 scenariuszy).
- **Dron i śmigłowiec między fixami:** zamiast prostej rozpoznać wzorzec z raportu ("przeszukuję sektor S3 szachownicą") jako `constraints.along: "area"` / plan z polygonem. Silnik może wtedy rozłożyć ten sam dystans po sektorze z niską gęstością, zamiast nasycać cięciwę. Bez takiej podpowiedzi lepiej, żeby szacunek drona był niepewny (duże accM), co przy rekomendacji powyżej daje mniejsze pokrycie.
- **Po luce "brak zasięgu"** przyjmować `plan` z przydziału operatora (segment docelowy), a nie postój. W morzycko śmigłowiec traci przez to całe pokrycie (zachowawczo, ale IoU 0,44).

Dla AI Marcina (symulator, opcjonalnie): dla dronów generować fixy częściej (telemetria drona to realnie 1 Hz; np. co 1 min), bo 5 min przy 25 km/h jest nierealnie rzadko dla tej klasy sprzętu.

## Jak powtórzyć

1. `cd rescue && swift build`.
2. Skrypt w scratchpadzie (nie w repo) kopiuje `rescue/scenarios` i `rescue/tools/terrain/data` do katalogu tymczasowego, tworzy warianty `-E`, `-T`, `-E-<rodzaj>`, `-T-<rodzaj>` (fixy = `truth` co 1 min, accM 5, bez `gaps`) z kopiami scenariusza, terenu i DEM.
3. `RESCUE_DIR=<kopia> .build/debug/rescue-server 8792`, potem dla każdego wariantu `GET /api/run/<wariant>?live=0&frames=0` oraz `?live=0&t=<endMinute>` (mapa `cov`), a porównanie zbiorów komórek z POD > 0,3 jak w sekcji Metoda. Cały przebieg trwa ok. 10 min (1 min na scenariusz).
