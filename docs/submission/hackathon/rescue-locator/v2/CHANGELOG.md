# Rescue Locator - changelog zgłoszenia

## v2 - 2026-10-03 17:00 (main `0ab7bca`, zgodne z `e4ef6f3`)

- **Liczby wartości:** kalibracja na symulowanych przypadkach zamiast liczb "tymczasowych".
  - Góry, 1000 przypadków: top 3 w 66% vs ekspert 56% vs od ostatniego punktu 43%. Obszar dla 90% osób: 29% vs 37% vs 68% (`report-land.md`).
  - Woda, 600 przypadków: top 3 w 91% vs 81%. Gorzej dla pływaka na jeziorze (`WATER.md`).
  - "Symulacja, nie prawdziwe akcje" mówimy raz, na slajdzie 8 i w §5.
- **Zasada liczb:** podajemy ranking i obszar. Procentów POA nie podajemy jako szans, bo powyżej ~30% są zawyżone. Usunięte: "42% na 8% obszaru" i "20% szansy w 1 h 46 min". Teraz: top 3 = ok. 7% obszaru, a planer to szacunek modelu bez zysku (15% vs 16% po 2 h).
- **Test na ślepo:** blind-01 i blind-02, N = 2, jako przypis. W rundzie 2 mapa nie pomogła. Oba odnalezienia dała decyzja koordynatora.
- **Produkt:**
  - `rescue-server` na jednym porcie,
  - aplikacja operatora (2D, 3D, podział, polskie teksty interfejsu),
  - telefony ratowników,
  - pokaz na wielu urządzeniach,
  - 3D dla wszystkich regionów (`447c8ef`),
  - pamięć planera (`b17daf1`).
  - Pływający układ (AI Andrzeja) jest wymieniony jako przebudowa w toku.
- **Deck:** nowe slajdy 7 (aplikacja i urządzenia), 8 (tabela kalibracji) i 9. Zrzut z widoku 3D (19:45, z podpisem, że procenty to wagi). Bez etykiet "tymczasowe".
- **`start.sh`:** dochodzi `rescue-server` :8780 oraz adresy `/app/`, 3D, telefonu i monitoringu. Skrypt podpowiada port pokazu 8791 (8790 zajmuje Airlock).
- **`checklist.md`:** nowe punkty 4, 7 i 9.

## v1.1 - 2026-10-03 15:30 (main `5377d33`)

`start.sh`, polskie fonty, finał zawrat zdarzeniem Found ze śmigłowca, wynik blind-01.

## v1 - 2026-10-03 15:00 (main `504cd04`)

Pierwsza wersja.

Artefakt (kolejne wersje publikujemy pod tym samym URL-em): https://claude.ai/artifact/3Ugs55sfo5DLBnQ9evURGm
