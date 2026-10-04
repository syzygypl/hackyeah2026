# Rescue Locator (DEFENCE) - deck vFINAL (10 slajdów, PL)

Zrzuty z serii 4 (`docs/rescue-locator/shots/`, produkcja `dd890df`): 01, 21, 08b, 22, 24, 27, 07, 06.

Źródło dla `deck.html`. Zrzuty z `docs/rescue-locator/shots/` (produkcja `b2ed46d`). Zasady:
- "symulacja, nie prawdziwe akcje" mówimy raz, na slajdzie 8;
- procent przy segmencie to "waga mapy", nie szansa;
- model językowy: pokaz używa modelu OpenAI w chmurze, nie deklarujemy pracy offline;
- analiza zdjęcia: tylko demo syntetyczne;
- 3D FOV jest w przebudowie i go nie pokazujemy.

1. **Tytuł:** Rescue Locator - gdzie szukać najpierw. Mapa poszukiwań dla GOPR, TOPR i WOPR, złożona na żywo z niepewnych wskazówek. Demo: rescue-locator.vercel.app.
2. **Problem:** Zawrat, 17:40, okruchy informacji (plan, auto, BTS 1,5 km, mgła). Dziś papierowa mapa. Cytat z briefu DEFENCE.
3. **Trzy role, jeden obraz** (plus rodziny: "Ktoś zaginął - co robić", Widziałem, Czat):
   - kierownik akcji: Na żywo, "Następne zdarzenie" dla wszystkich,
   - Centrum: wiele akcji, wspólna pula zespołów,
   - ratownik: telefon z GPS i kolejką meldunków przy utracie łączności.
4. **Podejście:** Koester x teren x wskazówki (także świadek z GPS i dryf). Pusty sektor dostaje waga x (1 - POD). Wynik to ranking, a procent to waga mapy.
5. **Demo** (zrzut `01-akcja-2d-zawrat-live`):
   - top 3 = ok. 7% obszaru,
   - S7 #1,
   - 19:45 śmigłowiec do S7,
   - 20:03 ZNALEZIONO, akcja się zamyka,
   - pokaz w 90 s: `?tour=1`.
6. **Centrum i teren** (zrzuty `21-centrum-doradca-pasek`, `08b-patrol-standalone`): wiele akcji, wspólna pula zespołów. Czasy z produkcji (serwer Rust `545fe02`, runbook `fa87d1e`, klienci odpytują serwer): meldunek u operatora ok. 1-2 s, ZNALEZIONO w Centrum ok. 7 s, telefon ok. 10-25 s (odpytuje co 15 s).
7. **Zdanie zamiast formularza, kartka zamiast ekranu** (zrzuty `22-czat-w-pasku`, `24-odprawa`; po "Dodaj" nowa mapa po ok. 0,9 s, w miejscu):
   - Czat: kilka zdarzeń w jednej wiadomości,
   - Odprawa (druk) A4 i karty zadań.
   - Dalej w jednym zdaniu: oś czasu 1x-30x, wagi wskazówek, Zasoby z kryptonimami, Doradca, Ćwiczenia, porównanie relacji, analiza zdjęcia (kierunek widoku, demo syntetyczne).
8. **Jedna relacja świadka: 95 min zmienia się w 12** (zrzut `27-porownanie`, scenariusz fikcyjny, `/app/porownanie.html`, `cf5a36c`):
   - ta sama akcja Zawrat o 19:22 bez relacji turystki i z nią: top 3 S4, S7, S3 (7,0% obszaru) -> S7 #1, S6, S9 (5,4%),
   - epilog: pierwszy zespół w S7 po 95 min (pies) bez relacji vs 12 min (dron) z relacją,
   - przypis (symulacja, nie prawdziwe akcje): 66/56/43% top 3 na 1000 przypadkach w górach, woda 91% vs 81%, gdzie przegrywamy.
9. **Poza górami i co dalej** (zrzuty `07-sniardwy`, `06-krakow`): woda i miasto. Dalej: kalibracja wag, rundy na ślepo, backtest GOPR/TOPR, LiDAR, AML, ISRID.
10. **Linki:**
    - demo, pokaz 90 s, `/landing` (status funkcji), `rodzina.html`, szkic wideo 2:07 (`video/draft.mp4`), repo, `start.sh`, zespół [UZUPEŁNIJ],
    - ujawnienie AI (Claude Code; model OpenAI w pokazie; Vercel, Neon),
    - dane i licencje.
