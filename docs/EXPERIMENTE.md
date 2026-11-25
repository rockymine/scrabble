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
