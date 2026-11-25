// Kleine DOM-Helfer ohne Framework.

/** h('button', { class: 'x', onclick }, 'Text', child, …) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
      else if (k === 'value') el.value = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const fmtDate = (iso) => DATE.format(parseISODate(iso));
export const fmtWeekday = (iso) => WEEKDAY.format(parseISODate(iso));
export const fmtWeekdayShort = (iso) => WEEKDAY_SHORT.format(parseISODate(iso)).replace('.', '');
export const fmtLongDate = (iso) => `${fmtWeekday(iso)}, ${fmtDate(iso)}`;
export const fmtNum = (n, digits = 0) =>
  Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
}

/**
 * Modaler Dialog. buttons: [{ label, value, class }]
 * Gibt den value des gedrückten Knopfs zurück (Abbrechen/Escape = null).
 */
export function modal({ title, body, buttons, onOpen }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal' });
    const form = h('form', { onsubmit: (e) => e.preventDefault() });
    const btns = h('div', { class: 'modal-buttons' });
    let result = null;
    let submitBtn = null;
    for (const b of buttons) {
      const btn = h('button', {
        type: 'button',
        class: 'btn ' + (b.class || ''),
        onclick: async () => {
          if (b.validate && !(await b.validate())) return;
          result = b.value;
          dlg.close();
        },
      }, b.label);
      if (b.submit) submitBtn = btn;
      btns.append(btn);
    }
    // Enter in einem Eingabefeld = Bestätigen
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && submitBtn) {
        e.preventDefault();
        submitBtn.click();
      }
    });
    form.append(title ? h('h2', null, title) : null, body, btns);
    dlg.append(form);
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export async function confirmDialog(text, { ok = 'OK', cancel = 'Abbrechen', danger = false, title = null } = {}) {
  const r = await modal({
    title,
    body: h('p', { class: 'modal-text' }, text),
    buttons: [
      { label: cancel, value: false, class: 'secondary' },
      { label: ok, value: true, class: danger ? 'danger' : 'primary', submit: true },
    ],
  });
  return r === true;
}

export function alertDialog(text, title = null) {
  return modal({ title, body: h('p', { class: 'modal-text' }, text), buttons: [{ label: 'OK', value: true, class: 'primary', submit: true }] });
}

/** Ganzzahl-Eingabefeld (große Schrift, Ziffern-Tastatur am Handy). */
export function numberInput(props = {}) {
  return h('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    class: 'num-input',
    ...props,
  });
}

export function wordInput(props = {}) {
  return h('input', {
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    class: 'word-input',
    maxlength: 30,
    ...props,
  });
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
