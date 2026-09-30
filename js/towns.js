// Поселения сторон света: постройки рисуются один раз в 2× разрешении и кешируются.
// Север — избы под снегом, восток — вигвамы, юг — дома на деревьях, запад — каменный город.
(function (AB) {
  const T = AB.Towns = {};
  const TAU = Math.PI * 2, K = 2, O = '#140c08';
  const cache = {};
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function sprite(key, w, h, ox, oy, draw) {
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas'); c.width = w * K; c.height = h * K;
    const ctx = c.getContext('2d'); ctx.scale(K, K); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    draw(ctx, rng(key.length * 97 + w * 13 + h));
    return (cache[key] = { c, ox, oy, w, h });
  }
  const ell = (ctx, x, y, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };
  const poly = (ctx, pts, col, stroke) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); if (col) { ctx.fillStyle = col; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); } };
  const lin = (ctx, x0, y0, x1, y1, a, b) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  function logWall(ctx, x, y, w, h, r) { // бревенчатая стена
    ctx.fillStyle = O; ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    const n = Math.round(h / 7);
    for (let i = 0; i < n; i++) {
      const yy = y + i * (h / n), hh = h / n;
      ctx.fillStyle = lin(ctx, 0, yy, 0, yy + hh, '#9a6a3e', '#5e3c20'); ctx.fillRect(x, yy, w, hh - 0.6);
      ctx.fillStyle = 'rgba(255,230,180,0.18)'; ctx.fillRect(x, yy + 0.8, w, 1);
      ell(ctx, x, yy + hh / 2, 3.2, hh / 2 - 0.2, O); ell(ctx, x, yy + hh / 2, 2.4, hh / 2 - 1, '#c8a06a');
      ell(ctx, x + w, yy + hh / 2, 3.2, hh / 2 - 0.2, O); ell(ctx, x + w, yy + hh / 2, 2.4, hh / 2 - 1, '#c8a06a');
      for (let k = 0; k < 3; k++) { ctx.fillStyle = 'rgba(40,20,10,0.35)'; ctx.fillRect(x + 6 + r() * (w - 12), yy + 2 + r() * (hh - 4), 4, 1); }
    }
  }
  function windowLit(ctx, x, y, w, h, warm) {
    ctx.fillStyle = O; ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = warm ? lin(ctx, x, y, x, y + h, '#ffe9a0', '#ffb040') : '#2a3a4a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = O; ctx.fillRect(x + w / 2 - 0.7, y, 1.4, h); ctx.fillRect(x, y + h / 2 - 0.7, w, 1.4);
  }

  const S = {
    // Изба под снегом
    izba: () => sprite('izba', 130, 120, 65, 108, (ctx, r) => {
      ell(ctx, 65, 108, 58, 10, 'rgba(0,0,0,0.3)');
      logWall(ctx, 18, 56, 94, 50, r);
      // крыльцо и дверь
      ctx.fillStyle = O; ctx.fillRect(55, 74, 22, 33); ctx.fillStyle = lin(ctx, 56, 0, 76, 0, '#6b4424', '#4a2e18'); ctx.fillRect(56.5, 75.5, 19, 31);
      ctx.fillStyle = '#d8b050'; ctx.beginPath(); ctx.arc(72, 91, 1.4, 0, TAU); ctx.fill();
      windowLit(ctx, 26, 70, 16, 14, true); windowLit(ctx, 88, 70, 16, 14, true);
      // резные наличники
      for (const wx of [26, 88]) { ctx.fillStyle = '#e8d8b8'; ctx.beginPath(); ctx.moveTo(wx - 3, 68); ctx.lineTo(wx + 8, 62); ctx.lineTo(wx + 19, 68); ctx.fill(); ctx.fillRect(wx - 3, 85, 22, 2); }
      // крыша
      poly(ctx, [[8, 60], [65, 16], [122, 60]], O);
      poly(ctx, [[12, 58], [65, 19], [118, 58]], lin(ctx, 0, 20, 0, 60, '#6a4a30', '#3a2616'));
      for (let i = 0; i < 8; i++) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(65, 19); ctx.lineTo(14 + i * 14.5, 58); ctx.stroke(); }
      // снег на крыше с сосульками
      poly(ctx, [[10, 56], [65, 14], [120, 56], [112, 52], [100, 56], [88, 49], [72, 50], [58, 46], [44, 51], [30, 48], [20, 54]], '#f4f8fc');
      poly(ctx, [[65, 14], [120, 56], [112, 52], [100, 56], [88, 49], [72, 50]], '#cfe0ee');
      for (let i = 0; i < 10; i++) { const x = 16 + i * 10 + r() * 4, l = 3 + r() * 6; poly(ctx, [[x - 1.6, 57], [x, 57 + l], [x + 1.6, 57]], '#e8f4ff'); }
      // труба с дымком
      ctx.fillStyle = O; ctx.fillRect(86, 20, 12, 22); ctx.fillStyle = '#8a5a4a'; ctx.fillRect(87.5, 21.5, 9, 19); ctx.fillStyle = '#f4f8fc'; ctx.fillRect(85, 18, 14, 4);
      // сугроб у стены
      ell(ctx, 30, 107, 22, 5, '#e8f0f8'); ell(ctx, 104, 107, 18, 4, '#e8f0f8');
    }),
    well: () => sprite('well', 50, 60, 25, 52, (ctx) => {
      ell(ctx, 25, 52, 20, 6, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = O; ctx.fillRect(7, 30, 36, 22); ctx.fillStyle = lin(ctx, 8, 0, 42, 0, '#8a857a', '#5a564c'); ctx.fillRect(8.5, 31.5, 33, 19);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8; ctx.strokeRect(8.5 + i * 8.3 + (j % 2) * 4, 31.5 + j * 6.3, 8.3, 6.3); }
      ell(ctx, 25, 31, 18, 5, O); ell(ctx, 25, 31, 16, 4, '#1a2a3a');
      ctx.fillStyle = O; ctx.fillRect(8, 6, 3, 26); ctx.fillRect(39, 6, 3, 26); ctx.fillStyle = '#6b4a2e'; ctx.fillRect(8.8, 7, 1.4, 24); ctx.fillRect(39.8, 7, 1.4, 24);
      poly(ctx, [[3, 10], [25, -1], [47, 10]], O); poly(ctx, [[5, 9], [25, 1], [45, 9]], '#5a3a22'); poly(ctx, [[5, 8], [25, 0], [45, 8], [36, 6], [25, 4], [14, 6]], '#f4f8fc');
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, 10); ctx.lineTo(25, 22); ctx.stroke(); ctx.fillStyle = '#6b4424'; ctx.fillRect(22, 22, 6, 5);
    }),
    woodpile: () => sprite('woodpile', 60, 40, 30, 34, (ctx) => {
      ell(ctx, 30, 34, 26, 5, 'rgba(0,0,0,0.3)');
      for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) { const x = 10 + row * 4.5 + i * 9, y = 30 - row * 8; ell(ctx, x, y, 5, 4.4, O); ell(ctx, x, y, 4, 3.4, '#c8a06a'); ell(ctx, x, y, 1.4, 1.2, '#8a6040'); }
      poly(ctx, [[6, 12], [30, 5], [54, 12], [48, 14], [30, 9], [12, 14]], '#f4f8fc');
    }),
    sled: () => sprite('sled', 60, 30, 30, 24, (ctx) => {
      ell(ctx, 30, 24, 26, 4, 'rgba(0,0,0,0.25)');
      ctx.strokeStyle = O; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(4, 22); ctx.lineTo(50, 22); ctx.quadraticCurveTo(58, 22, 56, 14); ctx.stroke();
      ctx.strokeStyle = '#8a949e'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = O; ctx.fillRect(8, 11, 42, 8); ctx.fillStyle = '#b8483a'; ctx.fillRect(9, 12, 40, 6);
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(14, 4, 26, 8); ctx.fillStyle = '#9a7a4a'; ctx.fillRect(15, 5, 24, 3);
    }),
    snowman: () => sprite('snowman', 40, 60, 20, 54, (ctx) => {
      ell(ctx, 20, 54, 14, 4, 'rgba(0,0,0,0.25)');
      for (const [y, rr] of [[44, 12], [27, 9], [14, 7]]) { ell(ctx, 20, y, rr + 1.3, rr + 1.3, '#5a7088'); ell(ctx, 20, y, rr, rr, '#f4f8fc'); ell(ctx, 17, y - rr * 0.4, rr * 0.4, rr * 0.3, '#ffffff'); }
      ctx.fillStyle = O; ctx.fillRect(17, 12, 2, 2); ctx.fillRect(22, 12, 2, 2); for (const y of [25, 30]) ctx.fillRect(19.2, y, 1.6, 1.6);
      poly(ctx, [[20, 15], [28, 16.5], [20, 17.5]], '#e0701a');
      ctx.fillStyle = '#c83a2a'; ctx.fillRect(12, 20, 16, 3.4); ctx.fillRect(24, 20, 3.4, 9);
      ctx.fillStyle = O; ctx.fillRect(13, 2, 14, 6); ctx.fillRect(10, 7, 20, 2);
      ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(11, 27); ctx.lineTo(2, 20); ctx.moveTo(29, 27); ctx.lineTo(38, 22); ctx.stroke();
    }),
    // Вигвам с росписью
    tipi: (v) => sprite('tipi' + (v > 0.5 ? 1 : 0), 90, 110, 45, 100, (ctx, r) => {
      const pal = v > 0.5 ? ['#e0c89a', '#b8483a', '#3a6a8a'] : ['#d8b888', '#3a7a5a', '#c87a2a'];
      ell(ctx, 45, 100, 40, 8, 'rgba(0,0,0,0.3)');
      ctx.strokeStyle = O; ctx.lineWidth = 3.4; for (const dx of [-8, 0, 7]) { ctx.beginPath(); ctx.moveTo(45 + dx * 0.4, 18); ctx.lineTo(45 + dx * 1.8, 2); ctx.stroke(); }
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 1.8; for (const dx of [-8, 0, 7]) { ctx.beginPath(); ctx.moveTo(45 + dx * 0.4, 18); ctx.lineTo(45 + dx * 1.8, 2); ctx.stroke(); }
      poly(ctx, [[45, 12], [6, 100], [84, 100]], O);
      poly(ctx, [[45, 15], [9, 98], [81, 98]], lin(ctx, 9, 0, 81, 0, pal[0], '#9a7a52'));
      // швы и полосы
      ctx.strokeStyle = 'rgba(80,50,30,0.45)'; ctx.lineWidth = 0.8; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(45, 15); ctx.lineTo(45 + i * 11, 98); ctx.stroke(); }
      ctx.save(); poly(ctx, [[45, 15], [9, 98], [81, 98]]); ctx.clip();
      ctx.fillStyle = pal[1]; ctx.fillRect(0, 70, 90, 6); ctx.fillStyle = pal[2]; ctx.fillRect(0, 78, 90, 3);
      for (let i = 0; i < 8; i++) poly(ctx, [[10 + i * 10, 70], [15 + i * 10, 62], [20 + i * 10, 70]], pal[1]);
      ctx.fillStyle = pal[2]; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(18 + i * 11, 88, 2.2, 0, TAU); ctx.fill(); }
      // солнце-символ
      ctx.fillStyle = pal[1]; ctx.beginPath(); ctx.arc(45, 44, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = pal[1]; ctx.lineWidth = 1.4; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(45 + Math.cos(a) * 8, 44 + Math.sin(a) * 8); ctx.lineTo(45 + Math.cos(a) * 11, 44 + Math.sin(a) * 11); ctx.stroke(); }
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; poly(ctx, [[45, 15], [81, 98], [58, 98]]);
      ctx.restore();
      // вход
      poly(ctx, [[45, 62], [33, 98], [57, 98]], O); poly(ctx, [[45, 66], [36, 98], [54, 98]], '#2a1a10');
      poly(ctx, [[45, 66], [36, 98], [41, 98]], pal[0]);
    }),
    rack: () => sprite('rack', 70, 60, 35, 52, (ctx) => {
      ell(ctx, 35, 52, 30, 5, 'rgba(0,0,0,0.25)');
      ctx.strokeStyle = O; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(8, 52); ctx.lineTo(12, 8); ctx.moveTo(62, 52); ctx.lineTo(58, 8); ctx.moveTo(8, 12); ctx.lineTo(62, 12); ctx.stroke();
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 2.2; ctx.stroke();
      for (let i = 0; i < 3; i++) { const x = 16 + i * 16; poly(ctx, [[x, 13], [x + 12, 13], [x + 13, 30], [x + 9, 38], [x + 3, 38], [x - 1, 30]], O); poly(ctx, [[x + 1, 14.5], [x + 11, 14.5], [x + 11.6, 30], [x + 8.4, 36.5], [x + 3.6, 36.5], [x + 0.4, 30]], i % 2 ? '#c08d4e' : '#a8763e'); }
    }),
    totemT: () => sprite('totemT', 40, 100, 20, 94, (ctx) => {
      ell(ctx, 20, 94, 14, 4, 'rgba(0,0,0,0.3)');
      const cols = [['#b8483a', '#ffd24a'], ['#3a6a8a', '#f0e0c0'], ['#3a7a5a', '#ffd24a']];
      for (let i = 0; i < 3; i++) {
        const y = 62 - i * 26; ctx.fillStyle = O; ctx.fillRect(7, y, 26, 28); ctx.fillStyle = cols[i][0]; ctx.fillRect(8.5, y + 1.5, 23, 25);
        ctx.fillStyle = cols[i][1]; ctx.fillRect(11, y + 7, 6, 4); ctx.fillRect(23, y + 7, 6, 4); ctx.fillStyle = O; ctx.fillRect(13, y + 8, 2, 2); ctx.fillRect(25, y + 8, 2, 2);
        ctx.fillStyle = cols[i][1]; ctx.fillRect(14, y + 17, 12, 3 + (i % 2) * 3);
      }
      poly(ctx, [[2, 14], [20, 8], [38, 14], [30, 18], [20, 14], [10, 18]], '#ffd24a', O);
    }),
    drum: () => sprite('drum', 40, 36, 20, 30, (ctx) => {
      ell(ctx, 20, 30, 16, 4, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = O; ctx.fillRect(6, 10, 28, 20); ctx.fillStyle = lin(ctx, 7, 0, 33, 0, '#b8763e', '#6b4424'); ctx.fillRect(7, 11, 26, 18);
      ctx.strokeStyle = '#e0c89a'; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(7 + i * 5, 11); ctx.lineTo(9.5 + i * 5, 29); ctx.stroke(); }
      ell(ctx, 20, 10, 14, 4, O); ell(ctx, 20, 10, 12.6, 3, '#e8d8b0');
    }),
    // Дом на дереве: толстый ствол, помост, хижина, верёвочная лестница
    treehouse: (v) => sprite('treehouse', 130, 170, 65, 160, (ctx, r) => {
      ell(ctx, 65, 160, 48, 9, 'rgba(0,0,0,0.35)');
      // корни и ствол
      ctx.fillStyle = O; poly(ctx, [[40, 162], [52, 120], [52, 60], [78, 60], [78, 120], [92, 162]], O);
      poly(ctx, [[43, 160], [54, 120], [54, 62], [76, 62], [76, 120], [89, 160]], lin(ctx, 50, 0, 80, 0, '#6b4a2e', '#3a2616'));
      for (let i = 0; i < 5; i++) { ctx.strokeStyle = 'rgba(20,10,4,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(57 + i * 4, 64); ctx.lineTo(56 + i * 5, 158); ctx.stroke(); }
      // лиана
      ctx.strokeStyle = '#3a6a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(54, 70); ctx.bezierCurveTo(70, 90, 50, 110, 72, 140); ctx.stroke();
      for (let i = 0; i < 6; i++) ell(ctx, 56 + (i % 2) * 12, 78 + i * 11, 3, 1.8, '#5a9a3a');
      // помост
      ctx.fillStyle = O; ctx.fillRect(14, 58, 102, 9); ctx.fillStyle = '#8a6a44'; ctx.fillRect(15, 59, 100, 6); for (let i = 0; i < 12; i++) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(15 + i * 8.5, 59, 1, 6); }
      ctx.strokeStyle = O; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(22, 67); ctx.lineTo(56, 90); ctx.moveTo(108, 67); ctx.lineTo(76, 90); ctx.stroke();
      // перила
      ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(16, 50); ctx.lineTo(114, 50); ctx.stroke(); for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(18 + i * 13.5, 50); ctx.lineTo(18 + i * 13.5, 58); ctx.stroke(); }
      // хижина
      ctx.fillStyle = O; ctx.fillRect(34, 24, 62, 36); ctx.fillStyle = lin(ctx, 0, 25, 0, 58, '#a8804a', '#6b4a2e'); ctx.fillRect(35.5, 25.5, 59, 33);
      for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(36 + i * 7.5, 26, 1, 32); }
      windowLit(ctx, 44, 34, 12, 11, true); ctx.fillStyle = O; ctx.fillRect(70, 36, 16, 23); ctx.fillStyle = '#3a2414'; ctx.fillRect(71.5, 37.5, 13, 21);
      // соломенная крыша
      poly(ctx, [[24, 28], [65, 2], [106, 28], [96, 32], [34, 32]], O);
      poly(ctx, [[27, 27], [65, 5], [103, 27], [95, 30], [35, 30]], lin(ctx, 0, 5, 0, 30, '#d8b860', '#9a7a30'));
      ctx.strokeStyle = 'rgba(90,60,20,0.5)'; ctx.lineWidth = 0.8; for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.moveTo(65, 6); ctx.lineTo(30 + i * 4.5, 30); ctx.stroke(); }
      // листва вокруг
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, x = 65 + Math.cos(a) * 56, y = 36 + Math.sin(a) * 18; if (y > 44 && Math.abs(x - 65) < 30) continue; ell(ctx, x, y, 14, 10, '#10200f'); ell(ctx, x, y, 12.5, 8.5, i % 2 ? '#356b32' : '#4f8a3a'); ell(ctx, x - 3, y - 3, 6, 4, '#6fa84a'); }
      // верёвочная лестница
      ctx.strokeStyle = '#c8a878'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(84, 66); ctx.lineTo(86, 158); ctx.moveTo(94, 66); ctx.lineTo(96, 158); ctx.stroke();
      for (let i = 0; i < 11; i++) { ctx.beginPath(); ctx.moveTo(84.2 + i * 0.2, 72 + i * 8); ctx.lineTo(94.2 + i * 0.2, 72 + i * 8); ctx.stroke(); }
    }),
    stilthut: () => sprite('stilthut', 100, 110, 50, 100, (ctx) => {
      ell(ctx, 50, 100, 42, 7, 'rgba(0,0,0,0.3)');
      ctx.strokeStyle = O; ctx.lineWidth = 5; for (const x of [18, 38, 62, 82]) { ctx.beginPath(); ctx.moveTo(x, 58); ctx.lineTo(x, 100); ctx.stroke(); }
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 3; for (const x of [18, 38, 62, 82]) { ctx.beginPath(); ctx.moveTo(x, 58); ctx.lineTo(x, 100); ctx.stroke(); }
      ell(ctx, 50, 98, 44, 4, 'rgba(40,60,40,0.5)');
      ctx.fillStyle = O; ctx.fillRect(8, 52, 84, 8); ctx.fillStyle = '#8a6a44'; ctx.fillRect(9, 53, 82, 5);
      ctx.fillStyle = O; ctx.fillRect(18, 26, 64, 28); ctx.fillStyle = lin(ctx, 0, 26, 0, 54, '#7a8a4a', '#4a5a2a'); ctx.fillRect(19.5, 27.5, 61, 25);
      for (let i = 0; i < 12; i++) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(20 + i * 5, 28, 1, 24); }
      windowLit(ctx, 28, 34, 11, 10, true); ctx.fillStyle = O; ctx.fillRect(56, 35, 14, 18); ctx.fillStyle = '#2a1a10'; ctx.fillRect(57.5, 36.5, 11, 16);
      poly(ctx, [[8, 30], [50, 4], [92, 30]], O); poly(ctx, [[11, 29], [50, 7], [89, 29]], lin(ctx, 0, 7, 0, 29, '#b89850', '#7a6030'));
      ctx.strokeStyle = 'rgba(70,50,20,0.5)'; ctx.lineWidth = 0.8; for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo(50, 8); ctx.lineTo(13 + i * 5.5, 29); ctx.stroke(); }
    }),
    lanterns: () => sprite('lanterns', 110, 50, 55, 44, (ctx) => {
      ctx.strokeStyle = O; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 44); ctx.lineTo(6, 6); ctx.moveTo(104, 44); ctx.lineTo(104, 6); ctx.stroke();
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, 8); ctx.quadraticCurveTo(55, 26, 104, 8); ctx.stroke();
      const cols = ['#ffb040', '#ff7a5a', '#ffd24a', '#7ae0a0', '#ff9ad0'];
      for (let i = 0; i < 5; i++) { const t = (i + 1) / 6, x = 6 + 98 * t, y = 8 + Math.sin(t * Math.PI) * 16; ell(ctx, x, y + 5, 4.4, 5.4, O); ell(ctx, x, y + 5, 3.4, 4.4, cols[i]); ell(ctx, x - 1, y + 3.6, 1.2, 1.6, '#fff6d0'); }
    }),
    // Каменный дом с черепичной крышей
    stonehouse: (v) => sprite('stonehouse' + (v > 0.5 ? 1 : 0), 130, 130, 65, 118, (ctx, r) => {
      const roof = v > 0.5 ? ['#b84a32', '#7a2a1a'] : ['#5a6a8a', '#343e56'];
      ell(ctx, 65, 118, 58, 10, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = O; ctx.fillRect(14, 54, 102, 64);
      ctx.fillStyle = lin(ctx, 15, 0, 115, 0, '#b8b0a0', '#7a7466'); ctx.fillRect(15.5, 55.5, 99, 61);
      for (let row = 0; row < 8; row++) for (let i = 0; i < 7; i++) { const x = 15.5 + i * 15 + (row % 2) * 7.5 - 7.5, y = 55.5 + row * 7.6; ctx.strokeStyle = 'rgba(40,36,30,0.45)'; ctx.lineWidth = 0.9; ctx.strokeRect(Math.max(15.5, x), y, 15, 7.6); if (r() < 0.25) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(Math.max(16, x + 1), y + 1, 13, 2); } }
      // дверь аркой
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(53, 118); ctx.lineTo(53, 90); ctx.arc(65, 90, 12, Math.PI, 0); ctx.lineTo(77, 118); ctx.fill();
      ctx.fillStyle = lin(ctx, 55, 0, 75, 0, '#7a4a2a', '#4a2a14'); ctx.beginPath(); ctx.moveTo(55.5, 117); ctx.lineTo(55.5, 90); ctx.arc(65, 90, 9.5, Math.PI, 0); ctx.lineTo(74.5, 117); ctx.fill();
      ctx.fillStyle = '#d8b050'; ctx.beginPath(); ctx.arc(71, 104, 1.4, 0, TAU); ctx.fill();
      windowLit(ctx, 24, 70, 16, 18, true); windowLit(ctx, 90, 70, 16, 18, true);
      ctx.fillStyle = '#8a3a2a'; ctx.fillRect(22, 88, 20, 4); ctx.fillRect(88, 88, 20, 4); for (let i = 0; i < 4; i++) { ell(ctx, 25 + i * 5, 87, 2, 2, i % 2 ? '#ff6a8a' : '#ffd24a'); ell(ctx, 91 + i * 5, 87, 2, 2, i % 2 ? '#ff6a8a' : '#ffd24a'); }
      // черепица
      poly(ctx, [[4, 58], [65, 12], [126, 58]], O);
      poly(ctx, [[8, 56], [65, 15], [122, 56]], roof[0]);
      ctx.save(); poly(ctx, [[8, 56], [65, 15], [122, 56]]); ctx.clip();
      for (let row = 0; row < 9; row++) for (let i = 0; i < 20; i++) { const y = 18 + row * 4.6, x = i * 7 + (row % 2) * 3.5; ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(x, y + 4, 3.5, 0, Math.PI); ctx.fill(); ctx.fillStyle = 'rgba(255,220,200,0.12)'; ctx.fillRect(x - 2, y + 1, 3, 1); }
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; poly(ctx, [[65, 15], [122, 56], [82, 56]]);
      ctx.restore();
      ctx.fillStyle = O; ctx.fillRect(92, 18, 12, 24); ctx.fillStyle = '#8a857a'; ctx.fillRect(93.5, 19.5, 9, 21); ctx.fillStyle = roof[1]; ctx.fillRect(91, 16, 14, 4);
    }),
    stonetower: () => sprite('stonetower', 70, 150, 35, 142, (ctx, r) => {
      ell(ctx, 35, 142, 30, 7, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = O; ctx.fillRect(9, 40, 52, 102); ctx.fillStyle = lin(ctx, 10, 0, 60, 0, '#c0b8a8', '#7a7466'); ctx.fillRect(10.5, 41.5, 49, 99);
      for (let row = 0; row < 13; row++) for (let i = 0; i < 4; i++) { ctx.strokeStyle = 'rgba(40,36,30,0.45)'; ctx.lineWidth = 0.9; ctx.strokeRect(10.5 + i * 12.3 + (row % 2) * 6 - 6, 41.5 + row * 7.6, 12.3, 7.6); }
      ctx.fillStyle = O; for (let i = 0; i < 5; i++) ctx.fillRect(6 + i * 12, 28, 9, 14); ctx.fillStyle = '#a8a092'; for (let i = 0; i < 5; i++) ctx.fillRect(7.5 + i * 12, 29.5, 6, 11);
      ctx.fillStyle = O; ctx.fillRect(4, 38, 62, 5); ctx.fillStyle = '#8a857a'; ctx.fillRect(5, 39, 60, 3);
      windowLit(ctx, 29, 60, 12, 16, true); windowLit(ctx, 29, 96, 12, 16, false);
      ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(35, 28); ctx.lineTo(35, 4); ctx.stroke();
      poly(ctx, [[36, 5], [56, 10], [36, 16]], '#c83a2a', O);
    }),
    fountain: () => sprite('fountain', 80, 70, 40, 58, (ctx) => {
      ell(ctx, 40, 58, 36, 9, 'rgba(0,0,0,0.3)');
      ell(ctx, 40, 50, 34, 11, O); ell(ctx, 40, 50, 32, 9.5, '#8a857a'); ell(ctx, 40, 48, 28, 7.5, '#3a7aa0'); ell(ctx, 36, 46, 12, 3, 'rgba(200,240,255,0.5)');
      ctx.fillStyle = O; ctx.fillRect(35, 20, 10, 30); ctx.fillStyle = '#a8a092'; ctx.fillRect(36.5, 21.5, 7, 27);
      ell(ctx, 40, 22, 14, 5, O); ell(ctx, 40, 22, 12.5, 4, '#a8a092'); ell(ctx, 40, 21, 10, 3, '#5aa0c8');
      ctx.strokeStyle = 'rgba(200,240,255,0.8)'; ctx.lineWidth = 1.4; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(40, 14); ctx.quadraticCurveTo(40 + s * 10, 4, 40 + s * 16, 20); ctx.stroke(); }
      ell(ctx, 40, 13, 2.4, 3, '#dff4ff');
    }),
    stall: () => sprite('stall', 90, 80, 45, 72, (ctx) => {
      ell(ctx, 45, 72, 40, 6, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = O; ctx.fillRect(10, 20, 4, 52); ctx.fillRect(76, 20, 4, 52);
      ctx.fillStyle = O; ctx.fillRect(6, 44, 78, 26); ctx.fillStyle = lin(ctx, 0, 45, 0, 69, '#a8804a', '#6b4a2e'); ctx.fillRect(7.5, 45.5, 75, 23);
      for (let i = 0; i < 6; i++) { const x = 14 + i * 11; ell(ctx, x, 44, 4.4, 3.4, ['#d8563e', '#f2d36b', '#8fd14a', '#e0701a', '#b88ae0', '#d8563e'][i]); }
      // полосатый навес
      poly(ctx, [[2, 24], [45, 8], [88, 24], [84, 30], [6, 30]], O);
      ctx.save(); poly(ctx, [[4, 24], [45, 10], [86, 24], [83, 28], [7, 28]]); ctx.clip();
      for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#f4ece0' : '#c83a2a'; poly(ctx, [[45, 10], [i * 9, 30], [i * 9 + 9, 30]]); }
      ctx.restore();
      for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#f4ece0' : '#c83a2a'; ctx.beginPath(); ctx.arc(9 + i * 9, 29, 4.5, 0, Math.PI); ctx.fill(); }
    }),
  };
  // Отрезок городской стены: зубцы, каменная кладка
  S.wallseg = () => sprite('wallseg', 60, 60, 30, 52, (ctx, r) => {
    ell(ctx, 30, 52, 28, 6, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = O; ctx.fillRect(3, 16, 54, 37); ctx.fillStyle = lin(ctx, 0, 17, 0, 52, '#b8b0a0', '#7a7466'); ctx.fillRect(4.5, 17.5, 51, 34);
    for (let row = 0; row < 5; row++) for (let i = 0; i < 5; i++) { ctx.strokeStyle = 'rgba(40,36,30,0.5)'; ctx.lineWidth = 0.9; ctx.strokeRect(4.5 + i * 10.2 + (row % 2) * 5 - 5, 17.5 + row * 6.8, 10.2, 6.8); }
    ctx.fillStyle = O; for (let i = 0; i < 4; i++) ctx.fillRect(3 + i * 15, 6, 10, 12); ctx.fillStyle = '#a8a092'; for (let i = 0; i < 4; i++) ctx.fillRect(4.5 + i * 15, 7.5, 7, 9);
    ctx.fillStyle = 'rgba(80,120,50,0.6)'; for (let i = 0; i < 6; i++) ell(ctx, 8 + r() * 44, 48 + r() * 4, 3, 1.6, 'rgba(80,120,50,0.6)');
  });
  T.has = (kind) => !!S[kind];
  T.draw = function (ctx, d) {
    const sp = S[d.kind](d.v || 0);
    AB.blit(ctx, sp.c, d.x - sp.ox, d.y - sp.oy, sp.w, sp.h, sp.ox, sp.oy);
  };
  // Плоские детали: мостки
  T.drawFlat = function (ctx, d) {
    if (d.kind !== 'boardwalk') return false;
    for (let i = 0; i < 14; i++) {
      const x = d.x - 90 + i * 13;
      ctx.fillStyle = '#140c08'; ctx.fillRect(x - 0.5, d.y - 10.5, 12, 21); ctx.fillStyle = i % 2 ? '#9a7a4a' : '#8a6a3e'; ctx.fillRect(x, d.y - 10, 11, 20);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 2, d.y - 8, 1, 16);
    }
    return true;
  };
  // что светится ночью: [смещение по высоте, радиус, сила]
  T.LIGHT = { izba: [-40, 110, 0.55], treehouse: [-110, 100, 0.5], stilthut: [-60, 80, 0.45], stonehouse: [-45, 110, 0.55], stonetower: [-80, 90, 0.4], lanterns: [-20, 120, 0.6], stall: [-30, 70, 0.35] };
  // за чем может спрятаться монстр
  T.OCC = { izba: [60, 100], tipi: [40, 96], treehouse: [60, 160], stilthut: [46, 100], stonehouse: [60, 118], stonetower: [30, 140], wallseg: [28, 46], stall: [42, 70], fountain: [34, 50], totemT: [16, 90] };
})(window.AB);
