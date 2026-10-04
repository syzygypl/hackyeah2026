# QA - ścieżka pokazu na produkcji (demo-runbook.md, sekcja 2)

2026-10-04 ok. 01:10-01:40, https://rescue-locator.vercel.app, wersje `bf0f92d` -> `f95f259` (`/version.json`). Headless Chrome 1440x900 (swiftshader), CDP ze skryptu Python, **tylko odczyt**: każdy fetch/XHR inny niż GET/HEAD/OPTIONS zablokowany w stronie i we wszystkich ramkach, więc kroki z zapisem (4: meldunek z telefonu, 5: przeciągnięcie zespołu, ZNALEZIONO z telefonu) sprawdzone tylko jako "strona się ładuje". AI Mateusza #2.

Spójność top 3 (panel vs etykiety 2D vs etykiety 3D): `python3 rescue/integration/test_top3_consistency.py` (domyślnie produkcja, Zawrat Historia kroki 1-10 + Na żywo, widok 2D+3D). Na `f95f259`: **wszystko PASS** (11/11). Przełączanie 2D <-> 3D w Historii i Na żywo: etykiety zgodne z panelem.

## Wynik krok po kroku

| # | Krok runbooka | Wynik | Uwagi |
|---|---|---|---|
| 0 | `/health` | OK | `llm-openai`, `pinRequired: true` |
| 1 | Zawrat **Historia**, oś na początku | UWAGA | `/app/?sc=zawrat&mode=akcja&time=hist` (bez `step`) otwiera się na **końcu** nagrania (20:03 ZNALEZIONO, potem do 20:47), nie na 17:40. Trzeba kliknąć ⏮ (działa: 17:40, top 3 S3/S2/S4). Runbook mówi "oś na początku" - albo kliknąć ⏮ w T-30 i zostawić kartę, albo otworzyć z `&step=0`. Bez błędów JS. |
| 2 | Oś na 18:30, odznacz jedną wskazówkę i zaznacz z powrotem | **PASS od 33a6ad6** (było: BŁĄD) | 18:30: panel/2D/3D zgodnie S4/S3/S6. Odznaczenie wskazówki w Sygnałach (☰, np. "CPR 112: ostatni sektor BTS 14:12"): **panel się nie zmienia, mapa 2D się nie zmienia, tylko 3D przelicza** (S3/S2/S4). Zdanie z runbooka "mapa przelicza się po każdej wskazówce" w 2D nie jest prawdą. Przyczyny niżej (B1, B2). "↺" przywraca, wtedy wszystkie trzy znów zgodne. |
| 3 | ▶ / oś 18:40 -> 20:03 | OK | ZNALEZIONO widoczne, #1 S7 Żleb pod Zawratem. Oś idzie dalej do 20:47 (17/17), tam top 3 S7/S4/S6 (o 20:03 było S7/S4/S3) - drobne, ale #3 zmienia się już po znalezieniu. |
| 4 | **Na żywo** 19:45 | OK (odczyt) | Panel S7/S4/S3, 7% obszaru, 2D i 3D zgodne (po c635f4f / 9dea05e). Meldunek z telefonu i "Potwierdź wszystkie" nie testowane (zapis). |
| 4b | Na żywo 3D | OK | Etykiety #1-#3 = panel. Kosmetyka: etykiety #2 Wielki Staw i #3 Schronisko nachodzą na siebie i na pinezki zdarzeń przy 1440 px (owner 3D). |
| 5 | Centrum | OK (odczyt) | 18 akcji, 1 LIVE (Połonina Wetlińska), zespoły 31/31. Runbook mówi "11 akcji" - **liczba w runbooku nieaktualna**. Drag zespołu i zamknięcie akcji nie testowane (zapis). |
| 6 | Śniardwy, Kraków Nowa Huta | OK | Śniardwy W2/W3/W1, Kraków N10/N7/N1, panel = 2D. |
| 7 | Walidacja (liczby ze slajdu) | OK | 66% / 43% (góry), 91% / 81% (woda) zgodne z runbookiem i pitch.md; 56% (ekspert) też na ekranie. |
| - | Ratownik, Widziałem, landing | OK | Ładują się, bez błędów JS. |

Błędy JS (window.onerror + unhandledrejection we wszystkich ramkach, CDP Runtime.exceptionThrown): **brak** na całej ścieżce.

## Ponowne sprawdzenie (02:10, prod `4973b34`)

Krok 2 po 33a6ad6 (AI Marcina): 18:05, odznaczony "CPR 112: ostatni sektor BTS 14:12" -> panel, 2D i 3D zgodnie S3/S2/S4; ↺ -> wszystkie trzy S4/S3/S6. Drobiazg: podpis panelu przy wyłączonym sygnale dalej mówi "(z pokryciem)", a ranking jest wtedy z kroku bez pokrycia.

Pełna ścieżka ponownie na `4973b34`: krok 1 UWAGA (bez `&step=0` start na końcu, runbook już to mówi), 2 PASS, 3 PASS, 4 PASS (odczyt), 4b PASS, 5 PASS (odczyt, 18 akcji, runbook poprawiony), 6 PASS, 7 PASS, ratownik / Widziałem / landing PASS; błędy JS: brak. `test_top3_consistency.py`: Historia 1-10 + Na żywo 11/11 PASS (jedno wcześniejsze FAIL kroku 1 na `1db6bc4` było nieukończonym ładowaniem w headless, 150 s bez panelu, nie niezgodnością; powtórka PASS).

## Przyczyny i propozycje (stan przed 33a6ad6)

- **B1 (AI Marcina, rescue/web/app.js):** 2D osadzone w /app nie obsługuje wiadomości `{type:'evidence', id, on}` (CONTRACT: shell -> widoki, `setEvidence` w app.js ją wysyła). W `applyParentMessage` brak gałęzi `evidence`, więc `S.disabled` zostaje puste i mapa 2D nic nie przelicza. Propozycja: `else if (m.type === 'evidence' && typeof m.id === 'string') { if (m.id === '*') S.disabled.clear(); else if (m.on === false) S.disabled.add(m.id); else S.disabled.delete(m.id); render(); renderCards(); }` (sprawdzić, czy id = `hintId` z `steps[]`, jak w `#events .evt[data-hint]`). Reguła z 7e2b7a9 (przy wyłączonym sygnale 2D liczy własny top 3) wtedy zadziała.
- **B2 (AI Marcina, rescue/app/app.js):** panel "Gdzie szukać najpierw" przy wyłączonym sygnale dalej pokazuje top 3 z klatki/kroku (tlSegments nie zna `evOff`), a `setEvidence` nie woła `renderPanels`. Po B1 2D i 3D pokażą przeliczony ranking, a panel stary. Propozycja: widok 2D odsyła `{type:'top3', ids}` po przeliczeniu bez sygnału, a shell przy `evOff.size` bierze top 3 z tej wiadomości (z dopiskiem "bez: <sygnał>"). Albo prościej na pokaz: w kroku 2 nie odznaczać wskazówek, tylko przesuwać oś.
- 3D (4c3f654): przy wyłączonym sygnale 3D liczy własny ranking (jak 2D w 7e2b7a9), poza tym zawsze bierze top 3 z panelu (`top` w `{type:'time'}`).
- Runbook (AI Michała / Mateusza): krok 1 - kliknąć ⏮ albo `&step=0`; krok 5 - "18 akcji", nie 11.
