# Rescue Locator - wideo MP4 maks. 3:00 (vFINAL)

Nagranie ekranu z lektorem na produkcji. Baza: `../video/shotlist.md` (szkic `draft.mp4` 2:07 bez lektora, napisy `draft.srt`). Szkic można wgrać jako zapas, jeśli nie będzie czasu na nowe nagranie. Lektor czyta tekst z `pitch-3min.md`.

**Przygotowanie (5 min):**
- Chrome, okno 1440x900 albo pełny ekran 1920x1080, zoom 100%, "Nie przeszkadzać" włączone.
- Otwórz wszystkie URL-e niżej w kartach i poczekaj, aż się załadują (pierwsza mapa ok. 4-8 s). W karcie Zawrat kliknij raz 3D, poczekaj na teren, wróć do 2D. Kliknij "OK, rozumiem".
- Nie używamy klucza i nic nie zapisujemy: Zawrat w trybie Historia (`time=hist`), Czat w Historii to symulacja tylko na tym ekranie. Produkcja zostaje czysta.
- Nagrywanie: QuickTime (Plik > Nowe nagranie ekranu) albo OBS. 3D na laptopie jest płynne (w szkicu headless klatkowało).
- Baza URL: `https://rescue-locator.vercel.app`.

| # | Czas | URL | Kliknięcia | Lektor (skrót) |
|---|---|---|---|---|
| 0 | 0:00-0:12 | slajd 1 z `deck.pdf` albo `/app/start.html` | - | Hak: "Sobota, 17:40, mąż nie wrócił z Zawratu..." |
| 1 | 0:12-0:22 | `/app/start.html` | Pokaż dwie grupy: "Dla ratowników" i "Dla rodzin i turystów" | Dwa wejścia, jedna mapa |
| 2 | 0:22-0:40 | `/app/rodzina.html` | Przewiń do "Przygotuj zgłoszenie". Wpisz: Kto `Tomasz W.`, wiek `58`, gdzie `schronisko w Dolinie Pięciu Stawów`, kiedy `12:10`, trasa `na Zawrat i z powrotem, miał wrócić do 17:00`, ubiór `czerwona kurtka`. Kliknij **Gotowy tekst** | Rodzina: najpierw 112, potem gotowy tekst. Nic nie jest wysyłane |
| 3 | 0:40-1:05 | `/app/?sc=zawrat&role=operator&mode=akcja&time=hist&step=15&view=2d` | Wskaż panel top 3. Przełącz **3D** (7 s), wróć do **2D** | Kierownik akcji, 19:45, prawdziwy teren, top 3 = ok. 7% obszaru |
| 4 | 1:05-1:12 | to samo | Na osi czasu kliknij zdarzenie **19:35 Dron termowizyjny - nic** | Pusty przelot też jest informacją |
| 5 | 1:12-1:40 | to samo | **Czat**. Wpisz `Turystka widziała go o 14:35 na zakosach niebieskiego szlaku pod Zawratem, szedł w górę`, **➤**, poczekaj na kartę "Obserwacja osoby", **Dodaj (symulacja)**. S7 Żleb pod Zawratem idzie na #1. Zamknij szufladę | **Wow:** jedno zdanie, mapa przelicza się w niecałą sekundę |
| 6 | 1:40-2:05 | `/app/porownanie.html` | Poczekaj, aż "Dodaj relację" przełączy się sam (ok. 1,5 s po załadowaniu obu map). Przewiń do list top 3, potem do "Dlaczego mapa się przesunęła" i epilogu | **Liczba:** bez relacji pies po 95 min, z relacją dron po 12 min (fikcja) |
| 7 | 2:05-2:15 | `/app/?role=ratownik&sc=zawrat` (okno telefonu 390x780 albo prawdziwy telefon, Patrol TOPR A) | Zamknij podpowiedź "Wybierz swój zespół" | Ratownik: sektor, kierunek, meldunek jednym przyciskiem |
| 8 | 2:15-2:28 | `/app/centrum.html` | Wskaż karty akcji i pasek Doradcy; "Pokaż szczegóły" | Centrum: wszystkie akcje, wspólna pula zespołów, Doradca (fala na Sanie) |
| 9 | 2:28-2:40 | `/app/odprawa.html?sc=zawrat&t=19:45`, potem `&karty=1` | Powolne przewijanie A4 | Odprawa na jednej kartce, karty zadań dla zespołów |
| 10 | 2:40-2:55 | `/landing` albo slajd 10 | - | Uczciwie: dane fikcyjne, walidacja na symulacji, model w chmurze z regułami jako zapasem |
| 11 | 2:55-3:00 | karta końcowa | - | rescue-locator.vercel.app · github.com/syzygypl/hackyeah2026 |

**Uwagi:**
- W Historii o 19:45 top 3 liczy pokrycie śladami GPS (S4, S3, S6); w Na żywo i w Centrum jest S7, S4, S3. Nie obiecuj "S7 pierwszy" przed krokiem z Czatem.
- Procent przy sektorze nazywamy "wagą mapy", nigdy szansą.
- Wariant Smart City: zamień ujęcia 2-4 na `/app/?role=operator&mode=akcja&view=2d&sc=krakow-nowa-huta&time=live` i `/web/seen/`.
- Eksport: MP4 (H.264), maks. 3:00. Sprawdź długość przed wgraniem.
