# Pole widzenia i model wykrycia (tryb timeline)

Parametry dla każdego typu jednostki: jak szeroki pas terenu "naprawdę przeszukuje" w ciągu minuty. Wartości dla silnika (kontrakt Timeline, `rescue-fov/1`): [`rescue/scenarios/fov/fov-params.json`](../../rescue/scenarios/fov/fov-params.json), promień liczony jako radiusM = W / (pmax x sqrt(pi)). Pełne dane z badań (W dla każdego typu terenu, wiatr, fale, źródła): [`rescue/scenarios/fov/fov-research.json`](../../rescue/scenarios/fov/fov-research.json). Wszystkie liczby są ostrożne (raczej za małe niż za duże). Oznaczenie **szac.** = szacunek bez bezpośredniego źródła. To nie są procedury TOPR/GOPR/WOPR.

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

## Wagi śladów: wiarygodność i zanik w czasie

Silnik waży każdy ślad liczbą 0..1:

`waga = wiarygodność źródła x dokładność typu x zanik(t) x korroboracja`, gdzie `zanik(t) = 0,5^(t / T½)`, a `t` to wiek śladu w godzinach.

Wartości poniżej są **ilustracyjne** (do demo i kalibracji), oparte na publikacjach i materiałach szkoleniowych. To nie są procedury TOPR ani GOPR. Wartości bez bezpośredniego źródła oznaczono **szac.** Propozycja w formacie maszynowym: `rescue/scenarios/weights/clue-weights.proposal.json`.

### Tabela per typ śladu

| Typ śladu | Wiarygodność 0..1 | Dokładność lokalizacji | Połowiczny zanik T½ | Źródło / uzasadnienie |
|---|---|---|---|---|
| Trop psa tropiącego (mantrailer) | 0,5 | 50 m (kierunek wzdłuż tropu, nie punkt) | 24 h | Tabela wieku tropu: 90% sukcesu do 3 h, 70% po 12 h, 50% po 24 h, 25% po 48 h, 12% po 3 dniach [1]; krzywa 0,5^(t/24) trafia w te punkty. Harvey i Harvey 2003: weterani 96% na tropach 48 h, nowicjusze 53% [2]. Podwójnie ślepe badanie 2026: wybór właściwego tropu na starcie nie lepszy od losowego (9% trafień, 19% błędnej osoby) [3], stąd wiarygodność tylko 0,5. |
| Ślad psa terenowego (area / air-scent, alert) | 0,7 | 25-100 m (zasięg wiatru) | 2 h (**szac.**: zapach w powietrzu jest bieżący, osoba mogła się przemieścić) | Fałszywe alarmy psów średnio 3,4% (0-18%); wykrycie 82-99% na 25 m, 13-95% na 100 m zależnie od stabilności powietrza (Graham 1994 za [4]); ESW dla psów [5]. |
| Świadek naoczny | 0,6 | 200 m (**szac.**; godzina obserwacji +-30 min **szac.**) | 6 h (**szac.**: wartość spada z ruchem osoby, nie z pamięcią) | Błąd oceny odległości rośnie z dystansem i opóźnieniem relacji; rozpoznanie osoby wiarygodne do ok. 100 m [6][7]. |
| Zgłoszenie obywatela niezweryfikowane | 0,3 | 500 m (**szac.**) | 4 h (**szac.**) | Rozpoznanie nieznanej twarzy z apelu: tylko 6,7% poprawnych odpowiedzi [8]; wiele zgłoszeń po jednym apelu medialnym nie jest niezależnych. |
| GPS z telefonu (udostępniona pozycja) | 0,95 | 5-10 m otwarty teren, 7-12 m pod okapem lasu | 2 h (**szac.**, osoba w ruchu) / 12 h (**szac.**, osoba stoi lub ranna) | Smartfony pod okapem 6,7-11,5 m (z liśćmi), 4,5-6,7 m (bez liści) [9]. ISRID: kwartyle odległości od IPP i "godziny mobilności" per kategoria [10][11]; zamiast samego zaniku można też powiększać promień o ok. 1-2 km/h ruchu (**szac.**). |
| BTS / logowanie do stacji (Cell ID, TA) | 0,8 (że telefon był w zasięgu sektora) | 1-30 km na wsi, krok TA ok. 550 m | 3 h (**szac.**) | Cell ID: od metrów w mieście do 10-30 km na płaskim terenie i wodzie; komórki wiejskie 5-20 km; TA w krokach ok. 550 m [12]. W górach odbicia i zasięg przez dolinę mogą wskazać sektor po drugiej stronie grani (**szac.**). |
| AML (Advanced Mobile Location, 112) | 0,9 | 50 m w 90% przypadków, typowo 5-20 m | 2 h (**szac.**, jak GPS) | EENA: ok. 50 m w 90% przypadków, w UK średnio ok. 20 m, 90% lokalizacji w 30 s [13][14]. W Polsce AML wdraża UKE z CPPC, pełne uruchomienie planowane na 2027 [15][16]; do tego czasu w danych 112 przeważa lokalizacja sieciowa. |
| Ślady fizyczne: odcisk buta (śnieg, błoto) | 0,7 | 5 m (miejsce) plus kierunek ruchu | 12 h (**szac.**; błoto wolniej, mokry śnieg i deszcz szybciej) | Starzenie zależy od pogody, nie od samego czasu: słońce i deszcz zaokrąglają krawędzie, błoto starzeje się najwolniej [17][18]. |
| Ślady fizyczne: porzucony przedmiot | 0,6 (przedmiot mógł należeć do kogoś innego) | 5 m | 24 h (**szac.**: wskazuje, gdzie osoba była, nie gdzie jest) | Koester, Lost Person Behavior: przedmioty jako ślady kierunku ruchu [10]; wartości **szac.** |
| Detekcja z drona (termowizja, niezweryfikowana) | 0,5 | 10-20 m (GPS drona + rzut kamery, **szac.**) | 1 h (**szac.**) | Detektory termalne dają dużo fałszywych trafień (pnie, kamienie, zwierzęta) [19]; z tropieniem w kolejnych klatkach precyzja 90,3%, czułość 73,4% [20]. Po potwierdzeniu wzrokiem operatora traktować jak meldunek ratownika. |
| Meldunek ratownika (przeszkolony) | 0,9 | 20-50 m (**szac.**) | 6 h (**szac.**) | Przeszkolony obserwator, pozycja z GPS zespołu; **szac.** |
| Operator (wpis ręczny, decyzja KDR) | 1,0 | wg wpisu | bez zaniku (T½ = null) | Decyzja człowieka nadpisuje model; **szac.** |

### Pogoda a zapach (trop psa)

- Trop starzeje się szybciej w słońcu, upale, przy suchym powietrzu i silnym lub porywistym wietrze; wolniej w chłodzie, wilgoci i gęstej roślinności. W optymalnych warunkach psy szły po tropach do 2 tygodni, opisywane rekordy to ponad 200-300 h [21].
- Najlepsze warunki: wiatr 2,2-4,5 m/s, 0-18 °C, wilgotność powyżej 20%; konwekcja w południe psuje smugę zapachu [22][4].
- Badania są niespójne: część nie znajduje wpływu temperatury (0-25 °C) i wilgotności (18-90%) [23], Greatbatch 2015 nie potwierdza wpływu pogody na skuteczność [24].
- Propozycja (**szac.**): mnożnik T½ tropu: x0,5 przy upale powyżej 25 °C lub silnym słońcu, x0,5 po intensywnym deszczu, x0,7 przy wietrze powyżej 8 m/s, x1,5 przy chłodzie i wilgoci w lesie.

### Korroboracja: zgodne i sprzeczne ślady

- W teorii poszukiwań bayesowskich niezależne ślady mnożą wiarygodności (likelihood) w każdej komórce, a mapę POA normalizuje się po każdym śladzie [10][25]. Kluczowa jest **niezależność**: pięć zgłoszeń po tym samym apelu w mediach to jeden ślad, nie pięć.
- Praktyka SAR (Koester, NASAR): ślad ocenia się pod kątem spójności z profilem osoby i osią czasu; ślad sprzeczny z resztą obniża się, ale nie kasuje, dopóki go nie zweryfikowano [10].
- Reguła w silniku (**szac.**): dwa ślady z **różnych źródeł** w promieniu 500 m i zgodne czasowo (różnica wieku nie większa niż T½ krótszego) dostają po x1,25 (łącznie maks. x1,5, waga przycięta do 1). Ślad sprzeczny ze śladem o wyższej wadze (ten sam czas, odległość większa niż osoba mogła przejść przy ok. 3 km/h, **szac.**) dostaje x0,7. Ślad operatora zawsze wygrywa.

### Źródła

1. 3retrievers, "When to use a search dog" (tabela wieku tropu): http://www.3retrievers.com/when-to-use-a-search-dog.html
2. Harvey L.M., Harvey J.W. (2003), bloodhoundy na tropach 48 h, omówienie: https://bloodhoundsincorporated.com/research/
3. Initial trail selection in mantrailing dogs under double-blind field conditions (2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC13158615/
4. Lost Pet Research, "How Accurate are Search Dogs? Part 1: Area Detection Dogs" (przegląd, w tym Graham 1994): https://lostpetresearch.com/2018/09/how-accurate-are-search-dogs-part-1/
5. Chiacchia i in. (2015), Deriving Effective Sweep Width for Air-scent Dog Teams: https://doi.org/10.1016/j.wem.2014.10.004
6. Lindsay i in. (2008), How variations in distance affect eyewitness reports and identification accuracy: https://pubmed.ncbi.nlm.nih.gov/18253819/
7. Nyman i in. (2019), The distance threshold of reliable eyewitness identification: https://psycnet.apa.org/fulltext/2019-38765-001.pdf
8. "If you could just come forward": televised public appeals and missing persons (2025): https://www.tandfonline.com/doi/full/10.1080/22041451.2025.2531635
9. Evaluation of Positioning Accuracy of Smartphones under Different Canopy Openness, Forests 2022: https://doi.org/10.3390/f13101591
10. Koester R.J. (2008), Lost Person Behavior (ISRID): https://www.amazon.com/Lost-Person-Behavior-search-rescue/dp/1879471396
11. Sava i in. (2015), Evaluating Lost Person Behavior Models: http://geoinf.psu.edu/publications/2015_TransGIS_Search_Sava.pdf
12. EENA, Caller location in support of emergency services: https://eena.org/knowledge-hub/documents/caller-location-in-support-of-emergency-services-updated/
13. EENA, AML FAQ (2018): https://eena.org/wp-content/uploads/2018_12_11_AML_faq-1.pdf
14. EENA, AML in the United Kingdom: https://eena.org/knowledge-hub/documents/aml-in-the-united-kingdom/
15. UKE, Co zmieni AML?: https://www.uke.gov.pl/blog/co-zmieni-aml-szybkie-i-precyzyjne-lokalizowanie-osob-dzwoniacych-na-112-i-inne-numery-alarmowe,137.html
16. UKE, projekt AML: https://uke.gov.pl/projekty/aml/
17. Nature Mentor, How to tell if tracks are fresh: https://nature-mentor.com/how-to-tell-if-animal-tracks-are-fresh/
18. Offgridweb, Footprint Analysis 101: https://www.offgridweb.com/preparation/footprint-analysis-101-getting-a-foot-message/
19. Thermal human detection for Search and Rescue UAVs (2022): https://www.diva-portal.org/smash/get/diva2:1707781/FULLTEXT01.pdf
20. Enhancing Search and Rescue Missions with UAV Thermal Video Tracking, Remote Sensing 2025: https://doi.org/10.3390/rs17173032
21. Missing Animal Response Network, How long can scent survive?: https://www.missinganimalresponse.com/lost-pet-help/how-long-can-scent-survive/
22. What Makes Canine Search and Rescue Successful? (Animals 2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC12937267/
23. Success in the Natural Detection Task (Sci Rep 2024): https://www.nature.com/articles/s41598-024-62957-5
24. Greatbatch i in. (2015), Quantifying Search Dog Effectiveness: https://journals.sagepub.com/doi/10.1016/j.wem.2015.02.009
25. SARBayes, Bayesian methods for WiSAR: https://sarbayes.org/
