# Zgłoszenie HackTribe - Rescue Locator (SMART CITY), v7

Wersja v7, 2026-10-04 06:40 (T+19.7h, po zamrożeniu funkcji), main i produkcja `aa6d8ce`. Supervisorem tematu 2 jest AI Andrzeja. Przygotowało AI Mateusza (agent hackathon-submission). **[UZUPEŁNIJ]** = potrzebny człowiek.

To wariant dla **SMART CITY**, z Krakowem na pierwszym planie. Ten sam produkt idzie też do DEFENCE (`../../rescue-locator/v7/`), z górami na pierwszym planie.

- **Zadanie:** zadanie otwarte SMART CITY, slug HackTribe `smart-city` (`docs/hackyeah-2026.md`).
- **Język:** polski.
- **Wymagane pola** (`docs/tasks/smart-city.txt` pkt 5): tytuł, nazwa zespołu, członkowie (1-6), opis, PDF z maksymalnie 10 slajdami.
- **MP4 (maks. 3 min):** przygotowujemy według decyzji zespołu; materiały wideo robi AI Michała. Regulamin Smart City w `docs/tasks/smart-city.txt` wymienia tylko PDF. Formularz HackTribe trzeba sprawdzić (checklista, punkt 1).
- **Kryteria:** pomysł 30%, związek z kategorią 20%, użyteczność 20%, design 20%, kompletność 10%. Prawa autorskie nie przechodzą na organizatora (pkt 14).
- **Kwestia otwarta:** organizator odradza zgłaszanie tego samego projektu do dwóch kategorii (`docs/summary-1230.md`, pytanie 2). Decyzja Mateusza: zgłaszamy oba warianty. Odpowiedź mentora warto mieć na piśmie (checklista, punkt 2).

**Zasada liczb:** podajemy ranking i przeszukany obszar. Procent przy segmencie to **waga mapy**, a nie szansa znalezienia.

## 1. Tytuł projektu

**Rescue Locator - gdzie szukać zaginionego seniora najpierw**

## 2. Nazwa zespołu / ID zespołu

**[UZUPEŁNIJ]**

## 3. Członkowie zespołu

**[UZUPEŁNIJ]**

## 4. Krótki opis (jeden akapit)

Starszy pan z demencją wychodzi z domu w Nowej Hucie w upale. Córka zgłasza zaginięcie po trzech godzinach. Rescue Locator łączy to, co miasto wie (słowa rodziny, sektor BTS, meldunek motorniczego MPK, zgłoszenia mieszkańców "Widziałem" z GPS, sprawdzone kwartały), w jedną mapę Krakowa, która mówi, gdzie szukać najpierw. Dyżurny prowadzi akcję na żywo. Patrole dostają sektory na telefon. Centrum widzi wszystkie akcje w mieście i regionie oraz wspólną pulę zespołów. Bez biometrii i bez śledzenia telefonów. W pokazie online zgłoszenia czyta model OpenAI, a bez modelu działają reguły.

## 5. Opis projektu (pełny)

### Problem

- **Skala:**
  - Policja notuje ok. 1700-2000 zaginięć osób 65+ rocznie, czyli kilka dziennie (policja.pl, dane 2019-2024).
  - Do 40% osób z demencją kiedyś się zgubi (Puls Medycyny).
  - Źródła i linki: `docs/rescue-locator/city-extension.md`.
- **Czas:** według badań Koestera (dbS Productions) wszyscy znalezieni w ciągu 24 h przeżyli, a po 24 h tylko 54%.
- **Dziś:** dyżurny ma w ręku słowa rodziny, kilka telefonów od mieszkańców i patrole. Nie ma jednej mapy, która to łączy.

### Rozwiązanie dla miasta

- **Mapa z fuzji wskazówek:** ten sam silnik co w górach.
  - Pierścienie Koestera dla demencji (Koester zaczynał badania od zaginięć osób z demencją).
  - Teren miejski z OSM: parki, zarośla, ogródki, Wisła, Zalew Nowohucki.
  - Korytarz do dawnego domu, sektor BTS, meldunki patroli.
- **Mieszkańcy jako czujniki:**
  - publiczna strona "Widziałem" z kartą osoby zaginionej (`/web/seen/`),
  - **Czat dla mieszkańców** (`/app/czat.html`): zdarzenie opisane zwykłym zdaniem, np. "widziałem go o 14:20 przy przystanku". Czat pokazuje, co zrozumiał, a mapa się przelicza,
  - **"Ktoś zaginął - co robić"** (`/app/rodzina.html`) dla rodziny: najpierw 112, potem lista pytań dyżurnego i gotowy tekst zgłoszenia (nic nie jest wysyłane),
  - zgłoszenie z GPS staje się punktem świadka (150 m) z godziną i mapa się przelicza,
  - fałszywe zgłoszenie zamyka patrol, który sprawdził miejsce.
- **Służby w jednym obrazie:**
  - patrole policji i straży miejskiej, pies, dron z termowizją,
  - zespoły dostają sektory na telefon i meldują zwykłym zdaniem.
- **Centrum:**
  - wszystkie bieżące akcje z top 3 każdej,
  - wspólna pula zespołów: zespół przeciąga się między akcjami,
  - **Doradca** jako wąski pasek, który nie zasłania mapy, przy wielu zgłoszeniach naraz: hipotezy wspólnej przyczyny (np. fala po awarii zapory na Sanie w ćwiczeniu z 7 akcjami), czas dojścia fali, proponowane działania (`35045fb`),
  - **Zasoby:** status, zdrowie i GPS każdego zespołu oraz karta zespołu z dziennikiem (`54b0204`).
- **Wagi zgłoszeń:** każde zgłoszenie ma wagę z wiarygodności, dokładności, starzenia się i potwierdzeń. Dyżurny może ją zmienić, a słabe zgłoszenia są na mapie mniejsze i bledsze (`bd88de5`, `08f5029`). To ważne przy zgłoszeniach od mieszkańców.
- **Odprawa (druk):** jedna kartka A4 dla dowodzącego oraz karty zadań dla patroli (`/app/odprawa.html`).
- **Analiza zdjęcia (narzędzie):** EXIF GPS albo dopasowanie linii horyzontu do modelu terenu (`1250eb7`). Demo jest syntetyczne, na terenie górskim, nie miejskim.
  - akcje bieżące i zakończone są rozdzielone.
- **Prywatność:**
  - bez rozpoznawania twarzy i bez skanowania telefonów,
  - zgłoszenia mieszkańców są dobrowolne,
  - dane w demo są fikcyjne.

### Demo: Kraków, Nowa Huta (scenariusz fikcyjny `krakow-nowa-huta.json`)

1. 16:30. Córka zgłasza: Józef K. (osoba fikcyjna), 81 lat, demencja, wyszedł z os. Centrum C. Upał 33°C.
2. Mapa łączy pierścienie dla demencji, korytarz do dawnego domu w Mogile i sektor BTS Mogiła (450 m).
3. Motorniczy MPK widział go przy Klasztornej. Zgłoszenie z Parku Lotników okazuje się fałszywe i zamyka je patrol.
4. 18:40: pies tropiący znajduje go w zaroślach przy rowie na Łąkach Nowohuckich.
5. **Liczba z tego scenariusza:** przed znalezieniem trzeba przejrzeć 4,8% obszaru zamiast 24,5% przy samych pierścieniach. Segment znalezienia jest #4 vs #9 (`docs/rescue-locator/city-extension.md`). To scenariusz napisany przez nas, więc to ilustracja, nie dowód.

### Na żywo między urządzeniami

- **Akcja na żywo między urządzeniami, czasy z produkcji:** serwer Rust `545fe02`, pomiar AI Marcina o 04:59, `docs/rescue-locator/demo-runbook.md` (`fa87d1e`). Operator, Centrum i telefon są otwarte naraz.
  - meldunek z telefonu jest u operatora po ok. 1-2 s,
  - "Potwierdź wszystkie" daje "Wszystko potwierdzone" po 0,5 s,
  - ZNALEZIONO trafia do Centrum po ok. 7 s, a do operatora od razu,
  - najdłużej czeka telefon, który odpytuje serwer co 15 s: przydział dociera po ok. 10-15 s, potwierdzenie i "Akcja zakończona" po ok. 20-25 s.

  Zmiany nie są wypychane, każdy klient sam odpytuje serwer. Runbook ma gotowe zdania na czas oczekiwania na telefon. Ścieżki zapisu sprawdza też test `rescue/integration/test_live_multi_ui.py` (17/17 PASS, lokalnie, na serwerze Swift).
- **Czat:** po "Dodaj" nowa mapa jest po ok. 0,9 s. Mapa 2D aktualizuje się w miejscu, bez pustego ekranu. Przykładowe zdania są dobrane do scenariusza (`docs/rescue-locator/czat.md`).

### Czy to pomaga? Symulowane przypadki

**To symulacja, nie prawdziwe akcje.** Przypadki są z gór i z wody. Miejskiego zestawu jeszcze nie ma.

| Góry, 1000 przypadków | Top 3 | Obszar dla 90% osób |
|---|---|---|
| **Mapa (silnik)** | **66%** | **29%** |
| Heurystyka eksperta | 56% | 37% |
| Od ostatniego znanego punktu | 43% | 68% |

- Kategoria "demencja" w tym zestawie: top 3 w 76%, mediana obszaru 4,5% (`report-land.md`).
- Woda, 600 przypadków: top 3 w 91% vs 81%.

### Gdzie to stoi w mieście

- Na produkcji (Vercel) działa Centrum, akcje na żywo z ciągłą osią czasu (1x-30x), telefony patroli i strona "Widziałem". Status każdej funkcji: https://rescue-locator.vercel.app/landing
- W planie:
  - miejskie profile zespołów (radiowóz, straż miejska, wolontariusze),
  - lokalny alert do mieszkańców w promieniu wskazanym przez mapę,
  - lista kamer monitoringu do sprawdzenia przez człowieka (bez biometrii),
  - dane po akcjach do profilaktyki: opaski GPS, szkolenia motorniczych.

## 6. Linki

- **Demo online, Kraków:** https://rescue-locator.vercel.app/app/?role=operator&mode=akcja&view=2d&sc=krakow-nowa-huta&time=live (strona startowa: https://rescue-locator.vercel.app)
- **Strona "Widziałem" dla mieszkańców:** https://rescue-locator.vercel.app/web/seen/
- **Pokaz w 90 sekund (scenariusz górski):** https://rescue-locator.vercel.app/app/?sc=zawrat&role=operator&time=hist&tour=1
- **Repozytorium:** https://github.com/syzygypl/hackyeah2026
- **Uruchomienie lokalne:** `bash docs/submission/hackathon/rescue-locator-smartcity/v7/start.sh`
- **Wideo MP4 (maks. 3 min):** szkic 2:07 jest gotowy (`docs/submission/hackathon/rescue-locator/video/draft.mp4`, `7dcb415`), ale zaczyna się od gór. Wersja z Krakowem na pierwszym planie i lektorem: **[UZUPEŁNIJ: AI Michała]**
- **Prezentacja PDF:** **[UZUPEŁNIJ: eksport `docs/submission/hackathon/rescue-locator-smartcity/v7/deck.html`]**

## 7. Co jest zamockowane

- **Fikcyjne:** osoby, zgłoszenia, zespoły, wywiady.
- **Ilustracyjne:** progi i prędkości.
- **Symulowane:** przypadki walidacyjne (z gór i z wody).
- **Prawdziwe:**
  - teren Krakowa z OSM + DEM i mapa podkładowa Krakowa (PMTiles),
  - silnik, Centrum, telefony, strona "Widziałem",
  - parsowanie zgłoszeń z GPS.

## 8. Ograniczenia

- Kraków to jeden scenariusz napisany przez nas.
- Fałszywe zgłoszenie, którego nie zamknie patrol, ciągnie mapę do parku. Dlatego zgłoszenia mają wagę, a patrol je potwierdza.
- Liczby Koestera są amerykańskie i przybliżone.
- Procenty POA to waga mapy, nie szansa.
- Model językowy: pokaz online używa modelu OpenAI w chmurze. Nie deklarujemy pracy offline.
- Analiza zdjęcia sprawdzona tylko na syntetycznym zdjęciu górskim.

## 9. Użycie AI i komponenty zewnętrzne

- Zbudowane w trakcie HackYeah 2026 (pierwszy commit `rescue/` o 13:44).
- **Narzędzia AI:** Claude Code (Anthropic).
- **Modele:** w pokazie online model OpenAI przez API, z regułami jako zapasem. Kod obsługuje też lokalny model w Ollama, ale pokaz go nie używa.
- **Hosting:** Vercel (backend w Rust, region fra1) i Neon (fra1).
- **Dane:** © OpenStreetMap contributors (ODbL), Protomaps, Copernicus DEM GLO-30 (© DLR, © Airbus DS; Copernicus, UE, ESA), Sentinel-2 cloudless 2016 by EOX (CC BY 4.0), kwantyle Koestera / ISRID (dbS Productions).
- **Biblioteki:** MapLibre GL JS, pmtiles, three.js.

## 10. Licencja i IP

- Smart City nie przenosi praw autorskich (`docs/tasks/smart-city.txt` pkt 14).
- **[UZUPEŁNIJ]** Plik LICENSE.
- **Zgoda pracodawcy (czerwone):** jak w wariancie DEFENCE. Do tego czasu bez nazwy firmy.
