// Chess table: wooden board, Staunton pieces, drag & drop or tap-tap,
// sliding moves, promotion picker, player bars with clocks and captured
// material, move list, takeback / hint / flip / draw / resign.
//
// Works with three controllers:
//   ChessLadder  (ranked)  – move() also returns the bot reply in `ai`
//   ChessCasual  (vs bot)  – move() then botMove(); clock, takeback, hint, draw
//   ChessVersus  (friends) – move(); pass & play (mySide null) or online
import { name, LEVELS } from './chess.js';
import { pieceSprite } from './chess-pieces.js';
import { sfx, haptic } from '../audio.js';

const LIGHT = '#f0d9b5', DARK = '#b58863';
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export default class ChessView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.sel = null;
    this.targets = [];
    this.drag = null;
    this.anim = null;
    this.promo = null;
    this.hint = null;
    this.thinking = false;
    this.shown = sim.game.board.slice();
    this.lastMove = null;
    const h = sim.game.history[sim.game.history.length - 1];
    if (h) this.lastMove = [sqIndex(h.uci.slice(0, 2)), sqIndex(h.uci.slice(2, 4))];
    this.flip = sim.mySide === 'b';
    this.destroyed = false;
    this.endSent = false;
    this.resize();
    this.bind();
    this.renderControls();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    // casual game where the bot moves first
    if (sim.botToMove?.()) this.scheduleBot(500);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.botTimer);
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  get game() {
    return this.sim.game;
  }
  get bottomSide() {
    return this.flip ? 'b' : 'w';
  }

  // ---------------- layout
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.W = rect.width;
    this.H = rect.height;
    this.barH = 44;
    const size = Math.floor(Math.min(rect.width - 4, rect.height - this.barH * 2 - 8) / 8) * 8;
    this.cell = size / 8;
    this.size = size;
    this.ox = Math.floor((rect.width - size) / 2);
    this.oy = Math.floor(this.barH + 4 + (rect.height - this.barH * 2 - 8 - size) / 2);
  }

  xy(i) {
    let r = Math.floor(i / 8), c = i % 8;
    if (this.flip) { r = 7 - r; c = 7 - c; }
    return [this.ox + c * this.cell, this.oy + r * this.cell];
  }

  squareAt(x, y) {
    let c = Math.floor((x - this.ox) / this.cell), r = Math.floor((y - this.oy) / this.cell);
    if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
    if (this.flip) { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }

  canAct() {
    return !this.anim && !this.promo && !this.thinking && !this.sim.over && this.sim.canMove();
  }

  // ---------------- input
  bind() {
    const cv = this.canvas;
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e) => {
      const [x, y] = local(e);
      if (this.promo) return this.pickPromotion(x, y);
      const i = this.squareAt(x, y);
      if (i < 0 || !this.canAct()) return;
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      const p = this.game.board[i];
      const mine = p && colorOf(p) === this.game.turn;
      if (this.sel !== null && this.targets.includes(i)) { this.tryMove(this.sel, i); return; }
      if (mine) {
        this.select(i);
        this.drag = { from: i, x, y, sx: x, sy: y, moved: false };
      } else this.clearSel();
    };
    const move = (e) => {
      if (!this.drag) return;
      const [x, y] = local(e);
      this.drag.x = x;
      this.drag.y = y;
      if (Math.hypot(x - this.drag.sx, y - this.drag.sy) > 6) this.drag.moved = true;
    };
    const up = (e) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (!d.moved) return; // a tap – selection already done
      const [x, y] = local(e);
      const to = this.squareAt(x, y);
      if (to >= 0 && to !== d.from && this.targets.includes(to)) this.tryMove(d.from, to, true);
    };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      if (e.key === 'f') this.toggleFlip();
    };
    const resize = () => this.resize();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => (this.drag = null));
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  select(i) {
    this.sel = i;
    this.targets = [...new Set(this.game.moves().filter((m) => m.from === i).map((m) => m.to))];
    sfx.tap();
  }
  clearSel() {
    this.sel = null;
    this.targets = [];
  }

  /** Public: play a move given squares (used by input and tests). */
  tryMove(from, to, dropped = false) {
    const p = this.game.board[from];
    const rank = Math.floor(to / 8);
    if (p && p.toLowerCase() === 'p' && (rank === 0 || rank === 7)) {
      this.promo = { from, to, color: colorOf(p) };
      this.clearSel();
      return;
    }
    this.submit(name(from) + name(to), dropped);
  }

  pickPromotion(x, y) {
    const { from, to, color } = this.promo;
    const [cx, cy0] = this.xy(to);
    const down = cy0 < this.oy + this.size / 2;
    for (let k = 0; k < 4; k++) {
      const cy = down ? cy0 + k * this.cell : cy0 - k * this.cell;
      if (x >= cx && x <= cx + this.cell && y >= cy && y <= cy + this.cell) {
        this.promo = null;
        this.submit(name(from) + name(to) + 'qnrb'[k]);
        return;
      }
    }
    this.promo = null; // tapped elsewhere: cancel
    void color;
  }

  submit(uci, dropped = false) {
    this.clearSel();
    this.hint = null;
    const before = this.game.board.slice();
    const preview = this.game.clone();
    const hm = preview.play(uci);
    if (!hm) { sfx.bad(); return; }
    const res = this.sim.move(uci);
    if (!res.ok) { sfx.bad(); return; }
    haptic(10);
    this.animate(before, hm, preview.board, dropped, () => {
      this.afterHalfMove(res, preview);
      if (res.ai) {
        this.thinking = true;
        setTimeout(() => {
          this.thinking = false;
          this.animate(preview.board, res.ai, res.end ? this.boardBeforeReset(preview, res.ai) : this.game.board.slice(), false, () => this.afterHalfMove(res, null, true));
        }, this.reduced ? 120 : 320);
      } else if (this.sim.botToMove?.()) {
        this.scheduleBot(this.reduced ? 120 : 350);
      }
    });
  }

  // when the ladder starts a new game, show the final position of the old one first
  boardBeforeReset(preview, ai) {
    const g = preview.clone();
    g.play(ai.uci || name(ai.from) + name(ai.to) + (ai.promo || ''));
    return g.board.slice();
  }

  scheduleBot(delay) {
    this.thinking = true;
    this.renderControls();
    clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => {
      if (this.destroyed) return;
      const before = this.game.board.slice();
      const res = this.sim.botMove();
      this.thinking = false;
      if (!res) { this.renderControls(); return; }
      this.animate(before, res.ai, this.game.board.slice(), false, () => this.afterHalfMove(res, null, true));
    }, delay);
  }

  /** Online: the opponent's move arrived. */
  remoteMoved(mv) {
    const before = this.shown.slice();
    this.animate(before, mv, this.game.board.slice(), false, () => this.afterHalfMove({ ok: true, end: this.sim.over ? this.sim.result : null }, null, true));
  }

  animate(fromBoard, mv, toBoard, instant, done) {
    const piece = fromBoard[mv.from];
    const captured = fromBoard[mv.to] || mv.captured;
    if (captured) sfx.chessCapture(); else sfx.chessMove();
    this.lastMove = [mv.from, mv.to];
    if (instant || this.reduced) {
      this.shown = toBoard;
      done();
      return;
    }
    this.anim = { piece, from: mv.from, to: mv.to, board: toBoard, t0: performance.now(), dur: 190, done };
  }

  afterHalfMove(res, preview, final) {
    const roundOver = res.end && (final || !res.ai);
    // a ladder round ended but the run continues: hold the final position, then reset
    if (roundOver && !this.sim.over) {
      const won = res.end.winner && res.end.winner === this.sim.mySide;
      won ? sfx.win() : res.end.winner ? sfx.lose() : sfx.coin();
      this.hooks.onRound?.(res.end, this.sim);
      this.thinking = true;
      this.renderControls();
      setTimeout(() => {
        if (this.destroyed) return;
        this.thinking = false;
        this.shown = this.game.board.slice();
        const h = this.game.history[this.game.history.length - 1];
        this.lastMove = h ? [sqIndex(h.uci.slice(0, 2)), sqIndex(h.uci.slice(2, 4))] : null;
        this.renderControls();
        this.hooks.onChange?.(this.sim);
      }, this.reduced ? 400 : 1800);
      return;
    }
    if (!preview || final) this.shown = this.game.board.slice();
    if (roundOver) {
      const mine = this.sim.mySide;
      if (res.end.winner && mine && res.end.winner !== mine) sfx.lose(); else sfx.win();
    } else if (this.game.inCheck()) { sfx.chessCheck(); haptic(30); }
    if (this.sim.autoFlip && this.sim.local && !this.sim.over) this.flip = this.game.turn === 'b';
    this.renderControls();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.endSent) { this.endSent = true; setTimeout(() => this.hooks.onOver?.(this.sim), 900); }
  }

  toggleFlip() {
    this.flip = !this.flip;
    sfx.tap();
  }

  // ---------------- controls
  renderControls() {
    const s = this.sim, g = this.game;
    const hist = g.history;
    let moves = '';
    for (let i = 0; i < hist.length; i += 2) moves += `<span class="mv"><b>${i / 2 + 1}.</b> ${hist[i].san}${hist[i + 1] ? ' ' + hist[i + 1].san : ''}</span>`;
    const btn = (a, label, enabled = true) => `<button class="btn sm ghost" data-a="${a}" ${enabled ? '' : 'disabled'}>${label}</button>`;
    const live = !s.over;
    this.controls.innerHTML = `<div class="col" style="gap:6px;width:100%">
      <div class="chess-moves" id="cv-moves">${moves || '<span class="muted">Tap or drag a piece to move</span>'}</div>
      <div class="row chess-btns">
        ${s.takeback ? btn('undo', '↶ Undo', live && s.canTakeback()) : ''}
        ${s.hint ? btn('hint', '💡 Hint', live && s.canMove() && !this.thinking) : ''}
        ${btn('flip', '🔄 Flip')}
        ${s.offerDraw || s.local ? btn('draw', '½ Draw', live) : ''}
        ${s.resign ? btn('resign', '🏳️ Resign', live) : ''}
      </div></div>`;
    const mv = this.controls.querySelector('#cv-moves');
    if (mv) mv.scrollLeft = mv.scrollWidth;
    for (const b of this.controls.querySelectorAll('[data-a]')) {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'flip') this.toggleFlip();
        else if (a === 'undo') { if (s.takeback()) { this.shown = this.game.board.slice(); this.lastMove = null; this.hint = null; sfx.swap(); this.renderControls(); this.hooks.onChange?.(s); } }
        else if (a === 'hint') { const h = s.hint(); if (h) { this.hint = [sqIndex(h.slice(0, 2)), sqIndex(h.slice(2, 4))]; sfx.special(); } }
        else if (a === 'draw') this.hooks.onDraw?.();
        else if (a === 'resign') this.hooks.onQuit?.();
      };
    }
  }

  // ---------------- drawing
  loop(now) {
    if (this.destroyed) return;
    const flag = this.sim.tick?.();
    if (flag) { sfx.lose(); this.renderControls(); if (!this.endSent) { this.endSent = true; setTimeout(() => this.hooks.onOver?.(this.sim), 600); } }
    if (this.anim && now - this.anim.t0 >= this.anim.dur) {
      const a = this.anim;
      this.anim = null;
      this.shown = a.board;
      a.done();
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const board = this.anim ? this.anim.board : this.shown;
    // frame
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(this.ox - 4, this.oy - 4, this.size + 8, this.size + 8);
    const checkSq = !this.anim && g.inCheck() && !this.sim.over ? g.kingSq(g.turn) : -1;
    for (let i = 0; i < 64; i++) {
      const [x, y] = this.xy(i);
      const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
      ctx.fillStyle = light ? LIGHT : DARK;
      ctx.fillRect(x, y, C, C);
      if (this.lastMove && this.lastMove.includes(i)) { ctx.fillStyle = 'rgba(205,210,60,0.55)'; ctx.fillRect(x, y, C, C); }
      if (i === this.sel) { ctx.fillStyle = 'rgba(20,85,30,0.45)'; ctx.fillRect(x, y, C, C); }
      if (i === checkSq) {
        const gr = ctx.createRadialGradient(x + C / 2, y + C / 2, C * 0.1, x + C / 2, y + C / 2, C * 0.7);
        gr.addColorStop(0, 'rgba(255,0,0,0.95)');
        gr.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x, y, C, C);
      }
    }
    // coordinates inside the edge squares, like a real board
    ctx.font = `700 ${Math.max(9, C * 0.2)}px system-ui, sans-serif`;
    for (let k = 0; k < 8; k++) {
      const fileSq = this.flip ? 7 - k : k;
      const rankNum = this.flip ? k + 1 : 8 - k;
      ctx.fillStyle = k % 2 === (this.flip ? 0 : 1) ? LIGHT : DARK;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = (7 + k) % 2 === 0 ? DARK : LIGHT;
      ctx.fillText('abcdefgh'[fileSq], this.ox + (k + 1) * C - 2, this.oy + this.size - 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = k % 2 === 0 ? DARK : LIGHT;
      ctx.fillText(String(rankNum), this.ox + 2, this.oy + k * C + 2);
    }
    // pieces
    const S = Math.round(C * this.dpr);
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      if (this.anim && i === this.anim.to) continue;
      if (this.drag && this.drag.moved && i === this.drag.from) continue;
      const [x, y] = this.xy(i);
      ctx.drawImage(pieceSprite(p.toLowerCase(), p === p.toUpperCase(), S), x, y, C, C);
    }
    // legal-move markers
    for (const t of this.targets) {
      const [x, y] = this.xy(t);
      ctx.fillStyle = 'rgba(20,85,30,0.5)';
      if (board[t]) {
        ctx.beginPath();
        ctx.arc(x + C / 2, y + C / 2, C * 0.47, 0, Math.PI * 2);
        ctx.arc(x + C / 2, y + C / 2, C * 0.38, 0, Math.PI * 2, true);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x + C / 2, y + C / 2, C * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // hint arrow
    if (this.hint) this.arrow(this.hint[0], this.hint[1], 'rgba(255,170,0,0.8)');
    // animating piece
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.dur);
      const k = 1 - Math.pow(1 - t, 3);
      const [x0, y0] = this.xy(a.from), [x1, y1] = this.xy(a.to);
      const p = a.board[a.to] || a.piece;
      ctx.drawImage(pieceSprite(p.toLowerCase(), p === p.toUpperCase(), S), x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, C, C);
    }
    // dragged piece follows the finger, a little bigger
    if (this.drag && this.drag.moved) {
      const p = board[this.drag.from];
      if (p) {
        const big = C * 1.3;
        const sq = this.squareAt(this.drag.x, this.drag.y);
        if (sq >= 0) { const [hx, hy] = this.xy(sq); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.strokeRect(hx + 1.5, hy + 1.5, C - 3, C - 3); }
        ctx.drawImage(pieceSprite(p.toLowerCase(), p === p.toUpperCase(), Math.round(big * this.dpr)), this.drag.x - big / 2, this.drag.y - big * 0.75, big, big);
      }
    }
    // promotion picker
    if (this.promo) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(this.ox, this.oy, this.size, this.size);
      const [cx, cy0] = this.xy(this.promo.to);
      const down = cy0 < this.oy + this.size / 2;
      'qnrb'.split('').forEach((t, k) => {
        const cy = down ? cy0 + k * C : cy0 - k * C;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(cx + C / 2, cy + C / 2, C * 0.48, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(pieceSprite(t, this.promo.color === 'w', S), cx, cy, C, C);
      });
    }
    this.drawBars(now);
    if (this.thinking) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const topY = this.oy - this.barH / 2 - 2;
      ctx.fillText(`thinking${'.'.repeat(1 + Math.floor(now / 300) % 3)}`, this.W / 2, topY);
    }
  }

  arrow(from, to, color) {
    const ctx = this.ctx, C = this.cell;
    const [x0, y0] = this.xy(from), [x1, y1] = this.xy(to);
    const ax = x0 + C / 2, ay = y0 + C / 2, bx = x1 + C / 2, by = y1 + C / 2;
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = C * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - Math.cos(ang) * C * 0.3, by - Math.sin(ang) * C * 0.3); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(ang - 0.5) * C * 0.45, by - Math.sin(ang - 0.5) * C * 0.45);
    ctx.lineTo(bx - Math.cos(ang + 0.5) * C * 0.45, by - Math.sin(ang + 0.5) * C * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  /** Player bars: name, captured pieces, material edge, clock. */
  drawBars(now) {
    const g = this.game;
    const counts = { w: {}, b: {} };
    for (const p of g.board) if (p) { const s = colorOf(p); counts[s][p.toLowerCase()] = (counts[s][p.toLowerCase()] || 0) + 1; }
    const capturedBy = (side) => { // pieces of the other colour that are gone
      const other = side === 'w' ? 'b' : 'w';
      const out = [];
      for (const t of 'qrbnp') for (let k = 0; k < Math.max(0, START_COUNT[t] - (counts[other][t] || 0)); k++) out.push(t);
      return out;
    };
    const material = (side) => Object.entries(counts[side]).reduce((s, [t, n]) => s + (VAL[t] || 0) * n, 0);
    const diff = material('w') - material('b');
    for (const [side, top] of [[this.bottomSide === 'w' ? 'b' : 'w', true], [this.bottomSide, false]]) {
      const y = top ? this.oy - this.barH - 4 : this.oy + this.size + 4;
      this.drawBar(side, y, capturedBy(side), side === 'w' ? diff : -diff, now);
    }
  }

  drawBar(side, y, captured, edge, now) {
    const ctx = this.ctx;
    const x = this.ox, w = this.size, h = this.barH;
    const toMove = this.game.turn === side && !this.sim.over;
    ctx.fillStyle = toMove ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    const names = this.sim.names || { [this.sim.mySide || 'w']: 'You', [this.sim.mySide === 'b' ? 'w' : 'b']: this.sim.opponent ? `${this.sim.opponent}` : 'Bot' };
    // avatar disc in the piece colour
    ctx.fillStyle = side === 'w' ? '#f5efe2' : '#26232b';
    ctx.strokeStyle = toMove ? '#ffd45e' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x + h / 2, y + h / 2, h * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 13px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const nm = names[side] || (side === 'w' ? 'White' : 'Black');
    ctx.fillText(nm.length > 22 ? nm.slice(0, 21) + '…' : nm, x + h, y + 5);
    // captured pieces + material edge
    const S = Math.round(16 * this.dpr);
    let cx = x + h;
    for (const t of captured) {
      ctx.drawImage(pieceSprite(t, side !== 'w', S), cx, y + 22, 16, 16);
      cx += 10;
    }
    if (edge > 0) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`+${edge}`, cx + 8, y + 26);
    }
    // clock
    const clock = this.sim.clock;
    if (clock) {
      const ms = clock.get(side);
      const low = ms < 20000;
      const cw = 74;
      ctx.fillStyle = clock.running === side ? (low ? '#ff5252' : '#fff') : 'rgba(0,0,0,0.35)';
      roundRect(ctx, x + w - cw - 6, y + 6, cw, h - 12, 8);
      ctx.fill();
      ctx.fillStyle = clock.running === side ? (low ? '#fff' : '#111') : '#fff';
      ctx.font = '800 17px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtClock(ms), x + w - cw / 2 - 6, y + h / 2 + 1);
    } else if (toMove) {
      ctx.fillStyle = '#ffd45e';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.game.inCheck() ? 'CHECK!' : 'to move', x + w - 10, y + h / 2);
    }
    void now;
  }
}

const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
const sqIndex = (s) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0]);

function fmtClock(ms) {
  const t = Math.ceil(ms / 1000);
  if (ms < 10000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Ladder', value: `🪜 ${sim.wins} win${sim.wins === 1 ? '' : 's'}` },
    { label: 'Opponent', value: `${sim.opponent}` },
  ];
}

export const HOW = `<div class="tip">♟️ <b>Drag</b> a piece, or <b>tap</b> it and tap a highlighted square. Dots show legal moves, rings show captures. When a pawn reaches the last rank you choose its promotion.</div>
<div class="tip">🪜 <b>Ladder (ranked):</b> pick your colour and beat sea bots that get stronger every win: ${LEVELS.map((l) => l.name).join(' → ')}. A draw keeps your spot, a loss ends the run.</div>
<div class="tip">🤖 <b>Vs computer:</b> six levels from Beginner to Master, optional chess clocks, takebacks and hints. 👥 <b>Friends:</b> pass & play (with clocks) or online with a code.</div>
<div class="tip">📜 Full rules: castling, en passant, promotion, check, checkmate, stalemate, threefold repetition, 50-move rule and insufficient material.</div>`;
