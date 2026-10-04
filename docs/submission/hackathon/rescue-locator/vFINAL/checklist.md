# Rescue Locator vFINAL - co muszą zrobić ludzie (przed 09:00)

HackTribe zamyka się o 11:00, po tym nic nie da się zmienić. Celujemy w 09:00. Pakiety: DEFENCE `rescue-locator/vFINAL/`, Smart City `rescue-locator-smartcity/vFINAL/`. Airlock bez zmian od v5 (`airlock/v5/`).

## Do 09:00 (zgłoszenie)

- [ ] **Repo jest prywatne:** https://github.com/syzygypl/hackyeah2026 zwraca 404 bez logowania (curl, 08:15). Przed wysłaniem upublicznij repo (sprawdź, że nie ma sekretów; `.env` nie jest w repo) albo daj jury dostęp i napisz to w formularzu. Inaczej link na slajdzie 10 i w §6 nie działa.
- [ ] **Nazwa i ID zespołu** z HackTribe: wpisz w `submission.md` §2 obu pakietów i na slajdach 1 i 10 (`deck.html`, pole `[UZUPEŁNIJ]`), potem wydrukuj PDF ponownie (niżej).
- [ ] **Członkowie zespołu** (imiona i nazwiska jak na HackTribe): `submission.md` §3.
- [ ] **PDF slajdów:** `deck.pdf` jest gotowy (10 stron, 16:9, linki do repo i demo). Po wpisaniu zespołu: otwórz `deck.html` w Chrome -> Drukuj -> Zapisz jako PDF, układ poziomy, marginesy brak, grafika tła włączona. Sprawdź 10 stron.
- [ ] **Formularz HackTribe:** przepisz pola z `submission.md` (tytuł, krótki opis §4, pełny opis §5, linki §6, AI §9). Repo: https://github.com/syzygypl/hackyeah2026. Demo: https://rescue-locator.vercel.app.
- [ ] **Smart City:** to samo z `rescue-locator-smartcity/vFINAL/` (osobne zgłoszenie, decyzja Mateusza).
- [ ] **Wideo MP4** (wymagane tylko dla HubMI/Cracow; dla DEFENCE i Smart City opcjonalne, ale pomaga): nagraj według `video-shotlist.md` albo wgraj szkic `../video/draft.mp4` (2:07). Wgraj (YouTube niepubliczny / Drive) i wklej link w `submission.md` §6 i w formularzu.
- [ ] **IP / licencja:** zadania otwarte nie przenoszą praw. Brakuje pliku LICENSE (decyzja ludzi). Zgoda pracodawcy (`docs/research/legal-check-pl.md` punkt 21) - bez nazwy firmy w materiałach.
- [ ] **Kliknij "Submit"** na HackTribe i zrób zrzut potwierdzenia.

## Przed pokazem (finaliści 15:00, pitch 16:00) - człowiek z kluczem operatora

Z `docs/rescue-locator/demo-runbook.md`, lista T-10 min. Klucz tylko prywatnie, nigdy w repo ani w wątku.
- [ ] **T-10: Udostępnij -> Wyczyść akcję -> OK** (albo `POST /api/reset` z kluczem). Sprawdź: https://rescue-locator.vercel.app/api/live ma `"seq": 0`, https://rescue-locator.vercel.app/api/incidents wszystkie `"ended": false`.
- [ ] **Na żywo, Zawrat: Wyślij zespół -> Patrol TOPR A -> S7.** Telefon w ciągu ok. 15 s pokazuje "S7".
- [ ] Rozgrzej karty: operator Zawrat w Historii z `&step=0`, Centrum, `?sc=sniardwy`, `?sc=krakow-nowa-huta`; na telefonie ekran ratownika i Widziałem.
- [ ] Od teraz nikt z zespołu nie pisze na produkcję. "Nie przeszkadzać" na laptopie i telefonach.
- [ ] Przećwicz `pitch-3min.md` 3 razy (z zegarkiem), przeczytaj `pitch-qa.md`.

## Sprawdzone przez AI (08:30)

- [x] Poprawki AI Marcina: "bajt w bajt" -> "wartości odpowiedzi API zgodne z serwerem Swift; 94 ze 105 wzorcowych odpowiedzi bajt w bajt (reszta: zegar, zapis liczb)"; 17/17 PASS "lokalnie na serwerze Swift i na serwerze Rust, jak na produkcji" (oba pakiety).
- [x] Linia 66/56/43 usunięta z krótkiego opisu i ze slajdów; zostaje jako przypis na slajdzie 8 i w §5 z etykietą "symulacja".
- [x] Bez "offline", bez "22 ms", bez nazwy firmy. Produkcja na Ruście.
- [x] Fact-check `393f1a6` (poprawki `784c2cc`): 17 akcji na liście Centrum, czasy z serwera Rust.
- [x] Wszystkie URL-e demo z materiałów zwracają 200 (curl, 08:15, 18 adresów); repo zwraca 404 (prywatne, wyżej). Wszystkie zrzuty z materiałów istnieją.
