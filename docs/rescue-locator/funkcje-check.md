# Przegląd funkcji (Sun 2026-10-04 wieczór)

Kto co sprawdza: AI Mateusza #1 - shell /app, Centrum, dzwonek, podstrony (lokalny rescue-server na 06db609 + produkcja tylko GET); AI Andrzeja - 3D, server/API, telefon ratownika (ich wiersze zostają jako "do sprawdzenia przez AI Andrzeja").

Metoda: headless Chrome przez CDP, prawdziwa mysz (Input.dispatchMouseEvent: wciśnij / ruch w krokach / puść, przed każdym kliknięciem `elementFromPoint` trafia w zamierzony element; drag zespołu w Centrum przez Input.setInterceptDrags + dispatchDragEvent). Rozmiary 1440x900 i 1100x800 dla wszystkiego, 390x844 (mobile) dla /app i Centrum. Dodatkowo przeszły: test_panels (poza `held_after_leave_right`, patrz #9), test_bell_doradca, test_scenario_switch, test_chat_ui, test_centrum_sim, test_centrum_timeline, test_centrum_pick_embed, test_livefeed, test_exercise_ui.

| # | Funkcja | Gdzie / kroki | Wynik | Uwagi |
|---|---|---|---|---|
| 1 | Akcja 2D / 3D / 2D+3D | /app operator zawrat, klik 3D, 2D+3D, 2D | OK | Bez pustego ekranu, ramki 2D/3D mają wymiary, canvas 3D jest. Drobne: po 3D -> 2D+3D -> 2D przy 1440 mapa 2D jest bardziej oddalona niż przy starcie. |
| 2 | Historia: play i scrub | ⏮, ▶ (1x i 10x), przeciągnięcie po osi | OK | 17:40 -> 17:46 w 7 s przy 1x, 10x przyspiesza; scrub 5/17 -> 14/17 (19:22). |
| 3 | Na żywo | klik "Na żywo" | OK | Badge LIVE (atend), "teraz 18:40"; powrót do Historii działa. |
| 4 | Klik zdarzenia w docku | ☰, klik kart 8 i 12 | OK | Mapa 2D przelatuje i przybliża (12.6 -> 13.8); krok 3 (pogoda/start) celowo nie rusza mapy. |
| 5 | Plan: dowody i zespół | Plan, przeciągnij 9 typów z "Dowody" na mapę / sektor, Dodaj prawdziwym klikiem; zespół na sektor | OK | 1440 i 1100: każdy typ daje toast "Dodano: ..." i pinezkę (pogoda i sektorowe bez pinezki), Dodaj niczym nie zakryty. Patrol TOPR A na S3: toast "Patrol TOPR A → S3", karta "busy". Kosmetyka przy 1100: pasek podpowiedzi ucięty pod panelem Dowody, tytuł legendy "Waga mapy" pod przełącznikiem Mapa / Mapa + 3D. |
| 6 | Plan -> Akcja | Plan, potem Akcja | CZĘŚCIOWO | Incydent wraca, ale przez ok. 3 s Akcja pokazuje historię z Planu (tytuł "Studio - nowa historia", 22%, pinezki z Planu na mapie 2D zawratu), potem zawrat 6%. app/app.js setMode / wczytanie runu (shell, AI Mateusza). |
| 7 | Zmień scenariusz | klik "Zmień scenariusz", prawdziwy klik karty w iframe | OK | Overlay, URL ?sc=..., loader widoczny, bez przeładowania strony, history.back wraca do zawratu w miejscu. |
| 8 | Udostępnij, ?, Rola | klik każdego | OK | Dialog z linkami + Esc; pomoc otwiera się i zamyka przez ×; Rola -> ratownik przełącza widok. Drobne: otwarty panel pomocy zakrywa w nagłówku "?" i "Rola" (zamknięcie tylko przez ×); po zmianie roli URL dalej ma role=operator. |
| 9 | Panele zwijane | hover prawdziwą myszą, odjazd, pinezka | OK | Gdzie szukać, Legenda 2D, Podkład: hover otwiera, po 1 s dalej otwarte, po 5,5 s zwinięte; pin trzyma, odpięcie zwija. Test test_panels `held_after_leave_right` pada tylko na syntetycznych pointerenter/leave (realna mysz OK) - do poprawy w teście. |
| 10 | Dzwonek /app ?simAt=07:51 | toast, Otwórz, Potwierdź, przeładowanie | OK | Toast "Nowa akcja 07:51", Otwórz przełącza na zapora-uherce w miejscu (bez przeładowania, zoom 15); Potwierdź -> "potwierdzone 07:51", trzyma się po przeładowaniu; linia "Czas do potwierdzenia: mediana 0,7 min". Loader po Otwórz ok. 17 s w headless (swiftshader). |
| 11 | Czat | klik Czat, wpis "Patrol przeszukał S9, nic", Enter | OK | Odpowiedź regułowa "Przeszukane, nic ... S9", karta z Dodaj (symulacja). Stan szuflady zapamiętany między przeładowaniami. |
| 12 | Nagłówek w jednym rzędzie | 1100 i 1440 | OK | Wszystkie przyciski na y 19-23 px, brak poziomego scrolla. |
| 13 | Centrum: karty | ?sim=1&simAt=07:55 | OK | 10 kart LIVE "Trwają teraz", każda z Top 3 i czasem; 32 akcje w liście. |
| 14 | Znaczniki na mapie | klik pojedynczego znacznika | OK | Otwiera /app?sc=<akcja>&time=live (Wizna, Puszcza Notecka). |
| 15 | Doradca | Rozwiń, Pokaż na mapie | OK | Zwinięty wiersz ALARM, Rozwiń pokazuje hipotezę, dowody E1-E4, prognozę fali; Pokaż na mapie kadruje San; liczy 10 akcji = 10 trwających. |
| 16 | Doradca ALARM w dzwonku | simAt=07:51, toast Doradcy, Otwórz | OK | Otwórz rozwija panel Doradcy. Przy 1100 widać jeden toast naraz, toast Doradcy wchodzi po zamknięciu pierwszego. |
| 17 | Eskalacja | simAt=07:38 (Myczkowce 07:32 + 6 min) | OK | Czerwony badge "bez potwierdzenia" na kartach, toasty .late z czerwonym brzegiem. |
| 18 | Tryby osi czasu i scrub | klik 4 trybów, przeciągnięcie paska | OK | Każdy tryb zmienia oś (00-24, 06-21, T-1..T+4, 06-10); scrub do 12:16 zmienia "Trwają o 12:16" i karty. |
| 19 | Ruch zespołów | zoom kółkiem na Puszczę Notecką | OK | 41 kropek zespołów, część przesuwa się w 20 s przy 1x. |
| 20 | Zespół na kartę | drag z "Zespoły" na kartę w "Trwają teraz" | BŁĄD | W trybie sym (?sim=1, ścieżka demo) karty LIVE nie przyjmują zespołu: brak toastu, zespół zostaje wolny. Karty `.simc` nie mają `data-drop` (app/centrum.js ok. l. 1299, wireDrops tylko na #cards i #teams). Bez sym (?sim=0) i na znaczniki mapy działa. Właściciel: Centrum (AI Mateusza #2). |
| 21 | Zasoby | /app/zasoby.html | OK | 127 kart zespołów, filtry, brak błędów, brak poziomego scrolla. |
| 22 | Odprawa | /app/odprawa.html?sc=zawrat, media print | OK | Nazwy akcji w liście (33), "5,5 h od ostatniego kontaktu", w druku bez kontrolek. |
| 23 | Porównanie | /app/porownanie.html, Cofnij / Dodaj relację | OK | Przełącza "relacja dodana" / "jeszcze bez relacji", bez wyjątków. |
| 24 | Ćwiczenia | /app/cwiczenia.html + test_exercise_ui | OK | Test przeszedł (przejęcie, zespół, sektor, Czekaj, wynik). |
| 25 | Start | /app/start.html, klik "Kierownik akcji" | OK | Przechodzi do /app/?role=operator. |
| 26 | Rodzina | /app/rodzina.html, "Widziałem kogoś" | OK | Przechodzi do #widzialem, bez błędów. |
| 27 | Produkcja (tylko GET) | https://rescue-locator.vercel.app (commit 06db609) /app i /app/centrum.html, 1440 / 1100 / 390 | CZĘŚCIOWO | Ładuje się, brak 5xx, brak wyjątków JS, brak poziomego scrolla. Centrum loguje 2 błędy konsoli 404: GET /api/run/zapora-uherce?t=05:52 i zapora-myczkowce?t=05:53 ("no timeline for ..."); te akcje nie mają timeline, a app/centrum.js tl3Fetch i tak pyta (Top 3 na karcie i tak się pokazuje). Właściciel: Centrum (tl3Fetch) albo timeline zapór po stronie serwera. Uwaga: hackyeah2026.vercel.app zwraca 404, właściwy host z demo-runbook to rescue-locator.vercel.app. |
| A1 | Widoki 3D i FPP | - | do sprawdzenia przez AI Andrzeja | |
| A2 | WASD i klik-aby-iść w 3D | - | do sprawdzenia przez AI Andrzeja | |
| A3 | Pozycje na żywo | - | do sprawdzenia przez AI Andrzeja | Lokalny Swift rescue-server (06db609) zwraca 404 na /api/positions/<sc>, /api/schedule, /api/notifications, /version.json (produkcja 200); front ma fallbacki, ale konsola się sypie. |
| A4 | Woda, mgła, ruch drogowy | - | do sprawdzenia przez AI Andrzeja | |
| A5 | Kino | - | do sprawdzenia przez AI Andrzeja | |
| A6 | /api/positions, /api/schedule, /api/notifications | - | do sprawdzenia przez AI Andrzeja | |
| A7 | Klucz akcji 401 / 403 | - | do sprawdzenia przez AI Andrzeja | |
| A8 | Telefon ratownika (udostępnij pozycję, ŚLAD / ZNALEZIONO) | - | do sprawdzenia przez AI Andrzeja | |

Wynik (wiersze 1-27): 24 OK, 2 CZĘŚCIOWO (#6, #27), 1 BŁĄD (#20).
