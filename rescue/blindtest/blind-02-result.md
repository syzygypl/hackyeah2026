# Test na ślepo - runda blind-02: wynik

**Odsłonięcie:** at = [49.27003, 19.93961], salt = `015f869f614028292cef1826ca988a5a`, tabela wykrywalności = {"ground": 0.45, "dog": 0.6, "drone": 0.25, "heli": 0.15} (hash = blind-02.detect.commit, OK). Sprawdzenie: `python3 rescue/blindtest/reveal.py --round blind-02 --at 49.27003,19.93961 --salt 015f869f614028292cef1826ca988a5a --run rescue/out/blind-02-replay.run.json`.

**Historia (chowający):** Senior z demencją poszedł Drogą pod Reglami na zachód (dalej niż zwykle), skręcił w niebieski szlak do Doliny ku Dziurze, zgubił czapkę przy wejściu, potem zszedł ze szlaku w las w górę Potoku ku Dziurze, zaplątał się w młodnik nad potokiem i usiadł zmarznięty ok. 200 m od szlaku. Stan: alive, hypothermic, cannot answer calls (no phone).
**Dlaczego taka tabela wykrywalności:** Gęsty młodnik nad potokiem, zmierzch i deszcz, osoba siedzi skulona pod gałęziami: termowizja z góry słabo widzi przez korony, pies na świeżym tropie dobrze (deszcz osłabia), tyraliera wolno ale skutecznie.

## Wynik
- **ZNALEZIONO o 21:20** w **D18** przez Patrol TOPR A (fala 3, 13. przeszukanie segmentu w akcji), ok. 6,8 h po wyjściu z pensjonatu.
- **Znowu decyzja AI szukającego wbrew planerowi** (planer powtarzał D14). Rozumowanie AI Mateusza: czapka przy wejściu na szlak do Jaskini Dziura + demencja = "idzie prosto, aż utknie" + nieprzeszukany stromy las za jaskinią.
- D13 (obok) przeszukany 3x (dron, pies, patrol) - poprawnie pusty.

## Jak dobrze wskazywał silnik (17:45, wszystkie wskazówki, przed patrolami)
| Miara | Silnik (fuzja) | Dla porównania |
|---|---|---|
| Ranga prawdziwego segmentu D18 | **#8 z 20** | #10 po samych pierścieniach |
| Obszar do przeszukania w kolejności POA, zanim trafimy w komórkę | **37,4%** | **35,7%** naiwnie od IPP (pensjonat) |
| Odległość szczytu mapy od miejsca | ok. 1,0 km | - |

**Tu silnik nie pomógł: wypadł nie lepiej niż naiwne szukanie od pensjonatu.** Typ Found działa: po znalezieniu komórka #3, szczyt 75 m od miejsca.

## Uczciwe wnioski
1. Seria po 2 rundach: **2/2 znalezione, oba razy przez decyzję AI szukającego wbrew planerowi.** Silnik sam: runda 1 = 4,1% obszaru (8x lepiej niż naiwnie), runda 2 = 37% (jak naiwnie). Wartość daje dziś połączenie mapy prawdopodobieństwa i rozumowania koordynatora (AI) nad wskazówkami.
2. Słabość silnika przy demencji: ślad (czapka) i świadek przesuwają szczyt na szlak/drogę, a nie w "prosto do utknięcia" (las/potok poza szlakiem za ostatnim śladem). Kandydat do backlogu: kierunkowy rozkład od ostatniego śladu wzdłuż kierunku ruchu + atraktor potok/młodnik dla kategorii dementia.
3. Planer: POD drona w lesie o zmierzchu z planera 0,72 (za wysoko), śmigłowiec po zmroku proponowany (błąd).
4. Projekt rundy (sędzia): nazwy segmentów od najbliższego obiektu do seeda bywały mylące (D13); od rundy 3 nazwy od środka ciężkości + lista obiektów.
5. N = 2. Nie liczba do pitchu.

## Oś zdarzeń rundy
| Start | Fala | Zespół | Wynik |
|---|---|---|---|
| 17:45 | 1 | drone | drone: D13 przeszukany, nic |
| 18:00 | 2 | heli | heli: D12 przeszukany, nic |
| 18:00 | 2 | dog | dog: D13 przeszukany, nic |
| 18:00 | 2 | gopr-a | gopr-a: D13 przeszukany, nic |
| 18:00 | 2 | gopr-b | gopr-b: D12 przeszukany, nic |
| 18:00 | 2 | gopr-b | gopr-b: D17 przeszukany, nic |
| 19:10 | 3 | dog | dog: D8 przeszukany, nic |
| 19:30 | 3 | gopr-a | gopr-a: D14 przeszukany, nic |
| 20:15 | 3 | gopr-b | gopr-b: D7 przeszukany, nic |
| 20:25 | 4 | dog | dog: D3 przeszukany, nic |
| 21:20 | 4 | gopr-a | gopr-a: ZNALEZIONO w D18 |
| 22:30 | 4 | gopr-b | gopr-b: D12 przeszukany, nic |
| 22:30 | 4 | gopr-b | gopr-b: D11 przeszukany, nic |

## Pełne metryki per krok (reveal.py)
```
commitment OK 4af5d1ccfbe25f9c76429dda75a3c452a93606fd6f3657cbd17250c24d8e92f7
hidden cell r33 c25, segment D18
baseline, nearest-to-IPP first: cell rank 869/2436 = 35.7% of area swept before reaching it
step  time   hint                          segRank  cellRank  areaSwept  distToPeak
   0  16:30  Rodzina sprawdziła wylot Dol       14      1808     74.22%      4106 m
   1  16:40  Teren: szlaki, potoki, drogi        7      1603     65.80%       794 m
   2  16:40  Trudność terenu                     9      1342     55.09%       794 m
   3  16:40  Warunki: pochmurno, +8°C, wi        9      1342     55.09%       794 m
   4  16:40  Koester: demencja, teren gór       10       808     33.17%      1515 m
   5  16:45  Córka: codzienny spacer Drog       10       813     33.37%      1382 m
   6  17:05  Świadek: ekspedientka widzia       10       820     33.66%       971 m
   7  17:05  Ostatni znany punkt: pierści        9       877     36.00%       971 m
   8  17:40  Ślad: beżowa czapka przy nie        9       877     36.00%       980 m
   9  17:40  Ostatni znany punkt: pierści        8       849     34.85%       999 m
  10  17:45  IMGW: słaby deszcz od 17:00,        8       911     37.40%       999 m
  11  17:45  drone: D13 przeszukany, nic         8       879     36.08%       999 m
  12  18:00  heli: D12 przeszukany, nic          8       866     35.55%       999 m
  13  18:00  dog: D13 przeszukany, nic           8       827     33.95%       999 m
  14  18:00  gopr-a: D13 przeszukany, nic        8       814     33.42%       999 m
  15  18:00  gopr-b: D12 przeszukany, nic        8       785     32.22%       999 m
  16  18:00  gopr-b: D17 przeszukany, nic        8       735     30.17%       999 m
  17  19:10  dog: D8 przeszukany, nic            8       672     27.59%       999 m
  18  19:30  gopr-a: D14 przeszukany, nic        7       657     26.97%       999 m
  19  20:15  gopr-b: D7 przeszukany, nic         6       592     24.30%       999 m
  20  20:25  dog: D3 przeszukany, nic            5       532     21.84%       999 m
  21  21:20  gopr-a: ZNALEZIONO w D18            1         3      0.12%        75 m
```
