# Experimente (Branch `experiment/simulation`)

Nicht Teil der App – Forschungs-Werkzeuge rund um Rekonstruktion und Simulation.

## 1. Gibt es zu einem Punktezettel ein anderes Spiel? (`tools/alternative-game.mjs`)

Frage: Wenn man **nur** die Punkte je Zug kennt (plus wer ausgemacht hat und den
Wert der Reststeine), lässt sich daraus ein komplettes Spiel – Brett und gelegte
Wörter – berechnen?

Formulierung als Suchproblem (Constraint Satisfaction):

- Start: leeres Brett, deutscher Steinbeutel (102 Steine, 2 Blanko).
- Jeder Zug muss regelkonform sein (eine Reihe/Spalte, lückenlos, angelegt,
  alle gebildeten Wörter in der Wortliste) und **genau** die notierte Punktzahl
  bringen.
- Bänke: Solange der Beutel nicht leer ist, darf ein Zug beliebige ≤ 7 Steine aus
  dem Vorrat nehmen – die Ziehreihenfolge ist frei wählbar und bleibt dabei
  automatisch konsistent (jeder Spieler „zieht“ einfach die Steine, die er als
  Nächstes legt).
- Ab leerem Beutel sind die Bankgrößen fest; am Ende muss der Ausmacher genau leer
  sein und die Reststeine der anderen müssen genau den notierten Abzug ergeben.

Suche: zufällige 7er-Bänke + Backtracking; ab leerem Beutel vollständige Suche
über den Restvorrat. Das Tempo (wann der Beutel leer wird) und das frühe Verbauen
schwieriger Steine werden heuristisch gesteuert.

Warum das schwer ist:

- Der Suchraum ist riesig (≈ 40 Züge, je Zug hunderte bis tausende legale Züge).
- Die Punkte allein schränken kaum ein: ein Zettel enthält grob 40 Zahlen à
  wenige Bit – ein Endbrett hat ungleich mehr Möglichkeiten. Es gibt also, wenn
  überhaupt eine, dann **sehr viele** Lösungen; das echte Brett lässt sich aus den
  Punkten allein **nicht** eindeutig zurückgewinnen.
- Die eigentliche Hürde ist das **Spielende**: Alle Steine (inkl. Q, Y, Blanko …)
  müssen am Ende genau aufgehen, mit exakt passenden Punkten in den letzten,
  meist kleinen Zügen.

## 2. Simulation (`tools/simulate.mjs`)

Simulierte Partien mit echten Regeln: Beutel, 7er-Bänke, Nachziehen, Tauschen,
Ende nach Ausmachen oder 6 punktlosen Zügen, Hausregel am Ende.

Spielertypen:

- `profi`: legt immer den Zug mit den meisten Punkten (kennt alle ~700.000
  Wortformen – unrealistisch stark)
- `gelegenheit`: nimmt zufällig einen Zug aus dem besseren Fünftel

```sh
node tools/simulate.mjs --partien 100 --typ gemischt --json partien.jsonl
```

Mit `--json` werden alle Partien (Züge, Punkte, Wörter, Bänke am Ende) als
Trainingsmenge gespeichert.

### Ergebnisse (je 40 simulierte Partien, 3 Spieler)

| Konstellation | Ø Endstand | Ø Punkte/Zug | Ø Steine/Zug | Bingos je Spieler | Züge je Partie |
|---|---|---|---|---|---|
| 3 Profis | 282 | 34,5 | 3,9 | 0,89 | 25 |
| 3 Gelegenheitsspieler | 193 | 17,5 | 2,9 | 0,01 | 34 |
| Profi gegen 2 Gelegenheit | 332 : 161 | 32,5 / 17,3 | 3,8 / 3,0 | 0,80 / 0,01 | 30 |
| echte Familienpartie (zum Vergleich) | 227 | 18,1 | 2,6 | 0 | 42 |

Beobachtungen: Die Profi-Bots kennen alle ~700.000 Wiktionary-Formen und legen
daher auch Wörter, die am Tisch kaum jemand gelten ließe (z. B. WEPSISCH für 194).
Die Familie spielt pro Zug fast genau wie die „Gelegenheitsspieler“, aber
deutlich mehr Züge (kleinteiliges Spiel: 2,6 Steine pro Zug).

## 3. Spiel-Betrachter (`tools/viewer/`)

```sh
node tools/viewer-data.mjs --ausgabe tools/viewer/games.json \
  --partie partie.json --sim partien.jsonl
# dann tools/viewer/index.html über einen lokalen Webserver öffnen
```

Brett mit Steinen und Prämienfeldern, Zug für Zug abspielbar, Spielstand, Bank
vor jedem Zug (bei der echten Partie: sicher bekannte Steine + unbekannte) und
alle Wörter des Endbretts mit Prüfung gegen die Wortliste.
