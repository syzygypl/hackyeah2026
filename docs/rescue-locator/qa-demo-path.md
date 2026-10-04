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

## Ścieżki zapisu - lokalnie, Rust (faktycznie: Swift)

2026-10-04 ok. 04:20-04:45, AI Mateusza #2, checkout `origin/main` z ok. 04:20. **Serwer Rust nie dał się zbudować lokalnie.** Na maszynie nie ma `cargo`/`rustup`, a `docker info` nie odpowiada, więc nie da się też zbudować w kontenerze. Dlatego zgodnie z planem B użyty został serwer Swift (`swift build --product rescue-server`, 40 s, kontrakt API ten sam, parity w `rescue/rs/parity.py`). Działał na loopback bez klucza, z LLM wyłączonym (meldunki czytają reguły) i plikami live w katalogu tymczasowym. **Produkcji nie dotykałem.**

| Test | Wynik | Co pokrywa |
|---|---|---|
| `test_demo_path.py --no-build` | 8/8 PASS | nowa akcja, meldunek z telefonu w zawrat (nie przecieka do sniardwy), ACK wszystkich i pojedynczy, przydział + ZNALEZIONO kończy zawrat i zwalnia zespoły, Widziałem, reset, strony statyczne. Znana luka: brak Range na `.pmtiles` (200 zamiast 206). |
| `test_multi.py` | 21/21 PASS | Centrum: lista akcji, pula zespołów, przenoszenie zespołów między akcjami, zakres `sc`, planer tylko z przypiętymi zespołami |
| `test_chat_ui.py` | 38 PASS, 0 FAIL | Czat w Historii (symulacja + Cofnij), **Na żywo: ślad -> `POST /api/clue` -> top 3 -> Cofnij (waga 0)**, raport z przeszukania, wpisy bez sensu, `czat.html` |
| `test_live_multi_ui.py` (nowy) | 17/17 PASS | operator + Centrum + telefon otwarte jednocześnie, wszystko przez UI, czasy poniżej |

Propagacja między klientami (`test_live_multi_ui.py`, kroki 4-5 runbooka):

| Krok | Wynik | Czas | Odpytywanie w kodzie |
|---|---|---|---|
| Operator: Wyślij zespół Patrol TOPR A -> S7 => telefon "S7" | PASS | 10,7 s | telefon co 15 s (`/api/assignments`) |
| Telefon: Wyślij meldunek "S8 pusto, widoczność 50 m" => wysłane | PASS | 0,5 s | - |
| => operator: wpis w feedzie + "Niepotwierdzone: 1" | PASS, **ale wolno** | 12,1 s (w pierwszym przebiegu ponad 20 s) | operator co 3 s; runbook obiecuje "~3 s" |
| Operator: Potwierdź wszystkie => "Wszystko potwierdzone" | PASS | 5,7 s | - |
| => telefon: "Operator potwierdził Twój meldunek ✓" | PASS | 17,3 s | telefon co 15 s (runbook: do 15 s) |
| Telefon: ŚLAD / ZNALEZIONO -> poszkodowany ZNALEZIONY => Centrum "Zakończone" | PASS | 19,4 s | Centrum co 10 s |
| => telefon "Akcja zakończona" | PASS | 25,4 s | `/api/live` co 15 s (found), `/api/incidents` co 60 s |
| => operator widzi koniec | PASS | 1,5 s | - |
| Wyjątki JS (3 klienty) | brak | | |

Uwagi:
- **Meldunek -> feed operatora trwa 12-20+ s** lokalnie (Swift debug, reguły), choć operator odpytuje co 3 s. Przyczyna nieustalona: albo przeliczenie runu po meldunku, albo kolejność pollLive / przeliczenia. Na scenie to cisza w kroku 4. W runbooku zamiast "~3 s" powinno być "do ~15 s, mów dalej". ASK do AI Marcina (shell, `pollLive`) i ownera serwera.
- Telefon "Akcja zakończona" przychodzi po ~25 s, a Centrum po ~20 s. Runbook mówi "po kilku-kilkunastu s", więc warto dopisać "do 30 s".
- Z przeglądu AI Michała (b0858be) dotyczy zapisów: produkcja nie była zresetowana (`seq: 50`, brak przydziału TOPR A -> S7). Reset i przydział z sekcji 1 runbooka trzeba zrobić w T-10 min. Czat przy otwarciu `czat.html` / w Historii wysyła `POST /api/run`; to obliczenie, nie zapis (punkt 10, mój obszar, bez zmian). Z 0b493bb: podpowiedzi Czatu o Zawracie pojawiają się też w Krakowie i na Śniardwach (do poprawy w `chat.js`, mój obszar).
- Nie sprawdzone: prawdziwy telefon z GPS, klucz terenowy z QR (lokalnie loopback bez klucza), serwer Rust (brak toolchainu).

## Ścieżki zapisu - Rust lokalnie (545fe02)

2026-10-04 04:59, AI Marcina (wiadomość w wątku "temat 2", id 1791082794292), wpisane przez AI Denisa na prośbę AI Mateusza #2. Sesja a5, lokalnie, Rust release z main `545fe02`, loopback, LLM wyłączony, **produkcja nietknięta**. `test_live_multi_ui.py` 17/17 PASS w 15 przebiegach (3 przebiegi na `545fe02` dla czasów). To źródło czasów w `demo-runbook.md` (sekcja 1, "Czasy").

| Krok | Czas |
|---|---|
| Przydział -> telefon "S7" | 10,7-12,2 s |
| Meldunek -> wpis w feedzie operatora | 0-1,5 s |
| Potwierdź wszystkie -> "Wszystko potwierdzone" | 0,5 s |
| Potwierdzenie -> toast na telefonie | 22,3-23,9 s |
| ZNALEZIONO -> Centrum "Zakończone" | 6,6-7,1 s |
| ZNALEZIONO -> telefon "Akcja zakończona" | 22,4-22,9 s |
| Operator widzi koniec | 0,0 s |

Zastrzeżenie: pomiar lokalny, nie na produkcji; na produkcji dochodzi sieć (ok. 0,2 s na żądanie, `wydajnosc.md`). Na Ruście wolny meldunek (12-20+ s w pomiarze Swift wyżej) już nie występuje.
