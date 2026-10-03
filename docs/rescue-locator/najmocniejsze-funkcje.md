# Rescue Locator - najmocniejsze funkcje (analiza dla jury i demo)

Stan: 2026-10-03, main `20ded40`. Zadanie: DEFENCE (otwarte, "crisis response"), kryteria: pomysł i innowacja 30%, związek z kategorią 20%, użyteczność 20%, design 20%, kompletność 10% (`docs/rules/defence.txt`; Smart City ma te same wagi). Demo: https://rescue-locator.vercel.app/app/. Liczby to **symulacje, nie prawdziwe akcje** - mówimy to raz, wprost.

Skróty kryteriów: **I** innowacja, **K** kategoria, **U** użyteczność, **D** design, **C** kompletność.

## Ranking funkcji

### 1. Mapa prawdopodobieństwa z fuzji wskazówek (ranking sektorów)
- **Co to jest:** kierownik akcji wpisuje okruchy (świadek, sektor BTS, auto na parkingu, plan trasy, pogoda), a mapa od razu mówi, które sektory przeszukać najpierw.
- **Dlaczego mocne:** I (pierścienie Koestera x teren OSM + DEM x dowody w jednym rachunku Bayesa, CalTopo robi to ręcznie), K (dosłownie "niepełna informacja, mało zasobów"), U (wynik to kolejność przeszukiwania, nie wykres).
- **Twarde dowody:** 1000 symulowanych przypadków w 5 pasmach: top 3 **66%** vs heurystyka eksperta 56% vs naiwnie od ostatniego punktu 43%; obszar do znalezienia p50 **5,5%** vs 6,4% vs 22,6%, p90 29% vs 37% vs 68% (`rescue/eval/calibration/report-land.md`). Z jedną fałszywą wskazówką (n = 249) top 3 59% vs ekspert 49%.
- **Demo (20 s):** Akcja, scenariusz Zawrat, przewiń oś czasu przez wskazówki; wyłącz jedną i pokaż, co wnosiła.
- **Słabość:** procenty POA są przesadnie pewne (sektor "45%" trafia w ~19%, Brier 0,81). Cytujemy tylko ranking i obszar. Symulator i silnik napisała ta sama rodzina AI - to test spójności, nie walidacja. W Bieszczadach ekspert ma niższą medianę obszaru (4,7% vs 5,7%).

### 2. Puste przeszukanie to też informacja (przeliczenie po meldunku)
- **Co to jest:** gdy patrol lub dron wraca z "nic", prawdopodobieństwo spływa z tego sektora do innych, a plan sam się przelicza.
- **Dlaczego mocne:** I (najmocniejszy "wow": negatywny dowód z POD jako aktualizacja Bayesa), U (tak działa prawdziwa akcja: większość meldunków to "pusto").
- **Twarde dowody:** Zawrat o 19:45: miejsce znalezienia **#1** po fuzji vs **#20** na samych pierścieniach, **0,07%** obszaru vs **34,3%** (`rescue/README.md`). To scenariusz napisany przez nas - ilustracja, nie liczba wartości.
- **Demo (25 s):** oś czasu 19:00-20:03: kolejne sektory puste, Żleb pod Zawratem wskakuje na #1, śmigłowiec wysłany, "ZNALEZIONO".
- **Słabość:** scenariusz autorski. W teście na ślepo (N = 2) sama mapa raz pomogła (blind-01: 4,1% obszaru vs 32,3% naiwnie), raz nie (blind-02: 37,4% vs 35,7%) (`rescue/blindtest/blind-0*-result.md`).

### 3. Pętla terenowa na żywo: telefon ratownika + meldunek tekstem + ACK
- **Co to jest:** ratownik skanuje QR, ma jeden ekran z sektorem, kierunkiem i odległością z GPS, wysyła meldunek zwykłym zdaniem ("S6 pusto, widoczność 50 m"), operator widzi go w kanale LIVE i potwierdza.
- **Dlaczego mocne:** U (zero nowego procesu, działa offline jako PWA z kolejką), K (koordynacja i wymiana informacji w kryzysie), D (duże przyciski, jasny/ciemny), C (prawdziwy backend na Vercel + Neon).
- **Twarde dowody:** lokalny model qwen3 4B: **1,3-1,7 s** na meldunek, reguły awaryjne ~15 ms (`rescue/README.md`); testy integracyjne 46/47 pass (`rescue/integration/report.md`); idempotentne POST /report, osobny klucz terenowy.
- **Demo (30 s):** telefon na scenie, QR z "Udostępnij", meldunek "pusto", na laptopie wpis w LIVE, mapa się zmienia, ACK wraca na telefon.
- **Słabość:** na Vercel parsuje OpenAI, offline tylko na laptopie z Ollamą; zależność od sieci w hali (plan B: dane komórkowe).

### 4. Centrum - wiele akcji naraz i wspólna pula zespołów
- **Co to jest:** jedna mapa wszystkich bieżących akcji z kartami i top 3, zespół przeciągasz na akcję; znalezienie kończy akcję i zwalnia zespoły.
- **Dlaczego mocne:** K (ograniczone zasoby między incydentami - realny problem centrali GOPR/TOPR/WOPR), I (mało kto to pokazuje na hackathonie), C (11 incydentów, 18 zespołów).
- **Twarde dowody:** testy multi-incident **21/21 pass** (`rescue/integration/report-multi.md`); stan akcji zakończonych współdzielony między instancjami (Neon).
- **Demo (20 s):** Centrum, przeciągnij zespół z Kasprowego na Morskie Oko, pokaż kartę "zakończona" po znalezieniu.
- **Słabość:** brak priorytetyzacji między akcjami (kto decyduje, gdzie zespół jest bardziej potrzebny) - to robi człowiek.

### 5. Poza górami: woda (dryf) i miasto (senior z demencją w Krakowie + "Widziałem")
- **Co to jest:** ten sam silnik dla łodzi i dryfu na jeziorze/morzu oraz dla zaginionego seniora w upale w Nowej Hucie, z publiczną stroną "Widziałem" dla mieszkańców.
- **Dlaczego mocne:** K (WOPR z zadania, Smart City), I (jeden silnik, nowe przypadki bez przepisywania), U (zgłoszenie obywatela trafia jako dowód).
- **Twarde dowody:** woda, 600 przypadków: top 3 **91%** vs 81%, p90 obszaru **5,9%** vs 11,4% (`rescue/eval/calibration/WATER.md`). Kraków: **4,8%** obszaru vs 24,5% na pierścieniach, sektor #4 vs #9 (`docs/rescue-locator/city-extension.md`). Koester: znalezieni w 24 h przeżywają, po 24 h tylko 54%.
- **Demo (20 s):** przełącz scenariusz na Śniardwy (dryf łodzi), potem Kraków; na telefonie otwórz "Widziałem" i wyślij zgłoszenie.
- **Słabość:** dla pływaka na jeziorze silnik jest gorszy niż szukanie od miejsca wejścia (Śniardwy 11 lepiej / 47 gorzej). Dryf częściowo "sam siebie sprawdza" (te same tabele leeway w symulatorze i silniku). Kraków to jeden scenariusz autorski; fałszywe zgłoszenie ciągnie mapę do parku (52%).

### 6. Prawdziwy teren, 2D/3D i mapy offline
- **Co to jest:** mapa papierowa i widok 3D na prawdziwym terenie (OSM + Copernicus DEM, Sentinel-2), działające bez internetu.
- **Dlaczego mocne:** D (najładniejszy ekran projektu), U (offline: 8 regionalnych PMTiles + cieniowanie rzeźby dla 10 scenariuszy, `rescue/web/basemap/`).
- **Dowody:** pliki w `rescue/web/basemap/*.pmtiles`, `hillshade/`; 3D: cienie, mgła, roślinność po gatunkach.
- **Demo (10 s):** przełącz 2D -> 3D na Zawracie, obrót kamery nad żlebem.
- **Słabość:** 3D jest ciężkie na słabym laptopie/projektorze; to "ładne", nie "mądre" - nie może zjeść czasu demo.

### 7. Test na ślepo z zobowiązaniem SHA-256
- **Co to jest:** AI chowa osobę, publikuje hash miejsca przed startem, my szukamy aplikacją, potem hash jest otwierany.
- **Dlaczego mocne:** C i wiarygodność - pokazujemy porażki obok sukcesów, nikt nie przesunął celu po fakcie.
- **Dowody:** 2/2 znalezione (`rescue/blindtest/`), ale oba razy przez decyzję koordynatora AI wbrew planerowi.
- **Demo:** tylko slajd lub odpowiedź na pytanie jury, nie na żywo.
- **Słabość:** N = 2; funkcje `--features all` powstały po zobaczeniu rundy 2.

### 8. Przycisk "Nowa akcja"
- **Co to jest:** kto, gdzie, kiedy - i mapa liczy się od razu w dowolnym miejscu Polski.
- **Dlaczego mocne:** U (pokazuje, że to narzędzie, a nie nagrany film).
- **Słabość:** poza przygotowanymi regionami teren jest płaski, siatka 5 x 5 - nie zostawiać na tym ekranie.

## Top 5 do pitchu

1. Mapa z fuzji wskazówek: top 3 66% vs ekspert 56% vs naiwnie 43% (1000 przypadków).
2. Puste przeszukanie to informacja: Żleb #20 -> #1, helikopter, "ZNALEZIONO" (wow).
3. Telefon ratownika + meldunek zwykłym zdaniem w 1,3-1,7 s, LIVE i ACK.
4. Centrum: wiele akcji, wspólna pula zespołów.
5. Ten sam silnik na wodzie (p90 5,9% vs 11,4%) i w mieście (Kraków 4,8% vs 24,5%, "Widziałem").

## Proponowana kolejność demo (3 min)

| Czas | Co | Kryterium |
|---|---|---|
| 0:00-0:20 | Problem: 17:40, telefon żony, mgła, okruchy informacji | K |
| 0:20-0:50 | Zawrat: wskazówki wpadają, mapa się przelicza, top 3 sektory (#1) | I, D |
| 0:50-1:20 | Puste sektory, Żleb na #1, śmigłowiec, ZNALEZIONO (#2) | I |
| 1:20-1:55 | Telefon z QR: meldunek "pusto" tekstem, LIVE, ACK (#3) | U, C |
| 1:55-2:15 | Centrum: drugi incydent, przeciągnięcie zespołu (#4) | K, U |
| 2:15-2:35 | Śniardwy i Kraków + "Widziałem" (#5), mignięcie 3D | K, D |
| 2:35-3:00 | Liczby z kalibracji + uczciwe granice (symulacja, POA to ranking, planer najsłabszy) | C |

## Czego NIE pokazywać

1. **Planer jako "sam znajduje szybciej".** Sam planer w blind-01 znalazłby po 180 min zamiast 35, w blind-02 wcale (brak pamięci przeszukanych sektorów); w Zawracie 20% szansy w 1 h 46 min vs 2 h 00 min naiwnie. Pokazujemy go tylko jako ETA + bramki bezpieczeństwa (`docs/rescue-locator/pitch.md`).
2. **Procenty POA na sektorach i wykres kalibracji w trybie Walidacja.** Jury przeczyta "45%" jako szansę, a to ~19%. Mówimy "top 3" i "% obszaru", nie pokazujemy diagramu niezawodności na żywo.
3. **Ocena sytuacji przez LLM i monitoring (Prometheus/Grafana).** Ocena LLM na lokalnym modelu trwała 17-40 s, a przy obciążonej Ollamie kończyła się timeoutem 120 s (`rescue/README.md`); Grafana wymaga Dockera i niczego nie dodaje do kryteriów. Wspomnieć jednym zdaniem przy kompletności, nie klikać.
