# Rescue Locator (DEFENCE) - deck v5 (10 slajdów, PL)

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
6. **Centrum i teren** (zrzuty `04-centrum`, `08b-patrol-standalone`): 11 akcji, 18 zespołów, testy multi-incident 21/21.
7. **Zdanie zamiast formularza, kartka zamiast ekranu** (zrzuty `czat-1`, `odprawa-zawrat-a4`):
   - Czat: kilka zdarzeń w jednej wiadomości,
   - Odprawa (druk) A4 i karty zadań.
   - Dalej w jednym zdaniu: oś czasu 1x-30x, wagi wskazówek, Zasoby z kryptonimami, Doradca, Ćwiczenia, porównanie relacji, analiza zdjęcia (kierunek widoku, demo syntetyczne).
8. **Czy to pomaga? (symulacja, nie prawdziwe akcje):**

   | Góry, 1000 | Top 3 | Obszar dla 90% osób |
   |---|---|---|
   | Mapa | 66% | 29% |
   | Ekspert | 56% | 37% |
   | Od ostatniego punktu | 43% | 68% |

   - Woda: top 3 w 91% vs 81%.
   - Gdzie nie wygrywa: Bieszczady i pływak na jeziorze.
   - Na ślepo, N = 2 (przypis).
9. **Poza górami i co dalej** (zrzuty `07-sniardwy`, `06-krakow`): woda i miasto. Dalej: kalibracja wag, rundy na ślepo, backtest GOPR/TOPR, LiDAR, AML, ISRID.
10. **Linki:**
    - demo, pokaz 90 s, `/landing` (status funkcji), `rodzina.html`, szkic wideo 2:07 (`video/draft.mp4`), repo, `start.sh`, zespół [UZUPEŁNIJ],
    - ujawnienie AI (Claude Code; model OpenAI w pokazie; Vercel, Neon),
    - dane i licencje.
