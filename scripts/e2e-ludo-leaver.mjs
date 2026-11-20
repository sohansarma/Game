// Manual e2e: a 3-person online Ludo table where one player leaves – a bot must take over (takes ~4 min).
// Run: node scripts/e2e-ludo-leaver.mjs  (server on :8099, playwright installed)
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SH = process.env.SHOTS || '/tmp/ludo-leaver-';
const errors = [];
const browsers = [];
async function newPlayer(tag) {
  const br = await chromium.launch(); browsers.push(br);
  const p = await (await br.newContext({ ...devices['iPhone 13'] })).newPage();
  p.on('pageerror', (e) => errors.push(tag + ':' + e.message));
  await p.goto(process.env.BASE || 'http://localhost:8099/'); await sleep(1500);
  await p.click('.modal.open button:has-text("13 or older")'); await sleep(500);
  await p.click('.modal.open button:has-text("Let\'s play")'); await sleep(800);
  return p;
}
async function openLudo(p) {
  let card = await p.$('[aria-label*="Ludo"]');
  if (!card || !(await card.isVisible())) { await p.click('text=More games'); await sleep(600); card = await p.$('[aria-label*="Ludo"]'); }
  await card.click(); await sleep(500);
  await p.click('.modal.open button:has-text("Play a friend")'); await sleep(500);
}
const host = await newPlayer('host');
await openLudo(host);
await host.click('.modal.open button:has-text("Create online")'); await sleep(500);
await host.click('.modal.open .colour-btn[data-c="0"]'); await sleep(500);
if (await host.$('.modal.open .colour-pick')) { const a = await host.$('.modal.open .actions .btn'); if (a) await a.click(); await sleep(500); }
await host.click('.modal.open [data-n="3"]');
await host.check('.modal.open [data-rule="teams"]');
await host.check('.modal.open [data-rule="master"]');
await host.screenshot({ path: SH + 'create.png', fullPage: true });
await host.click('.modal.open button:has-text("Create the table")'); await sleep(1500);
const code = await host.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tidepop.save.v1')).versus || {}).pop());
console.log('code', code);
const cl = await host.$$('.modal.open .actions .btn'); if (cl.length) await cl[cl.length - 1].click(); await sleep(500);
const ps = [host];
for (const tag of ['g1', 'g2']) {
  const g = await newPlayer(tag);
  await openLudo(g);
  await g.click('.modal.open button:has-text("Join with a code")'); await sleep(500);
  await g.fill('#j-code', code); await g.click('.modal.open button:has-text("Join")'); await sleep(1500);
  const t = await g.$('.modal.open'); console.log(tag, 'join modal:', t ? (await t.textContent()).replace(/\s+/g, ' ') : 'none');
  if (tag === 'g1') await g.screenshot({ path: SH + 'join.png' });
  const pl = await g.$('.modal.open button:has-text("Play")'); if (pl) await pl.click(); await sleep(1200);
  ps.push(g);
}
// extra 5th joiner should be refused
const g4 = await newPlayer('g4'); await openLudo(g4);
await g4.click('.modal.open button:has-text("Join with a code")'); await sleep(500);
await g4.fill('#j-code', code); await g4.click('.modal.open button:has-text("Join")'); await sleep(1200);
console.log('5th:', (await g4.textContent('body')).match(/table is full|full/i)?.[0] || 'no full message seen');
for (const [i, p] of ps.entries()) console.log('p' + i, JSON.stringify(await p.evaluate(() => { const v = window.tidepop.view(); return v && { mine: v.sim.mine, seats: v.sim.seats, rules: v.game.rules, labels: [0, 1, 2, 3].map((s) => v.sim.labelOf(s)) }; })));
console.log('host label:', (await host.textContent('#ar-label')).trim());
const step = async (p) => {
  if (await p.$('.modal.open')) return 'modal';
  const st = await p.evaluate(() => { const v = window.tidepop.view(); return v ? { busy: v.busy(), roll: v.sim.canRoll(), move: v.sim.canMove(), over: v.sim.over } : null; });
  if (!st || st.over) return 'over';
  if (!st.busy && st.roll) { const pos = await p.evaluate(() => { const v = window.tidepop.view(); const d = v.diceRect(); const r = v.canvas.getBoundingClientRect(); return [r.left + d.x + d.s / 2, r.top + d.y + d.s / 2]; }); await p.mouse.click(pos[0], pos[1]); return 'r'; }
  if (!st.busy && st.move) { const pos = await p.evaluate(() => { const v = window.tidepop.view(); const g = v.game; if (!v.sim.canMove()) return null; const t = g.legal()[0]; const it = v.tokenLayout().find((k) => k.pl === g.turn && k.t === t); const rc = v.canvas.getBoundingClientRect(); return [rc.left + it.x, rc.top + it.y - it.R * 0.9]; }); if (pos) await p.mouse.click(pos[0], pos[1]); return 'm'; }
  return '-';
};
const acts = ps.map(() => ({}));
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  for (const [i, p] of ps.entries()) { const a = await step(p); acts[i][a] = (acts[i][a] || 0) + 1; }
  await sleep(150);
}
await sleep(4000);
console.log('acts', JSON.stringify(acts));
const states = [];
for (const p of ps) states.push(await p.evaluate(() => { const v = window.tidepop.view(); return JSON.stringify(v.game.tokens) + ' t' + v.game.turn + ' n' + v.sim.moves.length; }));
states.forEach((s, i) => console.log('p' + i, s));
console.log('in sync:', states.every((s) => s === states[0]));
// one player (g2) closes the app: does the table stall?
const toasts = []; host.on('console', () => {}); setInterval(async () => { try { const t = await host.$$eval('.toast', (xs) => xs.map((x) => x.textContent)); t.forEach((x) => { if (!toasts.includes(x)) toasts.push(x); }); } catch {} }, 1000);
const leaverSeat = await ps[2].evaluate(() => window.tidepop.view().sim.mySide);
await browsers[2].close();
const t1 = Date.now(); let stalledAt = null;
while (Date.now() - t1 < 130000) {
  for (const [i, p] of ps.entries()) if (i !== 2) await step(p);
  const turn = await host.evaluate(() => window.tidepop.view().game.turn);
  if (turn === leaverSeat) { stalledAt = turn; }
  await sleep(200);
}
const after = await host.evaluate(() => { const v = window.tidepop.view(); return { turn: v.game.turn, n: v.sim.moves.length }; });
console.log('leaver seat', leaverSeat, 'after 60s', JSON.stringify(after), 'hud:', (await host.textContent('#ar-hud')).replace(/\s+/g, ' '));
await host.screenshot({ path: SH + 'stall.png' });
console.log('toasts', JSON.stringify(toasts)); console.log('errors', errors);
for (const b of browsers) { try { await b.close(); } catch {} }
process.exit(0);
