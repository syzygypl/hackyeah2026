# Rescue Locator - changelog zgłoszenia

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

Zmiany po uwagach Mateusza do v1.

- **Polskie znaki w decku:** `<meta charset="utf-8">` jest teraz pierwszą linią `deck.html`. Bez niego plik otwarty lokalnie do eksportu PDF mógł być czytany jako Latin-1. Treść jest w Source Sans 3 z podzbiorem `latin-ext`, nagłówki zostają w Barlow Condensed (też latin-ext). Sprawdzone:
  - zrzut z headless Chrome pokazuje poprawne ą ć ę ł ń ó ś ź ż,
  - eksport PDF ma 10 stron,
  - w plikach źródłowych nie ma mojibake (grep Ã, Å, Ä).
- **Nowy `start.sh`:**
  - `swift build`, potem `rescue-demo --fast scenarios/zawrat.json`,
  - serwery: `python3 -m http.server` :8000, `rescue-field serve` :8770, `rescue-studio` :8771,
  - Ollama opcjonalna, bez niej meldunki parsują reguły,
  - wypisuje URL-e, `stop` zatrzymuje uruchomione procesy.
  - Odwołanie do skryptu jest w `submission.md` §6 i na slajdzie 10.
- **Finał zawrat:** zdarzenie Found ze śmigłowca TOPR (kamera termowizyjna) o 20:03 zamyka akcję (`dad13be`). Poprawione w `submission.md`, na slajdzie 6, w `docs/rescue-locator/pitch.md` i `docs/rescue-locator/video.md`. `rescue/README.md` linie 39 i 124 zostają dla dewelopera (checklista, punkt 7).
- **Test na ślepo:** blind-01 znaleziona w S12 w 3. fali, hash zgodny. Metryki są w `submission.md` §5 i na slajdzie 8, razem z zastrzeżeniem, że to jedna runda. Poprawki silnika po odsłonięciu: `e7cc2cf`, `dad13be`, `f53b69c`.
- `checklist.md`: punkty 1, 7 i 8 zaktualizowane.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Pierwsza wersja: `submission.md`, `slides.md`, `checklist.md`, `deck.html`.

Artefakt (kolejne wersje publikujemy pod tym samym URL-em): https://claude.ai/artifact/3Ugs55sfo5DLBnQ9evURGm
