// Прорисовка зданий в стиле концепта: доски с тёмным контуром, сланцевые крыши, тёплые окна.
// Статичная часть каждого здания рисуется один раз в кэш (в 2× для чёткости),
// а анимированные детали (огонь, пила, экраны, флаги) — в render.js поверх.
(function (AB) {
  const B = AB.Bld = {};
  const TAU = Math.PI * 2;
  const K = 2;               // масштаб кэша
  const O = '#16100b';       // контур
  const cache = {};

  /* ============================ ИНСТРУМЕНТЫ ============================ */
  const WOOD = { base: '#8a5a32', light: '#a8743f', dark: '#6b4428', deep: '#442a17', hi: '#c08a52' };
  const WOOD_OLD = { base: '#7a5234', light: '#946a42', dark: '#5c3c24', deep: '#3c2616', hi: '#ae8458' };
  const WOOD_SHADE = { base: '#5e3e24', light: '#6e4a2c', dark: '#4a301c', deep: '#301e10', hi: '#80583a' };
  const SLATE = ['#3d5074', '#35466a', '#44587e', '#2f3e5e', '#4a6088'];
  const SHINGLE = ['#7a4e2c', '#6a4226', '#865a34', '#5e3a20', '#946438'];
  const STONE = ['#8e8778', '#a09888', '#7e786c', '#b0a898'];

  function R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function box(ctx, x, y, w, h, c, ol) { ol = ol === undefined ? 1.2 : ol; R(ctx, x - ol, y - ol, w + ol * 2, h + ol * 2, O); R(ctx, x, y, w, h, c); }
  function path(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
  function poly(ctx, pts, c) { path(ctx, pts); ctx.fillStyle = c; ctx.fill(); }
  function polyO(ctx, pts, c, lw) { path(ctx, pts); ctx.fillStyle = c; ctx.fill(); ctx.lineJoin = 'round'; ctx.strokeStyle = O; ctx.lineWidth = lw || 2.2; ctx.stroke(); }
  function ell(ctx, x, y, rx, ry, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); ctx.fill(); }
  function circ(ctx, x, y, r, c) { ell(ctx, x, y, r, r, c); }
  function line(ctx, x1, y1, x2, y2, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  B.tools = { R, box, poly, polyO, ell, circ, line };

  // Стена из вертикальных досок
  function planksV(ctx, x, y, w, h, pal, rng, bw) {
    bw = bw || 5;
    box(ctx, x, y, w, h, pal.dark, 1.3);
    for (let bx = x, i = 0; bx < x + w - 0.1; bx += bw, i++) {
      const ww = Math.min(bw, x + w - bx);
      const r = rng();
      R(ctx, bx, y, ww, h, r < 0.33 ? pal.base : r < 0.66 ? pal.light : pal.dark);
      R(ctx, bx, y, 0.9, h, 'rgba(0,0,0,0.35)');
      R(ctx, bx + 1, y, Math.max(0.5, ww - 1.6), 1, 'rgba(255,255,255,0.14)');
      if (rng() < 0.35) ell(ctx, bx + ww / 2, y + 3 + rng() * (h - 6), 0.9, 1.4, pal.deep);
      R(ctx, bx + ww / 2 - 0.5, y + 1.5, 1, 1, '#2a2420');
      R(ctx, bx + ww / 2 - 0.5, y + h - 2.5, 1, 1, '#2a2420');
    }
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    R(ctx, x, y, w, h, g);
  }
  // Стена из горизонтальных досок
  function planksH(ctx, x, y, w, h, pal, rng, bh) {
    bh = bh || 4;
    box(ctx, x, y, w, h, pal.dark, 1.3);
    for (let by = y; by < y + h - 0.1; by += bh) {
      const hh = Math.min(bh, y + h - by);
      let bx = x;
      while (bx < x + w - 0.1) {
        const len = Math.min(x + w - bx, 12 + rng() * 22);
        const r = rng();
        R(ctx, bx, by, len, hh, r < 0.33 ? pal.base : r < 0.66 ? pal.light : pal.dark);
        R(ctx, bx, by, len, 0.8, 'rgba(255,255,255,0.12)');
        R(ctx, bx + len - 0.8, by, 0.8, hh, 'rgba(0,0,0,0.3)');
        bx += len;
      }
      R(ctx, x, by + hh - 0.8, w, 0.8, 'rgba(0,0,0,0.35)');
    }
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0.2)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    R(ctx, x, y, w, h, g);
  }
  // Черепичная (сланцевая или деревянная) крыша, вписанная в многоугольник
  function roof(ctx, pts, rng, pal, rowH, tileW) {
    rowH = rowH || 5; tileW = tileW || 7;
    const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
    const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
    ctx.save(); path(ctx, pts); ctx.clip();
    R(ctx, x0, y0, x1 - x0, y1 - y0, pal[3]);
    for (let y = y0, row = 0; y < y1; y += rowH, row++) {
      for (let x = x0 - (row % 2 ? tileW / 2 : 0); x < x1; x += tileW) {
        const c = pick(rng, pal);
        R(ctx, x + 0.4, y, tileW - 0.8, rowH, c);
        R(ctx, x + 0.4, y, tileW - 0.8, 0.9, 'rgba(255,255,255,0.13)');
        R(ctx, x + 0.4, y + rowH - 1.1, tileW - 0.8, 1.1, 'rgba(0,0,0,0.38)');
        R(ctx, x, y, 0.6, rowH, 'rgba(0,0,0,0.3)');
        if (rng() < 0.05) R(ctx, x + 1.5, y + 1.2, 3, 1.2, 'rgba(110,150,80,0.45)'); // мох
      }
    }
    // свет сверху-слева, тень к карнизу
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    R(ctx, x0, y0, x1 - x0, y1 - y0, g);
    ctx.restore();
    path(ctx, pts); ctx.lineJoin = 'round'; ctx.strokeStyle = O; ctx.lineWidth = 2.4; ctx.stroke();
  }
  // Окно с тёплым светом
  function windowLit(ctx, x, y, w, h, lit) {
    box(ctx, x - 1.5, y - 1.5, w + 3, h + 3, WOOD.deep, 1.1);
    if (lit !== false) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#fff2a8'); g.addColorStop(0.5, '#ffd24a'); g.addColorStop(1, '#f0a02a');
      R(ctx, x, y, w, h, g);
      R(ctx, x + 1, y + 1, w * 0.35, 1.2, 'rgba(255,255,255,0.7)');
    } else R(ctx, x, y, w, h, '#20324a');
    R(ctx, x + w / 2 - 0.7, y, 1.4, h, WOOD.deep);
    R(ctx, x, y + h / 2 - 0.7, w, 1.4, WOOD.deep);
    R(ctx, x - 2.5, y + h + 1.5, w + 5, 2, WOOD.dark); R(ctx, x - 2.5, y + h + 1.5, w + 5, 0.8, WOOD.hi);
  }
  // Дверь
  function door(ctx, x, y, w, h, lit) {
    box(ctx, x - 1.5, y - 1.5, w + 3, h + 1.5, WOOD.deep, 1.1);
    for (let i = 0; i < w; i += 3) R(ctx, x + i, y, Math.min(3, w - i) - 0.5, h, i % 6 ? '#6a4226' : '#5a381e');
    R(ctx, x, y + h * 0.3, w, 1.2, '#3a2412'); R(ctx, x, y + h * 0.72, w, 1.2, '#3a2412');
    circ(ctx, x + w - 2.5, y + h * 0.55, 0.9, '#d8b060');
    if (lit) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,210,90,0.35)'); g.addColorStop(1, 'rgba(255,210,90,0)'); R(ctx, x, y, w, h, g); }
  }
  // Каменный фундамент
  function stoneBase(ctx, x, y, w, h, rng) {
    box(ctx, x, y, w, h, '#5e5850', 1.1);
    let bx = x;
    while (bx < x + w) {
      const sw = 4 + rng() * 5, c = pick(rng, STONE);
      const ww = Math.min(sw, x + w - bx);
      R(ctx, bx + 0.4, y + 0.4, ww - 0.8, h - 0.8, c);
      R(ctx, bx + 0.8, y + 0.6, ww - 1.6, 0.8, 'rgba(255,255,255,0.25)');
      R(ctx, bx + 0.4, y + h - 1.3, ww - 0.8, 0.9, 'rgba(0,0,0,0.25)');
      bx += sw;
    }
  }
  // Каменная труба
  function chimney(ctx, x, y, w, h, rng) {
    box(ctx, x, y, w, h, '#6a645a', 1.2);
    for (let yy = y, r = 0; yy < y + h; yy += 3.2, r++) for (let xx = x - (r % 2 ? 2 : 0); xx < x + w; xx += 4.5) {
      const x0 = Math.max(x, xx), x1 = Math.min(x + w, xx + 4.1);
      if (x1 > x0) { R(ctx, x0, yy, x1 - x0, 2.8, pick(rng, STONE)); R(ctx, x0, yy, x1 - x0, 0.6, 'rgba(255,255,255,0.2)'); }
    }
    box(ctx, x - 1.5, y - 2.5, w + 3, 3, '#4e4840', 1);
    R(ctx, x + 1, y - 2.2, w - 2, 1.5, '#1a1410');
  }
  // Столб / бревно
  function post(ctx, x, y, w, h, pal) {
    pal = pal || WOOD;
    box(ctx, x, y, w, h, pal.base, 1.2);
    R(ctx, x, y, w * 0.35, h, pal.light); R(ctx, x + w * 0.7, y, w * 0.3, h, pal.dark);
    R(ctx, x, y, w, 1, 'rgba(255,255,255,0.18)');
  }
  function barrel(ctx, x, y, s) {
    s = s || 1;
    ell(ctx, x, y + 1, 8 * s, 3 * s, 'rgba(0,0,0,0.3)');
    box(ctx, x - 6 * s, y - 14 * s, 12 * s, 14 * s, '#7a4e2c', 1.2);
    R(ctx, x - 6 * s, y - 14 * s, 4 * s, 14 * s, '#946038'); R(ctx, x + 3 * s, y - 14 * s, 3 * s, 14 * s, '#5e3a20');
    R(ctx, x - 6 * s, y - 11 * s, 12 * s, 1.6 * s, '#3a3f45'); R(ctx, x - 6 * s, y - 4 * s, 12 * s, 1.6 * s, '#3a3f45');
    ell(ctx, x, y - 14 * s, 6 * s, 2.2 * s, O); ell(ctx, x, y - 14 * s, 5 * s, 1.6 * s, '#a8743f');
  }
  function crate(ctx, x, y, w, h) {
    ell(ctx, x + w / 2, y + h, w * 0.6, 3, 'rgba(0,0,0,0.3)');
    box(ctx, x, y, w, h, '#946038', 1.2);
    R(ctx, x, y, w, 1.5, '#b07a48'); R(ctx, x, y + h - 2, w, 2, '#6a4226');
    ctx.strokeStyle = '#5e3a20'; ctx.lineWidth = 1.2; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    line(ctx, x + 2, y + 2, x + w - 2, y + h - 2, 1.2, '#5e3a20');
  }
  function sack(ctx, x, y) {
    ell(ctx, x, y, 7, 2.5, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x - 8, y - 10, x - 3, y - 12); ctx.lineTo(x + 3, y - 12); ctx.quadraticCurveTo(x + 8, y - 10, x + 7, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8b088'; ctx.beginPath(); ctx.moveTo(x - 6, y - 1); ctx.quadraticCurveTo(x - 7, y - 9, x - 2.5, y - 11); ctx.lineTo(x + 2.5, y - 11); ctx.quadraticCurveTo(x + 7, y - 9, x + 6, y - 1); ctx.closePath(); ctx.fill();
    R(ctx, x - 3, y - 12, 6, 2, '#8a6a40'); R(ctx, x - 4, y - 7, 3, 1, 'rgba(255,255,255,0.3)');
  }
  function lantern(ctx, x, y) {
    line(ctx, x, y - 6, x, y - 3, 1, O);
    box(ctx, x - 2, y - 3, 4, 5, '#ffd24a', 0.9); R(ctx, x - 2, y - 3, 4, 1, '#3a2a1a');
  }
  B.parts = { planksV, planksH, roof, windowLit, door, stoneBase, chimney, post, barrel, crate, sack, lantern, WOOD, WOOD_OLD, WOOD_SHADE, SLATE, SHINGLE };

  /* ============================ КЭШ ============================ */
  // w, h — размер спрайта (логические пиксели), ax, ay — точка привязки (земля под центром здания)
  function make(key, w, h, ax, ay, fn) {
    const c = AB.canvas(Math.ceil(w * K), Math.ceil(h * K)), ctx = c.getContext('2d');
    ctx.scale(K, K); ctx.translate(ax, ay);
    fn(ctx, AB.rng(key.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0) | 0, 7)));
    return { c, ax, ay, w, h };
  }
  B.get = function (key) {
    if (cache[key]) return cache[key];
    const d = DEFS[key.replace(/\d+$/, '')];
    if (!d) return null;
    const lv = +(key.match(/\d+$/) || [1])[0];
    return (cache[key] = make(key, d[0], d[1], d[2], d[3], (ctx, rng) => d[4](ctx, rng, lv)));
  };
  B.draw = function (ctx, key, x, y, alpha) {
    const s = B.get(key); if (!s) return;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    AB.blit(ctx, s.c, x - s.ax, y - s.ay, s.w, s.h, s.ax, s.ay);
    if (alpha !== undefined) ctx.globalAlpha = 1;
  };

  /* ============================ ЗДАНИЯ ============================ */
  const DEFS = {
    // Ратуша архитектора: крыло со сланцевой крышей и трубой + высокий фронтон со знаменем
    townhall: [136, 128, 68, 114, (ctx, rng) => {
      ell(ctx, 0, 2, 64, 10, 'rgba(0,0,0,0.35)');
      // левое крыло
      planksV(ctx, -60, -40, 64, 40, WOOD, rng, 5);
      stoneBase(ctx, -61, -4, 66, 5, rng);
      post(ctx, -62, -42, 4, 40, WOOD_OLD); post(ctx, 1, -42, 4, 40, WOOD_OLD);
      windowLit(ctx, -52, -30, 11, 10);
      door(ctx, -30, -24, 12, 20, true);
      // навес над дверью
      polyO(ctx, [[-35, -27], [-13, -27], [-15, -33], [-33, -33]], '#44587e', 1.6);
      R(ctx, -35, -27.5, 22, 1.8, WOOD.dark);
      lantern(ctx, -11, -20);
      // крыша крыла и труба
      chimney(ctx, -50, -98, 10, 24, rng);
      roof(ctx, [[-66, -38], [8, -38], [3, -86], [-60, -86]], rng, SLATE, 5, 7);
      R(ctx, -66, -39.5, 74, 3, WOOD.dark); R(ctx, -66, -39.5, 74, 1, WOOD.hi);
      // слуховое окошко на крыше
      polyO(ctx, [[-30, -60], [-18, -60], [-18, -52], [-30, -52]], WOOD.base, 1.4);
      windowLit(ctx, -28, -59, 8, 6);
      polyO(ctx, [[-33, -60], [-15, -60], [-24, -68]], '#35466a', 1.4);
      // правое крыло с фронтоном
      planksV(ctx, 2, -48, 58, 48, WOOD_OLD, rng, 5);
      stoneBase(ctx, 1, -4, 60, 5, rng);
      // фронтон: треугольник из досок и широкие наличники
      ctx.save(); path(ctx, [[-1, -48], [63, -48], [31, -92]]); ctx.clip();
      planksV(ctx, -1, -92, 64, 44, WOOD, rng, 4.5);
      ctx.restore();
      path(ctx, [[-1, -48], [63, -48], [31, -92]]); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      circ(ctx, 31, -66, 6.5, O); circ(ctx, 31, -66, 5.2, '#ffd24a'); circ(ctx, 29.5, -67.5, 1.6, '#fff2a8');
      R(ctx, 30.3, -71, 1.4, 10, WOOD.deep); R(ctx, 26, -66.7, 10, 1.4, WOOD.deep);
      const barge = (x1, y1, x2, y2) => { line(ctx, x1, y1, x2, y2, 7, O); line(ctx, x1, y1, x2, y2, 4.6, '#b07236'); line(ctx, x1, y1 - 1.2, x2, y2 - 1.2, 1.2, '#d8a060'); };
      barge(-4, -46, 31.5, -95); barge(66, -46, 30.5, -95);
      box(ctx, 28.5, -100, 5, 7, '#b07236', 1);
      // знамя
      line(ctx, 12, -44, 50, -44, 2.4, O); line(ctx, 12, -44, 50, -44, 1.2, '#8a6a40');
      polyO(ctx, [[16, -43], [46, -43], [46, -14], [31, -7], [16, -14]], '#4a3a8a', 1.6);
      poly(ctx, [[18, -41], [26, -41], [26, -13], [18, -15]], 'rgba(255,255,255,0.08)');
      R(ctx, 16, -40, 30, 1.5, '#d8b050'); R(ctx, 16, -17, 30, 1.2, '#d8b050');
      // герб: башня с циркулем
      const bx = 31, by = -28;
      box(ctx, bx - 5, by - 6, 10, 10, '#e8dcc0', 0.9);
      R(ctx, bx - 5, by - 9, 2.5, 3, '#e8dcc0'); R(ctx, bx - 1.25, by - 9, 2.5, 3, '#e8dcc0'); R(ctx, bx + 2.5, by - 9, 2.5, 3, '#e8dcc0');
      R(ctx, bx - 1.5, by - 1, 3, 5, '#4a3a8a');
      line(ctx, bx - 8, by + 7, bx, by - 12, 1.2, '#d8b050'); line(ctx, bx + 8, by + 7, bx, by - 12, 1.2, '#d8b050');
      // окно правого крыла сбоку
      windowLit(ctx, 50, -34, 7, 10);
      // скамья и бочка
      barrel(ctx, 66, 3, 0.8);
      box(ctx, -58, -2, 16, 3, WOOD.light, 1); R(ctx, -56, 1, 2, 4, WOOD.deep); R(ctx, -46, 1, 2, 4, WOOD.deep);
    }],

    // Мастерская инженера: дом с трубой, открытый вход с горном, наковальня, верстак
    workshop: [112, 108, 56, 92, (ctx, rng) => {
      ell(ctx, 0, 2, 52, 9, 'rgba(0,0,0,0.35)');
      planksV(ctx, -42, -42, 84, 42, WOOD, rng, 5);
      stoneBase(ctx, -43, -4, 86, 5, rng);
      post(ctx, -44, -44, 4, 42, WOOD_OLD); post(ctx, 40, -44, 4, 42, WOOD_OLD);
      // широкий проём мастерской
      box(ctx, -18, -32, 34, 30, '#1c120a', 1.4);
      const g = ctx.createRadialGradient(-1, -10, 2, -1, -12, 26); g.addColorStop(0, 'rgba(255,140,40,0.55)'); g.addColorStop(1, 'rgba(255,120,30,0)');
      R(ctx, -18, -32, 34, 30, g);
      // горн внутри
      box(ctx, -10, -16, 16, 10, '#5e5850', 1); R(ctx, -8, -14, 12, 3, '#ff8a2a'); R(ctx, -6, -13, 8, 1.2, '#ffd24a');
      // инструменты на стене
      line(ctx, -14, -28, -14, -20, 1.5, '#8a9098'); line(ctx, -16, -28, -12, -28, 2, '#8a9098');
      line(ctx, 10, -29, 12, -21, 1.5, '#8a5a30'); box(ctx, 8.5, -30, 5, 2.5, '#8a9098', 0.8);
      R(ctx, -18, -33.5, 34, 3, WOOD.dark); R(ctx, -18, -33.5, 34, 1, WOOD.hi);
      windowLit(ctx, -36, -30, 10, 10);
      windowLit(ctx, 24, -30, 10, 10);
      // крыша и труба
      chimney(ctx, 22, -96, 10, 26, rng);
      roof(ctx, [[-48, -40], [48, -40], [42, -82], [-42, -82]], rng, SLATE, 5, 7);
      R(ctx, -48, -41.5, 96, 3, WOOD.dark); R(ctx, -48, -41.5, 96, 1, WOOD.hi);
      // вывеска-шестерёнка
      line(ctx, -8, -44, -8, -40, 1, O); line(ctx, 8, -44, 8, -40, 1, O);
      box(ctx, -11, -54, 22, 11, WOOD.light, 1.2);
      const gx = 0, gy = -48.5;
      ctx.fillStyle = O; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.fillRect(gx + Math.cos(a) * 4.2 - 1.3, gy + Math.sin(a) * 4.2 - 1.3, 2.6, 2.6); }
      circ(ctx, gx, gy, 4.2, O); circ(ctx, gx, gy, 3.3, '#ffb23a'); circ(ctx, gx, gy, 1.3, WOOD.light);
      // наковальня перед входом
      ell(ctx, -26, 3, 8, 2.5, 'rgba(0,0,0,0.35)');
      box(ctx, -28, -4, 4, 6, '#5a3a22', 1);
      polyO(ctx, [[-34, -8], [-18, -8], [-20, -4], [-32, -4]], '#4a4f55', 1.2);
      R(ctx, -33, -8, 14, 1.2, '#8a9098');
      // верстак справа
      box(ctx, 20, -10, 22, 5, WOOD.light, 1.2); R(ctx, 22, -5, 2.5, 8, WOOD.deep); R(ctx, 38, -5, 2.5, 8, WOOD.deep);
      box(ctx, 24, -14, 7, 4, '#6a7078', 0.9); circ(ctx, 36, -12, 2.2, '#b8c0c8');
      crate(ctx, 44, -10, 10, 10);
      barrel(ctx, -46, 4, 0.8);
    }],

    // Крипто-биржа программиста: хижина с антенной-тарелкой, солнечной панелью и мониторами
    exchange: [112, 112, 54, 94, (ctx, rng) => {
      ell(ctx, 0, 2, 52, 9, 'rgba(0,0,0,0.35)');
      planksV(ctx, -40, -40, 76, 40, WOOD_OLD, rng, 5);
      stoneBase(ctx, -41, -4, 78, 5, rng);
      post(ctx, -42, -42, 4, 40, WOOD); post(ctx, 34, -42, 4, 40, WOOD);
      windowLit(ctx, 20, -32, 10, 11);
      door(ctx, -36, -26, 11, 22, true);
      // солнечная панель у стены
      line(ctx, 44, -8, 40, -28, 2.5, O); line(ctx, 52, -6, 50, -24, 2.5, O);
      polyO(ctx, [[36, -40], [56, -34], [56, -12], [36, -18]], '#1c2e52', 1.4);
      ctx.strokeStyle = '#4a6ab0'; ctx.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(36 + i * 5, -40 + i * 1.5); ctx.lineTo(36 + i * 5, -18 + i * 1.5); ctx.stroke(); }
      for (let j = 1; j < 3; j++) { ctx.beginPath(); ctx.moveTo(36, -40 + j * 7.3); ctx.lineTo(56, -34 + j * 7.3); ctx.stroke(); }
      poly(ctx, [[37, -39], [42, -37.5], [42, -34], [37, -35.5]], 'rgba(170,210,255,0.35)');
      // крыша
      roof(ctx, [[-46, -38], [40, -38], [34, -78], [-40, -78]], rng, SLATE, 5, 7);
      R(ctx, -46, -39.5, 86, 3, WOOD.dark); R(ctx, -46, -39.5, 86, 1, WOOD.hi);
      // тарелка
      line(ctx, -12, -72, -12, -84, 3, O); line(ctx, -12, -72, -12, -84, 1.6, '#8a9098');
      ctx.save(); ctx.translate(-12, -92); ctx.rotate(-0.35);
      ell(ctx, 0, 0, 13, 11, O); ell(ctx, 0, 0, 11.6, 9.8, '#b8c0c8'); ell(ctx, -1.5, -1.5, 8, 6.5, '#d8e0e6');
      ctx.strokeStyle = '#7a8088'; ctx.lineWidth = 0.8; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 9.4); ctx.stroke(); }
      line(ctx, 0, 0, 7, -7, 1.4, O); circ(ctx, 7, -7, 1.8, '#4a4f55');
      ctx.restore();
      // стол с мониторами (экраны рисуются живыми поверх)
      box(ctx, -24, -12, 44, 5, WOOD.light, 1.2); R(ctx, -22, -7, 2.5, 9, WOOD.deep); R(ctx, 15, -7, 2.5, 9, WOOD.deep);
      box(ctx, -21, -30, 20, 14, '#1a1e24', 1.3); R(ctx, -12.5, -16, 3, 4, '#2a2e34');
      box(ctx, 2, -26, 14, 10, '#1a1e24', 1.3); R(ctx, 7.5, -16, 3, 4, '#2a2e34');
      box(ctx, -10, -11, 12, 2, '#3a3f45', 0.8);
      // стойка сервера
      box(ctx, 22, -18, 9, 18, '#2a2e34', 1.2);
      for (let i = 0; i < 4; i++) R(ctx, 23, -16 + i * 4, 7, 2.5, '#1a1e24');
      // кабели
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(22, -6); ctx.quadraticCurveTo(18, 4, 8, -2); ctx.stroke();
    }],

    // Лавка охотника: прилавок под полосатым навесом, шкуры и рога
    shop: [104, 96, 52, 82, (ctx, rng) => {
      ell(ctx, 0, 2, 48, 8, 'rgba(0,0,0,0.35)');
      planksV(ctx, -36, -46, 72, 32, WOOD_SHADE, rng, 5);
      // полки со связками на задней стене
      R(ctx, -32, -32, 64, 2, WOOD.dark);
      for (let i = 0; i < 5; i++) { const x = -28 + i * 13; line(ctx, x, -44, x, -38, 1, '#8a6a40'); ell(ctx, x, -35, 3.2, 4, i % 2 ? '#7a3e1c' : '#4f7a3a'); }
      post(ctx, -40, -54, 4, 54, WOOD); post(ctx, 36, -54, 4, 54, WOOD);
      // прилавок
      planksV(ctx, -34, -16, 68, 16, WOOD, rng, 5);
      box(ctx, -37, -19, 74, 4, WOOD.light, 1.3); R(ctx, -37, -19, 74, 1.2, WOOD.hi);
      // полосатый навес с фестонами
      const top = -62, bot = -44;
      ctx.save(); path(ctx, [[-44, bot], [44, bot], [40, top], [-40, top]]); ctx.clip();
      for (let i = 0; i < 10; i++) { const x = -44 + i * 9; poly(ctx, [[x, bot], [x + 9, bot], [x + 8.2, top], [x - 0.8, top]], i % 2 ? '#f2e8d0' : '#3f8a3a'); }
      const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.2)'); R(ctx, -44, top, 88, bot - top, g);
      ctx.restore();
      path(ctx, [[-44, bot], [44, bot], [40, top], [-40, top]]); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      for (let i = 0; i < 10; i++) {
        const x = -44 + i * 8.8;
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(x - 0.5, bot); ctx.lineTo(x + 9.3, bot); ctx.quadraticCurveTo(x + 4.4, bot + 7.5, x - 0.5, bot); ctx.fill();
        ctx.fillStyle = i % 2 ? '#f2e8d0' : '#3f8a3a'; ctx.beginPath(); ctx.moveTo(x + 0.6, bot + 0.6); ctx.lineTo(x + 8.2, bot + 0.6); ctx.quadraticCurveTo(x + 4.4, bot + 5.8, x + 0.6, bot + 0.6); ctx.fill();
      }
      // вывеска: рога и монета
      box(ctx, -14, -76, 28, 12, WOOD.light, 1.3);
      ctx.strokeStyle = O; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      const antler = (s) => { ctx.beginPath(); ctx.moveTo(s * 4, -70); ctx.quadraticCurveTo(s * 14, -76, s * 16, -86); ctx.moveTo(s * 10, -74); ctx.lineTo(s * 12, -82); ctx.moveTo(s * 14, -79); ctx.lineTo(s * 20, -82); ctx.stroke(); };
      antler(-1); antler(1);
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.6; antler(-1); antler(1);
      circ(ctx, 0, -70, 4.6, O); circ(ctx, 0, -70, 3.6, '#ffd24a'); R(ctx, -0.6, -72.5, 1.2, 5, '#b8862a');
      // сушилка со шкурой
      line(ctx, 44, -40, 44, 2, 3, O); line(ctx, 54, -40, 54, 2, 3, O); line(ctx, 42, -38, 56, -38, 3, O);
      line(ctx, 44, -40, 44, 2, 1.6, WOOD.light); line(ctx, 54, -40, 54, 2, 1.6, WOOD.light); line(ctx, 42, -38, 56, -38, 1.6, WOOD.light);
      polyO(ctx, [[45, -37], [53, -37], [55, -26], [53, -16], [49, -19], [45, -16], [43, -26]], '#8a7058', 1.2);
      ell(ctx, 49, -27, 3, 5, '#a88a6a');
      sack(ctx, -44, 4); crate(ctx, -52, -12, 9, 9);
    }],

    // Полевая кухня: навес на столбах, очаг из камней с треногой, стол и припасы
    kitchen: [112, 100, 56, 84, (ctx, rng) => {
      ell(ctx, 0, 4, 52, 10, 'rgba(0,0,0,0.3)');
      // задняя стенка в тени
      planksH(ctx, -42, -54, 84, 30, WOOD_SHADE, rng, 4);
      // полка с горшками
      R(ctx, -38, -44, 40, 2, WOOD.dark);
      [[-34, '#b8703a'], [-26, '#8a8a8a'], [-18, '#b8703a'], [-9, '#4a6a8a']].forEach(q => { box(ctx, q[0], -50, 5, 6, q[1], 0.9); R(ctx, q[0], -50, 5, 1, 'rgba(255,255,255,0.3)'); });
      // сковороды на стене
      circ(ctx, 14, -44, 5, O); circ(ctx, 14, -44, 4, '#3a3f45'); line(ctx, 14, -49, 14, -54, 1.6, O);
      circ(ctx, 28, -42, 4, O); circ(ctx, 28, -42, 3.1, '#4a4f55'); line(ctx, 28, -46, 28, -52, 1.6, O);
      post(ctx, -46, -48, 5, 50, WOOD); post(ctx, 41, -48, 5, 50, WOOD);
      // крыша-навес из деревянной черепицы
      roof(ctx, [[-52, -46], [52, -46], [46, -80], [-46, -80]], rng, SHINGLE, 5, 6);
      R(ctx, -52, -47.5, 104, 3.2, WOOD.dark); R(ctx, -52, -47.5, 104, 1, WOOD.hi);
      // связки колбас и трав
      for (let i = 0; i < 3; i++) { const x = -10 + i * 5; line(ctx, x, -45, x, -38, 0.8, '#3a2a1a'); ell(ctx, x, -35, 1.8, 3.5, O); ell(ctx, x, -35, 1.2, 2.8, '#9a3a2a'); }
      for (let i = 0; i < 2; i++) { const x = 24 + i * 6; line(ctx, x, -45, x, -40, 0.8, '#3a2a1a'); ell(ctx, x, -37, 2.4, 3.4, '#5a8a3a'); ell(ctx, x - 0.8, -38, 1, 1.5, '#8ac05a'); }
      // очаг: подкова из камней
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.95 + i / 8 * 1.1), sx = -19 + Math.cos(a) * 13, sy = -6 + Math.sin(a) * 6;
        ell(ctx, sx, sy, 4.4, 3.4, O); ell(ctx, sx, sy - 0.4, 3.5, 2.6, pick(rng, STONE)); R(ctx, sx - 2, sy - 2, 2.5, 0.8, 'rgba(255,255,255,0.35)');
      }
      ell(ctx, -19, -4, 10, 4, '#2a1a10');
      // тренога
      [[-32, 6], [-6, 6], [-19, 10]].forEach(l => { line(ctx, l[0], l[1], -19, -34, 3.6, O); line(ctx, l[0], l[1], -19, -34, 2, WOOD.light); });
      line(ctx, -19, -34, -19, -22, 1.4, '#222');
      // стол
      box(ctx, 10, -14, 32, 6, WOOD.light, 1.2); R(ctx, 10, -14, 32, 1.2, WOOD.hi);
      R(ctx, 12, -8, 2.5, 10, WOOD.deep); R(ctx, 37.5, -8, 2.5, 10, WOOD.deep);
      box(ctx, 30, -18, 8, 4, '#c8a06a', 0.8); // разделочная доска
      barrel(ctx, 50, 4, 0.85);
      sack(ctx, -48, 6);
    }],

    // Лесопилка: навес из деревянной черепицы, стена с инструментами, козлы
    mill: [120, 104, 58, 86, (ctx, rng) => {
      ell(ctx, 0, 4, 54, 10, 'rgba(0,0,0,0.3)');
      planksV(ctx, -40, -58, 72, 34, WOOD_SHADE, rng, 5);
      // двуручная пила и топор на стене
      ctx.save(); ctx.translate(-22, -46); ctx.rotate(-0.08);
      box(ctx, -12, -2, 24, 4, '#b8c0c8', 0.9); ctx.fillStyle = O; for (let i = 0; i < 12; i++) ctx.fillRect(-12 + i * 2, 2, 1, 1.4);
      box(ctx, -16, -3, 4, 6, WOOD.light, 0.9); box(ctx, 12, -3, 4, 6, WOOD.light, 0.9);
      ctx.restore();
      line(ctx, 10, -54, 18, -36, 2.4, O); line(ctx, 10, -54, 18, -36, 1.4, WOOD.light); polyO(ctx, [[8, -54], [14, -56], [15, -50], [10, -49]], '#b8c0c8', 1);
      post(ctx, -44, -50, 5, 52, WOOD); post(ctx, 32, -50, 5, 52, WOOD);
      roof(ctx, [[-50, -48], [42, -48], [36, -84], [-44, -84]], rng, SHINGLE, 5, 6);
      R(ctx, -50, -49.5, 92, 3.2, WOOD.dark); R(ctx, -50, -49.5, 92, 1, WOOD.hi);
      // табличка «пила»
      box(ctx, -12, -60, 22, 8, WOOD.light, 1); ctx.fillStyle = '#3a2412'; ctx.font = 'bold 6px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ДОСКИ', -1, -55.6);
      // пильный стол (пила — живая)
      box(ctx, -16, -12, 34, 5, WOOD.light, 1.2); R(ctx, -16, -12, 34, 1.2, WOOD.hi);
      R(ctx, -14, -7, 3, 12, WOOD.deep); R(ctx, 13, -7, 3, 12, WOOD.deep);
      box(ctx, -6, -14, 10, 3, '#4a4f55', 0.8);
      // опилки
      for (let i = 0; i < 14; i++) R(ctx, -14 + rng() * 32, 2 + rng() * 5, 1.4, 1, '#e0c08a');
      barrel(ctx, 44, 2, 0.85);
    }],

    // Вышка архитектора: четыре ноги с раскосами, лестница, площадка с перилами, сланцевая крыша
    tower: [72, 128, 36, 116, (ctx, rng, lv) => {
      ell(ctx, 0, 3, 24, 7, 'rgba(0,0,0,0.35)');
      const pal = lv >= 3 ? WOOD : WOOD_OLD;
      // задние ноги
      line(ctx, -10, -6, -9, -60, 5, O); line(ctx, 10, -6, 9, -60, 5, O);
      line(ctx, -10, -6, -9, -60, 3, pal.dark); line(ctx, 10, -6, 9, -60, 3, pal.dark);
      // раскосы
      [[-15, -4, 13, -30], [15, -4, -13, -30], [-13, -32, 11, -56], [13, -32, -11, -56]].forEach(l => { line(ctx, l[0], l[1], l[2], l[3], 4, O); line(ctx, l[0], l[1], l[2], l[3], 2.2, pal.base); });
      line(ctx, -14, -31, 14, -31, 4, O); line(ctx, -14, -31, 14, -31, 2.2, pal.light);
      // передние ноги
      line(ctx, -17, 1, -12, -62, 6, O); line(ctx, 17, 1, 12, -62, 6, O);
      line(ctx, -17, 1, -12, -62, 4, pal.base); line(ctx, 17, 1, 12, -62, 4, pal.base);
      line(ctx, -17.8, 0, -12.8, -62, 1.2, pal.hi); line(ctx, 16.2, 0, 11.2, -62, 1.2, pal.hi);
      if (lv >= 2) { [-6, -40].forEach(y => { R(ctx, -17 + (-y) * 0.08, y - 1, 5, 2.4, '#4a4f55'); R(ctx, 12 - (-y) * 0.08, y - 1, 5, 2.4, '#4a4f55'); }); }
      if (lv >= 3) { stoneBase(ctx, -21, -4, 10, 6, rng); stoneBase(ctx, 11, -4, 10, 6, rng); }
      // лестница
      line(ctx, -4, 2, -3, -62, 2.6, O); line(ctx, 4, 2, 3, -62, 2.6, O);
      line(ctx, -4, 2, -3, -62, 1.3, WOOD.light); line(ctx, 4, 2, 3, -62, 1.3, WOOD.light);
      for (let y = -2; y > -60; y -= 6) { line(ctx, -3.6, y, 3.6, y, 2.4, O); line(ctx, -3.6, y, 3.6, y, 1.2, WOOD.hi); }
      // площадка
      planksV(ctx, -24, -74, 48, 8, WOOD.light, rng, 4);
      planksH(ctx, -25, -66, 50, 6, pal, rng, 3);
      // перила
      for (const x of [-23, -8, 7, 22]) { box(ctx, x - 1, -86, 2.4, 14, pal.base, 1); }
      box(ctx, -24, -86, 48, 2.4, pal.light, 1.1);
      box(ctx, -24, -79, 48, 1.6, pal.base, 0.9);
      // столбы крыши и крыша
      post(ctx, -23, -104, 3, 20, pal); post(ctx, 20, -104, 3, 20, pal);
      roof(ctx, [[-30, -100], [30, -100], [14, -118], [-14, -118]], rng, SLATE, 4.5, 6);
      R(ctx, -30, -101.5, 60, 2.8, WOOD.dark); R(ctx, -30, -101.5, 60, 1, WOOD.hi);
      box(ctx, -1.5, -124, 3, 7, WOOD.dark, 1);
    }],

    // Частокол: заострённые брёвна с обвязкой. Уровень 2 — железные скобы, 3 — каменное основание.
    wall: [48, 58, 24, 48, (ctx, rng, lv) => {
      ell(ctx, 0, 3, 19, 6, 'rgba(0,0,0,0.3)');
      const logs = [[-12, 30], [-4, 35], [4, 33], [12, 29]];
      // поперечина сзади
      box(ctx, -18, -24, 36, 4, WOOD.dark, 1.2);
      logs.forEach((q, i) => {
        const lx = q[0], h = q[1];
        box(ctx, lx - 4, -h, 8, h + 2, i % 2 ? WOOD.base : WOOD_OLD.base, 1.3);
        R(ctx, lx - 4, -h, 2.6, h + 2, i % 2 ? WOOD.light : WOOD_OLD.light);
        R(ctx, lx + 2, -h, 2, h + 2, WOOD.dark);
        for (let k = 0; k < 3; k++) R(ctx, lx - 2 + rng() * 4, -h + 5 + rng() * (h - 8), 1, 3, 'rgba(0,0,0,0.25)'); // кора
        ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(lx - 5.3, -h); ctx.lineTo(lx, -h - 8.5); ctx.lineTo(lx + 5.3, -h); ctx.fill();
        ctx.fillStyle = '#d8b07a'; ctx.beginPath(); ctx.moveTo(lx - 3.8, -h - 0.4); ctx.lineTo(lx, -h - 6.4); ctx.lineTo(lx + 3.8, -h - 0.4); ctx.fill();
        R(ctx, lx - 1.2, -h - 4, 1, 3, '#f0d0a0');
      });
      // верёвочная обвязка
      box(ctx, -17, -17, 34, 3, '#a88a5a', 1); for (let x = -16; x < 16; x += 3) R(ctx, x, -17, 1.2, 3, '#7a6040');
      if (lv >= 2) logs.forEach(q => { box(ctx, q[0] - 4, -9, 8, 2.4, '#4a4f55', 0.9); R(ctx, q[0] - 4, -9, 8, 0.8, '#8a9098'); circ(ctx, q[0], -7.8, 0.9, '#c0c8d0'); });
      if (lv >= 3) stoneBase(ctx, -19, -4, 38, 7, rng);
    }],

    // Турель инженера: треножник, бронированный корпус, светящееся ядро (ствол и свечение — живые)
    turret: [52, 56, 26, 46, (ctx, rng) => {
      ell(ctx, 0, 3, 18, 6, 'rgba(0,0,0,0.4)');
      polyO(ctx, [[-16, 2], [-10, -4], [10, -4], [16, 2], [10, 7], [-10, 7]], '#2a2e34', 1.6);
      poly(ctx, [[-14, 2], [-9, -2.5], [9, -2.5], [14, 2]], '#3a3f45');
      [[-12, 3, -6, -14], [12, 3, 6, -14], [0, 6, 0, -12]].forEach(l => { line(ctx, l[0], l[1], l[2], l[3], 4, O); line(ctx, l[0], l[1], l[2], l[3], 2.2, '#5a5f66'); });
      box(ctx, -9, -24, 18, 12, '#3a3f45', 1.4);
      R(ctx, -9, -24, 18, 2, '#5a6068'); R(ctx, -9, -14, 18, 2, '#24282d');
      box(ctx, -12, -22, 3, 8, '#4a4f55', 1); box(ctx, 9, -22, 3, 8, '#4a4f55', 1);
      R(ctx, -8, -19, 16, 1.5, '#ffb23a');
      for (const x of [-6, 0, 6]) circ(ctx, x, -15.5, 0.8, '#8a9098');
    }],

    // Кольцо камней костра (главный — крупнее)
    fireMain: [72, 44, 36, 22, (ctx, rng) => fireRing(ctx, rng, 23, 12, 12)],
    fireSmall: [56, 36, 28, 18, (ctx, rng) => fireRing(ctx, rng, 17, 9, 10)],

    // Фургон торговца (торговец рисуется отдельно)
    wagon: [96, 84, 30, 70, (ctx, rng) => {
      ell(ctx, 28, 4, 40, 8, 'rgba(0,0,0,0.35)');
      // оглобли
      line(ctx, 2, -8, -24, -2, 3, O); line(ctx, 2, -12, -24, -8, 3, O);
      line(ctx, 2, -8, -24, -2, 1.6, WOOD.light); line(ctx, 2, -12, -24, -8, 1.6, WOOD.light);
      // кузов
      planksH(ctx, 2, -28, 54, 20, WOOD, rng, 4);
      R(ctx, 2, -28, 54, 1.2, WOOD.hi);
      // тент
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(0, -27); ctx.bezierCurveTo(0, -66, 58, -66, 58, -27); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.moveTo(2, -28); ctx.bezierCurveTo(2, -63, 56, -63, 56, -28); ctx.closePath(); ctx.clip();
      R(ctx, 0, -66, 60, 40, '#e8dcc0');
      for (let i = 0; i < 6; i++) R(ctx, 4 + i * 9.4, -66, 4.2, 40, '#c8503a');
      const g = ctx.createLinearGradient(0, -62, 0, -28); g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.28)'); R(ctx, 0, -66, 60, 40, g);
      ctx.restore();
      // рёбра тента
      ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 1; for (const x of [16, 29, 42]) { ctx.beginPath(); ctx.moveTo(x, -28); ctx.quadraticCurveTo(x, -64, x + 1, -60); ctx.stroke(); }
      // тёмный вход сзади тента с товарами
      ell(ctx, 29, -32, 14, 5, '#2a1a10');
      // колёса со спицами
      for (const wx of [14, 46]) {
        circ(ctx, wx, -4, 9.5, O); circ(ctx, wx, -4, 8, '#6b4428'); circ(ctx, wx, -4, 6, '#3a2616');
        ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = 1.4; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(wx, -4); ctx.lineTo(wx + Math.cos(a) * 7, -4 + Math.sin(a) * 7); ctx.stroke(); }
        circ(ctx, wx, -4, 2, '#4a4f55'); R(ctx, wx - 6, -12, 5, 1, 'rgba(255,255,255,0.25)');
      }
      // ящики и мешки рядом
      crate(ctx, 58, -12, 12, 11); sack(ctx, 64, 2);
      // фонарь
      line(ctx, 56, -30, 60, -40, 1.6, O);
      box(ctx, 58, -40, 5, 6, '#ffd24a', 1);
    }],

    // Палатка у костра
    tent: [84, 64, 42, 54, (ctx, rng) => {
      ell(ctx, 0, 2, 36, 7, 'rgba(0,0,0,0.3)');
      // растяжки
      line(ctx, -30, -2, -40, 4, 1, '#c8b088'); line(ctx, 30, -2, 40, 4, 1, '#c8b088');
      box(ctx, -41, 3, 2, 3, WOOD.dark, 0.8); box(ctx, 39, 3, 2, 3, WOOD.dark, 0.8);
      // скат
      polyO(ctx, [[-34, 0], [0, -44], [34, 0]], '#8a7a4a', 2.2);
      poly(ctx, [[-30, -2], [0, -40], [-6, -2]], '#a8966a');
      poly(ctx, [[6, -2], [0, -40], [30, -2]], '#6e6038');
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-34 + i * 8.5, 0); ctx.lineTo(0, -44 + 0); ctx.stroke(); }
      // заплатка
      box(ctx, 14, -16, 7, 6, '#9a6a3a', 0.8); R(ctx, 14, -16, 7, 1, 'rgba(255,255,255,0.2)');
      // вход
      polyO(ctx, [[-9, 0], [0, -26], [9, 0]], '#2a1a10', 1.4);
      poly(ctx, [[-8, 0], [0, -24], [-3, 0]], '#6e6038');
      // конёк
      line(ctx, 0, -44, 0, -52, 2.4, O); line(ctx, 0, -44, 0, -52, 1.2, WOOD.light);
      // спальник у входа
      box(ctx, 12, -4, 14, 5, '#3f6a8a', 1); R(ctx, 12, -4, 4, 5, '#e8dcc0');
    }],
  };

  function fireRing(ctx, rng, rx, ry, n) {
    ell(ctx, 0, 1, rx + 6, ry + 4, 'rgba(0,0,0,0.3)');
    ell(ctx, 0, 0, rx - 3, ry - 2, '#1e140c');
    ell(ctx, 0, 0, rx - 6, ry - 4, '#3a2210');
    const stones = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.15; stones.push([Math.cos(a) * rx, Math.sin(a) * ry, 5.4 + rng() * 1.6, 4 + rng() * 1.2]); }
    stones.sort((a, b) => a[1] - b[1]);
    stones.forEach(s => {
      ell(ctx, s[0], s[1] + 1, s[2] + 1.4, s[3] + 1.6, O);
      ell(ctx, s[0], s[1], s[2], s[3], pick(rng, ['#b8ac98', '#c8bca8', '#a89c88', '#d0c4ae']));
      ell(ctx, s[0] - 1, s[1] - 1.4, s[2] * 0.55, s[3] * 0.45, 'rgba(255,248,230,0.45)');
      ctx.fillStyle = 'rgba(40,25,10,0.3)'; ctx.beginPath(); ctx.ellipse(s[0] + 0.5, s[1] + s[3] * 0.5, s[2] * 0.8, s[3] * 0.35, 0, 0, TAU); ctx.fill();
    });
  }

  // Прогрев кэша, чтобы первый кадр не подтормаживал
  B.warm = function () { Object.keys(DEFS).forEach(k => { if (k === 'tower' || k === 'wall') [1, 2, 3].forEach(l => B.get(k + l)); else B.get(k); }); };
})(window.AB);
