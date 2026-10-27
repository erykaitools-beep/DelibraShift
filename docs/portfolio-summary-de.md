# DelibraShift — Projektbeschreibung für Bewerbungen

[Projekt und Ergebnisse](../README.md) ·
[Technische Fallstudie](engineering-case-study.md) ·
[Beiträge von Mensch und KI](../MODEL_CONTRIBUTIONS.md)

## Projektprofil

DelibraShift ist ein reproduzierbares Evaluationssystem für KI-Agenten,
deren Entscheidungen erst nach einer Verzögerung wirksam werden. Die
simulierte Umgebung entwickelt sich währenddessen unter der vorherigen
Aktion weiter. Die Verzögerung wird in Simulationsticks festgelegt;
Antwortzeiten externer Dienste werden getrennt erfasst und beeinflussen
den Score nicht.

Das Projekt verbindet einen deterministischen Python-Simulator mit einem
Experiment-Harness, strikter Datenvalidierung, kanonischen JSONL-Protokollen
und einem interaktiven Offline-Bericht auf Englisch und Polnisch. Tests,
Referenzdaten und CI prüfen unter anderem Reproduzierbarkeit, Paketierung
und die Darstellung im Browser. Ein unabhängiger Replay-Audit berechnet
Physik und ausgewählte Metriken erneut.

Der veröffentlichte Vergleich untersucht ein direktes Entscheidungsverfahren
und eine zweistufige Architektur mit zusätzlicher Zustandsvorhersage. Die
zweistufige Variante lieferte zuverlässiger parsebare Antworten, erzielte
aber einen schlechteren mittleren Aufgabenerfolg. Dieser negative Befund
bleibt zusammen mit 84 Protokollen, Stichprobenumfängen und Einschränkungen
öffentlich. Er gilt für das untersuchte Modell und Experiment, nicht für
alle Agentenarchitekturen.

Meine Rolle als Projektinitiator und Verantwortlicher umfasste die
Problemdefinition, Anforderungen, Priorisierung, Koordination der
KI-gestützten Entwicklung sowie Entscheidungen zu Experimenten und
Veröffentlichung. Architektur, Implementierung und Prüfung wurden mit
KI-Unterstützung erarbeitet; die Rollen sind im Beitragsprotokoll offengelegt.

## Kurze Fassung für den Lebenslauf

### DelibraShift — KI-Agenten-Evaluation | Eigenprojekt, KI-gestützte Entwicklung

- Konzeption und Steuerung eines Evaluationssystems für Agenten mit
  verzögerter Aktionsausführung; Python-Simulation und Experiment-Harness.
- Koordination einer überprüfbaren Umsetzung mit JSONL-Protokollen,
  Datenvalidierung, Replay-Prüfungen, CI und zweisprachigem Offline-Bericht.
- Veröffentlichung eines kontrollierten Architekturvergleichs einschließlich
  negativem mittleren Ergebnis, Rohdaten und klaren Aussagegrenzen.

Projektstack: Python, pytest, Coverage, JSONL, JavaScript, Playwright,
GitHub Actions.

## Kurztext für LinkedIn

Mit DelibraShift untersuche ich, wie sich eine feste Entscheidungsverzögerung
auf KI-Agenten auswirkt. Das Projekt verbindet Simulation, nachvollziehbare
Experimente und einen interaktiven Ergebnisbericht. Besonders wichtig ist
mir, bessere Antwortformate nicht mit besserer Aufgabenleistung zu
verwechseln: Der veröffentlichte Vergleich zeigt beide Effekte getrennt,
einschließlich des negativen mittleren Ergebnisses. Meine Arbeit liegt in
Konzeption, Produktentscheidungen und der Koordination einer überprüfbaren,
KI-gestützten Umsetzung.
