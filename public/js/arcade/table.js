// Physical-table rendering shared by Chess and Ludo: procedural wood,
// lamp lighting, soft shadows and a real 3D die.

const texCache = new Map();

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wood grain texture as a canvas. kind: 'table' | 'walnut' | 'maple' | 'frame' */
export function woodTexture(kind = 'table', w = 512, h = 512) {
  const key = `${kind}${w}x${h}`;
  if (texCache.has(key)) return texCache.get(key);
  const P = {
    table: { base: '#6b3f22', dark: '#3e2210', light: '#8a5634', lines: 90 },
    walnut: { base: '#7a4b2a', dark: '#4a2a14', light: '#94603a', lines: 60 },
    maple: { base: '#e8c99a', dark: '#c99f68', light: '#f6e0b8', lines: 50 },
    frame: { base: '#4a2814', dark: '#2a160a', light: '#6b3c1e', lines: 70 },
  }[kind];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry(kind.length * 977 + w);
  ctx.fillStyle = P.base;
  ctx.fillRect(0, 0, w, h);
  // long grain lines with gentle waves and knots
  for (let i = 0; i < P.lines; i++) {
    const y0 = rnd() * h;
    const amp = 2 + rnd() * 6;
    const freq = 0.004 + rnd() * 0.01;
    const phase = rnd() * 6;
    ctx.strokeStyle = rnd() < 0.5 ? P.dark : P.light;
    ctx.globalAlpha = 0.06 + rnd() * 0.16;
    ctx.lineWidth = 0.6 + rnd() * 2.4;
    ctx.beginPath();
    for (let x = -10; x <= w + 10; x += 6) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
      if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // fine pores
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < w * h / 60; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
  }
  ctx.globalAlpha = 1;
  texCache.set(key, c);
  return c;
}

/** CSS background for a whole screen: wooden table under a warm lamp. */
export function tableBackgroundCSS() {
  const t = woodTexture('table', 512, 512).toDataURL('image/jpeg', 0.85);
  return `radial-gradient(ellipse at 50% 35%, rgba(255,214,150,0.22), rgba(0,0,0,0) 55%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%), url(${t})`;
}

/** Soft contact shadow (an ellipse) – everything on a real table casts one. */
export function softShadow(ctx, x, y, rx, ry, alpha = 0.35) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- 3D die
// Faces: +z = 1, -z = 6, +x = 2, -x = 5, +y = 3, -y = 4 (opposites sum to 7).
const FACES = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], val: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], val: 6 },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], val: 2 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], val: 5 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], val: 3 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], val: 4 },
];
const PIPS = {
  1: [[0, 0]], 2: [[-0.5, -0.5], [0.5, 0.5]], 3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], 5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0], [0.5, 0], [-0.5, 0.55], [0.5, 0.55]],
};

const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const apply = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];

// rotation that brings face `value` to face the viewer (+z)
const SHOW = {
  1: rotX(0), 6: rotY(Math.PI), 2: rotY(-Math.PI / 2), 5: rotY(Math.PI / 2), 3: rotX(Math.PI / 2), 4: rotX(-Math.PI / 2),
};
// look slightly from above-right while it tumbles; `k` 0 = perfectly face-on
const tiltOf = (k) => mul(rotX(-0.42 * k), rotY(0.38 * k));

/**
 * Draw a die. `spin` 0..1 = how much leftover tumble (1 = mid-throw).
 * `yaw` turns it while it tumbles; at rest (spin 0) the die is always drawn
 * straight and face-on so the number is easy to read.
 */
export function drawDie(ctx, cx, cy, size, value, spin = 0, yaw = 0, color = '#fbfbf7', pipColor = '#1d1b22') {
  const tumble = mul(rotX(spin * 7.3), mul(rotY(spin * 5.1), rotZ(spin * 3.7)));
  // In the air it's a tilted 3D cube; as it settles it turns square-on to
  // the viewer, so the resting die reads as a flat, upright face.
  const k = Math.min(1, spin * 2.5);
  const M = mul(tiltOf(k), mul(rotZ(yaw * k), mul(tumble, SHOW[value] || SHOW[1])));
  const h = size / 2;
  const light = norm([-0.2, -0.35, 0.92]); // lamp over the player's shoulder
  const proj = (p) => {
    const z = p[2] * h;
    const f = 1 + z / (size * 6); // gentle perspective
    return [cx + p[0] * h * f, cy + p[1] * h * f];
  };
  // shadow on the table
  softShadow(ctx, cx + size * 0.12, cy + size * 0.45, size * 0.75, size * 0.32, 0.45);
  const faces = FACES.map((F) => ({ F, n: apply(M, F.n), u: apply(M, F.u), v: apply(M, F.v) }))
    .filter((f) => f.n[2] > 0.01)
    .sort((a, b) => a.n[2] - b.n[2]);
  // solid body first, so the rounded faces meet at darker 'edges'
  for (const f of faces) {
    const c = f.n;
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => proj([c[0] + f.u[0] * su + f.v[0] * sv, c[1] + f.u[1] * su + f.v[1] * sv, c[2] + f.u[2] * su + f.v[2] * sv]));
    ctx.fillStyle = tint(color, 0.68);
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  for (const f of faces) {
    const c = f.n;
    const corner = (su, sv) => proj([c[0] + f.u[0] * su + f.v[0] * sv, c[1] + f.u[1] * su + f.v[1] * sv, c[2] + f.u[2] * su + f.v[2] * sv]);
    // rounded-ish face: draw an octagon slightly inset
    const r = 0.86, k = 0.62;
    const pts = [corner(-k, -r), corner(k, -r), corner(r, -k), corner(r, k), corner(k, r), corner(-k, r), corner(-r, k), corner(-r, -k)];
    const lit = Math.max(0, dot(f.n, light));
    const shade = 0.7 + lit * 0.32;
    ctx.fillStyle = tint(color, shade);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.stroke();
    // pips
    for (const [pu, pv] of PIPS[f.F.val]) {
      ctx.beginPath();
      for (let a = 0; a < 12; a++) {
        const th = (a / 12) * Math.PI * 2;
        const [x, y] = corner(pu + Math.cos(th) * 0.17, pv + Math.sin(th) * 0.17);
        if (a) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = f.F.val === 1 && pipColor === '#1d1b22' ? '#c62828' : pipColor;
      ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, f.n[2] * 1.6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  // specular highlight on the most lit face
  const top = faces[faces.length - 1];
  if (top) {
    const [hx, hy] = proj([top.n[0] - top.u[0] * 0.4 - top.v[0] * 0.4, top.n[1] - top.u[1] * 0.4 - top.v[1] * 0.4, top.n[2]]);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, size * 0.35);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A throw: the die flies from (x0,y0) to (x1,y1), bouncing twice and
 * slowing its tumble, landing on `value`. Returns { x, y, spin, z } for t.
 */
export function throwPose(t, x0, y0, x1, y1) {
  const e = 1 - Math.pow(1 - Math.min(1, t), 2.2);
  const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
  // two bounces of decreasing height
  const b = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) * 1 : t < 0.78 ? Math.sin(((t - 0.45) / 0.33) * Math.PI) * 0.4 : t < 0.95 ? Math.sin(((t - 0.78) / 0.17) * Math.PI) * 0.12 : 0;
  return { x, y, z: b, spin: Math.max(0, 1 - t) ** 1.6 };
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(...a); return a.map((x) => x / l); }
function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k)), g = Math.min(255, Math.round(((n >> 8) & 255) * k)), b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}
