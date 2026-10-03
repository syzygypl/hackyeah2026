# Demo 02: test na ślepo blind-02, odtworzenie

Scenariusz rundy blind-02 jako demo do obejrzenia. Jedno AI (AI Marcina) chowa zaginionego i odpowiada na patrole tak, jak odpowiedziałby teren. Pozostałe AI szukają samą aplikacją. Pełny dziennik: [`../log.md`](../log.md).

**Status: runda zakończona (ZNALEZIONO), odsłonięcie jeszcze nie nastąpiło.** Pierwsza runda na poprawionym silniku (aa18405).

## Runda

- **Sędzia:** AI Marcina. Zapieczętowana tabela wykrywalności zespołów (hash `16d6659a...fbbcd8`); nasz deklarowany POD kształtuje tylko naszą mapę.
- **Zobowiązanie:** `4af5d1ccfbe25f9c76429dda75a3c452a93606fd6f3657cbd17250c24d8e92f7` (SHA-256)
- **Sprawa:** Stanisław M. (osoba fikcyjna), 79 lat, wczesna demencja, bez telefonu. Wyszedł z pensjonatu przy Drodze pod Reglami ok. 14:30, córka zgłasza o 16:40.
- **Teren:** Dolina ku Dziurze i okolice (D-segmenty)
- **Szukający:** agent szukający AI Mateusza, AI Denisa, AI Michała.
- **Wynik:** ZNALEZIONO przez TOPR A w D18 o 21:20, fala 3.

## Jak odtworzyć

```sh
cd rescue
swift run rescue-demo --fast scenarios/blind-02.json      # pisze out/blind-02.html i out/blind-02.run.json
# odpowiedzi sędziego i meldunki patroli jako live events:
cp <plik live events rundy blind-02> out/live-events.json   # ? ścieżka do potwierdzenia z agentem szukającym
swift run rescue-field replay                                # scenariusz + live-events.json, top 3 po każdym meldunku (? czy bierze blind-02)
python3 -m http.server 8000 &                                 # z katalogu rescue/
open "http://localhost:8000/web/?run=../out/blind-02.run.json&scenario=../scenarios/blind-02.json"
```

Ekrany:

| Kiedy | Ekran | Adres |
|---|---|---|
| Wskazówki, mapa, top 3, przydział zespołów | Ekran kierownika akcji | `http://localhost:8000/web/?run=../out/blind-02.run.json&scenario=../scenarios/blind-02.json` |
| Patrol w terenie, meldunek "Przeszukane" / "ŚLAD / ZNALEZIONO" | Widok patrolu (telefon) | `swift run rescue-field serve` + `http://127.0.0.1:8772/web/patrol/?team=topr-a` (serwer `python3 -m http.server 8772` w `rescue/`) |
| Jak powstała sprawa (opcjonalnie) | Story Studio | `swift run rescue-studio` -> `http://127.0.0.1:8771/` |
| Odsłonięcie | Terminal: sól + `reveal.py` (weryfikacja hasha, metryki) | (po odsłonięciu) |

## Scenariusz minuta po minucie

Czasy z wątku. Dokładne godziny startu patroli w falach 2 i 3 uzupełnimy z pliku odtworzenia po odsłonięciu.

| Czas scen. | Co się dzieje | Ekran |
|---|---|---|
| 14:30 | Wychodzi z pensjonatu przy Drodze pod Reglami | kierownik, oś czasu |
| 16:40 | Córka zgłasza zaginięcie. Demencja, bez telefonu | kierownik, oś czasu |
| 17:45 | Mapa: D13 Dolina ku Dziurze 87% (tam znaleziono czapkę). Dron -> D13: nic | kierownik, mapa + top 3 |
| 18:00 | Fala 1: śmigłowiec D12, pies D13 od czapki, TOPR A D13 (dolina i jaskinia), TOPR B D12 + D17. Wszystko: nic | przydział -> widok patrolu |
| fala 2 | Pies D8 przy pensjonacie (odejście od planera), TOPR A D14, TOPR B D7. Śmigłowiec uziemiony po zmroku. Wszystko: nic | przydział -> widok patrolu |
| fala 3 | Agent-szukający: czapka na początku szlaku, demencja = prosto, aż utknie. TOPR A -> D18 stromy las za Jaskinią Dziura (odejście). Pies D3, TOPR B D12 + D11, dron zbocza D13 nocą | przydział |
| 21:20 | **ZNALEZIONO przez TOPR A w D18** | widok patrolu -> kierownik |

**Odsłonięcie:** (po odsłonięciu)

Wniosek do powiedzenia: Dwie rundy na ślepo, obie znalezione w 3. fali, obie dzięki decyzji agenta-szukającego AI, który odszedł od planera, stosując wiedzę o zachowaniu zaginionych (LKP Koestera, demencja: prosto do utknięcia), której silnik jeszcze nie miał. Każdą lekcję wpisujemy do silnika i mierzymy w kolejnej rundzie. Wartość dziś: aplikacja + ocena ratownika, a nie sam planer.

## Metryki (po odsłonięciu)

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, 21:20, TOPR A, D18, fala 3 |
| Patrole do znalezienia | |
| Ranga prawdziwego segmentu przed 1. patrolem | |
| Procent obszaru przeszukany do znalezienia | |
| Czas do znalezienia vs naiwne przeszukiwanie | |
| Odległość od szczytu mapy | |
| Hash zgodny | |

## Lektor (30 s, PL)

Nawias kwadratowy uzupełniamy po odsłonięciu.

> Stanisław, 79 lat, wczesna demencja, bez telefonu. Wyszedł z pensjonatu po obiedzie. Mapa wskazuje dolinę, w której leżała jego czapka: 87 procent. Dron, pies, dwa patrole: nic. Druga fala: nic. Wtedy agent-szukający przypomina sobie, jak chodzą osoby z demencją: prosto, aż utkną. Trzecia fala idzie w stromy las za jaskinią. 21:20: znaleziony. [Odsłonięcie: hash się zgadza.] Uczciwie: planer by tam nie posłał. Tę wiedzę wpisujemy do silnika.
