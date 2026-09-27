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
      if (W.rockAt[i] >= 0) c = [110, 110, 110];
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
    let wa = a, wk = p.w;
    if (swinging) {
      wa = p.sa; wk = p.sk;
      const dur = p.sk === 'axe' ? 0.3 : 0.25;
      const k = 1 - p.sw / dur;
      const wdef = C().WEAPONS[p.sk];
      if (p.sk === 'axe' || (wdef && wdef.type === 'melee' && p.sk !== 'spear')) wa += AB.lerp(-1.3, 1.1, AB.smooth(Math.min(1, k * 1.4)));
    }
    const hx = x + Math.cos(wa + 0.35) * 10, hy = by + Math.sin(wa + 0.35) * 7;
    const drawWeaponHand = () => {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(wa);
      let thrust = 0;
      if (swinging && wk === 'spear') thrust = Math.sin((1 - p.sw / 0.25) * Math.PI) * 12;
      if (swinging && C().WEAPONS[wk] && C().WEAPONS[wk].type === 'ranged') thrust = -p.sw * 20;
      ctx.translate(thrust, 0);
      if (wk === 'axe') drawAxe(ctx); else S().drawWeapon(ctx, wk, 1);
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
    if (!p.dead) nameTag(ctx, x, y - 38, `${p.name} · ${p.level || 1}`, o.tag);
  }
  function drawAxe(ctx) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#120a06'; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(18, 0); ctx.stroke();
    ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.fillStyle = '#120a06'; ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(20, -9); ctx.lineTo(23, -2); ctx.lineTo(18, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0c8cf'; ctx.beginPath(); ctx.moveTo(13.5, -2); ctx.lineTo(20, -7.5); ctx.lineTo(21.5, -2.5); ctx.lineTo(17.5, 0.5); ctx.closePath(); ctx.fill();
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
    const x = m.x, y = m.y, a = m.a || 0, ph = m._walk || 0;
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
  function drawStruct(ctx, s, t, near) {
    const x = s.x, y = s.y;
    if (s.kind === 'wall') {
      S().ell(ctx, x, y + 4, 17, 6, 'rgba(0,0,0,0.3)');
      for (let i = -1; i <= 1; i++) {
        const lx = x + i * 9, h = 26 + (i === 0 ? 4 : 0);
        ctx.fillStyle = '#1e140c'; ctx.fillRect(lx - 5, y - h, 10, h + 3);
        ctx.fillStyle = i === 0 ? '#86603c' : '#6b4a2e'; ctx.fillRect(lx - 4, y - h + 1, 8, h + 1);
        ctx.fillStyle = '#a07848'; ctx.fillRect(lx - 4, y - h + 1, 3, h);
        ctx.fillStyle = '#1e140c'; ctx.beginPath(); ctx.moveTo(lx - 5, y - h); ctx.lineTo(lx, y - h - 7); ctx.lineTo(lx + 5, y - h); ctx.fill();
        ctx.fillStyle = '#c8a06a'; ctx.beginPath(); ctx.moveTo(lx - 3.5, y - h); ctx.lineTo(lx, y - h - 5); ctx.lineTo(lx + 3.5, y - h); ctx.fill();
      }
      ctx.fillStyle = '#3a2616'; ctx.fillRect(x - 14, y - 14, 28, 3);
      if (s.mod) { ctx.strokeStyle = `rgba(140,210,255,${0.5 + Math.sin(t * 20) * 0.4})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 14, y - 20); for (let i = 1; i <= 4; i++) ctx.lineTo(x - 14 + i * 7, y - 20 + (i % 2 ? -3 : 3)); ctx.stroke(); drawModuleLight(ctx, x, y - 30, t); }
    } else if (s.kind === 'tower') {
      S().ell(ctx, x, y + 5, 22, 8, 'rgba(0,0,0,0.35)');
      ctx.strokeStyle = '#1e140c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      [[-14, 0, -10, -44], [14, 0, 10, -44], [-12, -8, 12, -30], [12, -8, -12, -30]].forEach(l => { ctx.beginPath(); ctx.moveTo(x + l[0], y + l[1]); ctx.lineTo(x + l[2], y + l[3]); ctx.stroke(); });
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 3;
      [[-14, 0, -10, -44], [14, 0, 10, -44], [-12, -8, 12, -30], [12, -8, -12, -30]].forEach(l => { ctx.beginPath(); ctx.moveTo(x + l[0], y + l[1]); ctx.lineTo(x + l[2], y + l[3]); ctx.stroke(); });
      ctx.fillStyle = '#1e140c'; ctx.fillRect(x - 17, y - 52, 34, 12);
      ctx.fillStyle = '#86603c'; ctx.fillRect(x - 16, y - 51, 32, 10);
      ctx.fillStyle = '#a07848'; ctx.fillRect(x - 16, y - 51, 32, 3);
      if (s.armed) {
        ctx.save(); ctx.translate(x, y - 56); ctx.rotate(s.a || 0);
        ctx.fillStyle = '#111'; ctx.fillRect(-2, -5, 22, 10); ctx.fillStyle = '#4a4f55'; ctx.fillRect(-1, -4, 20, 8); ctx.fillStyle = '#6a7078'; ctx.fillRect(-1, -4, 20, 2);
        ctx.restore();
        S().circle(ctx, x, y - 56, 7, '#111'); S().circle(ctx, x, y - 56, 6, '#3a3f45');
      } else {
        ctx.fillStyle = '#1e140c'; ctx.fillRect(x - 1.5, y - 72, 3, 22);
        ctx.fillStyle = '#c83a2a'; ctx.beginPath(); ctx.moveTo(x + 1.5, y - 72); ctx.lineTo(x + 15 + Math.sin(t * 4) * 2, y - 67); ctx.lineTo(x + 1.5, y - 62); ctx.fill();
      }
      if (s.mod) drawModuleLight(ctx, x - 12, y - 56, t);
    } else if (s.kind === 'turret') {
      S().ell(ctx, x, y + 4, 15, 6, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(x - 12, y + 3); ctx.lineTo(x - 7, y - 10); ctx.lineTo(x + 7, y - 10); ctx.lineTo(x + 12, y + 3); ctx.fill();
      ctx.fillStyle = '#5a5f66'; ctx.beginPath(); ctx.moveTo(x - 10, y + 2); ctx.lineTo(x - 6, y - 9); ctx.lineTo(x + 6, y - 9); ctx.lineTo(x + 10, y + 2); ctx.fill();
      ctx.fillStyle = '#ffb23a'; ctx.fillRect(x - 10, y - 2, 20, 2);
      ctx.save(); ctx.translate(x, y - 14); ctx.rotate(s.a || 0);
      ctx.fillStyle = '#111'; ctx.fillRect(0, -3.5, 17, 7); ctx.fillStyle = '#7a8088'; ctx.fillRect(1, -2.5, 15, 5);
      ctx.restore();
      S().circle(ctx, x, y - 14, 7, '#111'); S().circle(ctx, x, y - 14, 6, '#8a9098'); S().circle(ctx, x - 2, y - 16, 2, '#c0c8d0');
      if (s.mod) drawModuleLight(ctx, x, y - 22, t);
    }
    if (s.hp < s.mhp || near) hpBar(ctx, x, y + 10, 30, s.hp / s.mhp, '#8fd45a');
  }
  function drawMine(ctx, mn, t) {
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
  function drawBlade(ctx, bp, t) {
    ctx.save(); ctx.translate(bp.x, bp.y - 6); ctx.rotate(bp.a + Math.PI / 2 + t * 12);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(4, 0); ctx.lineTo(0, 12); ctx.lineTo(-4, 0); ctx.fill();
    ctx.fillStyle = '#dfe8ee'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(2.6, 0); ctx.lineTo(0, 10); ctx.lineTo(-2.6, 0); ctx.fill();
    ctx.restore();
  }

  /* ============================ ОБЪЕКТЫ ============================ */
  function drawSprite(ctx, sp, x, y, s, alpha) {
    s = s || 1;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(sp.c, x - sp.ox * s, y - sp.oy * s, sp.c.width * s, sp.c.height * s);
    if (alpha !== undefined) ctx.globalAlpha = 1;
  }
  function drawFire(ctx, f, t, near) {
    const x = f.x, y = f.y;
    // камни
    for (let i = 0; i < 10; i++) {
      const an = (i / 10) * TAU;
      const sx = x + Math.cos(an) * 17, sy = y + Math.sin(an) * 9;
      S().ell(ctx, sx, sy, 5, 3.8, '#1b1d20'); S().ell(ctx, sx, sy - 0.8, 4, 2.8, i % 2 ? '#7d848b' : '#6a7076');
    }
    // поленья
    ctx.lineCap = 'round';
    for (const [a1, c] of [[0.5, '#5a3a20'], [-0.5, '#6b4a2e'], [1.6, '#4a3018']]) {
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x - Math.cos(a1) * 13, y - Math.sin(a1) * 6); ctx.lineTo(x + Math.cos(a1) * 13, y + Math.sin(a1) * 6); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.stroke();
    }
    if (f.fuel > 0) {
      const k = (0.45 + 0.55 * Math.min(1, f.fuel / 60)) * (1 + 0.18 * ((f.lvl || 1) - 1));
      S().ell(ctx, x, y, 10, 5, '#ff7a1a');
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
      const w = 40, frac = f.fuel / C().FIRE_FUEL_MAX;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - w / 2 - 1, y + 14, w + 2, 5);
      ctx.fillStyle = frac < 0.25 ? '#e0503a' : '#ffae3a'; ctx.fillRect(x - w / 2, y + 15, w * frac, 3);
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
    if (d.kind === 'tent') drawSprite(ctx, sp.tent, d.x, d.y);
    else if (d.kind === 'logs') drawSprite(ctx, sp.logs, d.x, d.y);
    else if (d.kind === 'stump_seat') drawSprite(ctx, sp.stump, d.x, d.y);
    else if (d.kind === 'torch') drawTorch(ctx, d.x, d.y, t);
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
    const ic = S().icons[d.k];
    const bob = Math.sin(t * 4 + d.id) * 2.5;
    S().ell(ctx, d.x, d.y + 5, 7, 3, 'rgba(0,0,0,0.3)');
    const special = d.k.startsWith('seed') || C().WEAPONS[d.k];
    if (special) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + Math.sin(t * 5) * 0.15; S().circle(ctx, d.x, d.y - 6 + bob, 11, '#ffe07a'); ctx.restore(); }
    if (ic) ctx.drawImage(ic, d.x - 10, d.y - 16 + bob, 20, 20);
  }
  function drawProjectile(ctx, p) {
    const a = Math.atan2(p.vy, p.vx);
    ctx.save(); ctx.translate(p.x, p.y - 10); ctx.rotate(a);
    if (p.k === 'drone' || p.k === 'laser') {
      ctx.globalCompositeOperation = 'lighter';
      const col = p.k === 'laser' ? '255,80,70' : '120,200,255';
      const g = ctx.createLinearGradient(-22, 0, 3, 0); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},1)`);
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(3, 0); ctx.stroke();
    } else if (p.k === 'turret') {
      ctx.fillStyle = '#111'; ctx.fillRect(-5, -2, 10, 4); ctx.fillStyle = '#ffd24a'; ctx.fillRect(-4, -1, 8, 2);
    } else if (p.k === 'cannon') {
      S().circle(ctx, 0, 0, 5, '#111'); S().circle(ctx, -1, -1, 3.5, '#4a4f55');
    } else if (p.k === 'rifle') {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-30, 0, 4, 0); g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(1, 'rgba(255,240,180,1)');
      ctx.strokeStyle = g; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(4, 0); ctx.stroke();
    } else {
      const len = p.k === 'crossbow' ? 14 : 18;
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.5, 0); ctx.stroke();
      ctx.strokeStyle = '#c8a06a'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#d4dde3'; ctx.beginPath(); ctx.moveTo(len * 0.5 + 5, 0); ctx.lineTo(len * 0.5 - 1, -2.5); ctx.lineTo(len * 0.5 - 1, 2.5); ctx.fill();
      ctx.fillStyle = '#e8e0cc'; ctx.fillRect(-len, -3, 5, 2); ctx.fillRect(-len, 1, 5, 2);
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
      for (const [lw, col] of [[6, 'rgba(120,180,255,0.5)'], [2, '#eaf6ff']]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        p.pts.forEach((q, i) => { if (!i) { ctx.moveTo(q[0], q[1] - 10); return; } const pr = p.pts[i - 1];
          for (let s = 1; s <= 4; s++) { const f = s / 4; ctx.lineTo(AB.lerp(pr[0], q[0], f) + (s < 4 ? (Math.random() - 0.5) * 14 : 0), AB.lerp(pr[1], q[1], f) - 10 + (s < 4 ? (Math.random() - 0.5) * 14 : 0)); } });
        ctx.stroke();
      }
    }
    else if (p.t === 'flash') { ctx.globalAlpha = k * 8; S().circle(ctx, p.x, y, p.size, '#fff2b0'); }
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
    for (const pl of G.plots) if (pl.x > x0 && pl.x < x1 && pl.y > y0 && pl.y < y1) { drawPlot(ctx, pl, t, me && AB.dist2(me.x, me.y, pl.x, pl.y) < 150 * 150); if (pl.mod) drawModuleLight(ctx, pl.x + 16, pl.y - 12, t); }
    for (const mn of G.mines) drawMine(ctx, mn, t);
    for (const te of G.tele) drawTele(ctx, te, t);
    for (const s of G.structs) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) vis.push({ y: s.y, k: 9, o: s });
    for (const f of G.fires) if (f.x > x0 && f.x < x1 && f.y > y0 && f.y < y1) vis.push({ y: f.y, k: 5, o: f });
    for (const d of G.drops) if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) vis.push({ y: d.y - 1, k: 6, o: d });
    for (const m of G.monsters) if (m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1) vis.push({ y: m.y, k: 7, o: m });
    for (const p of G.players) vis.push({ y: p.y, k: 8, o: p });
    vis.sort((a, b) => a.y - b.y);
    const sp = S();
    for (const v of vis) {
      const o = v.o;
      switch (v.k) {
        case 0: {
          if (o.dead) { drawSprite(ctx, sp.stump, o.x, o.y + 4, o.s * 0.9); break; }
          let alpha;
          for (const p of G.players) if (p.y < o.y - 4 && p.y > o.y - 115 * o.s && Math.abs(p.x - o.x) < 40 * o.s) alpha = 0.42;
          const tree = sp.trees[o.v];
          if (o.shake > 0) {
            ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.sin(t * 50) * o.shake * 0.12); ctx.translate(-o.x, -o.y);
            drawSprite(ctx, tree, o.x, o.y, o.s, alpha); ctx.restore();
          } else drawSprite(ctx, tree, o.x, o.y, o.s, alpha);
          break;
        }
        case 1: drawSprite(ctx, o.kind === 'ruin' ? sp.ruins[o.v] : sp.rocks[o.v], o.x, o.y + 10 * o.s, o.s); break;
        case 2: drawSprite(ctx, o.berries ? sp.bushBerries : sp.bush, o.x, o.y + 6); break;
        case 3: drawSprite(ctx, o.opened ? sp.chestOpen : sp.chest, o.x, o.y + 8);
          if (!o.opened && Math.sin(t * 2 + o.id) > 0.9) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; S().circle(ctx, o.x + 6, o.y - 12, 3, '#fff6c0'); ctx.restore(); }
          break;
        case 4: drawDecor(ctx, o, t); break;
        case 5: drawFire(ctx, o, t, me && AB.dist2(me.x, me.y, o.x, o.y) < 140 * 140); break;
        case 6: drawDrop(ctx, o, t); break;
        case 7: drawMonster(ctx, o, t); break;
        case 8: drawPlayer(ctx, o, t); break;
        case 9: drawStruct(ctx, o, t, me && AB.dist2(me.x, me.y, o.x, o.y) < 120 * 120); break;
      }
    }
    for (const p of G.projs) drawProjectile(ctx, p);
    for (const e of G.eprojs) { S().circle(ctx, e.x, e.y - 8, 5.5, '#1a2a08'); S().circle(ctx, e.x, e.y - 8, 4.2, '#8fd14a'); S().circle(ctx, e.x - 1.2, e.y - 9.2, 1.4, '#e0ffa0'); }
    for (const p of G.players) {
      if (p.dead || !p.st) continue;
      const nd = Math.floor(p.st.drones || 0), nb = Math.floor(p.st.blades || 0);
      for (let i = 0; i < nd; i++) { const d = AB.dronePos(p, i, nd, G.clock); drawDrone(ctx, d.x, d.y, t, p.a || 0); }
      for (let i = 0; i < nb; i++) drawBlade(ctx, AB.bladePos(p, i, nb, G.clock), t);
      if (p.st.aura > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,140,40,${0.25 + Math.sin(t * 5) * 0.1})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, C().AURA_RADIUS, C().AURA_RADIUS * 0.55, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
    }
    for (const p of AB.FX.parts) if (p.t !== 'spark' && p.t !== 'flash' && p.t !== 'firefly' && p.t !== 'bolt') drawParticle(ctx, p);
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
    for (const p of AB.FX.parts) if (p.t === 'spark' || p.t === 'flash' || p.t === 'firefly' || p.t === 'bolt') drawGlowParticle(ctx, p);
    ctx.restore();

    ambient(G, cam, z, dt);
  };

  function lighting(G, me, cam, z, t) {
    const ctx = R.ctx, cfg = C(), W = G.W;
    const nf = G.nightF;
    const fw = R.fogC.width, fh = R.fogC.height, s = fw / R.w;
    const toS = (wx, wy) => [((wx - cam.x) * z + R.w / 2) * s, ((wy - cam.y) * z + R.h / 2) * s];
    const vr = AB.visionRadius(R.w, R.h, nf) * s;
    const lights = [];
    for (const f of G.fires) if (f.fuel > 0) lights.push([f.x, f.y, AB.fireLight(f) * (1 + Math.sin(t * 9 + f.x) * 0.03), 1]);
    for (const d of W.decor) if (d.kind === 'torch') lights.push([d.x, d.y - 30, 120 * (1 + Math.sin(t * 13 + d.x) * 0.05), 0.8]);
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
    cut(center[0], center[1], vr, 1);
    for (const st of G.structs) if (st.kind === 'tower') { const [sx, sy] = toS(st.x, st.y); cut(sx, sy, C().STRUCTURES.tower.vision * z * s, 0.8); }
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
      ctx.drawImage(S().icons.meat, 26, 110, 20, 20);
      bar(ctx, 54, 112, 216, 18, me.food / cfg.PLAYER_MAX_FOOD, '#ffae4a', '#c8641a', `${Math.ceil(me.food)} / ${cfg.PLAYER_MAX_FOOD}`);
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
      const items = ['wood', 'meat', 'berry', 'carrot', 'pumpkin', 'seed_carrot', 'seed_pumpkin'];
      const w = items.length * 74 + 12;
      panel(ctx, SW - w - 14, 14, w, 46);
      items.forEach((it, i) => {
        const x = SW - w - 14 + 10 + i * 74;
        ctx.drawImage(S().icons[it], x, 21, 30, 30);
        ctx.font = 'bold 15px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = (me.inv[it] || 0) > 0 ? '#fff' : '#6d7a70';
        ctx.fillText(String(me.inv[it] || 0), x + 32, 38);
      });
      // цели
      const opened = G.W.sites.filter(s => s.opened).length;
      const lines = [
        [`Выжить ${cfg.NIGHTS_TO_WIN} ночей`, null, true],
        [`Пережито ночей: ${Math.max(0, ti.day - 1)}`, ti.day > 1],
        [`Оружие: ${me.ws.length} / ${cfg.WEAPON_ORDER.length}`, me.ws.length >= cfg.WEAPON_ORDER.length],
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
      // --- панель оружия
      const order = cfg.WEAPON_ORDER, sz = 58, gap = 8;
      const tw = (order.length + 1) * (sz + gap) - gap;
      const hx = SW / 2 - tw / 2, hy = SH - sz - 18;
      order.forEach((wk, i) => {
        const x = hx + i * (sz + gap);
        const has = me.ws.includes(wk), sel = me.w === wk;
        ctx.fillStyle = sel ? 'rgba(60,48,16,0.9)' : 'rgba(10,18,15,0.8)'; roundRect(ctx, x, hy, sz, sz, 8); ctx.fill();
        ctx.strokeStyle = sel ? '#ffd24a' : 'rgba(160,190,150,0.25)'; ctx.lineWidth = sel ? 3 : 1; ctx.stroke();
        ctx.globalAlpha = has ? 1 : 0.22;
        ctx.drawImage(S().icons[wk], x + 7, hy + 7, sz - 14, sz - 14);
        ctx.globalAlpha = 1;
        ctx.font = 'bold 12px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), x + 5, hy + 10);
        if (!has) { ctx.fillStyle = '#8a9a8a'; ctx.textAlign = 'center'; ctx.font = 'bold 20px system-ui'; ctx.fillText('?', x + sz / 2, hy + sz / 2); }
        if (sel || (ui && ui.hoverSlot === i)) { ctx.font = '600 11px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7a8'; ctx.fillText(has ? cfg.WEAPONS[wk].name : '???', x + sz / 2, hy - 9); }
      });
      const ax = hx + order.length * (sz + gap);
      ctx.fillStyle = 'rgba(10,18,15,0.8)'; roundRect(ctx, ax, hy, sz, sz, 8); ctx.fill(); ctx.strokeStyle = 'rgba(160,190,150,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.drawImage(S().icons.axe, ax + 7, hy + 7, sz - 14, sz - 14);
      ctx.font = '600 10px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfd8cc'; ctx.fillText('авто', ax + sz / 2, hy + sz - 8);
      // подсказки
      const st = me.st || {}, bc = (v) => Math.max(1, Math.round(v * (1 - Math.min(80, st.buildCost || 0) / 100)));
      const hints = [['E', 'Съесть'], ['R', 'Посадить'], ['G', `Грядка (${bc(cfg.GARDEN_BED_COST)})`], ['B', `Костёр (${bc(cfg.CAMPFIRE_COST)})`]];
      if (st.structBuild > 0) { hints.push(['T', `Частокол (${bc(cfg.STRUCTURES.wall.cost)})`]); hints.push(['Y', `Вышка (${bc(cfg.STRUCTURES.tower.cost)})`]); }
      else if (st.turretBuild > 0) hints.push(['T', `Турель/пушка (${bc(cfg.STRUCTURES.turret.cost)})`]);
      else if (st.moduleBuild > 0) hints.push(['T', `Модуль (${cfg.MODULE_COST})`]);
      const mf = G.fires.find(f => f.main);
      const upc = AB.Sim.fireUpCost(G, me);
      if (mf && upc !== null && AB.dist(me.x, me.y, mf.x, mf.y) < 160) hints.push(['U', `Улучшить костёр (${upc})`]);
      hints.push(['Tab', 'Сборка']);
      ctx.font = '600 12px "Nunito", system-ui, sans-serif';
      let hxx = 0;
      hints.forEach(h => { hxx += ctx.measureText(h[1]).width + 40 + (h[0].length > 1 ? 12 : 0); });
      hxx = SW / 2 - hxx / 2;
      const hyy = hy - 30;
      hints.forEach(h => {
        const tw2 = ctx.measureText(h[1]).width;
        ctx.fillStyle = 'rgba(10,18,15,0.7)'; roundRect(ctx, hxx, hyy - 10, tw2 + 32, 20, 6); ctx.fill();
        const kw = h[0].length > 1 ? 28 : 16;
        ctx.fillStyle = 'rgba(10,18,15,0.7)'; roundRect(ctx, hxx, hyy - 10, tw2 + 16 + kw, 20, 6); ctx.fill();
        ctx.fillStyle = '#ffd24a'; roundRect(ctx, hxx + 3, hyy - 7, kw, 14, 3); ctx.fill();
        ctx.fillStyle = '#1a1206'; ctx.textAlign = 'center'; ctx.font = 'bold 11px system-ui'; ctx.fillText(h[0], hxx + 3 + kw / 2, hyy);
        ctx.fillStyle = '#e8eee6'; ctx.textAlign = 'left'; ctx.font = '600 12px "Nunito", system-ui, sans-serif'; ctx.fillText(h[1], hxx + 8 + kw, hyy);
        hxx += tw2 + 24 + kw;
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
    for (const f of G.fires) { const [px, py] = P(f.x, f.y); S().circle(ctx, px, py, 3, f.fuel > 0 ? '#ff9a2a' : '#555'); }
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
