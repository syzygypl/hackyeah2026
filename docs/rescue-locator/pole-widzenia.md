# Pole widzenia i model wykrycia (tryb timeline)

Parametry dla każdego typu jednostki: jak szeroki pas terenu "naprawdę przeszukuje" w ciągu minuty. Wartości maszynowe: [`rescue/scenarios/fov-params.json`](../../rescue/scenarios/fov-params.json). Wszystkie liczby są ostrożne (raczej za małe niż za duże). Oznaczenie **szac.** = szacunek bez bezpośredniego źródła. To nie są procedury TOPR/GOPR/WOPR.

## Podstawa: efektywna szerokość przeszukania (W, ESW)

W teorii poszukiwań (Koopman) każda para "sensor + obiekt + warunki" ma jedną liczbę: **efektywną szerokość przeszukania W** (sweep width). Jest to szerokość pasa, w którym sensor "znalazłby wszystko", przy czym tyle samo pominie wewnątrz pasa, ile wykryje poza nim. Nie jest to zasięg wzroku: W jest zwykle 1-2 razy większe niż średni maksymalny zasięg wykrycia (Koester 2014: W ≈ 1,645 x AMDR).

Mapowanie klas terenu silnika (`ProbabilityGrid.Difficulty`) na klasy w JSON:

| Silnik | JSON | Uwaga |
|---|---|---|
| `trail` | `open` | szlak i otwarty teren |
| `meadow` | `meadow` | hala, trawy |
| `dwarfPine` | `dwarfPine` | kosodrzewina |
| `scree` | `scree` | piarg |
| `slab` | `slab` | płyty |
| `cliff` | `cliff` | ściana |
| `water` | `water` | woda |
| `forest[cell] == true` | `forest` | nakładka OSM las; zastępuje wartość klasy lądowej |

## Parametry per typ jednostki

### Zespół pieszy (na jednego ratownika, dzień, osoba nieodpowiadająca)

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| W, las | 17 m (gęsty las, słabo widoczny dorosły) - 64 m (las strefy umiarkowanej, styczeń) - 142 m (otwarty las liściasty zimą, dobrze widoczny) | 35 m | polski las górski to świerk z podszytem, liście na drzewach |
| W, teren otwarty / hala | 64-142 m | 80 / 60 m | trawy i rzeźba terenu zasłaniają leżącą osobę |
| W, kosodrzewina / piarg / płyty / ściana | brak danych | 15 / 40 / 50 / 25 m | **szac.**; kosodrzewina jak najgęstszy las z tabel |
| Noc (czołówki > 200 lx) | 0,34 (64 m dzień, 22 m noc) | 0,34 | jedyny pomiar nocny na lądzie |
| Noc, słabe latarki < 200 lx | dodatkowo x0,5 (24 m vs 12 m) | 0,17 | |
| Osoba odpowiadająca (krzyk, gwizdek) | 306-460 m (NZ, teren górski) | +300 m W słuchowe | pomiar dwustronny dźwięk / światło |
| Wysokość obserwatora | | 1,7 m | |
| Max zasięg | | 200 m | dalej wkład do W jest pomijalny |

Linia n ratowników = n śladów. Zmęczenie: x0,5 dla średnio i słabo widocznych obiektów (Koester 2004). Źródła: [Koester, noc](https://journalofsar.com/wp-content/uploads/2020/04/v4-7-Koester-POD-Syrotuck.pdf.pdf), [Koester 2014](https://doi.org/10.1016/j.wem.2013.09.016), [Koester 2004, USCG](https://www.dco.uscg.mil/Portals/9/CG-5R/nsarc/DetExpReport_2004_final_s.pdf), [NZ, dźwięk i światło](https://journalofsar.com/auditory-and-light-based-two-way-effective-sweep-width-for-responsive-search-subjects-in-new-zealand-mountainous-terrain/).

### Pies (węszący z powietrza, przeszukanie obszaru)

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| W, ogólnie | 95 m (95% CI 44-145), 4 zespoły, 6 lat ćwiczeń | 95 m teren otwarty / hala | jedyny pomiar ESW psów |
| W, las / kosodrzewina / piarg | brak | 80 / 70 / 70 m | **szac.**; mniej wiatru w lesie (20 mph w otwartym = 4 mph w lesie) |
| POD przy pasach 100 m | 5-95% zależnie od pogody, NASAR średnio 50% | | |
| Noc | lepiej niż dzień (brak konwekcji) | 1,0 | ostrożnie; silnik daje 0,95 |
| Spokojne słoneczne południe | ok. 2% zapachu względem nocy przy 100 m | x0,5 | **szac.** |
| Wiatr najlepszy | 2,2-4,5 m/s | stożek 150 m, pół-kąt 25° | **szac.** |
| Cisza (< 1 m/s) | | koło 40 m | brak kierunku |
| Silny wiatr (> 9 m/s) | rozmywa smugę | 70 m, 15° | **szac.** |

Ważne: smuga zapachu płynie od osoby **z wiatrem**, więc pies "widzi" komórki leżące **pod wiatr** od siebie. Stożek rysujemy od psa w stronę, z której wieje. W górach: w dzień nagrzane stoki dają przepływ w górę (pies pracuje granią i w dół), wieczorem i w nocy spływ w dół (praca żlebami od dołu). Greatbatch 2015 nie znalazł korelacji wiatru z skutecznością, więc cały model wiatru to **szac.** Pies tropiący (trailing) idzie śladem, pas ok. 10-30 m wokół trasy, nie modelujemy jako pokrycie obszaru. Źródła: [Chiacchia 2015](https://doi.org/10.1016/j.wem.2014.10.004), [Search Dog Handbook](https://www.sarbc.org/sarbc/pdfs/sardog.pdf), [Greatbatch 2015](https://pubmed.ncbi.nlm.nih.gov/25998861/).

### Dron z kamerą termowizyjną

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| Sensor | 640x512, piksel 12 µm, ogniskowa 9,1 mm, DFOV 61° | HFOV 49°, VFOV 40°, IFOV 1,35 mrad | klasa DJI M30T |
| Wysokość AGL | praktyka SAR 40-120 m | 80 m | GSD 11 cm, leżąca osoba (0,5 m) = ok. 4-5 px |
| Ślad kamery na 80 m | 2 x AGL x tan(HFOV/2) | 74 x 59 m | |
| Max AGL dla wykrycia | kryterium Johnsona 1,5 px | ok. 250 m | człowiek na wideo potrzebuje 4+ px, więc 80-100 m |
| W, teren otwarty | | 60 m | ok. 0,8 szerokości śladu (operator przegapia) |
| W, las | pojedyncze klatki termo pod gęstym okapem praktycznie nie działają (Bimber, AOS) | 12 m (0,2 x otwarty) | **szac.** |
| W, kosodrzewina / piarg / płyty / woda | | 25 / 35 / 40 / 45 m | **szac.** |
| Dzień na nagrzanej skale | | x0,8 | już w silniku |
| Noc | lepszy kontrast termiczny | x1,1 | już w silniku |
| Limit wiatru | | 12 m/s | już w silniku |

Silnik ma dziś `widthM: 120` dla drona, ok. 2x więcej niż wynika z geometrii kamery. Źródła: [DJI M30T](https://enterprise-insights.dji.com/matrice-30-series-us-mobile), [zasięgi DRI](https://uavthermal.com/blog/thermal-camera-person-detection-range/), [Schedl, Kurmi, Bimber 2020](https://www.nature.com/articles/s42256-020-00261-3).

### Śmigłowiec

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| W, osoba w wodzie, 300-500 ft | 0,1 NM (185 m) przy każdej widzialności | 185 m | tabela USCG H-15 / IAMSAR |
| Kamizelka (PFD), do 500 ft | x4 | x4 | |
| W, ląd otwarty | brak otwartej tabeli | 300 m | **szac.** |
| Poprawki roślinność / rzeźba (IAMSAR N-10) | 0,5 (15-60% lub pagórki), 0,3 (60-85% lub góry), 0,1 (> 85%) | las 30 m, kosodrzewina 75 m, piarg 150 m | |
| Noc, tylko NVG, bez światła | 0,01 NM vs 0,1 NM w dzień | x0,1 | tabela H-32 |
| Noc z FLIR | | x0,5 | **szac.** |
| Wysokość | | 150 m AGL | |

Źródła: [USCG Addendum, dodatek H](https://rdept.cgaux.org/documents/ManualsTemp/USCG_SAR_Addendum.pdf), [IAMSAR t. II rozdz. 5](https://cranston.independent-inquiry.uk/wp-content/uploads/cranston-evidence/INQ010511_Extract_from_IAMSAR__International_Aeronautical_and_Maritime_Search_and_Rescue__Manual__Chapter_5_of_Volume_II__2019_Edition.pdf), [Sulaiman, Pierce 2023](https://arxiv.org/abs/2304.00983). Wartości N-10 znamy z wtórnego streszczenia, nie z oryginału.

### Łódź

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| W, osoba w wodzie, mała łódź | 0,2 NM (370 m) przy 1-3 NM widzialności, 0,3 NM (555 m) przy 5+ NM | 300 m | fala na jeziorze, widać tylko głowę |
| Wiatr / fala | x1 (< 15 kt, < 3 ft), x0,5 (15-25 kt), x0,25 (> 25 kt) | jak w źródle | tabela H-10 |
| Noc | osoba bez światła "prawie niewidoczna" | x0,1 bez reflektora, x0,3 z reflektorem | **szac.** dla reflektora |
| Brzeg z wody | | 20 m | **szac.** |
| Wysokość oka | | 2 m | |

### Nurkowie

| Parametr | Zakres w źródłach | Wybrano | Dlaczego |
|---|---|---|---|
| Widzialność w jeziorach PL (krążek Secchiego) | < 1 m mętna, 2-4 m dobra, rekord 10-12 m (Powidzkie, Hańcza) | typowo 2 m | |
| W | | min(2 x widzialność, 6 m), domyślnie 3 m | **szac.**; widzialność pozioma ≈ Secchi |
| Zero widzialności | | 1,5 m (szukanie dotykiem na linie) | **szac.** |

Silnik ma dziś `widthM: 15` dla nurka, ok. 5x za dużo. Źródło: [Hańcza, Wikipedia](https://pl.wikipedia.org/wiki/Ha%C5%84cza_(jezioro)).

## Jak liczyć pokrycie komórki 100 m

Pokrycie (coverage) i prawdopodobieństwo wykrycia (POD):

```
C   = W_eff * L / A          L = długość śladu jednostki w komórce, A = 10 000 m2
W_eff = W[klasa] * noc * pogoda * (las / linia wzroku)
POD = 1 - exp(-C)            (krzywa wykładnicza, ostrożna; dla przeszukania w dzień dane bliżej "inverse cube", czyli lepiej)
POD łączne = 1 - exp(-suma C po minutach i jednostkach)
```

W trybie timeline co minutę: dla każdej jednostki bierzemy odcinek od pozycji w minucie t do t+1, liczymy długość jego części w każdej komórce i dodajemy `C` do sumy komórki. Dla drona i psa, gdzie W jest szersze niż komórka, prościej: pole śladu (prostokąt drona, stożek psa) przecięte z komórką, razy skuteczność, podzielone przez A.

Przykład, komórka w lesie, dzień:

- 1 ratownik przechodzi 100 m: C = 35 x 100 / 10 000 = 0,35, POD = 30%.
- Linia 4 osób (odstęp 25 m), każda 100 m: C = 35 x 400 / 10 000 = 1,4, POD = 75%.
- Ta sama linia w nocy, dobre czołówki: W = 35 x 0,34 = 12 m, C = 0,48, POD = 38%.
- Dron 80 m AGL nad lasem, jeden przelot 100 m: C = 12 x 100 / 10 000 = 0,12, POD = 11%. Na hali: C = 0,55, POD = 42%.
- Pies, zygzak 150 m w komórce, wiatr 3 m/s: C = 80 x 150 / 10 000 = 1,2, POD = 70%.

Po przeszukaniu prawdopodobieństwo w komórce aktualizujemy jak dotąd: POA_nowe = POA x (1 - POD), potem normalizacja.

## Linia wzroku z DEM

- Promień od obserwatora (teren + `observerHeightM`) do środka komórki + 0,3 m (leżąca osoba). Próbki DEM co 25 m; komórka zasłonięta, jeśli teren wystaje ponad promień.
- Wysokość obserwatora: pieszy 1,7 m, łódź 2 m, dron 80 m AGL, śmigłowiec 150 m AGL. Pies i nurek bez linii wzroku.
- Max zasięg: pieszy 200 m, dron 250 m, łódź 600 m, śmigłowiec 1000 m.
- Las z OSM: dla wzroku każde 100 m lasu na promieniu mnoży widoczność x0,1 (praktycznie blokuje). Dla termowizji z góry patrzymy pionowo, więc liczy się tylko las w komórce docelowej: x0,2 dron, x0,15 śmigłowiec.
- Pies: grzbiet wyższy o ponad 20 m od obu końców promienia blokuje zapach (**szac.**).

## Wizualizacja 2D

- **Pieszy**: wypełnione cieniowanie komórek widocznych z bieżącej pozycji (linia wzroku), intensywność wg odległości; wąski pas W wzdłuż przebytej trasy jako "przeszukane".
- **Pies**: stożek od psa w stronę, z której wieje wiatr, długość i kąt z tabeli `windCone`; przy ciszy małe koło 40 m. Strzałka wiatru obok.
- **Dron**: prostokąt śladu kamery (74 x 59 m przy 80 m AGL) obrócony zgodnie z kursem; ślad zostawia pas szerokości W. Przy kamerze pochylonej elipsa / trapez.
- **Śmigłowiec**: pas szerokości W wzdłuż trasy (300 m na otwartym), w lesie wyraźnie węższy kolor.
- **Łódź**: koło o promieniu W/2 wokół łodzi, ograniczone do wody.
- **Nurek**: wąska linia 3 m wzdłuż trasy pod wodą.
- Kolor komórki = łączne POD (0-95%), żeby było widać, że las "przeszukany" dronem wciąż jest prawie pusty.

## Czego nie wiemy / założenia

- Brak opublikowanych W dla kosodrzewiny, piargu, płyt i ścian. Wszystkie te wartości to **szac.**, oparte na najgęstszym lesie z tabel (kosodrzewina) i na terenie otwartym z przeszkodami (piarg).
- Brak otwartej tabeli W dla śmigłowca nad lądem (IAMSAR N-9 nie jest dostępna publicznie); 300 m to **szac.**, poprawki roślinności z IAMSAR N-10 przez źródło wtórne.
- Nie znaleźliśmy pomiaru ESW dla drona termowizyjnego; W drona wynika z geometrii kamery i kryterium Johnsona, nie z eksperymentu.
- Model wiatru dla psa jest jakościowy (podręcznik), a jedyne badanie statystyczne (Greatbatch 2015) nie potwierdza wpływu wiatru.
- Liczby z badań dotyczą głównie Ameryki Północnej; Tatry i Bieszczady mogą być gorsze (stromizny, kosodrzewina).
- Zakładamy osobę nieodpowiadającą i średnio widoczną; jaskrawa kurtka zwiększa W, ciemna zmniejsza.
- Krzywa wykładnicza POD jest ostrożna; w dzień dane pasują lepiej do krzywej "inverse cube" (wyższe POD przy tym samym C).
