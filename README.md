# Familien-Scrabble – Spielstand-App

Ersetzt die Papier-Spielstandszettel. Ein Gerät liegt auf dem Tisch, eine Person
trägt für alle ein. Läuft im Browser, lässt sich auf den Homescreen legen und
funktioniert danach **komplett ohne Internet**. Kein Server, keine Konten – alle
Daten bleiben auf dem Gerät (IndexedDB).

## Funktionen

- **Spieler**: feste, bearbeitbare Liste (beim ersten Start in der App anlegen);
  ausblenden statt löschen, damit Archiv und Statistik erhalten bleiben
- **Neue Partie**: 2–4 Spieler, Reihenfolge per Antippen bzw. ▲▼ oder auslosen
- **Während des Spiels**
  - große Ziffern-Tasten für die Punkte (Pflicht), Wort optional
  - „Aussetzen / Getauscht“ = Zug mit 0 Punkten, im Verlauf markiert
  - automatischer Wechsel zum nächsten Spieler, Summen immer groß sichtbar
  - „Rückgängig“ für den letzten Zug (Werte landen wieder im Eingabefeld)
  - jeden Zug im Verlauf antippen und korrigieren
  - jeder Zug wird sofort gespeichert – App schließen schadet nicht
- **Spielende (Hausregel)**: auswählen, wer alle Steine los ist (oder „Niemand“),
  Reststeine der anderen eingeben → werden abgezogen; wer ausgemacht hat,
  bekommt **keine** Pluspunkte. Gewinner (auch Gleichstand) und Endstand werden
  gespeichert.
- **Archiv**: alle Partien mit Datum, Wochentag, Spielern, Endstand, Gewinner;
  Filter nach Spieler; Detailansicht mit allen Zügen (Runde × Spieler), Züge,
  Spielende und Datum nachträglich änderbar
- **Papierpartien nachtragen**: Datum frei wählbar, Züge als Zahlenliste je
  Spieler (`12 24 8 0 31`; `0` oder `-` = ausgesetzt; optional Wort hinter der
  Zahl: `24 HAUS`)
- **Statistik**: Siege (auch geteilte), Siegquote, Ø Endstand, Ø pro Zug,
  höchste Partie, höchster Einzelzug, Duell-Bilanz je Spielerpaar
- **Wortprüfung** (nur Hinweis): ca. 700.000 Wortformen offline. „Nicht
  gefunden“ heißt nicht „ungültig“ – z. B. fehlen Genitive substantivierter
  Infinitive wie „ANPOCHENS“. Gewertet werden darf immer.
- **Sicherung**: Export aller Daten als JSON-Datei (oder „Teilen“ per Mail/Cloud),
  Import ersetzt den Datenbestand nach Rückfrage. Die Startseite erinnert, wenn
  länger nicht gesichert wurde.

Nicht enthalten (bewusst): automatische Punkteberechnung, Brett-Nachbau,
Online-Mehrspieler, Synchronisation, Konten.

## Benutzen

Die App ist eine reine statische Website. Sie muss über **HTTPS** (oder
`localhost`) ausgeliefert werden, damit Offline-Betrieb und Installation
funktionieren.

**Lokal ausprobieren:**

```sh
npm start          # = python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

**Veröffentlichen über GitHub Pages:** Der Workflow
`.github/workflows/pages.yml` testet, stempelt die Service-Worker-Version und
veröffentlicht bei jedem Push auf `main`. Einmalig im Repository unter
*Settings → Pages → Build and deployment → Source* „GitHub Actions“ wählen.
Die App liegt dann unter `https://<benutzer>.github.io/<repo>/`.

**Auf dem Tablet/Handy installieren:** Seite öffnen, dann
- iPhone/iPad (Safari): Teilen → „Zum Home-Bildschirm“
- Android (Chrome): Menü ⋮ → „App installieren“ / „Zum Startbildschirm“

Beim ersten Öffnen lädt die App die Wortliste (≈ 1,7 MB) im Hintergrund nach;
unter „Daten & Sicherung“ sieht man, ob sie vollständig offline verfügbar ist.

## Entwicklung

Kein Build-Schritt, keine Abhängigkeiten – nur ES-Module im Browser.

```
index.html, manifest.webmanifest, sw.js   App-Hülle, PWA, Offline-Cache
css/app.css                               Oberfläche (große Schrift, Hell/Dunkel)
js/app.js                                 Ansichten und Navigation (#/…)
js/game.js                                Spiellogik inkl. Hausregel (rein, getestet)
js/stats.js                               Statistik (rein, getestet)
js/db.js                                  IndexedDB, Export/Import
js/words.js, js/normalize.js              Wortprüfung (Binärsuche im gzip-Text)
js/letters.js                             Buchstabenwerte (für spätere Features)
words/de/                                 erzeugte Wortliste + Quelle/Lizenz
tools/                                    Wortliste erzeugen, SW-Version, Icons
tests/                                    node --test
```

```sh
npm test           # Unit-Tests (Node ≥ 20)
```

Die Service-Worker-Version (`VERSION` in `sw.js`) wird beim Veröffentlichen per
`npm run stamp` aus dem Inhalt der App-Dateien berechnet. Wer anders hostet,
sollte das vor jedem Upload ausführen, sonst bekommen installierte Geräte
Änderungen nicht mit.

### Wortliste neu erzeugen

```sh
curl -LO https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz   # ca. 300 MB
DUMP_DATE=2026-11-01 npm run wordlist -- raw-wiktextract-data.jsonl.gz
```

Filter (Wortarten, Länge, alte Rechtschreibung …) stehen in
`tools/build-wordlist.mjs`.

### Datenformat (Sicherung)

```jsonc
{
  "app": "familien-scrabble", "format": 1, "exportedAt": "…",
  "players": [{ "id": "…", "name": "Anna", "order": 0, "hidden": false }],
  "games": [{
    "id": "…", "date": "2026-11-25", "source": "live" /* oder "paper" */,
    "status": "finished", "playerIds": ["…"],
    "turns": [{ "id": "…", "playerId": "…", "points": 24, "word": "HAUS", "pass": false }],
    "end": { "outPlayerId": "…" /* oder null */, "remaining": { "<playerId>": 5 } },
    "finalScores": { "<playerId>": 312 }, "winnerIds": ["…"]
  }]
}
```

## Deutsche Buchstabenwerte

1: E N S I R T U A D · 2: H G L O · 3: M B W Z · 4: C F K P ·
6: Ä J Ü V · 8: Ö X · 10: Q Y · Blanko: 0 (in `js/letters.js`, derzeit ungenutzt)

## Züge rekonstruieren (Vorstufe, Kommandozeile)

Aus **Endbrett + Punkteliste** lässt sich oft die komplette Partie
zurückrechnen: welches Wort in welchem Zug wo gelegt wurde.

```sh
node tools/reconstruct.mjs partie.json --bewerten
```

`partie.json` enthält das Brett (15 Zeilen, `.` = leer, Kleinbuchstabe = Blanko),
die Spieler in Sitzreihenfolge, die Punkte je Zug (`null` = ausgesetzt) und
optional die Reststeine – Beispiel: [`tests/fixtures/partie-beispiel.json`](tests/fixtures/partie-beispiel.json).

So funktioniert es (`js/reconstruct.js`):

1. **Suche:** Vom leeren Brett aus werden Steine des Endbretts so gelegt, dass
   jeder Zug regelkonform ist und genau die notierte Punktzahl ergibt
   (Prämienfelder, Kreuzwörter, Blanko = 0, 50 Bonus für alle 7 Steine).
   Wörter, die nicht in der Wortliste stehen, sind erlaubt, werden aber
   möglichst vermieden. Findet sich keine Lösung, ist meist eine Zahl falsch
   notiert – das Werkzeug kann einzelne Züge freigeben und so den Fehler finden.
2. **Bänke:** Sobald der Beutel leer ist, zieht niemand mehr nach. Was ein
   Spieler danach legt, plus seine Reststeine, war genau seine Bank in diesem
   Moment. Das sortiert unmögliche Lösungen aus und zeigt die Bänke am Ende.
3. **Bewertung** (`js/movegen.js`): Für jeden Zug wird gesucht, ob man **dieselben
   Steine** besser hätte legen können; ab dem leeren Beutel (Bank bekannt) auch
   der beste Zug mit der **ganzen Bank**.

Noch offen: Brett per Foto erkennen und das Ganze in der App anbieten.

## Quellen & Lizenzen

Die Wortliste stammt aus dem deutschsprachigen
[Wiktionary](https://de.wiktionary.org/), aufbereitet von
[kaikki.org](https://kaikki.org/dewiktionary/) (Wiktextract), Lizenz
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de).
Details und Änderungen: [`words/de/QUELLE.md`](words/de/QUELLE.md).
