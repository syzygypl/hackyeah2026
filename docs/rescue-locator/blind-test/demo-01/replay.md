# Demo 01: test na ślepo blind-01, odtworzenie

Scenariusz rundy blind-01 jako demo do obejrzenia. Jedno AI (AI Marcina) chowa zaginionego i odpowiada na patrole tak, jak odpowiedziałby teren. Pozostałe AI szukają samą aplikacją. Pełny dziennik: [`../log.md`](../log.md).

**Status: szablon.** Wyniki wpisujemy dopiero z wątku. Nic tutaj nie jest zgadywane. Wszystko z oznaczeniem (po odsłonięciu) zostaje puste do odsłonięcia.

## Runda

- **Start:** 14:40 (Kraków), sędzia AI Marcina.
- **Zobowiązanie:** `fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474` (SHA-256 z `{"round","at","salt"}`).
- **Sprawa:** Ewa K. (osoba fikcyjna), 34 lata, sama, dobra kondycja. Partner zgłasza o 18:15. Planowana pętla Palenica - Roztoka (...). Bez GPS.
- **Teren:** prawdziwy OSM + DEM, ten sam obszar co zawrat (291a655).
- **Szukający:** agent szukający AI Mateusza, AI Denisa, AI Michała.
- **Koniec:** ZNALEZIONO albo 01:00 czasu scenariusza (6 h).

## Jak odtworzyć

```sh
cd rescue
swift run rescue-demo --fast scenarios/blind-01.json      # pisze out/blind-01.html i out/blind-01.run.json
# odpowiedzi sędziego i meldunki patroli jako live events:
cp <plik live events rundy blind-01> out/live-events.json   # ? ścieżka do potwierdzenia z agentem szukającym
swift run rescue-field replay                                # scenariusz + live-events.json, top 3 po każdym meldunku (? czy bierze blind-01)
python3 -m http.server 8000 &                                 # z katalogu rescue/
open "http://localhost:8000/web/?run=../out/blind-01.run.json&scenario=../scenarios/blind-01.json"
```

Ekrany:

| Kiedy | Ekran | Adres |
|---|---|---|
| Wskazówki, mapa, top 3, przydział zespołów | Ekran kierownika akcji | `http://localhost:8000/web/?run=../out/blind-01.run.json&scenario=../scenarios/blind-01.json` |
| Patrol w terenie, meldunek "Przeszukane" / "ŚLAD / ZNALEZIONO" | Widok patrolu (telefon) | `swift run rescue-field serve` + `http://127.0.0.1:8772/web/patrol/?team=topr-a` (serwer `python3 -m http.server 8772` w `rescue/`) |
| Jak powstała sprawa (opcjonalnie) | Story Studio | `swift run rescue-studio` -> `http://127.0.0.1:8771/` |
| Odsłonięcie | Terminal: sól + `reveal.py` (weryfikacja hasha, metryki) | (po odsłonięciu) |

## Scenariusz minuta po minucie

Czas scenariusza / czas demo. Uzupełniane z wątku.

| Czas scen. | Demo | Co się dzieje | Ekran | Źródło w wątku |
|---|---|---|---|---|
| ... | 0:00 | Zgłoszenie: ... | kierownik, oś czasu | |
| ... | ... | Wskazówki: start w schronisku (S3), świadek 13:40 (S5), ostatni sektor BTS (S12), mgła powyżej 1800 m od 13:30 | kierownik, oś czasu i mapa | |
| 19:00 | ... | Mapa: S3 27,2%, S2 17,3%, S13 16,0%. Top 3 = 60% POA na 18% obszaru. Śmigłowiec uziemiony (widzialność 40 m), hipotermia wysoka | kierownik, panel top 3 | ~14:47 |
| 19:00-19:15 | ... | Fala 1: TOPR A -> S5, S12 (planer: S2); dron -> S3; TOPR B -> S13, S12 (planer: S5 z Murowańca, 115 min); pies -> S4. Dlaczego: świadek + telefon wskazują drogę na przełęcz, a we mgle szlak gubi się na piargu | kierownik, przydział zespołów | ~14:47 |
| fala 1 | ... | Sędzia: wszędzie "nic" (S5, S12, S3, S13, S4). Puste wróciły i przydziały planera, i odejścia od niego | widok patrolu -> kierownik | 14:48 |
| 19:00 | ... | Kontrola: niezależny przebieg AI Denisa daje identyczne top 3 (silnik deterministyczny). Propozycja: S2 | kierownik | 14:48 |
| 23:00 | ... | Po fali 1: S12 spada z 8,3% do 3,7%. Top 3: S3 29,0%, S2 25,3%, S13 12,8% | kierownik, mapa przed / po | 14:56 |
| 19:20-23:00 | ... | Fala 2: dron -> S3; pies -> S2 (planer + AI Denisa); TOPR A -> S18 Dolina za Mnichem (odejście: zejście żlebem we mgle); TOPR B -> S4, S6 | kierownik, przydział zespołów | 14:56 |
| fala 2 | ... | Sędzia: wszędzie "nic". Osiem przydziałów, zero śladów. Noc | widok patrolu -> kierownik | 14:53 |
| - | ... | AI Michała: pierścienie startują od schroniska 11:50, a powinny od ostatniego znanego punktu (świadek 13:40, S5). Silnik zamrożony do odsłonięcia, zasadę LKP szukający stosują ręcznie | kierownik, mapa z pierścieniami | 14:52 |
| ... | ... | Przeliczenie: top 3 = ... | kierownik, mapa | |
| ... | ... | ... (kolejne fale) | | |
| 19:35-00:55 | ... | Fala 3: start od ostatniego znanego punktu (świadek 13:40, S5), zastosowany ręcznie. Dron -> S12 (planer: S3 trzeci raz); pies -> S5; TOPR A -> S4; TOPR B -> S7 | kierownik, przydział zespołów | 14:57 |
| 19:35 | ... | **ZNALEZIONO w S12** (dron). Pozostałe: nic. Koniec rundy po 12 przydziałach | widok patrolu -> kierownik | ok. 14:58 |
| - | ... | Odsłonięcie: miejsce, sól, hash zgodny? | terminal | (po odsłonięciu) |

## Metryki (po odsłonięciu)

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, S12, fala 3, dron (miejsce po odsłonięciu) |
| Patrole do znalezienia | 12 przydziałów w 3 falach |
| Ranga prawdziwego segmentu przed 1. patrolem | |
| Procent obszaru przeszukany do znalezienia | |
| Czas do znalezienia vs naiwne przeszukiwanie | |
| Odległość od szczytu mapy | |
| Hash zgodny | |

## Lektor (30 s, PL)

Nawias kwadratowy uzupełniamy po odsłonięciu.

> Nie wiemy, gdzie jest Ewa. Wie tylko AI, które ją schowało, i zapisało to miejsce jako hash, zanim zaczęliśmy. Mamy to, co ratownik miałby naprawdę: plan od partnera, świadka w schronisku, sektor BTS, mgłę. Dwie fale patroli, osiem razy "nic". Wtedy liczymy od ostatniego miejsca, gdzie ktoś ją widział, a nie od schroniska. Trzecia fala: dron nad Szpiglasową Przełęczą. Znaleziona. Uczciwie: planer wysłałby drona gdzie indziej, tę poprawkę zrobiliśmy ręcznie. [Odsłonięcie: hash się zgadza.]
