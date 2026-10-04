# Rescue Locator (SMART CITY) - deck vFINAL (10 slajdów, PL)

Zrzuty z serii 4: 06, 09a, 21, 08b, 27.

Wariant z Krakowem na pierwszym planie. Te same zasady co w wariancie DEFENCE: symulację nazywamy raz, procent to "waga mapy", model językowy w pokazie: OpenAI (chmura), bez deklaracji pracy offline.

1. **Tytuł:** Rescue Locator - gdzie szukać zaginionego seniora najpierw. Jedna mapa Krakowa z wszystkich zgłoszeń.
2. **Problem:**
   - ~1700-2000 zaginięć osób 65+ rocznie (policja.pl),
   - do 40% osób z demencją się zgubi,
   - znalezieni w 24 h przeżywają, po 24 h tylko 54% (Koester).
   - Źródła w `docs/rescue-locator/city-extension.md`.
3. **Dla kogo:** dyżurny / Centrum Zarządzania Kryzysowego, patrole policji i straży miejskiej, mieszkańcy i MPK.
4. **Demo Kraków** (zrzut `06-akcja-2d-krakow-nowa-huta`):
   - Józef K., 81 lat, demencja, upał 33°C,
   - korytarz do dawnego domu w Mogile, BTS,
   - motorniczy MPK, fałszywe zgłoszenie zamknięte przez patrol,
   - pies znajduje go o 18:40.
5. **Mieszkańcy jako czujniki** (zrzut `09a-widzialem-karta`): "Widziałem" z GPS przelicza mapę. Czat dla mieszkańców (`czat.html`), "Ktoś zaginął - co robić" dla rodzin. Bez biometrii, zgłoszenia dobrowolne.
6. **Centrum** (zrzuty `21-centrum-doradca-pasek`, `08b-patrol-standalone`): wiele akcji, wspólna pula zespołów, akcje bieżące i zakończone. Czasy z produkcji (runbook `fa87d1e`, klienci odpytują serwer): meldunek u dyżurnego ok. 1-2 s, ZNALEZIONO w Centrum ok. 7 s, telefon ok. 10-25 s.
7. **Kraków w liczbach:** 4,8% vs 24,5% obszaru, segment #4 vs #9 (scenariusz autorski, ilustracja). Kategoria demencja w symulacji: top 3 w 76%.
8. **Jedna relacja świadka: 95 min zmienia się w 12** (zrzut `27-porownanie`, scenariusz fikcyjny, `/app/porownanie.html`, `cf5a36c`):
   - ta sama akcja Zawrat o 19:22 bez relacji turystki i z nią: top 3 S4, S7, S3 (7,0% obszaru) -> S7 #1, S6, S9 (5,4%),
   - epilog: pierwszy zespół w S7 po 95 min (pies) bez relacji vs 12 min (dron) z relacją,
   - przypis (symulacja, nie prawdziwe akcje): 66/56/43% top 3 na 1000 przypadkach w górach, woda 91% vs 81%, gdzie przegrywamy.
9. **Jedna usługa dla miasta i regionu:**
   - działa dziś: Centrum, oś czasu 1x-30x, telefony, "Widziałem",
   - wagi zgłoszeń,
   - Doradca jako wąski pasek (wspólna przyczyna, ćwiczenie awarii zapory),
   - Odprawa (druk) dla dowodzącego.
   - Dalej: profile zespołów miejskich, lokalny alert, lista kamer do sprawdzenia przez człowieka, profilaktyka.
10. **Linki:** akcja Kraków na Vercel, `/web/seen/`, start, `/landing`, repo, MP4 [UZUPEŁNIJ], zespół [UZUPEŁNIJ], ujawnienie AI, dane.
