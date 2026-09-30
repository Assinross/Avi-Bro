// Грибная поляна: детальные спрайты грибов (рисуются один раз в 2× разрешении и кешируются),
// живые эффекты (свечение ночью, споры) и мелкие детали земли.
(function (AB) {
  const M = AB.Mush = {};
  const TAU = Math.PI * 2;
  const K = 2; // сверхвыборка: спрайт рисуется вдвое крупнее и уменьшается при выводе — края мягче
  const O = '#150c0a';
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a === undefined ? 1 : a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lit = (c, k) => mix(c, [255, 250, 235], k), dim = (c, k) => mix(c, [12, 6, 16], k);
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w * K; c.height = h * K; const ctx = c.getContext('2d'); ctx.scale(K, K); return [c, ctx]; }

  // Палитры шляпок: основной цвет, цвет пятен, светятся ли ночью
  const CAPS = [
    { cap: '#d23a2c', spot: '#fff4e2', gill: '#f0d8b8', glow: null },          // мухомор
    { cap: '#7a4ad8', spot: '#e6d4ff', gill: '#c8b0e8', glow: [190, 140, 255] }, // лиловый, светится
    { cap: '#1f9fb0', spot: '#d8fbff', gill: '#b8e0e0', glow: [110, 240, 255] }, // бирюзовый, светится
    { cap: '#d88a2a', spot: '#fff0c8', gill: '#f0d8a8', glow: null },          // янтарный
  ];
  M.CAPS = CAPS;

  // Моховая кочка с травинками, камешками и крошечными грибочками у основания
  function mossBase(ctx, r, x, y, rx, ry) {
    const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.5, 1, x, y, rx);
    g.addColorStop(0, '#6aa24a'); g.addColorStop(0.6, '#3f7a34'); g.addColorStop(1, '#244a24');
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 3, rx * 1.05, ry * 1.05, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#10200c'; ctx.beginPath(); ctx.ellipse(x, y, rx + 1.5, ry + 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    // фактура мха
    for (let i = 0; i < rx * ry * 0.35; i++) {
      const a = r() * TAU, d = Math.sqrt(r());
      const px = x + Math.cos(a) * rx * d, py = y + Math.sin(a) * ry * d;
      ctx.fillStyle = r() < 0.55 ? 'rgba(150,200,90,0.55)' : 'rgba(20,50,20,0.5)';
      ctx.fillRect(px, py, 1.2, 1.2);
    }
    // травинки по краю
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * (0.05 + r() * 0.9) + (r() < 0.5 ? Math.PI : 0), px = x + Math.cos(a) * rx * (0.8 + r() * 0.25), py = y + Math.sin(a) * ry * 0.9;
      const h = 4 + r() * 6, lean = (r() - 0.5) * 4;
      ctx.strokeStyle = '#1a3a14'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + lean * 0.3, py - h * 0.6, px + lean, py - h); ctx.stroke();
      ctx.strokeStyle = r() < 0.5 ? '#6fae44' : '#8fc858'; ctx.lineWidth = 1; ctx.stroke();
    }
    // камешки
    for (let i = 0; i < 3; i++) {
      const px = x + (r() - 0.5) * rx * 1.6, py = y + ry * (0.3 + r() * 0.5);
      ctx.fillStyle = '#2a2622'; ctx.beginPath(); ctx.ellipse(px, py, 2.6, 1.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a857a'; ctx.beginPath(); ctx.ellipse(px - 0.3, py - 0.3, 2, 1.3, 0, 0, TAU); ctx.fill();
    }
  }

  // Ножка: изгиб, объём, волокна, «юбочка» и клубень внизу
  function stem(ctx, r, x, yb, w, h, bend, col) {
    const c = hex(col || '#efe4c8');
    const top = yb - h, mx = x + bend;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x - w * 0.62, yb);
      ctx.quadraticCurveTo(mx - w * 0.55, yb - h * 0.5, mx - w * 0.42, top);
      ctx.lineTo(mx + w * 0.42, top);
      ctx.quadraticCurveTo(mx + w * 0.55, yb - h * 0.5, x + w * 0.62, yb);
      ctx.closePath();
    };
    ctx.lineWidth = 2.2; ctx.strokeStyle = O; path(); ctx.stroke();
    const g = ctx.createLinearGradient(x - w * 0.6, 0, x + w * 0.6, 0);
    g.addColorStop(0, rgb(dim(c, 0.18))); g.addColorStop(0.3, rgb(lit(c, 0.35))); g.addColorStop(0.62, rgb(c)); g.addColorStop(1, rgb(dim(c, 0.42)));
    ctx.fillStyle = g; path(); ctx.fill();
    // волокна
    ctx.save(); path(); ctx.clip();
    for (let i = 0; i < 9; i++) {
      const fx = -0.45 + i * 0.11 + (r() - 0.5) * 0.04;
      ctx.strokeStyle = `rgba(90,70,40,${0.12 + r() * 0.12})`; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x + fx * w * 1.3, yb); ctx.quadraticCurveTo(mx + fx * w * 1.1, yb - h * 0.5, mx + fx * w * 0.9, top); ctx.stroke();
    }
    // тень от шляпки
    const sg = ctx.createLinearGradient(0, top, 0, top + h * 0.35); sg.addColorStop(0, 'rgba(40,20,30,0.55)'); sg.addColorStop(1, 'rgba(40,20,30,0)');
    ctx.fillStyle = sg; ctx.fillRect(x - w, top, w * 2 + Math.abs(bend) * 2, h * 0.35);
    ctx.restore();
    // «юбочка» (кольцо) с волнистым краем
    const ry = top + h * 0.26, rx0 = mx + bend * -0.15;
    ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(rx0, ry, w * 0.62, 3.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgb(lit(c, 0.2)); ctx.beginPath(); ctx.moveTo(rx0 - w * 0.58, ry);
    for (let i = 0; i <= 10; i++) { const t = i / 10; ctx.lineTo(rx0 - w * 0.58 + t * w * 1.16, ry + 2.4 + Math.sin(t * Math.PI * 5) * 1.2); }
    ctx.lineTo(rx0 + w * 0.58, ry - 1.6); ctx.quadraticCurveTo(rx0, ry - 3.4, rx0 - w * 0.58, ry - 1.6); ctx.fill();
    // клубень
    ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(x, yb - 1, w * 0.78, 4.8, 0, 0, TAU); ctx.fill();
    const bg = ctx.createLinearGradient(x - w * 0.7, 0, x + w * 0.7, 0); bg.addColorStop(0, rgb(lit(c, 0.25))); bg.addColorStop(1, rgb(dim(c, 0.35)));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, yb - 1.3, w * 0.7, 3.8, 0, 0, TAU); ctx.fill();
  }

  // Шляпка: снизу пластинки, сверху объём, блик, тёмный край, пятна с тенью
  function cap(ctx, r, cx, cy, rw, rh, shape, pal) {
    const c = hex(pal.cap), sc = hex(pal.spot), gc = hex(pal.gill);
    // пластинки (видны снизу)
    ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(cx, cy + 1, rw + 1.5, rh * 0.26 + 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgb(dim(gc, 0.25)); ctx.beginPath(); ctx.ellipse(cx, cy + 1, rw, rh * 0.26, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgb(dim(gc, 0.5), 0.8); ctx.lineWidth = 0.6;
    for (let i = 0; i < 34; i++) { const a = Math.PI * (i / 33); ctx.beginPath(); ctx.moveTo(cx, cy + 1.5); ctx.lineTo(cx + Math.cos(a) * rw * 0.97, cy + 1 + Math.sin(a) * rh * 0.25); ctx.stroke(); }
    // форма купола
    const dome = () => {
      ctx.beginPath();
      if (shape === 'cone') { ctx.moveTo(cx - rw, cy); ctx.bezierCurveTo(cx - rw * 0.8, cy - rh * 0.8, cx - rw * 0.25, cy - rh * 1.15, cx, cy - rh * 1.2); ctx.bezierCurveTo(cx + rw * 0.25, cy - rh * 1.15, cx + rw * 0.8, cy - rh * 0.8, cx + rw, cy); }
      else if (shape === 'flat') { ctx.moveTo(cx - rw, cy); ctx.bezierCurveTo(cx - rw * 1.02, cy - rh * 0.55, cx - rw * 0.5, cy - rh * 0.8, cx, cy - rh * 0.8); ctx.bezierCurveTo(cx + rw * 0.5, cy - rh * 0.8, cx + rw * 1.02, cy - rh * 0.55, cx + rw, cy); }
      else { ctx.moveTo(cx - rw, cy); ctx.bezierCurveTo(cx - rw * 1.02, cy - rh * 0.9, cx - rw * 0.55, cy - rh * 1.05, cx, cy - rh * 1.05); ctx.bezierCurveTo(cx + rw * 0.55, cy - rh * 1.05, cx + rw * 1.02, cy - rh * 0.9, cx + rw, cy); }
      ctx.quadraticCurveTo(cx, cy + rh * 0.18, cx - rw, cy);
      ctx.closePath();
    };
    ctx.lineWidth = 2.6; ctx.strokeStyle = O; dome(); ctx.stroke();
    const g = ctx.createRadialGradient(cx - rw * 0.35, cy - rh * 0.8, 1, cx, cy - rh * 0.3, rw * 1.25);
    g.addColorStop(0, rgb(lit(c, 0.45))); g.addColorStop(0.35, rgb(c)); g.addColorStop(0.85, rgb(dim(c, 0.35))); g.addColorStop(1, rgb(dim(c, 0.55)));
    ctx.fillStyle = g; dome(); ctx.fill();
    ctx.save(); dome(); ctx.clip();
    // крапчатая фактура
    for (let i = 0; i < rw * rh * 0.5; i++) {
      const px = cx + (r() - 0.5) * rw * 2, py = cy - r() * rh * 1.2;
      ctx.fillStyle = r() < 0.5 ? rgb(lit(c, 0.25), 0.25) : rgb(dim(c, 0.4), 0.25); ctx.fillRect(px, py, 1.1, 1.1);
    }
    // пятна: неровные, с тенью снизу и бликом сверху
    const nSp = Math.round(4 + rw * 0.1);
    for (let i = 0; i < nSp; i++) {
      const a = r() * Math.PI, d = 0.2 + r() * 0.72;
      const px = cx - Math.cos(a) * rw * d * 0.95, py = cy - Math.sin(a) * rh * d * 0.95 - rh * 0.12;
      const sr = (1.3 + r() * 2.3) * (rw / 26), sx = sr * (1.1 + Math.abs(Math.cos(a)) * 0.2), sy = sr * (0.75 + Math.sin(a) * 0.2);
      ctx.fillStyle = rgb(dim(c, 0.55), 0.6); ctx.beginPath(); ctx.ellipse(px + 0.4, py + 0.9, sx, sy, a * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = rgb(sc); ctx.beginPath();
      for (let k2 = 0; k2 <= 9; k2++) { const aa = k2 / 9 * TAU, rr = 1 + (r() - 0.5) * 0.28; const qx = px + Math.cos(aa) * sx * rr, qy = py + Math.sin(aa) * sy * rr; k2 ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(px - sx * 0.3, py - sy * 0.35, sx * 0.35, sy * 0.28, 0, 0, TAU); ctx.fill();
    }
    // тёмный подворот по краю и глянцевый блик
    const eg = ctx.createLinearGradient(0, cy - rh * 0.3, 0, cy + 2); eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, rgb(dim(c, 0.7), 0.55));
    ctx.fillStyle = eg; ctx.fillRect(cx - rw - 2, cy - rh * 0.3, rw * 2 + 4, rh * 0.35);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(cx - rw * 0.15, cy - rh * 0.55, rw * 0.62, rh * 0.42, 0, Math.PI * 1.12, Math.PI * 1.45); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx - rw * 0.1, cy - rh * 0.52, rw * 0.72, rh * 0.5, 0, Math.PI * 1.5, Math.PI * 1.7); ctx.stroke();
    ctx.restore();
  }

  const cache = {};
  function cached(key, w, h, ox, oy, draw) {
    if (cache[key]) return cache[key];
    const [c, ctx] = canvas(w, h);
    draw(ctx);
    return (cache[key] = { c, ox: ox * K, oy: oy * K, k: K });
  }
  // Гигантский гриб (v 0..1 выбирает цвет, форму, изгиб)
  M.giant = function (v) {
    const i = Math.floor(v * 12) % 12, pal = CAPS[i % 4], shape = ['dome', 'flat', 'cone'][i % 3];
    return cached('g' + i, 120, 150, 60, 138, (ctx) => {
      const r = rng(i * 977 + 13);
      mossBase(ctx, r, 60, 136, 30, 9);
      // маленькие грибочки-спутники у основания
      for (let k2 = 0; k2 < 3; k2++) { const sx = 60 + (k2 - 1) * 26 + (r() - 0.5) * 6, sy = 138 + (k2 === 1 ? 4 : 0); if (k2 === 1) continue; stem(ctx, r, sx, sy, 4.5, 10, (r() - 0.5) * 3); cap(ctx, r, sx + 0.5, sy - 10, 8, 7, 'dome', CAPS[(i + k2 + 1) % 4]); }
      const bend = (r() - 0.5) * 10;
      stem(ctx, r, 60, 136, 17, 66, bend);
      cap(ctx, r, 60 + bend, 72, 48, shape === 'cone' ? 46 : 40, shape, pal);
    });
  };
  M.giantGlow = (v) => CAPS[(Math.floor(v * 12) % 12) % 4].glow;
  // Кучка мелких грибов: подберёзовики, лисички, поганки
  M.cluster = function (v) {
    const i = Math.floor(v * 6) % 6;
    return cached('c' + i, 64, 44, 32, 38, (ctx) => {
      const r = rng(i * 331 + 7);
      mossBase(ctx, r, 32, 36, 24, 6);
      const kinds = [];
      for (let k2 = 0; k2 < 5; k2++) kinds.push({ x: 12 + k2 * 10 + (r() - 0.5) * 5, h: 7 + r() * 9, t: Math.floor(r() * 3) });
      kinds.sort((a, b) => a.h - b.h).forEach((m, k2) => {
        const y = 37 + (k2 % 2) * 2;
        if (m.t === 0) { stem(ctx, r, m.x, y, 5, m.h, (r() - 0.5) * 2, '#e8dcc0'); cap(ctx, r, m.x, y - m.h, 8, 6.5, 'dome', { cap: '#8a5a32', spot: '#8a5a32', gill: '#d8c8a0' }); }
        else if (m.t === 1) { // лисичка: воронка
          ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(m.x - 2.5, y); ctx.lineTo(m.x - 7.5, y - m.h); ctx.lineTo(m.x + 7.5, y - m.h); ctx.lineTo(m.x + 2.5, y); ctx.fill();
          const g = ctx.createLinearGradient(m.x - 7, 0, m.x + 7, 0); g.addColorStop(0, '#ffc85a'); g.addColorStop(1, '#c87a1a');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(m.x - 1.5, y - 0.8); ctx.lineTo(m.x - 6.3, y - m.h + 0.8); ctx.quadraticCurveTo(m.x, y - m.h + 3, m.x + 6.3, y - m.h + 0.8); ctx.lineTo(m.x + 1.5, y - 0.8); ctx.fill();
          ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.ellipse(m.x, y - m.h + 1, 6.5, 1.8, 0, 0, TAU); ctx.fill();
        } else { stem(ctx, r, m.x, y, 3, m.h, (r() - 0.5) * 3, '#f4f0e8'); cap(ctx, r, m.x, y - m.h, 5.5, 5, 'cone', { cap: '#f0ece0', spot: '#f0ece0', gill: '#e0d8c8' }); }
      });
    });
  };
  // Тонкие светящиеся «фонарики»
  M.glowcap = function (v) {
    const i = Math.floor(v * 4) % 4;
    return cached('l' + i, 50, 70, 25, 64, (ctx) => {
      const r = rng(i * 71 + 3);
      mossBase(ctx, r, 25, 62, 18, 5);
      for (let k2 = 0; k2 < 4; k2++) {
        const x = 12 + k2 * 8 + (r() - 0.5) * 3, h = 20 + r() * 26, y = 63 - (k2 % 2);
        ctx.strokeStyle = O; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + (r() - 0.5) * 6, y - h * 0.5, x + (r() - 0.5) * 4, y - h); ctx.stroke();
        ctx.strokeStyle = '#dfeef0'; ctx.lineWidth = 1.8; ctx.stroke();
        const tx = x + (r() - 0.5) * 2, ty = y - h;
        ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(tx, ty, 5.4, 4.2, 0, Math.PI, 0); ctx.lineTo(tx + 5.4, ty + 1); ctx.lineTo(tx - 5.4, ty + 1); ctx.fill();
        const g = ctx.createRadialGradient(tx - 1, ty - 2, 0.5, tx, ty, 5); g.addColorStop(0, '#f0ffff'); g.addColorStop(1, i % 2 ? '#46d8e8' : '#9a6aff');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(tx, ty, 4.4, 3.4, 0, Math.PI, 0); ctx.lineTo(tx + 4.4, ty + 0.4); ctx.lineTo(tx - 4.4, ty + 0.4); ctx.fill();
      }
    });
  };
  M.glowcapColor = (v) => (Math.floor(v * 4) % 4) % 2 ? [70, 216, 232] : [154, 106, 255];
  // Дождевики: круглые белые шары
  M.puffball = function (v) {
    const i = Math.floor(v * 3) % 3;
    return cached('p' + i, 50, 32, 25, 28, (ctx) => {
      const r = rng(i * 53 + 9);
      mossBase(ctx, r, 25, 26, 20, 5);
      [[14, 23, 6], [26, 21, 8.5], [37, 24, 5]].forEach(([x, y, rr]) => {
        ctx.fillStyle = O; ctx.beginPath(); ctx.arc(x, y - rr + 2, rr + 1.3, 0, TAU); ctx.fill();
        const g = ctx.createRadialGradient(x - rr * 0.4, y - rr * 1.3 + 2, 0.5, x, y - rr + 2, rr * 1.1); g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e8e0cc'); g.addColorStop(1, '#b0a488');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - rr + 2, rr, 0, TAU); ctx.fill();
        for (let k2 = 0; k2 < rr * 1.6; k2++) { const a = r() * TAU, d = r() * rr * 0.8; ctx.fillStyle = 'rgba(150,130,100,0.5)'; ctx.fillRect(x + Math.cos(a) * d, y - rr + 2 + Math.sin(a) * d, 0.9, 0.9); }
        if (rr > 7) { ctx.fillStyle = '#8a7a5a'; ctx.beginPath(); ctx.arc(x + 1, y - rr * 1.7 + 2, 1.4, 0, TAU); ctx.fill(); }
      });
    });
  };
  // Пень с грибами-трутовиками
  M.shelfStump = function (v) {
    const i = Math.floor(v * 3) % 3;
    return cached('s' + i, 60, 56, 30, 50, (ctx) => {
      const r = rng(i * 91 + 5);
      mossBase(ctx, r, 30, 48, 24, 6);
      ctx.fillStyle = O; ctx.fillRect(15, 18, 30, 31); ctx.beginPath(); ctx.ellipse(30, 18, 16, 6, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(16, 0, 44, 0); g.addColorStop(0, '#7a5230'); g.addColorStop(0.4, '#5e3c20'); g.addColorStop(1, '#3a2414');
      ctx.fillStyle = g; ctx.fillRect(16.5, 18, 27, 30);
      for (let k2 = 0; k2 < 6; k2++) { ctx.fillStyle = 'rgba(20,10,4,0.35)'; ctx.fillRect(18 + k2 * 4.5, 20 + (k2 % 2) * 4, 1, 24); }
      ctx.fillStyle = '#c8a06a'; ctx.beginPath(); ctx.ellipse(30, 18, 14.5, 5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a6040'; ctx.lineWidth = 0.8; for (let k2 = 1; k2 < 4; k2++) { ctx.beginPath(); ctx.ellipse(30, 18, k2 * 3.4, k2 * 1.2, 0, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(80,140,50,0.8)'; ctx.beginPath(); ctx.ellipse(20, 19, 5, 2, 0, 0, TAU); ctx.fill();
      // трутовики — полукруглые полки
      [[44, 28, 9], [45, 37, 7], [15, 33, 8]].forEach(([x, y, w], k2) => {
        const side = x > 30 ? 1 : -1;
        ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(x + side * w * 0.35, y, w * 0.75 + 1, 4 + 1, 0, 0, TAU); ctx.fill();
        const sg = ctx.createLinearGradient(0, y - 4, 0, y + 4); sg.addColorStop(0, k2 === 1 ? '#f0c060' : '#e89040'); sg.addColorStop(0.6, '#b85a20'); sg.addColorStop(1, '#6a3010');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(x + side * w * 0.35, y, w * 0.75, 4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,230,160,0.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(x + side * w * 0.35, y - 0.5, w * 0.55, 2.4, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      });
    });
  };
  // Поваленное бревно, обросшее мхом и грибами
  M.log = function (v) {
    const i = Math.floor(v * 2) % 2;
    return cached('g' + 'log' + i, 110, 50, 55, 42, (ctx) => {
      const r = rng(i * 17 + 31);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(56, 42, 50, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = O; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(8, 20, 92, 22, 10) : ctx.rect(8, 20, 92, 22); ctx.fill();
      const g = ctx.createLinearGradient(0, 21, 0, 41); g.addColorStop(0, '#8a6240'); g.addColorStop(0.5, '#5e3c22'); g.addColorStop(1, '#3a2414');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(9.5, 21.5, 89, 19, 9) : ctx.rect(9.5, 21.5, 89, 19); ctx.fill();
      for (let k2 = 0; k2 < 14; k2++) { ctx.strokeStyle = 'rgba(20,10,4,0.4)'; ctx.lineWidth = 0.8; const x = 16 + k2 * 6 + (r() - 0.5) * 3; ctx.beginPath(); ctx.moveTo(x, 23); ctx.lineTo(x + 3, 39); ctx.stroke(); }
      // торец
      ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(99, 31, 6, 11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c8a06a'; ctx.beginPath(); ctx.ellipse(99, 31, 4.6, 9.6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a6040'; ctx.lineWidth = 0.7; for (let k2 = 1; k2 < 4; k2++) { ctx.beginPath(); ctx.ellipse(99, 31, k2 * 1.3, k2 * 2.7, 0, 0, TAU); ctx.stroke(); }
      // мох сверху
      for (let k2 = 0; k2 < 60; k2++) { const x = 14 + r() * 80, y = 21 + r() * 5; ctx.fillStyle = r() < 0.5 ? '#5a9a3a' : '#3f7a2a'; ctx.beginPath(); ctx.arc(x, y, 1.2 + r() * 1.6, 0, TAU); ctx.fill(); }
      // грибочки на бревне
      for (let k2 = 0; k2 < 5; k2++) { const x = 20 + k2 * 16 + (r() - 0.5) * 6; stem(ctx, r, x, 23, 3.2, 6 + r() * 5, (r() - 0.5) * 2); cap(ctx, r, x, 23 - 8 - r() * 2, 5.5, 4.6, 'dome', CAPS[(k2 + i) % 4]); }
    });
  };
  // Ведьмин круг: кольцо тёмной травы и грибочков
  M.ring = function (v) {
    const i = Math.floor(v * 2) % 2;
    return cached('r' + i, 128, 76, 64, 38, (ctx) => {
      const r = rng(i * 7 + 99);
      ctx.strokeStyle = 'rgba(20,50,20,0.45)'; ctx.lineWidth = 9; ctx.beginPath(); ctx.ellipse(64, 38, 52, 28, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,190,80,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(64, 38, 52, 28, 0, 0, TAU); ctx.stroke();
      const n = 22;
      const items = [];
      for (let k2 = 0; k2 < n; k2++) { const a = k2 / n * TAU + (r() - 0.5) * 0.15; items.push({ x: 64 + Math.cos(a) * 52, y: 38 + Math.sin(a) * 28, s: 0.7 + r() * 0.5, p: CAPS[k2 % 2 ? 0 : 3] }); }
      items.sort((a, b) => a.y - b.y).forEach(m => { stem(ctx, r, m.x, m.y + 3, 3 * m.s, 7 * m.s, (r() - 0.5) * 2); cap(ctx, r, m.x, m.y + 3 - 7 * m.s, 5.5 * m.s, 4.8 * m.s, 'dome', m.p); });
    });
  };

  // Шляпка грибовика отдельным спрайтом (тело и лицо рисуются живыми)
  M.capSprite = function (pi) {
    return cached('mc' + pi, 44, 34, 22, 26, (ctx) => { const r = rng(pi * 13 + 1); cap(ctx, r, 22, 26, 17, 17, 'dome', pi === 9 ? { cap: '#e0a020', spot: '#fff4c8', gill: '#f0e0b0' } : CAPS[pi % 4]); });
  };
  // ---------- живые эффекты ----------
  M.drawGiant = function (ctx, d, t, night) {
    const sp = M.giant(d.v), s = 0.78 + d.v * 0.42, sway = Math.sin(t * 0.9 + d.x * 0.01) * 0.018;
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(sway); ctx.translate(-d.x, -d.y);
    const w = sp.c.width / K * s, h = sp.c.height / K * s;
    ctx.drawImage(sp.c, d.x - sp.ox / K * s, d.y - sp.oy / K * s, w, h);
    ctx.restore();
    const gl = M.giantGlow(d.v);
    if (gl && night > 0.05) { // пятна на шляпке светятся ночью
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const cy = d.y - (138 - 58) * s, a = (0.34 + Math.sin(t * 1.6 + d.x) * 0.08) * night;
      const g = ctx.createRadialGradient(d.x, cy, 4, d.x, cy, 70 * s); g.addColorStop(0, rgb(gl, a)); g.addColorStop(1, rgb(gl, 0));
      ctx.fillStyle = g; ctx.fillRect(d.x - 70 * s, cy - 70 * s, 140 * s, 140 * s); ctx.restore();
    }
  };
  M.drawSprite = function (ctx, sp, x, y, s) { s = s || 1; AB.blit(ctx, sp.c, x - sp.ox / K * s, y - sp.oy / K * s, sp.c.width / K * s, sp.c.height / K * s, sp.ox / K * s, sp.oy / K * s); };
  M.drawGlowcap = function (ctx, d, t, night) {
    M.drawSprite(ctx, M.glowcap(d.v), d.x, d.y, 1);
    const c = M.glowcapColor(d.v), a = (0.25 + 0.55 * night) * (0.75 + Math.sin(t * 2.3 + d.x) * 0.25);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(d.x, d.y - 30, 2, d.x, d.y - 30, 34); g.addColorStop(0, rgb(c, a * 0.6)); g.addColorStop(1, rgb(c, 0));
    ctx.fillStyle = g; ctx.fillRect(d.x - 34, d.y - 64, 68, 68); ctx.restore();
  };
  // Детали земли на грибной поляне (для запечённой земли): мох, клевер, крошечные грибочки, опавшие шляпки
  M.groundDetail = function (ctx, r, lx, ly, T) {
    for (let k2 = 0; k2 < 3; k2++) { // мох
      const x = lx + r() * T, y = ly + r() * T;
      ctx.fillStyle = r() < 0.5 ? 'rgba(40,90,40,0.55)' : 'rgba(110,170,70,0.5)';
      for (let q = 0; q < 5; q++) { ctx.beginPath(); ctx.arc(x + (r() - 0.5) * 7, y + (r() - 0.5) * 4, 1.2 + r() * 1.6, 0, TAU); ctx.fill(); }
    }
    if (r() < 0.35) { // клевер
      const x = lx + r() * T, y = ly + r() * T;
      ctx.fillStyle = '#4f9a3a'; for (let q = 0; q < 3; q++) { const a = q / 3 * TAU - Math.PI / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 1.8, y + Math.sin(a) * 1.8, 1.6, 0, TAU); ctx.fill(); }
    }
    if (r() < 0.3) { // крошечный гриб
      const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T), col = ['#d23a2c', '#7a4ad8', '#d88a2a', '#f0ece0'][Math.floor(r() * 4)];
      ctx.fillStyle = '#150c0a'; ctx.fillRect(x - 0.5, y - 3.5, 2, 4.5); ctx.fillStyle = '#efe4c8'; ctx.fillRect(x, y - 3, 1, 3.5);
      ctx.fillStyle = '#150c0a'; ctx.beginPath(); ctx.ellipse(x + 0.5, y - 3.5, 3.4, 2.4, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x + 0.5, y - 3.6, 2.6, 1.8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x - 0.5, y - 4.6, 1, 1);
    }
    if (r() < 0.2) { // опавшая шляпка / листок
      const x = lx + r() * T, y = ly + r() * T;
      ctx.fillStyle = r() < 0.5 ? 'rgba(200,90,60,0.6)' : 'rgba(160,120,60,0.6)'; ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.4, r() * 3, 0, TAU); ctx.fill();
    }
  };
})(window.AB);
