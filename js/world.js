// Генерация мира по seed. Одинаковый seed => одинаковый мир у хоста и гостя.
(function (AB) {
  const C = () => window.CONFIG;
  // Типы земли
  AB.G_GRASS = 0; AB.G_CAMP = 1; AB.G_PATH = 2; AB.G_WATER = 3; AB.G_SITE = 4;
  // Типы препятствий
  AB.S_NONE = 0; AB.S_WATER = 1; AB.S_ROCK = 2; AB.S_TREE = 3;

  AB.generateWorld = function (seed) {
    const cfg = C();
    const N = cfg.WORLD_SIZE_TILES, T = cfg.TILE;
    const r = AB.rng(seed);
    const W = {
      seed, N, T, size: N * T,
      ground: new Uint8Array(N * N),
      solid: new Uint8Array(N * N),
      treeAt: new Int32Array(N * N).fill(-1),
      rockAt: new Int32Array(N * N).fill(-1),
      forest: new Float32Array(N * N),
      trees: [], rocks: [], bushes: [], sites: [], decor: [],
      camp: { tx: N >> 1, ty: N >> 1, x: (N >> 1) * T + T / 2, y: (N >> 1) * T + T / 2 },
      plots: [], fires: [],
    };
    const idx = (x, y) => y * N + x;
    const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const reserved = new Uint8Array(N * N); // места, где нельзя ставить деревья/воду

    const cx = W.camp.tx, cy = W.camp.ty, CR = cfg.CAMP_RADIUS_TILES;
    // ---- лагерь
    for (let y = cy - CR - 2; y <= cy + CR + 2; y++) for (let x = cx - CR - 2; x <= cx + CR + 2; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) + (AB.noise(x * 0.4, y * 0.4, seed + 5) - 0.5) * 2.5;
      if (d < CR) { W.ground[idx(x, y)] = AB.G_CAMP; reserved[idx(x, y)] = 1; }
      else if (d < CR + 2) reserved[idx(x, y)] = 1;
    }

    // ---- локации с сундуками
    const siteList = [];
    let tries = 0;
    while (siteList.length < cfg.LOOT_SITES && tries++ < 4000) {
      const a = r() * Math.PI * 2;
      const d = r.range(cfg.LOOT_SITE_MIN_DIST, cfg.LOOT_SITE_MAX_DIST);
      const sx = Math.round(cx + Math.cos(a) * d), sy = Math.round(cy + Math.sin(a) * d);
      const m = cfg.BORDER_TILES + cfg.LOOT_SITE_RADIUS + 2;
      if (sx < m || sy < m || sx >= N - m || sy >= N - m) continue;
      if (siteList.some(s => Math.hypot(s.tx - sx, s.ty - sy) < 17)) continue;
      siteList.push({ tx: sx, ty: sy, dist: Math.hypot(sx - cx, sy - cy) });
    }
    siteList.sort((a, b) => a.dist - b.dist);
    const n = siteList.length;
    const weaponAt = {};
    weaponAt[Math.round(n * 0.12)] = 'spear';
    weaponAt[Math.round(n * 0.32)] = 'bow';
    weaponAt[Math.round(n * 0.5)] = 'spear';
    weaponAt[Math.round(n * 0.62)] = 'crossbow';
    weaponAt[Math.round(n * 0.75)] = 'bow';
    weaponAt[n - 1] = 'rifle';
    siteList.forEach((s, i) => {
      const weapon = weaponAt[i] || null;
      const tier = Math.min(3, Math.floor((i / Math.max(1, n)) * 4));
      let guards;
      if (weapon === 'rifle') guards = ['brute', 'brute', 'alpha', 'wolf'];
      else if (weapon === 'crossbow') guards = ['brute', 'ghoul', 'ghoul'];
      else if (weapon === 'bow') guards = ['alpha', 'wolf', 'wolf'];
      else if (weapon === 'spear') guards = ['ghoul', 'ghoul', 'wolf'];
      else guards = [['ghoul', 'wolf'], ['ghoul', 'ghoul', 'wolf'], ['alpha', 'wolf', 'ghoul'], ['brute', 'wolf', 'wolf']][tier];
      const seeds = {};
      const ns = r.int(cfg.CHEST_SEEDS[0], cfg.CHEST_SEEDS[1]);
      for (let k = 0; k < ns; k++) {
        const key = (tier >= 2 && r() < 0.6) || (tier === 1 && r() < 0.25) ? 'seed_pumpkin' : 'seed_carrot';
        seeds[key] = (seeds[key] || 0) + 1;
      }
      { const cc = window.CONFIG.CHEST_COAL; seeds.coal = r.int(cc[0], cc[1]) + (tier >= 2 ? 1 : 0); }
      if (!weapon) { seeds.meat = r.int(1, 2 + tier); seeds.bag = window.CONFIG.CHEST_BAG_BASE + tier; }
      else if (r() < window.CONFIG.CHEST_BAG_WEAPON_CHANCE) seeds.bag = 2;
      W.sites.push({
        id: i, tx: s.tx, ty: s.ty, x: s.tx * T + T / 2, y: s.ty * T + T / 2, tier, weapon, guards,
        loot: seeds, opened: false,
      });
      const SR = cfg.LOOT_SITE_RADIUS;
      for (let y = s.ty - SR - 1; y <= s.ty + SR + 1; y++) for (let x = s.tx - SR - 1; x <= s.tx + SR + 1; x++) {
        if (!inb(x, y)) continue;
        const d = Math.hypot(x - s.tx, y - s.ty) + (AB.noise(x * 0.5, y * 0.5, seed + 9) - 0.5) * 2;
        if (d < SR) { W.ground[idx(x, y)] = AB.G_SITE; reserved[idx(x, y)] = 1; }
        else if (d < SR + 1.5) reserved[idx(x, y)] = 1;
      }
    });

    // ---- тропинки от лагеря к локациям
    W.sites.forEach((s, si) => {
      const steps = Math.ceil(Math.hypot(s.tx - cx, s.ty - cy) * 2);
      const nx = -(s.ty - cy), ny = s.tx - cx, nl = Math.hypot(nx, ny) || 1;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const wob = (AB.fbm(t * 4, si * 3.1, seed + 33, 3) - 0.5) * 14 * Math.sin(t * Math.PI);
        const px = cx + (s.tx - cx) * t + (nx / nl) * wob;
        const py = cy + (s.ty - cy) * t + (ny / nl) * wob;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const x = Math.round(px + ox * 0.6), y = Math.round(py + oy * 0.6);
          if (!inb(x, y)) continue;
          const i2 = idx(x, y);
          if (W.ground[i2] === AB.G_GRASS && Math.abs(ox) + Math.abs(oy) < 2) W.ground[i2] = AB.G_PATH;
          reserved[i2] = 1;
        }
      }
    });

    // ---- озёра, густота леса
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      W.forest[i] = AB.fbm(x / 14, y / 14, seed + 101, 4);
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      if (reserved[i] || edge < cfg.BORDER_TILES + 1) continue;
      const w = AB.fbm(x / 20, y / 20, seed + 202, 4);
      if (w > cfg.WATER_LEVEL) { W.ground[i] = AB.G_WATER; W.solid[i] = AB.S_WATER; }
    }

    // ---- деревья, камни, кусты
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      if (W.ground[i] === AB.G_WATER) continue;
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      const h = AB.hash2(x, y, seed + 7);
      const jx = (AB.hash2(x, y, seed + 8) - 0.5) * 10, jy = (AB.hash2(x, y, seed + 9) - 0.5) * 10;
      const px = x * T + T / 2 + jx, py = y * T + T / 2 + jy;
      if (edge < cfg.BORDER_TILES) {
        addTree(x, y, px, py, true); continue;
      }
      if (reserved[i]) continue;
      const dens = cfg.TREE_DENSITY * (0.25 + 1.9 * Math.pow(W.forest[i], 1.6));
      if (h < dens) addTree(x, y, px, py, false);
      else if (h < dens + cfg.ROCK_DENSITY) {
        W.rockAt[i] = W.rocks.length;
        W.rocks.push({ x: px, y: py, tx: x, ty: y, v: Math.floor(AB.hash2(x, y, seed + 10) * 3), s: 0.8 + AB.hash2(x, y, seed + 11) * 0.5, kind: 'rock' });
        W.solid[i] = AB.S_ROCK;
      } else if (h < dens + cfg.ROCK_DENSITY + cfg.BUSH_DENSITY) {
        W.bushes.push({ id: W.bushes.length, x: px, y: py, berries: 1, t: 0 });
      }
    }
    function addTree(x, y, px, py, border) {
      const i = idx(x, y);
      const v = Math.floor(AB.hash2(x, y, seed + 12) * 6);
      W.treeAt[i] = W.trees.length;
      W.trees.push({ id: W.trees.length, x: px, y: py, tx: x, ty: y, v, s: 0.85 + AB.hash2(x, y, seed + 13) * 0.4, hp: cfg.TREE_HP, dead: false, regrow: 0, shake: 0, border });
      W.solid[i] = AB.S_TREE;
    }

    // ---- руины вокруг сундуков
    W.sites.forEach((s) => {
      const cnt = 5 + s.tier;
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * Math.PI * 2 + r() * 0.4;
        const d = (cfg.LOOT_SITE_RADIUS - 1.2) * T;
        const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
        const tx = Math.floor(x / T), ty = Math.floor(y / T), i = idx(tx, ty);
        if (r() < 0.75) {
          W.rockAt[i] = W.rocks.length;
          W.rocks.push({ x, y, tx, ty, v: Math.floor(r() * 3), s: 1, kind: 'ruin', broken: r() });
          W.solid[i] = AB.S_ROCK;
        } else W.decor.push({ x, y, kind: 'rubble', v: r() });
      }
      W.decor.push({ x: s.x + 30, y: s.y + 22, kind: 'bones', v: r() });
    });

    // ---- лагерь: костёр и грядки
    W.fires.push({ x: W.camp.x, y: W.camp.y, main: true });
    const P = cfg.START_GARDEN_PLOTS;
    for (let k = 0; k < P; k++) {
      W.plots.push({ x: W.camp.x + 90 + (k % 2) * 40, y: W.camp.y - 40 + Math.floor(k / 2) * 44 });
    }
    // декор лагеря
    W.decor.push({ x: W.camp.x - 80, y: W.camp.y - 50, kind: 'tent', v: 0 });
    W.decor.push({ x: W.camp.x + 30, y: W.camp.y + 70, kind: 'stump_seat', v: 0 });
    W.decor.push({ x: W.camp.x - 30, y: W.camp.y + 50, kind: 'stump_seat', v: 1 });
    W.decor.push({ x: W.camp.x + 10, y: W.camp.y - 150, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x - 150, y: W.camp.y + 10, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x + 170, y: W.camp.y + 40, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x + 20, y: W.camp.y + 150, kind: 'torch', v: 0 });
    return W;
  };

  // Проходим ли тайл
  AB.tileSolid = function (W, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W.N || ty >= W.N) return AB.S_WATER;
    return W.solid[ty * W.N + tx];
  };

  // Сдвинуть круглое тело (x,y,r) из препятствий. Возвращает новую позицию.
  AB.resolveCollision = function (W, x, y, rad) {
    const T = W.T;
    const tx0 = Math.floor((x - rad) / T) - 1, tx1 = Math.floor((x + rad) / T) + 1;
    const ty0 = Math.floor((y - rad) / T) - 1, ty1 = Math.floor((y + rad) / T) + 1;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = AB.tileSolid(W, tx, ty);
      if (!s) continue;
      if (s === AB.S_WATER) {
        const nx = AB.clamp(x, tx * T, tx * T + T), ny = AB.clamp(y, ty * T, ty * T + T);
        const dx = x - nx, dy = y - ny, d = Math.hypot(dx, dy);
        if (d < rad) {
          if (d > 0.001) { x = nx + (dx / d) * rad; y = ny + (dy / d) * rad; }
          else { y = ty * T - rad; }
        }
      } else {
        let ox, oy, orad;
        if (s === AB.S_TREE) { const t = W.trees[W.treeAt[ty * W.N + tx]]; if (!t || t.dead) continue; ox = t.x; oy = t.y; orad = 9 * t.s; }
        else { const rk = W.rocks[W.rockAt[ty * W.N + tx]]; if (!rk) continue; ox = rk.x; oy = rk.y; orad = 12 * rk.s; }
        const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy), m = rad + orad;
        if (d < m) {
          if (d > 0.001) { x = ox + (dx / d) * m; y = oy + (dy / d) * m; }
          else x = ox + m;
        }
      }
    }
    // здания (постройки игроков, кухня, лесопилка, костры, торговец)
    const G = W.G;
    if (G) {
      const OR = window.CONFIG.OBSTACLE_RADIUS;
      const push = (ox, oy, orad) => {
        const dx = x - ox, dy = y - oy, m = rad + orad;
        if (Math.abs(dx) > m || Math.abs(dy) > m) return;
        const d = Math.hypot(dx, dy);
        if (d < m) { if (d > 0.001) { x = ox + (dx / d) * m; y = oy + (dy / d) * m; } else y = oy + m; }
      };
      for (const s of G.structs) push(s.x, s.y, s.r);
      if (G.kitchen) push(G.kitchen.x - 5, G.kitchen.y - 4, OR.kitchen);
      if (G.store) push(G.store.x, G.store.y - 2, OR.mill);
      for (const f of G.fires) push(f.x, f.y, OR.fire);
      if (G.merchant) push(G.merchant.x + 8, G.merchant.y - 4, OR.merchant);
    }
    const lim = W.size;
    x = AB.clamp(x, rad, lim - rad); y = AB.clamp(y, rad, lim - rad);
    return [x, y];
  };

  // Можно ли тут стоять (для появления монстров и построек)
  AB.freeSpot = function (W, x, y, rad) {
    const T = W.T;
    for (let ty = Math.floor((y - rad) / T); ty <= Math.floor((y + rad) / T); ty++)
      for (let tx = Math.floor((x - rad) / T); tx <= Math.floor((x + rad) / T); tx++) {
        const s = AB.tileSolid(W, tx, ty);
        if (s === AB.S_WATER || s === AB.S_ROCK) return false;
        if (s === AB.S_TREE) { const t = W.trees[W.treeAt[ty * W.N + tx]]; if (t && !t.dead) return false; }
      }
    return true;
  };
})(window.AB);
