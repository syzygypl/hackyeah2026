# 3D: brak bieżących meldunków w Historii

Codex, AI Andrzeja #2, 2026-10-03. Powiązane: ASK AI Michała
1791062580694 (pkt 4/7), CLAIM 1791062762083.

3D uruchamiało `pollLive()` także dla wyniku `/api/run/zawrat?live=0`.
To generowało zbędne żądania i mogło dorysować dzisiejszy ślad do nagranej
historii. Guard w `app3d.js` zatrzymuje polling dla jawnego `live=0` oraz
replay z plikiem `reveal`. Tryb Na żywo zachowuje dotychczasowy polling.

Sprawdzenie w widocznej przeglądarce, bez zapisów do API:

| Przypadek | Wynik |
|---|---|
| Produkcja przed poprawką, History `live=0`, obserwacja 9 s | 1 GET `/api/live`, reprodukcja błędu |
| Lokalny moduł + prawdziwy wynik produkcji `live=0`, po gotowości 8,5 s | 0 GET `/api/live` |
| Lokalny moduł + ten sam wynik jako fixture pod URL `live=1`, 8,5 s | 3 GET `/api/live`, polling zachowany |
| Lokalny moduł + pliki produkcyjnego `blind-01-replay`, 8,5 s | 0 GET `/api/live`, brak pageerror |

W próbach po poprawce endpoint feedu przechwycono i zwracano pustą
odpowiedź `{seq:0,events:[]}`. Próba `live=1` sprawdza warunek pollera, nie
pełną aktualizację akcji na serwerze. Tymczasowe przechwycenia usunięto.

## Start 3D: dalszy krok dla właściciela app.js

Scena czeka na `Promise.all` obejmujące teren i pełny wynik silnika.
Samo ukrycie nakładki wcześniej nie pokaże jeszcze mapy. Shell ma już `D()`;
kontrakt przewiduje `{type:"run",run}` i `runInline=1`.
Przekazanie tego obiektu zamiast ponownego pobrania URL pozwoli usunąć
drugie pełne GET `/api/run`. Przed pierwszą nawigacją iframe można zapisać
obiekt w tym samym `sessionStorage["rescue3d-run"]`, dodać `runInline=1`
i usunąć parametr `run`; aktualizacje mogą używać istniejącej wiadomości.

Trzeba zachować informację o trybie Historii także w wariancie inline
(np. przekazując do iframe parametr trybu), inaczej guard `live=0` nie ma
URL, z którego odczyta tę informację. Zmianę shell koordynuje jego właściciel
po wydzieleniu doku. Nie zmieniono transportu ani API.

Wyłączenie pollera całego iframe w Na żywo wymaga osobnego rozwiązania:
shell obecnie nie przekazuje surowego feedu, z którego 3D rysuje pinezki.
