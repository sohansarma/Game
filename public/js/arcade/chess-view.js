// Chess board renderer + input. Works for the ranked ladder (sim =
// ChessLadder, you are White vs AI) and for 2-player modes (sim = a
// ChessMatch-like object with { game, mySide, move(uci), over }).
import { name, LEVELS } from './chess.js';
import { sfx, haptic } from '../audio.js';

const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export default class ChessView {
  constructor({ canvas, controls, sim, hooks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.sel = null;
    this.targets = [];
    this.display = null; // temporary board shown while the AI "thinks"
    this.lastMove = null;
    this.destroyed = false;
    this.flip = sim.mySide === 'b';
    this.resize();
    this.bind();
    this.renderControls();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  get game() {
    return this.sim.game;
  }
  get mySide() {
    return this.sim.mySide || 'w';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const size = Math.min(rect.width, rect.height - 36);
    this.cell = Math.floor(size / 8);
    this.ox = Math.floor((rect.width - this.cell * 8) / 2);
    this.oy = 30 + Math.floor((rect.height - 30 - this.cell * 8) / 2);
    this.W = rect.width;
  }

  toScreen(i) {
    let r = Math.floor(i / 8), c = i % 8;
    if (this.flip) { r = 7 - r; c = 7 - c; }
    return [this.ox + c * this.cell, this.oy + r * this.cell];
  }

  fromScreen(x, y) {
    let c = Math.floor((x - this.ox) / this.cell), r = Math.floor((y - this.oy) / this.cell);
    if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
    if (this.flip) { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }

  canAct() {
    if (this.sim.over || this.display) return false;
    if (this.sim.canMove) return this.sim.canMove();
    return this.game.turn === this.mySide;
  }

  bind() {
    const down = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.tap(this.fromScreen(e.clientX - r.left, e.clientY - r.top));
    };
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('resize', resize);
    };
  }

  tap(i) {
    if (i < 0 || !this.canAct()) return;
    const g = this.game;
    const p = g.board[i];
    const mine = p && (p === p.toUpperCase() ? 'w' : 'b') === g.turn;
    if (this.sel !== null && this.targets.includes(i)) {
      const promo = g.board[this.sel].toUpperCase() === 'P' && (Math.floor(i / 8) === 0 || Math.floor(i / 8) === 7) ? 'q' : '';
      this.submit(name(this.sel) + name(i) + promo);
      return;
    }
    if (mine) {
      this.sel = i;
      this.targets = g.moves().filter((m) => m.from === i).map((m) => m.to);
      sfx.tap();
    } else {
      this.sel = null;
      this.targets = [];
    }
  }

  submit(uci) {
    this.sel = null;
    this.targets = [];
    // show the human move straight away, then the AI reply after a beat
    const preview = this.game.clone();
    const human = preview.play(uci);
    if (!human) { sfx.bad(); return; }
    const res = this.sim.move(uci);
    if (!res.ok) { sfx.bad(); return; }
    human.captured ? sfx.boom() : sfx.place();
    haptic(10);
    if (res.ai) {
      this.display = { board: preview.board, last: [human.from, human.to] };
      setTimeout(() => {
        this.display = null;
        this.lastMove = [res.ai.from, res.ai.to];
        res.ai.captured ? sfx.boom() : sfx.place();
        if (this.game.inCheck()) { sfx.bad(); haptic(30); }
        this.after(res);
      }, 420);
    } else {
      this.lastMove = [human.from, human.to];
      this.after(res);
    }
  }

  /** For online matches: apply an opponent move that arrived from the network. */
  remoteMoved(mv) {
    this.lastMove = [mv.from, mv.to];
    mv.captured ? sfx.boom() : sfx.place();
    if (this.game.inCheck()) sfx.bad();
    this.renderControls();
    this.hooks.onChange?.(this.sim);
  }

  after(res) {
    if (res.end) {
      if (res.end.winner === 'w' || (res.end.winner && res.end.winner === this.mySide)) { sfx.win(); haptic(50); }
      else if (res.end.winner) sfx.lose();
      this.hooks.onRound?.(res.end, this.sim);
      this.lastMove = null;
    }
    this.renderControls();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over) setTimeout(() => this.hooks.onOver?.(this.sim), 900);
  }

  renderControls() {
    const s = this.sim;
    const hist = this.game.history.slice(-8).map((h, i, a) => {
      const ply = this.game.history.length - a.length + i;
      return `${ply % 2 === 0 ? `<b>${Math.floor(ply / 2) + 1}.</b>` : ''}${h.san}`;
    }).join(' ');
    this.controls.innerHTML = `<div class="col" style="width:100%;gap:6px">
      <div class="small muted center chess-moves">${hist || 'Tap a piece, then tap where it should go'}</div>
      <div class="row" style="justify-content:center;gap:8px">
        ${s.resign ? `<button class="btn sm ghost" data-a="resign" ${s.over ? 'disabled' : ''}>🏳️ Resign</button>` : ''}
      </div></div>`;
    const b = this.controls.querySelector('[data-a="resign"]');
    if (b) b.onclick = () => this.hooks.onQuit?.();
  }

  loop() {
    if (this.destroyed) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  draw() {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const board = this.display ? this.display.board : g.board;
    const last = this.display ? this.display.last : this.lastMove;
    // header: opponent / turn
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const header = this.sim.header ? this.sim.header() : `vs ${this.sim.opponent} (level ${this.sim.level})`;
    ctx.fillText(header, this.W / 2, 14);
    const checkSq = !this.display && g.inCheck() ? g.kingSq(g.turn) : -1;
    for (let i = 0; i < 64; i++) {
      const [x, y] = this.toScreen(i);
      const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
      ctx.fillStyle = light ? '#f0e2c3' : '#5d8aa8';
      ctx.fillRect(x, y, C, C);
      if (last && (i === last[0] || i === last[1])) { ctx.fillStyle = 'rgba(255,212,94,0.55)'; ctx.fillRect(x, y, C, C); }
      if (i === this.sel) { ctx.fillStyle = 'rgba(124,255,178,0.55)'; ctx.fillRect(x, y, C, C); }
      if (i === checkSq) { ctx.fillStyle = 'rgba(255,82,82,0.6)'; ctx.fillRect(x, y, C, C); }
      const p = board[i];
      if (p) {
        ctx.font = `${C * 0.82}px "Segoe UI Symbol", "DejaVu Sans", system-ui, sans-serif`;
        const white = p === p.toUpperCase();
        // draw the solid glyph for both colours so pieces read clearly
        const glyph = GLYPH[p.toLowerCase()];
        ctx.lineWidth = Math.max(2, C * 0.06);
        ctx.strokeStyle = white ? '#3b2a1a' : '#f6efe0';
        ctx.strokeText(glyph, x + C / 2, y + C * 0.56);
        ctx.fillStyle = white ? '#fffaf0' : '#1d1b26';
        ctx.fillText(glyph, x + C / 2, y + C * 0.56);
      }
      if (this.targets.includes(i)) {
        ctx.fillStyle = board[i] ? 'rgba(255,82,82,0.35)' : 'rgba(30,30,60,0.35)';
        ctx.beginPath();
        ctx.arc(x + C / 2, y + C / 2, board[i] ? C * 0.45 : C * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // coordinates
    ctx.font = `700 ${Math.max(9, C * 0.18)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let k = 0; k < 8; k++) {
      const file = this.flip ? 'hgfedcba'[k] : 'abcdefgh'[k];
      const rank = this.flip ? k + 1 : 8 - k;
      ctx.textAlign = 'left';
      ctx.fillText(file, this.ox + k * C + 3, this.oy + 8 * C - C * 0.12);
      ctx.fillText(String(rank), this.ox + 3, this.oy + k * C + C * 0.15);
    }
    if (this.display) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('thinking…', this.W / 2, this.oy + 8 * C + 14);
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Ladder', value: `🪜 ${sim.wins} win${sim.wins === 1 ? '' : 's'}` },
    { label: 'Opponent', value: `${sim.opponent}` },
  ];
}

export const HOW = `<div class="tip">♟️ You play <b>White</b> against sea bots. <b>Tap a piece</b>, then tap one of the highlighted squares. Pawns promote to a queen.</div>
<div class="tip">🪜 Every <b>win</b> moves you up the ladder: ${LEVELS.map((l) => l.name).join(' → ')}, then even tougher. A <b>draw</b> keeps your spot, a <b>loss</b> ends the run.</div>
<div class="tip">🏆 Win = 100 × level, plus bonuses for a quick win and extra material. Draw = 30 × level.</div>
<div class="tip">👥 Want a human opponent? Use <b>Play a friend</b> from the menu – on one device or online with a code.</div>`;
