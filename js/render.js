// Отрисовка мира, персонажей, тумана/освещения и интерфейса.
(function (AB) {
  const R = AB.Render = {};
  const TAU = Math.PI * 2;
  const C = () => window.CONFIG;
  const S = () => AB.Sprites;
  const CHUNK = 256;                       // мелкие куски земли: каждый печётся за пару мс, без рывков
  let chunks = new Map(), bakeQueue = [], stale = [], worldRef = null, lastView = null;
  const ckey = (cx, cy) => cy * 4096 + cx;

  R.init = function (canvas) {
    R.cv = canvas; R.ctx = canvas.getContext('2d', { alpha: false }); // непрозрачный холст: браузеру не нужно смешивать его со страницей
    R.fogC = AB.canvas(8, 8); R.darkC = AB.canvas(8, 8);
    R.time = 0;
    R.resize();
    window.addEventListener('resize', R.resize);
  };
  R.resize = function () {
    // облегчённая графика: холст меньше экрана, растягивает его сам браузер — все проходы рисования дешевле почти вдвое
    const dpr = R.lowQ ? Math.max(0.7, Math.min(window.devicePixelRatio || 1, 2) * 0.5) : Math.min(window.devicePixelRatio || 1, 2);
    R.dpr = dpr;
    R.w = window.innerWidth; R.h = window.innerHeight;
    R.cv.width = Math.floor(R.w * dpr); R.cv.height = Math.floor(R.h * dpr);
    R.cv.style.width = R.w + 'px'; R.cv.style.height = R.h + 'px';
    const fs = R.lowQ ? 4 : 3;
    R.fogC.width = R.darkC.width = Math.ceil(R.w / fs); R.fogC.height = R.darkC.height = Math.ceil(R.h / fs);
  };

  R.setWorld = function (W) {
    worldRef = W; chunks = new Map(); bakeQueue = []; stale = []; lastView = null;
    const n = Math.ceil(W.size / CHUNK);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) bakeQueue.push([x, y]);
    const cx = W.camp.x / CHUNK, cy = W.camp.y / CHUNK;
    bakeQueue.sort((a, b) => Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy));
    // карта большая: заранее печём только окрестности лагеря, остальное — по мере надобности
    bakeQueue = bakeQueue.filter(q => Math.hypot(q[0] - cx, q[1] - cy) < 6.5);
    buildMinimap(W);
    if (AB.Bld) AB.Bld.warm();
  };

  /* ============================ ЗЕМЛЯ ============================ */
  const COL = {
    grassD: [34, 64, 33], grassL: [82, 122, 50], dry: [118, 128, 58], dirt: [104, 80, 52], dirtL: [132, 104, 68],
    stone: [92, 90, 80], stoneL: [120, 117, 104], deep: [22, 58, 72], shallow: [44, 98, 104], sand: [112, 102, 66],
  };
  function groundAt(W, x, y) {
    const tx = Math.floor(x / W.T), ty = Math.floor(y / W.T);
    if (tx < 0 || ty < 0 || tx >= W.N || ty >= W.N) return AB.G_GRASS;
    return W.ground[ty * W.N + tx];
  }
  function bakeChunk(W, cx, cy) {
    const cells = CHUNK / 4;
    const small = AB.canvas(cells, cells), sctx = small.getContext('2d');
    const img = sctx.createImageData(cells, cells), d = img.data;
    const seed = W.seed;
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const wx = cx * CHUNK + i * 4 + 2, wy = cy * CHUNK + j * 4 + 2;
      const jx = (AB.noise(wx / 23, wy / 23, seed + 3) - 0.5) * 26, jy = (AB.noise(wx / 23, wy / 23, seed + 4) - 0.5) * 26;
      let g = groundAt(W, wx + jx, wy + jy);
      const gTrue = groundAt(W, wx, wy);
      if (gTrue === AB.G_WATER || g === AB.G_WATER) g = groundAt(W, wx + jx * 0.35, wy + jy * 0.35);
      const h = AB.hash2(wx >> 2, wy >> 2, seed);
      const n1 = AB.fbm(wx / 220, wy / 220, seed + 1, 3);
      let c;
      if (g === AB.G_WATER) {
        let shore = 0;
        for (const o of [[12, 0], [-12, 0], [0, 12], [0, -12]]) if (groundAt(W, wx + o[0], wy + o[1]) !== AB.G_WATER) shore++;
        const wave = AB.noise(wx / 30, wy / 12, seed + 8);
        c = AB.mix(COL.deep, COL.shallow, Math.min(1, shore * 0.35 + wave * 0.25));
        const wti = Math.floor(wy / W.T) * W.N + Math.floor(wx / W.T);
        if (W.biome && W.biome[wti] === 1) c = AB.mix(c, AB.mix([150, 190, 215], [200, 225, 240], wave), W.bmix[wti] * 0.85); // лёд
        else if (W.biome && W.biome[wti] === 3) c = AB.mix(c, [40, 60, 40], W.bmix[wti] * 0.6); // болотная вода
        if (h < 0.03) c = AB.mix(c, [120, 170, 170], 0.4);
      } else {
        const forest = AB.fbm(wx / W.T / 14, wy / W.T / 14, seed + 101, 4);
        c = AB.mix(COL.grassD, COL.grassL, AB.clamp(n1 * 1.3 - 0.15, 0, 1));
        const dry = AB.fbm(wx / 140, wy / 140, seed + 44, 2);
        if (dry > 0.62) c = AB.mix(c, COL.dry, (dry - 0.62) * 1.6);
        c = AB.mix(c, [14, 30, 20], AB.clamp((forest - 0.45) * 1.1, 0, 0.45));
        // земли сторон света: свой цвет земли, плавно переходящий из леса
        const bti = Math.floor(wy / W.T) * W.N + Math.floor(wx / W.T), bb = W.biome ? W.biome[bti] : 0;
        if (bb) c = AB.mix(c, biomeGround(bb, wx, wy, seed, n1, h), W.bmix[bti]);
        if (g === AB.G_CAMP || g === AB.G_PATH) {
          const dn = AB.noise(wx / 18, wy / 18, seed + 5);
          c = AB.mix(COL.dirt, COL.dirtL, dn);
          if (h < 0.05) c = AB.mix(c, [150, 130, 100], 0.5);
        } else if (g === AB.G_SITE && W.skind && W.skind[Math.floor(wy / W.T) * W.N + Math.floor(wx / W.T)] > 1) {
          c = siteGround(W.skind[Math.floor(wy / W.T) * W.N + Math.floor(wx / W.T)], wx, wy, seed, h, c);
        } else if (g === AB.G_SITE) {
          const px = Math.floor((wx + 1000) / 20), py = Math.floor((wy + 1000) / 14);
          const off = (py % 2) * 10;
          const edgeX = ((wx + 1000 + off) % 20) < 3, edgeY = ((wy + 1000) % 14) < 3;
          c = AB.mix(COL.stone, COL.stoneL, AB.hash2(Math.floor((wx + 1000 + off) / 20), py, seed));
          if (edgeX || edgeY) c = AB.mix(c, [40, 48, 36], 0.6);
          if (AB.noise(wx / 26, wy / 26, seed + 70) > 0.62) c = AB.mix(c, [58, 92, 44], 0.7);
          if (px < 0) c = COL.stone;
        }
        let wet = false;
        for (const o of [[7, 0], [-7, 0], [0, 7], [0, -7]]) if (groundAt(W, wx + o[0], wy + o[1]) === AB.G_WATER) wet = true;
        if (wet) c = AB.mix(c, COL.sand, 0.75);
      }
      const jit = (h - 0.5) * 14;
      const k = (j * cells + i) * 4;
      d[k] = AB.clamp(c[0] + jit, 0, 255); d[k + 1] = AB.clamp(c[1] + jit, 0, 255); d[k + 2] = AB.clamp(c[2] + jit * 0.6, 0, 255); d[k + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const cv = AB.canvas(CHUNK, CHUNK), ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, CHUNK, CHUNK);
    // детали
    const T = W.T, TPC = CHUNK / T, t0x = cx * TPC, t0y = cy * TPC;
    for (let ty = t0y; ty < t0y + TPC; ty++) for (let tx = t0x; tx < t0x + TPC; tx++) {
      if (tx >= W.N || ty >= W.N) continue;
      const g = W.ground[ty * W.N + tx];
      const lx = (tx - t0x) * T, ly = (ty - t0y) * T;
      const r = AB.rng(tx * 7919 + ty * 104729 + seed);
      const tbi = ty * W.N + tx;
      if (g === AB.G_GRASS && W.biome && W.biome[tbi] && W.bmix[tbi] > r()) {
        biomeDetail(ctx, W.biome[tbi], r, lx, ly, T);
      } else if (g === AB.G_GRASS) {
        const nt = 2 + (r() * 3 | 0);
        for (let k = 0; k < nt; k++) {
          const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T);
          ctx.fillStyle = r() < 0.5 ? 'rgba(20,45,20,0.55)' : 'rgba(120,170,70,0.45)';
          ctx.fillRect(x, y, 2, 4); ctx.fillRect(x - 2, y + 1, 2, 3); ctx.fillRect(x + 2, y + 1, 2, 3);
        }
        if (r() < 0.05) {
          const fc = ['#f4f1e0', '#f2d36b', '#b88ae0', '#f08aa8', '#8ac8f0'][r() * 5 | 0];
          const x = lx + r() * T, y = ly + r() * T;
          for (let k = 0; k < 4; k++) { const fx = Math.round(x + (r() - 0.5) * 14), fy = Math.round(y + (r() - 0.5) * 10); ctx.fillStyle = '#2d5a24'; ctx.fillRect(fx, fy + 2, 1, 3); ctx.fillStyle = fc; ctx.fillRect(fx - 1, fy, 3, 3); ctx.fillStyle = '#fff6b0'; ctx.fillRect(fx, fy + 1, 1, 1); }
        }
        if (W.forest[ty * W.N + tx] > 0.55 && r() < 0.25) {
          for (let k = 0; k < 5; k++) { ctx.fillStyle = ['#7a4a22', '#a8641f', '#5e3a1a'][r() * 3 | 0]; ctx.fillRect(Math.round(lx + r() * T), Math.round(ly + r() * T), 3, 2); }
        }
        if (W.forest[ty * W.N + tx] > 0.5 && r() < 0.03) {
          const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T);
          ctx.fillStyle = '#e8e0cc'; ctx.fillRect(x, y, 2, 4); ctx.fillStyle = '#c0302a'; ctx.fillRect(x - 2, y - 2, 6, 3); ctx.fillStyle = '#fff'; ctx.fillRect(x, y - 2, 1, 1);
        }
      } else if (g === AB.G_CAMP || g === AB.G_PATH) {
        for (let k = 0; k < 3; k++) {
          if (r() < 0.5) continue;
          const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T);
          ctx.fillStyle = 'rgba(40,30,20,0.6)'; ctx.fillRect(x, y + 1, 4, 2);
          ctx.fillStyle = '#9a9488'; ctx.fillRect(x, y, 4, 2);
        }
      } else if (g === AB.G_SITE && W.skind && W.skind[ty * W.N + tx] === 6 && AB.Mush) {
        AB.Mush.groundDetail(ctx, r, lx, ly, T);
      } else if (g === AB.G_WATER && r() < 0.04) {
        const x = lx + r() * T, y = ly + r() * T;
        ctx.fillStyle = '#1e4a24'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0.4, TAU); ctx.lineTo(x, y); ctx.fill();
        ctx.fillStyle = '#3f7a3a'; ctx.beginPath(); ctx.ellipse(x, y - 1, 6, 4, 0, 0.4, TAU); ctx.lineTo(x, y); ctx.fill();
        if (r() < 0.4) { ctx.fillStyle = '#f0c8e0'; ctx.fillRect(x - 1, y - 2, 3, 3); }
      }
    }
    return cv;
  }
  // земля локаций: 2 разбойники, 3 тарелка, 4 кладбище, 5 колдунья, 6 грибы, 7 берлога
  function siteGround(k, wx, wy, seed, h, grass) {
    const n = AB.noise(wx / 20, wy / 20, seed + 71), n2 = AB.noise(wx / 7, wy / 7, seed + 72);
    let c;
    if (k === 2) { c = AB.mix([112, 88, 58], [140, 114, 76], n); if (n2 > 0.72) c = AB.mix(c, [196, 170, 96], 0.6); }           // утоптанная земля и солома
    else if (k === 3) { c = AB.mix([54, 50, 46], [86, 78, 64], n); if (n2 > 0.8) c = AB.mix(c, [90, 230, 150], 0.45); }         // выжженная земля с зелёными искрами
    else if (k === 4) { c = AB.mix([72, 64, 50], [96, 88, 66], n); if (n2 > 0.6) c = AB.mix(c, [150, 150, 110], 0.35); }        // сухая земля и бледная трава
    else if (k === 5) { c = AB.mix([40, 56, 40], [62, 80, 50], n); if (n2 > 0.75) c = AB.mix(c, [120, 70, 150], 0.5); }         // мох и фиолетовые травы
    else if (k === 6) { // сочная трава и мох: тёмные моховые пятна, светлые проплешины, розово-лиловые споры
      const n3 = AB.noise(wx / 55, wy / 55, seed + 73);
      c = AB.mix([52, 104, 50], [96, 148, 66], n); c = AB.mix(c, [34, 72, 42], AB.clamp((n3 - 0.55) * 2.2, 0, 0.7));
      if (n3 < 0.3) c = AB.mix(c, [128, 150, 80], 0.35);
      if (n2 > 0.8) c = AB.mix(c, [200, 120, 200], 0.45); else if (n2 > 0.74) c = AB.mix(c, [230, 150, 170], 0.3);
    }
    else { c = AB.mix([98, 74, 48], [128, 96, 58], n); if (n2 > 0.66) c = AB.mix(c, [200, 120, 50], 0.55); }                   // листва у берлоги
    return AB.mix(c, grass, 0.12);
  }
  // Поляны локаций выросли: перерисовать землю около них и обновить миникарту
  R.onSitesGrow = function (W) {
    if (!W.sgl) return;
    const seen = new Set();
    for (const st of W.sites) {
      const rr = 10 * W.T;
      for (let cy = Math.floor((st.y - rr) / CHUNK); cy <= Math.floor((st.y + rr) / CHUNK); cy++)
        for (let cx = Math.floor((st.x - rr) / CHUNK); cx <= Math.floor((st.x + rr) / CHUNK); cx++) { const key = ckey(cx, cy); if (!seen.has(key) && chunks.has(key)) { seen.add(key); stale.push(key); } }
    }
    if (!mini) return;
    for (let i = 0; i < W.sgl.length; i++) {
      if (!W.sgl[i] || W.ground[i] !== AB.G_SITE) continue;
      const c = [120, 116, 100];
      for (let k = 0; k < 3; k++) mini.base[i * 4 + k] = c[k];
      if (mini.explored[i]) { for (let k = 0; k < 4; k++) mini.img.data[i * 4 + k] = mini.base[i * 4 + k]; mini.dirty = true; }
    }
  };
  // Цвет земли биома: 1 снег, 2 степь, 3 топь, 4 каменистые холмы
  function biomeGround(b, wx, wy, seed, n1, h) {
    const n = AB.noise(wx / 26, wy / 26, seed + 81), n2 = AB.noise(wx / 70, wy / 70, seed + 82);
    if (b === 1) { const c = AB.mix([206, 218, 230], [240, 245, 250], n); return n2 > 0.64 ? AB.mix(c, [170, 190, 212], 0.5) : c; }
    if (b === 2) { const c = AB.mix([176, 150, 78], [214, 190, 108], n); return n2 < 0.35 ? AB.mix(c, [140, 150, 70], 0.45) : n2 > 0.7 ? AB.mix(c, [190, 160, 110], 0.4) : c; }
    if (b === 3) { const c = AB.mix([46, 66, 40], [74, 92, 50], n); return n2 > 0.6 ? AB.mix(c, [62, 52, 36], 0.55) : c; }
    const c = AB.mix([118, 110, 94], [150, 142, 124], n); return n2 < 0.4 ? AB.mix(c, [84, 110, 60], 0.45) : c;
  }
  // Мелкие детали земли биома (травинки, снежные искры, камыш, камешки)
  function biomeDetail(ctx, b, r, lx, ly, T) {
    if (b === 1) {
      for (let k = 0; k < 3; k++) { const x = lx + r() * T, y = ly + r() * T; ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(150,175,205,0.6)'; ctx.fillRect(Math.round(x), Math.round(y), 2, 1); }
      if (r() < 0.06) { const x = lx + r() * T, y = ly + r() * T; ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 5); ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 4); ctx.stroke(); }
    } else if (b === 2) {
      const nt = 3 + (r() * 4 | 0);
      for (let k = 0; k < nt; k++) { const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T), hh = 3 + r() * 5; ctx.strokeStyle = r() < 0.5 ? 'rgba(120,96,40,0.7)' : 'rgba(236,210,130,0.75)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - hh); ctx.stroke(); }
      if (r() < 0.04) { const x = lx + r() * T, y = ly + r() * T; for (let q = 0; q < 4; q++) S().circle(ctx, x + (r() - 0.5) * 8, y + (r() - 0.5) * 5, 1.4, r() < 0.5 ? '#e05a3a' : '#f0e0a0'); }
    } else if (b === 3) {
      if (r() < 0.35) { const x = lx + r() * T, y = ly + r() * T; for (let q = 0; q < 4; q++) { ctx.strokeStyle = q % 2 ? '#6a7a3a' : '#3a4a24'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + q * 2, y); ctx.lineTo(x + q * 2 + (r() - 0.5) * 3, y - 7 - r() * 5); ctx.stroke(); } if (r() < 0.4) S().ell(ctx, x + 3, y - 10, 1.2, 3, '#5a3a22'); }
      if (r() < 0.2) { const x = lx + r() * T, y = ly + r() * T; S().ell(ctx, x, y, 5 + r() * 4, 2.2, 'rgba(30,45,35,0.55)'); }
    } else {
      for (let k = 0; k < 3; k++) { if (r() < 0.5) continue; const x = Math.round(lx + r() * T), y = Math.round(ly + r() * T); ctx.fillStyle = 'rgba(40,36,30,0.6)'; ctx.fillRect(x, y + 1, 4, 2); ctx.fillStyle = '#a8a092'; ctx.fillRect(x, y, 4, 2); }
      if (r() < 0.1) { const x = lx + r() * T, y = ly + r() * T; ctx.fillStyle = '#4a6a34'; for (let q = 0; q < 3; q++) ctx.fillRect(Math.round(x + q * 2), Math.round(y - q % 2), 1, 4); }
    }
  }
  function getChunk(W, cx, cy) {
    const key = ckey(cx, cy);
    let c = chunks.get(key);
    if (!c) { c = bakeChunk(W, cx, cy); chunks.set(key, c); }
    return c;
  }
  // Фоновая выпечка земли в пределах бюджета кадра: сначала окрестности лагеря,
  // потом куски, которые скоро попадут в кадр (с запасом по ходу движения), и перерисовка выросших полян.
  let prevCam = null;
  R.bakeIdle = function (n, budget) {
    if (!worldRef) return;
    const W = worldRef, t0 = performance.now(), ms = budget || 4;
    const more = () => performance.now() - t0 < ms;
    while (n-- > 0 && bakeQueue.length) { const q = bakeQueue.pop(); getChunk(W, q[0], q[1]); if (!more()) return; }
    if (!lastView) return;
    const v = lastView, nC = Math.ceil(W.size / CHUNK);
    // упреждение: смотрим туда, куда движется камера
    let ax = 0, ay = 0;
    if (prevCam) { ax = AB.clamp((v.cx - prevCam.x) * 40, -CHUNK * 1.5, CHUNK * 1.5); ay = AB.clamp((v.cy - prevCam.y) * 40, -CHUNK * 1.5, CHUNK * 1.5); }
    prevCam = { x: v.cx, y: v.cy };
    const m = CHUNK * 1.2;
    const x0 = Math.max(0, Math.floor((Math.min(v.x0, v.x0 + ax) - m) / CHUNK)), x1 = Math.min(nC - 1, Math.floor((Math.max(v.x1, v.x1 + ax) + m) / CHUNK));
    const y0 = Math.max(0, Math.floor((Math.min(v.y0, v.y0 + ay) - m) / CHUNK)), y1 = Math.min(nC - 1, Math.floor((Math.max(v.y1, v.y1 + ay) + m) / CHUNK));
    const fx = v.cx + ax, fy = v.cy + ay;
    for (let guard = 0; guard < 6 && more(); guard++) {
      let best = null, bd = Infinity;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        if (chunks.has(ckey(cx, cy))) continue;
        const d = ((cx + 0.5) * CHUNK - fx) ** 2 + ((cy + 0.5) * CHUNK - fy) ** 2;
        if (d < bd) { bd = d; best = [cx, cy]; }
      }
      if (best) { getChunk(W, best[0], best[1]); continue; }
      // выросшие поляны: перепекаем по одному куску, старый остаётся на экране до готовности
      if (!stale.length) break;
      const key = stale.pop();
      if (chunks.has(key)) chunks.set(key, bakeChunk(W, key % 4096, Math.floor(key / 4096)));
    }
  };
  R.bakeProgress = function () { const t = Math.pow(Math.ceil(worldRef.size / CHUNK), 2); return 1 - bakeQueue.length / t; };
  // Далёкие куски земли выбрасываем из памяти (на большой карте их тысячи)
  function evictChunks(cam) {
    if (chunks.size <= 240) return;
    const ccx = cam.x / CHUNK, ccy = cam.y / CHUNK, keep = [];
    for (const key of chunks.keys()) { const a = key % 4096 + 0.5, b = Math.floor(key / 4096) + 0.5; keep.push([key, Math.max(Math.abs(a - ccx), Math.abs(b - ccy))]); }
    keep.sort((p, q) => q[1] - p[1]);
    for (let i = 0; i < keep.length && chunks.size > 170; i++) if (keep[i][1] > 5) chunks.delete(keep[i][0]);
  }

  /* =========================== МИНИКАРТА =========================== */
  let mini = null;
  function buildMinimap(W) {
    const N = W.N;
    const base = new Uint8ClampedArray(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      let c;
      const g = W.ground[i];
      if (g === AB.G_WATER) c = [40, 92, 110];
      else if (g === AB.G_CAMP || g === AB.G_PATH) c = [128, 100, 64];
      else if (g === AB.G_SITE) c = [120, 116, 100];
      else c = [52, 92, 44];
      if (W.biome && W.biome[i] && g !== AB.G_WATER && g !== AB.G_PATH && g !== AB.G_CAMP) c = AB.mix(c, [[0], [225, 232, 240], [196, 170, 92], [58, 78, 44], [132, 124, 108]][W.biome[i]], W.bmix[i]);
      if (W.biome && W.biome[i] === 1 && g === AB.G_WATER) c = [170, 205, 225];
      if (W.treeAt[i] >= 0) c = W.biome && W.biome[i] === 1 && W.bmix[i] > 0.5 ? [40, 80, 70] : [24, 52, 30];
      if (W.rockAt[i] >= 0) { const rk = W.rocks[W.rockAt[i]]; c = rk && rk.kind === 'ore' ? (rk.ore === 'iron' ? [196, 110, 70] : [200, 196, 184]) : [110, 110, 110]; }
      base[i * 4] = c[0]; base[i * 4 + 1] = c[1]; base[i * 4 + 2] = c[2]; base[i * 4 + 3] = 255;
    }
    const cv = AB.canvas(N, N), ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { img.data[i * 4] = 8; img.data[i * 4 + 1] = 14; img.data[i * 4 + 2] = 12; img.data[i * 4 + 3] = 255; }
    mini = { base, cv, ctx, img, explored: new Uint8Array(N * N), dirty: true, t: 0 };
  }
  R.explore = function (W, x, y, rad) {
    if (!mini) return;
    const N = W.N, T = W.T, tr = Math.ceil(rad / T), cx = Math.floor(x / T), cy = Math.floor(y / T);
    const FR = W.G ? AB.Sim.fowRadius(W.G) : Infinity, fr2 = FR < Infinity ? (FR / T) ** 2 : Infinity, kx = W.camp.x / T, ky = W.camp.y / T;
    for (let ty = cy - tr; ty <= cy + tr; ty++) for (let tx = cx - tr; tx <= cx + tr; tx++) {
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      if ((tx + 0.5 - kx) ** 2 + (ty + 0.5 - ky) ** 2 > fr2) continue; // за туманом войны не разведать
      const i = ty * N + tx;
      if (mini.explored[i]) continue;
      if ((tx - cx) * (tx - cx) + (ty - cy) * (ty - cy) > tr * tr) continue;
      mini.explored[i] = 1;
      for (let k = 0; k < 4; k++) mini.img.data[i * 4 + k] = mini.base[i * 4 + k];
      mini.dirty = true;
    }
  };
  // Открытая часть миникарты для сохранения: серии «закрыто, открыто, закрыто…» по всем клеткам (область сплошная - строка короткая)
  R.exploredDump = function () {
    if (!mini) return null;
    const e = mini.explored, runs = []; let cur = 0, n = 0;
    for (let i = 0; i < e.length; i++) { if (e[i] === cur) n++; else { runs.push(n); cur = e[i]; n = 1; } }
    runs.push(n);
    return runs.join(',');
  };
  R.exploredLoad = function (str) {
    if (!mini || typeof str !== 'string') return;
    const e = mini.explored; let i = 0, cur = 0;
    for (const s of str.split(',')) {
      const n = +s || 0;
      if (cur) for (let k = i; k < Math.min(e.length, i + n); k++) { e[k] = 1; for (let c = 0; c < 4; c++) mini.img.data[k * 4 + c] = mini.base[k * 4 + c]; }
      i += n; cur = 1 - cur;
    }
    mini.dirty = true;
  };
  R.isExplored = function (W, x, y) { if (!mini) return false; const tx = Math.floor(x / W.T), ty = Math.floor(y / W.T); return !!mini.explored[ty * W.N + tx]; };

  /* ============================ ПЕРСОНАЖИ ============================ */
  const OUTFITS = {
    hunter:     { body: '#3f7a3a', bodyD: '#2a5428', hood: '#4f9a44', hoodD: '#2f6a2a', skin: '#f0c7a0', pack: '#7a5230', tag: '#57c26a', hat: 'hood' },
    engineer:   { body: '#d0782a', bodyD: '#8a4a18', hood: '#f0c030', hoodD: '#a07a18', skin: '#e8b890', pack: '#5e4a3a', tag: '#ffb23a', hat: 'helmet' },
    programmer: { body: '#2f4f8a', bodyD: '#1f3460', hood: '#26324a', hoodD: '#161e30', skin: '#f0c7a0', pack: '#3a3a4a', tag: '#5aa8ff', hat: 'phones' },
    architect:  { body: '#7a4a9a', bodyD: '#503068', hood: '#e8dcc0', hoodD: '#b0a080', skin: '#e8b890', pack: '#6a5a40', tag: '#d08aff', hat: 'helmet' },
  };
  const outfitOf = (p) => OUTFITS[p.prof] || OUTFITS.hunter;
  R.outfitOf = outfitOf;
  // цвета надетой одежды (или профессии, если ячейка пуста)
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  function gearLook(p) {
    const o = outfitOf(p), eq = p.eq || {}, B = (it) => it ? AB.Sim.itemBase(it) : null;
    const hb = B(eq.head), bb = B(eq.body), hn = B(eq.hands), lg = B(eq.legs), ft = B(eq.feet);
    const rc = (it) => it && it.r >= 1 ? C().GEAR.rarity[it.r].color : null; // окантовка - только у вещей выше обычной
    return {
      o, body: bb ? bb.c : o.body, bodyD: bb ? shade(bb.c, 0.62) : o.bodyD, bodyId: bb ? bb.id : null,
      head: hb ? hb.look : o.hat === 'helmet' ? 'helmP' : o.hat === 'phones' ? 'phones' : 'hoodP', headC: hb ? hb.c : o.hood, headD: hb ? shade(hb.c, 0.65) : o.hoodD,
      hand: hn ? hn.c : o.skin, legs: lg ? lg.c : '#4a3f33', legsId: lg ? lg.id : null, boot: ft ? ft.c : '#4a3526', handsId: hn ? hn.id : null, feetId: ft ? ft.id : null,
      legend: Object.values(eq).some(it => it && it.r >= 3), trims: [eq.head, eq.body, eq.hands, eq.legs, eq.feet].map(rc),
    };
  }
  R.gearLook = gearLook;
  // Портрет героя для окна снаряжения
  R.drawHero = function (cv, p) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    const k = cv.width / 42;
    ctx.save(); ctx.scale(k / (C().PLAYER_SCALE || 1), k / (C().PLAYER_SCALE || 1));
    const K = C().PLAYER_SCALE || 1;
    drawPlayer(ctx, Object.assign({}, p, { x: 21 * K, y: 38 * K, a: Math.PI / 2, moving: false, sw: 0, hurt: 0, dead: false, sh: 0, slowT: 0, _noTag: true }), R.time || 0);
    ctx.restore();
  };
  // Значок вещи (кешируется как картинка)
  const iconCache = {};
  R.itemIcon = function (it) {
    const key = it.b + ':' + it.r;
    if (iconCache[key]) return iconCache[key];
    const cv = AB.canvas(48, 48), ctx = cv.getContext('2d'), base = AB.Sim.itemBase(it), c = base.c || '#888', d = shade(c, 0.6), O = '#120c08';
    const col = C().GEAR.rarity[it.r].color;
    const g = ctx.createRadialGradient(24, 24, 4, 24, 24, 26); g.addColorStop(0, col + '55'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 48, 48);
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.5; ctx.strokeStyle = O;
    const fillStroke = () => { ctx.fillStyle = c; ctx.fill(); ctx.stroke(); };
    if (it.s === 'head') {
      if (base.look === 'helm') { ctx.beginPath(); ctx.arc(24, 27, 14, Math.PI, 0); ctx.lineTo(38, 32); ctx.lineTo(10, 32); ctx.closePath(); fillStroke(); ctx.fillStyle = d; ctx.fillRect(10, 28, 28, 4); ctx.fillStyle = '#c83a2a'; ctx.fillRect(22, 8, 4, 6); }
      else if (base.look === 'hat') { ctx.beginPath(); ctx.ellipse(24, 32, 19, 6, 0, 0, TAU); ctx.fillStyle = d; ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.rect(15, 14, 18, 17); fillStroke(); ctx.fillStyle = '#d8b050'; ctx.fillRect(15, 25, 18, 3); }
      else if (base.look === 'band') { ctx.beginPath(); ctx.arc(24, 28, 13, Math.PI, 0); ctx.closePath(); fillStroke(); ctx.beginPath(); ctx.moveTo(36, 27); ctx.lineTo(44, 36); ctx.lineTo(38, 38); ctx.closePath(); fillStroke(); ctx.fillStyle = '#fff'; for (let i = 14; i < 36; i += 6) ctx.fillRect(i, 20, 2, 2); }
      else if (base.look === 'hood') { ctx.beginPath(); ctx.moveTo(10, 38); ctx.quadraticCurveTo(8, 10, 24, 8); ctx.quadraticCurveTo(40, 10, 38, 38); ctx.closePath(); fillStroke(); ctx.fillStyle = '#1a120c'; ctx.beginPath(); ctx.ellipse(24, 27, 8, 9, 0, 0, TAU); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(24, 27, 13, Math.PI, 0); ctx.closePath(); fillStroke(); ctx.beginPath(); ctx.ellipse(33, 28, 10, 3.5, 0, 0, TAU); ctx.fillStyle = d; ctx.fill(); ctx.stroke(); }
    } else if (it.s === 'body') { ctx.beginPath(); ctx.moveTo(15, 10); ctx.lineTo(8, 16); ctx.lineTo(11, 25); ctx.lineTo(15, 23); ctx.lineTo(15, 40); ctx.lineTo(33, 40); ctx.lineTo(33, 23); ctx.lineTo(37, 25); ctx.lineTo(40, 16); ctx.lineTo(33, 10); ctx.lineTo(28, 13); ctx.lineTo(20, 13); ctx.closePath(); fillStroke(); ctx.fillStyle = d; ctx.fillRect(15, 30, 18, 3); if (base.id === 'mail') { ctx.strokeStyle = d; ctx.lineWidth = 1; for (let y2 = 17; y2 < 38; y2 += 4) { ctx.beginPath(); ctx.moveTo(16, y2); ctx.lineTo(32, y2); ctx.stroke(); } } }
    else if (it.s === 'hands') { ctx.beginPath(); ctx.moveTo(15, 40); ctx.lineTo(15, 22); ctx.quadraticCurveTo(15, 12, 22, 12); ctx.lineTo(30, 12); ctx.quadraticCurveTo(36, 12, 36, 20); ctx.lineTo(36, 28); ctx.lineTo(41, 24); ctx.lineTo(43, 28); ctx.lineTo(34, 40); ctx.closePath(); fillStroke(); ctx.fillStyle = d; ctx.fillRect(15, 34, 19, 5); }
    else if (it.s === 'legs') { ctx.beginPath(); ctx.moveTo(13, 8); ctx.lineTo(35, 8); ctx.lineTo(37, 42); ctx.lineTo(27, 42); ctx.lineTo(24, 20); ctx.lineTo(21, 42); ctx.lineTo(11, 42); ctx.closePath(); fillStroke(); ctx.fillStyle = d; ctx.fillRect(13, 8, 22, 4); }
    else { ctx.beginPath(); ctx.moveTo(14, 8); ctx.lineTo(26, 8); ctx.lineTo(26, 28); ctx.lineTo(38, 32); ctx.quadraticCurveTo(42, 34, 41, 40); ctx.lineTo(14, 40); ctx.closePath(); fillStroke(); ctx.fillStyle = d; ctx.fillRect(14, 36, 27, 4); }
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(16, 14, 3, 8);
    return (iconCache[key] = cv.toDataURL());
  };
  function drawPlayer(ctx, p, t) {
    const L = gearLook(p), o = L.o, K = C().PLAYER_SCALE || 1;
    const x = p.x, y = p.y, a = p.a || 0;
    const ph = p._walk || 0, mv = p.moving && !p.dead;
    const bob = mv ? Math.abs(Math.sin(ph)) * 1.6 : Math.sin(t * 2) * 0.4;
    const O = '#120c08';
    const detail = !R.lowQ; // детали одежды и искры - не в облегчённой графике
    ctx.save();
    ctx.translate(x, y); ctx.scale(K, K); ctx.translate(-x, -y);
    if (detail && !p.dead) { // наклон вперёд на ходу (на бегу сильнее), отдача в начале удара, «дыхание» на месте
      const lean = mv ? Math.cos(a) * (p.run ? 0.13 : 0.06) : 0;
      const rk = p.sw > 0.18 ? (p.sw - 0.18) / 0.12 : 0, sa = p.sa === undefined ? a : p.sa;
      ctx.translate(x - Math.cos(sa) * rk * 1.6, y + 9 - Math.sin(sa) * rk * 1.2); ctx.rotate(lean); ctx.scale(1, 1 + (mv ? 0 : Math.sin(t * 2) * 0.015)); ctx.translate(-x, -(y + 9));
    }
    if (p.dead) { ctx.globalAlpha = 0.5; ctx.translate(x, y); ctx.rotate(1.3); ctx.translate(-x, -y); }
    S().ell(ctx, x, y + 9, 12, 5, 'rgba(0,0,0,0.35)');
    if (L.legend && !p.dead) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().ell(ctx, x, y + 8, 15, 6, `rgba(255,150,60,${0.18 + Math.sin(t * 3) * 0.06})`); ctx.restore(); }
    // ноги: штаны и обувь
    const perp = a + Math.PI / 2;
    const by = y - 3 - bob;
    for (const side of [-1, 1]) {
      const step = mv ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 4 : 0;
      const fx = x + Math.cos(perp) * side * 4.5 + Math.cos(a) * step, fy = y + 6 + Math.sin(perp) * side * 2 + Math.sin(a) * step * 0.6;
      const hx0 = x + Math.cos(perp) * side * 3.5, hy0 = by + 5;
      ctx.strokeStyle = O; ctx.lineWidth = 5.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(fx, fy - 1.5); ctx.stroke();
      ctx.strokeStyle = L.legsId === 'baggy' ? L.legs : L.legs; ctx.lineWidth = L.legsId === 'baggy' ? 4.4 : 3.4; ctx.stroke();
      if (L.legsId === 'greave') { ctx.strokeStyle = '#c8d0d8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(AB.lerp(hx0, fx, 0.45) - 1.5, AB.lerp(hy0, fy, 0.45)); ctx.lineTo(AB.lerp(hx0, fx, 0.45) + 1.5, AB.lerp(hy0, fy, 0.45)); ctx.stroke(); }
      if (detail) {
        const kx = AB.lerp(hx0, fx, 0.45), ky = AB.lerp(hy0, fy, 0.45);
        if (L.legsId === 'greave') { S().circle(ctx, kx, ky, 2.3, O); S().circle(ctx, kx, ky, 1.7, '#c8d0d8'); } // наколенник
        else if (L.legsId === 'baggy') { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(kx - 1.6, ky - 1); ctx.lineTo(kx + 1.6, ky + 0.6); ctx.stroke(); } // складка
        if (L.feetId === 'jboots') { ctx.strokeStyle = O; ctx.lineWidth = 4.6; ctx.beginPath(); ctx.moveTo(AB.lerp(fx, hx0, 0.5), AB.lerp(fy - 1.5, hy0, 0.5)); ctx.lineTo(fx, fy - 1.5); ctx.stroke(); ctx.strokeStyle = L.boot; ctx.lineWidth = 3.4; ctx.stroke(); } // голенище
      }
      S().ell(ctx, fx, fy, 3.8, 2.9, O); S().ell(ctx, fx, fy - 0.6, 2.8, 2, L.boot); S().ell(ctx, fx - 0.6, fy - 1.2, 1.2, 0.6, 'rgba(255,255,255,0.25)');
      if (detail && L.feetId === 'mocs') { ctx.strokeStyle = shade(L.boot, 0.7); ctx.lineWidth = 0.7; for (const d of [-1.6, 0, 1.6]) { ctx.beginPath(); ctx.moveTo(fx + d, fy + 1.4); ctx.lineTo(fx + d * 1.2, fy + 3); ctx.stroke(); } } // бахрома
      if (detail && L.trims[4]) { ctx.strokeStyle = L.trims[4]; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(fx, fy - 0.6, 3.2, 2.3, 0, 0, TAU); ctx.stroke(); }
    }
    const facingUp = Math.sin(a) < -0.35;
    // рюкзак (сзади)
    const bx = x - Math.cos(a) * 7, bky = by - Math.sin(a) * 4;
    const drawPack = () => { ctx.fillStyle = O; roundRect(ctx, bx - 7, bky - 7, 14, 13, 3); ctx.fill(); ctx.fillStyle = o.pack; roundRect(ctx, bx - 6, bky - 6, 12, 11, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx - 5, bky - 5, 10, 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx - 1, bky - 6, 2, 11); };
    if (!facingUp) drawPack();
    // тело
    if (detail && L.bodyId === 'robe') { // подол качается при ходьбе
      const sw2 = mv ? Math.sin(ph) * 1.6 : Math.sin(t * 1.5) * 0.5;
      ctx.beginPath(); ctx.moveTo(x - 9, by + 1); ctx.quadraticCurveTo(x - 11 + sw2, by + 8, x - 10 + sw2, by + 12); ctx.lineTo(x + 10 + sw2, by + 12); ctx.quadraticCurveTo(x + 11 + sw2, by + 8, x + 9, by + 1); ctx.closePath();
      ctx.fillStyle = L.bodyD; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 1.3; ctx.stroke();
      if (L.trims[1]) { ctx.strokeStyle = L.trims[1]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 10 + sw2, by + 11.3); ctx.lineTo(x + 10 + sw2, by + 11.3); ctx.stroke(); }
    }
    S().circle(ctx, x, by, 10.5, O);
    const g = ctx.createRadialGradient(x - 3, by - 4, 1, x, by, 10);
    g.addColorStop(0, L.body); g.addColorStop(1, L.bodyD);
    S().circle(ctx, x, by, 9.2, g);
    if (L.bodyId === 'mail') { ctx.strokeStyle = 'rgba(40,44,50,0.45)'; ctx.lineWidth = 0.8; for (let i = -6; i <= 6; i += 3) { ctx.beginPath(); ctx.arc(x + i, by - 2, 1.4, 0, Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(x + i + 1.5, by + 1.5, 1.4, 0, Math.PI); ctx.stroke(); } }
    else if (L.bodyId === 'robe') { ctx.fillStyle = '#d8b050'; ctx.fillRect(x - 1, by - 8, 2, 16); }
    else if (L.bodyId === 'vest') { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 5, by - 6, 1.5, 10); ctx.fillRect(x + 3.5, by - 6, 1.5, 10); }
    else if (L.bodyId === 'jacket') { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 0.6, by - 7, 1.2, 12); for (let i = -4; i <= 2; i += 3) S().circle(ctx, x + 2, by + i, 0.8, '#d8c8a0'); }
    if (detail) {
      if (L.bodyId === 'mail') for (const sd of [-1, 1]) { S().ell(ctx, x + sd * 8.6, by - 4, 3.9, 3, O); S().ell(ctx, x + sd * 8.6, by - 4.4, 3.1, 2.2, '#b4bec8'); S().ell(ctx, x + sd * 8.2, by - 5.2, 1.2, 0.6, 'rgba(255,255,255,0.5)'); } // наплечники
      else if (L.bodyId === 'vest') { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x - 6.5, by - 1, 3.2, 2.6); ctx.fillRect(x + 3.3, by - 1, 3.2, 2.6); } // карманы
      else if (L.bodyId === 'jacket') { ctx.strokeStyle = shade(L.body, 1.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 4.5, by - 8); ctx.lineTo(x, by - 3.5); ctx.lineTo(x + 4.5, by - 8); ctx.stroke(); } // воротник
      else if (L.bodyId === 'shirt') { ctx.strokeStyle = 'rgba(80,50,30,0.7)'; ctx.lineWidth = 0.6; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 1.2, by - 7 + i * 1.6); ctx.lineTo(x + 1.2, by - 6 + i * 1.6); ctx.moveTo(x + 1.2, by - 7 + i * 1.6); ctx.lineTo(x - 1.2, by - 6 + i * 1.6); ctx.stroke(); } } // шнуровка
      if (L.trims[1]) { ctx.strokeStyle = L.trims[1]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, by, 9.4, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke(); } // окантовка цветом редкости
    }
    // ремень с пряжкой
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(x - 8, by + 1.5, 16, 2.4); ctx.fillStyle = '#d8b050'; ctx.fillRect(x - 1.3, by + 1.3, 2.6, 2.8);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(x - 3, by - 4, 3.5, 0, TAU); ctx.fill();
    // оружие и руки (перчатки)
    const swinging = p.sw > 0;
    let wa = a;
    if (swinging) { wa = p.sa; const k = 1 - p.sw / 0.3; wa += AB.lerp(-1.3, 1.1, AB.smooth(Math.min(1, k * 1.4))); }
    const hx = x + Math.cos(wa + 0.35) * 10, hy = by + Math.sin(wa + 0.35) * 7;
    const hand = (hx2, hy2) => {
      if (detail && L.handsId === 'mitts') { S().circle(ctx, hx2, hy2, 4.6, O); S().circle(ctx, hx2, hy2, 3.9, '#efe6d0'); } // меховая оторочка
      S().circle(ctx, hx2, hy2, 3.7, O); S().circle(ctx, hx2, hy2, 2.8, L.hand); S().circle(ctx, hx2 - 0.8, hy2 - 0.8, 0.9, 'rgba(255,255,255,0.3)');
      if (detail && L.handsId === 'bracer') { ctx.strokeStyle = '#d0d8e0'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(hx2, hy2, 3.3, 0, TAU); ctx.stroke(); } // металлический щиток
      if (detail && L.trims[2]) { ctx.strokeStyle = L.trims[2]; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(hx2, hy2, 4.1, 0, TAU); ctx.stroke(); }
    };
    const drawWeaponHand = () => { ctx.save(); ctx.translate(hx, hy); ctx.rotate(wa); if (p.sk === 'pick' && p.sw > 0) drawPickaxe(ctx); else drawAxe(ctx); ctx.restore(); hand(hx, hy); };
    const lhx = x + Math.cos(wa - 0.9) * 9, lhy = by + Math.sin(wa - 0.9) * 6;
    if (facingUp) drawWeaponHand();
    hand(lhx, lhy);
    // голова
    const hy2 = by - 11;
    S().circle(ctx, x, hy2, 8.6, O);
    const gs = ctx.createRadialGradient(x - 2.5, hy2 - 3, 1, x, hy2, 8); gs.addColorStop(0, o.skin); gs.addColorStop(1, shade(o.skin, 0.82));
    S().circle(ctx, x, hy2, 7.5, gs);
    if (!facingUp) {
      const ex = Math.cos(a) * 2.5, ey = Math.max(0, Math.sin(a)) * 1.5;
      ctx.fillStyle = '#1a120c';
      ctx.fillRect(Math.round(x - 3 + ex), Math.round(hy2 + ey), 2, 2.5); ctx.fillRect(Math.round(x + 1.5 + ex), Math.round(hy2 + ey), 2, 2.5);
      ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x - 3 + ex), Math.round(hy2 + ey), 1, 1); ctx.fillRect(Math.round(x + 1.5 + ex), Math.round(hy2 + ey), 1, 1);
      ctx.fillStyle = 'rgba(220,120,110,0.5)'; ctx.fillRect(Math.round(x - 5 + ex), Math.round(hy2 + 3 + ey), 2, 1); ctx.fillRect(Math.round(x + 3.5 + ex), Math.round(hy2 + 3 + ey), 2, 1);
    }
    drawHeadwear(ctx, L, x, hy2, a, facingUp, t);
    if (detail && L.trims[0] && !facingUp) { S().circle(ctx, x + Math.cos(a) * 2, hy2 - 5.5, 1.7, O); S().circle(ctx, x + Math.cos(a) * 2, hy2 - 5.5, 1.1, L.trims[0]); } // камешек редкости
    if (facingUp) drawPack(); else drawWeaponHand();
    if (detail && L.legend && !p.dead) { // искры легендарных вещей
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const an = t * 1.4 + i * 2.1, al = 0.35 + 0.35 * Math.sin(t * 5 + i * 1.7);
        const sx = x + Math.cos(an) * 13, sy = by - 4 + Math.sin(an) * 9, r = 1.6 + al;
        ctx.fillStyle = `rgba(255,200,110,${al})`; ctx.fillRect(sx - r, sy - 0.4, r * 2, 0.8); ctx.fillRect(sx - 0.4, sy - r, 0.8, r * 2);
      }
      ctx.restore();
    }
    ctx.restore();
    if (p.hurt > 0) { ctx.save(); ctx.globalAlpha = p.hurt * 1.5; S().circle(ctx, x, y - 12 * K, 15 * K, 'rgba(255,60,60,0.35)'); ctx.restore(); }
    if (p.slowT > 0 && !p.dead) {
      ctx.strokeStyle = 'rgba(235,240,245,0.75)'; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const an = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + Math.cos(an) * 15, y - 6 + Math.sin(an) * 11); ctx.stroke(); }
      for (const rr of [6, 11]) { ctx.beginPath(); ctx.ellipse(x, y - 6, rr * 1.2, rr, 0, 0, TAU); ctx.stroke(); }
    }
    if (p.sh > 0 && !p.dead) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(210,190,140,${0.45 + Math.sin(t * 4) * 0.15})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y - 5, 16, 19, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(200,180,130,0.08)'; ctx.fill(); ctx.restore();
    }
    if (!p.dead && !p._noTag) nameTag(ctx, x, y - 38 * K - 2, `${p.name} · ${p.level || 1}`, o.tag);
  }
  // Головной убор: из снаряжения (cap/hood/helm/hat/band) или по профессии
  function drawHeadwear(ctx, L, x, hy2, a, up, t) {
    const O = '#120c08', c = L.headC, d = L.headD, look = L.head;
    if (look === 'hoodP' || look === 'hood' || look === 'helmP' || look === 'phones') {
      ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.6, 0, TAU); ctx.clip();
      ctx.fillStyle = c; const cov = up ? 9 : 4.5;
      ctx.beginPath(); ctx.arc(x - Math.cos(a) * 2, hy2 - cov + 1, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = d; ctx.fillRect(x - 9, hy2 - cov + 5, 18, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x - 3, hy2 - 5, 3, 0, TAU); ctx.fill();
      ctx.restore();
      if (look === 'hood') { ctx.strokeStyle = O; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, hy2, 8.4, Math.PI * 0.95, Math.PI * 2.05); ctx.stroke(); }
      if (look === 'helmP') { ctx.fillStyle = O; ctx.fillRect(x - 9, hy2 - 3, 18, 2.5); ctx.fillStyle = d; ctx.fillRect(x - 8.5, hy2 - 3, 17, 1.5); }
      if (look === 'phones') { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, hy2, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); S().circle(ctx, x - 8, hy2 + 1, 2.6, '#5aa8ff'); S().circle(ctx, x + 8, hy2 + 1, 2.6, '#5aa8ff'); }
      return;
    }
    if (look === 'cap') {
      ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.7, 0, TAU); ctx.clip(); ctx.fillStyle = c; ctx.fillRect(x - 9, hy2 - 9, 18, up ? 12 : 6.5); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x - 5, hy2 - 7, 4, 2); ctx.restore();
      if (!up) { ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 5, hy2 - 2.5, 6.5, 2.6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = d; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 5, hy2 - 2.5, 5.6, 1.8, 0, 0, TAU); ctx.fill(); }
      S().circle(ctx, x, hy2 - 7.6, 1.3, d);
    } else if (look === 'helm') {
      ctx.fillStyle = O; ctx.beginPath(); ctx.arc(x, hy2 - 1, 9, Math.PI, 0); ctx.lineTo(x + 9, hy2 + 1); ctx.lineTo(x - 9, hy2 + 1); ctx.fill();
      const gm = ctx.createLinearGradient(x - 8, hy2 - 9, x + 8, hy2); gm.addColorStop(0, '#e8eef4'); gm.addColorStop(1, c);
      ctx.fillStyle = gm; ctx.beginPath(); ctx.arc(x, hy2 - 1, 7.9, Math.PI, 0); ctx.lineTo(x + 7.9, hy2); ctx.lineTo(x - 7.9, hy2); ctx.fill();
      ctx.fillStyle = d; ctx.fillRect(x - 8, hy2 - 1.5, 16, 2); if (!up) { ctx.fillStyle = O; ctx.fillRect(x - 0.8 + Math.cos(a) * 2, hy2 - 1, 1.6, 5); }
      ctx.fillStyle = '#c83a2a'; ctx.fillRect(x - 1, hy2 - 12, 2, 4);
    } else if (look === 'hat') {
      ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(x, hy2 - 4, 12.5, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = d; ctx.beginPath(); ctx.ellipse(x, hy2 - 4, 11.3, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = O; roundRect(ctx, x - 6.5, hy2 - 13, 13, 10, 3); ctx.fill(); ctx.fillStyle = c; roundRect(ctx, x - 5.5, hy2 - 12, 11, 8.5, 2.5); ctx.fill();
      ctx.fillStyle = '#d8b050'; ctx.fillRect(x - 5.5, hy2 - 6, 11, 1.8);
      ctx.fillStyle = '#c8402a'; ctx.beginPath(); ctx.moveTo(x + 5, hy2 - 7); ctx.quadraticCurveTo(x + 10, hy2 - 14, x + 8, hy2 - 16); ctx.quadraticCurveTo(x + 6, hy2 - 11, x + 4, hy2 - 7); ctx.fill();
    } else if (look === 'band') {
      ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.6, 0, TAU); ctx.clip(); ctx.fillStyle = c; ctx.fillRect(x - 9, hy2 - 9, 18, up ? 14 : 6); ctx.fillStyle = '#fff'; for (let i = -6; i < 7; i += 4) ctx.fillRect(x + i, hy2 - 5, 1.2, 1.2); ctx.restore();
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 7, hy2 - 3); ctx.lineTo(x - Math.cos(a) * 13, hy2 + 1 + Math.sin(t * 8) * 1.5); ctx.lineTo(x - Math.cos(a) * 12, hy2 + 4); ctx.fill();
    }
  }
  function drawAxe(ctx) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#120a06'; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(18, 0); ctx.stroke();
    ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.fillStyle = '#120a06'; ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(20, -9); ctx.lineTo(23, -2); ctx.lineTo(18, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0c8cf'; ctx.beginPath(); ctx.moveTo(13.5, -2); ctx.lineTo(20, -7.5); ctx.lineTo(21.5, -2.5); ctx.lineTo(17.5, 0.5); ctx.closePath(); ctx.fill();
  }
  function drawPickaxe(ctx) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#120a06'; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(19, 0); ctx.stroke();
    ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.strokeStyle = '#120a06'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(14, -10); ctx.quadraticCurveTo(21, -1, 14, 10); ctx.stroke();
    ctx.strokeStyle = '#a8b2ba'; ctx.lineWidth = 3; ctx.stroke();
  }
  function nameTag(ctx, x, y, s, col) {
    ctx.font = 'bold 10px "Nunito", system-ui, sans-serif';
    const w = ctx.measureText(s).width + 10;
    ctx.fillStyle = 'rgba(10,16,12,0.8)'; roundRect(ctx, x - w / 2, y - 7, w, 14, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y + 0.5);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  R.roundRect = roundRect;

  /* ============================ МОНСТРЫ ============================ */
  function drawMonster(ctx, m, t) {
    if (m.boss && !m._inner) { drawBoss(ctx, m, t); return; }
    if (m.es && !m._inner) { drawElite(ctx, m, t); return; }
    const shk = m.act && !m.boss && !m._inner ? Math.sin(t * 60) * 1.5 : 0;
    const x = m.x + shk, y = m.y, a = m.a || 0, ph = m._walk || 0;
    if (shk) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x, y - m.r, m.r * 1.3, 'rgba(255,50,30,0.18)'); ctx.restore(); }
    const hurt = m.hurt > 0;
    ctx.save();
    if (m.dying > 0) ctx.globalAlpha = Math.min(1, m.dying);
    if (hurt && !m._inner && !R.lowQ) { const h = Math.min(1, m.hurt * 8); ctx.translate(x, y); ctx.scale(1 + 0.12 * h, 1 - 0.1 * h); ctx.translate(-x, -y); } // сплющивание от удара
    // Выживание: поза замаха - обычный удар отклоняется назад и сжимается, супер раздувается и дрожит
    const wuK = m.wu > 0 ? 1 - m.wu / (m.wuMax || 1) : (m.svPose ? 0.65 : 0);
    const wuSup = m.svPose ? m.svPose === 2 : !!m.sup;
    if (wuK > 0 && !m._inner) {
      ctx.translate(x, y);
      if (wuSup) { const inf = 1 + 0.22 * wuK; ctx.scale(inf, inf); ctx.translate(Math.sin(t * 70) * 1.5, Math.cos(t * 63) * 1.2); }
      else { ctx.translate(-Math.cos(a) * 5 * wuK, -Math.sin(a) * 5 * wuK); ctx.scale(1 + 0.08 * wuK, 1 - 0.14 * wuK); }
      ctx.translate(-x, -y);
    }
    const sc = m.r / 12;
    S().ell(ctx, x, y + 6 * sc, 13 * sc, 5 * sc, 'rgba(0,0,0,0.35)');
    if (m.nodrop && !m._inner) { // подмога босса (без добычи): лиловый круг призыва под ногами
      ctx.strokeStyle = `rgba(190,120,255,${0.55 + Math.sin(t * 4 + m.id) * 0.2})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y + 6 * sc, 15 * sc, 6 * sc, 0, 0, TAU); ctx.stroke();
    }
    const O = '#0c0806';
    if (m.type === 'wolf' || m.type === 'alpha' || m.type === 'bonewolf') {
      const alpha = m.type === 'alpha', bone = m.type === 'bonewolf';
      const P = m._pal || (bone ? BONE_PAL : null);
      const fur = hurt ? '#ffffff' : P ? P.fur : alpha ? '#3a3a44' : '#6b6259', furL = P ? P.furL : alpha ? '#5a5a68' : '#8d837a', furD = P ? P.furD : alpha ? '#22222a' : '#4a4038';
      ctx.translate(x, y - 4 * sc); ctx.rotate(a); ctx.scale(sc, sc);
      // лапы
      for (const [lx, ly, off] of [[7, -6, 0], [7, 6, Math.PI], [-8, -6, Math.PI], [-8, 6, 0]]) {
        const s = Math.sin(ph + off) * 3.5;
        S().ell(ctx, lx + s, ly, 3.2, 2.2, O); S().ell(ctx, lx + s, ly, 2.4, 1.6, furD);
      }
      // хвост
      ctx.strokeStyle = O; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-19, Math.sin(t * 8) * 4, -23, Math.sin(t * 8 + 1) * 5); ctx.stroke();
      ctx.strokeStyle = furD; ctx.lineWidth = 4; ctx.stroke();
      S().ell(ctx, 0, 0, 15, 8.5, O); S().ell(ctx, 0, 0, 13.8, 7.4, fur); S().ell(ctx, -1, -2, 10, 4, furL);
      if (alpha) { ctx.fillStyle = '#7a1c1c'; for (let i = -6; i <= 6; i += 4) ctx.fillRect(i, -1, 2, 2); }
      if (bone) { ctx.strokeStyle = '#4a4438'; ctx.lineWidth = 1.4; for (let i = -7; i <= 5; i += 3) { ctx.beginPath(); ctx.moveTo(i, -6); ctx.lineTo(i + 1, 6); ctx.stroke(); } }
      // голова
      S().ell(ctx, 13, 0, 7.5, 6.5, O); S().ell(ctx, 13, 0, 6.5, 5.5, fur);
      S().ell(ctx, 19, 0, 4, 3, O); S().ell(ctx, 18.5, 0, 3.2, 2.3, furL); S().circle(ctx, 21.5, 0, 1.3, '#111');
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(8, -10); ctx.lineTo(13, -5); ctx.fill(); ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(8, 10); ctx.lineTo(13, 5); ctx.fill();
      const ec = alpha ? '#ff3030' : bone ? '#7ae0ff' : '#ffcc40';
      S().circle(ctx, 15, -2.5, 1.5, ec); S().circle(ctx, 15, 2.5, 1.5, ec);
      if (m.atk > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(20, -2, 3, 1); ctx.fillRect(20, 1, 3, 1); }
    } else if (m.type === 'ghoul') {
      const skin = hurt ? '#ffffff' : '#7c8a5a', skinD = '#4f5c38', rag = '#4a3a4e';
      const bob = Math.sin(ph) * 1.5;
      ctx.translate(x, y - 6);
      S().circle(ctx, 0, 0 + bob, 10.5, O);
      S().circle(ctx, 0, bob, 9.3, rag);
      ctx.fillStyle = '#3a2a3e'; ctx.fillRect(-8, 2 + bob, 16, 3);
      // руки вперёд
      for (const side of [-1, 1]) {
        const reach = 13 + Math.sin(ph + side) * 2 + (m.atk > 0 ? 5 : 0);
        const ax = Math.cos(a + side * 0.45) * reach, ay = Math.sin(a + side * 0.45) * reach * 0.7 + bob;
        ctx.strokeStyle = O; ctx.lineWidth = 5.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(Math.cos(a + side * 1.2) * 6, Math.sin(a + side * 1.2) * 4 + bob); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.strokeStyle = skin; ctx.lineWidth = 3.5; ctx.stroke();
        S().circle(ctx, ax, ay, 2.8, skinD);
      }
      S().circle(ctx, 0, -10 + bob, 8, O); S().circle(ctx, 0, -10 + bob, 7, skin);
      S().circle(ctx, -2, -12 + bob, 3, 'rgba(255,255,255,0.12)');
      if (Math.sin(a) > -0.4) {
        const ex = Math.cos(a) * 2.5;
        S().circle(ctx, -2.5 + ex, -10 + bob, 1.6, '#e8f040'); S().circle(ctx, 2.5 + ex, -10 + bob, 1.6, '#e8f040');
        ctx.fillStyle = '#2a1a10'; ctx.fillRect(-2 + ex, -6 + bob, 4, 1.5);
      }
      ctx.fillStyle = skinD; ctx.fillRect(-4, -16 + bob, 2, 3); ctx.fillRect(2, -17 + bob, 2, 2);
    } else if (m.type === 'shade') {
      ctx.translate(x, y - 10);
      ctx.globalAlpha *= 0.88;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
      g.addColorStop(0, hurt ? '#ffffff' : '#3a2458'); g.addColorStop(0.7, '#1a0f2a'); g.addColorStop(1, 'rgba(10,5,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const an = (i / 24) * TAU;
        const rr = 13 + Math.sin(an * 5 + t * 6) * 2.5 + (Math.sin(an) > 0.3 ? Math.sin(t * 8 + an * 3) * 4 + 5 : 0);
        const px = Math.cos(an) * rr, py = Math.sin(an) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.fill();
      const ex = Math.cos(a) * 3;
      S().ell(ctx, -4 + ex, -2, 4, 3, 'rgba(127,240,255,0.35)'); S().ell(ctx, 4 + ex, -2, 4, 3, 'rgba(127,240,255,0.35)');
      S().ell(ctx, -4 + ex, -2, 2.2, 1.5, '#aef8ff'); S().ell(ctx, 4 + ex, -2, 2.2, 1.5, '#aef8ff');
    } else if (m.type === 'brute') {
      const P = m._pal;
      const skin = hurt ? '#ffffff' : P ? P.skin : '#4f6a3a', skinD = P ? P.skinD : '#33472a', skinL = P ? P.skinL : '#6d8a4a';
      const bob = Math.sin(ph * 0.8) * 2;
      ctx.translate(x, y - 10);
      // дубина
      const swing = m.atk > 0 ? 1.2 : Math.sin(t * 2) * 0.1;
      ctx.save(); ctx.rotate(a + 0.9 - swing); ctx.translate(18, 0);
      ctx.strokeStyle = O; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(24, 0); ctx.stroke();
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 5.5; ctx.stroke();
      S().ell(ctx, 26, 0, 8, 6.5, O); S().ell(ctx, 26, 0, 7, 5.5, '#5a3e26');
      ctx.fillStyle = '#bbb'; ctx.fillRect(28, -5, 2, 2); ctx.fillRect(24, 3, 2, 2);
      ctx.restore();
      S().ell(ctx, 0, bob, 21, 17, O); S().ell(ctx, 0, bob, 19.5, 15.5, skin); S().ell(ctx, -5, -4 + bob, 11, 7, skinL);
      ctx.fillStyle = '#5a4030'; ctx.fillRect(-18, 6 + bob, 36, 5);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(-18, 6 + bob, 36, 1.5);
      S().circle(ctx, 0, -17 + bob, 10.5, O); S().circle(ctx, 0, -17 + bob, 9.3, skin);
      ctx.fillStyle = '#e8e0cc'; ctx.beginPath(); ctx.moveTo(-8, -22 + bob); ctx.lineTo(-13, -31 + bob); ctx.lineTo(-5, -25 + bob); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8, -22 + bob); ctx.lineTo(13, -31 + bob); ctx.lineTo(5, -25 + bob); ctx.fill();
      if (Math.sin(a) > -0.4) {
        const ex = Math.cos(a) * 3;
        S().circle(ctx, -3.5 + ex, -17 + bob, 2, '#ff3a2a'); S().circle(ctx, 3.5 + ex, -17 + bob, 2, '#ff3a2a');
        ctx.fillStyle = '#e8e0cc'; ctx.fillRect(-4 + ex, -12 + bob, 2, 3); ctx.fillRect(2 + ex, -12 + bob, 2, 3);
      }
      ctx.fillStyle = skinD; ctx.fillRect(-10, -2 + bob, 20, 2);
    } else if (m.type === 'spider') {
      ctx.translate(x, y - 5); ctx.rotate(a);
      ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const w = Math.sin(ph * 1.5 + i + (s > 0 ? Math.PI : 0)) * 2.5, bx = 4 - i * 3;
        ctx.beginPath(); ctx.moveTo(bx, s * 3); ctx.lineTo(bx + 2 + w, s * 9); ctx.lineTo(bx - 1 + w, s * 13); ctx.stroke();
      }
      S().ell(ctx, -5, 0, 7.5, 6.5, O); S().ell(ctx, -5, 0, 6.5, 5.5, hurt ? '#fff' : '#2a2030'); S().ell(ctx, -7, -2, 3, 2, '#4a3a55');
      ctx.fillStyle = '#b8302a'; ctx.fillRect(-7, -1, 4, 2);
      S().ell(ctx, 4, 0, 4.5, 4, O); S().ell(ctx, 4, 0, 3.6, 3.2, hurt ? '#fff' : '#3a2e44');
      S().circle(ctx, 6, -1.5, 1, '#ff4a3a'); S().circle(ctx, 6, 1.5, 1, '#ff4a3a'); S().circle(ctx, 7, 0, 0.8, '#ff4a3a');
    } else if (SITE_MON[m.type]) {
      SITE_MON[m.type](ctx, m, t, x, y, a, ph, hurt, O);
    } else if (m.type === 'spitter') {
      const bob = Math.sin(ph) * 1.2, puff = m.atk > 0 ? 1.15 : 1;
      ctx.translate(x, y - 8);
      S().ell(ctx, 0, bob, 12, 11, O); S().ell(ctx, 0, bob, 10.8, 9.8, hurt ? '#fff' : '#5a7a2a');
      for (let i = 0; i < 5; i++) S().circle(ctx, -6 + i * 3, -3 + (i % 2) * 5 + bob, 1.8, '#8fb04a');
      S().circle(ctx, 0, -11 + bob, 8 * puff, O); S().circle(ctx, 0, -11 + bob, 7 * puff, hurt ? '#fff' : '#7a9a3a');
      const ex = Math.cos(a) * 3, ey = Math.sin(a) * 2;
      S().circle(ctx, ex - 2.5, -12 + bob + ey, 1.6, '#f0ff60'); S().circle(ctx, ex + 2.5, -12 + bob + ey, 1.6, '#f0ff60');
      S().ell(ctx, ex * 1.6, -8 + bob + ey * 1.5, 3 * puff, 2.2 * puff, '#2a3a10');
    } else if (m.type === 'skeleton') {
      const bone = hurt ? '#ffffff' : '#ddd6c2', boneD = '#8a8474';
      const bob = Math.sin(ph) * 1.5;
      ctx.translate(x, y - 8);
      ctx.strokeStyle = O; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (const s of [-1, 1]) { const sw = Math.sin(ph + (s > 0 ? Math.PI : 0)) * 3; ctx.beginPath(); ctx.moveTo(s * 3, 4); ctx.lineTo(s * 3 + sw, 15); ctx.stroke(); }
      ctx.strokeStyle = boneD; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const sw = Math.sin(ph + (s > 0 ? Math.PI : 0)) * 3; ctx.beginPath(); ctx.moveTo(s * 3, 4); ctx.lineTo(s * 3 + sw, 15); ctx.stroke(); }
      ctx.strokeStyle = O; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, -8 + bob); ctx.lineTo(0, 4 + bob); ctx.stroke();
      ctx.strokeStyle = bone; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, -8 + bob); ctx.lineTo(0, 4 + bob); ctx.stroke();
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) { const ry = -6 + bob + i * 4; ctx.beginPath(); ctx.moveTo(-6, ry); ctx.lineTo(6, ry); ctx.stroke(); }
      const reach = m.atk > 0 ? 6 : 0;
      ctx.strokeStyle = O; ctx.lineWidth = 4.5;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 2, -6 + bob); ctx.lineTo(Math.cos(a) * (10 + reach) + s * 2, Math.sin(a) * 6 - 4 + bob); ctx.stroke(); }
      S().circle(ctx, 0, -13 + bob, 7, O); S().circle(ctx, 0, -13 + bob, 5.8, bone);
      const ex = Math.cos(a) * 2;
      S().circle(ctx, -2 + ex, -14 + bob, 1.6, '#ff3a2a'); S().circle(ctx, 2 + ex, -14 + bob, 1.6, '#ff3a2a');
      ctx.fillStyle = boneD; ctx.fillRect(-1.5 + ex, -11 + bob, 3, 1.6);
    } else if (m.type === 'zombie') {
      const skin = hurt ? '#ffffff' : '#6f8a4a', skinD = '#465c2a';
      const bob = Math.sin(ph * 0.7) * 2, sc = m.r / 13;
      ctx.translate(x, y - 8); ctx.scale(sc, sc);
      S().ell(ctx, 0, bob + 2, 12, 11, O); S().ell(ctx, 0, bob + 2, 10.5, 9.5, skin);
      ctx.fillStyle = skinD; ctx.fillRect(-8, bob + 6, 16, 3);
      ctx.strokeStyle = O; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (const s of [-1, 1]) { const sw = Math.sin(ph * 0.7 + s) * 2; ctx.beginPath(); ctx.moveTo(s * 5, bob + 8); ctx.lineTo(s * 5 + sw, bob + 20); ctx.stroke(); }
      for (const s of [-1, 1]) { const reach = 12 + (m.atk > 0 ? 5 : 0); const ax = Math.cos(a + s * 0.4) * reach, ay = Math.sin(a + s * 0.4) * reach * 0.6 + bob; ctx.beginPath(); ctx.moveTo(s * 8, bob); ctx.lineTo(ax, ay); ctx.stroke(); }
      S().circle(ctx, 0, -11 + bob, 8, O); S().circle(ctx, 0, -11 + bob, 6.8, skin);
      const ex = Math.cos(a) * 2.5;
      S().circle(ctx, -2.5 + ex, -12 + bob, 1.7, '#e8f040'); S().circle(ctx, 2.5 + ex, -12 + bob, 1.7, '#e8f040');
      ctx.fillStyle = '#2a1a10'; ctx.fillRect(-2 + ex, -8 + bob, 4, 1.6);
    } else if (m.type === 'archer') {
      const bone = hurt ? '#ffffff' : '#d5cdb4';
      const bob = Math.sin(ph) * 1.2;
      ctx.translate(x, y - 8);
      ctx.strokeStyle = O; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -6 + bob); ctx.lineTo(0, 8); ctx.stroke();
      ctx.strokeStyle = bone; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -6 + bob); ctx.lineTo(0, 8); ctx.stroke();
      ctx.strokeStyle = O; ctx.lineWidth = 4;
      for (const s of [-1, 1]) { const sw = Math.sin(ph + (s > 0 ? Math.PI : 0)) * 2.5; ctx.beginPath(); ctx.moveTo(s * 2.5, 8); ctx.lineTo(s * 2.5 + sw, 17); ctx.stroke(); }
      ctx.save(); ctx.rotate(a);
      ctx.strokeStyle = O; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(12, 0, 9, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(12, 0, 9, -1.2, 1.2); ctx.stroke();
      const drawn = m.atk > 0 ? 4 : 0;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(12 + Math.cos(-1.2) * 9, Math.sin(-1.2) * 9); ctx.lineTo(12 - drawn, 0); ctx.lineTo(12 + Math.cos(1.2) * 9, Math.sin(1.2) * 9); ctx.stroke();
      ctx.restore();
      S().circle(ctx, 0, -11 + bob, 6, O); S().circle(ctx, 0, -11 + bob, 5, bone);
      const ex = Math.cos(a) * 2;
      S().circle(ctx, -2 + ex, -12 + bob, 1.5, '#7ae0ff'); S().circle(ctx, 2 + ex, -12 + bob, 1.5, '#7ae0ff');
    } else if (m.type === 'lich') {
      const robe = hurt ? '#ffffff' : '#2a1a3e', trim = '#9b6ad8';
      const bob = Math.sin(ph * 0.9) * 1.5, sc = m.r / 15;
      ctx.translate(x, y - 10); ctx.scale(sc, sc);
      const g = ctx.createRadialGradient(0, -4, 2, 0, -4, 20);
      g.addColorStop(0, 'rgba(155,106,216,0.5)'); g.addColorStop(1, 'rgba(155,106,216,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -4, 20, 0, TAU); ctx.fill();
      S().ell(ctx, 0, bob + 4, 11, 13, O); S().ell(ctx, 0, bob + 4, 9.5, 11.5, robe);
      ctx.fillStyle = trim; ctx.fillRect(-9, bob + 8, 18, 2);
      const sx = Math.cos(a) * 14, sy = Math.sin(a) * 14 - 6 + bob;
      ctx.strokeStyle = O; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(6, bob + 6); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(6, bob + 6); ctx.lineTo(sx, sy); ctx.stroke();
      S().circle(ctx, sx, sy, 4, O); S().circle(ctx, sx, sy, 3, trim); S().circle(ctx, sx, sy, 1.5, '#e8d8ff');
      S().circle(ctx, 0, -12 + bob, 7, O); S().circle(ctx, 0, -12 + bob, 5.8, hurt ? '#fff' : '#cfc4ae');
      ctx.fillStyle = trim;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 4 - 1.5, -17 + bob); ctx.lineTo(i * 4, -22 + bob); ctx.lineTo(i * 4 + 1.5, -17 + bob); ctx.fill(); }
      const ex = Math.cos(a) * 2;
      S().circle(ctx, -2 + ex, -13 + bob, 1.7, '#c86aff'); S().circle(ctx, 2 + ex, -13 + bob, 1.7, '#c86aff');
    }
    ctx.restore();
    if (wuK > 0 && (wuSup || (m.boss && m.act)) && !m._inner) { // пульс контура супер-замаха (и приёма босса)
      const pl = 0.45 + Math.sin(t * 10) * 0.3, rr = m.r * (1.2 + 0.15 * wuK);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,${Math.round(255 - 170 * wuK)},${Math.round(255 - 170 * wuK)},${pl})`;
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(x, y - m.r * 0.3, rr, rr * 0.8, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    // статусы
    if (m.burn) { if (Math.random() < 0.3) AB.FX.add({ t: 'spark', x: x + (Math.random() - 0.5) * m.r, y: y - m.r, z: 5, vx: 0, vy: 0, vz: 30, g: -30, life: 0.5, size: 1.6, c: Math.random() < 0.5 ? '#ff9a2a' : '#ffd24a' }); }
    if (m.slowT > 0) { ctx.strokeStyle = 'rgba(150,220,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 4, m.r + 3, (m.r + 3) * 0.45, 0, 0, TAU); ctx.stroke(); }
    if (m.mark > 0) { ctx.save(); ctx.translate(x, y - m.r * 2.4 - 24); ctx.rotate(t * 2); ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke(); ctx.restore(); }
    if (m._inner) return;
    // полоса здоровья и уровень
    const w = Math.max(24, m.r * 2.4), hy = y - m.r * 2.4 - 14;
    if (!(m.dying > 0)) lvBadge(ctx, x - w / 2 - 3, hy + 1.5, m.lv);
    if (m.hp < m.maxHp || m.guard) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = m.guard ? '#e04a3a' : '#c83a3a'; ctx.fillRect(x - w / 2, hy, w * AB.clamp(m.hp / m.maxHp, 0, 1), 3);
      if (m.guard && (m.type === 'brute' || m.type === 'alpha')) {
        ctx.font = 'bold 9px system-ui'; ctx.fillStyle = '#ffb0a0'; ctx.textAlign = 'center'; ctx.fillText(AB.monDef(m.type).name, x, hy - 5);
      }
    }
    if (!m._inner && AB.Survival && AB.Survival.on(G_ref)) { // Выживание: аффиксы элиты - цветное кольцо и подпись
      const al = AB.Survival.affixLabel(m);
      if (m.aff && m.aff.length) {
        ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = al.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(x, y + 4, m.r + 5, (m.r + 5) * 0.45, 0, 0, TAU); ctx.stroke(); ctx.restore();
      }
      if (al) {
        ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(al.text, x, hy - 10);
        ctx.fillStyle = al.color; ctx.fillText(al.text, x, hy - 10);
      }
    }
  }


  // Табличка уровня монстра. Цвет — насколько он опаснее обычных монстров этой ночи:
  // серый — как у лагеря, жёлтый — зона дальше, оранжевый/красный — две и более зоны дальше.
  function lvBadge(ctx, xr, yc, lv) {
    if (!lv) return;
    const d = lv - ((G_ref && G_ref.day) || 1), col = d <= 1 ? '#d8e0d0' : d <= 6 ? '#ffd24a' : d <= 12 ? '#ff9a3a' : '#ff5a4a';
    const txt = String(lv);
    ctx.font = 'bold 9px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(txt).width + 7;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(xr - tw, yc - 5.5, tw, 11);
    ctx.fillStyle = col; ctx.fillText(txt, xr - 3.5, yc + 0.5);
  }

  /* ===================== ОБИТАТЕЛИ ЛОКАЦИЙ ===================== */
  const BONE_PAL = { fur: '#d8d0bc', furL: '#f0ead8', furD: '#8a8474' };
  // Человечек (разбойник, арбалетчик, колдунья): вид сверху-спереди, как игрок
  function humanoid(ctx, m, t, x, y, a, ph, hurt, O, L) {
    const mv = (m.st === 'chase' || Math.hypot(m.vx || 0, m.vy || 0) > 5);
    const bob = mv ? Math.abs(Math.sin(ph)) * 1.4 : Math.sin(t * 2) * 0.4;
    const perp = a + Math.PI / 2;
    for (const side of [-1, 1]) {
      const step = mv ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 4 : 0;
      const fx = x + Math.cos(perp) * side * 4.5 + Math.cos(a) * step, fy = y + 6 + Math.sin(perp) * side * 2 + Math.sin(a) * step * 0.6;
      S().ell(ctx, fx, fy, 3.4, 2.6, O); S().ell(ctx, fx, fy - 0.5, 2.5, 1.8, L.boot || '#3a2818');
    }
    const by = y - 3 - bob, up = Math.sin(a) < -0.35;
    if (L.robe) { ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(x - 11, by + 9); ctx.lineTo(x - 7, by - 6); ctx.lineTo(x + 7, by - 6); ctx.lineTo(x + 11, by + 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = hurt ? '#fff' : L.body; ctx.beginPath(); ctx.moveTo(x - 9.5, by + 8); ctx.lineTo(x - 6, by - 5); ctx.lineTo(x + 6, by - 5); ctx.lineTo(x + 9.5, by + 8); ctx.closePath(); ctx.fill(); }
    else { S().circle(ctx, x, by, 10, O); S().circle(ctx, x, by, 8.8, hurt ? '#fff' : L.body); ctx.fillStyle = L.belt || 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 8, by + 1, 16, 2.5); }
    const hx = x + Math.cos(a + 0.35) * 10, hy = by + Math.sin(a + 0.35) * 7;
    const weapon = () => {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(a + (m.atk > 0 ? 0.5 : 0));
      if (L.weapon === 'knife') { ctx.fillStyle = O; ctx.fillRect(-1, -2.2, 16, 4.4); ctx.fillStyle = '#5a3a20'; ctx.fillRect(0, -1.2, 5, 2.4); ctx.fillStyle = '#d8dde2'; ctx.beginPath(); ctx.moveTo(5, -1.6); ctx.lineTo(15, 0); ctx.lineTo(5, 1.6); ctx.fill(); }
      else if (L.weapon === 'crossbow') { ctx.fillStyle = O; ctx.fillRect(-1, -2.5, 17, 5); ctx.fillStyle = '#6b4a2e'; ctx.fillRect(0, -1.5, 15, 3); ctx.strokeStyle = O; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(13, 0, 8, -1.3, 1.3); ctx.stroke(); ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 1.6; ctx.stroke(); }
      else if (L.weapon === 'staff') { ctx.strokeStyle = O; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(20, 0); ctx.stroke(); ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, 21, 0, 5 + Math.sin(t * 6) * 0.8, 'rgba(190,110,255,0.45)'); ctx.restore(); S().circle(ctx, 21, 0, 2.6, '#e8c8ff'); }
      ctx.restore();
      S().circle(ctx, hx, hy, 3.3, O); S().circle(ctx, hx, hy, 2.4, L.skin);
    };
    if (up) weapon();
    const lhx = x + Math.cos(a - 0.9) * 9, lhy = by + Math.sin(a - 0.9) * 6;
    S().circle(ctx, lhx, lhy, 3.3, O); S().circle(ctx, lhx, lhy, 2.4, L.skin);
    const hy2 = by - 11;
    S().circle(ctx, x, hy2, 8.2, O); S().circle(ctx, x, hy2, 7.1, hurt ? '#fff' : L.skin);
    if (!up) {
      const ex = Math.cos(a) * 2.5, ey = Math.max(0, Math.sin(a)) * 1.5;
      ctx.fillStyle = L.eye || '#1a120c'; ctx.fillRect(x - 3 + ex, hy2 + ey, 2, 2.4); ctx.fillRect(x + 1.5 + ex, hy2 + ey, 2, 2.4);
      if (L.mask) { ctx.fillStyle = L.mask; ctx.fillRect(x - 6.5 + ex * 0.6, hy2 + 3 + ey, 13, 4); }
      if (L.nose) { S().circle(ctx, x + ex * 1.3, hy2 + 3 + ey, 1.8, L.nose); }
    }
    if (L.hat === 'bandana') { ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.3, 0, TAU); ctx.clip(); ctx.fillStyle = L.hatC; ctx.fillRect(x - 9, hy2 - 9, 18, up ? 16 : 6.5); ctx.fillStyle = '#fff'; for (let i = -6; i < 7; i += 4) ctx.fillRect(x + i, hy2 - 5, 1.2, 1.2); ctx.restore(); ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 7, hy2 - 3); ctx.lineTo(x - Math.cos(a) * 13, hy2 + 1 + Math.sin(t * 8) * 1.5); ctx.lineTo(x - Math.cos(a) * 12, hy2 + 4); ctx.fill(); }
    else if (L.hat === 'hood') { ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.5, 0, TAU); ctx.clip(); ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.arc(x - Math.cos(a) * 2, hy2 - (up ? 9 : 4.5) + 1, 9, 0, TAU); ctx.fill(); ctx.restore(); }
    else if (L.hat === 'witch') { ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(x, hy2 - 5, 12, 3.6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.ellipse(x, hy2 - 5, 10.8, 2.6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(x - 7, hy2 - 5); ctx.quadraticCurveTo(x - 2, hy2 - 22, x + 7 - Math.cos(a) * 3, hy2 - 24); ctx.lineTo(x + 7, hy2 - 5); ctx.fill(); ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.moveTo(x - 5.5, hy2 - 6); ctx.quadraticCurveTo(x - 1.5, hy2 - 20, x + 5.5 - Math.cos(a) * 3, hy2 - 22); ctx.lineTo(x + 5.5, hy2 - 6); ctx.fill(); ctx.fillStyle = '#9b6ad8'; ctx.fillRect(x - 5.5, hy2 - 9, 11, 2); }
    if (!up) weapon();
  }
  // Торговцы поселений: свой наряд у каждого, лоток с товаром, табличка с именем
  const TRADER_LOOK = {
    fur:    { body: '#8a6a4a', skin: '#e8c0a0', hat: 'hood', hatC: '#e8e0d0', weapon: null, belt: '#4a2e18' },
    fisher: { body: '#3a5a7a', skin: '#e0b090', hat: 'bandana', hatC: '#2a3a5a', weapon: null, belt: '#2a1a10' },
    shaman: { body: '#8a5a2a', skin: '#c8905a', hat: 'witch', hatC: '#3a6a5a', weapon: 'staff', robe: true },
    tanner: { body: '#a8763e', skin: '#c8905a', hat: 'bandana', hatC: '#c83a2a', weapon: 'knife', belt: '#5a3a20' },
    herbal: { body: '#4a7a3a', skin: '#e8c0a0', hat: 'hood', hatC: '#6a9a4a', weapon: null, robe: true },
    ranger: { body: '#3a5a2a', skin: '#dcae88', hat: 'hood', hatC: '#2c3a28', weapon: 'crossbow', belt: '#5a3a20' },
    smith:  { body: '#5a4a3a', skin: '#e0b090', hat: 'bandana', hatC: '#3a3a3a', weapon: null, belt: '#2a1a10' },
    grocer: { body: '#b8483a', skin: '#e8c0a0', hat: 'hood', hatC: '#f0e0c0', weapon: null, belt: '#4a2e18' },
  };
  function drawTrader(ctx, tr, t, me) {
    const L = TRADER_LOOK[tr.look] || TRADER_LOOK.grocer;
    const a = me ? Math.atan2(me.y - tr.y, me.x - tr.x) : Math.PI / 2;
    // лоток
    const bx = tr.x + 26, by = tr.y + 2;
    S().ell(ctx, bx, by + 2, 18, 4, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = '#140c08'; ctx.fillRect(bx - 16, by - 16, 32, 18); ctx.fillStyle = '#8a6a44'; ctx.fillRect(bx - 15, by - 15, 30, 16); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(bx - 15, by - 8, 30, 1);
    const ic = S().icons, show = tr.look === 'smith' ? ['iron', 'stone'] : tr.look === 'fisher' ? ['cooked_meat', 'coal'] : tr.look === 'shaman' || tr.look === 'herbal' ? ['cooked_pumpkin', 'berry'] : tr.look === 'grocer' ? ['plank', 'coal'] : ['hide', 'hide'];
    show.forEach((k, i) => { if (ic[k]) ctx.drawImage(ic[k], bx - 13 + i * 13, by - 26, 12, 12); });
    humanoid(ctx, { vx: 0, vy: 0, st: 'idle', atk: 0, id: tr.id }, t, tr.x, tr.y, a, 0, false, '#0c0806', L);
    // табличка
    const near = me && AB.dist2(me.x, me.y, tr.x, tr.y) < 200 * 200;
    nameTag(ctx, tr.x, tr.y - 40, `${tr.name}${near ? ' · торговец' : ''}`, '#ffd24a');
    if (near) { const bob = Math.sin(t * 3 + tr.id) * 2; S().circle(ctx, tr.x, tr.y - 56 + bob, 6, '#140c08'); S().circle(ctx, tr.x, tr.y - 56 + bob, 5, '#ffd24a'); ctx.fillStyle = '#7a5210'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', tr.x, tr.y - 55.5 + bob); }
  }
  const HUM = {
    bandit: { body: '#7a4a2a', skin: '#e0b088', hat: 'bandana', hatC: '#c83a2a', weapon: 'knife', belt: '#3a2414', mask: null },
    robber: { body: '#3f5238', skin: '#dcae88', hat: 'hood', hatC: '#2c3a28', weapon: 'crossbow', mask: '#2a2a2a', belt: '#5a3a20' },
    crone:  { body: '#3a2a4a', skin: '#a8c088', hat: 'witch', hatC: '#231a2e', weapon: 'staff', robe: true, eye: '#ff5ad0', nose: '#7a9a5a', boot: '#1a1420' },
  };
  const SITE_MON = {
    bandit: (ctx, m, t, x, y, a, ph, hurt, O) => humanoid(ctx, m, t, x, y, a, ph, hurt, O, HUM.bandit),
    robber: (ctx, m, t, x, y, a, ph, hurt, O) => humanoid(ctx, m, t, x, y, a, ph, hurt, O, HUM.robber),
    crone:  (ctx, m, t, x, y, a, ph, hurt, O) => humanoid(ctx, m, t, x, y, a, ph, hurt, O, HUM.crone),
    alien(ctx, m, t, x, y, a, ph, hurt, O) {
      const bob = Math.sin(t * 3 + m.id) * 2;
      ctx.translate(x, y - 8 + bob);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().ell(ctx, 0, 14 - bob, 10, 3.5, 'rgba(120,255,170,0.25)'); ctx.restore();
      S().ell(ctx, 0, 4, 7, 8, O); S().ell(ctx, 0, 4, 5.8, 6.8, hurt ? '#fff' : '#8fb8a0');
      ctx.fillStyle = '#c0d0c8'; ctx.fillRect(-4, 6, 8, 1.5);
      // лучемёт
      const gx = Math.cos(a) * 9, gy = Math.sin(a) * 5 + 3;
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(a); ctx.fillStyle = O; ctx.fillRect(-2, -2.5, 11, 5); ctx.fillStyle = '#b8c0c8'; ctx.fillRect(-1, -1.5, 9, 3); S().circle(ctx, 9, 0, 1.8, m.atk > 0 ? '#eaffea' : '#6aff9a'); ctx.restore();
      // большая голова
      S().ell(ctx, 0, -9, 10.5, 9, O); S().ell(ctx, 0, -9, 9.3, 7.9, hurt ? '#fff' : '#9ac8a8');
      S().ell(ctx, -3, -12, 3.5, 2, 'rgba(255,255,255,0.25)');
      if (Math.sin(a) > -0.5) { const ex = Math.cos(a) * 2.5; for (const s2 of [-1, 1]) { ctx.save(); ctx.translate(s2 * 4 + ex, -8); ctx.rotate(s2 * 0.35); S().ell(ctx, 0, 0, 3.4, 2.2, '#0a0a12'); S().circle(ctx, -0.8, -0.6, 0.8, '#c8ffe0'); ctx.restore(); } }
      ctx.strokeStyle = O; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -17); ctx.quadraticCurveTo(2, -22, 1 + Math.sin(t * 4) * 2, -25); ctx.stroke();
      S().circle(ctx, 1 + Math.sin(t * 4) * 2, -25, 2, (Math.sin(t * 8) > 0) ? '#6aff9a' : '#eaffea');
    },
    shroom(ctx, m, t, x, y, a, ph, hurt, O) {
      if (AB.Mush) { // подробный грибовик: ножки, тело-ножка с объёмом, лицо, шляпка из кеша
        const bob = Math.abs(Math.sin(ph)) * 2.2, sq = m.atk > 0 ? 1.14 : 1 + Math.sin(t * 3 + m.id) * 0.03;
        ctx.translate(x, y - 2);
        S().ell(ctx, 0, 4, 11, 4, 'rgba(0,0,0,0.3)');
        for (const s2 of [-1, 1]) { const st = Math.sin(ph + (s2 > 0 ? 0 : Math.PI)) * 2.5; S().ell(ctx, s2 * 4.5 + st * 0.4, 3, 3.4, 2.4, O); S().ell(ctx, s2 * 4.5 + st * 0.4, 2.5, 2.6, 1.7, '#b8a07a'); }
        // ручки
        for (const s2 of [-1, 1]) { const sw = Math.sin(ph + s2) * 2 + (m.atk > 0 ? -4 : 0); ctx.strokeStyle = O; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s2 * 5, -5 - bob); ctx.lineTo(s2 * 9, -1 - bob + sw); ctx.stroke(); ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2; ctx.stroke(); }
        // тело
        ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(0, -4 - bob, 7.6, 9, 0, 0, TAU); ctx.fill();
        const bg = ctx.createLinearGradient(-7, 0, 7, 0); bg.addColorStop(0, hurt ? '#fff' : '#fff6e2'); bg.addColorStop(0.6, hurt ? '#fff' : '#ecdcb8'); bg.addColorStop(1, hurt ? '#fff' : '#b8a07a');
        ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, -4 - bob, 6.4, 7.8, 0, 0, TAU); ctx.fill();
        if (Math.sin(a) > -0.5) {
          const ex = Math.cos(a) * 2;
          for (const s2 of [-1, 1]) { S().ell(ctx, ex + s2 * 2.4, -6 - bob, 1.5, 2, '#1a0c0a'); S().circle(ctx, ex + s2 * 2.4 - 0.4, -6.8 - bob, 0.6, '#fff'); }
          S().ell(ctx, ex - 4.2, -3.6 - bob, 1.4, 0.8, 'rgba(240,120,120,0.55)'); S().ell(ctx, ex + 4.2, -3.6 - bob, 1.4, 0.8, 'rgba(240,120,120,0.55)');
          ctx.strokeStyle = '#1a0c0a'; ctx.lineWidth = 0.9; ctx.beginPath(); if (m.atk > 0) ctx.ellipse(ex, -2.4 - bob, 1.4, 1.1, 0, 0, TAU); else ctx.arc(ex, -3.2 - bob, 1.5, 0.2, Math.PI - 0.2); ctx.stroke();
        }
        // шляпка
        const cs = AB.Mush.capSprite(m._pal && m._pal.king ? 9 : (m.id % 4 === 1 ? 1 : 0));
        ctx.save(); ctx.translate(0, -12 - bob); ctx.scale(sq * 0.72, 0.72 / sq); ctx.drawImage(cs.c, -22, -26, 44, 34); ctx.restore();
        if (hurt) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().ell(ctx, 0, -18 - bob, 13, 9, 'rgba(255,255,255,0.45)'); ctx.restore(); }
        if (m.atk > 0 && Math.random() < 0.5) AB.FX.add({ t: 'firefly', x: m.x + (Math.random() - 0.5) * 20, y: m.y - 14, z: 10, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 20, vz: 10, g: 0, life: 1.2, ph: Math.random() * 6, col: '255,190,230' });
        return;
      }
      const bob = Math.abs(Math.sin(ph)) * 2, sq = m.atk > 0 ? 1.12 : 1;
      ctx.translate(x, y - 4);
      for (const s2 of [-1, 1]) { const st = Math.sin(ph + (s2 > 0 ? 0 : Math.PI)) * 3; S().ell(ctx, s2 * 4 + st * 0.4, 6, 3, 2.3, O); S().ell(ctx, s2 * 4 + st * 0.4, 5.5, 2.2, 1.6, '#c8b890'); }
      S().ell(ctx, 0, -1 - bob, 7, 8, O); S().ell(ctx, 0, -1 - bob, 5.8, 6.8, hurt ? '#fff' : '#efe2c0');
      if (Math.sin(a) > -0.5) { const ex = Math.cos(a) * 2; ctx.fillStyle = '#2a1a10'; ctx.fillRect(-3 + ex, -2 - bob, 1.8, 2.6); ctx.fillRect(1.5 + ex, -2 - bob, 1.8, 2.6); ctx.fillRect(-1.5 + ex, 2 - bob, 3.5, 1); }
      const cap = m._pal ? m._pal.cap : '#d0402a';
      ctx.save(); ctx.translate(0, -9 - bob); ctx.scale(sq, 1 / sq);
      ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0, Math.PI, 0); ctx.lineTo(14, 1.5); ctx.lineTo(-14, 1.5); ctx.fill();
      ctx.fillStyle = hurt ? '#fff' : cap; ctx.beginPath(); ctx.ellipse(0, 0, 12.8, 7.8, 0, Math.PI, 0); ctx.lineTo(12.8, 0.5); ctx.lineTo(-12.8, 0.5); ctx.fill();
      ctx.fillStyle = '#fff4e0'; for (const [dx, dy, r] of [[-6, -3, 2], [2, -5, 2.4], [7, -2, 1.6], [-1, -1, 1.2]]) S().circle(ctx, dx, dy, r, '#fff4e0');
      ctx.restore();
    },
    bear(ctx, m, t, x, y, a, ph, hurt, O) {
      const sc = m.r / 18, fur = hurt ? '#ffffff' : (m._pal ? m._pal.fur : '#6a4428'), furL = m._pal ? m._pal.furL : '#8a5e38', furD = m._pal ? m._pal.furD : '#44291a';
      ctx.translate(x, y - 6 * sc); ctx.rotate(a); ctx.scale(sc, sc);
      for (const [lx, ly, off] of [[9, -9, 0], [9, 9, Math.PI], [-10, -9, Math.PI], [-10, 9, 0]]) { const st = Math.sin(ph * 0.8 + off) * 3; S().ell(ctx, lx + st, ly, 5, 3.8, O); S().ell(ctx, lx + st, ly, 4, 2.9, furD); }
      S().ell(ctx, -1, 0, 19, 13, O); S().ell(ctx, -1, 0, 17.6, 11.8, fur); S().ell(ctx, -3, -3, 12, 6, furL);
      const reach = m.atk > 0 ? 5 : 0;
      S().circle(ctx, 16 + reach, 0, 9, O); S().circle(ctx, 16 + reach, 0, 8, fur);
      S().circle(ctx, 13 + reach, -7, 3.4, O); S().circle(ctx, 13 + reach, -7, 2.4, furL); S().circle(ctx, 13 + reach, 7, 3.4, O); S().circle(ctx, 13 + reach, 7, 2.4, furL);
      S().ell(ctx, 23 + reach, 0, 4.4, 3.8, O); S().ell(ctx, 22.5 + reach, 0, 3.6, 3, '#c8a078'); S().circle(ctx, 25.5 + reach, 0, 1.6, '#111');
      S().circle(ctx, 18 + reach, -3, 1.4, '#1a0a05'); S().circle(ctx, 18 + reach, 3, 1.4, '#1a0a05');
    },
  };

  // Босс лагеря: тот же монстр, но крупнее, в золотой ауре, с короной и именем
  function drawElite(ctx, m, t) {
    const x = m.x, y = m.y;
    ctx.save(); ctx.globalAlpha = (0.3 + Math.sin(t * 3 + m.id) * 0.08) * (m.dying > 0 ? Math.min(1, m.dying) : 1);
    const g = ctx.createRadialGradient(x, y, m.r * 0.2, x, y, m.r * 1.6); g.addColorStop(0, 'rgba(255,200,60,0.55)'); g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + 4, m.r * 1.6, m.r * 0.8, 0, 0, TAU); ctx.fill(); ctx.restore();
    const inner = Object.assign({}, m, { x: 0, y: 0, r: m.r / m.es, _inner: true });
    if (m.type === 'shroom') inner._pal = { king: true }; // Грибной король — золотая шляпка
    ctx.save(); ctx.translate(x, y); ctx.scale(m.es, m.es);
    if (m.act) ctx.translate(Math.sin(t * 40) * 0.8, 0);
    drawMonster(ctx, inner, t);
    ctx.restore();
    if (m.dying > 0) return;
    const top = y - m.r * 2.3 - 8;
    // корона
    ctx.fillStyle = '#1a1206'; ctx.beginPath(); ctx.moveTo(x - 9, top + 1); ctx.lineTo(x - 9, top - 7); ctx.lineTo(x - 4.5, top - 3); ctx.lineTo(x, top - 9); ctx.lineTo(x + 4.5, top - 3); ctx.lineTo(x + 9, top - 7); ctx.lineTo(x + 9, top + 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(x - 7.5, top); ctx.lineTo(x - 7.5, top - 5); ctx.lineTo(x - 4.5, top - 1.5); ctx.lineTo(x, top - 7); ctx.lineTo(x + 4.5, top - 1.5); ctx.lineTo(x + 7.5, top - 5); ctx.lineTo(x + 7.5, top); ctx.closePath(); ctx.fill();
    S().circle(ctx, x, top - 2, 1.4, '#ff4a4a');
    const w = Math.max(44, m.r * 2.6), hy = top + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - w / 2 - 1, hy - 1, w + 2, 6);
    ctx.fillStyle = '#ffb02a'; ctx.fillRect(x - w / 2, hy, w * AB.clamp(m.hp / m.maxHp, 0, 1), 4);
    lvBadge(ctx, x - w / 2 - 3, hy + 2, m.lv);
    ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(m.en || '', x, top - 16); ctx.fillStyle = '#ffd98a'; ctx.fillText(m.en || '', x, top - 16);
    if (AB.Survival && AB.Survival.on(G_ref)) { const al = AB.Survival.affixLabel(m); if (al) { ctx.font = 'bold 9px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(al.text, x, top - 27); ctx.fillStyle = al.color; ctx.fillText(al.text, x, top - 27); } }
    if (m.burn || m.slowT > 0 || m.mark > 0) { /* статусы уже нарисованы внутри */ }
  }

  // Снаряды монстров: плевок, арбалетный болт, лазер, проклятие
  function drawEnemyShot(ctx, e, t) {
    const a = Math.atan2(e.vy, e.vx);
    if (e.lk === 'bolt') {
      ctx.save(); ctx.translate(e.x, e.y - 8); ctx.rotate(a);
      ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(7, 0); ctx.stroke();
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = '#d8dde2'; ctx.beginPath(); ctx.moveTo(7, -2.5); ctx.lineTo(12, 0); ctx.lineTo(7, 2.5); ctx.fill();
      ctx.restore(); return;
    }
    if (e.lk === 'laser' || e.lk === 'hex') {
      const col = e.lk === 'laser' ? ['rgba(90,255,150,0.45)', '#eaffea'] : ['rgba(190,100,255,0.5)', '#f0d8ff'];
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(e.x, e.y - 8); ctx.rotate(a);
      ctx.fillStyle = col[0]; ctx.beginPath(); ctx.ellipse(0, 0, e.lk === 'laser' ? 13 : 8, e.lk === 'laser' ? 4.5 : 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col[1]; ctx.beginPath(); ctx.ellipse(0, 0, e.lk === 'laser' ? 8 : 3.5, e.lk === 'laser' ? 1.8 : 3.5, 0, 0, TAU); ctx.fill();
      if (e.lk === 'hex') { ctx.rotate(t * 8); ctx.strokeStyle = 'rgba(230,190,255,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 4); ctx.stroke(); }
      ctx.restore(); return;
    }
    S().circle(ctx, e.x, e.y - 8, 5.5, '#1a2a08'); S().circle(ctx, e.x, e.y - 8, 4.2, '#8fd14a'); S().circle(ctx, e.x - 1.2, e.y - 9.2, 1.4, '#e0ffa0');
  }

  // Предупреждение о молнии: светлый круг, заполняется к удару
  function drawBoltWarn(ctx, b, t) {
    const prog = b.dur === 1 ? b.t : Math.min(1, b.t / b.dur);
    ctx.save();
    ctx.fillStyle = `rgba(200,220,255,${0.1 + prog * 0.18 + Math.sin(t * 20) * 0.03})`;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r, b.r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(230,240,255,${0.5 + prog * 0.4})`; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 30;
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * prog, b.r * prog * 0.7, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ---------- убранство локаций ---------- */
  const FLAT_DECOR = new Set(['flowers', 'bones', 'rubble', 'crater', 'ribcage', 'fring', 'fishbones', 'bonepile', 'herbs', 'boardwalk']);
  // [насколько выше опоры источник, радиус, сила]
  const DECOR_LIGHT = { bfire: [-10, 150, 0.9], cauldron: [-18, 100, 0.6], crystal: [-12, 80, 0.5], jack: [-10, 70, 0.55], saucer: [-30, 120, 0.5], gmush: [-60, 70, 0.3], glowcap: [-30, 80, 0.45] };
  // за чем может спрятаться монстр: [полуширина, высота]
  const DECOR_OCC = { mlog: [50, 30], shelf: [22, 44], tent: [34, 52], btent: [30, 44], saucer: [66, 60], hut: [40, 96], den: [48, 60], gmush: [40, 120], skull: [24, 36], totem: [10, 50] };
  const rr = (d, k) => AB.hash2(Math.floor(d.x) + k, Math.floor(d.y), 17);
  const SITE_FLAT = {
    crater(ctx, d) { S().ell(ctx, d.x, d.y, 92, 46, 'rgba(20,16,12,0.35)'); S().ell(ctx, d.x, d.y, 64, 30, 'rgba(20,16,12,0.35)'); for (let i = 0; i < 10; i++) { const a = i * 0.63 + d.v; S().ell(ctx, d.x + Math.cos(a) * 80, d.y + Math.sin(a) * 40, 6, 3, '#4a4038'); } },
    ribcage(ctx, d) { ctx.strokeStyle = '#1a140c'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(d.x - 26, d.y); ctx.lineTo(d.x + 26, d.y); ctx.stroke(); for (let i = -20; i <= 20; i += 8) { ctx.beginPath(); ctx.moveTo(d.x + i, d.y); ctx.quadraticCurveTo(d.x + i + 6, d.y - 16, d.x + i + 3, d.y - 20); ctx.moveTo(d.x + i, d.y); ctx.quadraticCurveTo(d.x + i + 6, d.y + 12, d.x + i + 3, d.y + 14); ctx.stroke(); } ctx.strokeStyle = '#ddd4bc'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(d.x - 26, d.y); ctx.lineTo(d.x + 26, d.y); ctx.stroke(); for (let i = -20; i <= 20; i += 8) { ctx.beginPath(); ctx.moveTo(d.x + i, d.y); ctx.quadraticCurveTo(d.x + i + 6, d.y - 16, d.x + i + 3, d.y - 20); ctx.moveTo(d.x + i, d.y); ctx.quadraticCurveTo(d.x + i + 6, d.y + 12, d.x + i + 3, d.y + 14); ctx.stroke(); } },
    bonepile(ctx, d) { ctx.lineCap = 'round'; for (let i = 0; i < 6; i++) { const a = rr(d, i) * 6, x = d.x + Math.cos(a) * 8, y = d.y + Math.sin(a) * 4; ctx.strokeStyle = '#1a140c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y + (rr(d, i + 9) - 0.5) * 6); ctx.stroke(); ctx.strokeStyle = '#d8d0bc'; ctx.lineWidth = 2.2; ctx.stroke(); } S().circle(ctx, d.x + 4, d.y - 5, 4.5, '#1a140c'); S().circle(ctx, d.x + 4, d.y - 5, 3.6, '#e0d8c4'); },
    fring(ctx, d, t) { if (AB.Mush) { AB.Mush.drawSprite(ctx, AB.Mush.ring(d.v), d.x, d.y); ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 9; i++) { const a = t * 0.5 + i * 0.7, k = (t * 0.3 + i / 9) % 1; S().circle(ctx, d.x + Math.cos(a) * 34, d.y + Math.sin(a * 1.3) * 16 - 6 - k * 26, 1.6 * (1 - k) + 0.4, `rgba(255,190,240,${0.75 * (1 - k)})`); } ctx.restore(); return; } for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, x = d.x + Math.cos(a) * 48, y = d.y + Math.sin(a) * 26; ctx.fillStyle = '#e8e0cc'; ctx.fillRect(x - 1, y - 3, 2, 4); S().ell(ctx, x, y - 4, 4, 2.4, i % 2 ? '#e05a8a' : '#8a6ad8'); } ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const a = t * 0.6 + i; S().circle(ctx, d.x + Math.cos(a) * 30, d.y + Math.sin(a * 1.3) * 14 - 10, 1.6, 'rgba(255,190,230,0.7)'); } ctx.restore(); },
    fishbones(ctx, d) { ctx.strokeStyle = '#d8d0bc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(d.x - 12, d.y); ctx.lineTo(d.x + 10, d.y); for (let i = -8; i <= 6; i += 4) { ctx.moveTo(d.x + i, d.y - 5); ctx.lineTo(d.x + i + 2, d.y + 5); } ctx.stroke(); ctx.fillStyle = '#d8d0bc'; ctx.beginPath(); ctx.moveTo(d.x + 10, d.y); ctx.lineTo(d.x + 17, d.y - 5); ctx.lineTo(d.x + 17, d.y + 5); ctx.fill(); ctx.beginPath(); ctx.moveTo(d.x - 12, d.y); ctx.lineTo(d.x - 18, d.y - 5); ctx.lineTo(d.x - 16, d.y); ctx.lineTo(d.x - 18, d.y + 5); ctx.fill(); },
    herbs(ctx, d) { for (let i = 0; i < 7; i++) { const x = d.x + (rr(d, i) - 0.5) * 22, y = d.y + (rr(d, i + 7) - 0.5) * 10; ctx.fillStyle = '#2d5a24'; ctx.fillRect(x, y - 5, 1.4, 6); S().circle(ctx, x + 0.7, y - 6, 1.8, i % 3 ? '#b88ae0' : '#e0e070'); } },
  };
  const SITE_PROPS = {
    btent(ctx, d) { const x = d.x, y = d.y, c = d.v > 0.5 ? '#8a6a3a' : '#6a7a4a'; S().ell(ctx, x, y + 2, 28, 7, 'rgba(0,0,0,0.3)'); ctx.fillStyle = '#140c08'; ctx.beginPath(); ctx.moveTo(x - 27, y + 2); ctx.lineTo(x, y - 36); ctx.lineTo(x + 27, y + 2); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - 24, y); ctx.lineTo(x, y - 33); ctx.lineTo(x + 24, y); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(x, y - 33); ctx.lineTo(x + 24, y); ctx.lineTo(x + 8, y); ctx.fill(); ctx.fillStyle = '#1a120a'; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 16); ctx.lineTo(x + 6, y); ctx.fill(); ctx.fillStyle = '#c83a2a'; ctx.fillRect(x - 1, y - 44, 2, 10); ctx.beginPath(); ctx.moveTo(x + 1, y - 44); ctx.lineTo(x + 10, y - 41); ctx.lineTo(x + 1, y - 38); ctx.fill(); },
    bfire(ctx, d, t) { const x = d.x, y = d.y; for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; S().ell(ctx, x + Math.cos(a) * 13, y + Math.sin(a) * 6, 4.5, 3, '#5a5650'); } ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 9, y + 2); ctx.lineTo(x + 9, y - 3); ctx.moveTo(x - 8, y - 3); ctx.lineTo(x + 9, y + 3); ctx.stroke(); const h = 14 + Math.sin(t * 11 + x) * 3; ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x, y - h * 1.6, x + 7, y); ctx.fill(); ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.quadraticCurveTo(x, y - h, x + 3.5, y); ctx.fill(); ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 12, y - 18); ctx.lineTo(x + 12, y - 18); ctx.moveTo(x - 12, y - 18); ctx.lineTo(x - 12, y); ctx.moveTo(x + 12, y - 18); ctx.lineTo(x + 12, y); ctx.stroke(); S().ell(ctx, x, y - 14, 5, 4, '#3a3a3a'); },
    barrel(ctx, d) { const x = d.x, y = d.y; S().ell(ctx, x + 2, y + 1, 10, 4, 'rgba(0,0,0,0.3)'); ctx.fillStyle = '#140c08'; roundRect(ctx, x - 9, y - 22, 18, 23, 5); ctx.fill(); ctx.fillStyle = '#8a5a30'; roundRect(ctx, x - 8, y - 21, 16, 21, 4); ctx.fill(); ctx.fillStyle = '#4a4a4a'; ctx.fillRect(x - 8, y - 17, 16, 2); ctx.fillRect(x - 8, y - 6, 16, 2); S().ell(ctx, x, y - 21, 8, 3, '#6b4424'); },
    sack(ctx, d) { const x = d.x, y = d.y; S().ell(ctx, x, y - 7, 10, 9, '#140c08'); S().ell(ctx, x, y - 7, 9, 8, '#b89a6a'); ctx.fillStyle = '#8a7048'; ctx.fillRect(x - 3, y - 17, 6, 4); ctx.fillStyle = '#ffd24a'; for (let i = 0; i < 3; i++) S().circle(ctx, x - 8 + i * 5, y + 1, 2.2, '#e0b030'); },
    wanted(ctx, d) { const x = d.x, y = d.y; ctx.fillStyle = '#140c08'; ctx.fillRect(x - 2, y - 30, 4, 31); ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x - 1, y - 29, 2, 29); ctx.fillStyle = '#140c08'; ctx.fillRect(x - 11, y - 42, 22, 18); ctx.fillStyle = '#e8d8b0'; ctx.fillRect(x - 10, y - 41, 20, 16); ctx.fillStyle = '#5a3a20'; ctx.fillRect(x - 7, y - 39, 14, 2); S().circle(ctx, x, y - 32, 3.5, '#a07a50'); ctx.fillRect(x - 6, y - 28, 12, 1.5); },
    palisade(ctx, d) { const x = d.x, y = d.y, a = (d.a || 0) + Math.PI / 2, dx = Math.cos(a) * 8, dy = Math.sin(a) * 4; for (let i = -2; i <= 2; i++) { const px = x + dx * i, py = y + dy * i, h = 26 + ((i * 7 + 20) % 5); ctx.fillStyle = '#140c08'; ctx.fillRect(px - 3.5, py - h, 7, h + 1); ctx.fillStyle = i % 2 ? '#7a5230' : '#8a6038'; ctx.fillRect(px - 2.5, py - h + 1, 5, h - 1); ctx.beginPath(); ctx.moveTo(px - 3.5, py - h); ctx.lineTo(px, py - h - 6); ctx.lineTo(px + 3.5, py - h); ctx.fillStyle = '#140c08'; ctx.fill(); } ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - dx * 2.4, y - dy * 2.4 - 16); ctx.lineTo(x + dx * 2.4, y + dy * 2.4 - 16); ctx.stroke(); },
    saucer(ctx, d, t) {
      const x = d.x, y = d.y;
      S().ell(ctx, x, y + 6, 70, 18, 'rgba(0,0,0,0.35)');
      ctx.save(); ctx.translate(x, y - 16); ctx.rotate(-0.18);
      ctx.fillStyle = '#10141a'; ctx.beginPath(); ctx.ellipse(0, 0, 66, 19, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, -18, 0, 18); g.addColorStop(0, '#c8d0d8'); g.addColorStop(1, '#5a6470');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 63, 16.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#10141a'; ctx.beginPath(); ctx.ellipse(0, -8, 28, 18, 0, Math.PI, 0); ctx.fill();
      const gd = ctx.createRadialGradient(-6, -18, 2, 0, -10, 28); gd.addColorStop(0, 'rgba(200,255,230,0.9)'); gd.addColorStop(1, 'rgba(80,200,150,0.55)');
      ctx.fillStyle = gd; ctx.beginPath(); ctx.ellipse(0, -8, 25.5, 15.5, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,30,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -20); ctx.lineTo(-2, -12); ctx.lineTo(-10, -6); ctx.stroke();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, on = Math.sin(t * 5 + i) > 0.2; S().circle(ctx, Math.cos(a) * 52, Math.sin(a) * 11 + 3, 3, on ? '#8affc0' : '#2a4a3a'); }
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { const k = (t * 0.4 + i / 3) % 1; S().circle(ctx, x + 40 + k * 10, y - 30 - k * 40, 6 + k * 8, `rgba(150,160,170,${0.25 * (1 - k)})`); } ctx.restore();
    },
    crystal(ctx, d, t) { const x = d.x, y = d.y; S().ell(ctx, x, y + 1, 12, 4, 'rgba(0,0,0,0.3)'); for (const [dx, h, w] of [[-5, 16, 5], [3, 24, 6], [8, 13, 4]]) { ctx.fillStyle = '#0a1a12'; ctx.beginPath(); ctx.moveTo(x + dx - w - 1, y); ctx.lineTo(x + dx, y - h - 2); ctx.lineTo(x + dx + w + 1, y); ctx.fill(); ctx.fillStyle = '#5affa0'; ctx.beginPath(); ctx.moveTo(x + dx - w, y); ctx.lineTo(x + dx, y - h); ctx.lineTo(x + dx + w, y); ctx.fill(); ctx.fillStyle = 'rgba(230,255,240,0.6)'; ctx.beginPath(); ctx.moveTo(x + dx - w * 0.3, y - 2); ctx.lineTo(x + dx, y - h + 3); ctx.lineTo(x + dx + 1, y - 2); ctx.fill(); } },
    debris(ctx, d) { const x = d.x, y = d.y; ctx.save(); ctx.translate(x, y - 4); ctx.rotate(d.v * 3); ctx.fillStyle = '#10141a'; ctx.fillRect(-12, -5, 24, 10); ctx.fillStyle = '#8a949e'; ctx.fillRect(-11, -4, 22, 8); ctx.fillStyle = '#5a646e'; ctx.fillRect(-11, 1, 22, 3); S().circle(ctx, 6, -1, 1.5, '#ff5a3a'); ctx.restore(); },
    skull(ctx, d) { const x = d.x, y = d.y; S().ell(ctx, x, y + 2, 20, 5, 'rgba(0,0,0,0.3)'); ctx.lineCap = 'round'; for (const s2 of [-1, 1]) { ctx.strokeStyle = '#1a140c'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x + s2 * 8, y - 18); ctx.quadraticCurveTo(x + s2 * 22, y - 26, x + s2 * 20, y - 40); ctx.moveTo(x + s2 * 17, y - 28); ctx.lineTo(x + s2 * 26, y - 32); ctx.stroke(); ctx.strokeStyle = '#e0d8c4'; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(x + s2 * 8, y - 18); ctx.quadraticCurveTo(x + s2 * 22, y - 26, x + s2 * 20, y - 40); ctx.moveTo(x + s2 * 17, y - 28); ctx.lineTo(x + s2 * 26, y - 32); ctx.stroke(); } S().ell(ctx, x, y - 12, 11, 13, '#1a140c'); S().ell(ctx, x, y - 12, 9.6, 11.6, '#e8e0cc'); S().ell(ctx, x - 4, y - 14, 2.8, 3.4, '#1a140c'); S().ell(ctx, x + 4, y - 14, 2.8, 3.4, '#1a140c'); ctx.fillStyle = '#1a140c'; ctx.fillRect(x - 2, y - 5, 1.5, 3); ctx.fillRect(x + 1, y - 5, 1.5, 3); },
    grave(ctx, d) { const x = d.x, y = d.y, w = 14 + d.v * 4; S().ell(ctx, x, y + 1, w * 0.8, 4, 'rgba(0,0,0,0.3)'); ctx.fillStyle = '#5a4a36'; ctx.fillRect(x - w * 0.6, y - 3, w * 1.2, 6); ctx.fillStyle = '#1a1612'; roundRect(ctx, x - w / 2 - 1, y - 24, w + 2, 23, 6); ctx.fill(); ctx.fillStyle = d.v > 0.5 ? '#8a8a80' : '#7a7a72'; roundRect(ctx, x - w / 2, y - 23, w, 21, 5); ctx.fill(); ctx.fillStyle = '#4a4a44'; S().circle(ctx, x, y - 14, 2.2, '#4a4a44'); for (const [dx, dy] of [[-3, -3], [0, -4.5], [3, -3]]) S().circle(ctx, x + dx, y - 14 + dy, 1.2, '#4a4a44'); },
    hut(ctx, d, t) {
      const x = d.x, y = d.y, step = Math.sin(t * 1.2) * 1.5;
      S().ell(ctx, x, y + 4, 44, 10, 'rgba(0,0,0,0.35)');
      // куриные ноги
      for (const s2 of [-1, 1]) { ctx.strokeStyle = '#140c08'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + s2 * 14, y - 30); ctx.lineTo(x + s2 * 18, y - 14 + (s2 > 0 ? step : -step)); ctx.lineTo(x + s2 * 14, y); ctx.stroke(); ctx.strokeStyle = '#e0a040'; ctx.lineWidth = 4; ctx.stroke(); for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(x + s2 * 14, y); ctx.lineTo(x + s2 * 14 + k * 7, y + 4); ctx.stroke(); } }
      ctx.fillStyle = '#140c08'; ctx.fillRect(x - 32, y - 76, 64, 48);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#6b4424' : '#7a5230'; ctx.fillRect(x - 31, y - 75 + i * 9.4, 62, 8.4); ctx.fillStyle = '#4a2e18'; S().circle(ctx, x - 31, y - 71 + i * 9.4, 4, '#4a2e18'); S().circle(ctx, x + 31, y - 71 + i * 9.4, 4, '#4a2e18'); }
      ctx.fillStyle = '#140c08'; ctx.beginPath(); ctx.moveTo(x - 40, y - 74); ctx.lineTo(x, y - 104); ctx.lineTo(x + 40, y - 74); ctx.fill();
      ctx.fillStyle = '#5a6a3a'; ctx.beginPath(); ctx.moveTo(x - 36, y - 76); ctx.lineTo(x, y - 100); ctx.lineTo(x + 36, y - 76); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.moveTo(x, y - 100); ctx.lineTo(x + 36, y - 76); ctx.lineTo(x + 10, y - 76); ctx.fill();
      ctx.fillStyle = '#140c08'; ctx.fillRect(x - 9, y - 62, 18, 16); ctx.fillStyle = `rgba(255,${190 + Math.sin(t * 5) * 30},90,0.95)`; ctx.fillRect(x - 7.5, y - 60.5, 15, 13); ctx.fillStyle = '#140c08'; ctx.fillRect(x - 0.8, y - 60, 1.6, 13); ctx.fillRect(x - 7, y - 54.5, 14, 1.6);
      ctx.fillStyle = '#2a1a0e'; ctx.fillRect(x + 14, y - 112, 8, 16); ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { const k = (t * 0.35 + i / 3) % 1; S().circle(ctx, x + 18 + Math.sin(k * 6) * 4, y - 116 - k * 34, 4 + k * 6, `rgba(170,120,220,${0.3 * (1 - k)})`); } ctx.restore();
    },
    cauldron(ctx, d, t) { const x = d.x, y = d.y; S().ell(ctx, x, y + 2, 18, 5, 'rgba(0,0,0,0.35)'); ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x, y - 12 - Math.sin(t * 12) * 2, x + 8, y); ctx.fill(); S().ell(ctx, x, y - 10, 16, 12, '#0a0a0a'); S().ell(ctx, x, y - 10, 14.5, 10.5, '#2a2a30'); S().ell(ctx, x, y - 18, 14, 4.5, '#0a0a0a'); S().ell(ctx, x, y - 18, 12.5, 3.5, '#5aff6a'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 4; i++) { const k = (t * 0.8 + i / 4) % 1; S().circle(ctx, x + Math.sin(i * 2.3 + t) * 7, y - 20 - k * 22, 2 + k * 3, `rgba(120,255,140,${0.5 * (1 - k)})`); } ctx.restore(); },
    jack(ctx, d, t) { const x = d.x, y = d.y; S().ell(ctx, x, y + 1, 11, 4, 'rgba(0,0,0,0.3)'); S().ell(ctx, x, y - 8, 11, 9, '#140c08'); S().ell(ctx, x, y - 8, 10, 8, '#e07a1a'); ctx.fillStyle = '#b85a10'; ctx.fillRect(x - 0.8, y - 16, 1.6, 15); ctx.fillStyle = '#3a6a2a'; ctx.fillRect(x - 1, y - 20, 2.5, 4); const f = `rgba(255,${210 + Math.sin(t * 9 + x) * 30},80,1)`; ctx.fillStyle = f; ctx.beginPath(); ctx.moveTo(x - 6, y - 11); ctx.lineTo(x - 3, y - 8); ctx.lineTo(x - 7, y - 8); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 6, y - 11); ctx.lineTo(x + 3, y - 8); ctx.lineTo(x + 7, y - 8); ctx.fill(); ctx.fillRect(x - 5, y - 5, 10, 2.2); },
    totem(ctx, d) { const x = d.x, y = d.y; ctx.fillStyle = '#140c08'; ctx.fillRect(x - 3, y - 44, 6, 45); ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x - 2, y - 43, 4, 43); ctx.strokeStyle = '#140c08'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 12, y - 38); ctx.lineTo(x + 12, y - 38); ctx.stroke(); S().circle(ctx, x, y - 46, 6.5, '#140c08'); S().circle(ctx, x, y - 46, 5.5, '#e0d8c4'); S().circle(ctx, x - 2, y - 47, 1.3, '#9b3ad8'); S().circle(ctx, x + 2, y - 47, 1.3, '#9b3ad8'); for (const dx of [-11, 11]) { ctx.fillStyle = '#b88ae0'; ctx.fillRect(x + dx - 1, y - 38, 2, 8); } },
    gmush(ctx, d, t) { if (AB.Mush) { AB.Mush.drawGiant(ctx, d, t, G_ref ? G_ref.nightF : 0); return; } const x = d.x, y = d.y, s2 = 0.8 + d.v * 0.5, cap = ['#d0402a', '#8a5ad8', '#3aa0c8'][Math.floor(d.v * 3) % 3]; ctx.save(); ctx.translate(x, y); ctx.scale(s2, s2); S().ell(ctx, 0, 2, 22, 6, 'rgba(0,0,0,0.3)'); ctx.fillStyle = '#140c08'; ctx.fillRect(-7, -40, 14, 41); ctx.fillStyle = '#efe2c0'; ctx.fillRect(-6, -40, 12, 40); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(2, -40, 4, 40); ctx.fillStyle = '#140c08'; ctx.beginPath(); ctx.ellipse(0, -40, 30, 20, 0, Math.PI, 0); ctx.lineTo(30, -37); ctx.lineTo(-30, -37); ctx.fill(); ctx.fillStyle = cap; ctx.beginPath(); ctx.ellipse(0, -40, 28, 18.5, 0, Math.PI, 0); ctx.lineTo(28, -38.5); ctx.lineTo(-28, -38.5); ctx.fill(); for (const [dx, dy, r2] of [[-13, -46, 4], [3, -52, 5], [15, -44, 3.4], [-3, -42, 2.4]]) S().circle(ctx, dx, dy, r2, '#fff4e0'); ctx.restore(); if ((G_ref && G_ref.nightF > 0.3)) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().ell(ctx, x, y - 36 * s2, 26 * s2, 12 * s2, `rgba(255,200,240,${0.12 + Math.sin(t * 2 + x) * 0.05})`); ctx.restore(); } },
    glowcap(ctx, d, t) { AB.Mush.drawGlowcap(ctx, d, t, G_ref ? G_ref.nightF : 0); },
    puffball(ctx, d) { AB.Mush.drawSprite(ctx, AB.Mush.puffball(d.v), d.x, d.y); },
    shelf(ctx, d) { AB.Mush.drawSprite(ctx, AB.Mush.shelfStump(d.v), d.x, d.y); },
    mlog(ctx, d) { AB.Mush.drawSprite(ctx, AB.Mush.log(d.v), d.x, d.y); },
    smush(ctx, d) { if (AB.Mush) { AB.Mush.drawSprite(ctx, AB.Mush.cluster(d.v), d.x, d.y); return; } for (let i = 0; i < 4; i++) { const x = d.x + (rr(d, i) - 0.5) * 18, y = d.y + (rr(d, i + 4) - 0.5) * 8, h = 5 + rr(d, i + 8) * 6; ctx.fillStyle = '#efe2c0'; ctx.fillRect(x - 1.2, y - h, 2.4, h); S().ell(ctx, x, y - h, 4.5, 3, i % 2 ? '#d0402a' : '#e8a040'); } },
    den(ctx, d, t) { const x = d.x, y = d.y; S().ell(ctx, x, y + 4, 56, 12, 'rgba(0,0,0,0.35)'); ctx.fillStyle = '#1a1612'; ctx.beginPath(); ctx.ellipse(x, y - 14, 56, 40, 0, Math.PI, 0); ctx.lineTo(x + 56, y); ctx.lineTo(x - 56, y); ctx.fill(); ctx.fillStyle = '#6a665c'; ctx.beginPath(); ctx.ellipse(x, y - 14, 53, 37, 0, Math.PI, 0); ctx.lineTo(x + 53, y - 2); ctx.lineTo(x - 53, y - 2); ctx.fill(); for (let i = 0; i < 9; i++) { const a = Math.PI + i / 8 * Math.PI; S().ell(ctx, x + Math.cos(a) * 40, y - 14 + Math.sin(a) * 26, 11, 8, i % 2 ? '#7a766a' : '#5a564c'); } ctx.fillStyle = '#0a0806'; ctx.beginPath(); ctx.ellipse(x, y - 4, 22, 20, 0, Math.PI, 0); ctx.lineTo(x + 22, y); ctx.lineTo(x - 22, y); ctx.fill(); if (Math.sin(t * 0.8) > 0.6) { S().circle(ctx, x - 5, y - 12, 1.6, '#ffcc40'); S().circle(ctx, x + 5, y - 12, 1.6, '#ffcc40'); } for (let i = 0; i < 5; i++) { ctx.fillStyle = ['#a8641f', '#7a4a22', '#c8a03a'][i % 3]; ctx.fillRect(x - 30 + i * 13, y - 1 + (i % 2) * 2, 5, 3); } },
    hive(ctx, d, t) { const x = d.x, y = d.y; drawSprite(ctx, S().stump, x, y + 4, 0.9); S().ell(ctx, x, y - 22, 10, 12, '#140c08'); S().ell(ctx, x, y - 22, 9, 11, '#e0a030'); ctx.strokeStyle = '#a06a18'; ctx.lineWidth = 1.5; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(x, y - 22 + i * 5, 9 - Math.abs(i) * 2, 1.5, 0, 0, TAU); ctx.stroke(); } S().circle(ctx, x, y - 18, 2.2, '#2a1a0a'); for (let i = 0; i < 3; i++) { const a = t * 3 + i * 2.1; S().circle(ctx, x + Math.cos(a) * 14, y - 26 + Math.sin(a * 1.7) * 7, 1.4, '#1a1a0a'); } },
    logpile(ctx, d) { const x = d.x, y = d.y; for (const [dx, dy] of [[-9, 0], [0, 0], [9, 0], [-4.5, -8], [4.5, -8]]) { S().ell(ctx, x + dx, y + dy - 4, 5, 5, '#140c08'); S().ell(ctx, x + dx, y + dy - 4, 4, 4, '#c8a06a'); S().circle(ctx, x + dx, y + dy - 4, 1.4, '#8a5a30'); } },
    ruinD(ctx, d) { const rsp = (S().ruins || [])[Math.floor(d.v * 3)]; if (rsp) drawSprite(ctx, rsp, d.x, d.y + 10, 0.8); },
  };


  /* ===================== КУРЫ В ЛАГЕРЕ =====================
   * Петух и три цыплёнка. Бессмертны и ни на что не влияют: считаются прямо при отрисовке
   * (у каждого игрока свои, по сети не передаются). Разбегаются от людей и монстров, подняв крылья,
   * успокаиваются и клюют землю. Иногда кто-то находит червяка — и за него начинается драка. */
  let birds = [], worms = [], birdWorld = null, wormT = 6;
  R.birds = () => ({ birds, worms });
  const BIRD = { scare: 70, calm: 150, run: 115, walk: 22, home: 200 };
  function initBirds(W) {
    birdWorld = W; birds = []; worms = []; wormT = 6;
    const kinds = ['rooster', 'chick', 'chick', 'chick'];
    kinds.forEach((kind, i) => {
      const a = 0.8 + i * 1.3, d = 110 + i * 14;
      birds.push({ id: i, kind, x: W.camp.x + Math.cos(a) * d, y: W.camp.y + Math.sin(a) * d, a: Math.random() * TAU, st: 'peck', t: 1 + Math.random() * 2, tx: 0, ty: 0, calmT: 0, peckT: 0, flap: 0, ph: Math.random() * 6, hop: 0, foe: null, worm: null });
    });
  }
  function birdThreat(G, b) {
    let best = null, bd = BIRD.scare * BIRD.scare;
    for (const p of G.players) if (!p.dead) { const d = AB.dist2(p.x, p.y, b.x, b.y); if (d < bd) { bd = d; best = p; } }
    for (const m of G.monsters) if (!m.dying) { const d = AB.dist2(m.x, m.y, b.x, b.y); if (d < (BIRD.scare + m.r) ** 2 && d < bd * 1.5) { bd = d; best = m; } }
    return best;
  }
  function moveBird(b, tx, ty, sp, dt) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const want = Math.atan2(dy, dx);
    let da = ((want - b.a + Math.PI * 3) % TAU) - Math.PI; b.a += AB.clamp(da, -10 * dt, 10 * dt);
    const st = Math.min(d, sp * dt);
    const r = AB.resolveCollision(birdWorld, b.x + Math.cos(want) * st, b.y + Math.sin(want) * st, b.kind === 'rooster' ? 5 : 3);
    b.x = r[0]; b.y = r[1]; b.ph += dt * sp * 0.35;
    return false;
  }
  function endFight(b) { if (b.foe) { b.foe.foe = null; if (b.foe.st === 'fight') { b.foe.st = 'peck'; b.foe.t = 1; } } b.foe = null; }
  function updateBirds(G, dt, t) {
    const W = G.W;
    if (birdWorld !== W) initBirds(W);
    const cx = W.camp.x, cy = W.camp.y;
    // червяк: время от времени кто-то из клюющих его находит
    wormT -= dt;
    if (wormT <= 0 && !worms.length) {
      wormT = 10 + Math.random() * 14;
      const finder = birds.filter(b => b.st === 'peck')[Math.floor(Math.random() * 4)];
      if (finder) {
        const w = { x: finder.x + Math.cos(finder.a) * 7, y: finder.y + Math.sin(finder.a) * 7 + 2, t: 0, owner: null, life: 9 };
        worms.push(w);
        // ближайший спокойный сосед кидается отбирать
        const rival = birds.filter(o => o !== finder && o.st !== 'flee' && AB.dist2(o.x, o.y, w.x, w.y) < 160 * 160).sort((p, q) => AB.dist2(p.x, p.y, w.x, w.y) - AB.dist2(q.x, q.y, w.x, w.y))[0];
        finder.st = 'grab'; finder.worm = w;
        if (rival) { rival.st = 'rush'; rival.worm = w; }
      }
    }
    for (let i = worms.length - 1; i >= 0; i--) { const w = worms[i]; w.t += dt; w.life -= dt; if (w.life <= 0) { birds.forEach(b => { if (b.worm === w) { b.worm = null; endFight(b); if (b.st !== 'flee') { b.st = 'peck'; b.t = 1; } } }); worms.splice(i, 1); } }
    for (const b of birds) {
      b.flap = Math.max(0, b.flap - dt); b.hop = Math.max(0, b.hop - dt);
      const th = birdThreat(G, b);
      if (th) { // испугались: бежим прочь с поднятыми крыльями
        if (b.st !== 'flee') { endFight(b); if (b.worm && b.worm.owner === b) b.worm.owner = null; b.worm = null; }
        b.st = 'flee'; b.calmT = 0.9 + Math.random() * 0.8;
        const a = Math.atan2(b.y - th.y, b.x - th.x) + (Math.sin(t * 3 + b.id) * 0.5);
        b.tx = b.x + Math.cos(a) * 80; b.ty = b.y + Math.sin(a) * 80;
        // не убегать из лагеря: если далеко от центра — забирать к нему
        const hd = AB.dist(b.x, b.y, cx, cy);
        if (hd > BIRD.home) { b.tx = AB.lerp(b.tx, cx, 0.5); b.ty = AB.lerp(b.ty, cy, 0.5); }
      }
      switch (b.st) {
        case 'flee':
          b.flap = 0.3;
          moveBird(b, b.tx, b.ty, BIRD.run * (b.kind === 'chick' ? 0.9 : 1), dt);
          if (!th) { b.calmT -= dt; if (b.calmT <= 0) { b.st = 'peck'; b.t = 1.5 + Math.random() * 2; } }
          break;
        case 'peck': // стоим и клюём землю, изредка переходим на пару шагов
          b.t -= dt; b.peckT += dt;
          if (b.t <= 0) {
            b.st = 'walk'; b.t = 1 + Math.random() * 1.5;
            const hd = AB.dist(b.x, b.y, cx, cy), a = hd > BIRD.home * 0.8 ? Math.atan2(cy - b.y, cx - b.x) + (Math.random() - 0.5) : Math.random() * TAU;
            b.tx = b.x + Math.cos(a) * (20 + Math.random() * 40); b.ty = b.y + Math.sin(a) * (20 + Math.random() * 40);
            // цыплята держатся поближе к петуху
            const r0 = birds[0]; if (b.kind === 'chick' && r0 !== b && AB.dist(b.x, b.y, r0.x, r0.y) > 70) { b.tx = r0.x + (Math.random() - 0.5) * 40; b.ty = r0.y + (Math.random() - 0.5) * 30; }
          }
          break;
        case 'walk':
          b.t -= dt;
          if (moveBird(b, b.tx, b.ty, BIRD.walk, dt) || b.t <= 0) { b.st = 'peck'; b.t = 2 + Math.random() * 3; }
          break;
        case 'grab': { // нашёл червяка: вытягивает его из земли
          const w = b.worm; if (!w) { b.st = 'peck'; break; }
          b.a = Math.atan2(w.y - b.y, w.x - b.x);
          if (w.t > 0.8 && !w.owner) w.owner = b;
          if (w.owner === b) { w.x = b.x + Math.cos(b.a) * 7; w.y = b.y + Math.sin(b.a) * 5 + 1; }
          if (!b.foe && w.owner === b && w.t > 2.2) { eatWorm(b, w); }
          break;
        }
        case 'rush': { // бежит отбирать червяка
          const w = b.worm; if (!w) { b.st = 'peck'; break; }
          const o = birds.find(q => q !== b && q.worm === w && (q.st === 'grab' || q.st === 'fight'));
          if (!o) { if (moveBird(b, w.x, w.y, BIRD.run * 0.7, dt) || AB.dist2(b.x, b.y, w.x, w.y) < 64) { b.st = 'grab'; } break; }
          b.flap = 0.15;
          if (moveBird(b, o.x - Math.cos(Math.atan2(o.y - b.y, o.x - b.x)) * 11, o.y - Math.sin(Math.atan2(o.y - b.y, o.x - b.x)) * 11, BIRD.run * 0.75, dt) || AB.dist2(b.x, b.y, o.x, o.y) < 14 * 14) {
            b.st = 'fight'; o.st = 'fight'; b.foe = o; o.foe = b; b.t = o.t = 1.8 + Math.random() * 1.6;
          }
          break;
        }
        case 'fight': { // драка: прыгают друг на друга, летят перья
          const o = b.foe; if (!o) { b.st = 'peck'; b.t = 1; break; }
          b.a = Math.atan2(o.y - b.y, o.x - b.x);
          if (b.hop <= 0 && Math.random() < dt * 4) { b.hop = 0.25; b.flap = 0.25; AB.FX.add({ t: 'leaf', x: (b.x + o.x) / 2, y: (b.y + o.y) / 2, z: 8, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 30, vz: 40, g: 40, life: 1.2, size: 1.6, c: b.kind === 'rooster' ? '#e8d8c0' : '#ffe27a', rot: Math.random() * 6, vr: 6 }); }
          const d = AB.dist(b.x, b.y, o.x, o.y); if (d > 12) moveBird(b, o.x, o.y, 30, dt);
          b.t -= dt;
          if (b.t <= 0 && b.id < o.id) { // исход драки: петух чаще побеждает
            const winB = b.kind === 'rooster' ? Math.random() < 0.75 : o.kind === 'rooster' ? Math.random() < 0.25 : Math.random() < 0.5;
            const win = winB ? b : o, lose = winB ? o : b, w = b.worm;
            b.foe = o.foe = null; lose.worm = null; lose.st = 'walk'; lose.t = 1.2;
            lose.tx = lose.x - Math.cos(lose.a) * 30; lose.ty = lose.y - Math.sin(lose.a) * 30; lose.flap = 0.4;
            if (w) { w.owner = win; win.st = 'grab'; w.t = Math.max(w.t, 1.8); } else { win.st = 'peck'; win.t = 1; }
          }
          break;
        }
      }
    }
  }
  function eatWorm(b, w) {
    const i = worms.indexOf(w); if (i >= 0) worms.splice(i, 1);
    birds.forEach(q => { if (q.worm === w) { q.worm = null; if (q !== b && q.st !== 'flee') { q.st = 'peck'; q.t = 1; } } });
    b.st = 'peck'; b.t = 2.5; b.flap = 0.35; b.hop = 0.2;
  }
  function drawWorm(ctx, w, t) {
    const len = Math.min(1, w.t / 0.8) * 7, a = w.owner ? w.owner.a : 0.4;
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(a + Math.PI / 2);
    ctx.strokeStyle = '#1a0c08'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.sin(t * 14) * 3, len / 2, Math.sin(t * 10 + 1) * 2, len); ctx.stroke();
    ctx.strokeStyle = '#e88a8a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  function drawHen(ctx, b, t) {
    const R2 = b.kind === 'rooster', O = '#140c08';
    const hop = b.hop > 0 ? Math.sin(b.hop / 0.25 * Math.PI) * 4 : 0;
    const moving = b.st === 'flee' || b.st === 'walk' || b.st === 'rush';
    const x = b.x, y = b.y, face = Math.cos(b.a) >= 0 ? 1 : -1;
    const k = R2 ? 1 : 0.62;
    S().ell(ctx, x, y + 1, 5 * k + 1, 2 * k + 0.5, 'rgba(0,0,0,0.3)');
    ctx.save(); ctx.translate(x, y - hop); ctx.scale(face * k, k);
    // лапки
    const st = moving ? Math.sin(b.ph * 2) * 1.6 : 0;
    ctx.strokeStyle = '#e0a030'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-1, -3); ctx.lineTo(-1 + st, 0); ctx.moveTo(1.5, -3); ctx.lineTo(1.5 - st, 0); ctx.stroke();
    if (R2) { // хвост петуха
      ctx.strokeStyle = O; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(-4, -7); ctx.quadraticCurveTo(-10, -14, -7, -17); ctx.stroke();
      for (const [c, dy] of [['#1f5a3a', 0], ['#2a2a3a', 2], ['#b8502a', -2]]) { ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-4, -7 + dy * 0.3); ctx.quadraticCurveTo(-10, -13 + dy, -7 + dy * 0.5, -16 + dy); ctx.stroke(); }
    }
    // тело
    const body = R2 ? '#f0e6d4' : '#ffd84a';
    S().ell(ctx, 0, -6, 5.6, 4.4, O); S().ell(ctx, 0, -6, 4.7, 3.6, body);
    if (R2) S().ell(ctx, -0.5, -5.5, 3, 2, '#c8663a');
    // крылья: подняты и хлопают при испуге и в драке
    if (b.flap > 0) {
      const f = Math.sin(t * 40) * 0.6;
      for (const s2 of [-1, 1]) { ctx.save(); ctx.translate(-0.5, -8); ctx.rotate(-1.2 + f * s2 - (s2 > 0 ? 0.4 : 0)); ctx.fillStyle = O; ctx.beginPath(); ctx.ellipse(3, 0, 5, 2.4, 0, 0, TAU); ctx.fill(); ctx.fillStyle = R2 ? '#e0d0b8' : '#ffe27a'; ctx.beginPath(); ctx.ellipse(3, 0, 4.2, 1.7, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    } else { S().ell(ctx, -0.5, -6, 2.8, 1.8, R2 ? '#d8c8b0' : '#f0c030'); }
    // голова: клюёт землю
    const peck = b.st === 'peck' ? Math.max(0, Math.sin(t * 7 + b.id * 2)) ** 3 : b.st === 'grab' ? 0.8 + Math.sin(t * 20) * 0.2 : 0;
    const hx = 4 + peck * 1.5, hy = -10 + peck * 7;
    S().circle(ctx, hx, hy, R2 ? 2.8 : 2.4, O); S().circle(ctx, hx, hy, R2 ? 2.1 : 1.8, body);
    if (R2) { ctx.fillStyle = '#e0302a'; ctx.beginPath(); ctx.arc(hx - 0.6, hy - 2.6, 1.3, 0, TAU); ctx.arc(hx + 0.9, hy - 2.9, 1.1, 0, TAU); ctx.fill(); ctx.fillRect(hx + 1.2, hy + 1, 1.2, 2); }
    ctx.fillStyle = '#f0a020'; ctx.beginPath(); ctx.moveTo(hx + 1.8, hy - 0.8); ctx.lineTo(hx + 4, hy + 0.2); ctx.lineTo(hx + 1.8, hy + 0.9); ctx.fill();
    ctx.fillStyle = O; ctx.fillRect(hx + 0.4, hy - 0.9, 0.9, 0.9);
    ctx.restore();
  }

  /* ============================ БОССЫ ============================ */
  const BOSS_LOOK = {
    giant:    { base: 'brute', scale: 1.55, pal: { skin: '#5a4a2a', skinD: '#3a2e18', skinL: '#7a6a3a' } },
    packlord: { base: 'wolf',  scale: 2.1,  pal: { fur: '#d8d4cc', furL: '#f4f0e8', furD: '#8a8478' } },
  };
  // Босс меньше в BOSS_SIZE раз: весь рисунок в масштабе вокруг ног, внутрь - исходный радиус (аура не уменьшается дважды)
  function drawBoss(ctx, m, t) {
    const k = C().BOSS_SIZE || 1;
    if (k === 1) { drawBossBody(ctx, m, t); return; }
    ctx.save(); ctx.translate(m.x, m.y); ctx.scale(k, k); ctx.translate(-m.x, -m.y);
    drawBossBody(ctx, Object.assign({}, m, { r: m.r / k }), t);
    ctx.restore();
  }
  function drawBossBody(ctx, m, t) {
    const x = m.x, y = m.y, a = m.a || 0, look = BOSS_LOOK[m.type];
    // аура босса
    ctx.save(); ctx.globalAlpha = 0.25 + Math.sin(t * 3) * 0.08;
    const g = ctx.createRadialGradient(x, y, m.r * 0.3, x, y, m.r * 1.8); g.addColorStop(0, 'rgba(255,40,30,0.6)'); g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + 4, m.r * 1.8, m.r * 0.9, 0, 0, TAU); ctx.fill(); ctx.restore();
    const wind = m.act ? 1 : 0;
    if (look) {
      const inner = { type: look.base, x: 0, y: 0, a, _walk: m._walk, hurt: m.hurt, atk: wind ? 1 : m.atk, r: 12, _pal: look.pal, _inner: true, dying: m.dying };
      ctx.save(); ctx.translate(x, y); ctx.scale(look.scale, look.scale);
      if (wind) ctx.translate(Math.sin(t * 40) * 0.8, 0);
      drawMonster(ctx, inner, t);
      ctx.restore();
    } else if (m.type === 'witch') {
      const fl = Math.sin(t * 2.5) * 3;
      S().ell(ctx, x, y + 6, 18, 6, 'rgba(0,0,0,0.35)');
      ctx.save(); ctx.translate(x, y - 16 + fl);
      ctx.fillStyle = '#0c0806'; ctx.beginPath(); ctx.moveTo(-17, 20); ctx.quadraticCurveTo(-14, -6, 0, -20); ctx.quadraticCurveTo(14, -6, 17, 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = m.hurt > 0 ? '#fff' : '#4a2a6a'; ctx.beginPath(); ctx.moveTo(-15, 18); ctx.quadraticCurveTo(-12, -5, 0, -18); ctx.quadraticCurveTo(12, -5, 15, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6a3f9a'; ctx.beginPath(); ctx.moveTo(-6, 18); ctx.quadraticCurveTo(-4, 0, 0, -14); ctx.lineTo(3, 18); ctx.fill();
      for (let i = -12; i <= 12; i += 6) { ctx.fillStyle = '#2a1840'; ctx.beginPath(); ctx.moveTo(i - 3, 18); ctx.lineTo(i, 23 + Math.sin(t * 6 + i) * 2); ctx.lineTo(i + 3, 18); ctx.fill(); }
      S().circle(ctx, 0, -18, 9, '#0c0806'); S().circle(ctx, 0, -18, 8, '#3a204e');
      S().ell(ctx, Math.cos(a) * 2, -16, 5, 4, '#150a20');
      S().circle(ctx, Math.cos(a) * 2 - 2.5, -17, 1.6, '#c0ff5a'); S().circle(ctx, Math.cos(a) * 2 + 2.5, -17, 1.6, '#c0ff5a');
      ctx.fillStyle = '#0c0806'; ctx.beginPath(); ctx.moveTo(-12, -22); ctx.lineTo(0, -48); ctx.lineTo(12, -22); ctx.fill();
      ctx.fillStyle = '#3a204e'; ctx.beginPath(); ctx.moveTo(-10, -23); ctx.lineTo(1, -45); ctx.lineTo(10, -23); ctx.fill();
      // посох
      const sx = Math.cos(a + 0.6) * 18, sy = 0;
      ctx.strokeStyle = '#0c0806'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx, sy + 18); ctx.lineTo(sx, sy - 30); ctx.stroke();
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 3; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      S().circle(ctx, sx, sy - 33, 6 + (wind ? 4 + Math.sin(t * 20) * 2 : 0), wind ? 'rgba(255,60,60,0.9)' : 'rgba(160,255,90,0.8)');
      ctx.restore();
    } else if (m.type === 'golem') {
      const bob = Math.sin((m._walk || 0) * 0.6) * 2, sh = wind ? Math.sin(t * 40) : 0;
      S().ell(ctx, x, y + 8, 38, 13, 'rgba(0,0,0,0.4)');
      ctx.save(); ctx.translate(x + sh, y - 18 + bob);
      const stone = m.hurt > 0 ? '#fff' : '#6e6c66', stoneD = '#4a4844', stoneL = '#8e8c84';
      for (const s of [-1, 1]) { // руки-глыбы
        const ax = s * 30 + Math.cos(a) * 6, ay = 6 + (wind ? -10 : 0);
        S().circle(ctx, ax, ay, 12, '#1b1a18'); S().circle(ctx, ax, ay, 10.5, stone); S().circle(ctx, ax - 3, ay - 3, 4, stoneL);
      }
      ctx.fillStyle = '#1b1a18'; roundRect(ctx, -26, -24, 52, 46, 12); ctx.fill();
      ctx.fillStyle = stone; roundRect(ctx, -24, -22, 48, 42, 11); ctx.fill();
      ctx.fillStyle = stoneL; roundRect(ctx, -20, -20, 22, 14, 6); ctx.fill();
      ctx.fillStyle = stoneD; ctx.fillRect(-24, 8, 48, 4);
      ctx.strokeStyle = '#3a3834'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -22); ctx.lineTo(-2, -8); ctx.lineTo(-10, 6); ctx.moveTo(10, -18); ctx.lineTo(14, 0); ctx.stroke();
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#4f7a36' : '#6d9a44'; ctx.fillRect(-20 + i * 5, -24 + (i % 3), 4, 3); }
      ctx.globalCompositeOperation = 'lighter';
      const ec = wind ? '#ff5a3a' : '#ffb03a', ex = Math.cos(a) * 5;
      S().circle(ctx, ex - 8, -8, 3.5, ec); S().circle(ctx, ex + 8, -8, 3.5, ec);
      S().ell(ctx, ex, 2, 7, 2.5, wind ? 'rgba(255,90,40,0.9)' : 'rgba(255,170,60,0.5)');
      ctx.restore();
    }
  }

  /* ============================ КРАСНЫЕ ЗОНЫ ============================ */
  function shapePath(ctx, t, grow) {
    ctx.beginPath();
    if (t.sh === 'c') ctx.arc(t.x, t.y, t.r * grow, 0, TAU);
    else if (t.sh === 'l') { ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a); ctx.rect(0, -t.w / 2, t.len * grow, t.w); ctx.restore(); }
    else if (t.sh === 'k') { ctx.moveTo(t.x, t.y); ctx.arc(t.x, t.y, t.len * grow, t.a - t.w, t.a + t.w); ctx.closePath(); }
  }
  function drawTele(ctx, t, time) {
    const prog = t.prog !== undefined ? t.prog : Math.min(1, t.t / t.dur);
    const col = t.fr ? '255,170,40' : '255,40,30';
    ctx.save();
    ctx.fillStyle = `rgba(${col},${0.12 + Math.sin(time * 18) * 0.03})`;
    shapePath(ctx, t, 1); ctx.fill();
    ctx.strokeStyle = `rgba(${col},0.85)`; ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -time * 30; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${col},${0.25 + prog * 0.3})`;
    shapePath(ctx, t, Math.max(0.02, prog)); ctx.fill();
    ctx.restore();
  }

  /* ============================ ПОСТРОЙКИ ============================ */
  // Замок на сундуке, пока жива стража
  function drawLock(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(x, y - 3, 4, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = '#c8c4b8'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y - 3, 4, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#1a1206'; ctx.fillRect(x - 6, y - 3.5, 12, 10);
    ctx.fillStyle = '#d8a83a'; ctx.fillRect(x - 5, y - 2.5, 10, 8);
    ctx.fillStyle = '#1a1206'; ctx.fillRect(x - 1, y, 2, 3.5);
    ctx.restore();
  }
  // Бегущий человечек (пиктограмма)
  function runnerIcon(ctx, x, y, s, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(4, -12, 3.6, 0, TAU); ctx.fill();                                    // голова
    ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(-2, 3); ctx.stroke();                           // туловище
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-3, -6); ctx.lineTo(2, -6); ctx.lineTo(6, -1); ctx.lineTo(10, -3); ctx.stroke(); // руки
    ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(4, 7); ctx.lineTo(2, 13); ctx.stroke();         // нога впереди
    ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-6, 9); ctx.lineTo(-12, 9); ctx.stroke();       // нога сзади
    ctx.restore();
  }
  function hpBar(ctx, x, y, w, frac, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * AB.clamp(frac, 0, 1), 3);
  }
  function drawModuleLight(ctx, x, y, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    S().circle(ctx, x, y, 3.5 + Math.sin(t * 6) * 0.8, 'rgba(90,168,255,0.9)'); S().circle(ctx, x, y, 7, 'rgba(90,168,255,0.2)');
    ctx.restore();
  }
  function selRing(ctx, x, y, r, t) {
    ctx.save(); ctx.strokeStyle = `rgba(255,220,120,${0.6 + Math.sin(t * 5) * 0.3})`; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 20;
    ctx.beginPath(); ctx.ellipse(x, y + 4, r, r * 0.5, 0, 0, TAU); ctx.stroke(); ctx.restore();
  }
  R.selRing = selRing;
  const Bd = () => AB.Bld;
  function label(ctx, s, x, y, col) {
    ctx.font = 'bold 9px "Nunito", system-ui'; ctx.textAlign = 'center';
    const w = ctx.measureText(s).width + 12;
    ctx.fillStyle = 'rgba(10,16,12,0.82)'; roundRect(ctx, x - w / 2, y - 7, w, 14, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y + 0.5); ctx.textBaseline = 'alphabetic';
  }
  R.label = label;
  // тёплый отсвет окон ночью (поверх спрайта, до общей тьмы)
  function windowGlow(ctx, pts, t) {
    const nf = G_ref ? G_ref.nightF : 0;
    if (nf < 0.05) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const q of pts) { const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], q[2]); g.addColorStop(0, `rgba(255,190,80,${0.35 * nf * (0.9 + Math.sin(t * 3 + q[0]) * 0.1)})`); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = g; ctx.fillRect(q[0] - q[2], q[1] - q[2], q[2] * 2, q[2] * 2); }
    ctx.restore();
  }
  function drawStruct(ctx, s, t, near) {
    const x = s.x, y = s.y;
    if (s.kind === 'wall') {
      Bd().draw(ctx, 'wall' + Math.min(3, s.bl || 1), x, y);
      if (s.bmod === 'spikes') { ctx.fillStyle = '#c8c0b0'; for (const dx of [-15, -5, 5, 15]) { ctx.beginPath(); ctx.moveTo(x + dx - 2, y + 2); ctx.lineTo(x + dx + 2, y + 2); ctx.lineTo(x + dx, y + 11); ctx.fill(); } }
      if (s.bmod === 'wire') { ctx.strokeStyle = '#9aa4ac'; ctx.lineWidth = 1; for (let i = 0; i < 2; i++) { ctx.beginPath(); for (let k = 0; k <= 12; k++) { const px = x - 18 + k * 3, py = y - 22 + i * 8 + (k % 2 ? -1.5 : 1.5); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); } }
      if (s.mod) { ctx.strokeStyle = `rgba(140,210,255,${0.5 + Math.sin(t * 20) * 0.4})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 16, y - 26); for (let i = 1; i <= 4; i++) ctx.lineTo(x - 16 + i * 8, y - 26 + (i % 2 ? -3 : 3)); ctx.stroke(); drawModuleLight(ctx, x, y - 42, t); }
    } else if (s.kind === 'tower') {
      Bd().draw(ctx, 'tower' + Math.min(3, s.tl || 1), x, y);
      // флаг на крыше
      ctx.fillStyle = '#16100b'; ctx.fillRect(x - 1, y - 136, 2, 16);
      ctx.fillStyle = '#c83a2a'; ctx.beginPath(); ctx.moveTo(x + 1, y - 136); ctx.lineTo(x + 14 + Math.sin(t * 4) * 2, y - 132 + Math.sin(t * 5) * 1); ctx.lineTo(x + 1, y - 127); ctx.fill();
      if (s.armed) {
        ctx.save(); ctx.translate(x, y - 80); ctx.rotate(s.a || 0);
        ctx.fillStyle = '#111'; ctx.fillRect(-2, -5, 24, 10); ctx.fillStyle = '#4a4f55'; ctx.fillRect(-1, -4, 22, 8); ctx.fillStyle = '#6a7078'; ctx.fillRect(-1, -4, 22, 2); ctx.fillStyle = '#111'; ctx.fillRect(19, -5.5, 4, 11);
        ctx.restore();
        S().circle(ctx, x, y - 80, 7.5, '#111'); S().circle(ctx, x, y - 80, 6.3, '#3a3f45'); S().circle(ctx, x - 2, y - 82, 2, '#8a9098');
      }
      if (s.bmod === 'light') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x + 18, y - 90, 4, 'rgba(255,240,180,0.9)'); S().circle(ctx, x + 18, y - 90, 9, 'rgba(255,240,180,0.25)'); ctx.restore(); }
      if (s.mod) drawModuleLight(ctx, x - 16, y - 90, t);
    } else if (s.kind === 'shop') {
      Bd().draw(ctx, 'shop', x, y);
      const n = s.stockN !== undefined ? s.stockN : (s.stock ? s.stock.length : 0);
      if (n > 0) ctx.drawImage(S().icons.hide, x - 26, y - 32, 16, 16);
      if (n > 1) ctx.drawImage(S().icons.cooked_meat, x - 8, y - 31, 15, 15);
      if (n > 2) ctx.drawImage(S().icons.cooked_pumpkin, x + 9, y - 31, 15, 15);
      if (n > 0) {
        const prog = s.sellP !== undefined ? s.sellP : (s.sellT || 0) / C().SHOP.sellTime;
        hpBar(ctx, x, y + 12, 36, prog, '#ffd24a');
        ctx.font = 'bold 9px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7a8'; ctx.fillText(`товаров: ${n}`, x, y + 26);
      }
      if (near) label(ctx, 'Лавка охотника', x, y - 94, '#8fe08a');
      return;
    } else if (s.kind === 'exchange') {
      Bd().draw(ctx, 'exchange', x, y);
      // живые экраны
      const scr = (sx, sy, w, h, main) => {
        ctx.fillStyle = '#081828'; ctx.fillRect(sx, sy, w, h);
        const h2 = G_ref && G_ref.crypto ? G_ref.crypto.hist : [];
        if (main && h2 && h2.length > 1) {
          const mx = Math.max(...h2), mn = Math.min(...h2);
          ctx.strokeStyle = h2[h2.length - 1] >= h2[h2.length - 2] ? '#5aff8a' : '#ff5a4a'; ctx.lineWidth = 1; ctx.beginPath();
          h2.forEach((v, i) => { const px = sx + 1 + i / (h2.length - 1) * (w - 2), py = sy + h - 2 - (mx > mn ? (v - mn) / (mx - mn) : 0.5) * (h - 4); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
          ctx.stroke();
        } else { ctx.fillStyle = '#5aa8ff'; for (let i = 0; i < 4; i++) ctx.fillRect(sx + 1.5, sy + 1.5 + i * 2.2, ((Math.sin(t * 2 + i * 1.7) + 1.3) * 0.35) * (w - 3), 1); }
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(90,168,255,0.18)'; ctx.fillRect(sx - 3, sy - 3, w + 6, h + 6); ctx.restore();
      };
      scr(x - 19, y - 28, 16, 10, true); scr(x + 3.5, y - 24.5, 11, 7, false);
      for (let i = 0; i < 4; i++) S().circle(ctx, x + 28, y - 14.7 + i * 4, 0.9, Math.sin(t * 7 + i * 2) > 0 ? '#5aff8a' : '#2a6a3a');
      // антенна
      ctx.fillStyle = '#16100b'; ctx.fillRect(x + 21, y - 96, 2, 22); S().circle(ctx, x + 22, y - 97, 2.4, Math.sin(t * 5) > 0 ? '#9fdcff' : '#3a6a9a');
      windowGlow(ctx, [[x + 25, y - 26, 16]], t);
      if (near) label(ctx, `Крипто-биржа · AviCoin ${G_ref.crypto ? G_ref.crypto.price : '—'}$`, x, y - 110, '#9fdcff');
    } else if (s.kind === 'workshop') {
      Bd().draw(ctx, 'workshop', x, y);
      // горн мерцает, из трубы дым, у наковальни искры
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fl = 0.35 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
      const g = ctx.createRadialGradient(x - 2, y - 12, 1, x - 2, y - 12, 18); g.addColorStop(0, `rgba(255,150,50,${fl})`); g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 20, y - 30, 36, 28); ctx.restore();
      if (Math.random() < 0.08) AB.FX.add({ t: 'smoke', x: x + 27, y: y - 96, z: 0, vx: 4 + Math.random() * 4, vy: -3, vz: 16, g: -4, life: 2.2, size: 6, c: 'rgba(120,120,120,' });
      if (Math.random() < 0.05) AB.FX.add({ t: 'spark', x: x - 26, y: y - 8, z: 4, vx: (Math.random() - 0.5) * 60, vy: 0, vz: 50, g: 150, life: 0.4, size: 1.5, c: '#ffd24a' });
      windowGlow(ctx, [[x - 31, y - 25, 16], [x + 29, y - 25, 16]], t);
      if (near) label(ctx, 'Мастерская', x, y - 110, '#ffb23a');
    } else if (s.kind === 'townhall') {
      Bd().draw(ctx, 'townhall', x, y);
      if (Math.random() < 0.06) AB.FX.add({ t: 'smoke', x: x - 45, y: y - 100, z: 0, vx: 4 + Math.random() * 4, vy: -3, vz: 16, g: -4, life: 2.2, size: 6, c: 'rgba(120,120,120,' });
      ctx.fillStyle = '#16100b'; ctx.fillRect(x + 30, y - 116, 2, 16); ctx.fillStyle = '#d08aff'; ctx.beginPath(); ctx.moveTo(x + 32, y - 116); ctx.lineTo(x + 45 + Math.sin(t * 4) * 2, y - 112); ctx.lineTo(x + 32, y - 108); ctx.fill();
      windowGlow(ctx, [[x - 46, y - 25, 16], [x - 24, y - 14, 14], [x + 31, y - 66, 12], [x + 53, y - 29, 12]], t);
      if (near) label(ctx, `Ратуша · содержание −${AB.Sim.thDiscount(s)}%`, x, y - 124, '#d08aff');
    } else if (s.kind === 'turret') {
      Bd().draw(ctx, 'turret', x, y);
      ctx.save(); ctx.translate(x, y - 28); ctx.rotate(s.a || 0);
      ctx.fillStyle = '#111'; ctx.fillRect(0, -4, 20, 8); ctx.fillStyle = '#5a6068'; ctx.fillRect(1, -3, 18, 6); ctx.fillStyle = '#8a9098'; ctx.fillRect(1, -3, 18, 1.5); ctx.fillStyle = '#111'; ctx.fillRect(17, -4.5, 4, 9);
      ctx.restore();
      S().circle(ctx, x, y - 28, 8, '#111'); S().circle(ctx, x, y - 28, 6.8, '#3a3f45');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.7 + Math.sin(t * 4 + s.id) * 0.2;
      S().circle(ctx, x, y - 29, 3.6, `rgba(90,180,255,${pulse})`); S().circle(ctx, x, y - 29, 8, `rgba(90,168,255,${0.25 * pulse})`); S().circle(ctx, x - 1, y - 30, 1.4, 'rgba(230,245,255,0.9)');
      ctx.restore();
      if (s.mod) drawModuleLight(ctx, x + 10, y - 20, t);
    }
    if (s.hp < s.mhp || near) hpBar(ctx, x, y + 10, 30, s.hp / s.mhp, '#8fd45a');
    // уровни: А — вышка (архитектор), И — пушка/турель (инженер), П — модуль (программист)
    const pips = [];
    if (s.kind === 'tower' && (s.tl || 1) > 1) pips.push(['#d08aff', s.tl]);
    if ((s.armed || s.kind === 'turret') && (s.cl || 1) > 1) pips.push(['#ffb23a', s.cl]);
    if (s.mod && (s.ml || 1) > 1) pips.push(['#5aa8ff', s.ml]);
    if ((s.bl || 1) > 1) pips.push(['#e0c08a', s.bl]);
    pips.forEach((pp, i) => { ctx.font = 'bold 9px "Nunito", system-ui'; ctx.textAlign = 'center'; const px = x - (pips.length - 1) * 9 + i * 18; S().circle(ctx, px, y + 22, 6.5, '#111'); S().circle(ctx, px, y + 22, 5.5, pp[0]); ctx.fillStyle = '#111'; ctx.fillText(pp[1], px, y + 25); });
    if (G_ref && G_ref.debt > 0 && s.kind !== 'wall') { ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff5a4a'; ctx.fillText('$✕', x, y - 30 - (s.kind === 'tower' ? 110 : s.kind === 'turret' ? 14 : s.kind === 'wall' ? 16 : 70)); }
  }
  let G_ref = null;
  // Полевая кухня: навес, очаг с котлом на треноге, стол
  function drawKitchen(ctx, K, t, G) {
    const x = K.x, y = K.y, cfg = C();
    Bd().draw(ctx, 'kitchen', x, y);
    ctx.drawImage(S().icons.carrot, x + 13, y - 24, 12, 12); ctx.drawImage(S().icons.meat, x + 23, y - 23, 12, 12);
    const cooking = K.slots && K.slots.length;
    const fire = G.fires.find(f => f.main), lit = fire && fire.fuel > 0;
    if (cooking && lit) {
      const fl = Math.sin(t * 12) * 1.2;
      S().ell(ctx, x - 19, y - 3, 9, 4, '#ff7a1a'); S().ell(ctx, x - 19, y - 4, 5 + fl * 0.3, 2.5, '#ffd24a');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x - 19, y - 6, 14, 'rgba(255,140,40,0.18)'); ctx.restore();
    }
    S().ell(ctx, x - 19, y - 12, 13, 10, '#111'); S().ell(ctx, x - 19, y - 13, 11.5, 8.5, '#3a3f45'); S().ell(ctx, x - 22, y - 16, 4, 3, 'rgba(255,255,255,0.12)');
    S().ell(ctx, x - 19, y - 19, 11, 3.5, '#111'); S().ell(ctx, x - 19, y - 19, 9.5, 2.6, cooking ? '#b8702a' : '#2a2a2a');
    if (cooking && Math.random() < 0.12) AB.FX.add({ t: 'smoke', x: x - 19 + (Math.random() - 0.5) * 8, y: y - 20, z: 8, vx: (Math.random() - 0.5) * 6, vy: -3, vz: 22, g: -4, life: 1.6, size: 4, c: 'rgba(230,230,230,' });
    // очередь и прогресс
    if (K.slots) K.slots.forEach((sl, i) => {
      const prog = sl.prog !== undefined ? sl.prog : (cfg.COOKING[sl.k] ? sl.t / cfg.COOKING[sl.k].time : 0);
      const bx = x - 40 + (i % 5) * 26, by = y - 116 - Math.floor(i / 5) * 30;
      ctx.fillStyle = 'rgba(10,16,12,0.85)'; roundRect(ctx, bx, by, 22, 26, 5); ctx.fill();
      ctx.drawImage(S().icons[sl.k], bx + 3, by + 2, 16, 16);
      ctx.fillStyle = '#333'; ctx.fillRect(bx + 2, by + 20, 18, 3);
      ctx.fillStyle = '#ffae3a'; ctx.fillRect(bx + 2, by + 20, 18 * AB.clamp(prog, 0, 1), 3);
    });
    const qn = K.queue ? K.queue.length : 0;
    if (qn) { ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffe7a8'; ctx.fillText('+' + qn, x - 40 + Math.min(5, K.slots ? K.slots.length : 0) * 26, y - 100); }
    // стол с готовыми блюдами справа от кухни
    const rd = K.ready || {}, dishes = [];
    for (const k in rd) for (let i = 0; i < Math.min(rd[k], 6); i++) dishes.push(k);
    if (dishes.length) {
      const tx = x + 58, ty = y + 6;
      S().ell(ctx, tx, ty + 12, 26, 5, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = '#16100b'; ctx.fillRect(tx - 23, ty + 2, 4, 10); ctx.fillRect(tx + 19, ty + 2, 4, 10);
      ctx.fillStyle = '#16100b'; roundRect(ctx, tx - 26, ty - 4, 52, 9, 3); ctx.fill();
      ctx.fillStyle = '#9a6a3e'; roundRect(ctx, tx - 25, ty - 3, 50, 6.5, 2.5); ctx.fill();
      dishes.slice(0, 8).forEach((k, i) => {
        const dx = tx - 20 + (i % 4) * 13, dy = ty - 12 - Math.floor(i / 4) * 9;
        S().ell(ctx, dx + 5, dy + 9, 6, 2, '#e8e0cc'); ctx.drawImage(S().icons[k], dx - 1, dy - 1, 12, 12);
      });
      if (Math.sin(t * 3) > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, tx, ty - 14, 18, 'rgba(255,220,140,0.08)'); ctx.restore(); }
      const total = Object.values(rd).reduce((a, b) => a + b, 0);
      ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff2c0'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(`готово ×${total}`, tx, ty - 30); ctx.fillText(`готово ×${total}`, tx, ty - 30);
    }
    label(ctx, `Кухня ур.${K.lvl || 1} · готовит ${K.slots ? K.slots.length : 0}/${K.lvl || 1}`, x, y + 18, '#ffc46b');
  }
  // Лесопилка: навес, пильный стол с дисковой пилой, куча бревен и стопка досок
  function drawStore(ctx, Mo, t) {
    const x = Mo.x, y = Mo.y;
    Bd().draw(ctx, 'mill', x, y);
    // бревна (вход) — пирамида слева
    const logs = Math.min(10, Mo.logs || 0);
    const pos = [[0, 0], [9, 0], [18, 0], [27, 0], [4.5, -7], [13.5, -7], [22.5, -7], [9, -14], [18, -14], [13.5, -21]];
    for (let i = 0; i < logs; i++) {
      const lx = x - 58 + pos[i][0], ly = y + 8 + pos[i][1];
      ctx.fillStyle = '#16100b'; ctx.fillRect(lx - 1, ly - 4.5, 12, 9); ctx.fillStyle = '#6b4a2e'; ctx.fillRect(lx, ly - 3.5, 10, 7); ctx.fillStyle = '#8a5a32'; ctx.fillRect(lx, ly - 3.5, 10, 2);
      S_ell(ctx, lx + 10, ly, 3.4, 4, '#16100b'); S_ell(ctx, lx + 10, ly, 2.6, 3.2, '#d8b07a'); S_ell(ctx, lx + 10, ly, 1, 1.2, '#9a7646');
    }
    // бревно на столе и дисковая пила
    const sawing = (Mo.saws || []).length > 0;
    if (sawing) { ctx.fillStyle = '#16100b'; ctx.fillRect(x - 15, y - 17, 30, 6); ctx.fillStyle = '#7a5234'; ctx.fillRect(x - 14, y - 16, 28, 4); ctx.fillStyle = '#946a42'; ctx.fillRect(x - 14, y - 16, 28, 1.3); }
    ctx.save(); ctx.translate(x - 1, y - 20); ctx.rotate(sawing ? t * 20 : 0);
    S().circle(ctx, 0, 0, 10, '#111'); S().circle(ctx, 0, 0, 8.5, '#b9c2c9'); S().circle(ctx, 0, 0, 5, '#d8e0e6');
    ctx.fillStyle = '#111'; for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.fillRect(8, -1, 3, 2); }
    S().circle(ctx, 0, 0, 2, '#555');
    ctx.restore();
    if (sawing && Math.random() < 0.35) AB.FX.add({ t: 'p', x: x - 1, y: y - 14, z: 4, vx: (Math.random() - 0.5) * 60, vy: 10, vz: 40, g: 200, life: 0.5, size: 2, c: '#e0c08a' });
    // доски (выход) — стопка справа
    const pl = Math.min(8, (Mo.saws || []).length * 3 + Math.min(5, Math.floor((Mo.planks || 0) / 10)));
    for (let i = 0; i < pl; i++) {
      const py = y + 4 - i * 3;
      ctx.fillStyle = '#16100b'; ctx.fillRect(x + 20, py - 2, 24, 4.4); ctx.fillStyle = i % 2 ? '#d8b078' : '#c8a06a'; ctx.fillRect(x + 21, py - 1.4, 22, 3); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 21, py - 1.4, 22, 0.8);
    }
    const sw = (Mo.saws || []);
    // по полоске на каждое бревно, которое пилится прямо сейчас (ур. N — до N сразу)
    sw.forEach((v, i) => hpBar(ctx, x, y - 38 - i * 7, 34, v / C().MILL.sawTime, '#e0c08a'));
    // кладовая: стойка со шкурами справа от навеса (сдача — ПКМ по лесопилке)
    if ((Mo.hides || 0) > 0) {
      const hn = Math.min(5, Mo.hides);
      ctx.fillStyle = '#16100b'; ctx.fillRect(x + 44, y - 6, 4, 26); ctx.fillRect(x + 58, y - 6, 4, 26);
      for (let i = 0; i < hn; i++) {
        const hy = y + 16 - i * 4;
        ctx.fillStyle = '#16100b'; ctx.fillRect(x + 42, hy - 3, 24, 5);
        ctx.fillStyle = i % 2 ? '#a8763e' : '#c08d4e'; ctx.fillRect(x + 43, hy - 2, 22, 3);
      }
      ctx.fillStyle = '#ffd24a'; ctx.fillRect(x + 42, y - 12, 24, 2);
    }
    label(ctx, `Лесопилка ур.${Mo.lvl || 1} · пилит ${sw.length}/${AB.Sim.millLines(Mo)} · очередь ${Mo.logs || 0}/${C().MILL.queueMax}${(Mo.hides || 0) > 0 ? ` · шкуры ${Mo.hides}` : ''}`, x, y + 22, '#e0c08a');
  }
  const S_ell = (c, x, y, rx, ry, col) => S().ell(c, x, y, rx, ry, col);
  // Странствующий торговец с фургоном
  function drawMerchant(ctx, M, t) {
    const x = M.x, y = M.y, bob = Math.sin(t * 2) * 1;
    Bd().draw(ctx, 'wagon', x, y);
    ctx.drawImage(S().icons.berry, x + 18, y - 40, 11, 11); ctx.drawImage(S().icons.hide, x + 29, y - 40, 12, 12);
    // фонарь светится
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x + 60.5, y - 37, 7 + Math.sin(t * 6) * 0.8, 'rgba(255,210,90,0.35)'); ctx.restore();
    // сам торговец: плащ, широкополая шляпа, посох
    S_ell(ctx, x - 14, y + 7, 11, 4, 'rgba(0,0,0,0.3)');
    ctx.strokeStyle = '#16100b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 25, y + 6); ctx.lineTo(x - 23, y - 30 + bob); ctx.stroke();
    ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = 1.6; ctx.stroke();
    S().circle(ctx, x - 14, y - 6 + bob, 11, '#16100b'); S().circle(ctx, x - 14, y - 6 + bob, 9.7, '#5a2e5e');
    ctx.fillStyle = '#7a4a7e'; ctx.beginPath(); ctx.arc(x - 17, y - 9 + bob, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8b050'; ctx.fillRect(x - 23, y - 4 + bob, 18, 2.5);
    S().circle(ctx, x - 24, y - 8 + bob, 3, '#16100b'); S().circle(ctx, x - 24, y - 8 + bob, 2.2, '#e8b890');
    S().circle(ctx, x - 14, y - 19 + bob, 8, '#16100b'); S().circle(ctx, x - 14, y - 19 + bob, 7, '#e8b890');
    ctx.fillStyle = '#1a120c'; ctx.fillRect(x - 17, y - 19 + bob, 2, 2); ctx.fillRect(x - 12, y - 19 + bob, 2, 2);
    ctx.fillStyle = '#e8e0d0'; ctx.beginPath(); ctx.moveTo(x - 19, y - 15 + bob); ctx.quadraticCurveTo(x - 14, y - 6 + bob, x - 9, y - 15 + bob); ctx.fill();
    ctx.fillStyle = '#16100b'; ctx.beginPath(); ctx.ellipse(x - 14, y - 23 + bob, 14, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a2a4a'; ctx.beginPath(); ctx.ellipse(x - 14, y - 23 + bob, 12.6, 3.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#16100b'; ctx.beginPath(); ctx.ellipse(x - 14, y - 27 + bob, 7.5, 6, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#5a345a'; ctx.beginPath(); ctx.ellipse(x - 14, y - 27 + bob, 6.4, 5, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#d8b050'; ctx.fillRect(x - 20, y - 27 + bob, 12, 1.6);
    label(ctx, 'Торговец', x + 20, y - 76, '#ffd24a');
    if (Math.sin(t * 3) > 0.95) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x + 36, y - 48, 3, '#fff6c0'); ctx.restore(); }
  }
  function drawMine(ctx, mn, t) {
    if (mn.look === 'trap') {
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(mn.x, mn.y, 9, 5, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#8a9096'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = '#c9d3da'; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.fillRect(mn.x + Math.cos(a) * 8 - 0.8, mn.y + Math.sin(a) * 4.5 - 2, 1.6, 2.5); }
      return;
    }
    S().ell(ctx, mn.x, mn.y, 7, 4, '#1a1a1a'); S().ell(ctx, mn.x, mn.y - 1, 5.5, 3, '#5a5f66');
    if (Math.sin(t * 6 + mn.x) > 0) S().circle(ctx, mn.x, mn.y - 2, 1.5, '#ff3a2a');
  }
  function drawDrone(ctx, x, y, t, a) {
    S().ell(ctx, x, y + 22, 6, 2.5, 'rgba(0,0,0,0.25)');
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(8, 5); ctx.moveTo(8, -5); ctx.lineTo(-8, 5); ctx.stroke();
    for (const [px, py] of [[-8, -5], [8, 5], [8, -5], [-8, 5]]) { ctx.fillStyle = 'rgba(200,220,255,0.5)'; ctx.beginPath(); ctx.ellipse(px, py, 5, 1.4, t * 30, 0, TAU); ctx.fill(); }
    S().circle(ctx, 0, 0, 5, '#111'); S().circle(ctx, 0, 0, 4, '#3a5f9a');
    ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, Math.cos(a) * 2, Math.sin(a) * 1.5, 1.8, '#9fdcff');
    ctx.restore();
  }
  function drawBird(ctx, x, y, t, i) {
    S().ell(ctx, x, y + 22, 6, 2.5, 'rgba(0,0,0,0.25)');
    const f = Math.sin(t * 14 + i) * 5;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#120a06'; ctx.beginPath(); ctx.moveTo(-11, -f - 1); ctx.quadraticCurveTo(-4, -3, 0, 0); ctx.quadraticCurveTo(4, -3, 11, -f - 1); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a6a44'; ctx.beginPath(); ctx.moveTo(-10, -f); ctx.quadraticCurveTo(-4, -2, 0, 0.5); ctx.quadraticCurveTo(4, -2, 10, -f); ctx.lineTo(0, 2); ctx.closePath(); ctx.fill();
    S().circle(ctx, 0, -1, 2.6, '#d8c8a8'); ctx.fillStyle = '#ffb02a'; ctx.fillRect(-0.8, 0.6, 1.6, 2);
    ctx.restore();
  }
  function drawOrbit(ctx, op, def, t) {
    ctx.save(); ctx.translate(op.x, op.y - 6);
    if (def.look === 'saw') {
      ctx.rotate(t * 20);
      S().circle(ctx, 0, 0, 11, '#111');
      ctx.fillStyle = '#c9d3da'; ctx.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, r = i % 2 ? 10 : 7.5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
      S().circle(ctx, 0, 0, 2.5, '#555');
    } else if (def.look === 'cube') {
      ctx.rotate(t * 3);
      ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, 0, 0, 12, 'rgba(90,168,255,0.25)'); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0c1a30'; ctx.fillRect(-7, -7, 14, 14); ctx.fillStyle = '#5aa8ff'; ctx.fillRect(-5.5, -5.5, 11, 11); ctx.fillStyle = '#cfe6ff'; ctx.fillRect(-2, -2, 4, 4);
    } else {
      ctx.rotate(op.a + Math.PI / 2);
      ctx.fillStyle = '#140c08'; ctx.fillRect(-4, -15, 8, 30); ctx.fillStyle = '#b8864a'; ctx.fillRect(-3, -14, 6, 28); ctx.fillStyle = '#8a5a30'; ctx.fillRect(-3, -5, 6, 2); ctx.fillRect(-3, 5, 6, 2);
    }
    ctx.restore();
  }
  function drawBot(ctx, b, t) {
    const def = AB.Sim.abDef(b.ab) || {}, look = def.look;
    S().ell(ctx, b.x, b.y + 4, 11, 4.5, 'rgba(0,0,0,0.35)');
    ctx.strokeStyle = '#140c08'; ctx.lineWidth = 3;
    for (const dx of [-7, 0, 7]) { ctx.beginPath(); ctx.moveTo(b.x, b.y - 8); ctx.lineTo(b.x + dx, b.y + 3); ctx.stroke(); }
    ctx.save(); ctx.translate(b.x, b.y - 12); ctx.rotate(b.a || 0);
    if (look === 'bot') { S().circle(ctx, 0, 0, 7.5, '#111'); S().circle(ctx, 0, 0, 6.3, '#3a5f9a'); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, 3, 0, 2.3, '#ff6a5a'); }
    else if (look === 'ballista') { ctx.fillStyle = '#140c08'; ctx.fillRect(-9, -3, 22, 6); ctx.fillStyle = '#8a5a30'; ctx.fillRect(-8, -2, 20, 4); ctx.strokeStyle = '#140c08'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(8, 0, 10, -1.3, 1.3); ctx.stroke(); }
    else { ctx.fillStyle = '#111'; ctx.fillRect(-7, -5, 14, 10); ctx.fillStyle = '#d0782a'; ctx.fillRect(-6, -4, 12, 8); ctx.fillStyle = '#222'; ctx.fillRect(4, -1.5, 10, 3); }
    ctx.restore();
    const lf = b.lf !== undefined ? b.lf : b.life / b.max;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(b.x - 11, b.y + 9, 22, 3); ctx.fillStyle = '#8fe08a'; ctx.fillRect(b.x - 11, b.y + 9, 22 * lf, 3);
  }
  function drawBlade(ctx, bp, t) {
    ctx.save(); ctx.translate(bp.x, bp.y - 6); ctx.rotate(bp.a + Math.PI / 2 + t * 12);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(4, 0); ctx.lineTo(0, 12); ctx.lineTo(-4, 0); ctx.fill();
    ctx.fillStyle = '#dfe8ee'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(2.6, 0); ctx.lineTo(0, 10); ctx.lineTo(-2.6, 0); ctx.fill();
    ctx.restore();
  }

  /* ============================ ОБЪЕКТЫ ============================ */
  function drawSprite(ctx, sp, x, y, s, alpha) {
    s = (s || 1) / (sp.k || 1);
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    AB.blit(ctx, sp.c, x - sp.ox * s, y - sp.oy * s, sp.c.width * s, sp.c.height * s, sp.ox * s, sp.oy * s);
    if (alpha !== undefined) ctx.globalAlpha = 1;
  }
  function drawFire(ctx, f, t, near) {
    const x = f.x, y = f.y;
    // кольцо из крупных камней (кэш)
    Bd().draw(ctx, f.main ? 'fireMain' : 'fireSmall', x, y);
    const big = f.main ? 1.25 : 1;
    // поленья
    ctx.lineCap = 'round';
    for (const [a1, c] of [[0.5, '#5a3a20'], [-0.5, '#6b4a2e'], [1.6, '#4a3018']]) {
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x - Math.cos(a1) * 13 * big, y - Math.sin(a1) * 6 * big); ctx.lineTo(x + Math.cos(a1) * 13 * big, y + Math.sin(a1) * 6 * big); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.stroke();
      if (f.fuel > 0) { ctx.strokeStyle = 'rgba(255,120,30,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - Math.cos(a1) * 6, y - Math.sin(a1) * 3 + 1.5); ctx.lineTo(x + Math.cos(a1) * 6, y + Math.sin(a1) * 3 + 1.5); ctx.stroke(); }
    }
    if (f.fuel > 0) {
      const k = (0.45 + 0.55 * Math.min(1, f.fuel / ((f.cap || 20) * 0.5))) * (1 + 0.18 * ((f.lvl || 1) - 1)) * big;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(x, y - 8 * k, 1, x, y - 8 * k, 34 * k); gg.addColorStop(0, 'rgba(255,170,60,0.45)'); gg.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = gg; ctx.fillRect(x - 36 * k, y - 44 * k, 72 * k, 72 * k); ctx.restore();
      S().ell(ctx, x, y, 10 * big, 5 * big, '#ff7a1a');
      for (let i = 0; i < 3; i++) {
        const fl = Math.sin(t * (9 + i * 3) + i * 2) * 0.12 + 1;
        const h = (26 - i * 7) * k * fl, w = (11 - i * 3) * k;
        const col = ['#e8401a', '#ff9a1a', '#ffe36a'][i];
        const dx = Math.sin(t * 5 + i) * 2;
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.8, y - h * 0.55, x + dx, y - h);
        ctx.quadraticCurveTo(x + w * 0.8, y - h * 0.55, x + w, y); ctx.closePath(); ctx.fill();
      }
      if (Math.random() < 0.25) AB.FX.add({ t: 'spark', x: x + (Math.random() - 0.5) * 10, y, z: 10, vx: (Math.random() - 0.5) * 20, vy: 0, vz: 40 + Math.random() * 50, g: -20, life: 0.8 + Math.random() * 0.6, size: 1.5, c: Math.random() < 0.5 ? '#ffd24a' : '#ff8a2a' });
      if (Math.random() < 0.06) AB.FX.add({ t: 'smoke', x, y, z: 30, vx: 6, vy: -4, vz: 20, g: -5, life: 2.5, size: 8, c: 'rgba(90,90,90,' });
    } else {
      S().ell(ctx, x, y, 8, 4, '#3a3a3a');
      if (Math.random() < 0.02) AB.FX.add({ t: 'smoke', x, y, z: 6, vx: 4, vy: -3, vz: 12, g: -3, life: 2, size: 5, c: 'rgba(100,100,100,' });
    }
    if (f.mod) drawModuleLight(ctx, x + 18, y - 4, t);
    if (f.main && (f.lvl || 1) > 1) {
      ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'center';
      const tc = C().TIER_COLORS[Math.min(3, (f.lvl || 1) - 1)];
      ctx.fillStyle = 'rgba(10,16,12,0.8)'; roundRect(ctx, x - 16, y + 22, 32, 13, 6); ctx.fill(); ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = tc; ctx.fillText('ур. ' + f.lvl, x, y + 29);
    }
    if (f.town !== undefined) { // вечный костёр поселения: подпись с названием вместо шкалы
      const tn = G_ref && G_ref.W.towns && G_ref.W.towns[f.town];
      if (tn) label(ctx, `${tn.name} · вечный костёр`, x, y + 22, '#ffe7a8');
      return;
    }
    if (near) {
      drawFireBar(ctx, f, x, y);
    }
  }
  // Шкала костра: ширина растёт с уровнем (1 деление = 2 px), видны границы ступеней
  function drawFireBar(ctx, f, x, y) {
    const cap = f.cap || C().FIRE_FUEL_MAX, ppu = f.main ? 2 : 2, w = Math.min(320, cap * ppu), frac = AB.clamp(f.fuel / cap, 0, 1);
    const bx = x - w / 2, by = y + (f.main && (f.lvl || 1) > 1 ? 38 : 16);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, 8);
    const g = ctx.createLinearGradient(bx, 0, bx + w, 0); g.addColorStop(0, '#e0503a'); g.addColorStop(1, '#ffd24a');
    ctx.fillStyle = frac < 0.2 ? '#e0503a' : g; ctx.fillRect(bx, by, w * frac, 6);
    if (f.main) {
      let acc = 0; ctx.fillStyle = 'rgba(0,0,0,0.8)';
      const steps = C().FIRE_LEVEL_STEPS;
      for (let i = 0; i < (f.lvl || 1) - 1; i++) { acc += steps[i] || 0; ctx.fillRect(bx + acc * ppu * (w / (cap * ppu)) - 1, by - 2, 2, 10); }
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (let u = 5; u < cap; u += 5) ctx.fillRect(bx + u / cap * w, by, 1, 6);
    }
    ctx.font = 'bold 9px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7a8';
    ctx.fillText(`${Math.floor(f.fuel)}/${cap}`, x, by + 16);
  }
  // Молодой побег: растёт от ростка до маленького деревца
  function drawSapling(ctx, o, k, t) {
    const x = o.x, y = o.y, h = 6 + k * 34, sway = Math.sin(t * 1.5 + o.x) * (1 + k);
    S().ell(ctx, x, y + 2, 5 + k * 10, 2 + k * 3, 'rgba(0,0,0,0.25)');
    ctx.strokeStyle = '#3a2616'; ctx.lineWidth = 1.5 + k * 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway * 0.5, y - h * 0.5, x + sway, y - h); ctx.stroke();
    const pine = o.v >= 3 && o.v <= 7, lr = 3 + k * 11;
    if (pine) {
      for (let i = 0; i < 3; i++) { const yy = y - h * (0.45 + i * 0.25), w = lr * (1 - i * 0.25);
        ctx.fillStyle = '#0e1a0e'; ctx.beginPath(); ctx.moveTo(x + sway - w - 1, yy + 1); ctx.lineTo(x + sway, yy - w * 1.1 - 1); ctx.lineTo(x + sway + w + 1, yy + 1); ctx.fill();
        ctx.fillStyle = i % 2 ? '#2b5a2b' : '#3b7a55'; ctx.beginPath(); ctx.moveTo(x + sway - w, yy); ctx.lineTo(x + sway, yy - w * 1.1); ctx.lineTo(x + sway + w, yy); ctx.fill(); }
    } else {
      for (const [dx, dy, rs] of [[-0.6, 0.1, 0.7], [0.6, 0.15, 0.7], [0, -0.35, 0.85]]) {
        S().circle(ctx, x + sway + dx * lr, y - h + dy * lr, lr * rs + 1, '#10200f');
        S().circle(ctx, x + sway + dx * lr, y - h + dy * lr, lr * rs, dy < 0 ? '#6fa84a' : '#4f8a3a');
      }
    }
  }
  function drawTorch(ctx, x, y, t) {
    ctx.fillStyle = '#140c08'; ctx.fillRect(x - 2.5, y - 26, 5, 27);
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x - 1.5, y - 25, 3, 25);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x - 3.5, y - 29, 7, 5);
    const h = 11 + Math.sin(t * 13 + x) * 2;
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(x - 4, y - 28); ctx.quadraticCurveTo(x, y - 28 - h * 1.2, x + 4, y - 28); ctx.fill();
    ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.moveTo(x - 2, y - 28); ctx.quadraticCurveTo(x, y - 28 - h * 0.7, x + 2, y - 28); ctx.fill();
  }
  function drawDecor(ctx, d, t) {
    const sp = S();
    if (SITE_PROPS[d.kind]) { SITE_PROPS[d.kind](ctx, d, t); return; }
    if (AB.Towns && AB.Towns.has(d.kind)) { AB.Towns.draw(ctx, d); return; }
    if (d.kind === 'tent') Bd().draw(ctx, 'tent', d.x, d.y);
    else if (d.kind === 'logs') drawSprite(ctx, sp.logs, d.x, d.y);
    else if (d.kind === 'stump_seat') drawSprite(ctx, sp.stump, d.x, d.y);
    else if (d.kind === 'torch') drawTorch(ctx, d.x, d.y, t);
    else if (d.kind === 'crate') {
      const x = d.x, y = d.y, w = 13 + d.v * 5;
      S().ell(ctx, x + 2, y + 2, w * 0.9, 4, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = '#140c08'; ctx.fillRect(x - w / 2 - 1, y - w - 1, w + 2, w + 2);
      ctx.fillStyle = d.v > 0.5 ? '#8a5a30' : '#7a4a22'; ctx.fillRect(x - w / 2, y - w, w, w);
      ctx.strokeStyle = '#4a2e18'; ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2 + 1.5, y - w + 1.5, w - 3, w - 3);
      ctx.beginPath(); ctx.moveTo(x - w / 2 + 2, y - w + 2); ctx.lineTo(x + w / 2 - 2, y - 2); ctx.stroke();
      if (d.v > 0.7) { ctx.fillStyle = '#5e3c20'; ctx.fillRect(x - w / 2 - 3, y - 3, 6, 3); }
    }
  }
  function drawFlatDecor(ctx, d, t) {
    if (SITE_FLAT[d.kind]) { SITE_FLAT[d.kind](ctx, d, t || 0); return; }
    if (AB.Towns && AB.Towns.drawFlat(ctx, d)) return;
    if (d.kind === 'flowers') { // цветы луга: головки качаются на ветру
      for (let k = 0; k < 4; k++) {
        const h = (d.v * 997 + k * 131) % 1, ox = (h - 0.5) * 22, oy = (((h * 7.13) % 1) - 0.5) * 14;
        const sw = Math.sin(t * 2 + d.x * 0.05 + k) * 1.2, x = d.x + ox, y = d.y + oy;
        ctx.strokeStyle = '#3f7a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sw, y - 6); ctx.stroke();
        const col = ['#f4f4ec', '#ffd84a', '#c89af0', '#f08ab0'][(k + Math.floor(d.v * 4)) % 4];
        S().circle(ctx, x + sw, y - 7, 2.2, col); S().circle(ctx, x + sw, y - 7, 0.9, '#e0a020');
      }
      return;
    }
    if (d.kind === 'bones') {
      ctx.strokeStyle = '#d8d0bc'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(d.x - 8, d.y - 2); ctx.lineTo(d.x + 6, d.y + 3); ctx.moveTo(d.x - 4, d.y + 5); ctx.lineTo(d.x + 3, d.y - 4); ctx.stroke();
      S().circle(ctx, d.x + 10, d.y - 4, 4.5, '#d8d0bc'); ctx.fillStyle = '#222'; ctx.fillRect(d.x + 8, d.y - 5, 1.5, 1.5); ctx.fillRect(d.x + 11, d.y - 5, 1.5, 1.5);
    } else if (d.kind === 'rubble') {
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + d.v * 6; S().ell(ctx, d.x + Math.cos(a) * 8, d.y + Math.sin(a) * 5, 3.5, 2.5, '#6a665c'); }
    }
  }
  function drawDrop(ctx, d, t) {
    if (d.k === 'xp') {
      const bob = Math.sin(t * 5 + d.id) * 2, r = d.v > 1 ? 5.5 : 3.6;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(d.x, d.y - 6 + bob, 0, d.x, d.y - 6 + bob, r * 3);
      g.addColorStop(0, 'rgba(120,220,255,0.9)'); g.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = g; ctx.fillRect(d.x - r * 3, d.y - 6 + bob - r * 3, r * 6, r * 6);
      ctx.restore();
      S().circle(ctx, d.x, d.y - 6 + bob, r, '#3aa8ff'); S().circle(ctx, d.x - r * 0.3, d.y - 7 + bob - r * 0.3, r * 0.45, '#e8f8ff');
      return;
    }
    if (R.hoverDrop === d.id) { ctx.save(); ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.ellipse(d.x, d.y - 4, 15, 12, 0, 0, TAU); ctx.stroke(); ctx.restore();
      ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(10,16,12,0.85)'; const nm = AB.itemName(d.k); const w = ctx.measureText(nm).width + 10; roundRect(ctx, d.x - w / 2, d.y - 38, w, 14, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(nm, d.x, d.y - 30); }
    const ic = S().icons[d.k];
    const bob = Math.sin(t * 4 + d.id) * 2.5;
    S().ell(ctx, d.x, d.y + 5, 7, 3, 'rgba(0,0,0,0.3)');
    const special = d.k.startsWith('seed') || d.k === 'iron';
    if (special) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + Math.sin(t * 5) * 0.15; S().circle(ctx, d.x, d.y - 6 + bob, 11, '#ffe07a'); ctx.restore(); }
    if (ic) ctx.drawImage(ic, d.x - 10, d.y - 16 + bob, 20, 20);
  }
  // Внешний вид снарядов навыков
  const PK = {
    drone: ['streak', '120,200,255', 22], laser: ['streak', '255,80,70', 22], rifle: ['streak', '255,240,180', 30], bullet: ['streak', '255,240,180', 30],
    plasma: ['glow', '#b06aff', 6], packet: ['box', '#5aff9a', 5], nail: ['dart', '#b9c2c9', 8], pellet: ['dot', '#e8e0c8', 2.2], rivet: ['dot', '#c8a06a', 2.6],
    grenade: ['ball', '#4a5a3a', 5], boulder: ['ball', '#8a8480', 8], brick: ['box', '#b8563a', 6], rocket: ['rocket', '#d0d4d8', 8],
    knife: ['spin', '#d4dde3', 8], trowel: ['spin', '#c9d3da', 9], boomerang: ['spin', '#a8743a', 10], net: ['net', '#e8e0c8', 12],
    firearrow: ['arrow', '#ff8a2a', 18], dart: ['dart', '#7ad04a', 9], bolt: ['arrow', '#9aa2a8', 14], arrow: ['arrow', '#c8a06a', 18],
    turret: ['box', '#ffd24a', 4], cannon: ['ball', '#4a4f55', 5],
  };
  function drawProjectile(ctx, p) {
    const a = Math.atan2(p.vy, p.vx), L = PK[p.k] || PK.arrow, sh = L[0], col = L[1], sz = L[2];
    ctx.save(); ctx.translate(p.x, p.y - 10);
    if (sh === 'spin' || sh === 'net') ctx.rotate(R.time * (sh === 'net' ? 4 : 16)); else ctx.rotate(a);
    if (sh === 'streak') {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-sz, 0, 3, 0); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},1)`);
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(3, 0); ctx.stroke();
    } else if (sh === 'glow') {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 2.2); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sz * 2.2, 0, TAU); ctx.fill();
    } else if (sh === 'box') {
      ctx.fillStyle = '#111'; ctx.fillRect(-sz - 1, -sz * 0.6 - 1, sz * 2 + 2, sz * 1.2 + 2); ctx.fillStyle = col; ctx.fillRect(-sz, -sz * 0.6, sz * 2, sz * 1.2);
    } else if (sh === 'dot') { S().circle(ctx, 0, 0, sz + 1, '#111'); S().circle(ctx, 0, 0, sz, col); }
    else if (sh === 'ball') { S().circle(ctx, 0, 0, sz + 1.2, '#111'); S().circle(ctx, 0, 0, sz, col); S().circle(ctx, -sz * 0.3, -sz * 0.3, sz * 0.35, 'rgba(255,255,255,0.35)'); }
    else if (sh === 'rocket') {
      ctx.fillStyle = '#111'; ctx.fillRect(-sz, -3, sz * 2, 6); ctx.fillStyle = col; ctx.fillRect(-sz + 1, -2, sz * 2 - 2, 4); ctx.fillStyle = '#e0503a'; ctx.fillRect(sz - 3, -2, 3, 4);
      ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, -sz - 3, 0, 3.5, '#ffb24a');
    } else if (sh === 'spin') {
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(0, -3.5); ctx.lineTo(sz, 0); ctx.lineTo(0, 3.5); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-sz + 1.5, 0); ctx.lineTo(0, -2.2); ctx.lineTo(sz - 1.5, 0); ctx.lineTo(0, 2.2); ctx.fill();
    } else if (sh === 'net') {
      ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 4, -sz); ctx.lineTo(i * 4, sz); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-sz, i * 4); ctx.lineTo(sz, i * 4); ctx.stroke(); }
    } else if (sh === 'dart') {
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(sz * 0.6, 0); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
    } else {
      const len = sz;
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.5, 0); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#d4dde3'; ctx.beginPath(); ctx.moveTo(len * 0.5 + 5, 0); ctx.lineTo(len * 0.5 - 1, -2.5); ctx.lineTo(len * 0.5 - 1, 2.5); ctx.fill();
      ctx.fillStyle = '#e8e0cc'; ctx.fillRect(-len, -3, 5, 2); ctx.fillRect(-len, 1, 5, 2);
      if (p.k === 'firearrow') { ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, len * 0.5 + 3, 0, 4, 'rgba(255,140,40,0.8)'); }
    }
    ctx.restore();
  }
  function drawParticle(ctx, p) {
    const k = p.life / p.max;
    const y = p.y - p.z;
    if (p.t === 'p') { ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = p.c; ctx.fillRect(p.x - p.size / 2, y - p.size / 2, p.size, p.size); }
    else if (p.t === 'leaf') { ctx.globalAlpha = Math.min(1, k * 2); ctx.save(); ctx.translate(p.x, y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.6, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    else if (p.t === 'smoke') { ctx.globalAlpha = 1; ctx.fillStyle = p.c + (k * 0.35).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(p.x, y, p.size * (1.6 - k * 0.6), 0, TAU); ctx.fill(); }
    else if (p.t === 'txt') {
      ctx.globalAlpha = Math.min(1, k * 2.5);
      ctx.font = `bold ${p.big ? 16 : 12}px "Nunito", system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(p.s, p.x, y); ctx.fillStyle = p.c; ctx.fillText(p.s, p.x, y);
    } else if (p.t === 'ring') {
      ctx.globalAlpha = k; ctx.strokeStyle = p.c; ctx.lineWidth = 3 * k + 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * (1.1 - k * 0.5), p.size * (1.1 - k * 0.5) * 0.6, 0, 0, TAU); ctx.stroke();
    } else if (p.t === 'strike') {
      ctx.globalAlpha = k * 0.8; ctx.fillStyle = p.fr ? '#ffd24a' : '#ff5a3a'; shapePath(ctx, p, 1); ctx.fill();
    } else if (p.t === 'icon') { ctx.globalAlpha = Math.min(1, k * 2); const ic = S().icons[p.it]; if (ic) ctx.drawImage(ic, p.x - 9, y - 30, 18, 18); }
    ctx.globalAlpha = 1;
  }
  function drawGlowParticle(ctx, p) {
    const k = p.life / p.max, y = p.y - p.z;
    if (p.t === 'spark') { ctx.globalAlpha = k; ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, y - 1, p.size + 0.5, p.size + 0.5); }
    else if (p.t === 'bolt') {
      ctx.globalAlpha = k * 4 > 1 ? 1 : k * 4;
      for (const [lw, col] of (p.c ? [[6, 'rgba(120,255,120,0.5)'], [2, '#eaffea']] : [[6, 'rgba(120,180,255,0.5)'], [2, '#eaf6ff']])) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        p.pts.forEach((q, i) => { if (!i) { ctx.moveTo(q[0], q[1] - 10); return; } const pr = p.pts[i - 1];
          for (let s = 1; s <= 4; s++) { const f = s / 4; ctx.lineTo(AB.lerp(pr[0], q[0], f) + (s < 4 ? (Math.random() - 0.5) * 14 : 0), AB.lerp(pr[1], q[1], f) - 10 + (s < 4 ? (Math.random() - 0.5) * 14 : 0)); } });
        ctx.stroke();
      }
    }
    else if (p.t === 'flash') { ctx.globalAlpha = k * 8; S().circle(ctx, p.x, y, p.size, '#fff2b0'); }
    else if (p.t === 'beam') {
      ctx.globalAlpha = Math.min(1, k * 3);
      for (const [lw, c] of [[p.w * 1.6, p.c0], [Math.max(1.5, p.w * 0.4), '#ffffff']]) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke(); }
    } else if (p.t === 'arc') {
      ctx.globalAlpha = k * 1.4 > 1 ? 1 : k * 1.4;
      const half = (p.arc * Math.PI / 180) / 2;
      const g = ctx.createRadialGradient(p.x, p.y - 8, p.r * 0.3, p.x, p.y - 8, p.r);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, p.c0); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y - 8); ctx.arc(p.x, p.y - 8, p.r, p.a - half, p.a + half); ctx.closePath(); ctx.fill();
    }
    else if (p.t === 'firefly') {
      const tw = 0.5 + Math.sin(p.ph + R.time * 3) * 0.5;
      ctx.globalAlpha = Math.min(1, k * 3, (1 - k) * 3) * tw;
      const fc = p.col || '230,255,140';
      const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 7); g.addColorStop(0, `rgba(${fc},0.9)`); g.addColorStop(1, `rgba(${fc},0)`);
      ctx.fillStyle = g; ctx.fillRect(p.x - 7, y - 7, 14, 14);
    }
    ctx.globalAlpha = 1;
  }

  /* ============================ КАДР ============================ */
  // ---------- живность (только картинка, на игру не влияет) ----------
  // стайки мелких птиц днём, вороны с потревоженного дерева, белка перебегает к соседнему дереву
  const flyers = [], squirrels = [];
  let flockT = 15;
  R.onChop = function (ev) { // FX вызывает при ударе топором (у хоста и у гостя)
    if (R.lowQ || !G_ref || ev.id === undefined) return;
    const W = G_ref.W, tr = W.trees[ev.id];
    if (!tr || tr.dead || tr.gone) return;
    if (Math.random() < 1 / 7) { // вороны
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 120 + Math.random() * 60;
        flyers.push({ x: tr.x + (Math.random() - 0.5) * 30, y: tr.y, h: 60 * tr.s + Math.random() * 25, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4 - 20, climb: 35, life: 4, crow: true, ph: Math.random() * 6 });
      }
      AB.Sound.play('caw', 0.8);
    }
    if (Math.random() < 1 / 12) { // белка к соседнему дереву
      let best = null;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const tx = tr.tx + dx, ty = tr.ty + dy; if (tx < 0 || ty < 0 || tx >= W.N || ty >= W.N) continue;
        const j = W.treeAt[ty * W.N + tx]; if (j < 0 || j === tr.id) continue;
        const o = W.trees[j], d = Math.hypot(o.x - tr.x, o.y - tr.y);
        if (!o.dead && d > 70 && (!best || Math.random() < 0.3)) best = o;
      }
      if (best) squirrels.push({ x0: tr.x, y0: tr.y, x1: best.x, y1: best.y, t: 0, dur: Math.hypot(best.x - tr.x, best.y - tr.y) / 170 });
    }
  };
  function updateCritters(G, cam, z, dt) {
    if (R.lowQ) { flyers.length = 0; squirrels.length = 0; return; }
    flockT -= dt;
    if (flockT <= 0 && (G.nightF || 0) < 0.4) { // стайка пролетает через экран
      flockT = 20 + Math.random() * 20;
      const dir = Math.random() < 0.5 ? 1 : -1, vw = R.w / z / 2, vh = R.h / z / 2;
      const x0 = cam.x - dir * (vw + 80), y0 = cam.y + (Math.random() - 0.5) * vh * 1.4, n = 3 + Math.floor(Math.random() * 4), vy = (Math.random() - 0.5) * 40;
      for (let i = 0; i < n; i++) flyers.push({ x: x0 - dir * Math.random() * 60, y: y0 + (Math.random() - 0.5) * 50, h: 90 + Math.random() * 30, vx: dir * (170 + Math.random() * 25), vy, climb: 0, life: (vw * 2 + 260) / 170, ph: Math.random() * 6 });
    }
    for (let i = flyers.length - 1; i >= 0; i--) { const f = flyers[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.h += f.climb * dt; f.life -= dt; if (f.life <= 0) flyers.splice(i, 1); }
    for (let i = squirrels.length - 1; i >= 0; i--) { const q = squirrels[i]; q.t += dt; if (q.t >= q.dur) squirrels.splice(i, 1); }
  }
  function drawCritters(ctx, t) {
    for (const q of squirrels) {
      const k = Math.min(1, q.t / q.dur), x = AB.lerp(q.x0, q.x1, k), y = AB.lerp(q.y0, q.y1, k) - Math.abs(Math.sin(k * Math.PI * Math.max(2, Math.round(q.dur * 4)))) * 7, s = q.x1 >= q.x0 ? 1 : -1;
      S().ell(ctx, x, AB.lerp(q.y0, q.y1, k) + 2, 4, 1.5, 'rgba(0,0,0,0.25)');
      ctx.save(); ctx.translate(x, y); ctx.scale(s, 1);
      ctx.fillStyle = '#b8683a'; ctx.beginPath(); ctx.ellipse(-5, -6, 3.2, 5, -0.5, 0, TAU); ctx.fill(); // пушистый хвост
      S().ell(ctx, 0, -3, 4, 2.8, '#a0582a'); S().circle(ctx, 3.5, -5, 2.2, '#a0582a'); S().circle(ctx, 4.4, -5.6, 0.6, '#111');
      ctx.restore();
    }
    for (const f of flyers) {
      const by = f.y - f.h, w = f.crow ? 7 : 3.6, fl = Math.sin(t * (f.crow ? 14 : 20) + f.ph) * w * 0.8;
      if (!f.crow) S().ell(ctx, f.x, f.y, 2.5, 1, 'rgba(0,0,0,0.15)');
      ctx.strokeStyle = f.crow ? '#121214' : '#3a3028'; ctx.lineWidth = f.crow ? 2.8 : 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(f.x - w, by - fl); ctx.lineTo(f.x, by); ctx.lineTo(f.x + w, by - fl); ctx.stroke();
    }
  }
  // следы на снегу (добавляет main.js по шагам героев)
  const prints = [], PRINT_LIFE = 20;
  R.addPrint = function (x, y, a) { if (R.lowQ) return; prints.push({ x, y, a, t: R.time }); if (prints.length > 300) prints.shift(); };
  R.draw = function (G, me, cam, dt, ui) {
    G_ref = G;
    const ctx = R.ctx, W = G.W, cfg = C();
    R.time += dt;
    const t = R.time;
    // масштаб: по высоте экрана; на узком (вертикальном) экране — ещё и по ширине, чтобы мир не превращался в щель
    const viewH = R.touch ? (cfg.VIEW_HEIGHT_MOBILE || cfg.VIEW_HEIGHT) : cfg.VIEW_HEIGHT;
    const z = Math.min(R.h / viewH, R.w / (viewH * 1.2));
    R.zoom = z;
    { const zk = z * R.dpr; if (Math.abs(zk - (R._zk || 0)) > 1e-4) { R._zk = zk; AB.blitGen++; } } // новый масштаб — пересоздать уменьшенные копии спрайтов
    const shx = (Math.random() - 0.5) * AB.FX.shake, shy = (Math.random() - 0.5) * AB.FX.shake;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    // фон нужен только у края мира — иначе его целиком закрывает земля (лишний проход по всему экрану)
    { const hx = R.w / z / 2 + 8, hy = R.h / z / 2 + 8; if (cam.x - hx < 0 || cam.y - hy < 0 || cam.x + hx > W.size || cam.y + hy > W.size || AB.FX.shake > 0) { ctx.fillStyle = '#0a120e'; ctx.fillRect(0, 0, R.w, R.h); } }
    ctx.save();
    ctx.translate(R.w / 2 + shx, R.h / 2 + shy); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
    const vw = R.w / z / 2 + 140, vh = R.h / z / 2 + 180;
    const x0 = cam.x - vw, x1 = cam.x + vw, y0 = cam.y - vh, y1 = cam.y + vh;
    // земля
    ctx.imageSmoothingEnabled = false;
    for (let cy = Math.max(0, Math.floor(y0 / CHUNK)); cy <= Math.min(Math.ceil(W.size / CHUNK) - 1, Math.floor(y1 / CHUNK)); cy++)
      for (let cx = Math.max(0, Math.floor(x0 / CHUNK)); cx <= Math.min(Math.ceil(W.size / CHUNK) - 1, Math.floor(x1 / CHUNK)); cx++)
        ctx.drawImage(getChunk(W, cx, cy), cx * CHUNK, cy * CHUNK);
    ctx.imageSmoothingEnabled = true;
    lastView = { x0, x1, y0, y1, cx: cam.x, cy: cam.y };
    evictChunks(cam);
    // блики на воде
    const T = W.T;
    const tx0 = Math.max(0, Math.floor(x0 / T)), tx1 = Math.min(W.N - 1, Math.floor(x1 / T));
    const ty0 = Math.max(0, Math.floor(y0 / T)), ty1 = Math.min(W.N - 1, Math.floor(y1 / T));
    ctx.fillStyle = 'rgba(180,230,230,0.22)';
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (W.ground[ty * W.N + tx] !== AB.G_WATER) continue;
      const h = AB.hash2(tx, ty, 5);
      const ph = (t * 0.6 + h * 10) % 3;
      if (ph < 1.4) { const a = Math.sin(ph / 1.4 * Math.PI); ctx.globalAlpha = a * 0.8; ctx.fillRect(tx * T + h * 20, ty * T + ((h * 97) % 1) * 24 + ph * 3, 8 + h * 6, 2); }
    }
    ctx.globalAlpha = 1;
    // граница территории лагеря
    {
      const tr = AB.Sim.territory(G), cx = W.camp.x, cy = W.camp.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,200,110,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([18, 14]); ctx.lineDashOffset = -t * 8;
      ctx.beginPath(); ctx.arc(cx, cy, tr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      const n = Math.round(tr / 40);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, x = cx + Math.cos(a) * tr, y = cy + Math.sin(a) * tr;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        ctx.fillStyle = '#1e140c'; ctx.fillRect(x - 2, y - 12, 4, 13);
        ctx.fillStyle = '#8a5a30'; ctx.fillRect(x - 1, y - 11, 2, 11);
        ctx.fillStyle = i % 2 ? '#e0503a' : '#ffd24a'; ctx.fillRect(x - 1, y - 12, 5, 3);
      }
      ctx.restore();
    }
    // что видно сквозь туман
    R.wxVis = R.wxVis || 1;
    const lightsNow = collectLights(G, cam, z, t); R._lights = lightsNow;
    const holes = seeCircles(G, me, cam, z, lightsNow);
    const FRw = AB.Sim.fowRadius(G), FR2 = FRw < Infinity ? FRw + 30 : Infinity;
    const seen = (x, y, r) => { if (FR2 < Infinity) { const ex = x - W.camp.x, ey = y - W.camp.y, m = FR2 + r; if (ex * ex + ey * ey > m * m) return false; } for (const h of holes) { const dx = x - h[0], dy = y - h[1], m = h[2] + r; if (dx * dx + dy * dy < m * m) return true; } return false; };
    // плоские объекты
    const fLv = G.fireLevel || 1;
    for (const d of W.decor) if (!(d.lv > fLv) && d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1 && seen(d.x, d.y, 80)) drawFlatDecor(ctx, d, t);
    // следы на снегу тают за PRINT_LIFE секунд
    while (prints.length && t - prints[0].t > PRINT_LIFE) prints.shift();
    for (const pr of prints) if (pr.x > x0 && pr.x < x1 && pr.y > y0 && pr.y < y1) {
      ctx.fillStyle = `rgba(232,240,252,${0.6 * (1 - (t - pr.t) / PRINT_LIFE)})`; // утоптанный снег
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y, 3.6, 2.2, pr.a, 0, TAU); ctx.fill();
    }
    // тени деревьев (одним контуром — одна заливка на все деревья)
    const vis = [];
    const ex0 = cam.x - R.w / z / 2, ex1 = cam.x + R.w / z / 2, ey0 = cam.y - R.h / z / 2, ey1 = cam.y + R.h / z / 2; // ровно экран
    ctx.beginPath();
    let shN = 0;
    const casters = R.lowQ ? null : []; // тени: x, y, высота, ширина, дерево(1) - см. drawShadows
    const qy0 = Math.max(0, Math.floor((ey0 - 14) / T)), qy1 = Math.min(W.N - 1, Math.floor((ey1 + 170) / T));
    const qx0 = Math.max(0, Math.floor((ex0 - 80) / T)), qx1 = Math.min(W.N - 1, Math.floor((ex1 + 80) / T));
    for (let ty = qy0; ty <= qy1; ty++) for (let tx = qx0; tx <= qx1; tx++) {
      const i = ty * W.N + tx;
      const ti = W.treeAt[i];
      if (ti >= 0) {
        const tr = W.trees[ti], ts = tr.s;
        if (tr.y > ey0 - 12 && tr.y - 150 * ts < ey1 && tr.x + 70 * ts > ex0 && tr.x - 70 * ts < ex1 && seen(tr.x, tr.y - 60 * ts, 80 * ts)) {
          if (!tr.dead) { const rx = (tr.v < 3 ? 36 : 26) * ts; if (casters) casters.push(tr.x, tr.y, 80 * ts, rx, 1); else { ctx.moveTo(tr.x + 8 + rx, tr.y - 2); ctx.ellipse(tr.x + 8, tr.y - 2, rx, 13 * ts, 0, 0, TAU); shN++; } }
          else if (casters && !tr.gone) casters.push(tr.x, tr.y, 10 * ts, 9 * ts, 0); // пень
          vis.push({ y: tr.y, k: 0, o: tr });
        }
      }
      const ri = W.rockAt[i];
      if (ri >= 0) { const rk = W.rocks[ri]; if (rk.y > ey0 - 20 && rk.y - 70 < ey1 && seen(rk.x, rk.y - 10, 40)) { vis.push({ y: rk.y, k: 1, o: rk }); if (casters && !rk.dead) casters.push(rk.x, rk.y, 22, 14, 0); } }
    }
    if (shN) { ctx.fillStyle = 'rgba(5,15,8,0.3)'; ctx.fill(); }
    if (casters) {
      const inV = (o, m) => o.x > ex0 - m && o.x < ex1 + m && o.y > ey0 - m && o.y < ey1 + m * 2;
      for (const b of W.bushes) if (inV(b, 40)) casters.push(b.x, b.y, 16, 13, 0);
      for (const st of G.structs) if (inV(st, 120)) casters.push(st.x, st.y, ((OCC_BOX_H[st.kind]) || 40) * 0.7, st.r || 20, 0);
      if (G.kitchen && inV(G.kitchen, 120)) casters.push(G.kitchen.x, G.kitchen.y, 42, 38, 0);
      if (G.store && inV(G.store, 120)) casters.push(G.store.x, G.store.y, 45, 40, 0);
      for (const p of G.players) if (!p.dead && inV(p, 60)) casters.push(p.x, p.y + 8, 34 * (cfg.PLAYER_SCALE || 1), 8, 0);
      for (const m of G.monsters) if (!m.dying && inV(m, 80) && seen(m.x, m.y, m.r * 3)) casters.push(m.x, m.y + m.r * 0.5, m.r * 2.4, m.r * 0.75, 0);
      drawShadows(ctx, G, casters, R._lights || []);
    }
    for (const b of W.bushes) if (b.x > ex0 - 40 && b.x < ex1 + 40 && b.y > ey0 - 10 && b.y < ey1 + 50 && seen(b.x, b.y - 8, 30)) vis.push({ y: b.y, k: 2, o: b });
    for (const s of W.sites) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) vis.push({ y: s.y, k: 3, o: s });
    for (const d of W.decor) if (!FLAT_DECOR.has(d.kind) && !(d.lv > fLv) && d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1 && seen(d.x, d.y - 40, 130)) vis.push({ y: d.y, k: 4, o: d });
    for (const b of (G.bolts || [])) drawBoltWarn(ctx, b, t);
    if (ui && ui.sel) { const b = AB.Sim.buildingByRef(G, ui.sel); if (b) selRing(ctx, b.o.x, b.o.y, (b.o.r || 30) + 14, t); }
    for (const mn of G.mines) drawMine(ctx, mn, t);
    if (!(AB.Survival && AB.Survival.on(G))) for (const te of G.tele) drawTele(ctx, te, t); // Выживание: зон на земле нет - читается поза
    for (const s of G.structs) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) vis.push({ y: s.y, k: 9, o: s });
    if (G.kitchen) vis.push({ y: G.kitchen.y, k: 10, o: G.kitchen });
    if (G.store) vis.push({ y: G.store.y, k: 11, o: G.store });
    if (G.merchant) vis.push({ y: G.merchant.y, k: 12, o: G.merchant });
    updateBirds(G, Math.min(dt, 0.05), t);
    for (const tn of (W.towns || [])) for (const tr of tn.traders) if (tr.x > x0 && tr.x < x1 && tr.y > y0 && tr.y < y1) vis.push({ y: tr.y, k: 14, o: tr });
    for (const b of birds) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) vis.push({ y: b.y, k: 13, o: b });
    for (const w of worms) if (w.x > x0 && w.x < x1 && w.y > y0 && w.y < y1) drawWorm(ctx, w, t);
    for (const f of G.fires) if (f.x > x0 && f.x < x1 && f.y > y0 && f.y < y1) vis.push({ y: f.y, k: 5, o: f });
    for (const d of G.drops) if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) vis.push({ y: d.y - 1, k: 6, o: d });
    for (const m of G.monsters) if (m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1 && seen(m.x, m.y - m.r, m.r * 3 + 40)) vis.push({ y: m.y, k: 7, o: m });
    for (const p of G.players) vis.push({ y: p.y, k: 8, o: p });
    vis.sort((a, b) => a.y - b.y);
    const sp = S();
    // Кого может закрыть препятствие: живые игроки и монстры в кадре
    const occ = [];
    for (const p of G.players) if (!p.dead) occ.push(p);
    for (const m of G.monsters) if (!m.dying && m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1) occ.push(m);
    // Есть ли кто-то ЗА объектом: выше точки опоры (y < base), но в пределах его высоты и ширины
    const markAll = (x, base, hw, h) => { let any = false; for (const e of occ) if (e.y < base - 2 && e.y > base - h && Math.abs(e.x - x) < hw + (e.r || 10)) { any = true; if (e.type) e._occ = 1; } return any; };
    for (const m of G.monsters) m._occ = 0;
    const SEE = 0.45; // прозрачность препятствия, за которым кто-то стоит
    const OCC_BOX = { townhall: [66, 112], workshop: [52, 100], exchange: [50, 100], shop: [50, 86], tower: [26, 128], wall: [20, 44], turret: [14, 38] };
    const see = (on) => { if (on) ctx.globalAlpha = SEE; };
    const windK = { storm: 2.4, rain: 1.5, snow: 1.2 }[(G.wx && G.wx.id) || ''] || 0.8; // сила ветра для крон
    for (const v of vis) {
      const o = v.o;
      switch (v.k) {
        case 0: {
          if (o.dead) {
            if (o.sap >= 0) drawSapling(ctx, o, Math.min(1, (G.clock - (o.sg || 0)) / AB.Sim.saplingTime()), t);
            else drawSprite(ctx, sp.stump, o.x, o.y + 4, o.s * 0.9);
            break;
          }
          const alpha = markAll(o.x, o.y - 2, 30 * o.s, 115 * o.s) ? 0.42 : undefined;
          const tree = sp.trees[o.v];
          if (!tree) break;
          if (o.shake > 0) {
            ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.sin(t * 50) * o.shake * 0.12); ctx.translate(-o.x, -o.y);
            drawSprite(ctx, tree, o.x, o.y, o.s, alpha); ctx.restore();
          } else if (!R.lowQ) { // крона качается на ветру, каждое дерево в своей фазе; в грозу сильнее
            const sh = (Math.sin(t * 1.3 + o.x * 0.013 + o.y * 0.007) * 1.4 + Math.sin(t * 2.9 + o.x * 0.05) * 0.4) * windK;
            const s2 = o.s / (tree.k || 1);
            if (alpha !== undefined) ctx.globalAlpha = alpha;
            AB.blitSway(ctx, tree.c, o.x - tree.ox * s2, o.y - tree.oy * s2, tree.c.width * s2, tree.c.height * s2, tree.ox * s2, tree.oy * s2, sh, 0.32);
            if (alpha !== undefined) ctx.globalAlpha = 1;
          } else drawSprite(ctx, tree, o.x, o.y, o.s, alpha);
          break;
        }
        case 1:
          see(markAll(o.x, o.y + 4, 22, o.kind === 'ore' ? (o.ore === 'iron' && !o.dead ? 44 : 20) : 30));
          if (o.kind === 'ore') {
            const osp = o.dead ? (sp.oresDead || {})[o.ore] : (sp.ores[o.ore] || [])[o.v];
            if (!osp) break;
            if (o.shake > 0) { ctx.save(); ctx.translate(Math.sin(t * 60) * o.shake * 4, 0); drawSprite(ctx, osp, o.x, o.y + 6, 1); ctx.restore(); }
            else drawSprite(ctx, osp, o.x, o.y + 6, 1);
            if (!o.dead && o.hp < C().ORE_HITS) hpBar(ctx, o.x, o.y + 12, 26, o.hp / C().ORE_HITS, o.ore === 'iron' ? '#d08060' : '#c8c0b0');
            if (!o.dead && me && AB.dist2(me.x, me.y, o.x, o.y) < 70 * 70 && C().ORES[o.ore]) label(ctx, `${C().ORES[o.ore].name}${me.pick ? '' : ' · нужна кирка'}`, o.x, o.y - 46, o.ore === 'iron' ? '#e0a080' : '#d8d0c0');
          } else { const rsp = o.kind === 'ruin' ? (sp.ruins || [])[o.v] : (sp.rocks || [])[o.v]; if (rsp) drawSprite(ctx, rsp, o.x, o.y + 10 * o.s, o.s); }
          ctx.globalAlpha = 1;
          break;
        case 2: {
          let jx = 0; // куст вздрагивает, когда сквозь него проходят
          if (!R.lowQ) {
            if (G.players.some(p => !p.dead && AB.dist2(p.x, p.y, o.x, o.y) < 500) || G.monsters.some(m => !m.dying && AB.dist2(m.x, m.y, o.x, o.y) < 600)) o._rus = t;
            const k = 1 - (t - (o._rus === undefined ? -9 : o._rus)) / 0.5; if (k > 0) jx = Math.sin(t * 38) * 1.8 * k;
          }
          if (jx) { ctx.save(); ctx.translate(jx, 0); }
          drawSprite(ctx, o.berries ? sp.bushBerries : sp.bush, o.x, o.y + 6);
          if (jx) ctx.restore();
          break;
        }
        case 3: {
          drawSprite(ctx, o.opened ? sp.chestOpen : sp.chest, o.x, o.y + 8);
          const guards = o.opened ? 0 : G.monsters.filter(m => m.site === o.id && !(m.dying > 0)).length;
          if (guards) drawLock(ctx, o.x, o.y - 4);
          else if (!o.opened && Math.sin(t * 2 + o.id) > 0.9) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, o.x + 6, o.y - 12, 3, '#fff6c0'); ctx.restore(); }
          if (!o.opened && me && AB.dist2(me.x, me.y, o.x, o.y) < 320 * 320) {
            const K = C().SITE_KINDS[o.kind];
            if (K) label(ctx, (o.elite ? `${K.name} · ${o.elite.name}` : K.name) + (guards ? ` · стража: ${guards}` : ' · открыт'), o.x, o.y - 30, guards ? K.color : '#b8f28a');
          }
          break;
        }
        case 4: { const ob = DECOR_OCC[o.kind] || (AB.Towns && AB.Towns.OCC[o.kind]); see(ob && markAll(o.x, o.y, ob[0], ob[1])); drawDecor(ctx, o, t); ctx.globalAlpha = 1; break; }
        case 14: drawTrader(ctx, o, t, me); break;
        case 5: drawFire(ctx, o, t, o.main || (me && AB.dist2(me.x, me.y, o.x, o.y) < 140 * 140)); break;
        case 6: drawDrop(ctx, o, t); break;
        case 7: drawMonster(ctx, o, t); break;
        case 8: drawPlayer(ctx, o, t); break;
        case 9: { const bx = OCC_BOX[o.kind] || [30, 60]; see(markAll(o.x, o.y, bx[0], bx[1])); drawStruct(ctx, o, t, me && AB.dist2(me.x, me.y, o.x, o.y) < 120 * 120); ctx.globalAlpha = 1; break; }
        case 10: see(markAll(o.x, o.y, 54, 84)); drawKitchen(ctx, o, t, G); ctx.globalAlpha = 1; break;
        case 11: see(markAll(o.x, o.y, 56, 88)); drawStore(ctx, o, t); ctx.globalAlpha = 1; break;
        case 12: see(markAll(o.x + 22, o.y, 46, 70)); drawMerchant(ctx, o, t); ctx.globalAlpha = 1; break;
        case 13: drawHen(ctx, o, t); break;
      }
    }
    // монстры за препятствиями: красный контур поверх
    for (const m of G.monsters) if (m._occ && !m.dying) {
      const pulse = 0.55 + Math.sin(t * 6 + m.id) * 0.2, rr = m.r + 5;
      ctx.save(); ctx.strokeStyle = `rgba(255,70,50,${pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m.x, m.y - m.r * 0.6, rr, rr * 1.05, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,40,0.12)'; ctx.fill(); ctx.restore();
    }
    for (const m of G.monsters) if (m.boss && m.act && !m.dying && AB.Survival && AB.Survival.on(G)) { // Выживание: пульс во время приёма босса
      const pl = 0.4 + Math.sin(t * 9) * 0.25, rr = m.r * 1.35;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,120,90,${pl})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(m.x, m.y - m.r * 0.4, rr, rr * 0.85, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    for (const p of G.projs) drawProjectile(ctx, p);
    for (const e of G.eprojs) drawEnemyShot(ctx, e, t);
    for (const b of (G.bots || [])) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) drawBot(ctx, b, t);
    for (const p of G.players) {
      if (p.dead || !p.st) continue;
      const nb = Math.floor(p.st.blades || 0);
      const dl = AB.droneList(p);
      dl.forEach((dr, i) => { const d = AB.dronePos(p, i, dl.length, G.clock); if (dr.look === 'bird') drawBird(ctx, d.x, d.y, t, i); else drawDrone(ctx, d.x, d.y, t, p.a || 0); });
      for (let i = 0; i < nb; i++) drawBlade(ctx, AB.bladePos(p, i, nb, G.clock), t);
      for (const a of (p.ab || [])) {
        const def = AB.Sim.abDef(a.id);
        if (!def) continue;
        if (def.kind === 'orbit') { const n = AB.abCount(def, a.lv); for (let i = 0; i < n; i++) drawOrbit(ctx, AB.orbitPos(p, i, n, G.clock, def), def, t); }
        if (def.kind === 'aura') { const ar = AB.Sim.abStats(G, p, def, a.lv).radius; ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 14; i++) { const an = t * 1.3 + i * 2.4, rr = ar * (0.35 + ((i * 37) % 10) / 16); S().circle(ctx, p.x + Math.cos(an) * rr, p.y + Math.sin(an) * rr * 0.6 - 4, 1.6, 'rgba(140,255,200,0.7)'); } ctx.strokeStyle = 'rgba(120,255,190,0.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, ar, ar * 0.6, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
      }
      if (p.st.aura > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,140,40,${0.25 + Math.sin(t * 5) * 0.1})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, C().AURA_RADIUS, C().AURA_RADIUS * 0.55, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
    }
    updateCritters(G, cam, z, Math.min(dt, 0.05)); drawCritters(ctx, t);
    for (const p of AB.FX.parts) if (p.t !== 'spark' && p.t !== 'flash' && p.t !== 'firefly' && p.t !== 'bolt' && p.t !== 'beam' && p.t !== 'arc') drawParticle(ctx, p);
    // метка движения по клику
    if (ui && ui.clickMark && ui.clickMark.t > 0) {
      const cm = ui.clickMark; ctx.strokeStyle = `rgba(255,240,180,${cm.t})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cm.x, cm.y, 10 * (1.4 - cm.t * 0.4), 5 * (1.4 - cm.t * 0.4), 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    lighting(G, me, cam, z, t);
    weather(G, cam, z, dt, t);

    // Частицы-огоньки поверх тьмы
    ctx.save();
    ctx.translate(R.w / 2 + shx, R.h / 2 + shy); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of AB.FX.parts) if (p.t === 'spark' || p.t === 'flash' || p.t === 'firefly' || p.t === 'bolt' || p.t === 'beam' || p.t === 'arc') drawGlowParticle(ctx, p);
    ctx.restore();

    ambient(G, cam, z, dt);
  };

  // Многоугольник видимости: луч идёт от игрока и гаснет, пройдя treeDepth пикселей листвы
  function visionPoly(W, x, y, wr, VB) {
    const out = [], n = VB.rays, T = W.T, N = W.N, step = VB.step;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      let d = 0, dep = 0, lastTree = -1;
      for (d = step; d < wr; d += step) {
        const px = x + ca * d, py = y + sa * d;
        const tx = Math.floor(px / T), ty = Math.floor(py / T);
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) break;
        const ti = W.treeAt[ty * N + tx];
        if (ti < 0) continue;
        const tr = W.trees[ti];
        if (tr.dead) continue;
        const cr = VB.canopy * tr.s;
        if (Math.abs(px - tr.x) < cr && Math.abs(py - (tr.y - 8)) < cr * 1.3) { dep += step; lastTree = ti; if (dep >= VB.treeDepth) break; }
      }
      const r = Math.min(wr, d + (d < wr ? VB.pad : 0));
      out.push([x + ca * r, y + sa * r]);
    }
    return out;
  }
  R.visionPoly = visionPoly;

  // Готовые «пятна» света вместо градиентов каждый кадр: рисуются одной drawImage, в разы дешевле
  const SPR = {};
  function radSprite(key, stops, rgb, size) {
    if (SPR[key]) return SPR[key];
    const n = size || 128, c = AB.canvas(n, n), g = c.getContext('2d');
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(${rgb || '0,0,0'},${a})`);
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    return (SPR[key] = c);
  }
  const blot = (c, spr, x, y, r, a) => { if (a <= 0.003 || r <= 0.5) return; c.globalAlpha = Math.min(1, a); c.drawImage(spr, x - r, y - r, r * 2, r * 2); };
  // Источники света среди декора считаем один раз, а не перебираем весь декор мира каждый кадр
  function lightDecor(W) {
    if (W._ld && W._ldN === W.decor.length) return W._ld;
    W._ldN = W.decor.length;
    return (W._ld = W.decor.filter(d => d.kind === 'torch' || DECOR_LIGHT[d.kind] || (AB.Towns && AB.Towns.LIGHT[d.kind])));
  }
  let visC = null, warC = null;
  function collectLights(G, cam, z, t) {
    const W = G.W;
    const hw = R.w / z / 2 + 300, hh = R.h / z / 2 + 300;
    const inView = (x, y) => Math.abs(x - cam.x) < hw && Math.abs(y - cam.y) < hh;
    const lights = [];
    for (const f of G.fires) if (f.fuel > 0 && inView(f.x, f.y)) lights.push([f.x, f.y, AB.fireLight(f) * (1 + Math.sin(t * 9 + f.x) * 0.03), 1]);
    const fLv = G.fireLevel || 1;
    for (const d of lightDecor(W)) {
      if (!inView(d.x, d.y)) continue;
      if (d.kind === 'torch') lights.push([d.x, d.y - 30, 120 * (1 + Math.sin(t * 13 + d.x) * 0.05), 0.8]);
      else if (DECOR_LIGHT[d.kind]) { if (!(d.lv > fLv)) { const L = DECOR_LIGHT[d.kind]; lights.push([d.x, d.y + L[0], L[1] * (1 + Math.sin(t * 7 + d.x) * 0.05), L[2]]); } }
      else { const L = AB.Towns.LIGHT[d.kind]; lights.push([d.x, d.y + L[0], L[1], L[2]]); }
    }
    // окна и фонари зданий
    const LB = { townhall: [-10, -30, 95], workshop: [0, -24, 85], exchange: [0, -22, 80], shop: [0, -30, 60] };
    for (const st of G.structs) { const l = LB[st.kind]; if (l && inView(st.x, st.y)) lights.push([st.x + l[0], st.y + l[1], l[2], 0.45]); }
    if (G.kitchen) lights.push([G.kitchen.x - 10, G.kitchen.y - 20, 70, 0.4]);
    if (G.store) lights.push([G.store.x, G.store.y - 20, 60, 0.3]);
    if (G.merchant) lights.push([G.merchant.x + 60, G.merchant.y - 36, 75, 0.55]);
    return lights;
  }
  // Где сквозь туман что-то видно: круг зрения игрока, вышки, огни. Остальное туман закрывает почти целиком —
  // деревья и декор там не рисуем (экономит половину кадра ночью в лесу)
  function seeCircles(G, me, cam, z, lights) {
    if (!me || me.dead) return [[cam.x, cam.y, 1e9]];
    const vrw = AB.visionRadius(R.w, R.h, G.nightF) * (R.wxVis || 1) / z;
    const out = [[me.x, me.y - 6, vrw + 10]];
    for (const st of G.structs) if (st.kind === 'tower') out.push([st.x, st.y, C().STRUCTURES.tower.vision * (st.bmod === 'light' ? 1.6 : 1) + 10]);
    for (const l of lights) out.push([l[0], l[1], l[2] * 0.9 + 10]);
    return out;
  }
  // ---------- тени ----------
  // Высота построек для теней (как у полупрозрачности OCC_BOX)
  const OCC_BOX_H = { townhall: 112, workshop: 100, exchange: 100, shop: 86, tower: 128, wall: 44, turret: 38 };
  // Днём - от солнца: утром на запад и длинные, к полудню короткие (вверх), к закату длинные на восток.
  // Ночью - от ближайшего огня, если объект в его свете. Все тени - две заливки на кадр (дёшево).
  function sunDir(G) {
    const cfg = C(), ph = G.clock % (cfg.DAY_LENGTH + cfg.NIGHT_LENGTH), f = Math.min(1, ph / cfg.DAY_LENGTH);
    const a = Math.PI * (1.08 + 0.84 * f);
    return [Math.cos(a), Math.sin(a) * 0.55, 0.3 + 0.9 * Math.abs(f - 0.5) * 2];
  }
  // тень одного объекта в текущий контур: основание (x, y), высота h, полуширина w, направление (dx, dy), длина len
  function addShadow(ctx, x, y, h, w, tree, dx, dy, len) {
    const ox = dx * h * len, oy = dy * h * len, rot = Math.atan2(oy, ox), L = Math.hypot(ox, oy);
    if (tree) { // крона (ствол под ней не рисуем - вдвое меньше фигур в контуре)
      const cx = x + ox * 0.8, cy = y + oy * 0.8, rx = w * (1 + len * 0.12), ry = w * 0.62;
      ctx.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx); ctx.ellipse(cx, cy, rx, ry, rot, 0, TAU);
    } else {
      const cx = x + ox * 0.5, cy = y + oy * 0.5, rx = L * 0.5 + w * 0.7, ry = w * 0.5;
      ctx.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx); ctx.ellipse(cx, cy, rx, ry, rot, 0, TAU);
    }
  }
  function drawShadows(ctx, G, cs, lights) {
    const nf = G.nightF || 0, dayA = 0.24 * (1 - nf), nightA = 0.34 * nf;
    if (dayA > 0.01) {
      const [dx, dy, len] = sunDir(G);
      ctx.beginPath();
      for (let i = 0; i < cs.length; i += 5) addShadow(ctx, cs[i], cs[i + 1], cs[i + 2], cs[i + 3], cs[i + 4], dx, dy, len);
      ctx.fillStyle = `rgba(8,18,10,${dayA})`; ctx.fill();
    }
    if (nightA > 0.01 && lights.length) {
      ctx.beginPath(); let n = 0;
      for (let i = 0; i < cs.length; i += 5) {
        const x = cs[i], y = cs[i + 1];
        let best = null, bk = 0.2; // в слабом свете тень не видна
        for (const L of lights) { const d = Math.hypot(x - L[0], y - L[1]); if (d > 8 && d < L[2]) { const k = (L[3] || 1) * (1 - d / L[2]); if (k > bk) { bk = k; best = L; } } }
        if (!best) continue;
        const d = Math.hypot(x - best[0], y - best[1]);
        addShadow(ctx, x, y, cs[i + 2], cs[i + 3], cs[i + 4], (x - best[0]) / d, (y - best[1]) / d, 0.5 + 1.4 * d / best[2]); n++;
      }
      if (n) { ctx.fillStyle = `rgba(4,6,10,${nightA})`; ctx.fill(); }
    }
  }
  // Цветокоррекция по времени суток + виньетка (в маленьком слое тьмы - почти бесплатно):
  // золотистый рассвет, нейтральный полдень, тёплый закат, синеватая ночь
  function grade(c, G, fw, fh) {
    const cfg = C(), ph = G.clock % (cfg.DAY_LENGTH + cfg.NIGHT_LENGTH), f = Math.min(1, ph / cfg.DAY_LENGTH), nf = G.nightF || 0;
    const morn = ph < cfg.DAY_LENGTH ? Math.max(0, (0.2 - f) / 0.2) : 0;
    const eve = ph < cfg.DAY_LENGTH ? Math.max(0, (f - 0.72) / 0.28) * (1 - nf * 0.7) : 0;
    if (morn > 0.01) { c.fillStyle = `rgba(255,190,110,${0.12 * morn})`; c.fillRect(0, 0, fw, fh); }
    if (eve > 0.01) { c.fillStyle = `rgba(255,120,55,${0.18 * eve})`; c.fillRect(0, 0, fw, fh); }
    if (nf > 0.01) { c.fillStyle = `rgba(30,60,150,${0.09 * nf})`; c.fillRect(0, 0, fw, fh); }
    const g = c.createRadialGradient(fw / 2, fh / 2, Math.min(fw, fh) * 0.45, fw / 2, fh / 2, Math.hypot(fw, fh) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.28 + 0.1 * nf})`);
    c.fillStyle = g; c.fillRect(0, 0, fw, fh);
  }
  function lighting(G, me, cam, z, t) {
    const ctx = R.ctx, cfg = C(), W = G.W;
    const nf = G.nightF;
    const fw = R.fogC.width, fh = R.fogC.height, s = fw / R.w;
    const toS = (wx, wy) => [((wx - cam.x) * z + R.w / 2) * s, ((wy - cam.y) * z + R.h / 2) * s];
    R.wxVis = AB.lerp(R.wxVis || 1, AB.WX ? AB.WX.vision : 1, 0.02);
    const vr = AB.visionRadius(R.w, R.h, nf) * s * R.wxVis;
    const lights = R._lights || collectLights(G, cam, z, t);
    const soft = cfg.FOG_EDGE_SOFTNESS;
    const HOLE = radSprite('hole', [[0, 0.95], [0.5, 0.6], [1, 0]]);
    const LIN = radSprite('lin', [[0, 1], [1, 0]]);
    const CUT = radSprite('cut' + soft, [[0, 1], [1 - soft, 1], [1, 0]]);
    // --- туман (маленький холст, потом растягивается на экран)
    const fctx = R.fogC.getContext('2d');
    fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
    fctx.clearRect(0, 0, fw, fh);
    const fc = AB.mix(cfg.FOG_DAY_COLOR, cfg.FOG_NIGHT_COLOR, nf);
    fctx.fillStyle = AB.rgb(fc, cfg.FOG_OPACITY); fctx.fillRect(0, 0, fw, fh);
    // клубы тумана (текстура)
    const CLUB = radSprite('club', [[0, 1], [1, 0]], '120,140,130');
    for (let i = 0; i < 4; i++) {
      const wx = cam.x + Math.sin(t * 0.05 + i * 1.7) * 600, wy = cam.y + Math.cos(t * 0.04 + i * 2.3) * 400;
      const [sx, sy] = toS(wx, wy); blot(fctx, CLUB, sx, sy, (260 + i * 30) * z * s, 0.03 * (1 - nf * 0.7));
    }
    fctx.globalCompositeOperation = 'destination-out';
    const cut = (sx, sy, r, str) => { if (sx > -r && sy > -r && sx < fw + r && sy < fh + r) blot(fctx, CUT, sx, sy, r, str); };
    const center = me && !me.dead ? toS(me.x, me.y) : toS(cam.x, cam.y);
    const VB = cfg.VISION_BLOCK;
    if (VB && VB.on && me && !me.dead) {
      // зрение не проникает сквозь лес: многоугольник рисуем на крошечном холсте —
      // при растягивании края сами становятся мягкими (без дорогого blur)
      const q = 3, vw = Math.ceil(fw / q), vh = Math.ceil(fh / q);
      if (!visC) visC = AB.canvas(vw, vh);
      if (visC.width !== vw || visC.height !== vh) { visC.width = vw; visC.height = vh; }
      const vctx = visC.getContext('2d');
      vctx.globalCompositeOperation = 'source-over'; vctx.globalAlpha = 1;
      vctx.clearRect(0, 0, vw, vh);
      const wr = vr / s / z, poly = visionPoly(W, me.x, me.y - 6, wr, VB);
      vctx.fillStyle = '#000'; vctx.beginPath();
      poly.forEach((p, i) => { const [sx, sy] = toS(p[0], p[1]); if (i) vctx.lineTo(sx / q, sy / q); else vctx.moveTo(sx / q, sy / q); });
      vctx.closePath(); vctx.fill();
      vctx.globalCompositeOperation = 'destination-in';
      blot(vctx, CUT, center[0] / q, center[1] / q, vr / q, 1);
      fctx.globalAlpha = 1; fctx.imageSmoothingEnabled = true;
      fctx.drawImage(visC, 0, 0, vw * q, vh * q);
    } else cut(center[0], center[1], vr, 1);
    for (const st of G.structs) if (st.kind === 'tower') { const [sx, sy] = toS(st.x, st.y); cut(sx, sy, C().STRUCTURES.tower.vision * (st.bmod === 'light' ? 1.6 : 1) * z * s, 0.8); }
    for (const l of lights) { const [sx, sy] = toS(l[0], l[1]); cut(sx, sy, l[2] * z * s * 0.9, 0.85 * l[3]); }
    fctx.globalAlpha = 1; fctx.globalCompositeOperation = 'source-over';
    // --- туман войны: за границей открытой земли — плотная клубящаяся пелена
    const FR = AB.Sim.fowRadius(G);
    if (FR < Infinity) {
      const [cx, cy] = toS(W.camp.x, W.camp.y), rs = FR * z * s, far = Math.hypot(fw, fh);
      const dd = Math.hypot(cx - fw / 2, cy - fh / 2);
      if (dd + far > rs * 0.94) {                     // граница (или сам туман) видна в кадре
        if (!warC) warC = AB.canvas(fw, fh);
        if (warC.width !== fw || warC.height !== fh) { warC.width = fw; warC.height = fh; }
        const wc = warC.getContext('2d');
        wc.globalCompositeOperation = 'source-over'; wc.globalAlpha = 1;
        const wcol = AB.mix([52, 60, 70], [10, 13, 22], nf);
        wc.fillStyle = AB.rgb(wcol, 0.985); wc.fillRect(0, 0, fw, fh);
        // клубы
        wc.globalCompositeOperation = 'source-atop';
        const WCL = radSprite('warclub', [[0, 1], [1, 0]], '150,165,180');
        for (let i = 0; i < 7; i++) {
          const ang = i * 0.9 + t * 0.03, rad = FR + 120 + (i % 3) * 160;
          const wx = W.camp.x + Math.cos(ang) * rad + Math.sin(t * 0.2 + i) * 60, wy = W.camp.y + Math.sin(ang) * rad;
          const [sx, sy] = toS(wx, wy); blot(wc, WCL, sx, sy, (240 + i * 25) * z * s, 0.18 * (1 - nf * 0.6));
        }
        // открытая земля
        wc.globalCompositeOperation = 'destination-out';
        const band = Math.min(0.2, 110 / FR);           // мягкий край ~110 пикселей мира при любом радиусе
        blot(wc, radSprite('warcut' + FR, [[0, 1], [1 - band, 1], [1 - band * 0.5, 0.45], [1, 0]], null, 512), cx, cy, rs, 1);
        wc.globalAlpha = 1; wc.globalCompositeOperation = 'source-over';
        fctx.drawImage(warC, 0, 0);
      }
    }
    // --- тьма ночи: в том же маленьком холсте под туманом, на экран — одним слоем
    const dctx = R.darkC.getContext('2d');
    dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1;
    dctx.clearRect(0, 0, fw, fh);
    if (nf > 0.01) {
      dctx.fillStyle = `rgba(6,10,32,${cfg.NIGHT_DARKNESS * nf})`; dctx.fillRect(0, 0, fw, fh);
      dctx.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const [sx, sy] = toS(l[0], l[1]); const r = l[2] * z * s;
        if (sx < -r || sy < -r || sx > fw + r || sy > fh + r) continue;
        blot(dctx, HOLE, sx, sy, r, l[3]);
      }
      if (me && !me.dead) { const [sx, sy] = toS(me.x, me.y); blot(dctx, LIN, sx, sy, 70 * z * s, 0.5); }
      dctx.globalAlpha = 1; dctx.globalCompositeOperation = 'source-over';
    }
    // тёплое свечение огней — тоже в маленьком слое (порядок как раньше: тьма → свет → туман)
    const GLOW = radSprite('glow', [[0, 1], [1, 0]], '255,140,52');
    for (const l of lights) {
      const [sx, sy] = toS(l[0], l[1]), r = l[2] * z * 0.75 * s;
      if (sx < -r || sy < -r || sx > fw + r || sy > fh + r) continue;
      blot(dctx, GLOW, sx, sy, r, (0.12 + 0.14 * nf) * l[3]);
    }
    dctx.globalAlpha = 1;
    if (!R.lowQ) grade(dctx, G, fw, fh);
    dctx.drawImage(R.fogC, 0, 0);
    // --- на экран
    ctx.save();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(R.darkC, 0, 0, R.w, R.h);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
    // глаза в тумане
    if (cfg.SHOW_EYES_IN_FOG && nf > 0.3 && me) {
      const vrw = AB.visionRadius(R.w, R.h, nf) / z;
      ctx.globalCompositeOperation = 'lighter';
      for (const m of G.monsters) {
        const d = AB.dist(m.x, m.y, me.x, me.y);
        if (d < vrw * 0.85 || d > vrw * 1.6) continue;
        const [sx, sy] = toS(m.x, m.y - m.r * 1.3); const x = sx / s, y = sy / s;
        const a = (1 - Math.abs(d - vrw * 1.1) / (vrw * 0.6)) * nf * (0.6 + Math.sin(t * 3 + m.id) * 0.3);
        if (a <= 0) continue;
        const col = m.type === 'shade' ? '140,240,255' : m.type === 'ghoul' ? '230,240,80' : '255,60,40';
        ctx.fillStyle = `rgba(${col},${a})`;
        const ex = Math.cos(m.a) * 2 * z;
        ctx.fillRect(x - 4 * z + ex, y, 2.5 * z, 2 * z); ctx.fillRect(x + 1.5 * z + ex, y, 2.5 * z, 2 * z);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // тепловизор программиста: метки видны сквозь туман
    if (G.players.some(p => p.st && p.st.syn_thermal > 0)) {
      ctx.strokeStyle = 'rgba(255,90,70,0.85)'; ctx.lineWidth = 1.5;
      for (const m of G.monsters) {
        if (!(m.mark > 0)) continue;
        const [sx, sy] = toS(m.x, m.y - m.r); const x = sx / s, y = sy / s;
        if (x < 0 || y < 0 || x > R.w || y > R.h) continue;
        ctx.beginPath(); ctx.arc(x, y, (m.r + 4) * z, 0, TAU); ctx.stroke();
      }
    }
    // красная вспышка при уроне / низком здоровье
    if (me) {
      const low = me.hp < 30 && !me.dead ? (0.25 + Math.sin(t * 5) * 0.1) * (1 - me.hp / 30) : 0;
      const a = Math.max(AB.FX.flash, low);
      if (a > 0.01) {
        const g = ctx.createRadialGradient(R.w / 2, R.h / 2, Math.min(R.w, R.h) * 0.3, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.7);
        g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, `rgba(160,0,0,${a})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, R.w, R.h);
      }
    }
    ctx.restore();
  }

  /* ============================ ПОГОДА ============================ */
  // Экранные эффекты: дождь, гроза, снег, туман, зной. Смена погоды — плавная (wxAmt).
  const wxAmt = {};
  function weather(G, cam, z, dt, t) {
    const ctx = R.ctx, cur = (G.wx && G.wx.id) || 'clear';
    // в снежной тайге снег идёт всегда (немного), в степи — лёгкий зной
    const W0 = G.W, ci = W0.biome ? Math.floor(cam.y / W0.T) * W0.N + Math.floor(cam.x / W0.T) : -1, bio = ci >= 0 ? W0.biome[ci] : 0, bm = ci >= 0 && bio ? W0.bmix[ci] : 0;
    for (const k of ['rain', 'storm', 'snow', 'fog', 'heat']) {
      let tgt = k === cur ? 1 : 0;
      if (k === 'snow' && bio === 1) tgt = Math.max(tgt, 0.55 * bm);
      if (k === 'rain' && bio === 1) tgt = 0; // в тайге дождь превращается в снег
      if (k === 'snow' && bio === 1 && (cur === 'rain' || cur === 'storm')) tgt = 1;
      if (k === 'heat' && bio === 2 && !G.isNight) tgt = Math.max(tgt, 0.35 * bm);
      if (k === 'fog' && bio === 3) tgt = Math.max(tgt, 0.35 * bm);
      const v0 = wxAmt[k] || 0; wxAmt[k] = AB.clamp(v0 + Math.sign(tgt - v0) * Math.min(Math.abs(tgt - v0), dt / 3), 0, 1);
    }
    ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    const W2 = R.w, H2 = R.h, ox = cam.x * z, oy = cam.y * z; // привязка к миру, чтобы капли не «ехали» за камерой
    const wrap = (v, m) => ((v % m) + m) % m;
    const tint = (col, a) => { if (a > 0.003) { ctx.fillStyle = `rgba(${col},${a})`; ctx.fillRect(0, 0, W2, H2); } };
    const rain = Math.max(wxAmt.rain || 0, wxAmt.storm || 0);
    tint('60,80,110', 0.1 * (wxAmt.rain || 0) + 0.2 * (wxAmt.storm || 0));
    tint('255,150,60', 0.07 * (wxAmt.heat || 0));
    tint('235,240,250', 0.07 * (wxAmt.snow || 0));
    if (rain > 0.01) {
      const n = Math.round((R.touch ? 90 : 160) * ((wxAmt.rain || 0) + 1.5 * (wxAmt.storm || 0)));
      ctx.strokeStyle = 'rgba(180,205,255,0.38)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const h1 = AB.hash2(i, 1, 3), h2 = AB.hash2(i, 2, 3), sp = 900 + h2 * 500;
        const x = wrap(h1 * W2 * 1.3 - ox * 0.9 + t * sp * 0.25, W2 * 1.3) - W2 * 0.15, y = wrap(h2 * H2 - oy * 0.9 + t * sp, H2 + 40) - 20;
        ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 16);
      }
      ctx.stroke();
    }
    if ((wxAmt.snow || 0) > 0.01) {
      const n = Math.round((R.touch ? 70 : 120) * wxAmt.snow);
      ctx.fillStyle = 'rgba(250,252,255,0.85)';
      for (let i = 0; i < n; i++) {
        const h1 = AB.hash2(i, 4, 3), h2 = AB.hash2(i, 5, 3), sp = 40 + h2 * 50;
        const x = wrap(h1 * W2 - ox + Math.sin(t * 1.3 + i) * 18, W2), y = wrap(h2 * H2 - oy + t * sp, H2);
        ctx.beginPath(); ctx.arc(x, y, 1.2 + h1 * 1.8, 0, TAU); ctx.fill();
      }
    }
    if ((wxAmt.fog || 0) > 0.01) {
      const a = wxAmt.fog;
      tint('200,210,205', 0.16 * a);
      for (let i = 0; i < 6; i++) {
        const x = wrap(AB.hash2(i, 7, 3) * W2 * 1.6 - ox * 0.6 + t * (8 + i * 3), W2 * 1.6) - W2 * 0.3, y = wrap(AB.hash2(i, 8, 3) * H2 * 1.4 - oy * 0.6, H2 * 1.4) - H2 * 0.2, r = (220 + i * 40) * Math.max(0.6, z);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(215,222,218,${0.28 * a})`); g.addColorStop(1, 'rgba(215,222,218,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    if ((wxAmt.heat || 0) > 0.01) {
      ctx.fillStyle = `rgba(255,220,150,${0.35 * wxAmt.heat})`;
      for (let i = 0; i < 30; i++) { const x = wrap(AB.hash2(i, 9, 3) * W2 - ox * 0.8 + Math.sin(t + i) * 10, W2), y = wrap(AB.hash2(i, 10, 3) * H2 - oy * 0.8 - t * 12, H2); ctx.fillRect(x, y, 1.5, 1.5); }
    }
    if (AB.FX.lightF > 0.01) { tint('235,240,255', AB.FX.lightF * 0.6); AB.FX.lightF = Math.max(0, AB.FX.lightF - dt * 2.5); }
    ctx.restore();
  }

  // светлячки ночью, листья днём
  let ambT = 0;
  function ambient(G, cam, z, dt) {
    const cfg = C();
    ambT -= dt;
    if (ambT > 0) return;
    ambT = 0.2;
    const vw = R.w / z / 2, vh = R.h / z / 2;
    const ff = AB.FX.parts.filter(p => p.t === 'firefly').length;
    if (G.nightF > 0.5 && ff < cfg.FIREFLIES) {
      for (let i = 0; i < 3; i++) AB.FX.add({ t: 'firefly', x: cam.x + (Math.random() - 0.5) * vw * 1.6, y: cam.y + (Math.random() - 0.5) * vh * 1.6, z: 10 + Math.random() * 20, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, vz: 0, g: 0, life: 4 + Math.random() * 4, ph: Math.random() * 6 });
    }
    // споры над грибными полянами: розовые и лиловые огоньки, ночью ярче
    const sporeN = AB.FX.parts.filter(p => p.t === 'firefly' && p.col).length;
    if (sporeN < 40) for (const s of G.W.sites) {
      if (s.kind !== 'mushrooms' || Math.abs(s.x - cam.x) > vw + 200 || Math.abs(s.y - cam.y) > vh + 200) continue;
      const rr = ((C().SITE_GROW && C().SITE_GROW.radius[(G.fireLevel || 1) - 1]) || 4) * G.W.T;
      for (let i = 0; i < 3; i++) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * rr; AB.FX.add({ t: 'firefly', x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d * 0.8, z: 6 + Math.random() * 30, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 8, vz: 4, g: 0, life: 3 + Math.random() * 3, ph: Math.random() * 6, col: Math.random() < 0.5 ? '255,170,230' : '200,160,255' }); }
    }
    const lv = AB.FX.parts.filter(p => p.t === 'leaf').length;
    if (G.nightF < 0.5 && lv < cfg.FALLING_LEAVES && !(G.wx && G.wx.id === 'snow')) {
      AB.FX.add({ t: 'leaf', x: cam.x + (Math.random() - 0.5) * vw * 2, y: cam.y + (Math.random() - 0.7) * vh * 2, z: 120, vx: 15 + Math.random() * 15, vy: 5, vz: -10, g: 8, life: 6, size: 2.5, c: ['#8fae45', '#c8a03a', '#a8641f', '#6fa84a'][Math.random() * 4 | 0], rot: Math.random() * 6, vr: 2 });
    }
  }

  /* ============================ ИНТЕРФЕЙС ============================ */
  function panel(ctx, x, y, w, h, r) {
    ctx.fillStyle = 'rgba(10,18,15,0.78)'; roundRect(ctx, x, y, w, h, r || 10); ctx.fill();
    ctx.strokeStyle = 'rgba(160,190,150,0.18)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function bar(ctx, x, y, w, h, frac, c1, c2, label) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    const fw = Math.max(0, w * AB.clamp(frac, 0, 1));
    if (fw > 1) {
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; roundRect(ctx, x, y, Math.max(h, fw), h, h / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + h / 2, y + 2, Math.max(0, fw - h), h * 0.25);
    }
    if (label) { ctx.font = 'bold 12px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(label, x + w / 2, y + h / 2 + 0.5); ctx.fillStyle = '#fff'; ctx.fillText(label, x + w / 2, y + h / 2 + 0.5); }
  }
  function heart(ctx, x, y, s, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y + s * 0.35); ctx.bezierCurveTo(x, y, x - s * 0.55, y, x - s * 0.55, y + s * 0.3); ctx.bezierCurveTo(x - s * 0.55, y + s * 0.6, x, y + s * 0.8, x, y + s); ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.55, y + s * 0.6, x + s * 0.55, y + s * 0.3); ctx.bezierCurveTo(x + s * 0.55, y, x, y, x, y + s * 0.35); ctx.fill(); }

  R.hud = function (G, me, ui) {
    if (ui && ui.touch) return hudMobile(G, me, ui);
    const ctx = R.ctx, cfg = C();
    ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    const k = AB.clamp(Math.min(R.w / 1400, R.h / 800), 0.7, 1.25);
    R.hudK = k;
    ctx.scale(k, k);
    const SW = R.w / k, SH = R.h / k;
    const ti = AB.Sim.timeInfo(G.clock);
    ctx.textBaseline = 'middle';
    // --- левый верхний блок
    panel(ctx, 14, 14, 270, 134);
    ctx.font = 'bold 26px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    ctx.fillText(`${ti.isNight ? 'Ночь' : 'День'} ${ti.day} / ${cfg.NIGHTS_TO_WIN}`, 28, 38);
    if (AB.WX) { // погода — отдельной плашкой справа от блока состояния
      const wt = `${AB.WX.icon || ''} ${AB.WX.name}`; ctx.font = 'bold 14px "DejaVu Sans", "Nunito", system-ui'; const ww = ctx.measureText(wt).width + 22;
      panel(ctx, 292, 14, ww, 32, 10); ctx.textAlign = 'left'; ctx.fillStyle = AB.WX.color || '#fff'; ctx.fillText(wt, 303, 31);
      ctx.font = 'bold 26px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#fff'; }
    drawFps(ctx, 296, 60); // под плашкой погоды
    // солнце/луна
    if (ti.isNight) { S().circle(ctx, 36, 66, 8, '#cfe0ff'); S().circle(ctx, 40, 63, 7, 'rgba(10,18,15,1)'); }
    else { S().circle(ctx, 36, 66, 7, '#ffd24a'); ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(36 + Math.cos(a) * 9, 66 + Math.sin(a) * 9); ctx.lineTo(36 + Math.cos(a) * 12, 66 + Math.sin(a) * 12); ctx.stroke(); } }
    ctx.font = '600 13px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#cfd8cc';
    ctx.fillText(`${ti.isNight ? 'до рассвета' : 'до ночи'}: ${Math.ceil(ti.phaseLeft)} с`, 54, 66);
    bar(ctx, 196, 61, 74, 10, 1 - ti.phaseFrac, ti.isNight ? '#7f9cff' : '#ffd24a', ti.isNight ? '#4a5fb0' : '#e09a2a');
    if (me) {
      heart(ctx, 36, 86, 16, '#ff4a5a');
      bar(ctx, 54, 86, 216, 18, me.hp / (me.mhp || cfg.PLAYER_MAX_HP), '#ff5a5a', '#b82a3a', `${Math.ceil(me.hp)} / ${Math.round(me.mhp || cfg.PLAYER_MAX_HP)}`);
      const starving = me.food / cfg.PLAYER_MAX_FOOD < (cfg.HUNGER_BLINK || 0.1) && !me.dead;
      const blink = starving ? 0.5 + 0.5 * Math.sin(performance.now() / 110) : 0;
      if (starving) { ctx.save(); ctx.globalAlpha = 0.35 + blink * 0.65; ctx.fillStyle = '#ff3a2a'; roundRect(ctx, 20, 106, 256, 28, 12); ctx.fill(); ctx.restore(); }
      ctx.drawImage(S().icons.meat, 26 - blink * 2, 110 - blink * 2, 20 + blink * 4, 20 + blink * 4);
      bar(ctx, 54, 112, 216, 18, me.food / cfg.PLAYER_MAX_FOOD, starving ? '#ff6a4a' : '#ffae4a', starving ? '#b82a1a' : '#c8641a', starving ? `ГОЛОД! ${Math.ceil(me.food)} — нажмите E` : `${Math.ceil(me.food)} / ${cfg.PLAYER_MAX_FOOD}`);
    }
    // --- профессия и уровень
    if (me && me.prof) {
      const pd = cfg.PROFESSIONS[me.prof];
      panel(ctx, 14, 156, 270, 44);
      S().circle(ctx, 36, 178, 13, pd.color); S().circle(ctx, 36, 178, 11, 'rgba(10,18,15,1)');
      ctx.font = 'bold 15px "DejaVu Sans", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = pd.color; ctx.fillText(pd.icon, 36, 179);
      ctx.textAlign = 'left'; ctx.font = 'bold 14px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(`${pd.name} · ур. ${me.level || 1}`, 56, 172);
      ctx.font = '600 12px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#b8c8b4';
      const fl = G.fireLevel || 1;
      const infoTxt = `Умений: ${(me.skills || []).length} · костёр ${fl}`; // коротко, чтобы не залезать под плашку «+N ★»
      ctx.fillText(infoTxt, 56, 189);
      ctx.fillStyle = cfg.TIER_COLORS[Math.min(3, fl - 1)]; ctx.fillRect(56 + ctx.measureText(infoTxt).width + 6, 185, 8, 8);
      if (me.queue && me.queue.length) {
        const blink = 0.6 + Math.sin(performance.now() / 150) * 0.4;
        ctx.globalAlpha = blink; ctx.fillStyle = me.queue[0] === 's' ? '#ff7a5a' : '#8fe08a';
        roundRect(ctx, 214, 164, 62, 28, 8); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#10160f'; ctx.textAlign = 'center'; ctx.font = 'bold 12px "Nunito", system-ui'; ctx.fillText(`+${me.queue.length} ★`, 245, 179);
      }
    }
    // --- напарник
    if (G.players.length > 1 && me) {
      const o = G.players.find(p => p !== me);
      if (o) {
        panel(ctx, 14, 208, 270, 50);
        const oc = outfitOf(o);
        S().circle(ctx, 38, 233, 14, oc.hood); S().circle(ctx, 38, 236, 9, oc.skin); S().circle(ctx, 38, 228, 9, oc.hood);
        ctx.font = 'bold 13px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
        ctx.fillText(`${o.name} · ${o.prof ? cfg.PROFESSIONS[o.prof].name : ''} · ур. ${o.level || 1}`, 60, 224);
        if (o.dead) { ctx.fillStyle = '#ff8a8a'; ctx.fillText(`погиб — возрождение ${Math.ceil(o.rs)} с`, 60, 244); }
        else { bar(ctx, 60, 236, 100, 8, o.hp / (o.mhp || cfg.PLAYER_MAX_HP), '#ff5a5a', '#b82a3a'); bar(ctx, 166, 236, 100, 8, o.food / cfg.PLAYER_MAX_FOOD, '#ffae4a', '#c8641a'); }
      }
    }
    // --- ресурсы справа сверху
    if (me) {
      R.clicks = [];
      const K = R.hudK || 1;
      const click = (x, y, w, h, c, v) => R.clicks.push({ x: x * K, y: y * K, w: w * K, h: h * K, c, v });
      const items = AB.ITEM_KEYS.filter(k => !AB.Sim.bagItem(k) && k !== 'coin' && (me.inv[k] || 0) > 0);
      const w = items.length * 64 + 175 + 150 + 16 + 64;
      panel(ctx, SW - w - 14, 14, w, 46);
      // склад (общий)
      {
        const sx = SW - 175 - 150 - 16;
        ctx.drawImage(S().icons.plank, sx, 20, 28, 28);
        ctx.font = 'bold 15px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#e0c08a';
        ctx.fillText(`${G.store ? G.store.planks : 0}`, sx + 32, 31);
        ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = '#c8b890';
        ctx.fillText(`склад${G.store && G.store.coal ? ` · уголь ${G.store.coal}` : ''}`, sx + 32, 45);
        const ir = AB.Sim.ironOf(G, me);
        ctx.drawImage(S().icons.iron, sx + 88, 20, 26, 26);
        ctx.font = 'bold 15px "Nunito", system-ui'; ctx.fillStyle = ir ? '#dfe8ee' : '#7d8892'; ctx.fillText(`${ir}`, sx + 116, 31);
        ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = '#aab4bb'; ctx.fillText('железо', sx + 112, 45);
        const stn = AB.Sim.stoneOf(G, me);
        ctx.drawImage(S().icons.stone, sx - 64, 20, 26, 26);
        ctx.font = 'bold 15px "Nunito", system-ui'; ctx.fillStyle = stn ? '#e8e0d0' : '#7d8892'; ctx.fillText(`${stn}`, sx - 36, 31);
        ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = '#b8b0a0'; ctx.fillText('камень', sx - 38, 45);
      }
      // казна
      {
        const bx = SW - 175;
        ctx.drawImage(S().icons.coin, bx, 20, 30, 30);
        ctx.font = 'bold 16px "Nunito", system-ui'; ctx.textAlign = 'left';
        ctx.fillStyle = G.debt > 0 ? '#ff8a6a' : '#ffd24a'; ctx.fillText(`${G.coins || 0} $`, bx + 34, 31);
        ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = G.debt > 0 ? '#ff8a6a' : '#c8b890';
        ctx.fillText(G.debt > 0 ? `долг ${G.debt} $!` : `содерж.: ${AB.Sim.upkeepTotal(G)} $/день`, bx + 34, 45);
      }
      items.forEach((it, i) => {
        const x = SW - w - 14 + 10 + i * 64;
        ctx.drawImage(S().icons[it], x, 21, 30, 30);
        ctx.font = 'bold 15px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
        ctx.fillText(String(me.inv[it] || 0), x + 32, 38);
        if (cfg.FOOD[it]) click(x - 2, 18, 60, 36, 'eatk', it);
      });
      // --- панель стройки сверху по центру: доступные горят ярко, клик включает режим стройки
      {
        const st = me.st || {};
        const bc2 = (v) => Math.max(1, Math.round(v * (1 - Math.min(80, st.buildCost || 0) / 100)));
        const woodHave = AB.Sim.woodOf(G, me);
        R.buildBlocked = null;
        const pal = [];
        if (st.structBuild > 0) { pal.push({ cmd: 'build1', key: 'T', name: 'Частокол', cost: bc2(cfg.STRUCTURES.wall.cost) }); pal.push({ cmd: 'build2', key: 'Y', name: 'Вышка', cost: bc2(cfg.STRUCTURES.tower.cost) }); }
        else if (st.turretBuild > 0) pal.push({ cmd: 'build1', key: 'T', name: 'Турель', cost: bc2(cfg.STRUCTURES.turret.cost) });
        else if (st.moduleBuild > 0) pal.push({ cmd: 'build1', key: 'T', name: 'Модуль', cost: cfg.MODULE_COST });
        const eb = cfg.ECON_BUILDINGS[me.prof];
        const ebShort = { shop: 'Лавка', exchange: 'Биржа', workshop: 'Мастерская', townhall: 'Ратуша' };
        if (eb && !G.structs.some(q => q.kind === eb && q.owner === me.id)) pal.push({ cmd: 'build3', key: 'H', name: ebShort[eb] || cfg.STRUCTURES[eb].name, cost: bc2(cfg.STRUCTURES[eb].cost) });
        const bw = 66, bh = 56, gp = 6;
        const totw = pal.length * (bw + gp) - gp;
        // по центру, но не заезжая на панель ресурсов справа; если места нет — вторым рядом под ней
        const resLeft = SW - w - 14;
        let px = Math.round(Math.min(SW / 2 - totw / 2, resLeft - totw - 10)); let py = 14;
        if (px < 296) { px = Math.round(resLeft + w - totw - 250); py = 68; }
        ctx.textAlign = 'center';
        pal.forEach(it => {
          const ok = woodHave >= it.cost, sel = ui && ui.buildMode === it.cmd;
          ctx.globalAlpha = ok ? 1 : 0.45;
          panel(ctx, px, py, bw, bh);
          ctx.fillStyle = ok ? '#ffd24a' : '#8a8a8a';
          roundRect(ctx, px + 5, py + 5, 18, 15, 3); ctx.fill();
          ctx.fillStyle = '#1a1206'; ctx.font = 'bold 11px system-ui'; ctx.fillText(it.key, px + 14, py + 17);
          ctx.fillStyle = ok ? '#fff' : '#9aa39a'; ctx.font = '600 10px "Nunito", system-ui';
          ctx.fillText(it.name, px + bw / 2, py + 34);
          ctx.fillStyle = ok ? '#e0c08a' : '#7d847d'; ctx.fillText(`${it.cost} д`, px + bw / 2, py + 47);
          ctx.globalAlpha = 1;
          if (sel) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; roundRect(ctx, px - 1, py - 1, bw + 2, bh + 2, 8); ctx.stroke(); }
          // неактивную иконку выбрать нельзя: клик только подсказывает, сколько не хватает
          if (ok) click(px, py, bw, bh, 'buildmode', it.cmd); else click(px, py, bw, bh, 'buildno', `${it.name}: не хватает досок (нужно ${it.cost}, есть ${woodHave})`);
          if (sel && !ok) R.buildBlocked = it.cmd;
          px += bw + gp;
        });
        if (ui && ui.buildMode) {
          ctx.font = '600 12px "Nunito", system-ui'; ctx.fillStyle = '#ffe7a8';
          ctx.fillText('Клик по земле — построить, ПКМ/Esc — отмена', SW / 2, py + bh + 16);
        }
      }
      // рюкзак (внизу слева)
      {
        const cap = AB.Sim.bagCap(me), used = AB.Sim.bagUsed(me);
        const cells = [];
        AB.Sim.BAG_ORDER.forEach(k => { for (let i = 0; i < (me.inv[k] || 0); i++) cells.push(k); });
        const per = 7, cs = 34, rows = Math.ceil(cap / per);
        const foods = Object.keys(cfg.FOOD).filter(k => (me.inv[k] || 0) > 0); // еда места не занимает - отдельной строкой
        const px = 14, pw = per * (cs + 4) + 16, ph = 46 + rows * (cs + 4) + 20 + (foods.length ? 52 : 0);
        const py = SH - ph - 14;
        panel(ctx, px, py, pw, ph);
        ctx.font = 'bold 13px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = used >= cap ? '#ff8a6a' : '#fff';
        ctx.fillText(`Рюкзак ${used}/${cap}`, px + 12, py + 16);
        ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = '#aab4aa'; ctx.textAlign = 'right';
        ctx.fillText('клик — выбросить', px + pw - 12, py + 16);
        for (let i = 0; i < cap; i++) {
          const cx = px + 8 + (i % per) * (cs + 4), cy = py + 28 + Math.floor(i / per) * (cs + 4);
          ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, cx, cy, cs, cs, 6); ctx.fill();
          ctx.strokeStyle = 'rgba(160,190,150,0.2)'; ctx.lineWidth = 1; ctx.stroke();
          if (cells[i]) { ctx.drawImage(S().icons[cells[i]], cx + 3, cy + 3, cs - 6, cs - 6); click(cx, cy, cs, cs, 'dropk', cells[i]); }
        }
        if (foods.length) {
          const fy = py + 28 + rows * (cs + 4) + 4;
          ctx.textAlign = 'left'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillStyle = '#cfd8cc'; ctx.fillText('Еда (клик — съесть, место не занимает):', px + 12, fy + 6);
          foods.slice(0, per).forEach((it, i) => {
            const x = px + 8 + i * (cs + 4), y = fy + 14;
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, x, y, cs, cs, 6); ctx.fill();
            ctx.drawImage(S().icons[it], x + 4, y + 2, cs - 8, cs - 8);
            ctx.textAlign = 'right'; ctx.font = 'bold 11px "Nunito", system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(me.inv[it], x + cs - 3, y + cs - 6);
            click(x, y, cs, cs, 'eatk', it);
          });
        }
        const S0 = G.store;
        if (S0) {
          ctx.font = '600 11px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#e0c08a';
          ctx.fillText(`Лесопилка: очередь ${S0.logs}/${cfg.MILL.queueMax} · пилится ${(S0.saws || []).length}`, px + 12, py + ph - 9);
        }
      }
      // цели
      const opened = G.W.sites.filter(s => s.opened).length;
      const lines = [
        [`Выжить ${cfg.NIGHTS_TO_WIN} ночей`, null, true],
        [`Пережито ночей: ${Math.max(0, ti.day - 1)}`, ti.day > 1],
        [`Боевые навыки: ${AB.Sim.abLearned(me)} / ${cfg.ABILITY_MAX}`, AB.Sim.abLearned(me) >= cfg.ABILITY_MAX],
        [`Сундуки: ${opened} / ${G.W.sites.length}`, opened >= G.W.sites.length],
        [`Монстров убито: ${G.stats.kills}`, null],
      ];
      panel(ctx, SW - 244, 68, 230, 28 + lines.length * 22);
      lines.forEach((l, i) => {
        const y = 86 + i * 22;
        ctx.textAlign = 'left';
        if (l[2]) { ctx.font = 'bold 15px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(l[0], SW - 230, y); return; }
        ctx.font = '600 13px "Nunito", system-ui, sans-serif';
        if (l[1] !== null) {
          ctx.strokeStyle = l[1] ? '#6fd06a' : '#8a9a8a'; ctx.lineWidth = 1.5; roundRect(ctx, SW - 230, y - 7, 14, 14, 3); ctx.stroke();
          if (l[1]) { ctx.strokeStyle = '#6fd06a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(SW - 227, y); ctx.lineTo(SW - 224, y + 3); ctx.lineTo(SW - 218, y - 4); ctx.stroke(); }
        }
        ctx.fillStyle = l[1] ? '#b8e8b0' : '#cfd8cc'; ctx.fillText(l[0], SW - 210, y);
      });
      // --- панель: инструменты (топор, кирка) + начальное оружие + боевые навыки + шкала опыта
      const sz = 58, gap = 8, tools = me.pick ? 2 : 1;
      const abList = (me.ab || []).slice();
      const startAb = abList.find(a => { const d = AB.Sim.abDef(a.id); return d && d.start; });
      const learnedAb = abList.filter(a => a !== startAb);
      const nslot = tools + 1 + cfg.ABILITY_MAX;
      const tw = nslot * (sz + gap) - gap + 10;
      const hx = SW / 2 - tw / 2, hy = SH - sz - 18;
      R.slots = [];
      let sx0 = hx;
      const slot = (sel, tool) => { const x = sx0; sx0 += sz + gap + (tool === 'last' ? 10 : 0); ctx.fillStyle = tool ? 'rgba(30,24,16,0.85)' : sel ? 'rgba(20,40,60,0.9)' : 'rgba(10,18,15,0.8)'; roundRect(ctx, x, hy, sz, sz, 8); ctx.fill(); ctx.strokeStyle = tool ? 'rgba(224,192,138,0.45)' : sel ? '#6ac8ff' : 'rgba(160,190,150,0.25)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke(); return x; };
      {
        const x = slot(false, tools === 1 ? 'last' : true);
        ctx.drawImage(S().icons.axe, x + 7, hy + 5, sz - 14, sz - 14);
        ctx.font = '600 10px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e0c08a'; ctx.fillText(`топор ${me.axe || 1}`, x + sz / 2, hy + sz - 7);
        R.slots.push({ x, y: hy, w: sz, h: sz, name: `Топор ур. ${me.axe || 1}`, desc: 'Инструмент: сам рубит деревья рядом. Монстров не бьёт' });
      }
      if (me.pick) {
        const x = slot(false, 'last');
        ctx.drawImage(S().icons.pickaxe, x + 7, hy + 5, sz - 14, sz - 14);
        ctx.font = '600 10px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e0c08a'; ctx.fillText('кирка', x + sz / 2, hy + sz - 7);
        R.slots.push({ x, y: hy, w: sz, h: sz, name: 'Кирка', desc: `Сама бьёт кучи камней и железные скалы (${cfg.ORE_HITS} ударов)` });
      }
      const abSlot = (a, emptyDesc) => {
        const def = a ? AB.Sim.abDef(a.id) : null;
        const x = slot(!!def, false);
        if (!def) { ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(160,190,150,0.25)'; ctx.fillText('+', x + sz / 2, hy + sz / 2); R.slots.push({ x, y: hy, w: sz, h: sz, name: 'Свободный слот', desc: emptyDesc }); return; }
        const pc = cfg.PROFESSIONS[def.prof].color;
        if (def.start) { ctx.strokeStyle = pc; ctx.lineWidth = 1.5; roundRect(ctx, x + 3, hy + 3, sz - 6, sz - 6, 6); ctx.stroke(); }
        ctx.font = 'bold 26px "DejaVu Sans", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = pc; ctx.fillText(def.icon, x + sz / 2, hy + sz / 2 - 3);
        // перезарядка
        const cdLeft = me.abT ? me.abT[a.id] || 0 : 0, S0 = AB.Sim.abStats(G, me, def, a.lv);
        if (cdLeft > 0.05 && S0.cd > 0.5 && def.kind !== 'orbit' && def.kind !== 'aura' && def.kind !== 'drone') { ctx.fillStyle = 'rgba(0,0,0,0.5)'; const k2 = Math.min(1, cdLeft / S0.cd); roundRect(ctx, x, hy + sz * (1 - k2), sz, sz * k2, 6); ctx.fill(); }
        { const nL = cfg.ABILITY_MAX_LEVEL, pw = (sz - 12) / nL; for (let l = 0; l < nL; l++) { ctx.fillStyle = l < a.lv ? (l >= 5 ? '#ffd24a' : l >= 3 ? '#dfe8ee' : '#6ac8ff') : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 6 + l * pw, hy + sz - 8, pw - 1.5, 4); } }
        R.slots.push({ x, y: hy, w: sz, h: sz, name: `${def.name} · ур. ${a.lv}${def.start ? ' (начальное оружие)' : ''}`, desc: `${def.desc} · урон ${Math.round(S0.dmg * 10) / 10}` });
      };
      abSlot(startAb, 'Начальное оружие');
      for (let i = 0; i < cfg.ABILITY_MAX; i++) abSlot(learnedAb[i], 'Наберите опыт (побеждайте монстров), чтобы выбрать навык');
      if (ui && ui.hoverSlot >= 0 && R.slots[ui.hoverSlot]) {
        const sl = R.slots[ui.hoverSlot];
        ctx.font = 'bold 12px "Nunito", system-ui'; const t1 = sl.name; ctx.font = '600 11px "Nunito", system-ui'; const tw1 = Math.max(ctx.measureText(sl.desc).width, 90) + 20;
        const bx = AB.clamp(sl.x + sz / 2 - tw1 / 2, 10, SW - tw1 - 10);
        ctx.fillStyle = 'rgba(10,18,15,0.92)'; roundRect(ctx, bx, hy - 92, tw1, 40, 8); ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 12px "Nunito", system-ui'; ctx.fillText(t1, bx + 10, hy - 80); ctx.fillStyle = '#b8c8b4'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText(sl.desc, bx + 10, hy - 63);
      }
      // шкала опыта
      {
        const need = AB.Sim.xpNeed(me.xl || 1), frac = (me.xp || 0) / need;
        bar(ctx, hx, hy - 16, tw, 10, frac, '#6ac8ff', '#2a78d0');
        ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#bfe4ff';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const lbl = `Опыт · ур. ${me.xl || 1}  ${Math.floor(me.xp || 0)}/${need}`;
        ctx.strokeText(lbl, hx + 4, hy - 23); ctx.fillText(lbl, hx + 4, hy - 23);
        if (me.aq > 0 && me.ao) {
          const bl = 0.6 + Math.sin(performance.now() / 140) * 0.4;
          const bx = hx + tw + 10, by = hy + 4;
          ctx.globalAlpha = bl; ctx.fillStyle = '#6ac8ff'; roundRect(ctx, bx, by, 150, 50, 10); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = '#081420'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Nunito", system-ui'; ctx.fillText(`+${me.aq} ${me.ao && me.ao.some(o => o.mast) ? "мастерство" : "боевой навык"}`, bx + 75, by + 18);
          ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText('K или клик — выбрать', bx + 75, by + 35);
          click(bx, by, 150, 50, 'abopen', 0);
        }
        // кнопка «+» для рассветных умений: игра идёт, меню открывается по клику
        if (ui && ui.lvPlus > 0) {
          const bl = 0.6 + Math.sin(performance.now() / 140) * 0.4;
          const bx = hx - 160, by = hy + 4;
          ctx.globalAlpha = bl; ctx.fillStyle = '#ffd24a'; roundRect(ctx, bx, by, 150, 50, 10); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = '#1a1206'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Nunito", system-ui'; ctx.fillText(`+${ui.lvPlus} умение`, bx + 75, by + 18);
          ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText('клик — выбрать', bx + 75, by + 35);
          click(bx, by, 150, 50, 'lvopen', 0);
        }
      }
      // подсказки
      const st = me.st || {}, bc = (v) => Math.max(1, Math.round(v * (1 - Math.min(80, st.buildCost || 0) / 100)));
      const hints = [['Пробел', AB.App && AB.App.runAlways ? 'Шагом' : 'Бег'], ['Caps', AB.App && AB.App.runAlways ? 'Всегда бегом ✓' : 'Всегда бегом'], ['E', 'Съесть'], ['F', 'Автоподбор']];
      if (me.aq > 0) hints.push(['K', 'Навык']);
      if (st.structBuild > 0) { hints.push(['T', `Частокол (${bc(cfg.STRUCTURES.wall.cost)})`]); hints.push(['Y', `Вышка (${bc(cfg.STRUCTURES.tower.cost)})`]); }
      else if (st.turretBuild > 0) hints.push(['T', `Турель/пушка (${bc(cfg.STRUCTURES.turret.cost)})`]);
      else if (st.moduleBuild > 0) hints.push(['T', `Модуль (${cfg.MODULE_COST})`]);
      const eb = cfg.ECON_BUILDINGS[me.prof];
      if (eb && !G.structs.some(q => q.kind === eb && q.owner === me.id)) hints.push(['H', `${cfg.STRUCTURES[eb].name} (${bc(cfg.STRUCTURES[eb].cost)})`]);
      const ui2 = AB.Sim.upgradeInfo(G, me);
      if (ui2 && ui2.lvl < ui2.max && ui2.cost != null && AB.Sim.canUpgrade(me, ui2)) hints.push(['U', `Улучшить: ${ui2.name}`]);
      hints.push(['Tab', 'Сборка']);
      hints.push(['I', (me.wd && me.wd.length) ? `Снаряжение (${me.wd.length})` : 'Снаряжение']);
      ctx.font = '600 12px "Nunito", system-ui, sans-serif';
      // раскладка подсказок в 1–2 строки между рюкзаком и миникартой
      const kwOf = (k) => { ctx.font = 'bold 11px system-ui'; const w = Math.max(16, ctx.measureText(k).width + 8); ctx.font = '600 12px "Nunito", system-ui, sans-serif'; return w; };
      const hw = (h) => ctx.measureText(h[1]).width + 24 + kwOf(h[0]);
      const left = 330, right = SW - cfg.MINIMAP_SIZE - 40, maxW = right - left, hy2 = hy - 22;
      const rows = [[]]; let rw = 0;
      hints.forEach(h => { const w2 = hw(h); if (rw + w2 > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(h); rw += w2; });
      rows.forEach((row, ri) => {
        const tot = row.reduce((a2, h) => a2 + hw(h), 0);
        let hxx = Math.max(left, Math.min(SW / 2 - tot / 2, right - tot));
        const hyy = hy2 - 30 - (rows.length - 1 - ri) * 24;
        row.forEach(h => {
          const tw2 = ctx.measureText(h[1]).width, kw = kwOf(h[0]);
          ctx.fillStyle = 'rgba(10,18,15,0.7)'; roundRect(ctx, hxx, hyy - 10, tw2 + 16 + kw, 20, 6); ctx.fill();
          ctx.fillStyle = '#ffd24a'; roundRect(ctx, hxx + 3, hyy - 7, kw, 14, 3); ctx.fill();
          ctx.fillStyle = '#1a1206'; ctx.textAlign = 'center'; ctx.font = 'bold 11px system-ui'; ctx.fillText(h[0], hxx + 3 + kw / 2, hyy);
          ctx.fillStyle = '#e8eee6'; ctx.textAlign = 'left'; ctx.font = '600 12px "Nunito", system-ui, sans-serif'; ctx.fillText(h[1], hxx + 8 + kw, hyy);
          hxx += tw2 + 24 + kw;
        });
      });
    }
    // --- миникарта
    minimap(ctx, G, me, SW, SH);
    // --- сообщения
    const boss = G.monsters.find(m => m.boss);
    let toastY = 90;
    const bossDef = boss && cfg.BOSSES[boss.type];
    if (boss && bossDef) {
      const bw = Math.max(260, Math.min(520, SW - 620)), bx = SW / 2 - bw / 2, by = 82;
      panel(ctx, bx - 12, by - 8, bw + 24, 46);
      ctx.font = 'bold 14px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffb0a0';
      let bAff = '';
      if (AB.Survival && AB.Survival.on(G)) { const al = AB.Survival.affixLabel(boss); if (al) bAff = ` · [${al.text}]`; }
      ctx.fillText(`☠ ${bossDef.name}${bAff} · ур. ${boss.lv || G.day}`, SW / 2, by + 4);
      bar(ctx, bx, by + 14, bw, 14, boss.hp / boss.maxHp, '#ff4a3a', '#8a1a14', `${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`);
      toastY = 160;
    }
    AB.FX.toasts.forEach((ts, i) => {
      const a = Math.min(1, ts.t);
      ctx.globalAlpha = a;
      ctx.font = 'bold 17px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(ts.s).width + 30, y = toastY + i * 36;
      ctx.fillStyle = 'rgba(10,18,15,0.82)'; roundRect(ctx, SW / 2 - w / 2, y - 15, w, 30, 15); ctx.fill();
      ctx.fillStyle = ts.c; ctx.fillText(ts.s, SW / 2, y + 1);
      ctx.globalAlpha = 1;
    });
    // --- смерть
    if (me && me.dead && !G.over) {
      ctx.fillStyle = 'rgba(40,0,0,0.35)'; ctx.fillRect(0, 0, SW, SH);
      ctx.font = 'bold 40px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff8a8a';
      ctx.fillText('Вы погибли', SW / 2, SH / 2 - 20);
      ctx.font = '600 18px "Nunito", system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(`Возрождение у костра через ${Math.ceil(me.rs)} с`, SW / 2, SH / 2 + 20);
    }
    ctx.restore();
    // курсор
    if (ui && ui.mouse) {
      ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      const { x, y } = ui.mouse;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffe7a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.stroke();
      S().circle(ctx, x, y, 1.8, '#ffe7a8');
      ctx.restore();
    }
  };

  /* ===================== МОБИЛЬНЫЙ ИНТЕРФЕЙС (телефон, планшет) =====================
   * Всегда видно: здоровье, сытость, время, панель навыков, кнопка «Съесть», джойстик.
   * Остальное спрятано за иконками справа сверху (открыта одна панель за раз):
   * постройки, рюкзак (ресурсы, еда), карта, цели. Меню паузы — первая иконка. */
  function mIcon(ctx, kind, x, y, s, on, badge) {
    ctx.fillStyle = on ? 'rgba(255,210,74,0.95)' : 'rgba(10,18,15,0.82)';
    roundRect(ctx, x, y, s, s, 9); ctx.fill();
    ctx.strokeStyle = on ? '#fff2b0' : 'rgba(160,190,150,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    const c = on ? '#1a1206' : '#e8eee6', cx = x + s / 2, cy = y + s / 2;
    ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'pause') { ctx.fillRect(cx - 6, cy - 7, 4, 14); ctx.fillRect(cx + 2, cy - 7, 4, 14); }
    else if (kind === 'build') { ctx.save(); ctx.translate(cx + 1, cy + 1); ctx.rotate(-0.75); ctx.fillRect(-1.6, -3, 3.2, 12); ctx.fillRect(-7, -8, 14, 5.5); ctx.restore(); }
    else if (kind === 'bag') { roundRect(ctx, cx - 7, cy - 3, 14, 11, 3); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy - 3, 4, Math.PI, 0); ctx.stroke(); }
    else if (kind === 'map') { ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 3.5, cy + 4); ctx.lineTo(cx - 3.5, cy + 4); ctx.closePath(); ctx.fill(); }
    else if (kind === 'gear') { ctx.beginPath(); ctx.moveTo(cx - 8, cy - 4); ctx.lineTo(cx - 4, cy - 8); ctx.lineTo(cx - 1.5, cy - 6); ctx.lineTo(cx + 1.5, cy - 6); ctx.lineTo(cx + 4, cy - 8); ctx.lineTo(cx + 8, cy - 4); ctx.lineTo(cx + 5, cy - 1); ctx.lineTo(cx + 5, cy + 8); ctx.lineTo(cx - 5, cy + 8); ctx.lineTo(cx - 5, cy - 1); ctx.closePath(); ctx.fill(); }
    else if (kind === 'goals') { ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx - 2, cy + 5); ctx.lineTo(cx + 7, cy - 6); ctx.stroke(); }
    if (badge) {
      ctx.font = 'bold 10px "Nunito", system-ui'; const bw = Math.max(15, ctx.measureText(badge).width + 8);
      ctx.fillStyle = '#e0503a'; roundRect(ctx, x + s - bw + 4, y - 5, bw, 15, 7.5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(badge, x + s - bw / 2 + 4, y + 2.5);
    }
  }
  // Счётчик FPS (R.fps считает main.js): зелёный - плавно, жёлтый - терпимо, красный - тормозит
  function drawFps(ctx, x, y) {
    if (!R.showFps || !R.fps) return;
    ctx.save();
    ctx.font = 'bold 12px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(`${R.fps} FPS`, x + 1, y + 1);
    ctx.fillStyle = R.fps >= 50 ? '#8fe08a' : R.fps >= 30 ? '#ffd24a' : '#ff6a5a'; ctx.fillText(`${R.fps} FPS`, x, y);
    ctx.restore();
  }
  function hudMobile(G, me, ui) {
    const ctx = R.ctx, cfg = C(), panelOpen = ui.mobPanel || null;
    ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    const k = AB.clamp(Math.min(R.w, R.h) / 400, 0.75, 1.4);
    R.hudK = k; ctx.scale(k, k);
    const SW = R.w / k, SH = R.h / k;
    const ti = AB.Sim.timeInfo(G.clock);
    R.clicks = []; R.slots = [];
    const click = (x, y, w, h, c, v) => R.clicks.push({ x: x * k, y: y * k, w: w * k, h: h * k, c, v });
    ctx.textBaseline = 'middle';
    // --- состояние (слева сверху)
    panel(ctx, 8, 8, 196, 64, 12);
    drawFps(ctx, 212, 18); // справа от панели состояния
    ctx.textAlign = 'left'; ctx.font = 'bold 14px "Nunito", system-ui'; ctx.fillStyle = '#fff';
    ctx.fillText(`${ti.isNight ? 'Ночь' : 'День'} ${ti.day}/${cfg.NIGHTS_TO_WIN}`, 16, 21);
    if (AB.WX && AB.WX.icon) { const dw = ctx.measureText(`${ti.isNight ? 'Ночь' : 'День'} ${ti.day}/${cfg.NIGHTS_TO_WIN}`).width; ctx.font = 'bold 13px "DejaVu Sans", system-ui'; ctx.fillStyle = AB.WX.color; ctx.fillText(AB.WX.icon, 22 + dw, 21); }
    ctx.textAlign = 'right'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillStyle = ti.isNight ? '#9fb8ff' : '#ffd98a';
    ctx.fillText(`${ti.isNight ? 'рассвет' : 'ночь'} ${Math.ceil(ti.phaseLeft)} с`, 196, 21);
    if (me) {
      bar(ctx, 16, 33, 180, 14, me.hp / (me.mhp || cfg.PLAYER_MAX_HP), '#ff5a5a', '#b82a3a', `${Math.ceil(me.hp)} / ${Math.round(me.mhp || cfg.PLAYER_MAX_HP)}`);
      const starving = me.food / cfg.PLAYER_MAX_FOOD < (cfg.HUNGER_BLINK || 0.1) && !me.dead;
      if (starving) { ctx.save(); ctx.globalAlpha = 0.4 + 0.4 * Math.sin(performance.now() / 110); ctx.fillStyle = '#ff3a2a'; roundRect(ctx, 12, 49, 188, 20, 8); ctx.fill(); ctx.restore(); }
      bar(ctx, 16, 52, 180, 14, me.food / cfg.PLAYER_MAX_FOOD, starving ? '#ff6a4a' : '#ffae4a', starving ? '#b82a1a' : '#c8641a', starving ? 'ГОЛОД — съешьте что-нибудь' : `сытость ${Math.ceil(me.food)}`);
    }
    // напарник — одной строкой под состоянием
    let leftY = 78;
    if (me && G.players.length > 1) {
      const o = G.players.find(p => p !== me);
      if (o) {
        panel(ctx, 8, leftY, 196, 22, 9);
        ctx.textAlign = 'left'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillStyle = outfitOf(o).tag;
        ctx.fillText(o.dead ? `${o.name}: возрождение ${Math.ceil(o.rs)} с` : o.name, 14, leftY + 11);
        if (!o.dead) bar(ctx, 100, leftY + 6, 96, 10, o.hp / (o.mhp || cfg.PLAYER_MAX_HP), '#ff5a5a', '#b82a3a');
        leftY += 28;
      }
    }
    // --- иконки справа сверху
    const is = SW < 440 ? 32 : 38, ig = SW < 440 ? 4 : 6; // на узком экране иконки поменьше, чтобы не наезжать на состояние
    const bagCap = me ? AB.Sim.bagCap(me) : 0, bagUsed = me ? AB.Sim.bagUsed(me) : 0;
    const icons = [['pause', null], ['build', null], ['bag', me && bagUsed >= bagCap ? '!' : null], ['gear', me && me.wd && me.wd.length ? String(me.wd.length) : null], ['map', null]];
    let ix = SW - 8 - icons.length * (is + ig) + ig;
    icons.forEach(([kind, badge]) => {
      mIcon(ctx, kind, ix, 8, is, kind !== 'pause' && panelOpen === kind, badge);
      click(ix - 3, 5, is + 6, is + 6, kind === 'pause' ? 'm:pause' : kind === 'gear' ? 'm:gear' : 'm:panel', kind);
      ix += is + ig;
    });
    // казна и доски — всегда видны одной строкой под иконками
    {
      const txt = `${G.coins || 0} $   ·   досок ${G.store ? G.store.planks : 0}`;
      ctx.font = 'bold 12px "Nunito", system-ui'; const w = ctx.measureText(txt).width + 20;
      panel(ctx, SW - 8 - w, is + 14, w, 22, 9);
      ctx.textAlign = 'right'; ctx.fillStyle = G.debt > 0 ? '#ff8a6a' : '#ffd24a'; ctx.fillText(txt, SW - 18, is + 25.5);
    }
    const py0 = is + 44; // верх выпадающих панелей
    const fit = (t, maxW) => { if (ctx.measureText(t).width <= maxW) return t; while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    const swallow = (x, y, w, h) => click(x, y, w, h, 'm:nop', 0); // фон панели ловит касания
    R.buildBlocked = null;
    if (me) {
      const st = me.st || {}, bc2 = (v) => Math.max(1, Math.round(v * (1 - Math.min(80, st.buildCost || 0) / 100)));
      const woodHave = AB.Sim.woodOf(G, me);
      const pal = [];
      if (st.structBuild > 0) { pal.push({ cmd: 'build1', name: 'Частокол', cost: bc2(cfg.STRUCTURES.wall.cost) }); pal.push({ cmd: 'build2', name: 'Вышка', cost: bc2(cfg.STRUCTURES.tower.cost) }); }
      else if (st.turretBuild > 0) pal.push({ cmd: 'build1', name: 'Турель', cost: bc2(cfg.STRUCTURES.turret.cost) });
      else if (st.moduleBuild > 0) pal.push({ cmd: 'build1', name: 'Модуль', cost: cfg.MODULE_COST });
      const eb = cfg.ECON_BUILDINGS[me.prof];
      const ebShort = { shop: 'Лавка', exchange: 'Биржа', workshop: 'Мастерская', townhall: 'Ратуша' };
      if (eb && !G.structs.some(q => q.kind === eb && q.owner === me.id)) pal.push({ cmd: 'build3', name: ebShort[eb] || cfg.STRUCTURES[eb].name, cost: bc2(cfg.STRUCTURES[eb].cost) });
      const bm = pal.find(it => it.cmd === ui.buildMode);
      if (bm && woodHave < bm.cost) R.buildBlocked = bm.cmd;
      if (panelOpen === 'build') {
      const bw = 70, bh = 50, gp = 6, totw = pal.length * (bw + gp) - gp;
      let px = SW - 8 - totw;
      ctx.textAlign = 'center';
      pal.forEach(it => {
        const ok = woodHave >= it.cost;
        ctx.globalAlpha = ok ? 1 : 0.45; panel(ctx, px, py0, bw, bh, 10);
        ctx.fillStyle = ok ? '#fff' : '#9aa39a'; ctx.font = 'bold 12px "Nunito", system-ui'; ctx.fillText(it.name, px + bw / 2, py0 + 18);
        ctx.fillStyle = ok ? '#e0c08a' : '#7d847d'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText(`${it.cost} досок`, px + bw / 2, py0 + 35);
        ctx.globalAlpha = 1;
        if (ok) click(px, py0, bw, bh, 'buildmode', it.cmd); else click(px, py0, bw, bh, 'buildno', `${it.name}: не хватает досок (нужно ${it.cost}, есть ${woodHave})`);
        px += bw + gp;
      });
      ctx.font = '600 11px "Nunito", system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = '#cfd8cc';
      ctx.fillText(pal.length ? 'Выберите постройку, затем коснитесь земли' : 'Строить нечего: постройки профессии уже стоят', SW - 10, py0 + bh + 12);
      swallow(SW - 8 - totw, py0, totw, bh);
      }
    }
    if (me && panelOpen === 'bag') {
      const cells = [];
      ['wood', 'hide', 'coal', 'iron', 'stone'].forEach(kk => { for (let i = 0; i < (me.inv[kk] || 0); i++) cells.push(kk); });
      const per = 7, cs = 34, rows = Math.max(1, Math.ceil(bagCap / per));
      const foods = Object.keys(cfg.FOOD).filter(kk => (me.inv[kk] || 0) > 0); // только еда (доски и семена - не еда)
      const pw = per * (cs + 4) + 16, ph = 30 + rows * (cs + 4) + (foods.length ? 58 : 0) + 34;
      const px = Math.max(8, SW - 8 - pw), py = py0;
      panel(ctx, px, py, pw, ph, 12);
      ctx.textAlign = 'left'; ctx.font = 'bold 13px "Nunito", system-ui'; ctx.fillStyle = bagUsed >= bagCap ? '#ff8a6a' : '#fff';
      ctx.fillText(`Рюкзак ${bagUsed}/${bagCap}`, px + 12, py + 15);
      ctx.textAlign = 'right'; ctx.font = '600 10px "Nunito", system-ui'; ctx.fillStyle = '#aab4aa'; ctx.fillText('коснитесь — выбросить', px + pw - 12, py + 15);
      for (let i = 0; i < bagCap; i++) {
        const cx = px + 8 + (i % per) * (cs + 4), cy = py + 28 + Math.floor(i / per) * (cs + 4);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, cx, cy, cs, cs, 6); ctx.fill();
        if (cells[i]) { ctx.drawImage(S().icons[cells[i]], cx + 3, cy + 3, cs - 6, cs - 6); click(cx, cy, cs, cs, 'dropk', cells[i]); }
      }
      let yy = py + 30 + rows * (cs + 4);
      if (foods.length) {
        ctx.textAlign = 'left'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillStyle = '#cfd8cc'; ctx.fillText('Еда (коснитесь — съесть):', px + 12, yy + 6);
        foods.slice(0, 7).forEach((it, i) => {
          const x = px + 8 + i * (cs + 4), y = yy + 16;
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, x, y, cs, cs, 6); ctx.fill();
          ctx.drawImage(S().icons[it], x + 4, y + 2, cs - 8, cs - 8);
          ctx.textAlign = 'right'; ctx.font = 'bold 11px "Nunito", system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(me.inv[it], x + cs - 3, y + cs - 6);
          if (cfg.FOOD[it]) click(x, y, cs, cs, 'eatk', it);
        });
        yy += 58;
      }
      // общий склад
      const ir = AB.Sim.ironOf(G, me), stn = AB.Sim.stoneOf(G, me);
      ctx.textAlign = 'left'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillStyle = '#e0c08a';
      ctx.fillText(fit(`Склад: доски ${G.store ? G.store.planks : 0} · железо ${ir} · камень ${stn}${G.store && G.store.coal ? ` · уголь ${G.store.coal}` : ''}`, pw - 20), px + 12, yy + 8);
      ctx.fillStyle = '#c8b890'; ctx.fillText(fit(`Лесопилка ${G.store ? G.store.logs : 0}/${cfg.MILL.queueMax} · содержание ${AB.Sim.upkeepTotal(G)} $/день`, pw - 20), px + 12, yy + 24);
      swallow(px, py, pw, ph);
    }
    if (panelOpen === 'map') { const sz = Math.min(200, SH - py0 - 150, SW - 24); minimap(ctx, G, me, SW, SH, { x: SW - 14 - sz, y: py0 + 6, sz }); swallow(SW - 20 - sz, py0, sz + 12, sz + 12); }
    if (me && panelOpen === 'map') {
      const opened = G.W.sites.filter(s => s.opened).length;
      const lines = [[`Пережито ночей: ${Math.max(0, ti.day - 1)} из ${cfg.NIGHTS_TO_WIN}`], [`Боевые навыки: ${AB.Sim.abLearned(me)} / ${cfg.ABILITY_MAX}`], [`Сундуки: ${opened} / ${G.W.sites.length}`], [`Монстров убито: ${G.stats.kills}`], [`Умений: ${(me.skills || []).length} · костёр ур. ${G.fireLevel || 1}`]];
      // цели — рядом с картой: слева от неё на широком экране, под ней на узком
      const msz = Math.min(200, SH - py0 - 150, SW - 24), pw = 230, ph = 18 + lines.length * 20;
      const wide = SW - msz - 30 - pw > 220;
      const gx = wide ? SW - msz - 34 - pw : SW - 8 - pw, gy = wide ? py0 : py0 + msz + 22;
      panel(ctx, gx, gy, pw, ph, 12);
      ctx.textAlign = 'left'; ctx.font = '600 12px "Nunito", system-ui'; ctx.fillStyle = '#e0ecdc';
      lines.forEach((l, i) => ctx.fillText(l[0], gx + 14, gy + 18 + i * 20));
      swallow(gx, gy, pw, ph);
    }
    // --- панель навыков снизу по центру
    if (me) {
      const sz = 46, gap = 6, tools = me.pick ? 2 : 1;
      const abList = (me.ab || []).slice();
      const startAb = abList.find(a => { const d = AB.Sim.abDef(a.id); return d && d.start; });
      const learnedAb = abList.filter(a => a !== startAb);
      const nslot = tools + 1 + cfg.ABILITY_MAX, tw = nslot * (sz + gap) - gap;
      const hx = SW / 2 - tw / 2, hy = SH - sz - 10;
      let sx0 = hx;
      const slot = (sel, tool) => { const x = sx0; sx0 += sz + gap; ctx.fillStyle = tool ? 'rgba(30,24,16,0.85)' : sel ? 'rgba(20,40,60,0.9)' : 'rgba(10,18,15,0.8)'; roundRect(ctx, x, hy, sz, sz, 8); ctx.fill(); ctx.strokeStyle = tool ? 'rgba(224,192,138,0.45)' : sel ? '#6ac8ff' : 'rgba(160,190,150,0.25)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke(); return x; };
      { const x = slot(false, true); ctx.drawImage(S().icons.axe, x + 6, hy + 4, sz - 12, sz - 12); R.slots.push({ x, y: hy, w: sz, h: sz, name: `Топор ур. ${me.axe || 1}`, desc: 'Сам рубит деревья рядом' }); }
      if (me.pick) { const x = slot(false, true); ctx.drawImage(S().icons.pickaxe, x + 6, hy + 4, sz - 12, sz - 12); R.slots.push({ x, y: hy, w: sz, h: sz, name: 'Кирка', desc: 'Сама бьёт камень и железо' }); }
      const abSlot = (a) => {
        const def = a ? AB.Sim.abDef(a.id) : null;
        const x = slot(!!def, false);
        if (!def) { ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(160,190,150,0.25)'; ctx.fillText('+', x + sz / 2, hy + sz / 2); R.slots.push({ x, y: hy, w: sz, h: sz, name: 'Свободный слот', desc: 'Набирайте опыт' }); return; }
        const pc = cfg.PROFESSIONS[def.prof].color;
        ctx.font = 'bold 21px "DejaVu Sans", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = pc; ctx.fillText(def.icon, x + sz / 2, hy + sz / 2 - 3);
        const cdLeft = me.abT ? me.abT[a.id] || 0 : 0, S0 = AB.Sim.abStats(G, me, def, a.lv);
        if (cdLeft > 0.05 && S0.cd > 0.5 && !['orbit', 'aura', 'drone'].includes(def.kind)) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; const k2 = Math.min(1, cdLeft / S0.cd); roundRect(ctx, x, hy + sz * (1 - k2), sz, sz * k2, 6); ctx.fill(); }
        const nL = cfg.ABILITY_MAX_LEVEL, pw = (sz - 10) / nL;
        for (let l = 0; l < nL; l++) { ctx.fillStyle = l < a.lv ? (l >= 5 ? '#ffd24a' : l >= 3 ? '#dfe8ee' : '#6ac8ff') : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 5 + l * pw, hy + sz - 7, pw - 1.2, 3.5); }
        R.slots.push({ x, y: hy, w: sz, h: sz, name: `${def.name} · ур. ${a.lv}`, desc: def.desc });
      };
      abSlot(startAb);
      for (let i = 0; i < cfg.ABILITY_MAX; i++) abSlot(learnedAb[i]);
      // шкала опыта
      const need = AB.Sim.xpNeed(me.xl || 1);
      bar(ctx, hx, hy - 12, tw, 8, (me.xp || 0) / need, '#6ac8ff', '#2a78d0');
      ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#bfe4ff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const lbl = `опыт ${me.xl || 1} · ${Math.floor(me.xp || 0)}/${need}`; ctx.strokeText(lbl, hx + 2, hy - 20); ctx.fillText(lbl, hx + 2, hy - 20);
      // подсказка по нажатой ячейке
      if (ui.tapSlot >= 0 && R.slots[ui.tapSlot]) {
        const sl = R.slots[ui.tapSlot];
        ctx.font = '600 11px "Nunito", system-ui'; const w = Math.min(SW - 16, Math.max(ctx.measureText(sl.desc).width, ctx.measureText(sl.name).width) + 20);
        const bx = AB.clamp(sl.x + sz / 2 - w / 2, 8, SW - w - 8);
        ctx.fillStyle = 'rgba(10,18,15,0.94)'; roundRect(ctx, bx, hy - 76, w, 40, 8); ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 12px "Nunito", system-ui'; ctx.fillText(sl.name, bx + 10, hy - 64); ctx.fillStyle = '#b8c8b4'; ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText(sl.desc, bx + 10, hy - 47);
      }
      // «+ умение» / «+ навык» — над шкалой опыта
      const pill = (x, y, w, txt, col, c) => { const bl = 0.65 + Math.sin(performance.now() / 140) * 0.35; ctx.globalAlpha = bl; ctx.fillStyle = col; roundRect(ctx, x, y, w, 28, 14); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = '#10160f'; ctx.textAlign = 'center'; ctx.font = 'bold 12px "Nunito", system-ui'; ctx.fillText(txt, x + w / 2, y + 14.5); click(x - 4, y - 4, w + 8, 36, c, 0); };
      if (ui.lvPlus > 0) pill(hx, hy - 58, 120, `+${ui.lvPlus} умение`, '#ffd24a', 'lvopen');
      if (me.aq > 0 && me.ao) pill(hx + tw - 130, hy - 58, 130, `+${me.aq} ${me.ao.some(o => o.mast) ? "мастерство" : "боевой навык"}`, '#6ac8ff', 'abopen');
      // кнопка «Съесть» справа снизу
      {
        const r = 30, ex = SW - r - 14, ey = hy - r - 30;
        const foodN = Object.keys(cfg.FOOD).reduce((acc, kk) => acc + (me.inv[kk] || 0), 0);
        ctx.fillStyle = 'rgba(10,18,15,0.82)'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = foodN ? '#ffae4a' : 'rgba(160,190,150,0.3)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = foodN ? 1 : 0.4; ctx.drawImage(S().icons.meat, ex - 17, ey - 17, 34, 34); ctx.globalAlpha = 1;
        ctx.font = 'bold 11px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(`съесть · ${foodN}`, ex, ey + r + 9); ctx.fillText(`съесть · ${foodN}`, ex, ey + r + 9);
        click(ex - r, ey - r, r * 2, r * 2, 'eat', null);
        // кнопка бега (бегущий человечек) — над «Съесть»
        const on = !!(AB.App && AB.App.runMob), ry = ey - r * 2 - 26;
        ctx.fillStyle = on ? 'rgba(90,168,255,0.9)' : 'rgba(10,18,15,0.82)'; ctx.beginPath(); ctx.arc(ex, ry, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = on ? '#dff0ff' : '#6ac8ff'; ctx.lineWidth = 2; ctx.stroke();
        runnerIcon(ctx, ex, ry, 1.15, on ? '#10223a' : '#dff0ff');
        ctx.font = 'bold 11px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const rl = on ? 'бег · вкл' : 'бег'; ctx.strokeText(rl, ex, ry + r + 9); ctx.fillText(rl, ex, ry + r + 9);
        click(ex - r, ry - r, r * 2, r * 2, 'm:run', 0);
      }
    }
    // режим стройки: плашка с отменой
    if (ui.buildMode) {
      const txt = 'Коснитесь земли, чтобы построить  ✕';
      ctx.font = 'bold 13px "Nunito", system-ui'; const w = ctx.measureText(txt).width + 28, x = SW / 2 - w / 2, y = 82;
      ctx.fillStyle = 'rgba(255,210,74,0.95)'; roundRect(ctx, x, y, w, 30, 15); ctx.fill();
      ctx.fillStyle = '#1a1206'; ctx.textAlign = 'center'; ctx.fillText(txt, SW / 2, y + 15.5);
      click(x, y, w, 30, 'm:cancelbuild', 0);
    }
    // --- сообщения
    const boss = G.monsters.find(m => m.boss), bossDef = boss && cfg.BOSSES[boss.type];
    let toastY = ui.buildMode ? 128 : 96;
    if (boss && bossDef) {
      const bw = Math.min(300, SW - 40), bx = SW / 2 - bw / 2, by = toastY - 12;
      ctx.font = 'bold 12px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffb0a0'; ctx.fillText(`☠ ${bossDef.name} · ур. ${boss.lv || G.day}`, SW / 2, by);
      bar(ctx, bx, by + 8, bw, 12, boss.hp / boss.maxHp, '#ff4a3a', '#8a1a14', `${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`);
      toastY += 40;
    }
    ctx.font = 'bold 13px "Nunito", system-ui'; ctx.textAlign = 'center';
    const maxW = Math.min(SW - 40, 520);
    let ty = toastY;
    AB.FX.toasts.slice(-3).forEach((ts) => {
      // длинное сообщение переносим на вторую строку (не больше двух)
      const words = String(ts.s).split(' '), lines = [''];
      for (const wd of words) { const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && lines[lines.length - 1]) { if (lines.length === 2) { lines[1] = fit(lines[1] + ' ' + wd, maxW); break; } lines.push(wd); } else lines[lines.length - 1] = t; }
      ctx.globalAlpha = Math.min(1, ts.t);
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 22, h = 8 + lines.length * 17;
      ctx.fillStyle = 'rgba(10,18,15,0.84)'; roundRect(ctx, SW / 2 - w / 2, ty - 12, w, h, 12); ctx.fill();
      ctx.fillStyle = ts.c; lines.forEach((l, j) => ctx.fillText(l, SW / 2, ty + 0.5 + j * 17));
      ctx.globalAlpha = 1;
      ty += h + 4;
    });
    // --- смерть
    if (me && me.dead && !G.over) {
      ctx.fillStyle = 'rgba(40,0,0,0.35)'; ctx.fillRect(0, 0, SW, SH);
      ctx.font = 'bold 30px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff8a8a'; ctx.fillText('Вы погибли', SW / 2, SH / 2 - 14);
      ctx.font = '600 15px "Nunito", system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(`Возрождение у костра через ${Math.ceil(me.rs)} с`, SW / 2, SH / 2 + 16);
    }
    ctx.restore();
    // --- джойстик и долгое нажатие (в экранных координатах)
    ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    const J = ui.joy;
    if (J) {
      const rr = 52 * k;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(J.ox, J.oy, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      const dx = J.x - J.ox, dy = J.y - J.oy, d = Math.hypot(dx, dy), m = Math.min(d, rr);
      const kx = J.ox + (d ? dx / d * m : 0), ky = J.oy + (d ? dy / d * m : 0);
      ctx.fillStyle = 'rgba(255,231,168,0.55)'; ctx.beginPath(); ctx.arc(kx, ky, 22 * k, 0, TAU); ctx.fill();
    } else if (me && !me.dead && ui.showJoyHint) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.arc(80 * k, R.h - 150 * k, 46 * k, 0, TAU); ctx.fill();
      ctx.font = `600 ${Math.round(11 * k)}px "Nunito", system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText('ведите пальцем', 80 * k, R.h - 150 * k);
    }
    if (ui.lp) {
      const fr = AB.clamp(ui.lp.f, 0, 1);
      ctx.strokeStyle = 'rgba(255,231,168,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ui.lp.x, ui.lp.y, 26, -Math.PI / 2, -Math.PI / 2 + fr * TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function minimap(ctx, G, me, SW, SH, opt) {
    if (!mini) return;
    const cfg = C(), W = G.W, sz = opt ? opt.sz : cfg.MINIMAP_SIZE;
    mini.t -= 1 / 60;
    if (mini.dirty && mini.t <= 0) { mini.ctx.putImageData(mini.img, 0, 0); mini.dirty = false; mini.t = 0.3; }
    const x = opt ? opt.x : SW - sz - 18, y = opt ? opt.y : SH - sz - 18, cx = x + sz / 2, cy = y + sz / 2;
    panel(ctx, x - 6, y - 6, sz + 12, sz + 12, 14);
    ctx.save(); roundRect(ctx, x, y, sz, sz, 10); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mini.cv, x, y, sz, sz);
    ctx.imageSmoothingEnabled = true;
    const sc = sz / W.size;
    const P = (wx, wy) => [x + wx * sc, y + wy * sc];
    for (const s of W.sites) {
      if (!R.isExplored(W, s.x, s.y)) continue;
      const [px, py] = P(s.x, s.y);
      ctx.fillStyle = '#140c08'; ctx.fillRect(px - 4, py - 3, 8, 6);
      ctx.fillStyle = s.opened ? '#6d6a60' : ((C().SITE_KINDS[s.kind] || {}).color || '#ffd24a'); ctx.fillRect(px - 3, py - 2, 6, 4);
    }
    { const FR = AB.Sim.fowRadius(G); if (FR < Infinity) { const [tx, ty] = P(W.camp.x, W.camp.y); ctx.fillStyle = 'rgba(12,16,24,0.55)'; ctx.beginPath(); ctx.rect(x, y, sz, sz); ctx.arc(tx, ty, FR * sc, 0, TAU); ctx.fill('evenodd'); ctx.strokeStyle = 'rgba(150,190,230,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx, ty, FR * sc, 0, TAU); ctx.stroke(); } }
    { const [tx, ty] = P(W.camp.x, W.camp.y); ctx.strokeStyle = 'rgba(255,210,120,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(tx, ty, AB.Sim.territory(G) * sc, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    for (const f of G.fires) { if (f.town !== undefined) continue; const [px, py] = P(f.x, f.y); S().circle(ctx, px, py, 3, f.fuel > 0 ? '#ff9a2a' : '#555'); }
    for (const tn of (W.towns || [])) { // поселения: домик с флажком
      const [px, py] = P(tn.x, tn.y);
      ctx.fillStyle = '#000'; ctx.fillRect(px - 5, py - 3, 10, 8); ctx.beginPath(); ctx.moveTo(px - 6.5, py - 2); ctx.lineTo(px, py - 8); ctx.lineTo(px + 6.5, py - 2); ctx.fill();
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(px - 4, py - 2, 8, 6); ctx.fillStyle = '#c8663a'; ctx.beginPath(); ctx.moveTo(px - 5, py - 2); ctx.lineTo(px, py - 6.5); ctx.lineTo(px + 5, py - 2); ctx.fill();
    }
    if (G.merchant) { const [px, py] = P(G.merchant.x, G.merchant.y); S().circle(ctx, px, py, 4.5, '#000'); S().circle(ctx, px, py, 3.5, '#ffd24a'); }
    for (const st of G.structs) { const [px, py] = P(st.x, st.y); ctx.fillStyle = st.kind === 'turret' ? '#ffb23a' : '#d08aff'; ctx.fillRect(px - 1.5, py - 1.5, 3, 3); }
    for (const m of G.monsters) if (m.boss) { const [px, py] = P(m.x, m.y); S().circle(ctx, px, py, 5, '#000'); S().circle(ctx, px, py, 4, '#ff3a2a'); }
    // лагерь
    const [kx, ky] = P(W.camp.x, W.camp.y);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(kx, ky - 7); ctx.lineTo(kx - 6, ky - 1); ctx.lineTo(kx + 6, ky - 1); ctx.fill(); ctx.fillRect(kx - 4, ky - 1, 8, 6);
    for (const p of G.players) {
      if (p.dead) continue;
      const [px, py] = P(p.x, p.y);
      ctx.save(); ctx.translate(px, py); ctx.rotate(p.a || 0);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.fill();
      ctx.fillStyle = outfitOf(p).tag; ctx.beginPath(); ctx.moveTo(5.5, 0); ctx.lineTo(-3.8, -3.8); ctx.lineTo(-3.8, 3.8); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.font = 'bold 12px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#fff';
    [['С', cx, y + 9], ['Ю', cx, y + sz - 9], ['З', x + 9, cy], ['В', x + sz - 9, cy]].forEach(l => { ctx.strokeText(l[0], l[1], l[2]); ctx.fillText(l[0], l[1], l[2]); });
  }
})(window.AB);
