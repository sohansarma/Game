// Tiny DOM helpers: screens, modals, toasts.

import { sfx } from './audio.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

let current = null;
const app = () => $('#app');

/** Show a screen; creates the <section> if needed and renders html into it. */
export function showScreen(id, html) {
  let el = $('#screen-' + id);
  if (!el) {
    el = document.createElement('section');
    el.id = 'screen-' + id;
    el.className = 'screen';
    app().appendChild(el);
  }
  // remember where focus was on the screen we're leaving, to return there later
  const active = document.activeElement;
  if (current && current !== id && active && active !== document.body) {
    returnTo[current] = active.id ? '#' + active.id : active.dataset?.g ? `[data-g="${active.dataset.g}"]` : null;
  }
  const changed = current !== id;
  if (html !== undefined) el.innerHTML = html;
  for (const s of $$('.screen')) s.classList.toggle('active', s === el);
  current = id;
  if (changed && !document.querySelector('.modal.open')) {
    // move focus into the new screen: back to the control you came from, else its heading
    setTimeout(() => {
      if (current !== id) return;
      const back = returnTo[id] && $(returnTo[id], el);
      const target = back || $('h1, h2', el);
      if (target) {
        if (!back && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: !!back });
      }
    }, 0);
  }
  return el;
}
const returnTo = {};

export function currentScreen() {
  return current;
}

let modalResolve = null;
let lastFocus = null;

/**
 * Open a modal sheet. `buttons` = [{ label, value, cls }]. Returns a promise
 * with the chosen value (or null when dismissed). `onOpen(sheet)` lets the
 * caller wire custom controls.
 */
export function modal(html, { buttons = [], dismissable = true, onOpen, row = false } = {}) {
  closeModal(null);
  const m = $('#modal');
  const sheet = $('.sheet', m);
  sheet.innerHTML = html + (buttons.length
    ? `<div class="actions ${row ? 'row2' : ''}">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`
    : '');
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  // the dialog is named by its heading, and everything behind it is inert
  const h = $('h1, h2', sheet);
  if (h) { h.id = 'modal-title'; m.setAttribute('aria-labelledby', 'modal-title'); } else m.removeAttribute('aria-labelledby');
  app()?.setAttribute('inert', '');
  if (!lastFocus || !m.contains(document.activeElement)) lastFocus = document.activeElement;
  return new Promise((resolve) => {
    modalResolve = resolve;
    const openedAt = performance.now();
    for (const btn of $$('.actions > [data-i]', sheet)) {
      btn.addEventListener('click', () => {
        if (performance.now() - openedAt < 450) return; // a key mashed as the modal opened
        sfx.tap();
        closeModal(buttons[Number(btn.dataset.i)].value);
      });
    }
    m.onclick = (e) => { if (dismissable && e.target === m) closeModal(null); };
    m.onkeydown = (e) => {
      if (dismissable && e.key === 'Escape') closeModal(null);
      if (e.key === 'Tab') {
        // keep Tab inside the sheet
        const f = $$('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])', sheet).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    onOpen?.(sheet);
    const first = $('input:not([readonly]):not([type=checkbox]):not([type=range]), button:not([disabled]), select, textarea', sheet);
    (first || sheet).focus({ preventScroll: true });
  });
}

export function closeModal(value) {
  const m = $('#modal');
  if (!m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  app()?.removeAttribute('inert');
  const r = modalResolve;
  modalResolve = null;
  lastFocus?.focus?.({ preventScroll: true });
  r?.(value);
}

export function isModalOpen() {
  return $('#modal').classList.contains('open');
}

// at most two toasts at a time; the rest wait their turn (so they never pile over a result card)
const toastQueue = [];
export function toast(text) {
  toastQueue.push(text);
  pumpToasts();
}
function pumpToasts() {
  const box = $('#toasts');
  while (toastQueue.length && box.children.length < 2) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = toastQueue.shift();
    box.appendChild(t);
    setTimeout(() => { t.remove(); pumpToasts(); }, 2400);
  }
}

export function starsHtml(n, max = 3) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<span class="${i < n ? 'star-on' : 'star-off'}">★</span>`;
  return s;
}

export function setBackground([a, b]) {
  document.documentElement.style.setProperty('--bg-a', a);
  document.documentElement.style.setProperty('--bg-b', b);
}
