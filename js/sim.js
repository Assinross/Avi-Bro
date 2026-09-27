// Игровая логика. Выполняется у одиночного игрока и у ХОСТА (гость получает готовое состояние).
(function (AB) {
  const C = () => window.CONFIG;
  const MON_TYPES = ['wolf', 'ghoul', 'shade', 'brute', 'alpha'];
  AB.MON_TYPES = MON_TYPES;
  const ITEM_KEYS = ['wood', 'meat', 'berry', 'carrot', 'pumpkin', 'seed_carrot', 'seed_pumpkin'];
  AB.ITEM_KEYS = ITEM_KEYS;

  const Sim = AB.Sim = {};

  Sim.create = function (seed, mode) {
    const cfg = C();
    const W = AB.generateWorld(seed);
    const G = {
      seed, W, mode, clock: 0, day: 1, isNight: false, nightF: 0,
      players: [], monsters: [], projs: [], drops: [],
      plots: W.plots.map((p, i) => ({ id: i, x: p.x, y: p.y, crop: null, t: 0, ready: false })),
      fires: W.fires.map((f, i) => ({ id: i, x: f.x, y: f.y, fuel: cfg.FIRE_FUEL_START, main: f.main })),
      nextId: 1, spawnT: 2, fxOut: [], treeDirty: new Set(), bushDirty: new Set(),
      over: null, stats: { kills: 0 },
    };
    // Стражи локаций
    if (mode !== 'guest') {
      W.sites.forEach((s) => {
        s.guards.forEach((type, k) => {
          const a = (k / s.guards.length) * Math.PI * 2;
          const m = Sim.spawnMonster(G, type, s.x + Math.cos(a) * 55, s.y + Math.sin(a) * 55, true);
          m.home = { x: s.x, y: s.y }; m.site = s.id;
        });
      });
    }
    return G;
  };

  Sim.addPlayer = function (G, id, name) {
    const cfg = C();
    const p = {
      id, name, x: G.W.camp.x + (id ? 28 : -28), y: G.W.camp.y + 100, a: 0,
      hp: cfg.PLAYER_MAX_HP, food: cfg.PLAYER_MAX_FOOD, dead: false, rs: 0,
      w: cfg.START_WEAPON, ws: [cfg.START_WEAPON], inv: {},
      atkCd: 0, chopCd: 0, feedCd: 0, sw: 0, sk: 'axe', sa: 0, tp: 0, hurt: 0,
    };
    ITEM_KEYS.forEach(k => p.inv[k] = cfg.START_ITEMS[k] || 0);
    G.players.push(p);
    return p;
  };

  Sim.fx = function (G, ev) {
    G.fxOut.push(ev);
    if (AB.FX) AB.FX.play(ev);
  };
  Sim.msg = function (G, text, pid, color) { Sim.fx(G, { k: 'msg', s: text, p: pid === undefined ? -1 : pid, c: color || '#ffe7a8' }); };

  Sim.scale = function (G) { return 1 + (G.day - 1) * C().MONSTER_SCALE_PER_NIGHT; };

  Sim.spawnMonster = function (G, type, x, y, guard) {
    const def = C().MONSTERS[type];
    const sc = guard ? 1 : Sim.scale(G);
    const m = {
      id: G.nextId++, type, x, y, a: Math.random() * 6.28, hp: def.hp * sc, maxHp: def.hp * sc,
      dmg: def.damage * sc, speed: def.speed * (0.92 + Math.random() * 0.16), r: def.radius,
      st: 'idle', guard: !!guard, hunter: false, home: { x, y }, atkCd: 0, hurt: 0,
      wT: Math.random() * 3, wx: x, wy: y, stuck: 0, side: Math.random() < 0.5 ? 1 : -1, vx: 0, vy: 0,
      dying: 0,
    };
    G.monsters.push(m);
    return m;
  };

  // ---------- Время суток ----------
  Sim.timeInfo = function (clock) {
    const cfg = C();
    const cyc = cfg.DAY_LENGTH + cfg.NIGHT_LENGTH;
    const day = Math.floor(clock / cyc) + 1;
    const ph = clock % cyc;
    const isNight = ph >= cfg.DAY_LENGTH;
    let nightF = 0;
    if (!isNight) {
      if (ph > cfg.DAY_LENGTH - cfg.DUSK_LENGTH) nightF = AB.smooth((ph - (cfg.DAY_LENGTH - cfg.DUSK_LENGTH)) / cfg.DUSK_LENGTH);
    } else {
      const nt = ph - cfg.DAY_LENGTH;
      nightF = nt > cfg.NIGHT_LENGTH - cfg.DAWN_LENGTH ? 1 - AB.smooth((nt - (cfg.NIGHT_LENGTH - cfg.DAWN_LENGTH)) / cfg.DAWN_LENGTH) : 1;
    }
    const phaseLeft = isNight ? cyc - ph : cfg.DAY_LENGTH - ph;
    const phaseFrac = isNight ? (ph - cfg.DAY_LENGTH) / cfg.NIGHT_LENGTH : ph / cfg.DAY_LENGTH;
    return { day, isNight, nightF, phaseLeft, phaseFrac };
  };

  // Радиус видимости (туман) для экрана w×h
  AB.visionRadius = function (w, h, nightF) {
    const cfg = C();
    const cover = AB.lerp(cfg.FOG_DAY_COVER, cfg.FOG_NIGHT_COVER, nightF);
    return Math.sqrt(((1 - cover) * w * h) / Math.PI);
  };

  // ---------- Движение игрока (общая функция для хоста и гостя) ----------
  AB.movePlayer = function (W, p, dx, dy, dt) {
    if (p.dead) return;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) { p.moving = false; return; }
    const sp = C().PLAYER_SPEED;
    const nx = p.x + (dx / len) * sp * dt, ny = p.y + (dy / len) * sp * dt;
    const r = AB.resolveCollision(W, nx, ny, C().PLAYER_RADIUS);
    p.x = r[0]; p.y = r[1]; p.moving = true;
  };

  // ---------- Основное обновление ----------
  Sim.update = function (G, dt) {
    if (G.over) return;
    const cfg = C();
    const prevNight = G.isNight, prevDay = G.day;
    G.clock += dt;
    const ti = Sim.timeInfo(G.clock);
    G.day = ti.day; G.isNight = ti.isNight; G.nightF = ti.nightF;
    if (ti.isNight && !prevNight) {
      Sim.msg(G, `Ночь ${G.day}. Держитесь у костра!`, -1, '#9fb8ff');
      Sim.fx(G, { k: 'snd', s: 'night' });
      G.monsters.forEach(m => { if (!m.guard) m.hunter = true; });
    }
    if (!ti.isNight && prevNight) {
      if (prevDay >= cfg.NIGHTS_TO_WIN) { G.over = 'win'; Sim.fx(G, { k: 'over', s: 'win' }); return; }
      Sim.msg(G, `Рассвет! Пережито ночей: ${prevDay} из ${cfg.NIGHTS_TO_WIN}`, -1, '#ffd98a');
      G.monsters.forEach(m => { m.hunter = false; if (m.type === 'shade') m.dying = 1.2; });
    }

    updatePlayers(G, dt);
    updateMonsters(G, dt);
    updateProjectiles(G, dt);
    updateDrops(G, dt);
    updateWorld(G, dt);
    spawnLogic(G, dt);

    // проигрыш
    if (G.players.length && G.players.every(p => p.dead)) {
      G.over = 'lose'; Sim.fx(G, { k: 'over', s: 'lose' });
    }
  };

  function alivePlayers(G) { return G.players.filter(p => !p.dead); }

  function nearestPlayer(G, x, y) {
    let best = null, bd = Infinity;
    for (const p of G.players) {
      if (p.dead) continue;
      const d = AB.dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: Math.sqrt(bd) } : null;
  }

  function giveItem(G, p, k, n) {
    if (C().WEAPONS[k]) {
      if (!p.ws.includes(k)) {
        p.ws.push(k);
        const order = C().WEAPON_ORDER;
        p.ws.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        p.w = k;
        return true;
      }
      return false;
    }
    p.inv[k] = (p.inv[k] || 0) + n;
    return true;
  }

  Sim.dropItem = function (G, k, n, x, y, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (spread || 18) * (0.4 + Math.random());
      G.drops.push({ id: G.nextId++, k, x: x + Math.cos(a) * s, y: y + Math.sin(a) * s, t: 0, age: 0 });
    }
  };

  // ---------- Игроки ----------
  function updatePlayers(G, dt) {
    const cfg = C();
    for (const p of G.players) {
      p.sw = Math.max(0, p.sw - dt);
      p.hurt = Math.max(0, p.hurt - dt);
      if (p.dead) {
        if (G.players.some(o => !o.dead)) {
          p.rs -= dt;
          if (p.rs <= 0) {
            p.dead = false; p.hp = cfg.RESPAWN_HP; p.food = Math.max(p.food, 40);
            const f = G.fires[0];
            p.x = f.x + 20; p.y = f.y + 40; p.tp++;
            Sim.msg(G, `${p.name} вернулся в лагерь`, -1);
          }
        }
        continue;
      }
      // голод и регенерация
      p.food = Math.max(0, p.food - cfg.FOOD_DRAIN * dt);
      if (p.food <= 0) damagePlayer(G, p, cfg.STARVE_DAMAGE * dt, true);
      else if (p.food > cfg.REGEN_FOOD_MIN) p.hp = Math.min(cfg.PLAYER_MAX_HP, p.hp + cfg.HP_REGEN * dt);
      if (p.food < 20 && !p._hungryWarn) { p._hungryWarn = true; Sim.msg(G, 'Вы голодны! Нажмите E, чтобы поесть', p.id, '#ffb36b'); }
      if (p.food > 30) p._hungryWarn = false;

      // костры: лечение и подкидывание дров
      p.feedCd -= dt;
      for (const f of G.fires) {
        const d = AB.dist(p.x, p.y, f.x, f.y);
        if (f.fuel > 0 && d < cfg.FIRE_HEAL_RADIUS) p.hp = Math.min(cfg.PLAYER_MAX_HP, p.hp + cfg.FIRE_HEAL * dt);
        if (d < cfg.FIRE_FEED_RADIUS && f.fuel < cfg.FIRE_FUEL_MAX * cfg.FIRE_FEED_BELOW && p.inv.wood > 0 && p.feedCd <= 0) {
          p.inv.wood--; f.fuel = Math.min(cfg.FIRE_FUEL_MAX, f.fuel + cfg.FUEL_PER_WOOD); p.feedCd = 0.4;
          Sim.fx(G, { k: 'feed', x: f.x, y: f.y });
        }
      }

      autoActions(G, p, dt);
    }
  }

  function autoActions(G, p, dt) {
    const cfg = C(), W = G.W;
    p.atkCd -= dt; p.chopCd -= dt;
    const wdef = cfg.WEAPONS[p.w] || cfg.WEAPONS.knife;
    // 1) атака ближайшего монстра в радиусе оружия
    let target = null, td = Infinity;
    for (const m of G.monsters) {
      if (m.dying) continue;
      const d = AB.dist(p.x, p.y, m.x, m.y) - m.r;
      if (d < wdef.range && d < td) { td = d; target = m; }
    }
    if (target) {
      if (p.atkCd <= 0) {
        p.atkCd = wdef.cooldown;
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        p.sw = wdef.type === 'melee' ? 0.25 : 0.15; p.sk = p.w; p.sa = ang;
        if (wdef.type === 'melee') {
          const half = (wdef.arc * Math.PI / 180) / 2;
          for (const m of G.monsters.slice()) {
            if (m.dying) continue;
            const d = AB.dist(p.x, p.y, m.x, m.y) - m.r;
            if (d > wdef.range) continue;
            const am = Math.atan2(m.y - p.y, m.x - p.x);
            if (m === target || Math.abs(AB.angDiff(ang, am)) < half) damageMonster(G, m, wdef.damage, p, am);
          }
          Sim.fx(G, { k: 'swing', x: p.x, y: p.y, a: ang, w: p.w });
        } else {
          // упреждение
          const dist = AB.dist(p.x, p.y, target.x, target.y);
          const tt = dist / wdef.projSpeed;
          const ax = target.x + target.vx * tt, ay = target.y + target.vy * tt;
          const a2 = Math.atan2(ay - p.y, ax - p.x);
          G.projs.push({
            id: G.nextId++, k: p.w, x: p.x + Math.cos(a2) * 14, y: p.y + Math.sin(a2) * 14,
            vx: Math.cos(a2) * wdef.projSpeed, vy: Math.sin(a2) * wdef.projSpeed,
            dmg: wdef.damage, life: (wdef.range * 1.3) / wdef.projSpeed, pierce: wdef.pierce || 1, hit: [], owner: p.id,
          });
          Sim.fx(G, { k: 'shoot', x: p.x, y: p.y, a: a2, w: p.w });
        }
      }
      return;
    }
    // 2) рубка ближайшего дерева
    if (p.chopCd <= 0) {
      const T = W.T, tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      let tree = null, bd = Infinity;
      for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
        if (x < 0 || y < 0 || x >= W.N || y >= W.N) continue;
        const ti = W.treeAt[y * W.N + x];
        if (ti < 0) continue;
        const t = W.trees[ti];
        if (t.dead) continue;
        const d = AB.dist(p.x, p.y, t.x, t.y) - cfg.PLAYER_RADIUS - 9 * t.s;
        if (d < cfg.AXE_RANGE && d < bd) { bd = d; tree = t; }
      }
      if (tree) {
        p.chopCd = cfg.AXE_COOLDOWN;
        p.sw = 0.3; p.sk = 'axe'; p.sa = Math.atan2(tree.y - p.y, tree.x - p.x);
        tree.hp--; tree.shake = 0.35;
        G.treeDirty.add(tree.id);
        Sim.fx(G, { k: 'chop', x: tree.x, y: tree.y - 10, id: tree.id });
        if (tree.hp <= 0) {
          tree.dead = true; tree.regrow = cfg.TREE_REGROW_TIME;
          Sim.dropItem(G, 'wood', cfg.WOOD_PER_TREE, tree.x, tree.y, 16);
          Sim.fx(G, { k: 'fell', x: tree.x, y: tree.y, v: tree.v });
        }
      }
    }
    // 3) сбор ягод
    for (const b of W.bushes) {
      if (b.berries > 0 && AB.dist2(p.x, p.y, b.x, b.y) < 30 * 30) {
        b.berries = 0; b.t = cfg.BERRY_REGROW_TIME; G.bushDirty.add(b.id);
        Sim.dropItem(G, 'berry', cfg.BERRIES_PER_BUSH, b.x, b.y, 14);
        Sim.fx(G, { k: 'rustle', x: b.x, y: b.y });
      }
    }
    // 4) урожай
    for (const pl of G.plots) {
      if (pl.ready && AB.dist2(p.x, p.y, pl.x, pl.y) < 34 * 34) {
        const cd = cfg.CROPS[pl.crop];
        const n = cd.yield[0] + Math.floor(Math.random() * (cd.yield[1] - cd.yield[0] + 1));
        Sim.dropItem(G, pl.crop, n, pl.x, pl.y, 14);
        Sim.msg(G, `Урожай: ${cd.name} ×${n}`, p.id, '#b8f28a');
        Sim.fx(G, { k: 'rustle', x: pl.x, y: pl.y });
        pl.crop = null; pl.ready = false; pl.t = 0;
      }
    }
    // 5) сундуки
    for (const s of W.sites) {
      if (s.opened || AB.dist2(p.x, p.y, s.x, s.y) > cfg.CHEST_OPEN_RADIUS * cfg.CHEST_OPEN_RADIUS) continue;
      s.opened = true;
      Sim.fx(G, { k: 'chest', x: s.x, y: s.y, id: s.id });
      const found = [];
      if (s.weapon) {
        let got = giveItem(G, p, s.weapon);
        if (!got) { const o = G.players.find(q => q !== p && !q.ws.includes(s.weapon)); if (o) { giveItem(G, o, s.weapon); Sim.msg(G, `${p.name} передал вам: ${cfg.WEAPONS[s.weapon].name}`, o.id, '#ffd24a'); } }
        found.push(cfg.WEAPONS[s.weapon].name);
      }
      for (const k in s.loot) { Sim.dropItem(G, k, s.loot[k], s.x, s.y + 14, 26); found.push(`${AB.itemName(k)} ×${s.loot[k]}`); }
      Sim.msg(G, `Сундук открыт: ${found.join(', ')}`, -1, '#ffd24a');
    }
  }

  function damagePlayer(G, p, dmg, silent) {
    if (p.dead) return;
    p.hp -= dmg;
    if (!silent) { p.hurt = 0.3; Sim.fx(G, { k: 'phit', x: p.x, y: p.y, pid: p.id, n: Math.round(dmg) }); }
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; p.rs = C().RESPAWN_TIME;
      Sim.fx(G, { k: 'pdie', x: p.x, y: p.y, pid: p.id });
      if (G.players.length > 1 && G.players.some(o => !o.dead)) Sim.msg(G, `${p.name} погиб! Возрождение через ${C().RESPAWN_TIME} с`, -1, '#ff8a8a');
    }
  }

  function damageMonster(G, m, dmg, p, ang) {
    if (m.dying) return;
    m.hp -= dmg; m.hurt = 0.15;
    if (!m.hunter && m.st !== 'return') m.st = 'chase';
    const kb = m.type === 'brute' ? 3 : 9;
    const r = AB.resolveCollision(G.W, m.x + Math.cos(ang) * kb, m.y + Math.sin(ang) * kb, m.r);
    m.x = r[0]; m.y = r[1];
    Sim.fx(G, { k: 'hit', x: m.x, y: m.y, n: Math.round(dmg), t: m.type });
    if (m.hp <= 0) killMonster(G, m, true);
  }

  function killMonster(G, m, loot) {
    const def = C().MONSTERS[m.type];
    m.dying = 0.001; m.dead = true;
    G.monsters.splice(G.monsters.indexOf(m), 1);
    Sim.fx(G, { k: 'die', x: m.x, y: m.y, t: m.type });
    if (!loot) return;
    G.stats.kills++;
    const meat = def.meat[0] + Math.floor(Math.random() * (def.meat[1] - def.meat[0] + 1));
    if (meat > 0) Sim.dropItem(G, 'meat', meat, m.x, m.y, 12);
    if (Math.random() < def.seedChance) Sim.dropItem(G, Math.random() < 0.7 ? 'seed_carrot' : 'seed_pumpkin', 1, m.x, m.y, 12);
  }

  // ---------- Монстры ----------
  function updateMonsters(G, dt) {
    const cfg = C(), W = G.W;
    const list = G.monsters;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const def = cfg.MONSTERS[m.type];
      m.hurt = Math.max(0, m.hurt - dt);
      m.atkCd -= dt;
      if (m.dying) {
        m.dying -= dt;
        if (m.dying <= 0) { list.splice(i, 1); Sim.fx(G, { k: 'die', x: m.x, y: m.y, t: m.type }); }
        continue;
      }
      const np = nearestPlayer(G, m.x, m.y);
      let tx = null, ty = null, sp = m.speed;
      let sight = def.sight * (G.isNight ? 1.3 : 1);
      if (m.hunter) sight = 1200;

      if (m.guard) {
        const hd = AB.dist(m.x, m.y, m.home.x, m.home.y);
        if (m.st === 'return') { if (hd < 60) m.st = 'idle'; }
        else if (hd > cfg.GUARD_LEASH) m.st = 'return';
      }
      if (m.st !== 'return' && np) {
        if (np.d < sight) m.st = 'chase';
        else if (m.st === 'chase' && np.d > sight * 1.7) m.st = 'idle';
      } else if (!np && m.st === 'chase') m.st = 'idle';

      if (m.st === 'chase' && np) { tx = np.p.x; ty = np.p.y; }
      else if (m.st === 'return') { tx = m.home.x; ty = m.home.y; sp *= 1.1; }
      else {
        m.wT -= dt;
        if (m.wT <= 0) {
          m.wT = 2 + Math.random() * 4;
          const a = Math.random() * 6.28, d = Math.random() * (m.guard ? 120 : 200);
          m.wx = (m.guard ? m.home.x : m.x) + Math.cos(a) * d; m.wy = (m.guard ? m.home.y : m.y) + Math.sin(a) * d;
        }
        if (AB.dist2(m.x, m.y, m.wx, m.wy) > 100) { tx = m.wx; ty = m.wy; sp *= 0.4; }
      }

      // боязнь огня
      if (def.fearFire) {
        for (const f of G.fires) {
          if (f.fuel <= 0) continue;
          const lr = fireLight(f) * 0.85, d = AB.dist(m.x, m.y, f.x, f.y);
          if (d < lr) { tx = m.x + (m.x - f.x); ty = m.y + (m.y - f.y); sp = m.speed * 1.2; break; }
        }
      }

      let mvx = 0, mvy = 0;
      if (tx !== null) {
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        const stopD = m.st === 'chase' ? m.r + cfg.PLAYER_RADIUS + 2 : 4;
        if (d > stopD) {
          let a = Math.atan2(dy, dx);
          if (m.stuck > 0) { a += m.side * 1.1; m.stuck -= dt; }
          mvx = Math.cos(a) * sp * dt; mvy = Math.sin(a) * sp * dt;
          m.a = a;
        } else if (m.st === 'chase') m.a = Math.atan2(dy, dx);
      }
      // разойтись с соседями
      for (let j = 0; j < list.length; j++) {
        const o = list[j];
        if (o === m) continue;
        const dx = m.x - o.x, dy = m.y - o.y, rr = m.r + o.r;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
        const d = Math.hypot(dx, dy);
        if (d < rr && d > 0.01) { const push = (rr - d) * 0.5; mvx += (dx / d) * push; mvy += (dy / d) * push; }
      }
      const ox = m.x, oy = m.y;
      const r = AB.resolveCollision(W, m.x + mvx, m.y + mvy, m.r);
      m.x = r[0]; m.y = r[1];
      const moved = Math.hypot(m.x - ox, m.y - oy), want = Math.hypot(mvx, mvy);
      if (want > 0.5 && moved < want * 0.35 && m.stuck <= 0) { m.stuck = 0.6; m.side = Math.random() < 0.5 ? 1 : -1; }
      m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);

      // атака
      if (np && m.st === 'chase' && np.d < m.r + cfg.PLAYER_RADIUS + 8 && m.atkCd <= 0) {
        m.atkCd = def.attackCd; m.atk = 0.25;
        damagePlayer(G, np.p, m.dmg);
      }
      m.atk = Math.max(0, (m.atk || 0) - dt);

      // исчезновение далеко от игроков
      if (!m.guard) {
        let far = true;
        for (const p of G.players) if (AB.dist2(m.x, m.y, p.x, p.y) < cfg.DESPAWN_DIST * cfg.DESPAWN_DIST) { far = false; break; }
        if (far) list.splice(i, 1);
      }
    }
  }

  function fireLight(f) { const cfg = C(); return cfg.FIRE_LIGHT_RADIUS * (0.35 + 0.65 * Math.min(1, f.fuel / (cfg.FIRE_FUEL_MAX * 0.6))); }
  AB.fireLight = fireLight;

  // ---------- Снаряды ----------
  function updateProjectiles(G, dt) {
    const W = G.W;
    for (let i = G.projs.length - 1; i >= 0; i--) {
      const pr = G.projs[i];
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      let dead = pr.life <= 0;
      // препятствия
      const tx = Math.floor(pr.x / W.T), ty = Math.floor(pr.y / W.T);
      const s = AB.tileSolid(W, tx, ty);
      if (s === AB.S_TREE) { const t = W.trees[W.treeAt[ty * W.N + tx]]; if (t && !t.dead && AB.dist2(pr.x, pr.y, t.x, t.y) < 100) { dead = true; Sim.fx(G, { k: 'thud', x: pr.x, y: pr.y }); } }
      else if (s === AB.S_ROCK) { dead = true; Sim.fx(G, { k: 'thud', x: pr.x, y: pr.y }); }
      if (!dead) for (const m of G.monsters.slice()) {
        if (m.dying || pr.hit.includes(m.id)) continue;
        if (AB.dist2(pr.x, pr.y, m.x, m.y) < (m.r + 5) * (m.r + 5)) {
          pr.hit.push(m.id);
          damageMonster(G, m, pr.dmg, null, Math.atan2(pr.vy, pr.vx));
          pr.pierce--;
          if (pr.pierce <= 0) { dead = true; break; }
        }
      }
      if (dead) G.projs.splice(i, 1);
    }
  }

  // ---------- Предметы на земле ----------
  function updateDrops(G, dt) {
    const cfg = C();
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i];
      d.age += dt;
      if (d.age < 0.35) continue;
      let best = null, bd = cfg.MAGNET_RADIUS;
      for (const p of G.players) {
        if (p.dead) continue;
        const dd = AB.dist(d.x, d.y, p.x, p.y);
        if (dd < bd) { bd = dd; best = p; }
      }
      if (!best) continue;
      if (bd < cfg.PICKUP_RADIUS) {
        giveItem(G, best, d.k, 1);
        G.drops.splice(i, 1);
        Sim.fx(G, { k: 'pick', x: d.x, y: d.y, it: d.k, pid: best.id });
      } else {
        const sp = 260 * dt * (1 - bd / cfg.MAGNET_RADIUS + 0.3);
        d.x += ((best.x - d.x) / bd) * sp; d.y += ((best.y - d.y) / bd) * sp;
      }
    }
  }

  // ---------- Деревья, кусты, огород, костры ----------
  function updateWorld(G, dt) {
    const cfg = C(), W = G.W;
    for (const t of W.trees) {
      if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
      if (t.dead) {
        t.regrow -= dt;
        if (t.regrow <= 0) {
          // не вырастать под игроком/монстром
          let blocked = G.players.some(p => AB.dist2(p.x, p.y, t.x, t.y) < 900);
          if (!blocked) { t.dead = false; t.hp = cfg.TREE_HP; G.treeDirty.add(t.id); }
          else t.regrow = 5;
        }
      }
    }
    for (const b of W.bushes) {
      if (b.berries === 0) { b.t -= dt; if (b.t <= 0) { b.berries = 1; G.bushDirty.add(b.id); } }
    }
    for (const pl of G.plots) {
      if (pl.crop && !pl.ready) {
        pl.t += dt;
        if (pl.t >= cfg.CROPS[pl.crop].grow) { pl.ready = true; }
      }
    }
    for (const f of G.fires) f.fuel = Math.max(0, f.fuel - cfg.FIRE_BURN_RATE * dt);
  }

  // ---------- Появление монстров ----------
  function spawnLogic(G, dt) {
    const cfg = C(), W = G.W;
    G.spawnT -= dt;
    if (G.spawnT > 0) return;
    G.spawnT = G.isNight ? cfg.SPAWN_INTERVAL_NIGHT : cfg.SPAWN_INTERVAL_DAY;
    const roamers = G.monsters.filter(m => !m.guard).length;
    const max = G.isNight
      ? Math.min(cfg.NIGHT_MONSTERS_CAP, Math.round(cfg.NIGHT_MAX_MONSTERS + (G.day - 1) * cfg.NIGHT_MONSTERS_PER_NIGHT) * (G.players.length > 1 ? 1.3 : 1))
      : cfg.DAY_MAX_MONSTERS;
    if (roamers >= max) return;
    const alive = alivePlayers(G);
    if (!alive.length) return;
    const p = alive[Math.floor(Math.random() * alive.length)];
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = AB.lerp(cfg.SPAWN_MIN_DIST, cfg.SPAWN_MAX_DIST, Math.random());
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 150 || y < 150 || x > W.size - 150 || y > W.size - 150) continue;
      if (!AB.freeSpot(W, x, y, 14)) continue;
      if (G.players.some(q => AB.dist(q.x, q.y, x, y) < cfg.SPAWN_MIN_DIST * 0.9)) continue;
      const campD = AB.dist(x, y, W.camp.x, W.camp.y);
      if (!G.isNight && campD < cfg.SAFE_CAMP_RADIUS * 2) continue;
      let type;
      const r = Math.random();
      if (G.isNight) {
        const bruteCh = G.day >= 8 ? Math.min(0.12, 0.02 + G.day * 0.002) : 0;
        const alphaCh = G.day >= 4 ? Math.min(0.15, 0.04 + G.day * 0.002) : 0;
        if (r < bruteCh) type = 'brute';
        else if (r < bruteCh + alphaCh) type = 'alpha';
        else if (r < 0.5) type = 'shade';
        else if (r < 0.78) type = 'ghoul';
        else type = 'wolf';
      } else type = r < 0.55 ? 'wolf' : 'ghoul';
      const m = Sim.spawnMonster(G, type, x, y, false);
      if (G.isNight) m.hunter = true;
      return;
    }
  }

  // ---------- Команды игрока (клавиши E / R / G / B) ----------
  Sim.command = function (G, pid, c, x, y) {
    const cfg = C();
    const p = G.players.find(q => q.id === pid);
    if (!p || p.dead || G.over) return;
    if (c === 'eat') {
      const miss = cfg.PLAYER_MAX_FOOD - p.food;
      const avail = Object.keys(cfg.FOOD).filter(k => p.inv[k] > 0);
      if (!avail.length) { Sim.msg(G, 'Нет еды! Охотьтесь или сажайте огород', p.id, '#ff9d7a'); return; }
      if (miss < 3) { Sim.msg(G, 'Вы сыты', p.id); return; }
      avail.sort((a, b) => cfg.FOOD[a].food - cfg.FOOD[b].food);
      let pick = avail[0];
      for (const k of avail) if (cfg.FOOD[k].food <= miss + 4) pick = k;
      p.inv[pick]--;
      p.food = Math.min(cfg.PLAYER_MAX_FOOD, p.food + cfg.FOOD[pick].food);
      p.hp = Math.min(cfg.PLAYER_MAX_HP, p.hp + cfg.FOOD[pick].hp);
      Sim.fx(G, { k: 'eat', x: p.x, y: p.y, it: pick, pid: p.id });
    } else if (c === 'plant') {
      const seedKey = p.inv.seed_pumpkin > 0 && (p.inv.seed_carrot <= 0 || x === 'pumpkin') ? 'seed_pumpkin' : (p.inv.seed_carrot > 0 ? 'seed_carrot' : null);
      if (!seedKey) { Sim.msg(G, 'Нет семян. Ищите их в сундуках и у сильных монстров', p.id, '#ff9d7a'); return; }
      let best = null, bd = cfg.PLANT_RANGE;
      for (const pl of G.plots) { if (pl.crop) continue; const d = AB.dist(p.x, p.y, pl.x, pl.y); if (d < bd) { bd = d; best = pl; } }
      if (!best) { Sim.msg(G, 'Подойдите к свободной грядке (или постройте её клавишей G)', p.id, '#ff9d7a'); return; }
      p.inv[seedKey]--;
      best.crop = seedKey === 'seed_carrot' ? 'carrot' : 'pumpkin'; best.t = 0; best.ready = false;
      Sim.fx(G, { k: 'plant', x: best.x, y: best.y });
    } else if (c === 'bed' || c === 'fire') {
      const cost = c === 'bed' ? cfg.GARDEN_BED_COST : cfg.CAMPFIRE_COST;
      if (p.inv.wood < cost) { Sim.msg(G, `Нужно дерева: ${cost} (есть ${p.inv.wood})`, p.id, '#ff9d7a'); return; }
      let bx = x, by = y;
      const d = AB.dist(p.x, p.y, bx, by);
      if (d > cfg.BUILD_RANGE) { bx = p.x + (bx - p.x) / d * cfg.BUILD_RANGE; by = p.y + (by - p.y) / d * cfg.BUILD_RANGE; }
      const W = G.W, gi = Math.floor(by / W.T) * W.N + Math.floor(bx / W.T);
      if (!AB.freeSpot(W, bx, by, 16) || W.ground[gi] === AB.G_WATER) { Sim.msg(G, 'Здесь нельзя строить', p.id, '#ff9d7a'); return; }
      const clash = G.plots.some(q => AB.dist(q.x, q.y, bx, by) < 36) || G.fires.some(q => AB.dist(q.x, q.y, bx, by) < 44);
      if (clash) { Sim.msg(G, 'Слишком близко к другой постройке', p.id, '#ff9d7a'); return; }
      p.inv.wood -= cost;
      if (c === 'bed') G.plots.push({ id: G.plots.length, x: bx, y: by, crop: null, t: 0, ready: false });
      else G.fires.push({ id: G.fires.length, x: bx, y: by, fuel: cfg.FIRE_FUEL_MAX * 0.5, main: false });
      Sim.fx(G, { k: 'build', x: bx, y: by });
    }
  };

  // ---------- Сетевые снимки ----------
  const r1 = (v) => Math.round(v * 10) / 10;
  Sim.snapshot = function (G, full) {
    const W = G.W;
    const s = {
      t: 's', c: G.clock, o: G.over, k: G.stats.kills,
      p: G.players.map(p => ({ id: p.id, n: p.name, x: r1(p.x), y: r1(p.y), a: r1(p.a), hp: r1(p.hp), f: r1(p.food), d: p.dead ? 1 : 0, rs: r1(p.rs), w: p.w, ws: p.ws, inv: p.inv, sw: r1(p.sw), sk: p.sk, sa: r1(p.sa), tp: p.tp, h: r1(p.hurt), mv: p.moving ? 1 : 0 })),
      m: G.monsters.map(m => [m.id, MON_TYPES.indexOf(m.type), r1(m.x), r1(m.y), r1(m.a), Math.round(m.hp), Math.round(m.maxHp), m.hurt > 0 ? 1 : 0, (m.guard ? 1 : 0) | (m.hunter ? 2 : 0) | (m.st === 'chase' ? 4 : 0) | ((m.atk || 0) > 0 ? 8 : 0), m.dying > 0 ? r1(m.dying) : 0]),
      pr: G.projs.map(p => [p.id, p.k, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy)]),
      d: G.drops.map(d => [d.id, d.k, r1(d.x), r1(d.y)]),
      pl: G.plots.map(p => [r1(p.x), r1(p.y), p.crop, Math.round(p.t), p.ready ? 1 : 0]),
      f: G.fires.map(f => [r1(f.x), r1(f.y), r1(f.fuel), f.main ? 1 : 0]),
      ch: W.sites.filter(s2 => s2.opened).map(s2 => s2.id),
      fx: G.fxOut,
    };
    let trees = [], bushes = [];
    if (full) {
      W.trees.forEach(t => { if (t.dead || t.hp < C().TREE_HP) trees.push([t.id, t.hp, t.dead ? 1 : 0]); });
      W.bushes.forEach(b => { if (b.berries === 0) bushes.push([b.id, 0]); });
    } else {
      G.treeDirty.forEach(id => { const t = W.trees[id]; trees.push([t.id, t.hp, t.dead ? 1 : 0]); });
      G.bushDirty.forEach(id => bushes.push([id, W.bushes[id].berries]));
    }
    s.tr = trees; s.bu = bushes;
    G.treeDirty.clear(); G.bushDirty.clear();
    G.fxOut = [];
    return s;
  };

  // Гость применяет снимок хоста
  Sim.applySnapshot = function (G, s, myId) {
    const W = G.W;
    G.clock = s.c; G.stats.kills = s.k;
    const ti = Sim.timeInfo(G.clock); G.day = ti.day; G.isNight = ti.isNight; G.nightF = ti.nightF;
    if (s.o && !G.over) { G.over = s.o; }
    // игроки
    s.p.forEach(sp => {
      let p = G.players.find(q => q.id === sp.id);
      if (!p) { p = { id: sp.id, x: sp.x, y: sp.y, tp: sp.tp }; G.players.push(p); }
      const mine = sp.id === myId;
      if (!mine || sp.tp !== p.tp || sp.d) { p.tx = sp.x; p.ty = sp.y; if (mine || p.x === undefined) { p.x = sp.x; p.y = sp.y; } }
      if (!mine) { p.a = sp.a; p.moving = !!sp.mv; }
      p.name = sp.n; p.hp = sp.hp; p.food = sp.f; p.dead = !!sp.d; p.rs = sp.rs;
      p.ws = sp.ws; p.inv = sp.inv; p.sw = sp.sw; p.sk = sp.sk; p.sa = sp.sa; p.tp = sp.tp; p.hurt = sp.h;
      if (!mine || !p.ws.includes(p.w)) p.w = sp.w;
      if (mine && p._lastWs && p.ws.length > p._lastWs) p.w = sp.w;
      p._lastWs = p.ws.length;
    });
    // монстры
    const map = new Map(G.monsters.map(m => [m.id, m]));
    G.monsters = s.m.map(a => {
      let m = map.get(a[0]);
      if (!m) m = { id: a[0], x: a[2], y: a[3], vx: 0, vy: 0 };
      m.type = MON_TYPES[a[1]]; m.tx = a[2]; m.ty = a[3]; m.a = a[4]; m.hp = a[5]; m.maxHp = a[6];
      m.hurt = a[7] ? 0.1 : 0; m.guard = !!(a[8] & 1); m.hunter = !!(a[8] & 2); m.st = a[8] & 4 ? 'chase' : 'idle'; m.atk = a[8] & 8 ? 0.2 : 0;
      m.dying = a[9]; m.r = window.CONFIG.MONSTERS[m.type].radius;
      return m;
    });
    G.projs = s.pr.map(a => ({ id: a[0], k: a[1], x: a[2], y: a[3], vx: a[4], vy: a[5] }));
    const dmap = new Map(G.drops.map(d => [d.id, d]));
    G.drops = s.d.map(a => { const o = dmap.get(a[0]); return { id: a[0], k: a[1], x: a[2], y: a[3], age: o ? o.age : 0 }; });
    G.plots = s.pl.map((a, i) => ({ id: i, x: a[0], y: a[1], crop: a[2], t: a[3], ready: !!a[4] }));
    G.fires = s.f.map((a, i) => ({ id: i, x: a[0], y: a[1], fuel: a[2], main: !!a[3] }));
    s.ch.forEach(id => { if (W.sites[id]) W.sites[id].opened = true; });
    s.tr.forEach(a => { const t = W.trees[a[0]]; if (t) { if (a[1] < t.hp && !a[2]) t.shake = 0.35; t.hp = a[1]; t.dead = !!a[2]; } });
    s.bu.forEach(a => { const b = W.bushes[a[0]]; if (b) b.berries = a[1]; });
    if (AB.FX) s.fx.forEach(ev => AB.FX.play(ev));
  };
})(window.AB);
