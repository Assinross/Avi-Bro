// Отрисовка мира, персонажей, тумана/освещения и интерфейса.
(function (AB) {
  const R = AB.Render = {};
  const TAU = Math.PI * 2;
  const C = () => window.CONFIG;
  const S = () => AB.Sprites;
  const CHUNK = 512;
  let chunks = new Map(), bakeQueue = [], worldRef = null;

  R.init = function (canvas) {
    R.cv = canvas; R.ctx = canvas.getContext('2d');
    R.fogC = AB.canvas(8, 8); R.darkC = AB.canvas(8, 8);
    R.time = 0;
    R.resize();
    window.addEventListener('resize', R.resize);
  };
  R.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    R.dpr = dpr;
    R.w = window.innerWidth; R.h = window.innerHeight;
    R.cv.width = Math.floor(R.w * dpr); R.cv.height = Math.floor(R.h * dpr);
    R.cv.style.width = R.w + 'px'; R.cv.style.height = R.h + 'px';
    R.fogC.width = R.darkC.width = Math.ceil(R.w / 3); R.fogC.height = R.darkC.height = Math.ceil(R.h / 3);
  };

  R.setWorld = function (W) {
    worldRef = W; chunks = new Map(); bakeQueue = [];
    const n = Math.ceil(W.size / CHUNK);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) bakeQueue.push([x, y]);
    const cx = W.camp.x / CHUNK, cy = W.camp.y / CHUNK;
    bakeQueue.sort((a, b) => Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy));
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
        if (h < 0.03) c = AB.mix(c, [120, 170, 170], 0.4);
      } else {
        const forest = AB.fbm(wx / W.T / 14, wy / W.T / 14, seed + 101, 4);
        c = AB.mix(COL.grassD, COL.grassL, AB.clamp(n1 * 1.3 - 0.15, 0, 1));
        const dry = AB.fbm(wx / 140, wy / 140, seed + 44, 2);
        if (dry > 0.62) c = AB.mix(c, COL.dry, (dry - 0.62) * 1.6);
        c = AB.mix(c, [14, 30, 20], AB.clamp((forest - 0.45) * 1.1, 0, 0.45));
        if (g === AB.G_CAMP || g === AB.G_PATH) {
          const dn = AB.noise(wx / 18, wy / 18, seed + 5);
          c = AB.mix(COL.dirt, COL.dirtL, dn);
          if (h < 0.05) c = AB.mix(c, [150, 130, 100], 0.5);
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
    const T = W.T, t0x = cx * 16, t0y = cy * 16;
    for (let ty = t0y; ty < t0y + 16; ty++) for (let tx = t0x; tx < t0x + 16; tx++) {
      if (tx >= W.N || ty >= W.N) continue;
      const g = W.ground[ty * W.N + tx];
      const lx = (tx - t0x) * T, ly = (ty - t0y) * T;
      const r = AB.rng(tx * 7919 + ty * 104729 + seed);
      if (g === AB.G_GRASS) {
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
      } else if (g === AB.G_WATER && r() < 0.04) {
        const x = lx + r() * T, y = ly + r() * T;
        ctx.fillStyle = '#1e4a24'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0.4, TAU); ctx.lineTo(x, y); ctx.fill();
        ctx.fillStyle = '#3f7a3a'; ctx.beginPath(); ctx.ellipse(x, y - 1, 6, 4, 0, 0.4, TAU); ctx.lineTo(x, y); ctx.fill();
        if (r() < 0.4) { ctx.fillStyle = '#f0c8e0'; ctx.fillRect(x - 1, y - 2, 3, 3); }
      }
    }
    return cv;
  }
  function getChunk(W, cx, cy) {
    const key = cx + ',' + cy;
    let c = chunks.get(key);
    if (!c) { c = bakeChunk(W, cx, cy); chunks.set(key, c); }
    return c;
  }
  R.bakeIdle = function (n) {
    if (!worldRef) return;
    while (n-- > 0 && bakeQueue.length) { const q = bakeQueue.pop(); getChunk(worldRef, q[0], q[1]); }
  };
  R.bakeProgress = function () { const t = Math.pow(Math.ceil(worldRef.size / CHUNK), 2); return 1 - bakeQueue.length / t; };

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
      if (W.treeAt[i] >= 0) c = [24, 52, 30];
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
    for (let ty = cy - tr; ty <= cy + tr; ty++) for (let tx = cx - tr; tx <= cx + tr; tx++) {
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const i = ty * N + tx;
      if (mini.explored[i]) continue;
      if ((tx - cx) * (tx - cx) + (ty - cy) * (ty - cy) > tr * tr) continue;
      mini.explored[i] = 1;
      for (let k = 0; k < 4; k++) mini.img.data[i * 4 + k] = mini.base[i * 4 + k];
      mini.dirty = true;
    }
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
  function drawPlayer(ctx, p, t) {
    const o = outfitOf(p);
    const x = p.x, y = p.y, a = p.a || 0;
    const ph = p._walk || 0, mv = p.moving && !p.dead;
    const bob = mv ? Math.abs(Math.sin(ph)) * 1.6 : Math.sin(t * 2) * 0.4;
    ctx.save();
    if (p.dead) { ctx.globalAlpha = 0.5; ctx.translate(x, y); ctx.rotate(1.3); ctx.translate(-x, -y); }
    S().ell(ctx, x, y + 9, 12, 5, 'rgba(0,0,0,0.35)');
    // ноги
    const perp = a + Math.PI / 2;
    for (const side of [-1, 1]) {
      const step = mv ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 4 : 0;
      const fx = x + Math.cos(perp) * side * 4.5 + Math.cos(a) * step, fy = y + 6 + Math.sin(perp) * side * 2 + Math.sin(a) * step * 0.6;
      S().ell(ctx, fx, fy, 3.6, 2.8, '#1a120c'); S().ell(ctx, fx, fy - 0.6, 2.6, 1.9, '#4a3526');
    }
    const by = y - 3 - bob;
    const facingUp = Math.sin(a) < -0.35;
    // рюкзак (сзади)
    const bx = x - Math.cos(a) * 7, bky = by - Math.sin(a) * 4;
    const drawPack = () => { ctx.fillStyle = '#140c08'; roundRect(ctx, bx - 7, bky - 7, 14, 13, 3); ctx.fill(); ctx.fillStyle = o.pack; roundRect(ctx, bx - 6, bky - 6, 12, 11, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx - 5, bky - 5, 10, 2); };
    if (!facingUp) drawPack();
    // тело
    S().circle(ctx, x, by, 10.5, '#120c08');
    const g = ctx.createRadialGradient(x - 3, by - 4, 1, x, by, 10);
    g.addColorStop(0, o.body); g.addColorStop(1, o.bodyD);
    S().circle(ctx, x, by, 9.2, g);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - 8, by + 1, 16, 2);
    // оружие и руки
    const swinging = p.sw > 0;
    let wa = a;
    if (swinging) {
      wa = p.sa;
      const k = 1 - p.sw / 0.3;
      wa += AB.lerp(-1.3, 1.1, AB.smooth(Math.min(1, k * 1.4)));
    }
    const hx = x + Math.cos(wa + 0.35) * 10, hy = by + Math.sin(wa + 0.35) * 7;
    const drawWeaponHand = () => {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(wa);
      if (p.sk === 'pick' && p.sw > 0) drawPickaxe(ctx); else drawAxe(ctx);
      ctx.restore();
      S().circle(ctx, hx, hy, 3.6, '#120c08'); S().circle(ctx, hx, hy, 2.7, o.skin);
    };
    const lhx = x + Math.cos(wa - 0.9) * 9, lhy = by + Math.sin(wa - 0.9) * 6;
    if (facingUp) drawWeaponHand();
    S().circle(ctx, lhx, lhy, 3.6, '#120c08'); S().circle(ctx, lhx, lhy, 2.7, o.skin);
    // голова
    const hy2 = by - 11;
    S().circle(ctx, x, hy2, 8.6, '#120c08');
    S().circle(ctx, x, hy2, 7.5, o.skin);
    if (!facingUp) {
      const ex = Math.cos(a) * 2.5, ey = Math.max(0, Math.sin(a)) * 1.5;
      ctx.fillStyle = '#1a120c';
      ctx.fillRect(Math.round(x - 3 + ex), Math.round(hy2 + ey), 2, 2.5); ctx.fillRect(Math.round(x + 1.5 + ex), Math.round(hy2 + ey), 2, 2.5);
      ctx.fillStyle = 'rgba(220,120,110,0.5)'; ctx.fillRect(Math.round(x - 5 + ex), Math.round(hy2 + 3 + ey), 2, 1); ctx.fillRect(Math.round(x + 3.5 + ex), Math.round(hy2 + 3 + ey), 2, 1);
    }
    // капюшон / кепка
    ctx.save(); ctx.beginPath(); ctx.arc(x, hy2, 7.6, 0, TAU); ctx.clip();
    ctx.fillStyle = o.hood;
    const cov = facingUp ? 9 : 4.5;
    ctx.beginPath(); ctx.arc(x - Math.cos(a) * 2, hy2 - cov + 1, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = o.hoodD; ctx.fillRect(x - 9, hy2 - cov + 5, 18, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x - 3, hy2 - 5, 3, 0, TAU); ctx.fill();
    ctx.restore();
    if (o.hat === 'helmet') { ctx.fillStyle = '#140c08'; ctx.fillRect(x - 9, hy2 - 3, 18, 2.5); ctx.fillStyle = o.hoodD; ctx.fillRect(x - 8.5, hy2 - 3, 17, 1.5); }
    if (o.hat === 'phones') { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, hy2, 8.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); S().circle(ctx, x - 8, hy2 + 1, 2.6, '#5aa8ff'); S().circle(ctx, x + 8, hy2 + 1, 2.6, '#5aa8ff'); }
    if (facingUp) drawPack(); else drawWeaponHand();
    if (p.hurt > 0) { ctx.globalCompositeOperation = 'source-atop'; }
    ctx.restore();
    if (p.hurt > 0) { ctx.save(); ctx.globalAlpha = p.hurt * 1.5; S().circle(ctx, x, by - 4, 15, 'rgba(255,60,60,0.35)'); ctx.restore(); }
    // табличка с именем
    if (p.slowT > 0 && !p.dead) {
      ctx.strokeStyle = 'rgba(235,240,245,0.75)'; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const an = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + Math.cos(an) * 17, y - 6 + Math.sin(an) * 13); ctx.stroke(); }
      for (const rr of [7, 13]) { ctx.beginPath(); ctx.ellipse(x, y - 6, rr * 1.2, rr, 0, 0, TAU); ctx.stroke(); }
    }
    if (p.sh > 0 && !p.dead) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(210,190,140,${0.45 + Math.sin(t * 4) * 0.15})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y - 6, 19, 22, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(200,180,130,0.08)'; ctx.fill(); ctx.restore();
    }
    if (!p.dead) nameTag(ctx, x, y - 38, `${p.name} · ${p.level || 1}`, o.tag);
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
    const shk = m.act && !m.boss && !m._inner ? Math.sin(t * 60) * 1.5 : 0;
    const x = m.x + shk, y = m.y, a = m.a || 0, ph = m._walk || 0;
    if (shk) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, x, y - m.r, m.r * 1.3, 'rgba(255,50,30,0.18)'); ctx.restore(); }
    const hurt = m.hurt > 0;
    ctx.save();
    if (m.dying > 0) ctx.globalAlpha = Math.min(1, m.dying);
    const sc = m.r / 12;
    S().ell(ctx, x, y + 6 * sc, 13 * sc, 5 * sc, 'rgba(0,0,0,0.35)');
    const O = '#0c0806';
    if (m.type === 'wolf' || m.type === 'alpha') {
      const alpha = m.type === 'alpha';
      const P = m._pal;
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
      // голова
      S().ell(ctx, 13, 0, 7.5, 6.5, O); S().ell(ctx, 13, 0, 6.5, 5.5, fur);
      S().ell(ctx, 19, 0, 4, 3, O); S().ell(ctx, 18.5, 0, 3.2, 2.3, furL); S().circle(ctx, 21.5, 0, 1.3, '#111');
      ctx.fillStyle = O; ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(8, -10); ctx.lineTo(13, -5); ctx.fill(); ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(8, 10); ctx.lineTo(13, 5); ctx.fill();
      const ec = alpha ? '#ff3030' : '#ffcc40';
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
    // статусы
    if (m.burn) { if (Math.random() < 0.3) AB.FX.add({ t: 'spark', x: x + (Math.random() - 0.5) * m.r, y: y - m.r, z: 5, vx: 0, vy: 0, vz: 30, g: -30, life: 0.5, size: 1.6, c: Math.random() < 0.5 ? '#ff9a2a' : '#ffd24a' }); }
    if (m.slowT > 0) { ctx.strokeStyle = 'rgba(150,220,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 4, m.r + 3, (m.r + 3) * 0.45, 0, 0, TAU); ctx.stroke(); }
    if (m.mark > 0) { ctx.save(); ctx.translate(x, y - m.r * 2.4 - 24); ctx.rotate(t * 2); ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke(); ctx.restore(); }
    if (m._inner) return;
    // полоса здоровья
    if (m.hp < m.maxHp || m.guard) {
      const w = Math.max(24, m.r * 2.4), hy = y - m.r * 2.4 - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = m.guard ? '#e04a3a' : '#c83a3a'; ctx.fillRect(x - w / 2, hy, w * AB.clamp(m.hp / m.maxHp, 0, 1), 3);
      if (m.guard && (m.type === 'brute' || m.type === 'alpha')) {
        ctx.font = 'bold 9px system-ui'; ctx.fillStyle = '#ffb0a0'; ctx.textAlign = 'center'; ctx.fillText(AB.monDef(m.type).name, x, hy - 5);
      }
    }
  }

  /* ============================ БОССЫ ============================ */
  const BOSS_LOOK = {
    giant:    { base: 'brute', scale: 1.55, pal: { skin: '#5a4a2a', skinD: '#3a2e18', skinL: '#7a6a3a' } },
    packlord: { base: 'wolf',  scale: 2.1,  pal: { fur: '#d8d4cc', furL: '#f4f0e8', furD: '#8a8478' } },
  };
  function drawBoss(ctx, m, t) {
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
      if (near) label(ctx, `Крипто-биржа · AviCoin ${G_ref.crypto.price}$`, x, y - 110, '#9fdcff');
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
      const prog = sl.prog !== undefined ? sl.prog : sl.t / cfg.COOKING[sl.k].time;
      const bx = x - 40 + (i % 5) * 26, by = y - 116 - Math.floor(i / 5) * 30;
      ctx.fillStyle = 'rgba(10,16,12,0.85)'; roundRect(ctx, bx, by, 22, 26, 5); ctx.fill();
      ctx.drawImage(S().icons[sl.k], bx + 3, by + 2, 16, 16);
      ctx.fillStyle = '#333'; ctx.fillRect(bx + 2, by + 20, 18, 3);
      ctx.fillStyle = '#ffae3a'; ctx.fillRect(bx + 2, by + 20, 18 * AB.clamp(prog, 0, 1), 3);
    });
    const qn = K.queue ? K.queue.length : 0;
    if (qn) { ctx.font = 'bold 10px "Nunito", system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffe7a8'; ctx.fillText('+' + qn, x - 40 + Math.min(5, K.slots ? K.slots.length : 0) * 26, y - 100); }
    label(ctx, `Кухня ур.${K.lvl || 1}`, x, y + 18, '#ffc46b');
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
    const prog = sw.length ? Math.max(...sw) / C().MILL.sawTime : 0;
    if (sw.length) hpBar(ctx, x, y - 38, 34, prog, '#e0c08a');
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
    label(ctx, `Лесопилка ур.${Mo.lvl || 1} · очередь ${Mo.logs || 0}/${C().MILL.queueMax}${(Mo.hides || 0) > 0 ? ` · шкуры ${Mo.hides}` : ''}`, x, y + 22, '#e0c08a');
  }
  const S_ell = (c, x, y, rx, ry, col) => S().ell(c, x, y, rx, ry, col);
  // Странствующий торговец с фургоном
  function drawMerchant(ctx, M, t) {
    const x = M.x, y = M.y, bob = Math.sin(t * 2) * 1;
    Bd().draw(ctx, 'wagon', x, y);
    ctx.drawImage(S().icons.seed_pumpkin, x + 18, y - 40, 11, 11); ctx.drawImage(S().icons.hide, x + 29, y - 40, 12, 12);
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
    ctx.drawImage(sp.c, x - sp.ox * s, y - sp.oy * s, sp.c.width * s, sp.c.height * s);
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
      const tc = C().TIER_COLORS[(f.lvl || 1) - 1];
      ctx.fillStyle = 'rgba(10,16,12,0.8)'; roundRect(ctx, x - 16, y + 22, 32, 13, 6); ctx.fill(); ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = tc; ctx.fillText('ур. ' + f.lvl, x, y + 29);
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
      for (let i = 0; i < (f.lvl || 1) - 1; i++) { acc += steps[i]; ctx.fillRect(bx + acc * ppu * (w / (cap * ppu)) - 1, by - 2, 2, 10); }
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
    const pine = o.v >= 3, lr = 3 + k * 11;
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
  function drawPlot(ctx, pl, t, near) {
    const x = pl.x, y = pl.y;
    ctx.fillStyle = '#2a1a0e'; roundRect(ctx, x - 18, y - 13, 36, 26, 3); ctx.fill();
    ctx.fillStyle = '#6b4a2e'; roundRect(ctx, x - 17, y - 12, 34, 24, 3); ctx.fill();
    ctx.fillStyle = '#4a2e18'; ctx.fillRect(x - 14, y - 9, 28, 18);
    ctx.fillStyle = '#5e3c20'; for (let i = 0; i < 3; i++) ctx.fillRect(x - 14, y - 7 + i * 6, 28, 2.5);
    if (pl.crop) {
      const cd = C().CROPS[pl.crop];
      const stage = pl.ready ? 3 : Math.min(2, Math.floor((pl.t / cd.grow) * 3));
      for (let i = -1; i <= 1; i += 2) S().drawCrop(ctx, x + i * 7, y + 2, pl.crop, stage, t);
      if (pl.ready) { ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.3; S().circle(ctx, x + 12, y - 16, 2, '#fff6a0'); ctx.globalAlpha = 1; }
      else if (near) {
        const w = 30; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y + 14, w + 2, 5);
        ctx.fillStyle = '#8fd45a'; ctx.fillRect(x - w / 2, y + 15, w * Math.min(1, pl.t / cd.grow), 3);
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
  function drawFlatDecor(ctx, d) {
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
      const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 7); g.addColorStop(0, 'rgba(230,255,140,0.9)'); g.addColorStop(1, 'rgba(230,255,140,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - 7, y - 7, 14, 14);
    }
    ctx.globalAlpha = 1;
  }

  /* ============================ КАДР ============================ */
  R.draw = function (G, me, cam, dt, ui) {
    G_ref = G;
    const ctx = R.ctx, W = G.W, cfg = C();
    R.time += dt;
    const t = R.time;
    const z = R.h / cfg.VIEW_HEIGHT;
    R.zoom = z;
    const shx = (Math.random() - 0.5) * AB.FX.shake, shy = (Math.random() - 0.5) * AB.FX.shake;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.fillStyle = '#0a120e'; ctx.fillRect(0, 0, R.w, R.h);
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
    // плоские объекты
    for (const d of W.decor) if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) drawFlatDecor(ctx, d);
    // тени деревьев
    const vis = [];
    for (let ty = ty0; ty <= Math.min(W.N - 1, ty1 + 3); ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * W.N + tx;
      const ti = W.treeAt[i];
      if (ti >= 0) {
        const tr = W.trees[ti];
        if (!tr.dead) { S().ell(ctx, tr.x + 8, tr.y - 2, (tr.v < 3 ? 36 : 26) * tr.s, 13 * tr.s, 'rgba(5,15,8,0.3)'); }
        vis.push({ y: tr.y, k: 0, o: tr });
      }
      const ri = W.rockAt[i];
      if (ri >= 0) vis.push({ y: W.rocks[ri].y, k: 1, o: W.rocks[ri] });
    }
    for (const b of W.bushes) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) vis.push({ y: b.y, k: 2, o: b });
    for (const s of W.sites) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) vis.push({ y: s.y, k: 3, o: s });
    for (const d of W.decor) if (d.kind !== 'bones' && d.kind !== 'rubble' && d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) vis.push({ y: d.y, k: 4, o: d });
    if (ui && ui.sel) { const b = AB.Sim.buildingByRef(G, ui.sel); if (b) selRing(ctx, b.o.x, b.o.y, (b.o.r || 30) + 14, t); }
    for (const pl of G.plots) if (pl.x > x0 && pl.x < x1 && pl.y > y0 && pl.y < y1) { drawPlot(ctx, pl, t, me && AB.dist2(me.x, me.y, pl.x, pl.y) < 150 * 150); if (pl.mod) drawModuleLight(ctx, pl.x + 16, pl.y - 12, t); }
    for (const mn of G.mines) drawMine(ctx, mn, t);
    for (const te of G.tele) drawTele(ctx, te, t);
    for (const s of G.structs) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) vis.push({ y: s.y, k: 9, o: s });
    if (G.kitchen) vis.push({ y: G.kitchen.y, k: 10, o: G.kitchen });
    if (G.store) vis.push({ y: G.store.y, k: 11, o: G.store });
    if (G.merchant) vis.push({ y: G.merchant.y, k: 12, o: G.merchant });
    for (const f of G.fires) if (f.x > x0 && f.x < x1 && f.y > y0 && f.y < y1) vis.push({ y: f.y, k: 5, o: f });
    for (const d of G.drops) if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) vis.push({ y: d.y - 1, k: 6, o: d });
    for (const m of G.monsters) if (m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1) vis.push({ y: m.y, k: 7, o: m });
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
          if (o.shake > 0) {
            ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.sin(t * 50) * o.shake * 0.12); ctx.translate(-o.x, -o.y);
            drawSprite(ctx, tree, o.x, o.y, o.s, alpha); ctx.restore();
          } else drawSprite(ctx, tree, o.x, o.y, o.s, alpha);
          break;
        }
        case 1:
          see(markAll(o.x, o.y + 4, 22, o.kind === 'ore' ? (o.ore === 'iron' && !o.dead ? 44 : 20) : 30));
          if (o.kind === 'ore') {
            const osp = o.dead ? sp.oresDead[o.ore] : sp.ores[o.ore][o.v];
            if (o.shake > 0) { ctx.save(); ctx.translate(Math.sin(t * 60) * o.shake * 4, 0); drawSprite(ctx, osp, o.x, o.y + 6, 1); ctx.restore(); }
            else drawSprite(ctx, osp, o.x, o.y + 6, 1);
            if (!o.dead && o.hp < C().ORE_HITS) hpBar(ctx, o.x, o.y + 12, 26, o.hp / C().ORE_HITS, o.ore === 'iron' ? '#d08060' : '#c8c0b0');
            if (!o.dead && me && AB.dist2(me.x, me.y, o.x, o.y) < 70 * 70) label(ctx, `${C().ORES[o.ore].name}${me.pick ? '' : ' · нужна кирка'}`, o.x, o.y - 46, o.ore === 'iron' ? '#e0a080' : '#d8d0c0');
          } else drawSprite(ctx, o.kind === 'ruin' ? sp.ruins[o.v] : sp.rocks[o.v], o.x, o.y + 10 * o.s, o.s);
          ctx.globalAlpha = 1;
          break;
        case 2: drawSprite(ctx, o.berries ? sp.bushBerries : sp.bush, o.x, o.y + 6); break;
        case 3: drawSprite(ctx, o.opened ? sp.chestOpen : sp.chest, o.x, o.y + 8);
          if (!o.opened && Math.sin(t * 2 + o.id) > 0.9) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, o.x + 6, o.y - 12, 3, '#fff6c0'); ctx.restore(); }
          break;
        case 4: see(o.kind === 'tent' && markAll(o.x, o.y, 34, 52)); drawDecor(ctx, o, t); ctx.globalAlpha = 1; break;
        case 5: drawFire(ctx, o, t, o.main || (me && AB.dist2(me.x, me.y, o.x, o.y) < 140 * 140)); break;
        case 6: drawDrop(ctx, o, t); break;
        case 7: drawMonster(ctx, o, t); break;
        case 8: drawPlayer(ctx, o, t); break;
        case 9: { const bx = OCC_BOX[o.kind] || [30, 60]; see(markAll(o.x, o.y, bx[0], bx[1])); drawStruct(ctx, o, t, me && AB.dist2(me.x, me.y, o.x, o.y) < 120 * 120); ctx.globalAlpha = 1; break; }
        case 10: see(markAll(o.x, o.y, 54, 84)); drawKitchen(ctx, o, t, G); ctx.globalAlpha = 1; break;
        case 11: see(markAll(o.x, o.y, 56, 88)); drawStore(ctx, o, t); ctx.globalAlpha = 1; break;
        case 12: see(markAll(o.x + 22, o.y, 46, 70)); drawMerchant(ctx, o, t); ctx.globalAlpha = 1; break;
      }
    }
    // монстры за препятствиями: красный контур поверх
    for (const m of G.monsters) if (m._occ && !m.dying) {
      const pulse = 0.55 + Math.sin(t * 6 + m.id) * 0.2, rr = m.r + 5;
      ctx.save(); ctx.strokeStyle = `rgba(255,70,50,${pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m.x, m.y - m.r * 0.6, rr, rr * 1.05, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,40,0.12)'; ctx.fill(); ctx.restore();
    }
    for (const p of G.projs) drawProjectile(ctx, p);
    for (const e of G.eprojs) { S().circle(ctx, e.x, e.y - 8, 5.5, '#1a2a08'); S().circle(ctx, e.x, e.y - 8, 4.2, '#8fd14a'); S().circle(ctx, e.x - 1.2, e.y - 9.2, 1.4, '#e0ffa0'); }
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
    for (const p of AB.FX.parts) if (p.t !== 'spark' && p.t !== 'flash' && p.t !== 'firefly' && p.t !== 'bolt' && p.t !== 'beam' && p.t !== 'arc') drawParticle(ctx, p);
    // метка движения по клику
    if (ui && ui.clickMark && ui.clickMark.t > 0) {
      const cm = ui.clickMark; ctx.strokeStyle = `rgba(255,240,180,${cm.t})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cm.x, cm.y, 10 * (1.4 - cm.t * 0.4), 5 * (1.4 - cm.t * 0.4), 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    lighting(G, me, cam, z, t);

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

  function lighting(G, me, cam, z, t) {
    const ctx = R.ctx, cfg = C(), W = G.W;
    const nf = G.nightF;
    const fw = R.fogC.width, fh = R.fogC.height, s = fw / R.w;
    const toS = (wx, wy) => [((wx - cam.x) * z + R.w / 2) * s, ((wy - cam.y) * z + R.h / 2) * s];
    const vr = AB.visionRadius(R.w, R.h, nf) * s;
    const lights = [];
    for (const f of G.fires) if (f.fuel > 0) lights.push([f.x, f.y, AB.fireLight(f) * (1 + Math.sin(t * 9 + f.x) * 0.03), 1]);
    for (const d of W.decor) if (d.kind === 'torch') lights.push([d.x, d.y - 30, 120 * (1 + Math.sin(t * 13 + d.x) * 0.05), 0.8]);
    // окна и фонари зданий
    const LB = { townhall: [-10, -30, 95], workshop: [0, -24, 85], exchange: [0, -22, 80], shop: [0, -30, 60] };
    for (const st of G.structs) { const l = LB[st.kind]; if (l) lights.push([st.x + l[0], st.y + l[1], l[2], 0.45]); }
    if (G.kitchen) lights.push([G.kitchen.x - 10, G.kitchen.y - 20, 70, 0.4]);
    if (G.store) lights.push([G.store.x, G.store.y - 20, 60, 0.3]);
    if (G.merchant) lights.push([G.merchant.x + 60, G.merchant.y - 36, 75, 0.55]);
    // --- тьма ночи
    const dctx = R.darkC.getContext('2d');
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, fw, fh);
    if (nf > 0.01) {
      dctx.fillStyle = `rgba(6,10,32,${cfg.NIGHT_DARKNESS * nf})`; dctx.fillRect(0, 0, fw, fh);
      dctx.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const [sx, sy] = toS(l[0], l[1]); const r = l[2] * z * s;
        if (sx < -r || sy < -r || sx > fw + r || sy > fh + r) continue;
        const g = dctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(0,0,0,${0.95 * l[3]})`); g.addColorStop(0.5, `rgba(0,0,0,${0.6 * l[3]})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.fillStyle = g; dctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      if (me && !me.dead) { const [sx, sy] = toS(me.x, me.y); const r = 70 * z * s; const g = dctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); dctx.fillStyle = g; dctx.fillRect(sx - r, sy - r, r * 2, r * 2); }
    }
    // --- туман
    const fctx = R.fogC.getContext('2d');
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, fw, fh);
    const fc = AB.mix(cfg.FOG_DAY_COLOR, cfg.FOG_NIGHT_COLOR, nf);
    fctx.fillStyle = AB.rgb(fc, cfg.FOG_OPACITY); fctx.fillRect(0, 0, fw, fh);
    // клубы тумана (текстура)
    fctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 4; i++) {
      const wx = cam.x + Math.sin(t * 0.05 + i * 1.7) * 600, wy = cam.y + Math.cos(t * 0.04 + i * 2.3) * 400;
      const [sx, sy] = toS(wx, wy); const r = (260 + i * 30) * z * s;
      const g = fctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      const lc = AB.mix(fc, [120, 140, 130], 0.12 * (1 - nf * 0.7));
      g.addColorStop(0, AB.rgb(lc, 0.25)); g.addColorStop(1, AB.rgb(lc, 0));
      fctx.fillStyle = g; fctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    fctx.globalCompositeOperation = 'destination-out';
    const soft = cfg.FOG_EDGE_SOFTNESS;
    const cut = (sx, sy, r, str) => {
      const g = fctx.createRadialGradient(sx, sy, r * (1 - soft), sx, sy, r);
      g.addColorStop(0, `rgba(0,0,0,${str})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.arc(sx, sy, r, 0, TAU); fctx.fill();
    };
    const center = me && !me.dead ? toS(me.x, me.y) : toS(cam.x, cam.y);
    const VB = cfg.VISION_BLOCK;
    if (VB && VB.on && me && !me.dead) {
      // зрение не проникает сквозь лес: лучи от игрока останавливаются в листве
      const wr = vr / s / z, poly = visionPoly(W, me.x, me.y - 6, wr, VB);
      fctx.save();
      fctx.filter = `blur(${Math.max(1.5, 5 * s * z).toFixed(1)}px)`;
      const g = fctx.createRadialGradient(center[0], center[1], vr * (1 - soft), center[0], center[1], vr);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = g; fctx.beginPath();
      poly.forEach((q, i) => { const [sx, sy] = toS(q[0], q[1]); if (i) fctx.lineTo(sx, sy); else fctx.moveTo(sx, sy); });
      fctx.closePath(); fctx.fill();
      fctx.restore();
    } else cut(center[0], center[1], vr, 1);
    for (const st of G.structs) if (st.kind === 'tower') { const [sx, sy] = toS(st.x, st.y); cut(sx, sy, C().STRUCTURES.tower.vision * (st.bmod === 'light' ? 1.6 : 1) * z * s, 0.8); }
    for (const l of lights) { const [sx, sy] = toS(l[0], l[1]); cut(sx, sy, l[2] * z * s * 0.9, 0.85 * l[3]); }
    // --- на экран
    ctx.save();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (nf > 0.01) ctx.drawImage(R.darkC, 0, 0, R.w, R.h);
    // тёплое свечение
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const [sx, sy] = toS(l[0], l[1]); const x = sx / s, y = sy / s, r = l[2] * z * 0.75;
      if (x < -r || y < -r || x > R.w + r || y > R.h + r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.14 + 0.16 * nf) * l[3];
      g.addColorStop(0, `rgba(255,150,60,${a})`); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(R.fogC, 0, 0, R.w, R.h);
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
    const lv = AB.FX.parts.filter(p => p.t === 'leaf').length;
    if (G.nightF < 0.5 && lv < cfg.FALLING_LEAVES) {
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
      ctx.fillText(`Умений: ${(me.skills || []).length} · костёр ур. ${fl}`, 56, 189);
      ctx.fillStyle = cfg.TIER_COLORS[fl - 1]; ctx.fillRect(56 + ctx.measureText(`Умений: ${(me.skills || []).length} · костёр ур. ${fl}`).width + 6, 185, 8, 8);
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
      // рюкзак (внизу слева)
      {
        const cap = AB.Sim.bagCap(me), used = AB.Sim.bagUsed(me);
        const cells = [];
        ['wood', 'hide', 'coal', 'iron', 'stone'].forEach(k => { for (let i = 0; i < (me.inv[k] || 0); i++) cells.push(k); });
        const per = 7, cs = 34, rows = Math.ceil(cap / per);
        const px = 14, pw = per * (cs + 4) + 16, ph = 46 + rows * (cs + 4) + 20;
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
        [`Грядок засажено: ${G.plots.filter(p => p.crop).length}`, G.plots.some(p => p.crop)],
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
        for (let l = 0; l < cfg.ABILITY_MAX_LEVEL; l++) { ctx.fillStyle = l < a.lv ? (l >= 3 ? '#dfe8ee' : '#6ac8ff') : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 7 + l * 9.5, hy + sz - 8, 7, 4); }
        R.slots.push({ x, y: hy, w: sz, h: sz, name: `${def.name} · ур. ${a.lv}${def.start ? ' (начальное оружие)' : ''}`, desc: `${def.desc} · урон ${Math.round(S0.dmg * 10) / 10}` });
      };
      abSlot(startAb, 'Начальное оружие');
      for (let i = 0; i < cfg.ABILITY_MAX; i++) abSlot(learnedAb[i], 'Наберите опыт (голубые шарики), чтобы выбрать навык');
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
          ctx.fillStyle = '#081420'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Nunito", system-ui'; ctx.fillText(`+${me.aq} боевой навык`, bx + 75, by + 18);
          ctx.font = '600 11px "Nunito", system-ui'; ctx.fillText('K или клик — выбрать', bx + 75, by + 35);
          click(bx, by, 150, 50, 'abopen', 0);
        }
      }
      // подсказки
      const st = me.st || {}, bc = (v) => Math.max(1, Math.round(v * (1 - Math.min(80, st.buildCost || 0) / 100)));
      const hints = [['E', 'Съесть'], ['R', 'Посадить'], ['G', `Грядка (${bc(cfg.GARDEN_BED_COST)})`], ['B', `Костёр (${AB.Sim.fireCost(me)})`]];
      if (st.structBuild > 0) { hints.push(['T', `Частокол (${bc(cfg.STRUCTURES.wall.cost)})`]); hints.push(['Y', `Вышка (${bc(cfg.STRUCTURES.tower.cost)})`]); }
      else if (st.turretBuild > 0) hints.push(['T', `Турель/пушка (${bc(cfg.STRUCTURES.turret.cost)})`]);
      else if (st.moduleBuild > 0) hints.push(['T', `Модуль (${cfg.MODULE_COST})`]);
      const eb = cfg.ECON_BUILDINGS[me.prof];
      if (eb && !G.structs.some(q => q.kind === eb && q.owner === me.id)) hints.push(['H', `${cfg.STRUCTURES[eb].name} (${bc(cfg.STRUCTURES[eb].cost)})`]);
      const ui2 = AB.Sim.upgradeInfo(G, me);
      if (ui2 && ui2.lvl < ui2.max && ui2.cost != null && AB.Sim.canUpgrade(me, ui2)) hints.push(['U', `Улучшить: ${ui2.name}`]);
      hints.push(['Tab', 'Сборка']);
      ctx.font = '600 12px "Nunito", system-ui, sans-serif';
      // раскладка подсказок в 1–2 строки между рюкзаком и миникартой
      const hw = (h) => ctx.measureText(h[1]).width + 24 + (h[0].length > 1 ? 28 : 16);
      const left = 330, right = SW - cfg.MINIMAP_SIZE - 40, maxW = right - left, hy2 = hy - 22;
      const rows = [[]]; let rw = 0;
      hints.forEach(h => { const w2 = hw(h); if (rw + w2 > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(h); rw += w2; });
      rows.forEach((row, ri) => {
        const tot = row.reduce((a2, h) => a2 + hw(h), 0);
        let hxx = Math.max(left, Math.min(SW / 2 - tot / 2, right - tot));
        const hyy = hy2 - 30 - (rows.length - 1 - ri) * 24;
        row.forEach(h => {
          const tw2 = ctx.measureText(h[1]).width, kw = h[0].length > 1 ? 28 : 16;
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
    if (boss) {
      const bw = Math.max(260, Math.min(520, SW - 620)), bx = SW / 2 - bw / 2, by = 82;
      panel(ctx, bx - 12, by - 8, bw + 24, 46);
      ctx.font = 'bold 14px "Nunito", system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffb0a0';
      ctx.fillText(`☠ ${cfg.BOSSES[boss.type].name}`, SW / 2, by + 4);
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

  function minimap(ctx, G, me, SW, SH) {
    if (!mini) return;
    const cfg = C(), W = G.W, sz = cfg.MINIMAP_SIZE;
    mini.t -= 1 / 60;
    if (mini.dirty && mini.t <= 0) { mini.ctx.putImageData(mini.img, 0, 0); mini.dirty = false; mini.t = 0.3; }
    const x = SW - sz - 18, y = SH - sz - 18, cx = x + sz / 2, cy = y + sz / 2;
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
      ctx.fillStyle = s.opened ? '#6d6a60' : '#ffd24a'; ctx.fillRect(px - 3, py - 2, 6, 4);
    }
    { const [tx, ty] = P(W.camp.x, W.camp.y); ctx.strokeStyle = 'rgba(255,210,120,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(tx, ty, AB.Sim.territory(G) * sc, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    for (const f of G.fires) { const [px, py] = P(f.x, f.y); S().circle(ctx, px, py, 3, f.fuel > 0 ? '#ff9a2a' : '#555'); }
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
