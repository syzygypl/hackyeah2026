# Demo 02: test na ślepo blind-02, odtworzenie

Scenariusz rundy blind-02 jako demo do obejrzenia. Jedno AI (AI Marcina) chowa zaginionego i odpowiada na patrole tak, jak odpowiedziałby teren. Pozostałe AI szukają samą aplikacją. Pełny dziennik: [`../log.md`](../log.md).

**Status: runda zakończona i odsłonięta (a0476e0).** N = 2, nie liczba do pitchu. Pierwsza runda na poprawionym silniku (aa18405).

## Runda

- **Sędzia:** AI Marcina. Zapieczętowana tabela wykrywalności zespołów (hash `16d6659a...fbbcd8`); nasz deklarowany POD kształtuje tylko naszą mapę.
- **Zobowiązanie:** `4af5d1ccfbe25f9c76429dda75a3c452a93606fd6f3657cbd17250c24d8e92f7` (SHA-256)
- **Sprawa:** Stanisław M. (osoba fikcyjna), 79 lat, wczesna demencja, bez telefonu. Wyszedł z pensjonatu przy Drodze pod Reglami ok. 14:30, córka zgłasza o 16:40.
- **Teren:** Dolina ku Dziurze i okolice (D-segmenty)
- **Szukający:** agent szukający AI Mateusza, AI Denisa, AI Michała.
- **Wynik:** ZNALEZIONO przez TOPR A w D18 o 21:20, fala 3.

## Jak odtworzyć

Odtworzenie 1:1: wskazówki i patrole do znalezienia, z odsłoniętą prawdą (`scenarios/blind-02-replay.json`, teren `blind-02-replay-terrain.json`).

```sh
cd rescue
swift run rescue-demo --fast scenarios/blind-02-replay.json   # pisze out/blind-02-replay.html i out/blind-02-replay.run.json
python3 -m http.server 8000 &                                  # z katalogu rescue/
open "http://localhost:8000/web/?run=../out/blind-02-replay.run.json&scenario=../scenarios/blind-02-replay.json"
python3 blindtest/reveal.py --round blind-02 --at 49.27003,19.93961 --salt 015f869f614028292cef1826ca988a5a --run out/blind-02-replay.run.json
# -> commitment OK 4af5d1ccfbe25f9c76429dda75a3c452a93606fd6f3657cbd17250c24d8e92f7
```

Ekrany:

| Kiedy | Ekran | Adres |
|---|---|---|
| Wskazówki, mapa, top 3, przydział zespołów | Ekran kierownika akcji | `http://localhost:8000/web/?run=../out/blind-02-replay.run.json&scenario=../scenarios/blind-02-replay.json` |
| Patrol w terenie, meldunek "Przeszukane" / "ŚLAD / ZNALEZIONO" | Widok patrolu (telefon) | `swift run rescue-field serve` + `http://127.0.0.1:8772/web/patrol/?team=topr-a` (serwer `python3 -m http.server 8772` w `rescue/`) |
| Jak powstała sprawa (opcjonalnie) | Story Studio | `swift run rescue-studio` -> `http://127.0.0.1:8771/` |
| Odsłonięcie | Terminal: `reveal.py` (oba hashe, metryki) | komenda powyżej |

## Scenariusz minuta po minucie

Godziny z pliku sędziego. Sędzia numeruje przelot drona o 17:45 jako falę 1, więc nasza fala 3 to u niego fala 4. Zespoły w pliku: `gopr-a`, `gopr-b`.

| Czas scen. | Co się dzieje | Ekran |
|---|---|---|
| 14:30 | Wychodzi z pensjonatu przy Drodze pod Reglami | kierownik, oś czasu |
| 16:40 | Córka zgłasza zaginięcie. Demencja, bez telefonu | kierownik, oś czasu |
| 17:45 | Mapa: D13 Dolina ku Dziurze 87% (tam znaleziono czapkę). Dron -> D13: nic | kierownik, mapa + top 3 |
| 18:00 | Fala 1: śmigłowiec D12, pies D13 od czapki, TOPR A D13 (dolina i jaskinia), TOPR B D12 + D17. Wszystko: nic | przydział -> widok patrolu |
| 19:10-20:15 | Fala 2: pies D8 przy pensjonacie 19:10 (odejście od planera), patrol A D14 19:30, patrol B D7 20:15. Śmigłowiec uziemiony po zmroku. Wszystko: nic | przydział -> widok patrolu |
| 20:25-22:30 | Fala 3: agent-szukający: czapka na początku szlaku, demencja = prosto, aż utknie (planer powtarzał D14). Pies D3 20:25, patrol A -> D18 stromy las za Jaskinią Dziura (odejście), patrol B D12 + D11 22:30, dron zbocza D13 nocą (nieoceniony) | przydział |
| 21:20 | **ZNALEZIONO przez patrol A w D18** (13. przeszukanie segmentu). Po zdarzeniu "Found" komórka #3, szczyt mapy 75 m od miejsca | widok patrolu -> kierownik |

**Odsłonięcie** (a0476e0): miejsce 49.27003, 19.93961 (D18, młodnik nad Potokiem ku Dziurze, ok. 200 m od szlaku), sól `015f869f614028292cef1826ca988a5a`, tabela wykrywalności: naziemny 0,45, pies 0,6, dron 0,25, śmigłowiec 0,15. Oba hashe zgodne.

Wniosek do powiedzenia: Dwie rundy na ślepo, obie znalezione w 3. fali, obie dzięki decyzji agenta-szukającego AI, który odszedł od planera, stosując wiedzę o zachowaniu zaginionych (LKP Koestera, demencja: prosto do utknięcia), której silnik jeszcze nie miał. Każdą lekcję wpisujemy do silnika i mierzymy w kolejnej rundzie. Wartość dziś: aplikacja + ocena ratownika, a nie sam planer.

## Metryki (odsłonięte, stan o 17:45 przed patrolami)

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, 21:20, patrol A, D18, fala 3 |
| Patrole do znalezienia | 13. przeszukanie segmentu w kolejności czasu |
| Ranga prawdziwego segmentu przed 1. patrolem | #8 z 20 (same pierścienie: #10); top 3 planera: D13, D8, D12 |
| Procent obszaru przeszukany do znalezienia | 37,4% |
| Naiwnie od pensjonatu | 35,7%: sama mapa nie pomogła |
| Odległość od szczytu mapy | ok. 1,0 km |
| Hash zgodny | tak, zobowiązanie i tabela wykrywalności |

## Lektor (30 s, PL)


> Stanisław, 79 lat, wczesna demencja, bez telefonu. Wyszedł z pensjonatu po obiedzie. Mapa wskazuje dolinę, w której leżała jego czapka: 87 procent. Dron, pies, dwa patrole: nic. Druga fala: nic. Wtedy agent-szukający przypomina sobie, jak chodzą osoby z demencją: prosto, aż utkną. Trzecia fala idzie w stromy las za jaskinią. 21:20: znaleziony. Odsłonięcie: hash się zgadza. Uczciwie: tym razem sama mapa nie pomogła, wypadła jak szukanie na oślep od pensjonatu. Znalazło rozumowanie agenta. Tę wiedzę wpisujemy do silnika.
