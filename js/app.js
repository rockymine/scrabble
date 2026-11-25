import {
  h, toast, modal, confirmDialog, alertDialog, numberInput, wordInput, download,
  fmtDate, fmtLongDate, fmtWeekdayShort, fmtNum,
} from './ui.js';
import { db, validateBackup } from './db.js';
import * as G from './game.js';
import { computeStats } from './stats.js';
import { wordCheckSupported, downloadAll, offlineStatus, loadIndex, describeInfo, judgeWord, normalizeRules } from './words.js';
import { normalizeWord } from './normalize.js';

export const APP_VERSION = '1.0.0';

const root = document.getElementById('app');
const state = { players: [], byId: {}, rules: normalizeRules(null) };

async function loadPlayers() {
  state.players = await db.players();
  state.byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
}
const pname = (id) => state.byId[id]?.name ?? 'Unbekannt';
const visiblePlayers = () => state.players.filter((p) => !p.hidden);

// ======================================================================
// Router
// ======================================================================

const routes = [
  [/^$/, homeView],
  [/^neu$/, newGameView],
  [/^spiel$/, playView],
  [/^ende$/, endView],
  [/^archiv$/, archiveView],
  [/^partie\/([\w-]+)$/, gameDetailView],
  [/^nachtragen$/, paperView],
  [/^statistik$/, statsView],
  [/^spieler$/, playersView],
  [/^wort$/, wordView],
  [/^daten$/, dataView],
  [/^hausregeln$/, rulesView],
];

let cleanup = null;
let renderSeq = 0;

// Schreibvorgänge der Partie nacheinander ausführen; Ansichten warten darauf.
let pendingWrites = Promise.resolve();
function queueSave(game) {
  const snapshot = JSON.parse(JSON.stringify(game));
  pendingWrites = pendingWrites
    .then(() => db.saveGame(snapshot))
    .catch((e) => { console.error(e); toast('Speichern fehlgeschlagen!', 'warn'); });
  return pendingWrites;
}

async function route() {
  const path = location.hash.replace(/^#\/?/, '');
  const seq = ++renderSeq;
  let view = homeView;
  let params = [];
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { view = fn; params = m.slice(1); break; }
  }
  try {
    await pendingWrites;
    const page = await view(...params);
    if (seq !== renderSeq || !page) return;
    cleanup?.();
    cleanup = page.cleanup || null;
    root.replaceChildren(frame(page));
    if (!page.keepScroll) window.scrollTo(0, 0);
    page.onMount?.();
  } catch (err) {
    console.error(err);
    if (seq !== renderSeq) return;
    root.replaceChildren(frame({ title: 'Fehler', content: h('p', { class: 'error' }, String(err.message || err)) }));
  }
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/** Aktuelle Ansicht neu zeichnen (z. B. nach einer Änderung). */
const refresh = () => route();

function frame({ title, back = '#/', content, className = '' }) {
  return h('div', { class: 'page ' + className },
    h('header', { class: 'topbar' },
      back
        ? h('a', { class: 'back', href: back, 'aria-label': 'Zurück' }, '‹', h('span', { class: 'back-label' }, 'Zurück'))
        : h('span', { class: 'logo', 'aria-hidden': 'true' }, 'S', h('sub', null, '1')),
      h('h1', null, title)),
    h('main', null, content));
}

// ======================================================================
// Gemeinsame Bausteine
// ======================================================================

function card(...children) {
  return h('section', { class: 'card' }, ...children);
}

function bigLink(href, label, sub, cls = '') {
  return h('a', { class: 'big-link ' + cls, href }, h('span', { class: 'big-link-label' }, label), sub ? h('span', { class: 'big-link-sub' }, sub) : null);
}

/** Live-Hinweis aus der Wortliste (inkl. Herkunft und Hausregeln) unter einem Eingabefeld. */
function wordHint(input) {
  const el = h('div', { class: 'word-hint', 'aria-live': 'polite' });
  let timer;
  let seq = 0;
  async function run() {
    const v = input.value.trim();
    const my = ++seq;
    if (!v) { el.className = 'word-hint'; el.textContent = ''; return; }
    el.className = 'word-hint pending';
    el.textContent = 'Prüfe …';
    const r = await judgeWord(v, state.rules);
    if (my !== seq) return;
    const desc = r.info?.length ? describeInfo(r.info[0]) : 'Steht in der Wortliste';
    if (r.verdict === 'ok') {
      el.className = 'word-hint ok';
      el.textContent = r.custom ? '✓ Bei euch erlaubt' : `✓ ${desc}`;
    } else if (r.verdict === 'warn') {
      el.className = 'word-hint rare';
      el.textContent = `⚠ ${desc} – ${r.reason}`;
    } else if (r.verdict === 'deny') {
      el.className = 'word-hint deny';
      el.textContent = `✗ ${r.reason}`;
    } else if (r.verdict === 'missing') {
      el.className = 'word-hint warn';
      el.textContent = 'Nicht in der Wortliste – zählt trotzdem, wenn ihr es gelten lasst';
    } else {
      el.className = 'word-hint muted';
      el.textContent = r.reason || '';
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  return {
    el,
    run,
    reset() { seq++; clearTimeout(timer); el.className = 'word-hint'; el.textContent = ''; },
  };
}

/** Dialog zum Korrigieren eines Zugs. Gibt true zurück, wenn geändert. */
async function editTurnDialog(game, turn, roundNo) {
  const pts = numberInput({ value: turn.pass ? '' : String(turn.points), 'aria-label': 'Punkte' });
  const word = wordInput({ value: turn.word || '', placeholder: 'Wort (freiwillig)', 'aria-label': 'Wort' });
  const hint = wordHint(word);
  const pass = h('input', { type: 'checkbox', checked: turn.pass });
  const syncPass = () => {
    pts.disabled = pass.checked;
    word.disabled = pass.checked;
    if (pass.checked) pts.value = '';
  };
  pass.addEventListener('change', syncPass);
  syncPass();
  if (turn.word) hint.run();

  const ok = await modal({
    title: `Zug korrigieren – ${pname(turn.playerId)}, Runde ${roundNo}`,
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', null, 'Punkte'), pts),
      h('label', { class: 'field' }, h('span', null, 'Wort'), word, hint.el),
      h('label', { class: 'check' }, pass, h('span', null, 'Ausgesetzt / getauscht (0 Punkte)'))),
    buttons: [
      { label: 'Abbrechen', value: false, class: 'secondary' },
      {
        label: 'Speichern', value: true, class: 'primary', submit: true,
        validate: () => {
          if (!pass.checked && G.parsePoints(pts.value) === null) {
            toast('Bitte eine gültige Punktzahl eingeben.', 'warn');
            pts.focus();
            return false;
          }
          return true;
        },
      },
    ],
    onOpen: () => { if (!pass.checked) { pts.focus(); pts.select(); } },
  });
  if (!ok) return false;
  G.updateTurn(game, turn.id, {
    points: pass.checked ? 0 : G.parsePoints(pts.value),
    word: normalizeWord(word.value),
    pass: pass.checked,
  });
  await queueSave(game);
  toast('Zug korrigiert');
  return true;
}

/**
 * Auswahl und Reihenfolge der Spieler (2–4).
 * onChange(ids) wird bei jeder Änderung aufgerufen.
 */
function playerPicker({ selected = [], onChange = () => {} } = {}) {
  let ids = selected.filter((id) => state.byId[id]);
  const el = h('div', { class: 'picker' });

  function set(next) {
    ids = next;
    render();
    onChange([...ids]);
  }
  function move(i, d) {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  }
  function shuffle() {
    const next = [...ids];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    set(next);
    toast(`${pname(next[0])} fängt an`);
  }
  async function addNew() {
    const input = h('input', { type: 'text', class: 'text-input', placeholder: 'Name', autocomplete: 'off' });
    const name = await modal({
      title: 'Neuer Spieler',
      body: h('label', { class: 'field' }, h('span', null, 'Name'), input),
      buttons: [
        { label: 'Abbrechen', value: null, class: 'secondary' },
        { label: 'Anlegen', value: 'ok', class: 'primary', submit: true, validate: () => !!input.value.trim() },
      ],
      onOpen: () => input.focus(),
    });
    if (!name) return;
    const p = await createPlayer(input.value);
    if (p && ids.length < 4) set([...ids, p.id]);
    else render();
  }

  function render() {
    const avail = visiblePlayers().filter((p) => !ids.includes(p.id));
    el.replaceChildren(
      h('h2', null, 'Reihenfolge am Tisch'),
      ids.length
        ? h('ol', { class: 'order-list' },
          ids.map((id, i) =>
            h('li', { class: 'order-item' },
              h('span', { class: 'order-no' }, i + 1),
              h('span', { class: 'order-name' }, pname(id), i === 0 ? h('small', null, ' fängt an') : null),
              h('button', { class: 'icon-btn', type: 'button', disabled: i === 0, 'aria-label': 'Nach oben', onclick: () => move(i, -1) }, '▲'),
              h('button', { class: 'icon-btn', type: 'button', disabled: i === ids.length - 1, 'aria-label': 'Nach unten', onclick: () => move(i, 1) }, '▼'),
              h('button', { class: 'icon-btn remove', type: 'button', 'aria-label': 'Entfernen', onclick: () => set(ids.filter((x) => x !== id)) }, '✕'))))
        : h('p', { class: 'muted' }, visiblePlayers().length
          ? 'Tippe unten auf die Mitspieler – in der Reihenfolge, in der gelegt wird.'
          : 'Noch keine Spieler angelegt – unten auf „+ Neuer Spieler …“ tippen.'),
      ids.length >= 2 ? h('button', { class: 'btn secondary small', type: 'button', onclick: shuffle }, '🎲 Reihenfolge auslosen') : null,
      h('h2', null, ids.length >= 4 ? 'Maximal 4 Spieler' : 'Mitspieler hinzufügen'),
      h('div', { class: 'chip-list' },
        avail.map((p) =>
          h('button', { class: 'chip', type: 'button', disabled: ids.length >= 4, onclick: () => set([...ids, p.id]) }, '+ ' + p.name)),
        h('button', { class: 'chip ghost', type: 'button', onclick: addNew }, '+ Neuer Spieler …')),
    );
  }
  render();
  return { el, get ids() { return [...ids]; } };
}

async function createPlayer(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    toast('Diesen Namen gibt es schon.', 'warn');
    return null;
  }
  const p = { id: G.uid(), name, order: Math.max(-1, ...state.players.map((x) => x.order ?? 0)) + 1, hidden: false };
  await db.savePlayer(p);
  await loadPlayers();
  return p;
}

/**
 * Formular für das Spielende (Hausregel). getGame() liefert ein Objekt mit
 * playerIds und turns (bei Papierpartien ein vorläufiges).
 */
function endForm(getGame, initial = null) {
  let out = initial ? (initial.outPlayerId ?? 'none') : null;
  const values = {};
  if (initial) for (const [id, v] of Object.entries(initial.remaining || {})) values[id] = String(v);
  const el = h('div', { class: 'end-form' });
  const restBox = h('div');
  const previewBox = h('div');

  function currentEnd(strict) {
    const game = getGame();
    if (!out) {
      if (strict) throw new Error('Bitte auswählen, wer alle Steine abgelegt hat.');
      return null;
    }
    const remaining = {};
    for (const id of game.playerIds) {
      if (id === out) continue;
      const v = values[id] ?? '';
      const n = G.parsePoints(v);
      if (n === null) {
        if (strict) throw new Error(`Bitte den Wert der Reststeine von ${pname(id)} eingeben (0, wenn keine).`);
        remaining[id] = 0;
      } else remaining[id] = n;
    }
    return { outPlayerId: out === 'none' ? null : out, remaining };
  }

  function renderPreview() {
    const game = getGame();
    const end = currentEnd(false);
    if (!end) { previewBox.replaceChildren(); return; }
    const r = G.computeFinal(game, end);
    previewBox.replaceChildren(
      h('h2', null, 'Endstand'),
      h('table', { class: 'table final-table' },
        h('thead', null, h('tr', null, h('th', null, 'Spieler'), h('th', { class: 'num' }, 'Züge'), h('th', { class: 'num' }, 'Rest'), h('th', { class: 'num' }, 'Ende'))),
        h('tbody', null,
          game.playerIds.map((id) => {
            const missing = id !== out && G.parsePoints(values[id] ?? '') === null;
            return h('tr', { class: r.winnerIds.includes(id) && !missing ? 'winner' : '' },
              h('td', null, r.winnerIds.includes(id) ? '🏆 ' : '', pname(id)),
              h('td', { class: 'num' }, r.totals[id]),
              h('td', { class: 'num' }, id === out ? 'aus' : missing ? '?' : '− ' + r.end.remaining[id]),
              h('td', { class: 'num strong' }, missing ? '?' : r.finalScores[id]));
          }))),
    );
  }

  function renderRest() {
    const game = getGame();
    if (!out) { restBox.replaceChildren(); return; }
    const others = game.playerIds.filter((id) => id !== out);
    restBox.replaceChildren(
      h('h2', null, out === 'none' ? 'Wert der Reststeine (alle)' : 'Wert der Reststeine'),
      h('p', { class: 'muted' }, 'Wird von der eigenen Summe abgezogen.',
        out !== 'none' ? ` ${pname(out)} bekommt keine Pluspunkte.` : ''),
      h('div', { class: 'rest-list' },
        others.map((id) => {
          const input = numberInput({
            value: values[id] ?? '',
            placeholder: '0',
            'aria-label': `Reststeine ${pname(id)}`,
            oninput: (e) => { values[id] = e.target.value.replace(/\D/g, ''); e.target.value = values[id]; renderPreview(); },
          });
          return h('label', { class: 'rest-item' }, h('span', null, pname(id)), h('span', { class: 'minus' }, '−'), input);
        })),
    );
  }

  function render() {
    const game = getGame();
    if (out && out !== 'none' && !game.playerIds.includes(out)) out = null;
    const choice = (id, label) =>
      h('button', {
        type: 'button',
        class: 'choice' + (out === id ? ' selected' : ''),
        'aria-pressed': String(out === id),
        onclick: () => { out = id; render(); el.querySelector('.rest-item input')?.focus(); },
      }, label);
    el.replaceChildren(
      h('h2', null, 'Wer hat alle Steine abgelegt?'),
      h('div', { class: 'choice-list' },
        game.playerIds.map((id) => choice(id, pname(id))),
        choice('none', 'Niemand (keiner konnte mehr legen)')),
      restBox,
      previewBox,
    );
    renderRest();
    renderPreview();
  }
  render();
  return { el, render, renderPreview, getEnd: () => currentEnd(true) };
}

function winnerLine(game) {
  if (!game.winnerIds?.length) return null;
  const names = game.winnerIds.map(pname);
  return h('div', { class: 'winner-banner' },
    h('span', { class: 'trophy', 'aria-hidden': 'true' }, '🏆'),
    names.length === 1 ? `${names[0]} gewinnt!` : `Gleichstand: ${names.join(' & ')}`);
}

function scoreSummary(game) {
  const ids = [...game.playerIds];
  if (game.finalScores) ids.sort((a, b) => game.finalScores[b] - game.finalScores[a]);
  const totals = game.finalScores || G.turnTotals(game);
  return h('span', { class: 'score-summary' },
    ids.map((id, i) => [
      i ? h('span', { class: 'sep' }, ' · ') : null,
      h('span', { class: game.winnerIds?.includes(id) ? 'strong' : '' }, game.winnerIds?.includes(id) ? '🏆 ' : '', `${pname(id)} ${totals[id]}`),
    ]));
}

// ======================================================================
// Start
// ======================================================================

async function homeView() {
  const [running, games, lastExport] = await Promise.all([db.runningGame(), db.games(), db.getMeta('lastExport')]);
  const finished = games.filter((g) => g.status === 'finished');

  let backupNote = null;
  if (finished.length) {
    const days = lastExport ? (Date.now() - new Date(lastExport).getTime()) / 86400000 : Infinity;
    const newer = lastExport ? finished.filter((g) => (g.finishedAt || g.createdAt) > lastExport).length : finished.length;
    if (days > 30 || newer >= 5) {
      backupNote = h('a', { class: 'notice', href: '#/daten' },
        lastExport ? `Letzte Sicherung vor ${Math.floor(days)} Tagen` : 'Noch keine Sicherung gespeichert',
        ' – jetzt sichern ›');
    }
  }

  const welcome = !state.players.length
    ? h('a', { class: 'notice', href: '#/spieler' },
      'Willkommen! Legt zuerst eure Mitspieler an – einmalig, danach stehen sie bei jeder Partie zur Auswahl. ›')
    : null;

  const content = h('div', { class: 'home' },
    welcome,
    running
      ? h('a', { class: 'running-card', href: '#/spiel' },
        h('span', { class: 'running-title' }, '▶ Partie fortsetzen'),
        h('span', { class: 'running-sub' }, fmtLongDate(running.date), ' · ', running.turns.length, ' Züge'),
        scoreSummary(running))
      : bigLink('#/neu', 'Neue Partie', 'Spieler wählen und loslegen', 'primary'),
    h('div', { class: 'home-grid' },
      running ? bigLink('#/neu', 'Neue Partie') : null,
      bigLink('#/archiv', 'Archiv', `${finished.length} ${finished.length === 1 ? 'Partie' : 'Partien'}`),
      bigLink('#/statistik', 'Statistik', 'Siege, Rekorde, Duelle'),
      bigLink('#/wort', 'Wort prüfen', 'Offline-Wortliste'),
      bigLink('#/nachtragen', 'Papierpartie nachtragen', 'Alte Zettel erfassen'),
      bigLink('#/hausregeln', 'Hausregeln', 'Was bei euch als Wort gilt'),
      bigLink('#/spieler', 'Spieler', visiblePlayers().map((p) => p.name).join(', ') || 'Noch niemand angelegt'),
      bigLink('#/daten', 'Daten & Sicherung', 'Export, Import, Wortliste')),
    backupNote,
  );
  return { title: 'Familien-Scrabble', back: null, content };
}

// ======================================================================
// Neue Partie
// ======================================================================

async function newGameView() {
  const running = await db.runningGame();
  if (running) {
    return {
      title: 'Neue Partie',
      content: card(
        h('p', { class: 'lead' }, 'Es läuft noch eine Partie vom ', fmtLongDate(running.date), '.'),
        h('p', null, scoreSummary(running)),
        h('div', { class: 'button-col' },
          h('a', { class: 'btn primary', href: '#/spiel' }, 'Weiterspielen'),
          h('a', { class: 'btn secondary', href: '#/ende' }, 'Diese Partie beenden'),
          h('button', {
            class: 'btn danger-outline',
            onclick: async () => {
              if (!(await confirmDialog('Die laufende Partie wird gelöscht. Alle eingetragenen Züge gehen verloren.', { ok: 'Löschen', danger: true, title: 'Partie verwerfen?' }))) return;
              await db.deleteGame(running.id);
              toast('Partie verworfen');
              refresh();
            },
          }, 'Laufende Partie verwerfen'))),
    };
  }

  const lastOrder = (await db.getMeta('lastOrder')) || [];
  const startBtn = h('button', { class: 'btn primary big', disabled: true }, 'Partie starten');
  const picker = playerPicker({
    selected: lastOrder.filter((id) => state.byId[id] && !state.byId[id].hidden),
    onChange: (ids) => (startBtn.disabled = ids.length < 2),
  });
  startBtn.disabled = picker.ids.length < 2;
  startBtn.addEventListener('click', async () => {
    const ids = picker.ids;
    if (ids.length < 2) return;
    const game = G.createGame({ playerIds: ids });
    await db.saveGame(game);
    await db.setMeta('lastOrder', ids);
    navigator.storage?.persist?.().catch(() => {});
    go('#/spiel');
  });

  return {
    title: 'Neue Partie',
    content: h('div', null, card(picker.el), h('div', { class: 'sticky-actions' }, startBtn)),
  };
}

// ======================================================================
// Während des Spiels
// ======================================================================

async function playView() {
  const game = await db.runningGame();
  if (!game) {
    toast('Keine laufende Partie');
    location.replace('#/');
    return null;
  }
  let digits = '';

  const board = h('div', { class: 'scoreboard n' + game.playerIds.length, style: { '--n': game.playerIds.length } });
  const history = h('ol', { class: 'history' });
  const whoEl = h('div', { class: 'who' });
  const pointsEl = h('div', { class: 'points-display', 'aria-live': 'polite' });
  const word = wordInput({ placeholder: 'Wort (freiwillig)', 'aria-label': 'Gelegtes Wort (freiwillig)' });
  const hint = wordHint(word);
  const undoBtn = h('button', { class: 'btn secondary', onclick: undo }, '↶ Rückgängig');

  function renderBoard() {
    const totals = G.turnTotals(game);
    const cur = G.currentPlayerId(game);
    const best = Math.max(...Object.values(totals));
    const lastByPlayer = {};
    for (const t of game.turns) lastByPlayer[t.playerId] = t;
    board.replaceChildren(
      ...game.playerIds.map((id) => {
        const last = lastByPlayer[id];
        return h('div', { class: 'score-card' + (id === cur ? ' active' : '') },
          h('div', { class: 'score-name' }, pname(id)),
          h('div', { class: 'score-total' }, totals[id]),
          h('div', { class: 'score-last' },
            last ? (last.pass ? 'zuletzt: ausgesetzt' : `zuletzt: +${last.points}`) : ' ',
            totals[id] === best && best > 0 ? h('span', { class: 'lead-mark', title: 'Führt' }, ' ★') : null));
      }),
    );
  }

  function renderHistory() {
    const items = game.turns.map((t, i) => ({ t, i })).reverse();
    history.replaceChildren(
      ...items.map(({ t, i }) =>
        h('li', null,
          h('button', { class: 'history-item' + (t.pass ? ' pass' : ''), onclick: () => edit(t, i) },
            h('span', { class: 'h-round' }, 'R', G.roundOf(game, i)),
            h('span', { class: 'h-main' },
              h('span', { class: 'h-name' }, pname(t.playerId)),
              t.pass || t.word ? h('span', { class: 'h-word' }, t.pass ? 'ausgesetzt / getauscht' : t.word) : null),
            h('span', { class: 'h-points' }, t.points),
            h('span', { class: 'h-edit', 'aria-label': 'Korrigieren' }, '✎')))),
    );
    if (!items.length) history.append(h('li', { class: 'muted empty' }, 'Noch keine Züge.'));
    undoBtn.disabled = !game.turns.length;
  }

  function renderEntry() {
    whoEl.replaceChildren(h('span', { class: 'who-label' }, 'Am Zug:'), ' ', h('strong', null, pname(G.currentPlayerId(game))));
    pointsEl.textContent = digits || 'Punkte';
    pointsEl.classList.toggle('empty', !digits);
  }

  function renderAll() { renderBoard(); renderHistory(); renderEntry(); }

  function press(k) {
    if (k === 'back') digits = digits.slice(0, -1);
    else if (k === 'clear') digits = '';
    else if (digits === '0') digits = k;
    else if (digits.length < 3) digits += k;
    renderEntry();
  }

  // Änderungen sofort im Speicher übernehmen und anzeigen; das Schreiben in die
  // Datenbank läuft nacheinander im Hintergrund (kein Doppel-Eintrag bei schnellem Tippen).
  function persist() {
    return queueSave(game);
  }

  function resetEntry() {
    digits = '';
    word.value = '';
    hint.reset();
  }

  function submit() {
    const pts = G.parsePoints(digits);
    if (pts === null) {
      toast('Bitte zuerst die Punkte eingeben.', 'warn');
      pointsEl.classList.remove('shake');
      void pointsEl.offsetWidth;
      pointsEl.classList.add('shake');
      return;
    }
    const pid = G.currentPlayerId(game);
    G.addTurn(game, { points: pts, word: normalizeWord(word.value) });
    resetEntry();
    word.blur();
    renderAll();
    persist();
    toast(`${pname(pid)}: ${pts} ${pts === 1 ? 'Punkt' : 'Punkte'}`);
  }

  function pass() {
    const pid = G.currentPlayerId(game);
    G.addTurn(game, { pass: true });
    resetEntry();
    renderAll();
    persist();
    toast(`${pname(pid)}: ausgesetzt / getauscht`);
  }

  async function undo() {
    const last = game.turns.at(-1);
    if (!last) return;
    const desc = last.pass ? 'Aussetzen/Tauschen' : `${last.points} Punkte${last.word ? ' (' + last.word + ')' : ''}`;
    if (!(await confirmDialog(`Letzten Zug von ${pname(last.playerId)} löschen: ${desc}?`, { ok: 'Rückgängig', title: 'Rückgängig machen' }))) return;
    if (game.turns.at(-1) !== last) return;
    G.undoLastTurn(game);
    // Werte zurück ins Eingabefeld, damit man sie korrigiert neu eintragen kann
    digits = last.pass ? '' : String(last.points);
    word.value = last.word || '';
    if (word.value) hint.run(); else hint.reset();
    renderAll();
    persist();
    toast(`${pname(last.playerId)} ist wieder dran`);
  }

  async function edit(t, i) {
    if (await editTurnDialog(game, t, G.roundOf(game, i))) renderAll();
  }

  const key = (label, k, cls = '') =>
    h('button', {
      class: 'key ' + cls, type: 'button', tabindex: '-1',
      onmousedown: (e) => e.preventDefault(), // Fokus nicht wegnehmen
      onclick: () => press(k), 'aria-label': k === 'back' ? 'Löschen' : k === 'clear' ? 'Alles löschen' : label }, label);

  const pad = h('div', { class: 'numpad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d)),
    key('C', 'clear', 'fn'), key('0', '0'), key('⌫', 'back', 'fn'));

  const onKey = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.target === word) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      return;
    }
    if (e.target.closest?.('input, textarea, select')) return;
    if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { press('back'); e.preventDefault(); }
    else if (e.key === 'Escape') press('clear');
    else if (e.key === 'Enter' && !e.target.closest?.('button, a')) { e.preventDefault(); submit(); }
  };
  document.addEventListener('keydown', onKey);

  renderAll();

  const content = h('div', { class: 'play' },
    board,
    h('div', { class: 'play-entry' },
      h('section', { class: 'card entry' },
        whoEl,
        pointsEl,
        h('div', { class: 'word-row' }, word, hint.el),
        pad,
        h('button', { class: 'btn primary big', onclick: submit }, 'Eintragen ✓'),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn pass-btn', onclick: pass }, 'Aussetzen / Getauscht'),
          undoBtn))),
    h('section', { class: 'card history-card' },
      h('h2', null, 'Verlauf ', h('small', { class: 'muted' }, '(antippen zum Korrigieren)')),
      history),
    h('div', { class: 'button-row end-row' },
      h('a', { class: 'btn secondary', href: '#/ende' }, 'Partie beenden ›'),
      h('button', {
        class: 'btn danger-outline small',
        onclick: async () => {
          if (!(await confirmDialog('Die Partie wird gelöscht und nicht gespeichert.', { ok: 'Löschen', danger: true, title: 'Partie abbrechen?' }))) return;
          await db.deleteGame(game.id);
          toast('Partie gelöscht');
          go('#/');
        },
      }, 'Abbrechen')),
  );

  return {
    title: fmtWeekdayShort(game.date) + ', ' + fmtDate(game.date),
    content,
    className: 'page-play',
    cleanup: () => document.removeEventListener('keydown', onKey),
  };
}

// ======================================================================
// Spielende
// ======================================================================

async function endView() {
  const game = await db.runningGame();
  if (!game) {
    location.replace('#/');
    return null;
  }
  const form = endForm(() => game);
  const save = h('button', {
    class: 'btn primary big',
    onclick: async () => {
      let end;
      try { end = form.getEnd(); } catch (e) { toast(e.message, 'warn'); return; }
      if (!game.turns.length && !(await confirmDialog('Es wurde noch kein Zug eingetragen. Trotzdem beenden?', { ok: 'Beenden' }))) return;
      G.finishGame(game, end);
      await db.saveGame(game);
      go('#/partie/' + game.id);
    },
  }, 'Partie speichern');

  return {
    title: 'Partie beenden',
    back: '#/spiel',
    content: h('div', null,
      card(form.el),
      h('div', { class: 'sticky-actions' }, save, h('a', { class: 'btn secondary', href: '#/spiel' }, 'Zurück zum Spiel'))),
  };
}

// ======================================================================
// Archiv
// ======================================================================

let archiveFilter = null;

async function archiveView() {
  const games = await db.games();
  const inGames = new Set(games.flatMap((g) => g.playerIds));
  const filterPlayers = state.players.filter((p) => inGames.has(p.id));
  if (archiveFilter && !inGames.has(archiveFilter)) archiveFilter = null;
  const shown = games.filter((g) => !archiveFilter || g.playerIds.includes(archiveFilter));

  const list = h('div', { class: 'archive-list' });
  let year = null;
  for (const g of shown) {
    const y = g.date.slice(0, 4);
    if (y !== year) { year = y; list.append(h('h2', { class: 'year' }, y)); }
    list.append(
      h('a', { class: 'archive-item', href: g.status === 'running' ? '#/spiel' : '#/partie/' + g.id },
        h('span', { class: 'a-date' },
          fmtLongDate(g.date),
          g.status === 'running' ? h('span', { class: 'badge live' }, 'läuft') : null,
          g.source === 'paper' ? h('span', { class: 'badge' }, 'Papier') : null),
        scoreSummary(g)));
  }

  const content = h('div', null,
    filterPlayers.length > 1
      ? h('div', { class: 'chip-list filter' },
        h('button', { class: 'chip' + (!archiveFilter ? ' selected' : ''), onclick: () => { archiveFilter = null; refresh(); } }, 'Alle'),
        filterPlayers.map((p) =>
          h('button', { class: 'chip' + (archiveFilter === p.id ? ' selected' : ''), onclick: () => { archiveFilter = p.id; refresh(); } }, p.name)))
      : null,
    shown.length ? list : card(h('p', { class: 'muted' }, 'Noch keine Partien gespeichert.')),
    h('div', { class: 'button-col' }, h('a', { class: 'btn secondary', href: '#/nachtragen' }, '+ Papierpartie nachtragen')),
  );
  return { title: 'Archiv', content };
}

// ======================================================================
// Detailansicht
// ======================================================================

async function gameDetailView(id) {
  const game = await db.game(id);
  if (!game) return { title: 'Partie', back: '#/archiv', content: card(h('p', null, 'Partie nicht gefunden.')) };
  if (game.status === 'running') { location.replace('#/spiel'); return null; }

  const totals = G.turnTotals(game);
  const counts = G.turnCounts(game);
  const rounds = G.turnsByRound(game);
  const turnIndex = new Map(game.turns.map((t, i) => [t.id, i]));

  const finalTable = h('table', { class: 'table final-table' },
    h('thead', null, h('tr', null,
      h('th', null, 'Spieler'), h('th', { class: 'num' }, 'Züge'), h('th', { class: 'num' }, 'Rest'), h('th', { class: 'num' }, 'Ende'))),
    h('tbody', null,
      game.playerIds.map((pid) =>
        h('tr', { class: game.winnerIds.includes(pid) ? 'winner' : '' },
          h('td', null, game.winnerIds.includes(pid) ? '🏆 ' : '', pname(pid)),
          h('td', { class: 'num' }, totals[pid]),
          h('td', { class: 'num' }, game.end?.outPlayerId === pid ? 'aus' : '− ' + (game.end?.remaining?.[pid] ?? 0)),
          h('td', { class: 'num strong' }, game.finalScores[pid])))));

  const turnsTable = h('div', { class: 'table-scroll' },
    h('table', { class: 'table turns-table' },
      h('thead', null, h('tr', null, h('th', null, 'R'), game.playerIds.map((pid) => h('th', null, pname(pid))))),
      h('tbody', null,
        rounds.map((row, r) =>
          h('tr', null,
            h('td', { class: 'muted' }, r + 1),
            row.map((t) =>
              t
                ? h('td', null,
                  h('button', {
                    class: 'cell-btn' + (t.pass ? ' pass' : ''),
                    onclick: async () => { if (await editTurnDialog(game, t, r + 1)) refresh(); },
                  },
                  h('span', { class: 'cell-points' }, t.pass ? '–' : t.points),
                  h('span', { class: 'cell-word' }, t.pass ? 'ausgesetzt' : t.word || '')))
                : h('td', null))))),
      h('tfoot', null, h('tr', null, h('td', null, 'Σ'), game.playerIds.map((pid) => h('td', { class: 'strong' }, totals[pid], h('small', { class: 'muted' }, ` (${counts[pid]})`)))))));

  async function changeDate() {
    const input = h('input', { type: 'date', class: 'text-input', value: game.date, max: G.todayISO() });
    const ok = await modal({
      title: 'Datum ändern',
      body: h('label', { class: 'field' }, h('span', null, 'Datum'), input),
      buttons: [
        { label: 'Abbrechen', value: false, class: 'secondary' },
        { label: 'Speichern', value: true, class: 'primary', submit: true, validate: () => /^\d{4}-\d{2}-\d{2}$/.test(input.value) },
      ],
    });
    if (!ok) return;
    game.date = input.value;
    await db.saveGame(game);
    refresh();
  }

  async function editEnd() {
    const form = endForm(() => game, game.end);
    let end;
    const ok = await modal({
      title: 'Spielende bearbeiten',
      body: form.el,
      buttons: [
        { label: 'Abbrechen', value: false, class: 'secondary' },
        {
          label: 'Speichern', value: true, class: 'primary', submit: true,
          validate: () => {
            try { end = form.getEnd(); return true; } catch (e) { toast(e.message, 'warn'); return false; }
          },
        },
      ],
    });
    if (!ok) return;
    G.updateEnd(game, end);
    await db.saveGame(game);
    toast('Endstand aktualisiert');
    refresh();
  }

  async function reopen() {
    if (await db.runningGame()) { alertDialog('Es läuft bereits eine andere Partie. Bitte diese zuerst beenden.'); return; }
    if (!(await confirmDialog('Das Spielende wird zurückgenommen und die Partie läuft weiter.', { ok: 'Weiterspielen', title: 'Partie fortsetzen?' }))) return;
    G.reopenGame(game);
    await db.saveGame(game);
    go('#/spiel');
  }

  async function remove() {
    if (!(await confirmDialog(`Die Partie vom ${fmtDate(game.date)} wird endgültig gelöscht.`, { ok: 'Löschen', danger: true, title: 'Partie löschen?' }))) return;
    await db.deleteGame(game.id);
    toast('Partie gelöscht');
    go('#/archiv');
  }

  const content = h('div', { class: 'detail' },
    h('p', { class: 'lead' }, fmtLongDate(game.date),
      game.source === 'paper' ? h('span', { class: 'badge' }, 'Papier') : null),
    winnerLine(game),
    card(h('h2', null, 'Endstand'), finalTable,
      game.end && game.end.outPlayerId
        ? h('p', { class: 'muted' }, `${pname(game.end.outPlayerId)} hat alle Steine abgelegt.`)
        : h('p', { class: 'muted' }, 'Niemand hat alle Steine abgelegt.')),
    card(h('h2', null, 'Alle Züge ', h('small', { class: 'muted' }, '(antippen zum Korrigieren)')), turnsTable),
    h('div', { class: 'button-col' },
      h('button', { class: 'btn secondary', onclick: editEnd }, 'Spielende bearbeiten'),
      h('button', { class: 'btn secondary', onclick: changeDate }, 'Datum ändern'),
      game.source === 'live' ? h('button', { class: 'btn secondary', onclick: reopen }, 'Ende zurücknehmen & weiterspielen') : null,
      h('button', { class: 'btn danger-outline', onclick: remove }, 'Partie löschen'),
      h('a', { class: 'btn primary', href: '#/' }, 'Zur Startseite')),
  );
  return { title: 'Partie', back: '#/archiv', content };
}

// ======================================================================
// Papierpartie nachtragen
// ======================================================================

async function paperView() {
  const lists = {}; // playerId -> Text
  let ids = [];
  const dateInput = h('input', { type: 'date', class: 'text-input', value: G.todayISO(), max: G.todayISO(), required: true });
  const listsBox = h('div', { class: 'paper-lists' });

  const tmpGame = () => {
    const parsed = Object.fromEntries(ids.map((id) => [id, G.parseTurnList(lists[id]).turns]));
    const turns = [];
    const max = Math.max(0, ...ids.map((id) => parsed[id].length));
    for (let r = 0; r < max; r++) for (const id of ids) if (parsed[id][r]) turns.push({ ...parsed[id][r], playerId: id });
    return { playerIds: ids, turns, parsed };
  };

  const end = endForm(tmpGame);
  const endCard = card(end.el);

  function renderLists() {
    listsBox.replaceChildren(
      ...ids.map((id) => {
        const info = h('div', { class: 'paper-info' });
        const update = () => {
          const { turns, errors } = G.parseTurnList(lists[id]);
          const sum = turns.reduce((s, t) => s + t.points, 0);
          info.replaceChildren(
            h('span', null, `${turns.length} Züge · Summe ${sum}`),
            errors.length ? h('span', { class: 'error' }, ` · nicht erkannt: ${errors.join(' ')}`) : null);
        };
        const ta = h('textarea', {
          class: 'paper-input',
          rows: 3,
          inputmode: 'text',
          placeholder: 'z. B. 12 24 8 0 31 …',
          value: lists[id] || '',
          oninput: (e) => { lists[id] = e.target.value; update(); end.renderPreview(); },
        });
        update();
        return h('label', { class: 'field' }, h('span', null, pname(id)), ta, info);
      }),
    );
  }

  const picker = playerPicker({
    onChange: (next) => {
      ids = next;
      renderLists();
      end.render();
      endCard.hidden = ids.length < 2;
    },
  });
  endCard.hidden = true;

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) return toast('Bitte ein Datum wählen.', 'warn');
    if (ids.length < 2) return toast('Bitte mindestens 2 Spieler wählen.', 'warn');
    const { parsed } = tmpGame();
    for (const id of ids) {
      const { errors } = G.parseTurnList(lists[id]);
      if (errors.length) return toast(`Bei ${pname(id)} wurde nicht alles erkannt: ${errors.join(' ')}`, 'warn');
    }
    if (!ids.some((id) => parsed[id].length)) return toast('Bitte die Züge eintragen.', 'warn');
    let e;
    try { e = end.getEnd(); } catch (err) { return toast(err.message, 'warn'); }
    const game = G.buildPaperGame({ date: dateInput.value, playerIds: ids, lists: parsed, end: e });
    await db.saveGame(game);
    toast('Papierpartie gespeichert');
    go('#/partie/' + game.id);
  }

  const content = h('div', null,
    card(h('label', { class: 'field' }, h('span', null, 'Datum der Partie'), dateInput)),
    card(picker.el),
    card(
      h('h2', null, 'Züge je Spieler'),
      h('p', { class: 'muted' }, 'Punkte der Reihe nach, getrennt durch Leerzeichen oder Komma. ',
        h('b', null, '0'), ' oder ', h('b', null, '-'), ' = ausgesetzt/getauscht. Ein Wort darf direkt hinter der Zahl stehen (z. B. „24 HAUS“).'),
      listsBox),
    endCard,
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary big', onclick: save }, 'Papierpartie speichern')),
  );
  renderLists();
  return { title: 'Papierpartie nachtragen', content };
}

// ======================================================================
// Statistik
// ======================================================================

async function statsView() {
  const games = await db.games();
  const s = computeStats(games);
  if (!s.gameCount) {
    return { title: 'Statistik', content: card(h('p', { class: 'muted' }, 'Noch keine abgeschlossenen Partien.')) };
  }
  const gameLink = (gameId, ...children) => h('a', { href: '#/partie/' + gameId, class: 'record-link' }, ...children);
  const inlineLink = (gameId, ...children) => h('a', { href: '#/partie/' + gameId }, ...children);
  const rows = Object.values(s.players).sort((a, b) => b.wins + b.sharedWins - (a.wins + a.sharedWins) || b.avgScore - a.avgScore);

  const recordCards = h('div', { class: 'records' },
    s.records.bestGame
      ? gameLink(s.records.bestGame.gameId,
        h('span', { class: 'record-label' }, 'Höchste Partie'),
        h('span', { class: 'record-value' }, s.records.bestGame.score),
        h('span', { class: 'record-sub' }, pname(s.records.bestGame.playerId), ' · ', fmtDate(s.records.bestGame.date)))
      : null,
    s.records.bestTurn
      ? gameLink(s.records.bestTurn.gameId,
        h('span', { class: 'record-label' }, 'Höchster Einzelzug'),
        h('span', { class: 'record-value' }, s.records.bestTurn.points),
        h('span', { class: 'record-sub' }, pname(s.records.bestTurn.playerId), s.records.bestTurn.word ? ` · ${s.records.bestTurn.word}` : '', ' · ', fmtDate(s.records.bestTurn.date)))
      : null,
    h('div', { class: 'record-link static' },
      h('span', { class: 'record-label' }, 'Partien'),
      h('span', { class: 'record-value' }, s.gameCount),
      h('span', { class: 'record-sub' }, 'abgeschlossen')),
  );

  const playerCards = rows.map((p) =>
    h('section', { class: 'card player-stats' },
      h('h2', null, pname(p.id)),
      h('dl', { class: 'stat-grid' },
        stat('Partien', p.games),
        stat('Siege', p.wins + (p.sharedWins ? ` (+${p.sharedWins} geteilt)` : '')),
        stat('Siegquote', fmtNum(p.winRate * 100) + ' %'),
        stat('Ø Endstand', fmtNum(p.avgScore, 1)),
        stat('Ø pro Zug', fmtNum(p.avgTurn, 1)),
        stat('Höchste Partie', p.bestGame ? inlineLink(p.bestGame.gameId, p.bestGame.score, h('small', null, ' ', fmtDate(p.bestGame.date))) : '–'),
        stat('Höchster Zug', p.bestTurn ? inlineLink(p.bestTurn.gameId, p.bestTurn.points, p.bestTurn.word ? h('small', null, ' ', p.bestTurn.word) : null) : '–'),
        stat('Ausgesetzt', p.passes))));

  const duels = s.duels
    .sort((x, y) => y.games - x.games)
    .map((d) => {
      const [left, right] = pname(d.a).localeCompare(pname(d.b), 'de') <= 0
        ? [[d.a, d.aWins], [d.b, d.bWins]]
        : [[d.b, d.bWins], [d.a, d.aWins]];
      return h('div', { class: 'duel' },
        h('span', { class: 'duel-name left' + (left[1] > right[1] ? ' strong' : '') }, pname(left[0])),
        h('span', { class: 'duel-score' }, `${left[1]} : ${right[1]}`),
        h('span', { class: 'duel-name right' + (right[1] > left[1] ? ' strong' : '') }, pname(right[0])),
        h('span', { class: 'duel-sub' },
          `${d.games} gemeinsame ${d.games === 1 ? 'Partie' : 'Partien'}`,
          d.draws ? ` · ${d.draws}× gleich` : '',
          d.twoPlayerGames && d.twoPlayerGames !== d.games ? ` · davon ${d.twoPlayerGames} zu zweit` : ''));
    });

  return {
    title: 'Statistik',
    content: h('div', null,
      recordCards,
      ...playerCards,
      card(
        h('h2', null, 'Duell-Bilanz'),
        h('p', { class: 'muted' }, 'Wer hatte am Ende mehr Punkte – gezählt in allen Partien, in denen beide mitgespielt haben.'),
        h('div', { class: 'duels' }, duels))),
  };
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('dt', null, label), h('dd', null, value));
}

// ======================================================================
// Spielerliste
// ======================================================================

async function playersView() {
  const games = await db.games();
  const used = new Set(games.flatMap((g) => g.playerIds));

  async function reorder(i, d) {
    const list = [...state.players];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    for (let k = 0; k < list.length; k++) {
      if (list[k].order !== k) { list[k].order = k; await db.savePlayer(list[k]); }
    }
    await loadPlayers();
    refresh();
  }

  const list = h('ul', { class: 'player-list' },
    state.players.map((p, i) => {
      const input = h('input', { type: 'text', class: 'text-input', value: p.name, 'aria-label': 'Name' });
      const saveName = async () => {
        const name = input.value.trim();
        if (!name || name === p.name) { input.value = p.name; return; }
        if (state.players.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) {
          toast('Diesen Namen gibt es schon.', 'warn');
          input.value = p.name;
          return;
        }
        p.name = name;
        await db.savePlayer(p);
        await loadPlayers();
        toast('Name gespeichert');
      };
      input.addEventListener('change', saveName);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      return h('li', { class: 'player-row' + (p.hidden ? ' hidden-player' : '') },
        input,
        h('div', { class: 'player-actions' },
          h('button', { class: 'icon-btn', disabled: i === 0, 'aria-label': 'Nach oben', onclick: () => reorder(i, -1) }, '▲'),
          h('button', { class: 'icon-btn', disabled: i === state.players.length - 1, 'aria-label': 'Nach unten', onclick: () => reorder(i, 1) }, '▼'),
          h('button', {
            class: 'btn small secondary',
            onclick: async () => { p.hidden = !p.hidden; await db.savePlayer(p); await loadPlayers(); refresh(); },
          }, p.hidden ? 'Einblenden' : 'Ausblenden'),
          used.has(p.id)
            ? null
            : h('button', {
              class: 'btn small danger-outline',
              onclick: async () => {
                if (!(await confirmDialog(`${p.name} löschen?`, { ok: 'Löschen', danger: true }))) return;
                await db.deletePlayer(p.id);
                await loadPlayers();
                refresh();
              },
            }, 'Löschen')));
    }));

  const newInput = h('input', { type: 'text', class: 'text-input', placeholder: 'Name', autocomplete: 'off' });
  const add = async () => {
    if (await createPlayer(newInput.value)) { toast('Spieler angelegt'); refresh(); }
  };
  newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  return {
    title: 'Spieler',
    content: h('div', null,
      card(list, h('p', { class: 'muted' }, 'Ausgeblendete Spieler erscheinen nicht mehr bei „Neue Partie“, bleiben aber im Archiv und in der Statistik. Löschen geht nur, solange jemand noch in keiner Partie vorkommt.')),
      card(h('h2', null, 'Neuer Spieler'), h('div', { class: 'inline-form' }, newInput, h('button', { class: 'btn primary', onclick: add }, 'Hinzufügen')))),
  };
}

// ======================================================================
// Wort prüfen
// ======================================================================

const checkedWords = [];

const VERDICT_TEXT = { ok: '✓ erlaubt', warn: '⚠ selten', deny: '✗ nicht erlaubt', missing: 'nicht in der Liste' };

async function saveRules(next) {
  state.rules = normalizeRules(next);
  await db.setMeta('houseRules', state.rules);
}

async function wordView() {
  const input = wordInput({ placeholder: 'Wort eingeben', 'aria-label': 'Wort' });
  const result = h('div', { class: 'word-result', 'aria-live': 'polite' });
  const recent = h('ul', { class: 'recent-words' });

  function renderRecent() {
    recent.replaceChildren(
      ...checkedWords.map((r) => h('li', { class: r.verdict }, h('span', null, r.word), h('span', null, VERDICT_TEXT[r.verdict] || r.reason || ''))),
    );
  }

  function exceptionButtons(word) {
    const inAllow = state.rules.allow.includes(word);
    const inDeny = state.rules.deny.includes(word);
    const set = async (allow, deny, msg) => {
      await saveRules({ ...state.rules, allow, deny });
      toast(msg);
      run();
    };
    const without = (list) => list.filter((x) => x !== word);
    return h('div', { class: 'exception-row' },
      inAllow || inDeny
        ? h('button', { class: 'btn small secondary', onclick: () => set(without(state.rules.allow), without(state.rules.deny), 'Ausnahme entfernt') }, 'Ausnahme entfernen')
        : [
          h('button', { class: 'btn small secondary', onclick: () => set([...state.rules.allow, word], state.rules.deny, `${word} gilt bei euch`) }, '✓ Bei uns erlaubt'),
          h('button', { class: 'btn small secondary', onclick: () => set(state.rules.allow, [...state.rules.deny, word], `${word} gilt bei euch nicht`) }, '✗ Bei uns nicht erlaubt'),
        ]);
  }

  async function run() {
    if (!input.value.trim()) return;
    result.className = 'word-result pending';
    result.textContent = 'Prüfe …';
    const r = await judgeWord(input.value, state.rules);
    const head = {
      ok: r.custom ? '✓ bei euch erlaubt (eigene Ausnahme)' : '✓ steht in der Wortliste',
      warn: `⚠ steht in der Liste: ${r.reason}`,
      deny: `✗ ${r.reason}`,
      missing: 'nicht in der Wortliste gefunden',
    }[r.verdict] || r.reason || '';
    result.className = 'word-result ' + ({ ok: 'ok', warn: 'warn', deny: 'deny', missing: 'warn' }[r.verdict] || 'muted');
    const parts = [h('strong', null, r.word || '–'), h('span', null, head)];
    if (r.info?.length) {
      parts.push(h('ul', { class: 'word-origin' },
        r.info.map((x) =>
          h('li', null,
            h('b', null, x.lemma), ' ', h('span', { class: 'muted' }, x.pos + (x.short ? ' · Kurzwort' : '')),
            x.forms && !x.forms.startsWith('Grundform') ? h('div', null, x.forms) : null,
            x.gloss ? h('div', { class: 'gloss' }, x.gloss) : null,
            x.marks.length ? h('div', { class: 'marks' }, x.marks.join(' · ')) : null))));
    }
    if (r.word && r.verdict !== 'invalid') parts.push(exceptionButtons(r.word));
    result.replaceChildren(...parts);
    if (r.word && r.verdict !== 'invalid') {
      const i = checkedWords.findIndex((x) => x.word === r.word);
      if (i >= 0) checkedWords.splice(i, 1);
      checkedWords.unshift(r);
      checkedWords.length = Math.min(checkedWords.length, 12);
      renderRecent();
    }
    input.select();
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  renderRecent();

  return {
    title: 'Wort prüfen',
    content: h('div', null,
      card(
        h('div', { class: 'inline-form' }, input, h('button', { class: 'btn primary', onclick: run }, 'Prüfen')),
        result,
        h('p', { class: 'muted small' },
          'Nur ein Hinweis! Die Liste enthält die Formen aus dem deutschen Wiktionary, aber nicht jedes gültige Wort; ',
          'z. B. fehlen oft Genitive wie „ANPOCHENS“. Was am Tisch gilt, entscheidet ihr – ',
          h('a', { href: '#/hausregeln' }, 'eure Hausregeln'), ' werden berücksichtigt. ',
          'Die Herkunft (Grundform und Bedeutung) braucht beim ersten Mal je Anfangsbuchstabe Internet.'),
        !wordCheckSupported ? h('p', { class: 'error' }, 'Dieser Browser ist zu alt für die Wortprüfung.') : null),
      checkedWords.length ? card(h('h2', null, 'Zuletzt geprüft'), recent) : null),
    onMount: () => input.focus(),
  };
}

// ======================================================================
// Hausregeln
// ======================================================================

async function rulesView() {
  const r = state.rules;
  const choice = (label, sub, active, onclick) =>
    h('button', { type: 'button', class: 'choice' + (active ? ' selected' : ''), 'aria-pressed': String(active), onclick },
      label, sub ? h('small', { class: 'choice-sub' }, sub) : null);
  const update = async (patch) => { await saveRules({ ...state.rules, ...patch }); toast('Hausregel gespeichert'); refresh(); };
  const levelCard = (key, title, example) => card(
    h('h2', null, title),
    h('p', { class: 'muted' }, example),
    h('div', { class: 'choice-list' },
      choice('Erlaubt', null, r[key] === 'allow', () => update({ [key]: 'allow' })),
      choice('Erlaubt, aber mit Hinweis', null, r[key] === 'warn', () => update({ [key]: 'warn' })),
      choice('Nicht erlaubt', null, r[key] === 'deny', () => update({ [key]: 'deny' }))));

  const addInput = wordInput({ placeholder: 'Wort', 'aria-label': 'Wort für eigene Ausnahme' });
  const addTo = async (key) => {
    const w = normalizeWord(addInput.value);
    if (!w) return;
    const other = key === 'allow' ? 'deny' : 'allow';
    await saveRules({ ...state.rules, [key]: [...state.rules[key], w], [other]: state.rules[other].filter((x) => x !== w) });
    toast(key === 'allow' ? `${w} gilt bei euch` : `${w} gilt bei euch nicht`);
    refresh();
  };
  const list = (key, empty) =>
    r[key].length
      ? h('div', { class: 'chip-list' }, r[key].map((w) =>
        h('button', { class: 'chip', title: 'Entfernen', onclick: () => update({ [key]: r[key].filter((x) => x !== w) }) }, w, ' ✕')))
      : h('p', { class: 'muted' }, empty);

  return {
    title: 'Hausregeln',
    content: h('div', null,
      card(
        h('h2', null, 'Immer ausgeschlossen'),
        h('p', null, 'In der Wortliste stehen nie: ', h('b', null, 'Abkürzungen'), ' (LKW, BH, PKW …) und ',
          h('b', null, 'Eigennamen'), ' – Orte, Länder, Flüsse, Personen (BERLIN, IRLAND, RHEIN …).'),
        h('p', { class: 'muted' }, 'Erlaubt sind dagegen z. B. Einwohner wie IRE oder ENGLÄNDER. QI ist ein gewöhnliches Wort der Liste und bleibt erlaubt.')),
      card(
        h('h2', null, 'Kurzwörter (KITA, KRIPO, AZUBI)'),
        h('div', { class: 'choice-list' },
          choice('Erlaubt', 'z. B. KITA, AZUBI, UNI, KRIPO', r.shortForms, () => update({ shortForms: true })),
          choice('Nicht erlaubt', 'Achtung: auch AUTO, KINO, FOTO, ZOO sind Kurzwörter', !r.shortForms, () => update({ shortForms: false })))),
      levelCard('old', 'Veraltete Wörter und Schreibweisen', 'z. B. SEYN, THEIL, BEY – die alte Rechtschreibung kennt niemand mehr'),
      levelCard('regional', 'Regionale Wörter und Mundart', 'z. B. DÄZ (mitteldeutsch für Kopf), GLASTS (süddeutsch) – „nur Hochdeutsch“'),
      levelCard('rare', 'Seltene und poetische Wörter', 'z. B. Wörter, die das Wiktionary als selten oder dichterisch markiert'),
      card(
        h('h2', null, 'Eigene Ausnahmen'),
        h('p', { class: 'muted' }, 'Wörter, über die ihr am Tisch entschieden habt – gelten vor allen anderen Regeln. Auch direkt bei „Wort prüfen“ setzbar.'),
        h('div', { class: 'inline-form' }, addInput),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn secondary', onclick: () => addTo('allow') }, '✓ Erlaubt'),
          h('button', { class: 'btn secondary', onclick: () => addTo('deny') }, '✗ Nicht erlaubt')),
        h('h2', null, 'Bei euch erlaubt'), list('allow', 'Noch keine – z. B. DAX oder ANPOCHENS.'),
        h('h2', null, 'Bei euch nicht erlaubt'), list('deny', 'Noch keine.')),
      h('p', { class: 'muted small' }, 'Die Hausregeln werden mit der Sicherung gespeichert.')),
  };
}

// ======================================================================
// Daten & Sicherung
// ======================================================================

async function dataView() {
  const [games, lastExport] = await Promise.all([db.games(), db.getMeta('lastExport')]);
  const persisted = (await navigator.storage?.persisted?.()) ?? null;

  async function backupText() {
    const data = await db.exportAll();
    return JSON.stringify(data, null, 1);
  }
  const fileName = () => `scrabble-sicherung-${G.todayISO()}.json`;

  async function exportFile() {
    download(fileName(), await backupText());
    await db.setMeta('lastExport', new Date().toISOString());
    toast('Sicherung gespeichert');
    refresh();
  }

  async function shareFile() {
    const file = new File([await backupText()], fileName(), { type: 'application/json' });
    try {
      await navigator.share({ files: [file], title: 'Scrabble-Sicherung' });
      await db.setMeta('lastExport', new Date().toISOString());
      toast('Sicherung geteilt');
      refresh();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Teilen nicht möglich – bitte „Als Datei speichern“ nutzen.', 'warn');
    }
  }

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      validateBackup(data);
    } catch (e) {
      alertDialog(e instanceof SyntaxError ? 'Die Datei ist keine gültige Sicherung.' : e.message, 'Import nicht möglich');
      return;
    }
    const when = data.exportedAt ? ` vom ${fmtDate(data.exportedAt.slice(0, 10))}` : '';
    if (!(await confirmDialog(
      `Sicherung${when}: ${data.players.length} Spieler, ${data.games.length} Partien.\n\nAlle Daten auf diesem Gerät (${games.length} Partien) werden dabei ERSETZT.`,
      { ok: 'Ersetzen', danger: true, title: 'Sicherung einspielen?' },
    ))) return;
    await db.importAll(data);
    await loadPlayers();
    state.rules = normalizeRules(await db.getMeta('houseRules'));
    toast('Sicherung eingespielt');
    refresh();
  });

  const wordStatus = h('div', { class: 'word-status' }, h('p', { class: 'muted' }, 'Lade Status …'));
  async function renderWordStatus() {
    try {
      const st = await offlineStatus();
      const complete = st.cached >= st.total;
      const btn = h('button', { class: 'btn secondary', disabled: complete }, complete ? 'Offline verfügbar ✓' : 'Wortliste offline speichern');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await downloadAll((d, n) => (btn.textContent = `Lade … ${d}/${n}`));
          toast('Wortliste ist offline verfügbar');
        } catch {
          toast('Download fehlgeschlagen – bitte mit Internet erneut versuchen.', 'warn');
        }
        renderWordStatus();
      });
      wordStatus.replaceChildren(
        h('p', null, `${fmtNum(st.index.count)} Wörter, Wiktionary-Stand ${fmtDate((st.index.dumpDate || st.index.generated).slice(0, 10))}`,
          h('br'), h('span', { class: 'muted' }, `Offline gespeichert: ${st.cached} von ${st.total} Teilen`)),
        btn);
    } catch {
      wordStatus.replaceChildren(h('p', { class: 'error' }, 'Wortliste nicht erreichbar (offline und noch nicht gespeichert).'));
    }
  }
  renderWordStatus();

  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));

  return {
    title: 'Daten & Sicherung',
    content: h('div', null,
      card(
        h('h2', null, 'Sicherung'),
        h('p', null, `${games.length} Partien, ${state.players.length} Spieler auf diesem Gerät.`,
          h('br'), h('span', { class: 'muted' }, 'Letzte Sicherung: ', lastExport ? fmtDate(lastExport.slice(0, 10)) : 'noch nie')),
        h('p', { class: 'muted small' }, 'Alle Daten liegen nur auf diesem Gerät. Speichert regelmäßig eine Sicherung (z. B. in der Cloud oder per Mail an euch selbst).'),
        h('div', { class: 'button-col' },
          h('button', { class: 'btn primary', onclick: exportFile }, 'Als Datei speichern'),
          canShare ? h('button', { class: 'btn secondary', onclick: shareFile }, 'Teilen … (Mail, Cloud)') : null,
          h('button', { class: 'btn secondary', onclick: () => fileInput.click() }, 'Sicherung einspielen …'),
          fileInput)),
      card(
        h('h2', null, 'Speicher'),
        h('p', null, persisted === true ? 'Der Browser hält die Daten dauerhaft fest. ✓' : persisted === false ? 'Der Browser könnte die Daten bei Speichermangel löschen.' : 'Unbekannt.'),
        persisted === false
          ? h('button', {
            class: 'btn secondary',
            onclick: async () => {
              const ok = await navigator.storage.persist();
              toast(ok ? 'Daten werden dauerhaft gespeichert' : 'Browser hat abgelehnt – App zum Homescreen hinzufügen hilft oft.', ok ? '' : 'warn');
              refresh();
            },
          }, 'Dauerhaft speichern anfordern')
          : null),
      card(
        h('h2', null, 'Wortliste'),
        wordStatus,
        h('p', { class: 'muted small' },
          'Quelle: deutschsprachiges ',
          h('a', { href: 'https://de.wiktionary.org/', target: '_blank', rel: 'noopener' }, 'Wiktionary'),
          ', aufbereitet von ',
          h('a', { href: 'https://kaikki.org/dewiktionary/', target: '_blank', rel: 'noopener' }, 'kaikki.org'),
          ' (Wiktextract). Lizenz: ',
          h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/deed.de', target: '_blank', rel: 'noopener' }, 'CC BY-SA 4.0'),
          '. Verändert: auf Einzelwörter mit 2–15 Buchstaben reduziert, Großschreibung, ß → SS; Namen, Abkürzungen und alte Rechtschreibung entfernt.')),
      card(h('p', { class: 'muted small' }, `Familien-Scrabble ${APP_VERSION} · funktioniert ohne Internet · keine Konten, kein Server.`))),
  };
}

// ======================================================================
// Start der App
// ======================================================================

async function prefetchWords() {
  try {
    if (!wordCheckSupported || !navigator.onLine) return;
    const st = await offlineStatus();
    if (st.cached < st.total) await downloadAll();
  } catch { /* später erneut */ }
}

async function main() {
  try {
    await loadPlayers();
    state.rules = normalizeRules(await db.getMeta('houseRules'));
  } catch (e) {
    root.replaceChildren(frame({ title: 'Fehler', back: null, content: h('p', { class: 'error' }, 'Speicher nicht verfügbar: ', e.message) }));
    return;
  }
  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      // Wortliste im Hintergrund für den Offline-Betrieb holen
      setTimeout(prefetchWords, 3000);
    } catch (e) {
      console.warn('Service Worker nicht verfügbar', e);
    }
  } else {
    loadIndex().catch(() => {});
  }
}

main();
