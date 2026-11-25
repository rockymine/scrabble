# Wortliste – Quelle und Lizenz

Die Dateien in diesem Ordner (`*.txt.gz`, `index.json`) sind aus dem
**deutschsprachigen Wiktionary** abgeleitet:

- Inhalt: Wiktionary-Autorinnen und -Autoren, https://de.wiktionary.org/
- Maschinell aufbereitet von **kaikki.org** mit Wiktextract
  (https://kaikki.org/dewiktionary/, Datei `raw-wiktextract-data.jsonl.gz`,
  Stand siehe `dumpDate` in `index.json`)
- Lizenz: **Creative Commons Namensnennung – Weitergabe unter gleichen
  Bedingungen 4.0 (CC BY-SA 4.0)**,
  https://creativecommons.org/licenses/by-sa/4.0/deed.de

## Änderungen gegenüber der Quelle

Erzeugt mit `tools/build-wordlist.mjs`:

- nur deutschsprachige Einträge (`lang_code = de`) samt aller angegebenen
  Flexionsformen (Deklination, Konjugation, Steigerung …)
- ohne Eigennamen, Abkürzungen (auch solche, die als Substantiv geführt
  werden, samt ihrer Beugungsformen), Symbole, Affixe, Wortgruppen und Einträge
  in alter Rechtschreibung; Kontraktionen wie „im“, „zum“, „beim“ bleiben enthalten
- nur Einzelwörter mit 2–15 Buchstaben aus A–Z, Ä, Ö, Ü
- in Großbuchstaben, ß als SS
- nach Anfangsbuchstaben aufgeteilt, sortiert, gzip-komprimiert

- Beugungsformen nur, wenn ihre Grundform selbst aufgenommen ist (keine Formen
  von Orts- und Personennamen)
- `info/*.txt.gz`: Herkunft je Wort – Grundform, Wortart, Form (z. B. „Genitiv
  Singular“), Markierungen (veraltet, regional, Fachgebiet …; auch veraltete
  Schreibweisen aus den Beugungstabellen wie „seyn“), gekürzte erste
  Bedeutung und Zahl der Übersetzungen im Wiktionary

Diese abgeleitete Wortliste steht ebenfalls unter CC BY-SA 4.0.
