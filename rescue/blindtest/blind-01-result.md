# Test na ślepo - runda blind-01: wynik

**Odsłonięcie:** at = [49.19597, 20.04655], salt = `3746db96b11d2df56179ef326b6c29b3`. Sprawdzenie: `python3 rescue/blindtest/reveal.py --round blind-01 --at 49.19597,20.04655 --salt 3746db96b11d2df56179ef326b6c29b3 --run rescue/out/blind-01-replay.run.json` -> commitment OK (fdd079df...b474).

**Historia (chowający):** Zgubiła żółty szlak we mgle tuż za Szpiglasową Przełęczą przy zejściu w stronę Morskiego Oka, zeszła za daleko na południowy zachód w piarg nad Wyżnim/Niżnim Stawem Staszica, poślizg, uraz kostki, siedzi pod blokiem skalnym ok. 280 m od szlaku. Stan: alive, immobile, phone off since 15:05.

## Wynik
- **ZNALEZIONO o 19:35** (czas scenariusza) w **S12 Szpiglasowa Przełęcz**, przez drona termowizyjnego w fali 3, przy 8. przeszukaniu segmentu w akcji.
- S12 był przeszukany już w fali 1 dwa razy (TOPR A 19:00 i TOPR B 19:10, POD 0,45): oba razy "nic". To realistyczne pudło przy POD < 1.
- **Znalezienie przyszło z decyzji AI szukającego wbrew planerowi** (planer trzeci raz dawał drona nad S3 przy schronisku). Sam planer w tym czasie by jej nie znalazł.

## Jak dobrze wskazywał silnik (stan o 19:00, wszystkie wskazówki, przed pierwszym patrolem)
| Miara | Silnik (fuzja) | Dla porównania |
|---|---|---|
| Ranga prawdziwego segmentu S12 | **#5 z 20** (8,3% POA) | #11 przy samym terenie + pierścieniach Koestera |
| Ranga prawdziwej komórki | 147 / 3600 | 673 po samych pierścieniach |
| Obszar do przeszukania w kolejności POA, zanim trafimy w komórkę | **4,1%** | **32,3%** przy naiwnym przeszukiwaniu od IPP (schronisko), 18,7% po samych pierścieniach |
| Odległość szczytu mapy od miejsca | 1,95 km (szczyt przy schronisku, S3) | - |
| Top 1 planera | S3 Schronisko 27% (źle) | - |

Wskazówka, która najbardziej pomogła: **sektor BTS 14:48** (komórka z 342 na 171, segment z #7 na #5).

## Uczciwe wnioski
1. **Silnik zawęża dobrze, ale nie trafia w top:** prawdziwa komórka w najlepszych ~4% obszaru (8x lepiej niż naiwnie od IPP), ale segment dopiero #5, a szczyt mapy 1,95 km obok.
2. **Główna słabość: stały IPP.** Pierścienie Koestera liczone od schroniska (ostatni pewny punkt 11:50) przeważają nad późniejszymi wskazówkami (świadek 13:40 na szlaku, BTS 14:48). Szukający sam to zauważył (backlog: IPP = ostatnia pewna obserwacja).
3. **Błąd projektu rundy (sędzia):** bbox skopiowany z zawrat.json; ukryte miejsce 2. rząd od południowej krawędzi siatki, a część koła BTS poza mapą. Utrudnia silnikowi. Od blind-02 bbox dopasowany do wskazówek.
4. **Zdarzenie "znaleziono" w silniku jest słabe:** Clue z promieniem 50 m w miejscu odnalezienia daje komórce tylko rangę 83 (szczyt dalej przy schronisku). Potrzebny osobny typ "Found", który zamyka akcję.
5. **Kolejność godzin po północy** w silniku (00:55 sortowane przed 18:15) - znany błąd z backlogu.
6. To jedna runda: nie liczba do pitchu. Seria 3-5 rund.

## Oś zdarzeń rundy (patrole + odpowiedzi sędziego)
| Start | Fala | Zespół | Wynik |
|---|---|---|---|
| 19:00 | 1 | topr-a | topr-a: S5 przeszukany, nic |
| 19:00 | 1 | topr-a | topr-a: S12 przeszukany, nic |
| 19:05 | 1 | drone | drone: S3 przeszukany, nic |
| 19:10 | 1 | topr-b | topr-b: S13 przeszukany, nic |
| 19:10 | 1 | topr-b | topr-b: S12 przeszukany, nic |
| 19:15 | 1 | dog | dog: S4 przeszukany, nic |
| 19:20 | 2 | drone | drone: S3 przeszukany, nic |
| 19:35 | 3 |  | drone: ZNALEZIONO w S12 |
| 20:25 | 2 | dog | dog: S2 przeszukany, nic |
| 21:30 | 2 | topr-a | topr-a: S18 przeszukany, nic |
| 21:50 | 3 | dog | dog: S5 przeszukany, nic |
| 23:00 | 2 | topr-b | topr-b: S4 przeszukany, nic |
| 23:00 | 2 | topr-b | topr-b: S6 przeszukany, nic |
| 23:10 | 3 | topr-a | topr-a: S4 przeszukany, nic |
| 00:55 | 3 | topr-b | topr-b: S7 przeszukany, nic |

Replay 1:1: `swift run rescue-demo --fast scenarios/blind-01-replay.json` (wskazówki + patrole do znalezienia, z odsłoniętą prawdą do backtestu).

## Pełne metryki per krok (reveal.py)
```
commitment OK fdd079df019d7bf044c1d5892802245ec085200dc7b6a2fe10c45baf8895b474
hidden cell r58 c30, segment S12
baseline, nearest-to-IPP first: cell rank 1164/3600 = 32.3% of area swept before reaching it
step  time   hint                          segRank  cellRank  areaSwept  distToPeak
   0  18:15  Teren: szlaki, potoki, schro       11       345      9.58%      1907 m
   1  18:15  Trudność terenu                    12       589     16.36%      1907 m
   2  18:15  Warunki: mgła 40 m, wiatr 9        12       589     16.36%      1907 m
   3  18:15  Koester: turysta pieszy, gór       11       673     18.69%      1950 m
   4  18:20  Plan od partnera: pętla prze        7       342      9.50%      1950 m
   5  18:30  Auto nadal na parkingu Palen        6       333      9.25%      1950 m
   6  18:45  Świadek: para turystów widzi        7       357      9.92%      1950 m
   7  18:55  CPR 112: ostatni sektor BTS         5       171      4.75%      1950 m
   8  19:00  IMGW: mgła, mżawka, zmrok 18        5       147      4.08%      1950 m
   9  19:00  topr-a: S5 przeszukany, nic         5       144      4.00%      1950 m
  10  19:00  topr-a: S12 przeszukany, nic        5       224      6.22%      1950 m
  11  19:05  drone: S3 przeszukany, nic          5       216      6.00%      1785 m
  12  19:10  topr-b: S13 przeszukany, nic        5       180      5.00%      1785 m
  13  19:10  topr-b: S12 przeszukany, nic        7       303      8.42%      1785 m
  14  19:15  dog: S4 przeszukany, nic            7       284      7.89%      1950 m
  15  19:20  drone: S3 przeszukany, nic          7       277      7.69%      1950 m
  16  19:35  drone: ZNALEZIONO w S12             7        83      2.31%      1950 m
```
