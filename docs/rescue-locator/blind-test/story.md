# Test na ślepo - historia do materiałów

Materiał marketingowy na podstawie [`log.md`](log.md). Wszystko, co zależy od wyników, jest oznaczone **(po odsłonięciu)** i zostaje puste do końca serii. Nie wpisujemy wyników, których nie ma.

## Oś narracji: próbowaliśmy oszukać samych siebie, a potem przestaliśmy

1. **Mieliśmy piękne liczby.** Backtest: miejsce odnalezienia w top 3 we wszystkich scenariuszach, średnio poniżej 1% obszaru do przeszukania zamiast około 18%. (Po przeliczeniu na prawdziwym terenie: 1,73% wobec 15,2%, N = 3.)
2. **Ktoś z zespołu powiedział "sprawdzam".** O 14:35 AI Marcina zauważyło dwie rzeczy. Każdy scenariusz kończył się pingiem GPS, więc człowieka znajdował GPS, a nie mapa. A scenariusze pisali ci, którzy znali odpowiedź.
3. **Przyjęliśmy to w minutę.** O 14:36 wszystkie liczby w prezentacji dostały etykietę "tymczasowe - do czasu testu na ślepo". Ping GPS przestał być zakończeniem demo.
4. **Gra w chowanego.** Jedno AI chowa zaginionego i zapisuje miejsce jako hash SHA-256. My szukamy samą aplikacją. Sędzia (to samo AI) odpowiada na każdy patrol tak, jak odpowiedziałby teren: nic, ślad albo znaleziony.
5. **Wynik serii, z porażkami (po odsłonięciu).**
6. **Runda 1.** blind-01: znaleziona w 3. fali (12 przydziałów). Zadecydował agent-szukający AI, który ręcznie zastosował zasadę Koestera IPP = ostatni pewny punkt (świadek 13:40), której zamrożony silnik jeszcze nie miał; planer sam wysłałby drona nad S3. Wniosek: poprawka #1 trafia do silnika i sprawdzamy ją w blind-02/03. S12 miał wcześniej dwa przejścia we mgle (POD 0,45 każde), które jej nie znalazły: realistyczny POD poniżej 1. Potwierdzenie hasha i metryki (po odsłonięciu).

Dlaczego to działa w pitchu: jury słyszy liczby co pięć minut. Rzadko słyszy, jak zespół je sam podważył i zbudował test, którego nie da się nagiąć.

## Posty

### 1. LinkedIn (PL), przed wynikami

> Na hackathonie zbudowaliśmy narzędzie, które podpowiada ratownikom górskim, gdzie szukać zaginionego najpierw. Pierwsze liczby wyglądały świetnie.
>
> Potem nasz własny zespół zauważył problem: w każdym scenariuszu człowieka znajdował na końcu sygnał GPS, a nie nasza mapa. I scenariusze pisaliśmy my, znając odpowiedź.
>
> Więc oznaczyliśmy wszystkie liczby jako tymczasowe i zrobiliśmy test na ślepo. Jedno AI chowa zaginionego i zapisuje miejsce jako hash SHA-256, zanim zaczniemy. My szukamy tylko aplikacją. Na koniec hash pokaże, czy nikt nie przesunął celu.
>
> Wyniki opublikujemy wszystkie, także porażki. #HackYeah2026

### 2. X (EN)

> Our search-and-rescue map looked great on paper. Then a teammate pointed out every scenario ended with a GPS ping, and we wrote the scenarios ourselves. So we marked every number provisional and started a blind test: one AI hides the missing person behind a SHA-256 commitment, we search with the app only. Results incl. failures soon. #HackYeah2026

### 3. LinkedIn (PL), po wynikach (po odsłonięciu)

> Wynik testu na ślepo: **(po odsłonięciu)** z **(po odsłonięciu)** rund znalezionych (runda 1: znaleziona w 3. fali; zadecydował agent-szukający AI, stosując ręcznie zasadę Koestera, której silnik jeszcze nie miał), średnio po **(po odsłonięciu)** patrolach. Miejsce ukrycia sprawdzone hashem SHA-256 w każdej rundzie.
>
> Co nie zadziałało: **(po odsłonięciu)**.
>
> Te liczby zastąpiły w naszej prezentacji wszystkie wcześniejsze. #HackYeah2026

## Blurb do studium przypadku (60 słów)

> Rescue Locator łączy niepewne wskazówki (plan wycieczki, auto na parkingu, sektor 112, puste przeszukania) w mapę prawdopodobieństwa dla ratowników górskich. Gdy okazało się, że nasze scenariusze kończyły się pingiem GPS i znaliśmy w nich odpowiedź, unieważniliśmy własne liczby. Zastąpił je test na ślepo: ukryty cel zapisany hashem SHA-256, szukanie wyłącznie aplikacją, wyniki z porażkami **(po odsłonięciu)**.

## Cytaty z wątku

Dosłownie z wątku "HackYeah 2026 - temat 2", 3 października 2026.

> "Dramatyczne zakończenie robi GPS, nie nasz silnik."
> - AI Marcina, 14:35

> "Do tego scenariusze pisali autorzy, którzy znali odpowiedź, więc miejsca odnalezienia i seedy siedzą tam, gdzie silnik i tak by patrzył. To nie dowodzi, że aplikacja działa."
> - AI Marcina, 14:35

> "Słuszna diagnoza, wchodzimy w całości. [...] do pitchu idzie wynik blind (także porażki)."
> - AI Mateusza, 14:36

## Slajd: "Jak sprawdziliśmy, że to działa"

Jeden slajd w decku (wariant: slajd 8 obok liczby wartości).

- **Tytuł:** Jak sprawdziliśmy, że to działa
- **Lewa kolumna, "Najpierw się pomyliliśmy":** scenariusze kończyły się pingiem GPS, pisali je autorzy znający odpowiedź. Liczby oznaczone jako tymczasowe o 14:36.
- **Środek, "Gra w chowanego" (schemat 4 kroków):** chowający publikuje hash SHA-256 → my szukamy samą aplikacją → sędzia odpowiada na patrole (nic / ślad / znaleziony) → odsłonięcie i sprawdzenie hasha.
- **Prawa kolumna, "Wynik serii":** tabela rund: znaleziony, patrole, ranga, procent obszaru **(po odsłonięciu)**. Porażki w tej samej tabeli.
- **Stopka:** "Pełny dziennik: docs/rescue-locator/blind-test/log.md".
