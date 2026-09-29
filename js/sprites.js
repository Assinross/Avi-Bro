// Процедурная отрисовка спрайтов (заранее в отдельные canvas). Никаких внешних картинок.
(function (AB) {
  const S = AB.Sprites = {};
  const TAU = Math.PI * 2;

  function circle(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function ell(ctx, x, y, rx, ry, col, rot) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill(); }
  S.circle = circle; S.ell = ell;

  // Кластер листвы с обводкой, светотенью и «пиксельной» фактурой
  function leafCluster(ctx, rng, cx, cy, R, pal, n) {
    const blobs = [];
    n = n || 8;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * R * 0.52;
      blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, R * (0.42 + rng() * 0.2)]);
    }
    blobs.push([cx, cy, R * 0.62]);
    blobs.forEach(b => circle(ctx, b[0], b[1], b[2] + 2.5, pal.outline));
    blobs.forEach(b => circle(ctx, b[0], b[1], b[2], pal.dark));
    blobs.forEach(b => circle(ctx, b[0] - b[2] * 0.12, b[1] - b[2] * 0.16, b[2] * 0.8, pal.mid));
    blobs.forEach(b => circle(ctx, b[0] - b[2] * 0.3, b[1] - b[2] * 0.36, b[2] * 0.42, pal.light));
    // фактура листьев
    ctx.save();
    ctx.beginPath(); blobs.forEach(b => { ctx.moveTo(b[0] + b[2], b[1]); ctx.arc(b[0], b[1], b[2], 0, TAU); }); ctx.clip();
    for (let i = 0; i < R * R * 0.09; i++) {
      const x = cx + (rng() - 0.5) * R * 2.2, y = cy + (rng() - 0.5) * R * 2.2;
      const up = (cy - y) / R + (cx - x) / R * 0.5;
      ctx.fillStyle = rng() < 0.5 + up * 0.3 ? pal.light : pal.dark;
      ctx.globalAlpha = 0.5 + rng() * 0.4;
      const s = 2 + (rng() < 0.3 ? 1 : 0);
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
    ctx.globalAlpha = 1;
    // тень снизу
    const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, 'rgba(255,255,200,0.08)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,10,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
    ctx.restore();
  }

  const TREE_PALS = [
    { outline: '#10200f', dark: '#23452a', mid: '#356b32', light: '#5a9446' },
    { outline: '#0f1f12', dark: '#1f3f2c', mid: '#2e5e3a', light: '#4f8a52' },
    { outline: '#1a1f0c', dark: '#3d4f1f', mid: '#5f7a2b', light: '#8fae45' },
  ];
  const PINE_PALS = [
    { outline: '#0b1a12', dark: '#173828', mid: '#22523a', light: '#3b7a55' },
    { outline: '#0c1814', dark: '#15332e', mid: '#1f4b42', light: '#346f5e' },
    { outline: '#0e1a0e', dark: '#1d3a1d', mid: '#2b5a2b', light: '#4a8248' },
  ];

  function trunk(ctx, x, yb, w, h) {
    ctx.fillStyle = '#1e140c'; ctx.fillRect(x - w / 2 - 2, yb - h, w + 4, h + 2);
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, '#6b4a2e'); g.addColorStop(0.5, '#533823'); g.addColorStop(1, '#3a2616');
    ctx.fillStyle = g; ctx.fillRect(x - w / 2, yb - h, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - w / 2 + 2 + i * (w / 4), yb - h + 3 + (i % 2) * 5, 1, h - 8);
    // корни
    ctx.fillStyle = '#3a2616';
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 5, yb + 1); ctx.lineTo(x - w / 2, yb - 7); ctx.lineTo(x - 2, yb + 1); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w / 2 + 5, yb + 1); ctx.lineTo(x + w / 2, yb - 7); ctx.lineTo(x + 2, yb + 1); ctx.fill();
  }

  // Деревья биомов: 6–7 заснеженные ели, 8–9 болотные ивы, 10 степная акация, 11 сухое дерево
  function makeBiomeTree(v) {
    const W = 120, H = 150, c = AB.canvas(W, H), ctx = c.getContext('2d');
    const rng = AB.rng(3000 + v * 131);
    const bx = W / 2, by = H - 10;
    if (v === 6 || v === 7) {
      const pal = v === 6 ? { outline: '#0b1a16', dark: '#1a3a34', mid: '#285a4c', light: '#3f7a66' } : { outline: '#0c1614', dark: '#16322e', mid: '#224a44', light: '#3a6e62' };
      trunk(ctx, bx, by, 9, 24);
      const tiers = 5;
      for (let t = 0; t < tiers; t++) {
        const k = t / (tiers - 1), w = AB.lerp(46, 13, k), yb2 = by - 14 - t * 21, h = 40;
        const pts = []; for (let i = 0; i <= 7; i++) { const f = i / 7; pts.push([bx - w + f * w * 2, yb2 + (i % 2 ? -3 : 3) + Math.sin(f * Math.PI) * 5]); }
        const draw = (grow, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(bx, yb2 - h - grow); pts.forEach(p => ctx.lineTo(p[0] + (p[0] < bx ? -grow : grow), p[1] + grow)); ctx.closePath(); ctx.fill(); };
        draw(2.5, pal.outline); draw(0, pal.dark);
        ctx.save(); ctx.beginPath(); ctx.moveTo(bx, yb2 - h); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
        ctx.fillStyle = pal.mid; ctx.beginPath(); ctx.moveTo(bx, yb2 - h); ctx.lineTo(bx - w, yb2); ctx.lineTo(bx + w * 0.25, yb2 - 4); ctx.fill();
        // снег на лапах: белые шапки по верхнему краю яруса
        ctx.fillStyle = '#f4f8fc';
        ctx.beginPath(); ctx.moveTo(bx, yb2 - h - 1); ctx.lineTo(bx - w * 0.85, yb2 - 6); ctx.quadraticCurveTo(bx - w * 0.45, yb2 - 16, bx - w * 0.1, yb2 - 12); ctx.quadraticCurveTo(bx + w * 0.3, yb2 - 18, bx + w * 0.8, yb2 - 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c8daea'; ctx.beginPath(); ctx.moveTo(bx + w * 0.8, yb2 - 7); ctx.quadraticCurveTo(bx + w * 0.3, yb2 - 18, bx, yb2 - h - 1); ctx.lineTo(bx + w * 0.2, yb2 - h * 0.4); ctx.fill();
        for (let i = 0; i < 30; i++) { ctx.fillStyle = rng() < 0.5 ? '#ffffff' : pal.light; ctx.globalAlpha = 0.6; ctx.fillRect(Math.round(bx + (rng() - 0.5) * w * 2), Math.round(yb2 - rng() * h), 2, 2); }
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(bx - w - 4, yb2 - 6, w * 2 + 8, 10);
        ctx.restore();
      }
      // сугроб у корней
      ell(ctx, bx, by + 1, 26, 7, '#b8cadc'); ell(ctx, bx - 3, by - 1, 22, 5.5, '#f0f6fc');
    } else if (v === 8 || v === 9) {
      trunk(ctx, bx, by, 13, 40);
      const pal = v === 8 ? { outline: '#0e160c', dark: '#26341c', mid: '#3a4e26', light: '#5a6e36' } : { outline: '#101810', dark: '#223020', mid: '#34482c', light: '#526a40' };
      leafCluster(ctx, rng, bx, by - 70, 42, pal, 9);
      leafCluster(ctx, rng, bx - 22, by - 58, 22, pal, 5);
      leafCluster(ctx, rng, bx + 22, by - 60, 22, pal, 5);
      // свисающие ветви-плети и мох
      for (let i = 0; i < 16; i++) {
        const x = bx + (rng() - 0.5) * 84, y0 = by - 66 + (rng() - 0.3) * 30, len = 18 + rng() * 32;
        ctx.strokeStyle = pal.outline; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + (rng() - 0.5) * 6, y0 + len * 0.6, x + (rng() - 0.5) * 8, y0 + len); ctx.stroke();
        ctx.strokeStyle = rng() < 0.5 ? pal.light : '#8a9a6a'; ctx.lineWidth = 1.6; ctx.stroke();
      }
      ell(ctx, bx, by + 1, 22, 5, 'rgba(60,80,50,0.5)');
    } else if (v === 10) {
      trunk(ctx, bx, by, 8, 34);
      ctx.strokeStyle = '#3a2616'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by - 30); ctx.lineTo(bx - 22, by - 58); ctx.moveTo(bx, by - 30); ctx.lineTo(bx + 24, by - 56); ctx.moveTo(bx, by - 34); ctx.lineTo(bx + 4, by - 62); ctx.stroke();
      const pal = { outline: '#1c200c', dark: '#5a6a22', mid: '#7a8a2e', light: '#a8b848' };
      // плоская зонтичная крона
      for (const [dx, dy, R] of [[-26, -64, 20], [0, -70, 24], [26, -63, 20], [-12, -72, 16], [14, -73, 16]]) { ell(ctx, bx + dx, by + dy, R + 2, R * 0.45 + 2, pal.outline); }
      for (const [dx, dy, R] of [[-26, -64, 20], [0, -70, 24], [26, -63, 20], [-12, -72, 16], [14, -73, 16]]) { ell(ctx, bx + dx, by + dy, R, R * 0.45, pal.dark); ell(ctx, bx + dx - 3, by + dy - 3, R * 0.8, R * 0.3, pal.mid); ell(ctx, bx + dx - 6, by + dy - 5, R * 0.45, R * 0.16, pal.light); }
      ell(ctx, bx, by + 1, 20, 4, 'rgba(90,70,30,0.35)');
    } else {
      // сухое дерево: голые ветви
      trunk(ctx, bx, by, 10, 36);
      const branch = (x, y, a, len, w, d) => {
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        ctx.strokeStyle = '#1e140c'; ctx.lineWidth = w + 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#6b5a48'; ctx.lineWidth = w; ctx.stroke();
        if (d > 0) { branch(x2, y2, a - 0.45 - rng() * 0.3, len * 0.7, w * 0.65, d - 1); branch(x2, y2, a + 0.4 + rng() * 0.3, len * 0.65, w * 0.6, d - 1); }
      };
      branch(bx, by - 34, -Math.PI / 2, 28, 7, 3);
    }
    return { c, ox: bx, oy: by };
  }

  function makeTree(v) {
    if (v >= 6) return makeBiomeTree(v);
    const W = 120, H = 150, c = AB.canvas(W, H), ctx = c.getContext('2d');
    const rng = AB.rng(1000 + v * 77);
    const bx = W / 2, by = H - 10;
    if (v < 3) {
      trunk(ctx, bx, by, 12, 44);
      const pal = TREE_PALS[v];
      leafCluster(ctx, rng, bx, by - 70, 44, pal, 9);
      leafCluster(ctx, rng, bx - 16, by - 56, 24, pal, 5);
      leafCluster(ctx, rng, bx + 18, by - 58, 22, pal, 5);
      if (v === 0) for (let i = 0; i < 6; i++) { // яблочки/цветы
        const x = bx + (rng() - 0.5) * 60, y = by - 70 + (rng() - 0.5) * 50;
        circle(ctx, x, y, 2.2, rng() < 0.5 ? '#d8563e' : '#f2d36b');
      }
    } else {
      const pal = PINE_PALS[v - 3];
      trunk(ctx, bx, by, 9, 26);
      const tiers = 5;
      for (let t = 0; t < tiers; t++) {
        const k = t / (tiers - 1);
        const w = AB.lerp(48, 14, k), yb2 = by - 16 - t * 21, h = 40;
        const pts = [];
        const seg = 7;
        for (let i = 0; i <= seg; i++) {
          const f = i / seg;
          pts.push([bx - w + f * w * 2, yb2 + (i % 2 ? -3 : 3) + Math.sin(f * Math.PI) * 5]);
        }
        const draw = (dx, dy, grow, col) => {
          ctx.fillStyle = col; ctx.beginPath();
          ctx.moveTo(bx + dx, yb2 - h - grow + dy);
          pts.forEach(p => ctx.lineTo(p[0] + (p[0] < bx ? -grow : grow) + dx, p[1] + grow + dy));
          ctx.closePath(); ctx.fill();
        };
        draw(0, 0, 2.5, pal.outline);
        draw(0, 0, 0, pal.dark);
        ctx.save(); ctx.beginPath();
        ctx.moveTo(bx, yb2 - h); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();
        ctx.fillStyle = pal.mid; ctx.beginPath(); ctx.moveTo(bx, yb2 - h); ctx.lineTo(bx - w, yb2); ctx.lineTo(bx + w * 0.25, yb2 - 4); ctx.fill();
        ctx.fillStyle = pal.light; ctx.beginPath(); ctx.moveTo(bx, yb2 - h); ctx.lineTo(bx - w * 0.75, yb2 - 6); ctx.lineTo(bx - w * 0.2, yb2 - 10); ctx.fill();
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = rng() < 0.5 ? pal.light : pal.dark; ctx.globalAlpha = 0.6;
          ctx.fillRect(Math.round(bx + (rng() - 0.5) * w * 2), Math.round(yb2 - rng() * h), 2, 2);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx - w - 4, yb2 - 6, w * 2 + 8, 10);
        ctx.restore();
      }
    }
    return { c, ox: bx, oy: by };
  }

  function makeStump() {
    const c = AB.canvas(40, 30), ctx = c.getContext('2d');
    ell(ctx, 20, 20, 13, 7, '#1e140c');
    ctx.fillStyle = '#4a321d'; ctx.fillRect(8, 12, 24, 9);
    ell(ctx, 20, 21, 12, 5.5, '#3a2616');
    ell(ctx, 20, 12, 12, 5.5, '#1e140c');
    ell(ctx, 20, 12, 11, 4.8, '#c8a06a');
    ctx.strokeStyle = '#9a7646'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(20, 12, 7, 3, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(20, 12, 3.5, 1.5, 0, 0, TAU); ctx.stroke();
    return { c, ox: 20, oy: 20 };
  }

  function makeRock(v, ruin, broken) {
    const c = AB.canvas(60, 64), ctx = c.getContext('2d');
    const rng = AB.rng(500 + v * 31 + (ruin ? 99 : 0));
    const bx = 30, by = 54;
    if (!ruin) {
      const pts = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1)) * Math.PI;
        const r = 16 + rng() * 6;
        pts.push([bx + Math.cos(a) * r * 1.15, by - 4 + Math.sin(a) * r * (0.9 + v * 0.1)]);
      }
      const poly = (off, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(bx - 20 - off, by + off); pts.forEach(p => ctx.lineTo(p[0] + (p[0] < bx ? -off : off), p[1] - off)); ctx.lineTo(bx + 20 + off, by + off); ctx.closePath(); ctx.fill(); };
      poly(2.5, '#1b1d20');
      poly(0, '#5d6268');
      ctx.save(); ctx.beginPath(); ctx.moveTo(bx - 20, by); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(bx + 20, by); ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#7d848b'; ctx.beginPath(); ctx.moveTo(bx - 18, by - 6); pts.slice(0, 6).forEach(p => ctx.lineTo(p[0] + 2, p[1] + 3)); ctx.lineTo(bx, by - 8); ctx.fill();
      ctx.fillStyle = '#9aa2a8'; ctx.beginPath(); ctx.moveTo(bx - 10, by - 14); pts.slice(2, 5).forEach(p => ctx.lineTo(p[0] + 4, p[1] + 5)); ctx.fill();
      ctx.fillStyle = '#3e4246'; ctx.fillRect(bx - 22, by - 5, 44, 6);
      // мох
      for (let i = 0; i < 14; i++) { ctx.fillStyle = rng() < 0.5 ? '#4f7a36' : '#3b5e2a'; ctx.fillRect(Math.round(bx - 14 + rng() * 22), Math.round(by - 20 - rng() * 8), 3, 2); }
      ctx.strokeStyle = '#34383c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 4, by - 18); ctx.lineTo(bx + 8, by - 10); ctx.lineTo(bx + 6, by - 4); ctx.stroke();
      ctx.restore();
    } else {
      // обломок колонны
      const h = 22 + (1 - broken) * 22;
      ell(ctx, bx, by - 2, 17, 7, '#1b1d20');
      ctx.fillStyle = '#1b1d20'; ctx.fillRect(bx - 13, by - h - 2, 26, h + 2);
      const g = ctx.createLinearGradient(bx - 12, 0, bx + 12, 0);
      g.addColorStop(0, '#9c978a'); g.addColorStop(0.5, '#7b776c'); g.addColorStop(1, '#55524a');
      ctx.fillStyle = g; ctx.fillRect(bx - 11, by - h, 22, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = -6; i <= 6; i += 6) ctx.fillRect(bx + i, by - h + 3, 1.5, h - 5);
      ell(ctx, bx, by - h, 11, 4.5, '#b7b1a2');
      ctx.fillStyle = '#6d695f'; ctx.beginPath(); ctx.moveTo(bx - 11, by - h); ctx.lineTo(bx - 3, by - h + 5); ctx.lineTo(bx + 4, by - h - 2); ctx.lineTo(bx + 11, by - h + 3); ctx.lineTo(bx + 11, by - h); ctx.fill();
      ctx.fillStyle = '#6a6559'; ctx.fillRect(bx - 14, by - 5, 28, 5);
      for (let i = 0; i < 16; i++) { ctx.fillStyle = rng() < 0.5 ? '#4f7a36' : '#6d9a44'; ctx.fillRect(Math.round(bx - 11 + rng() * 20), Math.round(by - rng() * h * 0.7), 2 + (rng() * 2 | 0), 2); }
    }
    return { c, ox: bx, oy: by };
  }

  function makeBush(berries) {
    const c = AB.canvas(50, 44), ctx = c.getContext('2d');
    const rng = AB.rng(321);
    leafCluster(ctx, rng, 25, 24, 17, { outline: '#0f1f10', dark: '#24462a', mid: '#39683a', light: '#5d9950' }, 7);
    if (berries) {
      const r2 = AB.rng(11);
      for (let i = 0; i < 9; i++) {
        const x = 25 + (r2() - 0.5) * 26, y = 24 + (r2() - 0.5) * 20;
        circle(ctx, x, y, 3, '#4a0f1a'); circle(ctx, x, y, 2.3, '#c7243f'); circle(ctx, x - 0.8, y - 0.8, 0.9, '#ffb3c0');
      }
    }
    return { c, ox: 25, oy: 38 };
  }

  function makeChest(open) {
    const c = AB.canvas(44, 40), ctx = c.getContext('2d');
    const x = 6, y = 16, w = 32, h = 18;
    ell(ctx, 22, 35, 18, 4, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = '#1c1008'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#7a4a22'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#5c3718'; for (let i = 0; i < 3; i++) ctx.fillRect(x, y + 5 + i * 5, w, 1);
    ctx.fillStyle = '#d6a83a'; ctx.fillRect(x, y, 3, h); ctx.fillRect(x + w - 3, y, 3, h);
    if (!open) {
      ctx.fillStyle = '#1c1008'; ctx.fillRect(x - 2, y - 11, w + 4, 12);
      ctx.fillStyle = '#8f5a2a'; ctx.fillRect(x, y - 9, w, 9);
      ctx.fillStyle = '#a86d35'; ctx.fillRect(x, y - 9, w, 3);
      ctx.fillStyle = '#d6a83a'; ctx.fillRect(x, y - 9, 3, 9); ctx.fillRect(x + w - 3, y - 9, 3, 9);
      ctx.fillStyle = '#f3d36a'; ctx.fillRect(x + w / 2 - 3, y - 3, 6, 7);
      ctx.fillStyle = '#3a2410'; ctx.fillRect(x + w / 2 - 1, y, 2, 3);
    } else {
      ctx.fillStyle = '#1c1008'; ctx.fillRect(x - 2, y - 16, w + 4, 8);
      ctx.fillStyle = '#6a4020'; ctx.fillRect(x, y - 14, w, 5);
      ctx.fillStyle = '#140a04'; ctx.fillRect(x + 2, y - 1, w - 4, 5);
    }
    return { c, ox: 22, oy: 34 };
  }

  function makeTent() {
    const c = AB.canvas(90, 70), ctx = c.getContext('2d');
    ell(ctx, 45, 60, 42, 9, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = '#16100a'; ctx.beginPath(); ctx.moveTo(45, 6); ctx.lineTo(4, 62); ctx.lineTo(86, 62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6f7d45'; ctx.beginPath(); ctx.moveTo(45, 9); ctx.lineTo(8, 60); ctx.lineTo(45, 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#56633a'; ctx.beginPath(); ctx.moveTo(45, 9); ctx.lineTo(82, 60); ctx.lineTo(45, 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b140c'; ctx.beginPath(); ctx.moveTo(45, 28); ctx.lineTo(33, 60); ctx.lineTo(57, 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a9a58'; ctx.beginPath(); ctx.moveTo(45, 28); ctx.lineTo(30, 60); ctx.lineTo(36, 60); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3c2a18'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(45, 4); ctx.lineTo(45, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; for (let i = 0; i < 5; i++) ctx.fillRect(14 + i * 13, 50 - i * 2, 1, 10);
    return { c, ox: 45, oy: 60 };
  }

  function makeLogs() {
    const c = AB.canvas(60, 40), ctx = c.getContext('2d');
    ell(ctx, 30, 33, 27, 6, 'rgba(0,0,0,0.35)');
    const log = (x, y) => {
      ctx.fillStyle = '#1e140c'; ctx.fillRect(x - 1, y - 6, 40, 12);
      ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x, y - 5, 38, 10);
      ctx.fillStyle = '#86603c'; ctx.fillRect(x, y - 5, 38, 3);
      ell(ctx, x + 38, y, 5, 6, '#1e140c'); ell(ctx, x + 38, y, 4, 5, '#c8a06a'); ell(ctx, x + 38, y, 1.5, 2, '#9a7646');
    };
    log(6, 30); log(14, 30); log(10, 20);
    return { c, ox: 30, oy: 34 };
  }

  // Иконки предметов 32×32
  function makeIcon(k) {
    const c = AB.canvas(32, 32), ctx = c.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const O = '#140c08';
    switch (k) {
      case 'wood': {
        for (let i = 0; i < 2; i++) {
          const y = 12 + i * 8, x = 4 + i * 3;
          ctx.fillStyle = O; ctx.fillRect(x - 1, y - 5, 22, 10);
          ctx.fillStyle = '#8a5a30'; ctx.fillRect(x, y - 4, 20, 8);
          ctx.fillStyle = '#a8743f'; ctx.fillRect(x, y - 4, 20, 2);
          ell(ctx, x + 20, y, 4, 5, O); ell(ctx, x + 20, y, 3, 4, '#e0b77a'); ell(ctx, x + 20, y, 1, 1.5, '#9a7646');
        }
        break;
      }
      case 'meat': {
        ctx.fillStyle = '#efe6d2'; ctx.strokeStyle = O; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(21, 21); ctx.lineTo(28, 28); ctx.stroke();
        circle(ctx, 28, 27, 3, O); circle(ctx, 28, 27, 2, '#efe6d2');
        ell(ctx, 14, 14, 11, 9, O, -0.7); ell(ctx, 14, 14, 9.5, 7.5, '#b8433a', -0.7);
        ell(ctx, 12, 12, 6, 4, '#d9675a', -0.7); ell(ctx, 10, 10, 2, 1.3, '#f3a39a', -0.7);
        break;
      }
      case 'berry': {
        [[11, 18], [19, 17], [15, 11], [21, 24], [12, 25]].forEach(p => { circle(ctx, p[0], p[1], 5.2, O); circle(ctx, p[0], p[1], 4.2, '#c7243f'); circle(ctx, p[0] - 1.3, p[1] - 1.3, 1.4, '#ffb3c0'); });
        ctx.fillStyle = '#4f8a3a'; ctx.beginPath(); ctx.ellipse(18, 6, 5, 2.5, -0.5, 0, TAU); ctx.fill();
        break;
      }
      case 'carrot': {
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(5, 28); ctx.lineTo(24, 12); ctx.lineTo(19, 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f07b25'; ctx.beginPath(); ctx.moveTo(7, 26); ctx.lineTo(22, 12); ctx.lineTo(19, 9); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#b8521a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, 19); ctx.lineTo(15, 21); ctx.moveTo(16, 15); ctx.lineTo(19, 17); ctx.stroke();
        ctx.strokeStyle = '#3f8a2a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(22, 9); ctx.lineTo(27, 3); ctx.moveTo(22, 9); ctx.lineTo(29, 8); ctx.moveTo(22, 9); ctx.lineTo(24, 2); ctx.stroke();
        break;
      }
      case 'pumpkin': {
        ell(ctx, 16, 19, 13, 10, O);
        ell(ctx, 16, 19, 12, 9, '#e0761f'); ell(ctx, 10, 19, 5, 8, '#f08f35'); ell(ctx, 22, 19, 5, 8, '#c9621a'); ell(ctx, 16, 19, 3.5, 8.5, '#f59b45');
        ctx.fillStyle = '#4b6a24'; ctx.fillRect(14, 6, 4, 6);
        break;
      }
      case 'cooked_meat': {
        ctx.fillStyle = '#efe6d2'; ctx.strokeStyle = O; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(21, 21); ctx.lineTo(28, 28); ctx.stroke();
        circle(ctx, 28, 27, 3, O); circle(ctx, 28, 27, 2, '#efe6d2');
        ell(ctx, 14, 14, 11, 9, O, -0.7); ell(ctx, 14, 14, 9.5, 7.5, '#7a3e1c', -0.7);
        ell(ctx, 12, 12, 6, 4, '#a8582a', -0.7);
        ctx.strokeStyle = '#3a1a08'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(7 + i * 4, 17 - i * 2); ctx.lineTo(12 + i * 4, 9 - i * 2); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(8, 4); ctx.quadraticCurveTo(10, 1, 8, -2); ctx.moveTo(14, 4); ctx.quadraticCurveTo(16, 1, 14, -2); ctx.stroke();
        break;
      }
      case 'cooked_carrot': {
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(5, 28); ctx.lineTo(24, 12); ctx.lineTo(19, 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b8521a'; ctx.beginPath(); ctx.moveTo(7, 26); ctx.lineTo(22, 12); ctx.lineTo(19, 9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5a2a0a'; ctx.fillRect(11, 19, 3, 2); ctx.fillRect(16, 14, 3, 2);
        ctx.strokeStyle = '#6a5a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(22, 9); ctx.lineTo(26, 5); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(10, 10); ctx.quadraticCurveTo(12, 7, 10, 4); ctx.stroke();
        break;
      }
      case 'cooked_pumpkin': {
        ell(ctx, 16, 22, 14, 8, O); ell(ctx, 16, 22, 12.5, 6.5, '#8a6a4a');
        ell(ctx, 16, 19, 11, 4, O); ell(ctx, 16, 19, 10, 3.2, '#f0a040'); ell(ctx, 13, 18.5, 3, 1.2, '#ffd08a');
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(12, 13); ctx.quadraticCurveTo(14, 9, 12, 5); ctx.moveTo(19, 13); ctx.quadraticCurveTo(21, 9, 19, 5); ctx.stroke();
        break;
      }
      case 'plank': {
        for (let i = 0; i < 3; i++) {
          const y = 9 + i * 6, x = 4 + (i % 2) * 2;
          ctx.fillStyle = O; ctx.fillRect(x - 1, y - 1, 24, 7);
          ctx.fillStyle = i % 2 ? '#d8b078' : '#c8a06a'; ctx.fillRect(x, y, 22, 5);
          ctx.fillStyle = '#a07848'; ctx.fillRect(x + 4, y + 2, 6, 1); ctx.fillRect(x + 13, y + 1, 5, 1);
        }
        break;
      }
      case 'coal': {
        const pts = [[7, 22], [10, 12], [17, 8], [25, 12], [27, 21], [20, 27], [11, 27]];
        ctx.fillStyle = O; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a2a30'; ctx.beginPath(); pts.forEach((q, i) => { const x = 16 + (q[0] - 16) * 0.85, y = 18 + (q[1] - 18) * 0.85; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#4a4a55'; ctx.beginPath(); ctx.moveTo(12, 14); ctx.lineTo(17, 11); ctx.lineTo(20, 16); ctx.lineTo(14, 18); ctx.fill();
        ctx.fillStyle = '#ff7a2a'; ctx.fillRect(18, 21, 3, 2); ctx.fillStyle = '#ffd24a'; ctx.fillRect(12, 23, 2, 1);
        break;
      }
      case 'hide': {
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(6, 8); ctx.lineTo(12, 4); ctx.lineTo(20, 4); ctx.lineTo(26, 8); ctx.lineTo(28, 18); ctx.lineTo(24, 28); ctx.lineTo(16, 25); ctx.lineTo(8, 28); ctx.lineTo(4, 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a7058'; ctx.beginPath(); ctx.moveTo(7, 9); ctx.lineTo(12, 6); ctx.lineTo(20, 6); ctx.lineTo(25, 9); ctx.lineTo(26, 18); ctx.lineTo(23, 26); ctx.lineTo(16, 23); ctx.lineTo(9, 26); ctx.lineTo(6, 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a88a6a'; ctx.beginPath(); ctx.ellipse(16, 14, 6, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6a5040'; for (let i = 0; i < 6; i++) ctx.fillRect(9 + (i * 5) % 14, 10 + i * 2.5, 2, 1);
        break;
      }
      case 'coin': {
        circle(ctx, 16, 17, 11, O); circle(ctx, 16, 17, 9.5, '#e0a82a'); circle(ctx, 16, 16, 8, '#ffd24a');
        ctx.fillStyle = '#b8862a'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 16, 16.5);
        ctx.fillStyle = '#fff6c0'; ctx.fillRect(11, 11, 3, 2);
        break;
      }
      case 'seed_carrot': case 'seed_pumpkin': {
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(7, 9); ctx.lineTo(25, 9); ctx.lineTo(27, 29); ctx.lineTo(5, 29); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c8a56a'; ctx.beginPath(); ctx.moveTo(8, 11); ctx.lineTo(24, 11); ctx.lineTo(25, 27); ctx.lineTo(7, 27); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a8864f'; ctx.fillRect(8, 11, 16, 4);
        ctx.strokeStyle = '#6a4d22'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(9, 8); ctx.lineTo(16, 5); ctx.lineTo(23, 8); ctx.stroke();
        circle(ctx, 16, 20, 5, k === 'seed_carrot' ? '#f07b25' : '#e0761f');
        ctx.fillStyle = k === 'seed_carrot' ? '#3f8a2a' : '#4b6a24'; ctx.fillRect(15, 13, 2, 3);
        break;
      }
      case 'iron': {
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(4, 24); ctx.lineTo(9, 11); ctx.lineTo(25, 11); ctx.lineTo(29, 24); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7d8892'; ctx.beginPath(); ctx.moveTo(6, 23); ctx.lineTo(10, 13); ctx.lineTo(24, 13); ctx.lineTo(27, 23); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b9c4cc'; ctx.beginPath(); ctx.moveTo(10, 13); ctx.lineTo(24, 13); ctx.lineTo(22, 17); ctx.lineTo(12, 17); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8f0f4'; ctx.fillRect(13, 14, 6, 1.5);
        ctx.fillStyle = '#5a646c'; ctx.fillRect(7, 21, 19, 2);
        break;
      }
      case 'axe': {
        ctx.strokeStyle = O; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(8, 27); ctx.lineTo(22, 6); ctx.stroke();
        ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(16, 6); ctx.lineTo(28, 4); ctx.lineTo(29, 16); ctx.lineTo(19, 13); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b9c2c9'; ctx.beginPath(); ctx.moveTo(18, 7); ctx.lineTo(27, 6); ctx.lineTo(27, 14); ctx.lineTo(20, 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8eef2'; ctx.fillRect(25, 6, 2, 8);
        break;
      }
      case 'stone': {
        [[10, 22, 8, 6.5, '#8e8778'], [21, 22, 8, 6.5, '#a09888'], [15, 13, 7.5, 6, '#b4ac9c']].forEach(q => {
          ell(ctx, q[0], q[1], q[2] + 1.3, q[3] + 1.3, O); ell(ctx, q[0], q[1], q[2], q[3], q[4]);
          ell(ctx, q[0] - 2, q[1] - 2, q[2] * 0.5, q[3] * 0.4, 'rgba(255,255,255,0.28)');
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(q[0] - 3, q[1] + 2, 6, 1.5);
        });
        break;
      }
      case 'pickaxe': {
        ctx.strokeStyle = O; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(8, 28); ctx.lineTo(21, 9); ctx.stroke();
        ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = O; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(6, 8); ctx.quadraticCurveTo(19, 1, 30, 14); ctx.stroke();
        ctx.strokeStyle = '#9aa4ac'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = '#e0e8ee'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(9, 7); ctx.quadraticCurveTo(19, 2.5, 27, 11); ctx.stroke();
        break;
      }
      default: weaponIcon(ctx, k);
    }
    return c;
  }

  // Отрисовка оружия (иконка и в руках). ctx уже повёрнут: оружие смотрит вправо (+x).
  S.drawWeapon = function (ctx, k, scale) {
    const s = scale || 1, O = '#120a06';
    ctx.save(); ctx.scale(s, s); ctx.lineCap = 'round';
    const line = (x1, y1, x2, y2, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    if (k === 'knife') {
      line(0, 0, 6, 0, 4.5, O); line(0, 0, 6, 0, 2.8, '#6b4a2e');
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(19, -1); ctx.lineTo(19, 1); ctx.lineTo(5, 3); ctx.fill();
      ctx.fillStyle = '#d4dde3'; ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(18, -0.5); ctx.lineTo(6, 1.5); ctx.fill();
    } else if (k === 'spear') {
      line(-8, 0, 26, 0, 4.5, O); line(-8, 0, 26, 0, 2.6, '#9a6a3a');
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(24, -4.5); ctx.lineTo(37, 0); ctx.lineTo(24, 4.5); ctx.fill();
      ctx.fillStyle = '#c9d3da'; ctx.beginPath(); ctx.moveTo(25, -3); ctx.lineTo(35, 0); ctx.lineTo(25, 3); ctx.fill();
      line(22, -2, 22, 2, 3, '#b83a2a');
    } else if (k === 'bow') {
      ctx.strokeStyle = O; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.arc(-4, 0, 14, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.6; ctx.stroke();
      line(-4 + Math.cos(-1.2) * 14, Math.sin(-1.2) * 14, -4 + Math.cos(1.2) * 14, Math.sin(1.2) * 14, 1, '#e8e0c8');
      line(0, 0, 18, 0, 1.6, '#c8a06a');
    } else if (k === 'crossbow') {
      line(-6, 0, 18, 0, 6, O); line(-6, 0, 18, 0, 4, '#6b4a2e');
      ctx.strokeStyle = O; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(10, 0, 11, -1.4, 1.4); ctx.stroke();
      ctx.strokeStyle = '#7d858c'; ctx.lineWidth = 2.4; ctx.stroke();
      line(12, -11, 12, 11, 1, '#ddd');
      line(4, 0, 22, 0, 1.6, '#e0e0e0');
    } else if (k === 'rifle') {
      line(-10, 1, 30, 0, 6, O);
      line(-10, 1, 6, 1, 5, '#7a4a22');
      line(4, 0, 30, 0, 3, '#3d4247');
      line(8, -3, 16, -3, 3, '#222');
      ctx.fillStyle = '#7a4a22'; ctx.fillRect(-12, -1, 6, 6);
    }
    ctx.restore();
  };
  function weaponIcon(ctx, k) {
    ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 4);
    const sc = { knife: 1.3, spear: 0.72, bow: 0.95, crossbow: 0.95, rifle: 0.68 }[k] || 1;
    const ox = { knife: -10, spear: -9, bow: -2, crossbow: -6, rifle: -9 }[k] || 0;
    ctx.translate(ox * sc, 0);
    S.drawWeapon(ctx, k, sc);
    ctx.restore();
  }

  // Растение на грядке (стадия 0..3)
  S.drawCrop = function (ctx, x, y, crop, stage, t) {
    const sway = Math.sin(t * 2 + x) * 1.2;
    if (stage === 0) { circle(ctx, x - 3, y, 1.6, '#6fa84a'); circle(ctx, x + 3, y + 1, 1.6, '#6fa84a'); return; }
    if (crop === 'carrot') {
      const h = [0, 6, 10, 13][stage];
      ctx.strokeStyle = '#2d6a1f'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 4 + sway, y - h * 0.6, x + i * 6 + sway, y - h); ctx.stroke(); }
      ctx.strokeStyle = '#58a33a'; ctx.lineWidth = 1.2;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 4 + sway, y - h * 0.6, x + i * 6 + sway, y - h); ctx.stroke(); }
      if (stage === 3) { ell(ctx, x, y + 1, 4, 3, '#140c08'); ell(ctx, x, y + 1, 3, 2.2, '#f07b25'); }
    } else {
      const r = [0, 3, 5, 9][stage];
      [-1, 1].forEach(i => { ell(ctx, x + i * 6 + sway * 0.5, y - 3, 5, 3.5, '#1e4a1a', i * 0.4); ell(ctx, x + i * 6 + sway * 0.5, y - 3.5, 4, 2.6, '#4f8a3a', i * 0.4); });
      if (stage >= 2) { ell(ctx, x, y, r + 1, r * 0.8 + 1, '#140c08'); ell(ctx, x, y, r, r * 0.8, stage === 3 ? '#e0761f' : '#9ab04a'); ell(ctx, x - r * 0.3, y - r * 0.2, r * 0.35, r * 0.5, stage === 3 ? '#f59b45' : '#b8c86a'); ctx.fillStyle = '#4b6a24'; ctx.fillRect(x - 1, y - r * 0.8 - 3, 2, 3); }
    }
  };

  // Залежи: большая куча камней и маленькая железная скала (dead — осколки после добычи). Рисуются в 2× для чёткости.
  function makeOre(kind, v, dead) {
    const K = 2, W = 64, H = 60, c = AB.canvas(W * K, H * K), ctx = c.getContext('2d');
    ctx.scale(K, K);
    const rng = AB.rng(900 + v * 17 + (kind === 'iron' ? 50 : 0));
    const O = '#16110c', bx = 32, by = 50;
    const stoneBlob = (x, y, rx, ry, base, hi, sh) => {
      ell(ctx, x, y, rx + 1.4, ry + 1.4, O);
      ell(ctx, x, y, rx, ry, base);
      ell(ctx, x - rx * 0.25, y - ry * 0.35, rx * 0.62, ry * 0.45, hi);
      ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(x + rx * 0.1, y + ry * 0.55, rx * 0.8, ry * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - rx * 0.45, y - ry * 0.55, rx * 0.35, 1.2);
    };
    ell(ctx, bx, by, dead ? 16 : 26, dead ? 5 : 8, 'rgba(0,0,0,0.3)');
    if (kind === 'stone') {
      const pal = [['#8a8272', '#aaa292', 'rgba(40,30,20,0.3)'], ['#9a9282', '#bab2a2', 'rgba(40,30,20,0.3)'], ['#7e786c', '#9e9888', 'rgba(40,30,20,0.3)']];
      const list = dead
        ? [[-8, -2, 5, 3.5], [3, 0, 6, 4], [10, -3, 4, 3], [-2, -6, 4, 3]]
        : [[-16, -4, 9, 7], [-4, -3, 10, 8], [9, -4, 9, 7], [18, -2, 6, 5], [-10, -13, 9, 7.5], [4, -14, 10, 8], [-3, -23, 8.5, 7], [13, -12, 6, 5], [-19, -12, 5, 4]];
      list.sort((a, b) => a[1] - b[1]);
      list.forEach((q, i) => { const pc = pal[(i + v) % 3]; stoneBlob(bx + q[0] + (rng() - 0.5) * 2, by + q[1], q[2], q[3], pc[0], pc[1], pc[2]); });
      if (!dead) { ctx.fillStyle = '#4f8a3a'; for (let i = 0; i < 4; i++) { const x = bx - 20 + rng() * 40, y = by - 2 + rng() * 3; ctx.fillRect(x, y - 3, 1.5, 3); ctx.fillRect(x + 2, y - 2, 1.5, 2); } }
    } else {
      if (dead) {
        [[-7, -1, 5, 3.5], [4, 0, 6, 4], [11, -2, 3.5, 2.5]].forEach(q => stoneBlob(bx + q[0], by + q[1], q[2], q[3], '#4a4f56', '#646a72', 'rgba(0,0,0,0.3)'));
        ctx.fillStyle = '#b8603a'; ctx.fillRect(bx + 2, by - 2, 3, 2); ctx.fillRect(bx - 8, by - 1, 2, 1.5);
      } else {
        // зубчатая скала: несколько граней
        const peaks = [[-22, 0], [-20, -16], [-12, -30 - v * 2], [-4, -24], [4, -38 + v], [12, -26], [19, -32 + v * 2], [24, -12], [22, 0]];
        ctx.fillStyle = O; ctx.beginPath(); peaks.forEach((q, i) => { const x = bx + q[0] * 1.08, y = by + q[1] * 1.04 + (q[1] ? -1 : 1); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#4a5058'; ctx.beginPath(); peaks.forEach((q, i) => { const x = bx + q[0], y = by + q[1]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
        // освещённые грани
        ctx.fillStyle = '#6a727c';
        ctx.beginPath(); ctx.moveTo(bx - 20, by - 16); ctx.lineTo(bx - 12, by - 30 - v * 2); ctx.lineTo(bx - 4, by - 24); ctx.lineTo(bx - 9, by - 8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx - 4, by - 24); ctx.lineTo(bx + 4, by - 38 + v); ctx.lineTo(bx + 12, by - 26); ctx.lineTo(bx + 5, by - 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a929c';
        ctx.beginPath(); ctx.moveTo(bx + 4, by - 38 + v); ctx.lineTo(bx + 8, by - 32); ctx.lineTo(bx + 1, by - 26); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx - 12, by - 30 - v * 2); ctx.lineTo(bx - 9, by - 24); ctx.lineTo(bx - 15, by - 20); ctx.closePath(); ctx.fill();
        // тёмный низ
        ctx.fillStyle = '#353a40'; ctx.beginPath(); ctx.moveTo(bx - 22, by); ctx.lineTo(bx - 18, by - 7); ctx.lineTo(bx + 20, by - 9); ctx.lineTo(bx + 22, by); ctx.closePath(); ctx.fill();
        // трещины
        ctx.strokeStyle = '#23272c'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(bx - 9, by - 8); ctx.lineTo(bx - 6, by - 18); ctx.moveTo(bx + 5, by - 12); ctx.lineTo(bx + 9, by - 20); ctx.lineTo(bx + 14, by - 18); ctx.stroke();
        // рыжие жилы железной руды и блёстки
        ctx.strokeStyle = '#1a0e08'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
        const veins = [[[-16, -12], [-10, -16], [-6, -12]], [[2, -20], [8, -24], [14, -20]], [[-2, -6], [6, -8]], [[14, -8], [19, -14]]];
        veins.forEach(vn => { ctx.beginPath(); vn.forEach((q, i) => i ? ctx.lineTo(bx + q[0], by + q[1]) : ctx.moveTo(bx + q[0], by + q[1])); ctx.stroke(); });
        ctx.strokeStyle = '#c0643a'; ctx.lineWidth = 2;
        veins.forEach(vn => { ctx.beginPath(); vn.forEach((q, i) => i ? ctx.lineTo(bx + q[0], by + q[1]) : ctx.moveTo(bx + q[0], by + q[1])); ctx.stroke(); });
        ctx.fillStyle = '#e8906a'; veins.forEach(vn => ctx.fillRect(bx + vn[0][0], by + vn[0][1] - 0.5, 1.5, 1));
        ctx.fillStyle = '#eef4f8'; [[-13, -20], [6, -30], [16, -16], [-4, -14], [10, -6]].forEach(q => { ctx.fillRect(bx + q[0], by + q[1], 1.6, 1.6); ctx.fillRect(bx + q[0] - 1, by + q[1] + 0.5, 3.6, 0.6); });
        // камешки у подножия
        stoneBlob(bx - 24, by - 1, 4, 3, '#4a4f56', '#646a72', 'rgba(0,0,0,0.3)');
        stoneBlob(bx + 25, by - 2, 3.5, 2.6, '#555b62', '#6e757c', 'rgba(0,0,0,0.3)');
      }
    }
    return { c, ox: bx * K, oy: by * K, k: K };
  }

  S.init = function () {
    S.trees = []; for (let v = 0; v < 12; v++) S.trees.push(makeTree(v));
    S.stump = makeStump();
    S.rocks = [0, 1, 2].map(v => makeRock(v, false));
    S.ruins = [0, 1, 2].map(v => makeRock(v, true, v / 2));
    S.bush = makeBush(false); S.bushBerries = makeBush(true);
    S.chest = makeChest(false); S.chestOpen = makeChest(true);
    S.tent = makeTent(); S.logs = makeLogs();
    S.icons = {};
    ['wood', 'meat', 'berry', 'carrot', 'pumpkin', 'cooked_meat', 'cooked_carrot', 'cooked_pumpkin', 'plank', 'hide', 'coal', 'coin', 'seed_carrot', 'seed_pumpkin', 'iron', 'axe', 'stone', 'pickaxe'].forEach(k => S.icons[k] = makeIcon(k));
    S.ores = { stone: [0, 1, 2].map(v => makeOre('stone', v, false)), iron: [0, 1, 2].map(v => makeOre('iron', v, false)) };
    S.oresDead = { stone: makeOre('stone', 0, true), iron: makeOre('iron', 0, true) };
  };
})(window.AB);
