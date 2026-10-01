// Генерация мира по seed. Одинаковый seed => одинаковый мир у хоста и гостя.
(function (AB) {
  const C = () => window.CONFIG;
  // Типы земли
  AB.G_GRASS = 0; AB.G_CAMP = 1; AB.G_PATH = 2; AB.G_WATER = 3; AB.G_SITE = 4;
  // Типы препятствий
  AB.S_NONE = 0; AB.S_WATER = 1; AB.S_ROCK = 2; AB.S_TREE = 3;

  // Версия генератора: 1 - как было; 2 - локации не встают на границы колец тумана войны.
  // Старые сохранения строят мир своей версией, чтобы номера деревьев не съехали
  AB.WGEN = 2;
  AB.generateWorld = function (seed, wg) {
    wg = wg || AB.WGEN;
    const GROVE = window.CONFIG.GROVE || { scale: 0.07, birch: 0.62, pine: 0.66, meadow: 0.88 };
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
      fires: [],
    };
    const idx = (x, y) => y * N + x;
    const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const reserved = new Uint8Array(N * N); // места, где нельзя ставить деревья/воду

    const cx = W.camp.tx, cy = W.camp.ty, CR = cfg.CAMP_RADIUS_TILES;
    // ---- земли сторон света: 0 — лесное ядро, 1 север, 2 восток, 3 юг, 4 запад; bmix — сила биома (плавный переход)
    const BKEYS = [null, 'north', 'east', 'south', 'west'];
    W.biome = new Uint8Array(N * N); W.bmix = new Float32Array(N * N);
    W.core = cfg.CORE_TILES || N;
    const HALF = W.core / 2, BL = cfg.BIOME_BLEND || 6;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy, ax = Math.abs(dx), ay = Math.abs(dy);
      const m = Math.max(ax, ay) + (AB.noise(x * 0.08, y * 0.08, seed + 61) - 0.5) * 10;
      if (m < HALF - BL / 2 || W.core >= N) continue;
      const vert = ay + (AB.noise(x * 0.05, y * 0.05, seed + 62) - 0.5) * 16 > ax;
      const b = vert ? (dy < 0 ? 1 : 3) : (dx > 0 ? 2 : 4), i = y * N + x;
      W.biome[i] = b; W.bmix[i] = AB.clamp((m - (HALF - BL / 2)) / BL, 0, 1);
    }
    AB.biomeKey = (b) => BKEYS[b];
    const bdef = (i) => (W.biome[i] ? cfg.BIOMES[BKEYS[W.biome[i]]] : null);
    // ---- лагерь
    for (let y = cy - CR - 2; y <= cy + CR + 2; y++) for (let x = cx - CR - 2; x <= cx + CR + 2; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) + (AB.noise(x * 0.4, y * 0.4, seed + 5) - 0.5) * 2.5;
      if (d < CR) { W.ground[idx(x, y)] = AB.G_CAMP; reserved[idx(x, y)] = 1; }
      else if (d < CR + 2) reserved[idx(x, y)] = 1;
    }

    // ---- локации с сундуками (логова для разграбления)
    const siteList = [];
    let tries = 0;
    const spacing = cfg.LOOT_SITE_SPACING || 14;
    while (siteList.length < cfg.LOOT_SITES && tries++ < 6000) {
      const a = r() * Math.PI * 2;
      const d = r.range(cfg.LOOT_SITE_MIN_DIST, cfg.LOOT_SITE_MAX_DIST);
      const sx = Math.round(cx + Math.cos(a) * d), sy = Math.round(cy + Math.sin(a) * d);
      const m = cfg.BORDER_TILES + cfg.LOOT_SITE_RADIUS + (cfg.HIDDEN_RING || 0) + 2;
      if (sx < m || sy < m || sx >= N - m || sy >= N - m) continue;
      if (siteList.some(s => Math.hypot(s.tx - sx, s.ty - sy) < spacing)) continue;
      // локация (сундук и стража) целиком в одном кольце тумана: при росте костра не открывается наполовину
      if (wg >= 2) { const dp = Math.hypot(sx - cx, sy - cy) * cfg.TILE, mg = (cfg.SITE_SEAM_MARGIN || 4) * cfg.TILE; if ((cfg.FOW_RADIUS || []).some(R => Math.abs(dp - R) < mg)) continue; }
      siteList.push({ tx: sx, ty: sy, dist: Math.hypot(sx - cx, sy - cy) });
    }
    siteList.sort((a, b) => a.dist - b.dist);
    const n = siteList.length;
    // скрытые логова — из дальней половины, через одно
    const hiddenSet = new Set();
    for (let i = n - 1, k = 0; i >= Math.floor(n * 0.35) && k < (cfg.HIDDEN_SITES || 0); i -= 2, k++) hiddenSet.add(i);
    // вид каждой локации: каждый вид (кроме руин) хотя бы SITE_KIND_MIN раз, остальное — случайно
    const KINDS = cfg.SITE_KINDS, kindKeys = Object.keys(KINDS);
    const bag = [];
    kindKeys.filter(k => k !== 'ruins').forEach(k => { for (let j = 0; j < (cfg.SITE_KIND_MIN || 1); j++) bag.push(k); });
    const openN = n - hiddenSet.size;
    while (bag.length < openN) bag.push(kindKeys[r.int(0, kindKeys.length - 1)]);
    for (let i = bag.length - 1; i > 0; i--) { const j = r.int(0, i); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const GR = (cfg.SITE_GROW && cfg.SITE_GROW.radius) || [cfg.LOOT_SITE_RADIUS];
    const SRmax = GR[GR.length - 1];
    W.sgl = new Uint8Array(N * N);   // с какого уровня костра тайл становится частью поляны (0 — никогда)
    W.skind = new Uint8Array(N * N); // вид локации на тайле (индекс в SITE_KINDS + 1) — для рисунка земли
    W.blockers = [];                 // крупные непроходимые предметы локаций (тарелка, избушка, берлога)
    const grow = new Uint8Array(N * N); // зона роста поляны: без воды и залежей
    const IR = cfg.IRON || {};
    const mhp = (t) => (cfg.MONSTERS[t] || { hp: 50 }).hp, mdmg = (t) => (cfg.MONSTERS[t] || { damage: 10 }).damage;
    let bi = 0;
    siteList.forEach((s, i) => {
      const hidden = hiddenSet.has(i);
      const tier = Math.min(3, Math.floor((i / Math.max(1, n)) * 4));
      const kind = hidden ? 'ruins' : bag[bi++] || 'ruins';
      const K = KINDS[kind];
      const pool = K.packs[tier];
      let guards = pool[r.int(0, pool.length - 1)].slice();
      if (hidden) guards = ['brute', 'alpha', 'archer', 'spitter', 'ghoul', 'alpha'];
      // одиночный босс лагеря вместо группы
      let elite = null;
      if (!hidden && r() < (cfg.ELITE_CHANCE || 0)) {
        const E = cfg.ELITE, hpSum = guards.reduce((a, t) => a + mhp(t), 0), dAvg = guards.reduce((a, t) => a + mdmg(t), 0) / guards.length;
        elite = { type: K.boss, name: K.bossName, hp: Math.max(1.5, hpSum * E.hpOfPack / mhp(K.boss)), dmg: Math.max(1.2, dAvg * E.dmgMult / mdmg(K.boss)), n: guards.length };
        guards = [K.boss];
      }
      // сундук: монеты, опыт и одежда (сама вещь создаётся при открытии — её сила зависит от уровня костра)
      const L = K.loot || {};
      const loot = {};
      const cx2 = cfg.CHEST_XP; loot.xp = Math.round(r.int(cx2[0], cx2[1]) * (1 + 0.5 * tier) * (hidden ? 2 : 1) * (L.xp || 1) * (elite ? 1.3 : 1));
      const co = cfg.CHEST_COINS; loot.coin = Math.round(r.int(co[0], co[1]) * (tier + 1) * (L.coin || 1) * (elite ? 1.3 : 1));
      const CG = cfg.CHEST_GEAR || [1, 1];
      loot.gear = r.int(CG[0], CG[1]) + (elite || hidden ? 1 : 0);
      W.sites.push({
        id: i, tx: s.tx, ty: s.ty, x: s.tx * T + T / 2, y: s.ty * T + T / 2, tier, hidden, guards, kind, elite,
        power: hidden ? cfg.HIDDEN_GUARD_POWER : cfg.GUARD_POWER[tier],
        loot, opened: false,
      });
      const ki = kindKeys.indexOf(kind) + 1;
      for (let y = Math.floor(s.ty - SRmax - 2); y <= s.ty + SRmax + 2; y++) for (let x = Math.floor(s.tx - SRmax - 2); x <= s.tx + SRmax + 2; x++) {
        if (!inb(x, y)) continue;
        const j = idx(x, y);
        const d = Math.hypot(x - s.tx, y - s.ty) + (AB.noise(x * 0.5, y * 0.5, seed + 9) - 0.5) * 2;
        let lv = 0;
        for (let q = 0; q < GR.length; q++) if (d < GR[q]) { lv = q + 1; break; }
        if (lv) { W.sgl[j] = lv; W.skind[j] = ki; grow[j] = 1; }
        if (lv === 1) { W.ground[j] = AB.G_SITE; reserved[j] = 1; }
        else if (d < GR[0] + 0.6) reserved[j] = 1;
        else if (d < SRmax + 1.5) grow[j] = 1;
      }
    });
    // кольцо сплошного леса вокруг скрытых логов
    const ring = new Uint8Array(N * N);
    W.sites.forEach((s) => {
      if (!s.hidden) return;
      const R0 = SRmax + 1.5, R1 = R0 + cfg.HIDDEN_RING;
      for (let y = Math.floor(s.ty - R1 - 1); y <= s.ty + R1 + 1; y++) for (let x = Math.floor(s.tx - R1 - 1); x <= s.tx + R1 + 1; x++) {
        if (!inb(x, y)) continue;
        const d = Math.hypot(x - s.tx, y - s.ty);
        if (d >= R0 && d < R1 && !reserved[idx(x, y)]) ring[idx(x, y)] = 1;
      }
    });

    // ---- поселения в каждой стороне света: поляна, дорога к лагерю, постройки, вечный костёр, торговцы
    W.towns = [];
    if (W.core < N && cfg.TOWNS) {
      const dist = HALF + (N / 2 - HALF) * 0.5;
      [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]].forEach(([key, ux, uy], ti) => {
        const TW = cfg.TOWNS[key]; if (!TW) return;
        const side = (r() - 0.5) * 18;
        const tx = Math.round(cx + ux * dist + uy * side), ty = Math.round(cy + uy * dist + ux * side);
        const town = { id: ti, key, name: TW.name, tx, ty, x: tx * T + T / 2, y: ty * T + T / 2, r: cfg.TOWN_RADIUS * T, traders: [] };
        W.towns.push(town);
        const TR = cfg.TOWN_RADIUS;
        for (let y = ty - TR - 2; y <= ty + TR + 2; y++) for (let x = tx - TR - 2; x <= tx + TR + 2; x++) {
          if (!inb(x, y)) continue;
          const d = Math.hypot(x - tx, y - ty) + (AB.noise(x * 0.4, y * 0.4, seed + 64) - 0.5) * 2.5;
          if (d < TR) { W.ground[idx(x, y)] = AB.G_CAMP; reserved[idx(x, y)] = 1; } else if (d < TR + 2) reserved[idx(x, y)] = 1;
        }
        // дорога от лагеря
        const steps = Math.ceil(Math.hypot(tx - cx, ty - cy) * 2);
        const nx = -(ty - cy), ny = tx - cx, nl = Math.hypot(nx, ny) || 1;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, wob = (AB.fbm(t * 5, ti * 7.3, seed + 66, 3) - 0.5) * 22 * Math.sin(t * Math.PI);
          const px = cx + (tx - cx) * t + (nx / nl) * wob, py = cy + (ty - cy) * t + (ny / nl) * wob;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const x = Math.round(px + ox * 0.7), y = Math.round(py + oy * 0.7);
            if (!inb(x, y)) continue;
            const i2 = idx(x, y);
            if (W.ground[i2] === AB.G_GRASS) W.ground[i2] = AB.G_PATH;
            reserved[i2] = 1;
          }
        }
      });
    }

    // ---- тропинки от лагеря к локациям
    W.sites.forEach((s, si) => {
      if (s.hidden) return; // к скрытым логовам тропы нет
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
      if (reserved[i] || ring[i] || grow[i] || edge < cfg.BORDER_TILES + 1) continue;
      const w = AB.fbm(x / 20, y / 20, seed + 202, 4), B = bdef(i);
      const wl = B ? AB.lerp(cfg.WATER_LEVEL, B.water, W.bmix[i]) : cfg.WATER_LEVEL;
      if (w > wl) { W.ground[i] = AB.G_WATER; W.solid[i] = AB.S_WATER; }
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
      if (ring[i]) { addTree(x, y, px, py, false); continue; }
      if (reserved[i]) continue;
      const B = bdef(i), bm = B ? W.bmix[i] : 0;
      let dens = cfg.TREE_DENSITY * (0.25 + 1.9 * Math.pow(W.forest[i], 1.6));
      // чаща: почти сплошной лес (в степи и на холмах её нет)
      const TH = cfg.THICKET;
      if (TH && AB.fbm(x / TH.scale, y / TH.scale, seed + 303, 3) > TH.level && !(B && B.treeK < 0.5 && bm > 0.4)) dens = Math.max(dens, TH.density);
      if (B) dens *= AB.lerp(1, B.treeK, bm);
      const rockD = cfg.ROCK_DENSITY * (B ? AB.lerp(1, B.rockK, bm) : 1), bushD = cfg.BUSH_DENSITY * (B ? AB.lerp(1, B.bushK, bm) : 1);
      if (h < dens) addTree(x, y, px, py, false);
      else if (grow[i]) continue; // на земле, куда вырастет поляна, — только деревья
      else if (h < dens + rockD) {
        W.rockAt[i] = W.rocks.length;
        W.rocks.push({ x: px, y: py, tx: x, ty: y, v: Math.floor(AB.hash2(x, y, seed + 10) * 3), s: 0.8 + AB.hash2(x, y, seed + 11) * 0.5, kind: 'rock' });
        W.solid[i] = AB.S_ROCK;
      } else if (h < dens + rockD + bushD) {
        W.bushes.push({ id: W.bushes.length, x: px, y: py, berries: 1, t: 0 });
      }
    }
    function addTree(x, y, px, py, border) {
      const i = idx(x, y);
      let v = Math.floor(AB.hash2(x, y, seed + 12) * 6);
      const bi = W.biome[i];
      if (bi && W.bmix[i] > AB.hash2(x, y, seed + 14)) { const L = cfg.BIOMES[BKEYS[bi]].trees; v = L[Math.floor(AB.hash2(x, y, seed + 15) * L.length) % L.length]; }
      else if (wg >= 2) { // рощи пятнами: берёзовые (12, 13) и сосновые боры (14, 15)
        if (AB.noise(x * GROVE.scale, y * GROVE.scale, seed + 101) > GROVE.birch) v = 12 + Math.floor(AB.hash2(x, y, seed + 16) * 2);
        else if (AB.noise(x * GROVE.scale * 0.9, y * GROVE.scale * 0.9, seed + 202) > GROVE.pine) v = 14 + Math.floor(AB.hash2(x, y, seed + 17) * 2);
      }
      W.treeAt[i] = W.trees.length;
      W.trees.push({ id: W.trees.length, x: px, y: py, tx: x, ty: y, v, s: 0.85 + AB.hash2(x, y, seed + 13) * 0.4, hp: cfg.TREE_HP, dead: false, regrow: 0, shake: 0, border });
      W.solid[i] = AB.S_TREE;
    }

    // ---- цветущий луг в сердцевине берёзовых рощ (генератор v2): деревья там «убраны», как на полянах локаций -
    //      номера деревьев не меняются, сохранения не съезжают; на лугу цветы и не прорастают побеги
    W.meadow = new Uint8Array(N * N);
    if (wg >= 2) for (let y = cfg.BORDER_TILES; y < N - cfg.BORDER_TILES; y++) for (let x = cfg.BORDER_TILES; x < N - cfg.BORDER_TILES; x++) {
      const i = idx(x, y);
      if (W.ground[i] !== AB.G_GRASS || reserved[i] || W.biome[i] && W.bmix[i] > 0.3) continue;
      if (AB.noise(x * GROVE.scale, y * GROVE.scale, seed + 101) < GROVE.meadow) continue;
      const ti = W.treeAt[i];
      if (ti >= 0) { const t = W.trees[ti]; t.gone = true; t.dead = true; W.treeAt[i] = -1; W.solid[i] = AB.S_NONE; }
      W.meadow[i] = 1;
      if (AB.hash2(x, y, seed + 18) < 0.55) W.decor.push({ x: x * T + T / 2 + (AB.hash2(x, y, seed + 19) - 0.5) * 12, y: y * T + T / 2 + (AB.hash2(x, y, seed + 20) - 0.5) * 12, kind: 'flowers', v: AB.hash2(x, y, seed + 21), lv: 0 });
    }

    // ---- убранство локаций: у каждого вида своё. lv — с какого уровня костра предмет появляется
    //      (локация растёт вместе с костром: новые предметы встают на отвоёванной у леса земле)
    const PROPS = {
      ruins:     { core: [], ring: ['rubble', 'crate', 'ruinD', 'bones'] },
      bandits:   { core: [['btent', -58, -40], ['btent', 52, -46], ['bfire', 0, 44], ['barrel', 40, 30]], ring: ['palisade', 'btent', 'barrel', 'sack', 'wanted', 'palisade'] },
      ufo:       { core: [['saucer', 0, -62, 46], ['crater', 0, -50]], ring: ['crystal', 'debris', 'crystal', 'debris'] },
      graveyard: { core: [['skull', -52, -30], ['grave', 40, -44], ['grave', 58, 10], ['ribcage', -40, 36]], ring: ['grave', 'bonepile', 'grave', 'skull'] },
      witch:     { core: [['hut', 0, -64, 40], ['cauldron', 46, 20]], ring: ['jack', 'totem', 'jack', 'herbs'] },
      mushrooms: { core: [['gmush', -60, -42], ['gmush', 56, -54], ['fring', 0, 4], ['smush', 34, 40], ['mlog', -44, 46], ['glowcap', 64, 8]], ring: ['gmush', 'glowcap', 'smush', 'puffball', 'shelf', 'gmush', 'glowcap', 'puffball'] },
      bears:     { core: [['den', 0, -66, 44], ['fishbones', -36, 30]], ring: ['hive', 'logpile', 'fishbones', 'hive'] },
    };
    W.sites.forEach((s) => {
      const P = PROPS[s.kind] || PROPS.ruins;
      if (s.kind === 'ruins') {
        // каменные обломки по кругу (как раньше) + следы разграбленного лагеря
        const cnt = 5 + s.tier;
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * Math.PI * 2 + r() * 0.4;
          const d = (GR[0] - 1.2) * T;
          const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
          const tx = Math.floor(x / T), ty = Math.floor(y / T), i = idx(tx, ty);
          if (r() < 0.75) {
            W.rockAt[i] = W.rocks.length;
            W.rocks.push({ x, y, tx, ty, v: Math.floor(r() * 3), s: 1, kind: 'ruin', broken: r() });
            W.solid[i] = AB.S_ROCK;
          } else W.decor.push({ x, y, kind: 'rubble', v: r(), lv: 1 });
        }
        W.decor.push({ x: s.x + 30, y: s.y + 22, kind: 'bones', v: r(), lv: 1 });
        for (let k = 0; k < 2 + (s.tier >> 1); k++) { const a = r() * Math.PI * 2, d = 40 + r() * 40; W.decor.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d * 0.7, kind: 'crate', v: r(), lv: 1 }); }
      }
      for (const c of P.core) {
        const x = s.x + c[1], y = s.y + c[2];
        W.decor.push({ x, y, kind: c[0], v: r(), lv: 1, site: s.id });
        if (c[3]) W.blockers.push({ x, y: y - 6, r: c[3] });
      }
      // кольца предметов для 2-го, 3-го и 4-го уровня костра
      for (let L = 2; L <= GR.length; L++) {
        const cnt = 3 + L + (s.tier >> 1);
        const rin = (GR[L - 2] + 0.3) * T, rout = (GR[L - 1] - 0.6) * T;
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * Math.PI * 2 + r() * 0.5 + L;
          const d = rin + r() * Math.max(4, rout - rin);
          const kind = P.ring[(k + L) % P.ring.length];
          W.decor.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, kind, v: r(), lv: L, site: s.id, a });
        }
      }
    });

    // ---- лагерь: костёр
    W.fires.push({ x: W.camp.x, y: W.camp.y, main: true });
    // декор лагеря
    W.decor.push({ x: W.camp.x - 80, y: W.camp.y - 50, kind: 'tent', v: 0 });
    W.decor.push({ x: W.camp.x + 30, y: W.camp.y + 70, kind: 'stump_seat', v: 0 });
    W.decor.push({ x: W.camp.x - 30, y: W.camp.y + 50, kind: 'stump_seat', v: 1 });
    W.decor.push({ x: W.camp.x + 10, y: W.camp.y - 150, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x - 150, y: W.camp.y + 10, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x + 170, y: W.camp.y + 40, kind: 'torch', v: 0 });
    W.decor.push({ x: W.camp.x + 20, y: W.camp.y + 150, kind: 'torch', v: 0 });

    // ---- постройки поселений (у каждого поселения свой набор), вечный костёр и торговцы
    const LAYOUT = {
      north: [['izba', -150, -90, 46], ['izba', 110, -110, 46], ['izba', -170, 90, 46], ['well', 60, 140, 16], ['woodpile', -60, -140, 0], ['sled', 160, 20, 0], ['snowman', -40, 150, 0]],
      east:  [['tipi', -140, -80, 32], ['tipi', 120, -100, 32], ['tipi', -150, 100, 32], ['tipi', 150, 110, 32], ['rack', 0, -150, 0], ['totemT', 40, 150, 10], ['drum', -40, -80, 0]],
      south: [['treehouse', -150, -90, 34], ['treehouse', 140, -80, 34], ['treehouse', -120, 120, 34], ['stilthut', 150, 120, 28], ['boardwalk', 0, 60, 0], ['lanterns', 0, -150, 0]],
      west:  [['stonehouse', -150, -100, 44], ['stonehouse', 140, -110, 44], ['stonehouse', -150, 110, 44], ['stonetower', 170, 120, 26], ['fountain', 0, -150, 22], ['stall', -40, 150, 0], ['citywall', 0, 0, 0]],
    };
    W.towns.forEach((town) => {
      const TW = cfg.TOWNS[town.key];
      W.fires.push({ x: town.x, y: town.y, main: false, town: town.id });
      (LAYOUT[town.key] || []).forEach(([kind, ox, oy, br]) => {
        if (kind === 'citywall') { // обрывки городской стены по кругу с проходами
          const R0 = (cfg.TOWN_RADIUS - 1) * T;
          for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2 + 0.2; if (k % 4 === 0) continue; W.decor.push({ x: town.x + Math.cos(a) * R0, y: town.y + Math.sin(a) * R0 * 0.9, kind: 'wallseg', v: r(), a, town: town.id }); W.blockers.push({ x: town.x + Math.cos(a) * R0, y: town.y + Math.sin(a) * R0 * 0.9 - 6, r: 18 }); }
          return;
        }
        W.decor.push({ x: town.x + ox, y: town.y + oy, kind, v: r(), town: town.id });
        if (br) W.blockers.push({ x: town.x + ox, y: town.y + oy - 8, r: br });
      });
      TW.traders.forEach((tr, k) => {
        town.traders.push({ id: town.id * 10 + k, town: town.id, role: tr.role, name: tr.name, look: tr.look, x: town.x + (k === 0 ? -110 : 100), y: town.y - 20 });
      });
    });

    // ---- залежи камня и железа в дальних участках леса (добываются киркой)
    W.ores = [];
    const ORES = cfg.ORES || {};
    const maxR = N / 2 - cfg.BORDER_TILES - 3;
    for (const kind of Object.keys(ORES)) {
      const O = ORES[kind];
      let placed = 0, tries2 = 0;
      const want = Math.round(O.count * (maxR * maxR) / Math.max(1, (Math.min(N, W.core) / 2 - 7) ** 2) * 0.6 + O.count * 0.4); // карта больше — залежей больше
      while (placed < want && tries2++ < 12000) {
        const a = r() * Math.PI * 2, d = r.range(O.minDist, maxR);
        const tx = Math.round(cx + Math.cos(a) * d), ty = Math.round(cy + Math.sin(a) * d);
        if (!inb(tx, ty)) continue;
        let ok = true;
        for (let y = ty - 1; y <= ty + 1 && ok; y++) for (let x = tx - 1; x <= tx + 1; x++) {
          if (!inb(x, y)) { ok = false; break; }
          const j = idx(x, y);
          if (W.ground[j] !== AB.G_GRASS || W.treeAt[j] >= 0 || W.rockAt[j] >= 0 || reserved[j] || ring[j] || grow[j]) { ok = false; break; }
        }
        if (!ok || W.ores.some(o => Math.abs(o.tx - tx) + Math.abs(o.ty - ty) < 6)) continue;
        const i = idx(tx, ty);
        const o = { id: W.ores.length, x: tx * T + T / 2, y: ty * T + T / 2 + 4, tx, ty, v: Math.floor(r() * 3), s: 1, kind: 'ore', ore: kind, hp: cfg.ORE_HITS, dead: false, regrow: 0, shake: 0 };
        W.rockAt[i] = W.rocks.length; W.rocks.push(o); W.ores.push(o);
        W.solid[i] = AB.S_ROCK;
        // ягодные кусты на месте залежи убираем
        for (let k = W.bushes.length - 1; k >= 0; k--) if (Math.abs(W.bushes[k].x - o.x) < T && Math.abs(W.bushes[k].y - o.y) < T) W.bushes[k].x = -9999;
        placed++;
      }
    }
    // ---- в Каменных холмах залежей больше, и железо встречается чаще
    if (W.core < N) {
      let placed = 0, tries3 = 0;
      while (placed < 18 && tries3++ < 6000) {
        const tx = Math.floor(r() * N), ty = Math.floor(r() * N), i = idx(tx, ty);
        if (W.biome[i] !== 4 || W.bmix[i] < 0.8 || W.ground[i] !== AB.G_GRASS || W.treeAt[i] >= 0 || W.rockAt[i] >= 0 || reserved[i]) continue;
        if (W.ores.some(o => Math.abs(o.tx - tx) + Math.abs(o.ty - ty) < 5)) continue;
        const kind = r() < 0.55 ? 'iron' : 'stone';
        const o = { id: W.ores.length, x: tx * T + T / 2, y: ty * T + T / 2 + 4, tx, ty, v: Math.floor(r() * 3), s: 1, kind: 'ore', ore: kind, hp: cfg.ORE_HITS, dead: false, regrow: 0, shake: 0 };
        W.rockAt[i] = W.rocks.length; W.rocks.push(o); W.ores.push(o); W.solid[i] = AB.S_ROCK;
        placed++;
      }
    }
    return W;
  };

  // Рост локаций: при уровне костра lv поляны расширяются — деревья на новой земле исчезают, земля становится площадкой.
  // Возвращает список изменённых тайлов (для перерисовки земли и миникарты).
  AB.growSites = function (W, lv) {
    if (!W.sgl) return [];
    const done = W.grownLv || 1;
    if (lv <= done) return [];
    const changed = [];
    for (let i = 0; i < W.sgl.length; i++) {
      const g = W.sgl[i];
      if (!g || g <= done || g > lv) continue;
      if (W.ground[i] === AB.G_WATER) continue;
      W.ground[i] = AB.G_SITE;
      const ti = W.treeAt[i];
      if (ti >= 0) { const t = W.trees[ti]; t.gone = true; t.dead = true; W.treeAt[i] = -1; if (W.solid[i] === AB.S_TREE) W.solid[i] = AB.S_NONE; }
      changed.push(i);
    }
    W.grownLv = lv;
    return changed;
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
    // крупные предметы локаций (тарелка, избушка, берлога)
    for (const b of AB.blockersNear(W, x, y)) {
      const dx = x - b.x, dy = y - b.y, m = rad + b.r;
      if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
      const d = Math.hypot(dx, dy);
      if (d < m) { if (d > 0.001) { x = b.x + (dx / d) * m; y = b.y + (dy / d) * m; } else y = b.y + m; }
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

  // Сетка крупных препятствий: столкновения проверяют только ближайшие, а не все сотни на карте
  const BG = 128, BG_M = 72;
  const NONE = [];
  AB.blockersNear = function (W, x, y) {
    const bl = W.blockers;
    if (!bl || !bl.length) return NONE;
    let g = W._bgrid;
    if (!g || g.n !== bl.length) {
      g = W._bgrid = { n: bl.length, m: new Map() };
      for (const b of bl) {
        const r = b.r + BG_M;
        for (let cy = Math.floor((b.y - r) / BG); cy <= Math.floor((b.y + r) / BG); cy++)
          for (let cx = Math.floor((b.x - r) / BG); cx <= Math.floor((b.x + r) / BG); cx++) {
            const k = cy * 65536 + cx; let a = g.m.get(k); if (!a) g.m.set(k, a = []); a.push(b);
          }
      }
    }
    return g.m.get(Math.floor(y / BG) * 65536 + Math.floor(x / BG)) || NONE;
  };

  // Можно ли тут стоять (для появления монстров и построек)
  AB.freeSpot = function (W, x, y, rad) {
    const T = W.T;
    for (const b of (rad < BG_M ? AB.blockersNear(W, x, y) : (W.blockers || []))) if (AB.dist2(x, y, b.x, b.y) < (rad + b.r) ** 2) return false;
    for (let ty = Math.floor((y - rad) / T); ty <= Math.floor((y + rad) / T); ty++)
      for (let tx = Math.floor((x - rad) / T); tx <= Math.floor((x + rad) / T); tx++) {
        const s = AB.tileSolid(W, tx, ty);
        if (s === AB.S_WATER || s === AB.S_ROCK) return false;
        if (s === AB.S_TREE) { const t = W.trees[W.treeAt[ty * W.N + tx]]; if (t && !t.dead) return false; }
      }
    return true;
  };
})(window.AB);
