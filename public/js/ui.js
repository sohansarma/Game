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
  if (html !== undefined) el.innerHTML = html;
  for (const s of $$('.screen')) s.classList.toggle('active', s === el);
  current = id;
  return el;
}

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
  lastFocus = document.activeElement;
  return new Promise((resolve) => {
    modalResolve = resolve;
    for (const btn of $$('.actions > [data-i]', sheet)) {
      btn.addEventListener('click', () => {
        sfx.tap();
        closeModal(buttons[Number(btn.dataset.i)].value);
      });
    }
    m.onclick = (e) => { if (dismissable && e.target === m) closeModal(null); };
    m.onkeydown = (e) => { if (dismissable && e.key === 'Escape') closeModal(null); };
    onOpen?.(sheet);
    const first = $('button, select, textarea', sheet);
    (first || sheet).focus({ preventScroll: true });
  });
}

export function closeModal(value) {
  const m = $('#modal');
  if (!m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  const r = modalResolve;
  modalResolve = null;
  lastFocus?.focus?.({ preventScroll: true });
  r?.(value);
}

export function isModalOpen() {
  return $('#modal').classList.contains('open');
}

export function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2700);
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
