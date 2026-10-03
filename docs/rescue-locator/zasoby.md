# Zasoby - stan zespołów i sprzętu (dane i parametry)

Zakładka **Zasoby** i dziennik uczestnika (rescue/app/CONTRACT.md, sekcja "Zasoby i dziennik"). Ten dokument opisuje dane AI Marcina: skąd są liczby i co jest szacunkiem.

**Uczciwie:** sprzęt, załogi i historia przeglądów są **fikcyjne** (bez prawdziwych osób, znaków wywoławczych i numerów seryjnych; załoga = rola + etykieta typu `TOPR-A-1 (fikcyjny)`). Zmęczenie, bateria i paliwo to **szacunki** liczone przez serwer z osi czasu (trasy w `scenarios/tracks/`) i z parametrów poniżej - aplikacja tak je opisuje.

## Pliki

| Plik | Co | Jak odtworzyć |
|---|---|---|
| `rescue/scenarios/inventory/inventory.json` | 18 jednostek (id z rostera `GET /api/teams`): rodzaj, baza, model, załoga, pies, sprzęt (baterie, czas pracy, motogodziny, przeglądy), zapasy, dziennik przeglądów; `byHome` = nazwa wspólnego id w każdym scenariuszu (np. `heli` to śmigłowiec Policji w Bieszczadach, LPR w Karkonoszach, TOPR na Zawracie) | `python3 rescue/tools/inventory/make_inventory.py` (deterministyczne) |
| `rescue/scenarios/inventory/params.json` | parametry na rodzaj jednostki: limity służby, budżet wysiłku i wagi zmęczenia, cykl pracy psa, minuty lotu na baterię, czas pracy na paliwie, progi ostrzeżeń, przeglądy; lista źródeł | edycja ręczna; `_src` przy każdym rodzaju mówi, co jest daną (D), a co szacunkiem (S) |

## Parametry w params.json (skrót)

| Rodzaj | Parametr | Wartość | D/S | Skąd |
|---|---|---|---|---|
| pieszy | dutyLimitMin | 960 (16 h) | D | NWCG: zmiana 16 h, twardy limit 24 h, praca : odpoczynek 2 : 1 |
| pieszy | effortBudgetMin / wEffort / wDuty | 480 / 0.7 / 0.3 | S | 4000-5000 kcal na zmianę przy 600-800 kcal/h (Compendium 2024, MET 6.5-10 z obciążeniem) |
| pies | workLimitMin / restMin | 30 / 30 | D | FEMA US&R (WTC 2001): 20-45 min pracy, tyle samo odpoczynku |
| pies | dutyLimitMin | 360 (6 h) | S | doba 4-6 h efektywnej pracy - brak publicznego limitu IRO/FCI/NASAR |
| dron | flightMinPerBattery | 35 | D (z rezerwą) | DJI M30T: 41 min lotu, 36 min zawisu; w zimnie ok. -20 do -30 % (S, silnik nie liczy temperatury) |
| dron | batteryHardPct / batteryWarnPct | 20 / 35 | S | progi kontraktu |
| smiglowiec | enduranceMin | 150 | S z D | W-3A Sokół: zasięg 550-600 km przy ok. 235 km/h; Bell 407GXi (Policja) do 3,5 h |
| smiglowiec | fuelHardPct | 15 | D | rezerwa końcowa VFR 20 min (EASA) = ok. 13 % ze 150 min |
| lodz | enduranceMin | 240 (skuter 120 w inventory.json) | S | RIB / łódź PSP 3-5 h na zbiorniku; skuter 60-70 l przy ok. 30 l/h |
| nurkowie | dutyLimitMin / effortBudgetMin | 240 / 120 | S | 2-3 nurkowania na dobę z przerwą 1-2 h; czas dna z tabel MZ |

Wzory (zmęczenie z Toblera i czasu służby, bateria drona, paliwo, cykl psa, progi czerwone / pomarańczowe) są w kontrakcie, sekcja 3 - tu tylko dane. Prędkości tras w symulatorze (`rescue/tools/tracks/make_tracks.py`: pieszo 4,5 km/h, przeszukanie 2,5 km/h, pies 5 / 3,5, dron 45 / 25, śmigłowiec 180 / 60, łódź 30 / 8) są zgodne z Toblerem na łatwym terenie i ze specyfikacjami powyżej.

## Otwarte (bez źródła, do sprawdzenia u ratowników)

- Czy Sokół TOPR lata w nocy (NVG) - brak publicznego potwierdzenia.
- Dobowy limit pracy psa ratowniczego - brak publicznego limitu.
- Spadek czasu lotu drona w mrozie - DJI podaje tylko samopodgrzewanie baterii.
- Spalanie RIB / łodzi PSP, czas lotu S-70i Policji, liczba nurkowań na dobę w PSP.

## Źródła i wartości szczegółowo

Research ze źródłami (sesja AI Marcina, 2026-10-03). **D** = dana ze źródła, **S** = szacunek.

## 1. Pieszy ratownik górski

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| Stosunek praca : odpoczynek | 2 : 1 (na 2 h pracy lub dojazdu 1 h snu/odpoczynku, liczone w każdej dobie) | h : h | D | NWCG Work/Rest and Length of Assignment Standards - https://www.fs.usda.gov/sites/default/files/2019-05/nwcg_workrest-lengthofassignmentstandards.pdf ; NIFC Red Book rozdz. 7 - https://www.nifc.gov/sites/default/files/redbook-files/Chapter07.pdf |
| Maks. zmiana (norma) | 16 (powyżej tylko wyjątkowo, z uzasadnieniem kierownika akcji) | h | D | jw. (NWCG) |
| Twardy limit zmiany | 24 | h | D | jw. ("No work shift should exceed 24 hours") |
| Prędkość marszu od nachylenia (Tobler 1993) | v = 6 * exp(-3.5 * abs(S + 0.05)), S = nachylenie dh/dx (np. 0.10 = 10%); płasko ok. 5.0, maks. 6.0 przy -5% | km/h | D | Tobler's hiking function - https://en.wikipedia.org/wiki/Tobler%27s_hiking_function (Tobler 1993, dane Imhofa); uwaga: część wtórnych źródeł błędnie podaje S w stopniach |
| Tobler poza szlakiem | v * 3/5 (= 0.6; płasko 3 km/h zamiast 5) | - | D | jw. (Wikipedia: "off-path ... multiplied by 3/5") |
| Wydatek: marsz z plecakiem (backpacking) | 7.0 | MET | D | 2024 Adult Compendium of Physical Activities - https://pacompendium.com/wp-content/uploads/2024/01/2024-adult-compendium_1_2024.pdf ; https://pacompendium.com/walking/ |
| Podejście z obciążeniem 9-18 kg, 5-10% | 6.5 | MET | D | jw. |
| Podejście z obciążeniem 10-18 kg, 3-10%, tempo umiarkowane/szybkie | 7.5 | MET | D | jw. |
| Podejście z obciążeniem > 9 kg, 5-20%, tempo szybkie | 10.0 | MET | D | jw. |
| Wspinaczka górska (mountain climbing) | 8.0 | MET | D | jw. |
| Przeliczenie MET -> kcal | kcal/h ≈ MET * masa ciała [kg] (1 MET ≈ 1 kcal/kg/h); ratownik 80 kg + 15 kg plecaka na podejściu (7.5-10 MET): ok. 600-800 | kcal/h | D (wzór) / S (przykład) | definicja MET, Compendium jw. |
| Prosty model zmęczenia | budżet ok. 4000-5000 kcal na zmianę; po jego wyczerpaniu -> odpoczynek wg 2:1 | kcal | S | brak źródła na "budżet", szacunek z MET powyżej |
| Zimno: praca / rozgrzewka (zmiana 4 h, praca umiarkowana-ciężka) | np. bez wiatru, -32 do -34°C (-25 do -29°F): maks. 75 min pracy; wiatr ≥ 32 km/h, -26 do -28°C (-15 do -19°F): maks. 40 min; ≤ -32°C i wiatr ≥ 32 km/h: stop prac nieratowniczych; przerwy 10 min w cieple | min | D | ACGIH TLV Work/Warm-up Schedule, przytoczone przez CCOHS - https://ccohs.gc.ca/oshanswers/phys_agents/cold_working.html i WHSC - https://whsc.on.ca/Files/Resources/Hazard-Resource-Lines/ColdStress_V2-en.aspx |
| Noc: spadek prędkości marszu | x 0.5-0.7 (czołówka, szlak); poza szlakiem x 0.3-0.5 | - | S | brak źródła, szacunek |

## 2. Pies ratowniczy (SAR / tropiący)

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| Cykl pracy | 20-45 min pracy, potem odpoczynek równy czasowi pracy (FEMA US&R, WTC 2001) | min | D | FEMA (archiwum webharvest) - https://webharvest.gov/peth04/20041015000252/http:/www.fema.gov/about/mediacanine.shtm ; Animals 2020, Otto et al. (preprint) - https://preprints.org/manuscript/202003.0132/v1 |
| Przegrzanie w upale | po 20-25 min intensywnego szukania w upale część labradorów osiąga ok. 41.1°C (106°F), inne 40-40.5°C (104-105°F) | min / °C | D | Texas A&M VetMed, "Feeling the Heat" - https://vetmed.tamu.edu/news/press-releases/feeling-the-heat/ |
| Odpoczynek w transporcie | w aucie/klatce po pracy temperatura ciała dalej rośnie; dbać o chłodzenie | - | D | Animals 2020 jw. |
| Regeneracja dzień 2 | 10 min odpoczynku obniża temp. w 1. dniu, w 2. dniu z rzędu już nie wystarcza | min | D | Animals 14:2456 (MDPI) - https://mdpi-res.com/d_attachment/animals/animals-14-02456/article_deploy/animals-14-02456.pdf |
| Próg upału | > 29°C (85°F) przy wysokiej wilgotności: ocenić warunki; heat index ~32°C+ i gorące podłoże: nie pracować | °C | D (zalecenie) | University of Florida Health, "Pooches work hard, too" - https://post.health.ufl.edu/2012/05/17/pooches-work-hard-too |
| Upał - zalecenia ogólne | krótkie okresy pracy, częste przerwy, cień, woda, kamizelki chłodzące | - | D | ICAR (IKAR-CISA) Best Practice Guidelines for dog handlers, prezentacja 2018 - https://www.alpine-rescue.org/ikar-cisa/documents/2018/ikar20181210006103.pdf |
| Zimno | schronienie i kurtka przy postoju, buty/wosk na łapy, jedzenie i woda; brak limitu liczbowego w ICAR | - | D (jakościowo) | ICAR jw. |
| Maks. łączny czas pracy na dobę | 4-6 h efektywnej pracy (w cyklach jw.) | h | S | brak źródła (IRO/FCI/NASAR nie podają publicznie limitu dobowego), szacunek |

## 3. Dron termowizyjny

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| DJI Matrice 30T: maks. czas lotu | 41 (zawis 36) | min | D | specyfikacja M30T u dystrybutorów, np. https://www.advexure.com/products/dji-matrice-30t , https://www.dslrpros.com/dji-matrice-series/dji-matrice-30-series.html |
| M30T: maks. wiatr | 15 (start/lądowanie 12) | m/s | D | jw. |
| M30T: temperatura pracy | -20 do +50 | °C | D | jw. |
| TB30: bateria | 5880 mAh, 26.1 V, 131.6 Wh; samopodgrzewanie poniżej 10°C, praca do -20°C | - | D | jw. + karta TB30, np. https://advexure.com/products/dji-matrice-30-tb30-intelligent-flight-battery |
| TB30: ładowanie (BS30) | 20% -> 90% w ok. 30 | min | D | BS30 - https://heliguy.com/products/bs30-battery-station-for-dji-m30 |
| TB30: liczba cykli | do 400 (w 12 mies., jeśli < 120 dni łącznie naładowana ≥ 90%) | cykle | D | karta TB30 (dystrybutor) - https://measur.ca/products/dji-tb30-intelligent-flight-battery |
| Zimno: spadek czasu lotu | ok. -20 do -30% przy -10 do -20°C | % | S | brak źródła DJI z liczbą, szacunek (DJI podaje tylko samopodgrzewanie) |
| DJI Mavic 3T: maks. czas lotu | 45 (przy 32.4 km/h, bez wiatru) | min | D | DJI Enterprise, Mavic 3E/3T specs - https://enterprise.dji.com/mavic-3-enterprise/specs |
| Mavic 3T: maks. wiatr | 12 | m/s | D | jw. |
| Mavic 3T: temperatura pracy | -10 do +40 | °C | D | jw. |
| Model doby | 1 dron + 2-3 pary baterii + BS30 = praktycznie ciągła praca (lot ok. 35 min, ładowanie 30 min); ograniczenie: operator (zmiana jak ratownik) | - | S | wyliczenie z D powyżej |

## 4. Śmigłowiec

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| TOPR: typ dziś | PZL W-3A Sokół (jeden egzemplarz); zastępczo wojskowy W-3 z Powidza na czas przeglądów; zakup nowego planowany na 2029-2030 | - | D | Bankier/PAP - https://www.bankier.pl/wiadomosc/TOPR-planuje-zakup-nowego-smiglowca-Czeka-na-ruch-parlamentarzystow-8968948.html ; PAP - https://www.pap.pl/aktualnosci/smiglowiec-topr-w-przegladzie-zastepuje-go-wojskowa-maszyna |
| W-3A: zasięg | 550-600 (zbiorniki główne 1700 l); z dodatkowym 1100 | km | D | PZL W-3 Sokół (Wikipedia, dane techniczne) - https://en.wikipedia.org/wiki/PZL_W-3_Sok%C3%B3%C5%82 |
| W-3A: czas lotu | ok. 2.0-2.5 (zasięg / prędkość przelotowa ok. 235 km/h) | h | S | wyliczenie z D, brak bezpośredniego źródła |
| W-3A: zakres temperatur | -40 do +43, odladzanie wirników | °C | D | jw. (Wikipedia) |
| Policja: flota | 14 śmigłowców: 5 S-70i Black Hawk, 7 Bell 407 (w tym 407GXi), 2 Bell 206 | szt. | D | xyz.pl, "Lot ku ziemi..." - https://xyz.pl/lot-ku-ziemi-policyjne-lotnictwo-trzeszczy-w-szwach/ ; mobimaniak - https://www.mobimaniak.pl/409392/nowa-technologia-zabawka-policja-sprzet-bell-407gxi-wzmacnia-flote/ |
| Bell 407GXi (Policja): prędkość / zasięg / czas lotu | do 220 km/h / ok. 700 km / maks. 3.5 h; głowica EO/IR dzień i noc | - | D (źródło wtórne) | mobimaniak jw. |
| S-70i Black Hawk: czas lotu | ok. 2-2.5 | h | S | brak źródła publicznego z liczbą dla wersji policyjnej, szacunek |
| Rezerwa paliwa VFR (śmigłowiec) | 20 min przy prędkości najlepszego zasięgu (final reserve) | min | D | EASA Air Ops: CAT.OP.MPA.191 / NCO.OP.125 (UK CAA regulatory library) - https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/07120_CATOPMPA191_Fuel_Scheme_-_Fuel%20Planning.htm |
| Minima pogodowe HEMS, dzień, 1 pilot | podstawa ≥ 500 ft: widzialność wg VFR; 499-400 ft: 2000 m; 399-300 ft: 3000 m (2 pilotów: 1000 m i 2000 m) | ft / m | D | EASA SPA.HEMS.120 - https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/13170_SPAHEMS120_HEMS_operating_minima.htm |
| Minima HEMS, noc | podstawa 1200 ft, widzialność 2500 m (2 pilotów) / 3000 m (1 pilot) | ft / m | D | jw. |
| Wiatr: limit | zależny od typu i instrukcji użytkowania (np. podejście, lina) | m/s | S | brak źródła publicznego dla W-3A/TOPR; szacunek: ok. 15-20 m/s dla operacji z liną |
| TOPR w nocy | brak potwierdzenia publicznego, czy Sokół TOPR lata nocą (NVG) | - | - | brak źródła; do sprawdzenia u TOPR |

## 5. Łodzie

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| Skuter wodny (np. Sea-Doo GTX): zbiornik | 60-70 | l | D | Sea-Doo GTX 2007 (BRP) - https://sea-doo.brp.com/content/dam/seadoo/Canada/English/MY2007/Documents/Watercraft/GTX_2007.pdf ; GTX 300 (2021) - https://personalwatercraft.com/specs/sea-doo/3-4-passenger/2021/gtx/300/detail.html |
| Skuter: spalanie | ok. 30 średnio (GTX 230), do 75+ na pełnym gazie | l/h | D (źródło słabe) / S | oferta najmu GTX 230 - https://www.samboat.com/boat-rental/sanary-sur-mer/jet-ski/218517 |
| Skuter: czas pracy | ok. 2 (70 l / 30 l/h, z rezerwą) | h | S | wyliczenie |
| RIB WOPR (silnik zaburtowy ≥ 200 KM): zbiornik | ≥ 47 (wymóg w specyfikacji przetargu) | l | D | specyfikacja łodzi RIB (gov.pl, przetarg) - https://www.gov.pl/attachment/4307467b-a5a6-4c5c-b725-008aedadcd00 |
| RIB 200 KM: spalanie | ok. 40-70 przy prędkości roboczej | l/h | S | brak źródła, szacunek |
| Duża łódź ratownicza WOPR (12 m, strugowodna 170 KM) | 25 l/h ropy, > 30 km/h | l/h | D | koszalin.pl - https://www.koszalin.pl/en/printpdf/1185 |
| Łódź PSP (typowa aluminiowa/RIB z zaburtowym 50-150 KM) | 3-5 h pracy na zbiorniku | h | S | brak źródła, szacunek |
| Człowiek w zimnej wodzie (do modelu "czas na łódź") | zasada 1-10-1: 1 min szok, ok. 10 min sprawnych ruchów, ok. 1 h do utraty przytomności z hipotermii; przy 0-4°C okno ruchu 3-7 min | min | D | Cold Water Safety, CSBC (Giesbrecht) - https://csbc.ca/1-10-1-principle/ |

## 6. Nurkowie PSP

| Parametr | Wartość | Jednostka | D/S | Źródło |
|---|---|---|---|---|
| Zasada ogólna | prace podwodne planuje się tak, by ograniczyć do minimum wysiłek i czas pobytu nurków pod wodą | - | D | KG PSP, Skrypt do szkolenia specjalistycznego w zakresie młodszego nurka, rozdz. 12 "Planowanie nurkowania i zabezpieczenie logistyczne prac podwodnych" - https://www.gov.pl/attachment/a51881dd-7383-4b3f-8767-b88f1a88c747 |
| Planowanie czasu dna | tabele dekompresyjne z Rozporządzenia Ministra Zdrowia (warunki zdrowotne przy pracach podwodnych); przykład ze skryptu: 20 m przez 43 min -> wiersz tabeli 21 m / 50 min, grupa powtórzeniowa F, dekompresja 2 min na 3 m | min | D | jw. (skrypt, rozdz. 12) |
| Przystanek bezpieczeństwa | 3 min na 6-3 m przy nurkowaniu bezdekompresyjnym | min | D | jw. |
| Nurkowanie powtórzeniowe | uwzględnia azot z poprzedniego nurkowania (grupa powtórzeniowa + przerwa powierzchniowa -> czas dodatkowy) | - | D | jw. |
| Maks. liczba zanurzeń / nurka / dobę | 2-3 nurkowania (bezdekompresyjne), przerwa powierzchniowa ≥ 1-2 h | szt. / h | S | brak źródła publicznego z limitem PSP, szacunek |
| Skład ekipy | nurek kierujący pracami podwodnymi, sygnalista, sprzętowiec, nurek roboczy, nurek asekuracyjny (5 funkcji); przy ujemnych temperaturach większy skład ekipy (zamarzanie sprzętu, wychłodzenie nurków) | - | D | skrypt jw. ("Funkcje i zadania członków ekipy nurkowej") |
| Zimna woda / zima | ogrzewane pomieszczenie do przebierania i odpoczynku, ciepłe napoje przy długotrwałych działaniach | - | D | skrypt jw. |
| Czas dotarcia (z modelu "Nurkowie PSP SGRW") | 1.5-3 (dojazd specjalistycznej grupy) | h | S | brak źródła, szacunek z bazy (np. SGRW Olsztyn -> Śniardwy) |
