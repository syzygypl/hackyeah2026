# Rescue Locator (DEFENCE) - changelog zgłoszenia

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
