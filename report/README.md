# DelibraShift M2 — interaktywny raport offline

Ten katalog zawiera źródła jednoplikowego raportu eksperymentu M2. Raport
porównuje ten sam model w dwóch dopasowanych ramionach:

- `end2end`: jeden prompt zwraca predykcję i akcję;
- `wm-scaffold`: pierwszy etap przewiduje stan w chwili wejścia akcji, a drugi
  podejmuje decyzję wyłącznie na podstawie tej własnej predykcji modelu.

Wynikiem budowy jest `report/delibrashift_report.html`. Plik działa bez serwera,
CDN i połączenia sieciowego. Zawiera opis mechaniki, wyniki oraz laboratorium do
odtwarzania lotów tick po ticku w języku polskim i angielskim.

## Budowanie

Z katalogu głównego repozytorium:

```bash
python -m pip install -e '.[dev]'
python report/build_report.py
```

Domyślne, kanoniczne źródła to:

- `results/m2/logs/` — 84 logi eksperymentu;
- `results/m2/report.json` — oficjalny raport agregatów;
- `packs/core_v0/` — paczka scenariuszy.

Źródła są czytane bezpośrednio z głównego repozytorium. Nie utrzymujemy drugiej
kopii logów ani packa w `report/`. `report/data/` jest wyłącznie roboczym,
ignorowanym przez Git miejscem na wygenerowany bundle i sidecar pochodzenia.

Najważniejsze opcje:

| Flaga | Znaczenie |
|---|---|
| `--logs-dir KATALOG` | alternatywny katalog logów |
| `--packs-dir KATALOG` | alternatywna paczka scenariuszy |
| `--report PLIK` | alternatywny `report.json` |
| `--out PLIK` | plik wynikowy wewnątrz `report/` |
| `--lang pl\|en` | domyślny język zbudowanego raportu |
| `--skip-extract` | ponowne użycie lokalnego bundle wraz z sidecarem źródeł |

Budowa odtwarza fizykę każdego epizodu przez bibliotekę DelibraShift. Jeżeli
stan końcowy, najbliższe podejście lub liczba epizodów nie zgadzają się z
logami, raport nie zostaje uznany za poprawny.

## Testy

Po zbudowaniu bundle:

```bash
npm --prefix report test
python report/tests/audit_truth.py
```

Testy obejmują funkcje czyste, renderowanie DOM, arenę, tłumaczenia PL/EN,
kontrast, składnię skryptów oraz niezależną implementację fizyki. Audyt prawdy
nie importuje `delibrashift.world`, dzięki czemu nie może bezwiednie powtórzyć
tego samego błędu co ekstraktor.

## Zasady interpretacji

- Fidelity jest porównywane wyłącznie na komórkach scenariusz × powtórzenie,
  gdzie oba ramiona mają ważny pomiar. Oficjalnie: sparowane Δ = `+0.0183`,
  `n=4`.
- Temporal anticipation jest zawsze pokazywane wraz z liczbą ocenionych cykli
  `K` i średnią wagą rozbieżności.
- `*_no_retry` to oddzielny przekrój czułości, nie „poprawiony” wynik główny.
- Wniosek o niewykorzystaniu hot/cold wymaga identycznych sekwencji komend w
  parach normal/decoy. Równy outcome sam w sobie nie wystarcza.
- Czas zegarowy jest wyłącznie telemetrią i nigdy nie wpływa na symulację ani
  score.

## Układ katalogu

| Ścieżka | Rola |
|---|---|
| `build_report.py` | budowa oraz bramki kompletnego HTML |
| `extract.py` | replay logów i budowa bundle |
| `template.html` | semantyczny szkielet raportu |
| `assets/` | CSS, JS, ikony i tekst PL/EN |
| `tests/` | testy JS i niezależny audyt fizyki |
| `spec/` | reguły projektu wizualizacji i metryk |

Wygenerowany HTML jest artefaktem pochodnym. Prawdziwym źródłem wyników
pozostają kanoniczne logi oraz `results/m2/report.json`.
