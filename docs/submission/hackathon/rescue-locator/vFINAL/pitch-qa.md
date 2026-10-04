# Rescue Locator - 10 najtrudniejszych pytań jury (vFINAL, PL)

Krótko, uczciwie, bez liczb spoza repo. Pełniejsze odpowiedzi (EN): `docs/rescue-locator/pitch.md` "Likely judge questions" (po fact-checku `784c2cc`).

**1. Czy dane są prawdziwe?**
Nie. Osoby, wywiady, wskazówki, zespoły i miejsca znalezienia są fikcyjne (`rescue/scenarios/*.json`). Prędkości, POD i progi pogody są ilustracyjne. Prawdziwy jest teren (OSM + Copernicus DEM we wszystkich scenariuszach) i cała matematyka: fuzja, ranking po pustych przeszukaniach, planer, czytanie meldunków.

**2. Skąd wiecie, że to pomaga?**
Z symulacji, nie z prawdziwych akcji, i mówimy to wprost. 1000 symulowanych zaginięć w górach: właściwy sektor w top 3 w 66% przypadków, heurystyka eksperta 56%, od ostatniego punktu 43% (`rescue/eval/calibration/report-land.md`). Symulator i silnik pisała ta sama rodzina AI, więc to sprawdzenie spójności. Test na ślepo ma N = 2. Następny krok: backtest na zanonimizowanych dawnych akcjach GOPR/TOPR.

**3. 95 minut vs 12 minut to wasz wynik?**
To ilustracja na jednym fikcyjnym scenariuszu, policzona tym samym silnikiem bez relacji świadka i z nią (`/app/porownanie.html`). Pokazuje mechanizm, nie statystykę. Znana słabość: pole widzenia psa bez kierunku wiatru jest liczone jako pełne koło, co zawyża POD psa (`77bf9e4`); poprawka po hackathonie.

**4. "45%" przy sektorze to szansa, że on tam jest?**
Nie. To waga mapy. Ranking jest wiarygodny, ale procenty powyżej ok. 30% są zbyt pewne siebie (sektor "45%" trafiał w ok. 19% przypadków, `report-land.md`). Dlatego czytamy mapę jako kolejność szukania.

**5. RODO? Śledzicie ludzi?**
Nie śledzimy. Używamy tylko tego, co ratownicy już legalnie dostają: słowa rodziny, auto na parkingu, lokalizacja z 112, sygnał z aplikacji Ratunek wysłany przez samą osobę. Podstawa: art. 6 ust. 1 lit. d i art. 9 ust. 2 lit. c RODO (żywotne interesy) oraz ustawa z 2011 r. o ratownictwie w górach (`docs/rescue-locator/research.md`). Strona dla rodzin niczego nie wysyła. W pokazie nie ma żadnych danych osobowych. Nie mówimy "zgodne z RODO" - to ocena prawnika przy wdrożeniu.

**6. Dlaczego nie CalTopo / SARTopo albo IGT4SAR?**
CalTopo jest świetne w operacjach (przydziały, ślady, pierścienie), ale POA ustawia się tam ręcznie i nie łączy automatycznie planu, telefonu i pustych przeszukań. IGT4SAR wymaga ArcGIS i specjalisty GIS (`research.md`). My jesteśmy warstwą pierwszych godzin: fuzja wskazówek na terenie, po polsku, z telefonem ratownika i stroną dla rodziny. Możemy zasilać CalTopo, nie musimy go zastępować.

**7. Co jeśli model językowy nie działa albo się myli?**
Model (OpenAI, w chmurze) czyta tylko meldunki tekstowe. Gdy nie odpowiada, czytają je reguły (ok. 15 ms). Czat w przeglądarce działa w całości na regułach i zawsze pokazuje, co zrozumiał, zanim operator kliknie "Dodaj" (`docs/rescue-locator/czat.md`). Decyzję podejmuje człowiek. Pracy offline nie obiecujemy.

**8. Ile to kosztuje i jak wdrożyć?**
Kosztów wdrożenia nie liczyliśmy i nie podajemy liczby. Pokaz działa na Vercel (backend w Rust, fra1) z bazą Neon; jedno wywołanie modelu przypada na meldunek tekstowy. Wdrożenie: pilotaż z jedną grupą GOPR/TOPR na ćwiczeniach, licencja ISRID na statystyki zachowań, integracja z AML, gdy wejdzie w Polsce (ok. 2027, `research.md`), i ocena RODO.

**9. Czy to wytrzyma prawdziwą akcję (wydajność, wiele urządzeń)?**
Produkcja działa na Ruście: lista akcji z 34,3 s do 0,43 s (p50, `402802f`). Meldunek z telefonu jest u operatora po ok. 1-2 s, ZNALEZIONO w Centrum po ok. 7 s (`qa-demo-path.md`). Telefon odpytuje serwer co 15 s, więc przydział dociera po 10-15 s - to odpytywanie, nie wypychanie, i to jest do poprawy. Test zapisu: 17/17 PASS lokalnie na serwerze Swift i na serwerze Rust.

**10. Co jest najsłabsze?**
Planer zespołów. W teście na ślepo oba odnalezienia dała decyzja koordynatora, a w scenariuszu Zawrat planer nie jest lepszy od "największa waga najpierw" (15% vs 16% po 2 h, `rescue/README.md`). Jego wartość to czasy dojścia, uwagi bezpieczeństwa i szybkie przeplanowanie. Poza tym: pływak na jeziorze (lepiej szukać od miejsca wejścia do wody) i Bieszczady (ekspert ma niższą medianę obszaru).

## Rezerwowe (jedno zdanie)

- **Kto to zbudował i jak?** Zespół w 24 h, z Claude Code jako narzędziem do kodu, researchu i testów; pierwszy commit `rescue/` 2026-10-03 13:44.
- **Dlaczego Rust?** Port w nocy: silnik 11-240 ms zamiast 2-6 s (`6604627`); Swift został jako zapas lokalny.
- **Czy to działa na wodzie i w mieście?** Tak, ten sam silnik: dryf na Śniardwach (WOPR) i Kraków, Nowa Huta (senior z demencją). Oba scenariusze fikcyjne.
- **Analiza zdjęcia?** Tylko demo syntetyczne, zdjęcie wygenerowane z modelu terenu.
