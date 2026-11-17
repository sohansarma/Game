// Staunton-style chess pieces drawn as vectors (no fonts, no images), so
// they look the same on every phone. Drawn in a 100x100 box and cached.

const cache = new Map();

function base(ctx) {
  ctx.beginPath();
  ctx.moveTo(22, 90); ctx.lineTo(78, 90);
  ctx.quadraticCurveTo(82, 90, 81, 86); ctx.lineTo(79, 81);
  ctx.quadraticCurveTo(78, 78, 74, 78); ctx.lineTo(26, 78);
  ctx.quadraticCurveTo(22, 78, 21, 81); ctx.lineTo(19, 86);
  ctx.quadraticCurveTo(18, 90, 22, 90);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(28, 78); ctx.lineTo(72, 78); ctx.lineTo(70, 72); ctx.lineTo(30, 72); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function body(ctx, topY, topHalf, botHalf = 19) {
  ctx.beginPath();
  ctx.moveTo(50 - botHalf, 72);
  ctx.quadraticCurveTo(50 - botHalf + 4, (72 + topY) / 2 + 4, 50 - topHalf, topY);
  ctx.lineTo(50 + topHalf, topY);
  ctx.quadraticCurveTo(50 + botHalf - 4, (72 + topY) / 2 + 4, 50 + botHalf, 72);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function collar(ctx, y, rx) {
  ctx.beginPath();
  ctx.ellipse(50, y, rx, 4.2, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

const SHAPES = {
  p(ctx) {
    base(ctx);
    body(ctx, 52, 7, 17);
    collar(ctx, 51, 13);
    ctx.beginPath(); ctx.arc(50, 37, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },
  r(ctx) {
    base(ctx);
    ctx.beginPath();
    ctx.moveTo(32, 72); ctx.lineTo(35, 42); ctx.lineTo(65, 42); ctx.lineTo(68, 72); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(30, 37, 40, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(28, 37); ctx.lineTo(28, 18); ctx.lineTo(37, 18); ctx.lineTo(37, 25); ctx.lineTo(45, 25); ctx.lineTo(45, 18);
    ctx.lineTo(55, 18); ctx.lineTo(55, 25); ctx.lineTo(63, 25); ctx.lineTo(63, 18); ctx.lineTo(72, 18); ctx.lineTo(72, 37);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  },
  n(ctx, dark) {
    base(ctx);
    ctx.beginPath();
    ctx.moveTo(30, 72);
    ctx.quadraticCurveTo(30, 60, 40, 52);
    ctx.quadraticCurveTo(44, 48, 38, 47);
    ctx.lineTo(27, 50);
    ctx.quadraticCurveTo(19, 50, 18, 43);
    ctx.quadraticCurveTo(17, 38, 22, 34);
    ctx.lineTo(34, 22);
    ctx.lineTo(37, 11);
    ctx.lineTo(44, 18);
    ctx.quadraticCurveTo(62, 16, 70, 32);
    ctx.quadraticCurveTo(76, 46, 72, 72);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // eye, nostril, mane
    ctx.save();
    ctx.fillStyle = dark ? '#e8e2d4' : '#2a2420';
    ctx.beginPath(); ctx.ellipse(36, 31, 2.6, 2, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(23, 42, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(232,226,212,0.55)' : 'rgba(42,36,32,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(52, 22); ctx.quadraticCurveTo(66, 34, 66, 64);
    ctx.stroke();
    ctx.restore();
  },
  b(ctx, dark) {
    base(ctx);
    body(ctx, 50, 6, 17);
    collar(ctx, 49, 12);
    ctx.beginPath();
    ctx.moveTo(50, 15);
    ctx.bezierCurveTo(31, 29, 34, 44, 41, 46);
    ctx.lineTo(59, 46);
    ctx.bezierCurveTo(66, 44, 69, 29, 50, 15);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(50, 11, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.strokeStyle = dark ? '#e8e2d4' : '#2a2420';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(56, 24); ctx.lineTo(47, 35); ctx.stroke();
    ctx.restore();
  },
  q(ctx) {
    base(ctx);
    body(ctx, 46, 9, 19);
    collar(ctx, 45, 15);
    ctx.beginPath();
    ctx.moveTo(35, 42); ctx.lineTo(23, 20); ctx.lineTo(38, 31); ctx.lineTo(42, 15); ctx.lineTo(50, 30);
    ctx.lineTo(58, 15); ctx.lineTo(62, 31); ctx.lineTo(77, 20); ctx.lineTo(65, 42);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    for (const [x, y] of [[23, 18], [42, 13], [58, 13], [77, 18], [50, 27]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  },
  k(ctx) {
    base(ctx);
    body(ctx, 46, 9, 19);
    collar(ctx, 45, 15);
    ctx.beginPath();
    ctx.moveTo(36, 42);
    ctx.bezierCurveTo(27, 27, 42, 21, 50, 30);
    ctx.bezierCurveTo(58, 21, 73, 27, 64, 42);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(46.5, 6, 7, 22); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(40, 11, 20, 7); ctx.fill(); ctx.stroke();
  },
};

/** Returns a cached canvas of the piece at `size` px. type: 'pnbrqk', white: bool */
export function pieceSprite(type, white, size) {
  const k = `${type}${white ? 'w' : 'b'}${size}`;
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.scale(size / 100, size / 100);
  // soft shadow
  ctx.save();
  ctx.translate(2, 3);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.6;
  SHAPES[type](ctx, true);
  ctx.restore();
  const g = ctx.createLinearGradient(25, 10, 75, 90);
  if (white) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#f1e9da'); g.addColorStop(1, '#d6c7ab'); }
  else { g.addColorStop(0, '#5b5660'); g.addColorStop(0.5, '#2e2b33'); g.addColorStop(1, '#141218'); }
  ctx.fillStyle = g;
  ctx.strokeStyle = white ? '#2a2420' : '#050407';
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  SHAPES[type](ctx, !white);
  if (cache.size > 200) cache.clear();
  cache.set(k, c);
  return c;
}

export function clearPieceCache() {
  cache.clear();
}
