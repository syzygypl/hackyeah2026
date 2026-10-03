# Demo 01: test na ślepo blind-01, odtworzenie

Scenariusz rundy blind-01 jako demo do obejrzenia. Jedno AI (AI Marcina) chowa zaginionego i odpowiada na patrole tak, jak odpowiedziałby teren. Pozostałe AI szukają samą aplikacją. Pełny dziennik: [`../log.md`](../log.md).

**Status: runda zakończona i odsłonięta (14:59, ad2ced5).** To jedna runda, nie liczba do pitchu.

## Runda

- **Start:** 14:40 (Kraków), sędzia AI Marcina.
- **Zobowiązanie:** `fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474` (SHA-256 z `{"round","at","salt"}`).
- **Sprawa:** Ewa K. (osoba fikcyjna), 34 lata, sama, dobra kondycja. Partner zgłasza o 18:15. Planowana pętla Palenica - Roztoka (...). Bez GPS.
- **Teren:** prawdziwy OSM + DEM, ten sam obszar co zawrat (291a655).
- **Szukający:** agent szukający AI Mateusza, AI Denisa, AI Michała.
- **Koniec:** ZNALEZIONO albo 01:00 czasu scenariusza (6 h).

## Jak odtworzyć

Odtworzenie 1:1: wskazówki i patrole do znalezienia, z odsłoniętą prawdą do metryk (`scenarios/blind-01-replay.json`, od AI Marcina).

```sh
cd rescue
swift run rescue-demo --fast scenarios/blind-01-replay.json   # pisze out/blind-01-replay.html i out/blind-01-replay.run.json
python3 -m http.server 8000 &                                  # z katalogu rescue/
open "http://localhost:8000/web/?run=../out/blind-01-replay.run.json&scenario=../scenarios/blind-01-replay.json"
# odsłonięcie i weryfikacja hasha:
python3 blindtest/reveal.py --round blind-01 --at 49.19597,20.04655 --salt 3746db96b11d2df56179ef326b6c29b3 --run out/blind-01-replay.run.json
# -> commitment OK fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474
```

Ekrany:

| Kiedy | Ekran | Adres |
|---|---|---|
| Wskazówki, mapa, top 3, przydział zespołów | Ekran kierownika akcji | `http://localhost:8000/web/?run=../out/blind-01-replay.run.json&scenario=../scenarios/blind-01-replay.json` |
| Patrol w terenie, meldunek "Przeszukane" / "ŚLAD / ZNALEZIONO" | Widok patrolu (telefon) | `swift run rescue-field serve` + `http://127.0.0.1:8772/web/patrol/?team=topr-a` (serwer `python3 -m http.server 8772` w `rescue/`) |
| Jak powstała sprawa (opcjonalnie) | Story Studio | `swift run rescue-studio` -> `http://127.0.0.1:8771/` |
| Odsłonięcie | Terminal: `reveal.py` (weryfikacja hasha, metryki) | komenda powyżej |

## Scenariusz minuta po minucie

Kontekst i oś patroli posortowana po czasie scenariusza. Każdy zespół ma swój zegar: fala 3 drona ruszyła o 19:35, zaraz po jego przelocie z fali 2. Kolumna "Fala" mówi, w której fali przydział został wysłany.

**Kontekst**

| Czas scen. | Co się dzieje | Ekran | Wątek |
|---|---|---|---|
| ... | Zgłoszenie od partnera o 18:15. Wskazówki: start w schronisku (S3), świadek 13:40 (S5), ostatni sektor BTS (S12), mgła powyżej 1800 m od 13:30 | kierownik, oś czasu i mapa | |
| 19:00 | Mapa: S3 27,2%, S2 17,3%, S13 16,0%. Top 3 = 60% POA na 18% obszaru. Śmigłowiec uziemiony (widzialność 40 m), hipotermia wysoka | kierownik, panel top 3 | ~14:47 |
| 19:00 | Kontrola: niezależny przebieg AI Denisa daje identyczne top 3 (silnik deterministyczny) | kierownik | 14:48 |
| - | AI Michała: pierścienie startują od schroniska 11:50 zamiast od ostatniego pewnego punktu (świadek 13:40, S5). Silnik zamrożony do odsłonięcia | kierownik, mapa z pierścieniami | 14:52 |
| 23:00 | Po fali 1: S12 spada z 8,3% do 3,7%. Top 3: S3 29,0%, S2 25,3%, S13 12,8% | kierownik, mapa przed / po | 14:56 |

**Patrole po czasie**

| Start | Zespół | Fala | Segment | Planer | POD | Wynik | Ekran |
|---|---|---|---|---|---|---|---|
| 19:00 | TOPR A | 1 | S5, S12 | S2 | 0,45 | nic | przydział -> patrol |
| 19:05 | Dron | 1 | S3 | S3 | 0,27 | nic | przydział -> patrol |
| 19:10 | TOPR B | 1 | S13, S12 | S5 | 0,45 | nic | przydział -> patrol |
| 19:15 | Pies | 1 | S4 | S4 | 0,55 | nic | przydział -> patrol |
| 19:20 | Dron | 2 | S3 | S3 | 0,27 | nic | przydział -> patrol |
| **19:35** | **Dron** | **3** | **S12** | S3 (trzeci raz) | 0,35 | **ZNALEZIONO** | widok patrolu -> kierownik |
| 20:25 | Pies | 2 | S2 | S2 | 0,56 | nic | |
| 21:30 | TOPR A | 2 | S18 Dolina za Mnichem | S13 | 0,40 | nic | |
| 21:50 | Pies | 3 | S5 | S2 | 0,55 | nic | |
| 23:00 | TOPR B | 2 | S4, S6 | S4 | 0,46 | nic | |
| 23:10 | TOPR A | 3 | S4 | S4 | 0,46 | nic | |
| 00:55 | TOPR B | 3 | S7 | S5 | 0,40 | nic | |

Na demo pokazujemy patrole do 19:35. Przydziały z późniejszym startem były wysłane w tych samych falach i sędzia na nie odpowiedział, ale po znalezieniu o 19:35 w prawdziwej akcji by nie wyruszyły.

Wniosek do powiedzenia: blind-01: znaleziona w 3. fali (12 przydziałów). Zadecydował agent-szukający AI, który ręcznie zastosował zasadę Koestera IPP = ostatni pewny punkt (świadek 13:40), której zamrożony silnik jeszcze nie miał; planer sam wysłałby drona nad S3. Wniosek: poprawka #1 trafia do silnika i sprawdzamy ją w blind-02/03. S12 miał wcześniej dwa przejścia we mgle (POD 0,45 każde), które jej nie znalazły: realistyczny POD poniżej 1.

**Odsłonięcie** (terminal, `reveal.py`, 14:59): miejsce 49.19597, 20.04655 (S12, piarg nad Stawami Staszica, ok. 280 m od szlaku), sól `3746db96b11d2df56179ef326b6c29b3`, hash zgodny.

## Metryki (odsłonięte, stan o 19:00 przed pierwszym patrolem)

| Metryka | Wartość |
|---|---|
| Znaleziony | tak, 19:35, S12, dron, fala 3 |
| Patrole do znalezienia | 8. przeszukanie segmentu w kolejności czasu (12 przydziałów w 3 falach) |
| Ranga prawdziwego segmentu przed 1. patrolem | #5 z 20 (same pierścienie: #11) |
| Procent obszaru przeszukany do znalezienia | 4,1% (same pierścienie 18,7%) |
| Naiwnie od schroniska | 32,3% obszaru (silnik ok. 8x lepiej) |
| Odległość od szczytu mapy | 1,95 km (szczyt przy schronisku) |
| Hash zgodny | tak |

## Lektor (30 s, PL)


> Nie wiemy, gdzie jest Ewa. Wie tylko AI, które ją schowało, i zapisało to miejsce jako hash, zanim zaczęliśmy. Mamy to, co ratownik miałby naprawdę: plan od partnera, świadka w schronisku, sektor BTS, mgłę. Dwie fale patroli, osiem razy "nic". Wtedy liczymy od ostatniego miejsca, gdzie ktoś ją widział, a nie od schroniska. Trzecia fala: dron nad Szpiglasową Przełęczą. Znaleziona. Uczciwie: planer wysłałby drona gdzie indziej, tę decyzję podjął agent-szukający. Odsłonięcie: hash się zgadza, miejsce było zapisane, zanim zaczęliśmy. To jedna runda, nie wynik. Mapa miała ją w najlepszych czterech procentach obszaru.
