// Procedurally drawn sea creatures. Each colour also has a unique silhouette
// so the game is playable without relying on colour (colour-blind friendly).

import { SPECIAL } from './engine.js';

export const PALETTE = [
  { name: 'Crab', base: '#ff5a5f', light: '#ff9a9c', dark: '#b8262c' },
  { name: 'Starfish', base: '#ffb627', light: '#ffd97a', dark: '#c27a00' },
  { name: 'Urchin', base: '#a259ff', light: '#cfa6ff', dark: '#6a24c2' },
  { name: 'Turtle', base: '#35c46a', light: '#8ae6a9', dark: '#17803d' },
  { name: 'Jelly', base: '#2fb8ff', light: '#94dcff', dark: '#0b6fae' },
  { name: 'Snail', base: '#ff6fb5', light: '#ffb0d6', dark: '#c02c78' },
];

const cache = new Map();

/** Returns an offscreen canvas with the sprite pre-rendered at `size` px. */
export function sprite(color, special, size) {
  const k = `${color}|${special}|${size}`;
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (special === SPECIAL.RAINBOW) drawPearl(ctx, size);
  else {
    drawCreature(ctx, color, size);
    if (special === SPECIAL.LINE_H || special === SPECIAL.LINE_V) drawWave(ctx, size, special === SPECIAL.LINE_H);
    if (special === SPECIAL.BOMB) drawBubble(ctx, size);
    if (special === SPECIAL.STAR) drawStarBadge(ctx, size);
  }
  if (cache.size > 400) cache.clear();
  cache.set(k, c);
  return c;
}

export function clearSpriteCache() {
  cache.clear();
}

function shapePath(ctx, kind, s) {
  const cx = s / 2, cy = s / 2, R = s * 0.4;
  ctx.beginPath();
  switch (kind) {
    case 0: { // crab: wide rounded body with claws
      ctx.ellipse(cx, cy + s * 0.04, R * 0.95, R * 0.75, 0, 0, Math.PI * 2);
      ctx.moveTo(cx - R * 0.95 + s * 0.02, cy - R * 0.35);
      ctx.arc(cx - R * 0.85, cy - R * 0.6, R * 0.32, 0, Math.PI * 2);
      ctx.moveTo(cx + R * 0.85 + R * 0.32, cy - R * 0.6);
      ctx.arc(cx + R * 0.85, cy - R * 0.6, R * 0.32, 0, Math.PI * 2);
      break;
    }
    case 1: { // starfish: 5-point star with round tips
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? R * 1.08 : R * 0.5;
        const x = cx + Math.cos(a) * r, y = cy + s * 0.03 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 2: { // urchin: spiky circle
      const n = 14;
      for (let i = 0; i < n * 2; i++) {
        const a = (i * Math.PI) / n;
        const r = i % 2 === 0 ? R * 1.05 : R * 0.82;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 3: { // turtle shell: hexagon
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 4: { // jellyfish: dome with wavy skirt
      ctx.moveTo(cx - R, cy + R * 0.2);
      ctx.arc(cx, cy + R * 0.2, R, Math.PI, 0);
      const w = (2 * R) / 4;
      for (let i = 0; i < 4; i++) {
        const x0 = cx + R - i * w;
        ctx.quadraticCurveTo(x0 - w / 2, cy + R * 0.75, x0 - w, cy + R * 0.2);
      }
      ctx.closePath();
      break;
    }
    case 5: { // snail: rounded square shell
      const r = R * 0.45, x = cx - R * 0.95, y = cy - R * 0.9, w = R * 1.9, h = R * 1.85;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      break;
    }
  }
}

function drawCreature(ctx, kind, s) {
  const p = PALETTE[kind];
  // drop shadow
  ctx.save();
  ctx.translate(0, s * 0.04);
  shapePath(ctx, kind, s);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();
  ctx.restore();

  shapePath(ctx, kind, s);
  const g = ctx.createRadialGradient(s * 0.38, s * 0.32, s * 0.05, s / 2, s / 2, s * 0.55);
  g.addColorStop(0, p.light);
  g.addColorStop(0.55, p.base);
  g.addColorStop(1, p.dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.strokeStyle = p.dark;
  ctx.stroke();

  // pattern details per creature
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  if (kind === 3) { // shell plates
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      ctx.moveTo(s / 2 + Math.cos(a) * s * 0.17, s / 2 + Math.sin(a) * s * 0.17);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4);
    }
    ctx.stroke();
  } else if (kind === 5) { // spiral
    ctx.beginPath();
    for (let t = 0; t < Math.PI * 4; t += 0.2) {
      const r = s * 0.025 * t;
      const x = s * 0.5 + Math.cos(t) * r, y = s * 0.5 + Math.sin(t) * r;
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // glossy highlight
  ctx.beginPath();
  ctx.ellipse(s * 0.38, s * 0.3, s * 0.12, s * 0.07, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();

  // cute face
  const ey = kind === 4 ? s * 0.44 : s * 0.48;
  const ex = s * 0.11;
  for (const dx of [-ex, ex]) {
    ctx.beginPath();
    ctx.arc(s / 2 + dx, ey, s * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s / 2 + dx + s * 0.01, ey + s * 0.01, s * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b2f';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(s / 2, ey + s * 0.08, s * 0.05, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = '#1b1b2f';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawWave(ctx, s, horizontal) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  for (const off of [-0.18, 0, 0.18]) {
    ctx.beginPath();
    for (let t = 0; t <= 1.001; t += 0.05) {
      const a = s * (0.08 + t * 0.84);
      const b = s * (0.5 + off) + Math.sin(t * Math.PI * 3) * s * 0.04;
      const [x, y] = horizontal ? [a, b] : [b, a];
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // arrows
  ctx.fillStyle = '#fff';
  const tri = (x, y, ang) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(s * 0.07, 0);
    ctx.lineTo(-s * 0.05, -s * 0.06);
    ctx.lineTo(-s * 0.05, s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  if (horizontal) { tri(s * 0.94, s * 0.5, 0); tri(s * 0.06, s * 0.5, Math.PI); }
  else { tri(s * 0.5, s * 0.94, Math.PI / 2); tri(s * 0.5, s * 0.06, -Math.PI / 2); }
}

/** Starfish special: a little orange starfish clinging to the creature. */
function drawStarBadge(ctx, s) {
  const cx = s * 0.72, cy = s * 0.28, R = s * 0.27, r = s * 0.11;
  ctx.save();
  // a dark halo so the wish star reads on every creature colour (even the yellow starfish)
  ctx.fillStyle = 'rgba(20, 10, 60, 0.55)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 1, cx, cy, R);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#ff8ad8'); g.addColorStop(1, '#b03ad8');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.025;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45, s * 0.012, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawBubble(ctx, s) {
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.7, 'rgba(180,240,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0.75)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.32, s * 0.28, s * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
}

function drawPearl(ctx, s) {
  const cx = s / 2, cy = s / 2;
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.03, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  const g = ctx.createRadialGradient(s * 0.35, s * 0.3, s * 0.03, cx, cy, s * 0.45);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#f3ecff');
  g.addColorStop(1, '#b9a7d9');
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // iridescent ring
  const cols = PALETTE.map((p) => p.base);
  for (let i = 0; i < cols.length; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.34, (i / cols.length) * Math.PI * 2, ((i + 1) / cols.length) * Math.PI * 2);
    ctx.strokeStyle = cols[i];
    ctx.lineWidth = s * 0.06;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(s * 0.38, s * 0.33, s * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

/** Small icon (for goal panels) – returns a data URL. */
export function iconURL(color, size = 64) {
  return sprite(color, SPECIAL.NONE, size).toDataURL();
}
