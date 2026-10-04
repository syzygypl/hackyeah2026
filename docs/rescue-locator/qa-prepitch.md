# QA przed pitchem (16:00) - produkcja, 2026-10-04 ok. 14:50-15:25

Przeglad tylko do odczytu (GET; bez zapisow na produkcji), headless Chrome 1440x900 i 390x844, https://rescue-locator.vercel.app.
Autor: AI Mateusza #1. Zrzuty: lokalnie u AI Mateusza #1 (scratchpad/prodreview-1440/s/), na zyczenie.

**Wersja produkcji:** w trakcie przegladu produkcja zmieniala sie kilka razy (/version.json: d85ea68 -> 80b7d9c -> ... -> bf91dff;
stopki stron: e336557, 800fefd, 015d585, 4e49187, 9e7bce6). Liczba akcji w Centrum 17 -> 20 (API 18 -> 21).

**Siec vs bledy:** Wi-Fi na sali jest waskim gardlem (TTFB plikow z cache Vercel 1,7-3,7 s, google.com 2-3,2 s, /version.json 0,56 s;
load 0,3-7 s, zmienny miedzy powtorzeniami). Nie znaleziono wolnosci po stronie serwera.

## Bledy (od najwazniejszych)

| # | Waga | Gdzie | Co | Jak odtworzyc | Wlasciciel |
|---|---|---|---|---|---|
| 1 | widoczne, wazne dla demo | /app zawrat 19:45 | #3 sektor rozny: Historia S7/S4/**S10 Kozi Wierch** (z pokryciem), Na zywo S7/S4/**S3 Schronisko**; Centrum, /api/incidents, Odprawa, Czat ida za live (S3). 80b7d9c mowi, ze sie zgadzaja - na produkcji nie. Przyczyna: app.js renderPanels - Historia ranking z tlSegments (z pokryciem), live z step.segments; surowe POA S3 0,105 vs S10 0,103 | `/app/?sc=zawrat&role=operator&time=hist&step=15` vs `&time=live` | my (2D/app.js) |
| 2 | ryzyko demo | produkcja | deploy co kilka minut; jedno wejscie `?sc=rodzina-dziecko-las&time=live` puste po 10 s (szara mapa, "Gdzie szukac najpierw: -"), 3 kolejne OK - rollover deployu albo Wi-Fi. Zalecenie: zamrozic deploy na dlugo przed 16:00 | j.w. | AI Andrzeja (deploy) |
| 3 | widoczne | Centrum | jedyna akcja LIVE to bieszczady-wetlinska (seq 50, ost. zdarzenie 20:42, endedAt 20:35 wczesniej niz ostatnie zdarzenie); zawrat = ODTWORZENIE; start: "1 na zywo". Jesli pitch zaczyna w Centrum od zawratu na zywo - nie bedzie | /app/centrum.html | my (Centrum) / decyzja o resecie produkcji |
| 4 | widoczne | Centrum, API, lista scen. | literowka "Bialy szwal" (ma byc "szkwal") | rescue/scenarios/sniardwy.json l.2 | AI Marcina |
| 5 | widoczne | 2D | etykiety nachodza: 1440 Historia 20:03 "Smiglowiec TOPR" na "#1 Zleb pod Zawratem"; 390 "Tomasz W." na "#2 Wielki Staw", "Dron termowizyjny" uciety z lewej; rodzina 390 - stos etykiet, duzo pustej mapy | zawrat hist/live, rodzina live 390 | my (web 2D) |
| 6 | kosmetyka (jury moze zobaczyc) | 2D | hover komorki: "0,00% POA komorki (25, 49)" - goly % i zargon, wbrew zasadzie miejsce + % obszaru | zawrat 1440, najechac na mape | my (web 2D) |
| 7 | kosmetyka | API | duplikat: morzycko i tragedia-w-moryniu (to samo miejsce i czasy); UI ukrywa morzycko (aa6d8ce) -> Centrum 20, API 21 | /api/incidents | AI Marcina |
| 8 | kosmetyka | /app/start.html | akapit po angielsku "Where to search first: a search-planning tool..." na polskiej stronie | start.html | AI Marcina |
| 9 | kosmetyka | Odprawa | kropka dziesietna "5.5 h od ostatniego kontaktu" (reszta aplikacji: przecinek) | odprawa.html?sc=zawrat, blok Pogoda | wlasciciel Odprawy |
| 10 | kosmetyka | 2D 1440 | legenda zawija "pozycji"; skala (500 m / 1 km) ciemna, prawie nieczytelna; atrybucja OSM w srodku mapy (x ok. 805-1068); cos uciete pod dockiem w prawym dolnym rogu ("Powiewy...") | zawrat 1440 | my |
| 11 | kosmetyka | prawy panel (hover) | notka Na zywo ucieta ("...dzialaja tylko na") | /app 1440, najechac na prawy panel | my |
| 12 | info | /app | pierwsze uruchomienie: podpowiedz "Wybierz scenariusz u gory..." zaslania lewy gorny rog 2D/3D; `/app/` najpierw pyta "Kim jestes w tej akcji?" - przed pitchem zamknac na komputerze demo albo uzyc `?role=operator` | swieza przegladarka | prezenter |
| 13 | kosmetyka | Czat 1440 | chip "Auto" na mapie (prawy gorny rog) uciety pod naglowkiem | /app/czat.html | wlasciciel Czatu (AI Andrzeja) |
| 14 | do sprawdzenia recznie | 3D | fps w headless SwiftShader ok. 1 (programowe renderowanie - nic nie mowi o prawdziwym GPU); auta i pojazdy w prawdziwej skali sa na widoku ogolnym mniejsze niz piksel (zamierzone, app3d.js ok. l.1206); `?zoom=` ignorowany - nie sprawdzono, czy modele nie wisza w powietrzu. Szybki rzut oka na prawdziwym GPU | /app/3d | AI Andrzeja |
| 15 | kosmetyka | Centrum | etykieta "Sanok ~09:42" na chipie "Zapora w Solinie" (obie szerokosci) | /app/centrum.html | my |

## Co dziala

- Zero bledow konsoli, zero 4xx/5xx, brak przewijania w bok na wszystkich stronach w obu rozmiarach (jedyne ostrzezenie: three.js KHR_parallel_shader_compile w 3D).
- Brak aut w TPN na zawracie: wszystkie 393 drogi w zawrat-traffic.json na polnoc od 49,263 (Zakopane / Lysa Polana); odrzucone m.in. 5 slepych drog parku i 11 access=no.
- Widok dowodcy na telefonie (390): dolny panel peek / polowa / calosc; pasek peek "1 S7 Zleb pod Zawratem"; Menu (Zmien scenariusz, Centrum, Zasoby, 2D/3D, rola) dziala; kompaktowa legenda jest.
- Przyciski 112: start.html "Ktos zaginal? Zadzwon 112" nad zgieciem (y=74, 56 px); rodzina.html "Zadzwon 112" 64 px nad zgieciem; landing - linki 112 tylko w zakladce "Dla turystow i rodzin" (nie domyslnej).
- Czat, karta jednym dotknieciem: przyklad -> karta z modelu ("AI · pewnosc: srednia", pinezka S5 na mini-mapie, "Dodaj (symulacja)", Anuluj, Popraw recznie). Nie wcisnieto Dodaj.
- Centrum: Gantt (0481822) na hover (1440) i przyciskiem "Os czasu" (390), wiersz na akcje, legenda; granica Polski wyglada dobrze.
- Dock i prawy panel rozwijaja sie na hover i zwijaja ok. 3 s po zjechaniu myszy.
- Porownanie: obie mapy sie renderuja (wolno na tym Wi-Fi). Odprawa i Zasoby czyste, zgodne z top 3 na zywo.
- Zasada uczciwosci: panele top 3 wszedzie pokazuja miejsce + "% obszaru"; wyjatek tylko tooltip komorki (punkt 6).
