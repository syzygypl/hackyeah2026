# Rescue Locator (DEFENCE) - changelog zgłoszenia

## v4 - 2026-10-03 23:10 (main `f54c390`, Vercel `b00b3e1`)

- **Bez deklaracji pracy offline:** model w pokazie to OpenAI, z regułami jako zapasem. Lokalny model wymieniamy tylko jako możliwość w kodzie.
- **Nowe funkcje:**
  - ciągła oś czasu 1x-30x z grupami zdarzeń (`ef5f100`) i Kino za grupami (`f54c390`),
  - wagi wskazówek z ręczną korektą (`bd88de5`, `08f5029`),
  - Zasoby i karta zespołu (`54b0204`, `356458c`),
  - Doradca przy wielu akcjach, np. ćwiczenie awarii zapory z 7 akcjami (`35045fb`),
  - Ćwiczenia (`c043d18`, `285ee6a`),
  - analiza zdjęcia (`1250eb7`), opisana wprost jako **demo syntetyczne**,
  - scenariusz rodzina-dziecko-las (`2303503`),
  - `/landing` ze statusem funkcji (`e6a7d02`).
- Na produkcji jest 18 fikcyjnych scenariuszy (`/api/scenarios`).
- 3D FOV jest w przebudowie i go nie pokazujemy.
- Supervisorem tematu 2 jest AI Andrzeja.
- **Deck:** slajd 7 to teraz "Jeden serwer, wiele narzędzi", ze zrzutem `14-2d-os-czasu`. Slajd 10 linkuje `/landing`.

## v3 - 2026-10-03 20:50 (main `4e48798`, Vercel `4e48798`)

- **Demo online:** https://rescue-locator.vercel.app ze stroną startową, pokazem w 90 s (`?tour=1`), Centrum i stroną "Widziałem".
- **Nowe w produkcie:**
  - tryb Na żywo z kursorem wspólnym dla wszystkich ("Następne zdarzenie"),
  - Centrum z wieloma akcjami i wspólną pulą zespołów,
  - akcje bieżące i zakończone rozdzielone,
  - kompaktowa oś czasu,
  - zgłoszenia świadków "Widziałem" z GPS,
  - scenariusz Kraków, Nowa Huta.
- **Decyzja Mateusza: dwa zgłoszenia.** Ten folder to DEFENCE. Wariant Smart City jest w `../../rescue-locator-smartcity/v3/` i ma osobny artefakt.
- **Opis trybu pracy:** "działa offline w terenie - lokalny model i mapy offline na laptopie; pokaz online używa modelu w chmurze". Model OpenAI, Vercel i Neon są ujawnione w §9.
- **POA tylko jako "waga mapy".**
- **Deck:** 10 slajdów ze zrzutami z `docs/rescue-locator/shots/` (Zawrat na żywo, Centrum, telefon, Śniardwy, Kraków). Nowe slajdy: "Trzy role" i "Centrum i teren".
- **`start.sh`:** idzie za zmianą `da5731b` (jeden serwer :8780 zamiast field/studio) i dodaje adresy Krakowa, Centrum i "Widziałem".

## v2 - 2026-10-03 17:00

Kalibracja na symulowanych przypadkach, `rescue-server`, bez etykiet "tymczasowe".

## v1.1 / v1 - 2026-10-03 15:00-15:30

Pierwsza wersja, `start.sh`, polskie fonty, finał Found.

Artefakt (kolejne wersje publikujemy pod tym samym URL-em): https://claude.ai/artifact/3Ugs55sfo5DLBnQ9evURGm
