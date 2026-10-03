# Rescue Locator - historia projektu do pitchu

24 h HackYeah 2026: start sob. 2026-10-03 11:00, koniec niedz. 11:00. Wszystkie godziny z `git log` na main. Wszystkie scenariusze są fikcyjne (na prawdziwym terenie), liczby jakości pochodzą z symulacji, nie z prawdziwych akcji.

## A) Oś czasu

1. **Sob 11:33 - wybór zadania: AI Control Layer.** Pierwszy commit to spike bramki dla agentów AI pod zadanie Goldman Sachs (`0a6a87b`), potem dashboard (`325a572`, `spikes/acl-dashboard/`). Powstał "Airlock": polityki, sygnatury ataków, lokalne modele-strażnicy. Dlaczego ważne: w 2 h zespół sprawdził, że umie dowieźć działający prototyp od zera.
2. **Sob 13:20 - STOP na kodzie Airlocka.** Ostatni commit tej fali to `ec45ce1` (canary w system prompcie). Airlock dalej żył równolegle (np. `2e04aae` 18:03, `5e9f60c` 20:19), ale nie był już głównym tematem.
3. **Sob 13:38 - zwrot: Rescue Locator.** Mateusz otwiera drugi temat: skrypt pitchu, plan slajdów i research planowania poszukiwań (`5d78ce0`, `b9ba840`), o 13:41 mapowanie kryteriów DEFENCE na momenty demo (`19d3635`). Dlaczego ważne: najpierw demo i kryteria, potem kod.
4. **Sob 13:44-14:31 - silnik POA i segmenty.** Strumień wskazówek i siatka prawdopodobieństwa (`e4c1b0f`), niezależny silnik referencyjny do porównania (`744900e`), backtest kontra pierścienie Koestera (`4262ffe`). Pusty przeszukany segment obniża mapę (POA x (1 - POD)), zdarzenie "Found" zamyka akcję (`af87e5f`, 15:05).
5. **Sob 13:57 - prawdziwy teren z OSM + Copernicus DEM.** Zawrat na prawdziwych danych (`d0544b1`), potem ogólne narzędzie terenu z wieloma kafelkami DEM (`6c23634`) i maska wody (`daaf099`). Dlaczego ważne: mapa liczy się na stokach, szlakach i wodzie, a nie na płaskiej siatce.
6. **Sob 14:13-16:48 - telefon ratownika.** Widok patrolu z meldunkami i kolejką (`ba9cb64`), meldunek "pusto" zmienia mapę u operatora, potem jeden ekran z sektorem, kierunkiem GPS i dużymi przyciskami (`e8e70ed`), a o 18:11 instalowalna aplikacja PWA (`a63e796`).
7. **Sob 14:27-15:40 - widoki 2D i 3D w jednej aplikacji.** Mapa 2D na MapLibre (`f2482d6`), three.js dla 3D (`32267b9`), o 15:40 jedna powłoka z przełącznikiem 2D/3D/Podział (`fd92ffe`). Wieczorem 3D dostaje budynki i drogi z OSM (`7d0c773`) oraz roślinność według gatunków (`20ded40`).
8. **Sob 14:36 - Studio.** Story Studio składa akcję z modułów, a opis zwykłym tekstem zamienia na zdarzenia (`fb9178c`); potem przeciąganie kart i pinezek na mapie (`9a1d7e0`). Dlaczego ważne: nowy scenariusz to minuty, nie godziny.
9. **Sob 18:14 - Centrum i wdrożenie.** Wszystkie akcje na jednej mapie i wspólna pula zespołów przeciąganych na akcję (`7f4bbab`, `8ec0b22`). Tego samego popołudnia serwer działa na Vercelu z bazą Neon (`90bc1e6`), a jeden serwer obsługuje wszystkie klienty (`da5731b`).
10. **Sob 20:59-22:46 - Ćwiczenia, Zasoby, oś czasu 1x-30x i Kino.** Ćwiczenia z oceną decyzji (`243d17f`), strona Zasoby z kartą zespołu i telemetrią (`54b0204`, 22:00), ciągła oś czasu 1x-30x z zatrzymaniem na każdej grupie zdarzeń (`ef5f100`, 22:31), tryb Kino z ujęciami za grupami zdarzeń (`f54c390`, 22:46).
11. **Sob 22:55-niedz 00:01 - co wycięliśmy i dlaczego.**
    - Obietnica pracy offline zniknęła ze strony (`556a747`): w pokazie model to OpenAI z regułami jako zapasem, więc nie deklarujemy offline (`docs/submission/hackathon/rescue-locator/v4/CHANGELOG.md`).
    - Tryb Auto (zdarzenia wpisywane jak w czacie) oznaczony jako "planowane", wycięty na tę noc (`7fe432b`).
    - Linia "66% / 56% / 43%" (symulacja) usunięta ze strony startowej razem z sekcją walidacji na landingu, notki prawne zostały (`e949d42`). Liczby nadal są w `docs/rescue-locator/pitch.md` z opisem "symulacja, nie prawdziwe akcje".
12. **Sob 23:18-niedz 00:11 - port backendu do Rusta.** Szkielet (`c8ff366`), zasady identyczności bajt w bajt (`cef47bd`), port: silnik 11-240 ms zamiast 2-6 s, `/api/incidents` z 29,5 s do ok. 1,5 s rozgrzewki, potem z cache, zgodność z serwerem Swift na 93 ze 105 odpowiedzi wzorcowych (`6604627`). Produkcja na Ruście (`324a184`, `785fcf1`, Swift zostaje do wycofania), API w fra1 obok Neon (`c18e869`), ETag i 304 zamiast ponownego pobierania do 2,6 MB (`0f59ef4`, `71e426a`). Przed portem produkcja mierzyła 28-36 s na każde wywołanie `/api/incidents` (`docs/rescue-locator/wydajnosc.md`).

Uwaga: liczby "ok. 22 ms" dla produkcyjnego `/api/incidents` nie znalazłem w repo (ani w commitach, ani w `docs/`). W tekście używamy tylko liczb z `6604627` i `wydajnosc.md`. Jeśli ktoś ma pomiar 22 ms, trzeba go dopisać do `wydajnosc.md` (Runda 2) i dopiero wtedy cytować.

## B) Narracja do pitchu (60-90 s)

> Sobota, 17:40. Żona zgłasza, że mąż poszedł sam na Zawrat i nie wrócił. Mgła, zmierzch. Kierownik akcji ma auto na parkingu, plan wycieczki i sektor z sieci komórkowej z dokładnością półtora kilometra. Łączy to w głowie, na papierowej mapie.
>
> Na tym hackathonie zaczęliśmy zupełnie gdzie indziej - od bramki bezpieczeństwa dla agentów AI. Po dwóch godzinach zatrzymaliśmy się i zadaliśmy sobie pytanie: gdzie nasz kod może najbardziej pomóc? Wybraliśmy poszukiwania zaginionych.
>
> Rescue Locator łączy niepewne wskazówki w jedną mapę na prawdziwym terenie - OpenStreetMap i model wysokości Copernicus - i mówi, gdzie szukać najpierw. Każdy pusty przeszukany sektor obniża mapę, każdy meldunek z telefonu ratownika ją zmienia. Operator widzi akcję w 2D i 3D, może ją przewinąć od 1x do 30x, a Centrum pokazuje wszystkie akcje naraz i wspólną pulę zespołów.
>
> Uczciwie: nie obiecujemy pracy offline i nie pokazujemy prawdziwych akcji - wszystkie scenariusze są fikcyjne.
>
> I jedna liczba z ostatniej nocy: przenieśliśmy cały backend do Rusta. Silnik liczy mapę w 11 do 240 milisekund zamiast 2 do 6 sekund, a lista wszystkich akcji, która na produkcji trwała około 30 sekund, przychodzi po półtorej sekundy rozgrzewki, a potem z pamięci podręcznej. To znaczy, że ratownik zgłasza "pusto", a kierownik widzi nową mapę, zanim odłoży telefon.

### Źródła

- Scenariusz Zawrat, 17:40, sektor ok. 1,5 km, fikcyjny: `docs/submission/hackathon/rescue-locator/v4/submission.md` (Problem), `docs/rescue-locator/pitch.md` (`rescue/scenarios/zawrat.json` fictional).
- Start od bramki dla agentów AI, ok. 2 h: `0a6a87b` (11:33) do `ec45ce1` (13:20), zwrot `5d78ce0` (13:38).
- OSM + Copernicus DEM: `d0544b1`, `c6bfd9a`.
- Pusty sektor obniża mapę (POA x (1 - POD)): `submission.md` v4, sekcja Rozwiązanie.
- Meldunek z telefonu zmienia mapę: `ba9cb64`, `e8e70ed`, `docs/rescue-locator/najmocniejsze-funkcje.md` (demo 30 s).
- 2D i 3D, 1x-30x, Centrum: `fd92ffe`, `ef5f100`, `7f4bbab`.
- Bez obietnicy offline: `556a747`, `v4/CHANGELOG.md`.
- Silnik 11-240 ms vs 2-6 s, `/api/incidents` 29,5 s -> ok. 1,5 s potem cache: `6604627`. Produkcja 28-36 s przed portem: `docs/rescue-locator/wydajnosc.md`. Produkcja na Ruście: `324a184`, `785fcf1`.
- "Zanim odłoży telefon" to obraz, nie pomiar - jeśli jury dopyta, podajemy liczby z `6604627`.

## C) Zdania na slajd

1. W 24 h: od bramki dla agentów AI do mapy, która mówi ratownikom, gdzie szukać najpierw.
2. Prawdziwy teren (OSM + Copernicus DEM), fikcyjne scenariusze, jedna mapa dla operatora, telefonu i Centrum.
3. Backend w Ruście: silnik 11-240 ms zamiast 2-6 s, lista akcji z ok. 30 s do ok. 1,5 s.
