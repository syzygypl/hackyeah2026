# 3D: skoki czasu i przebudowa oświetlenia nieba

Codex, AI Andrzeja #2, 2026-10-03. Profil 1791063543121,
przydział właściciela bloku 1791063808908.

Przy skoku minuty 102 -> 60 nakładka pokazywała CPU update 13-14 ms,
nawet z FOV wyłączonym. `TL3D.tick` średnio kosztował 0,288 ms.
Koszt pochodził z powtarzanego `PMREMGenerator.fromScene` w `stepMood`:
14 przebudów w ok. 6 s, po 74-154 ms. Kolejna próba oryginalnego kodu
tym samym skryptem: maksymalnie 191,5 ms, średni update 16,4 ms.

Jedna podmiana diagnostyczna wyłączająca tylko aktualizację PMREM podczas
przejścia obniżyła update do 0,2-0,4 ms. Nie trafiła do repo.

## Poprawka

- Reużywany `WebGLCubeRenderTarget(64, HalfFloatType)` + `CubeCamera`
  przechwytuje bieżące niebo; `PMREMGenerator.fromCubemap` filtruje wynik.
  Ta wersja vendored three ma w `fromScene` na sztywno 256 px na ścianę.
- Aktualizacja najwyżej raz na sekundę podczas zmiany nieba, zamiast co
  250 ms. Paleta, słońce, mgła, pogoda i ekspozycja nadal płynnie zmieniają
  się w każdej klatce. Nie wyłączono dynamicznego oświetlenia.
- Biblioteka three, kontrakt API i dane osi czasu bez zmian.

## Sprawdzenie

Agent Browser na starship-v2, 1440x950, DPR 1, ANGLE/Mesa AGX G13/G14,
zawrat, Historia, obrót, FOV off, ten sam skok 102 -> 60.
Skrypt diagnostyczny `debug-pmrem-feedback.js` jest w zasobach projektu
`~/agent-docs/projects/active/hackyeah-2026/resources/`; uruchomiony przez
Playwright MCP. Mierzy prawdziwe przejście, wywołania PMREM i nakładkę;
odtwarza metody prototypu w `finally`.

Wariant końcowy: 6 aktualizacji, odstęp minimum 1004,4 ms, PMREM
0,3-0,4 ms, średni CPU update 0,5 ms. Pętla: oryginał czerwony,
poprawka zielona; brak pageerror. Oddzielny prototyp mierzący również
przechwycenie cube: średnio 0,588 ms, maksimum 1,5 ms.

Obejrzano zrzuty dnia (pogoda off), godziny 17:40 i nocy 19:35;
porównanie starego i nowego oświetlenia o 18:40 wizualnie zgodne.
Zrzuty `codex-pmrem{256,64}.png` i `codex-pmrem64-{day,golden,night}.png`
są w lokalnych zasobach projektu.

GPU jest współdzielone: późniejsza próba miała 22-30 fps mimo update
0,2-0,4 ms. Ta poprawka usuwa zmierzone zatrzymania aktualizacji nieba;
nie gwarantuje 45 fps na całej scenie pod dowolnym obciążeniem.
