// Игровая логика. Выполняется у одиночного игрока и у ХОСТА (гость получает готовое состояние).
(function (AB) {
  const C = () => window.CONFIG;
  const TAU = Math.PI * 2;
  const MON_TYPES = ['wolf', 'ghoul', 'shade', 'brute', 'alpha', 'spider', 'spitter', 'giant', 'packlord', 'witch', 'golem'];
  AB.MON_TYPES = MON_TYPES;
  const ITEM_KEYS = ['wood', 'meat', 'berry', 'carrot', 'pumpkin', 'cooked_meat', 'cooked_carrot', 'cooked_pumpkin', 'plank', 'hide', 'coal', 'seed_carrot', 'seed_pumpkin', 'coin'];
  AB.ITEM_KEYS = ITEM_KEYS;
  AB.monDef = (t) => C().MONSTERS[t] || C().BOSSES[t];
  AB.isBoss = (t) => !!C().BOSSES[t];
  const rnd = Math.random;

  const Sim = AB.Sim = {};

  Sim.create = function (seed, mode) {
    const cfg = C();
    const W = AB.generateWorld(seed);
    const G = {
      seed, W, mode, clock: 0, day: 1, isNight: false, nightF: 0,
      players: [], monsters: [], projs: [], drops: [], eprojs: [], tele: [], structs: [], mines: [],
      plots: W.plots.map((p, i) => ({ id: i, x: p.x, y: p.y, crop: null, t: 0, ready: false, mod: false })),
      fires: W.fires.map((f, i) => ({ id: i, x: f.x, y: f.y, fuel: cfg.FIRE_FUEL_START, main: f.main, lvl: 1, mod: false, lm: 1 })),
      nextId: 1, spawnT: 2, fxOut: [], treeDirty: new Set(), bushDirty: new Set(),
      over: null, stats: { kills: 0 }, fireLevel: 1, nextBoss: cfg.BOSS_FIRST_NIGHT, bossCount: 0, team: {},
      store: { x: W.fires[0].x + cfg.STORAGE_OFFSET[0], y: W.fires[0].y + cfg.STORAGE_OFFSET[1], logs: 0, planks: cfg.MILL.startPlanks, lvl: 1, up: 0, sawT: 0, feedT: 0 },
      coins: cfg.START_COINS, fireUp: 0, debt: 0, upkeepLast: 0,
      crypto: { price: cfg.EXCHANGE.startPrice, hist: [cfg.EXCHANGE.startPrice], held: 0, t: 0 },
      merchant: null,
      kitchen: { x: W.fires[0].x + cfg.KITCHEN_OFFSET[0], y: W.fires[0].y + cfg.KITCHEN_OFFSET[1], slots: [], queue: [], lvl: 1, up: 0 }, fireT: 0,
    };
    if (mode !== 'guest') {
      W.sites.forEach((s) => {
        s.guards.forEach((type, k) => {
          const a = (k / s.guards.length) * TAU;
          const m = Sim.spawnMonster(G, type, s.x + Math.cos(a) * 55, s.y + Math.sin(a) * 55, true, Sim.depth(G, s.x, s.y));
          m.home = { x: s.x, y: s.y }; m.site = s.id;
        });
      });
    }
    return G;
  };

  Sim.addPlayer = function (G, id, name, prof) {
    const cfg = C();
    prof = cfg.PROFESSIONS[prof] ? prof : 'hunter';
    const pd = cfg.PROFESSIONS[prof];
    const p = {
      id, name, prof, x: G.W.camp.x + (id ? 28 : -28), y: G.W.camp.y + 100, a: 0,
      hp: cfg.PLAYER_MAX_HP, mhp: cfg.PLAYER_MAX_HP, food: cfg.PLAYER_MAX_FOOD, dead: false, rs: 0,
      w: pd.weapons[pd.weapons.length - 1], ws: pd.weapons.slice(), inv: {},
      atkCd: 0, chopCd: 0, feedCd: 0, sw: 0, sk: 'axe', sa: 0, tp: 0, hurt: 0,
      level: 1, queue: [], offers: null, skills: [], rr: 0, st: {}, swl: 0, wl: {},
      adrenT: 0, mineT: 0, meteorT: 0, lightT: 0, auraT: 0, droneCd: [], repT: 0,
    };
    ITEM_KEYS.forEach(k => p.inv[k] = cfg.START_ITEMS[k] || 0);
    AB.Skills.recalc(p);
    p.hp = p.mhp; p.swl = p.st.secondWind;
    G.players.push(p);
    return p;
  };

  Sim.fx = function (G, ev) { G.fxOut.push(ev); if (AB.FX) AB.FX.play(ev); };
  Sim.msg = function (G, text, pid, color) { Sim.fx(G, { k: 'msg', s: text, p: pid === undefined ? -1 : pid, c: color || '#ffe7a8' }); };

  // Рост монстров с номером ночи
  Sim.hpMult = (d) => { const c = C(), n = d - 1; return 1 + c.MONSTER_HP_GROWTH * n + c.MONSTER_HP_GROWTH_SQ * n * n; };
  Sim.dmgMult = (d) => { const c = C(), n = d - 1; return 1 + c.MONSTER_DMG_GROWTH * n + c.MONSTER_DMG_GROWTH_SQ * n * n; };

  // Глубина леса 0..1 (0 — у границы территории, 1 — у края карты)
  Sim.territory = (G) => C().TERRITORY_RADIUS[Math.min(3, (G.fireLevel || 1) - 1)];
  Sim.depth = function (G, x, y) {
    const W = G.W, d = AB.dist(x, y, W.camp.x, W.camp.y), t = Sim.territory(G);
    return AB.clamp((d - t) / (W.size / 2 - t), 0, 1);
  };
  Sim.spawnMonster = function (G, type, x, y, guard, depth) {
    const cfg = C(), def = AB.monDef(type);
    depth = depth || 0;
    const hm = (guard ? 1 : Sim.hpMult(G.day)) * (1 + cfg.DEPTH_HP * depth), dm = (guard ? 1 : Sim.dmgMult(G.day)) * (1 + cfg.DEPTH_DMG * depth);
    const m = {
      id: G.nextId++, type, x, y, a: rnd() * TAU, hp: def.hp * hm, maxHp: def.hp * hm,
      dmg: def.damage * dm, speed: def.speed * cfg.MOVE_SPEED_MULT * cfg.MONSTER_SPEED_MULT * (0.92 + rnd() * 0.16), r: def.radius,
      hd: rnd() * TAU, cs: 0, phase: rnd() * TAU, sp: null, spCd: 1 + rnd() * 2, chaseT: 0, pause: 0,
      st: 'idle', guard: !!guard, hunter: false, home: { x, y }, atkCd: 0, hurt: 0,
      wT: rnd() * 3, wx: x, wy: y, stuck: 0, side: rnd() < 0.5 ? 1 : -1, vx: 0, vy: 0,
      dying: 0, mark: 0, burn: null, slowT: 0, slowPct: 0, bladeT: 0, shotCd: 1 + rnd(), act: null,
    };
    if (AB.isBoss(type)) { m.boss = true; m.hunter = true; m.contact = def.contact * dm; m.st = 'chase'; }
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

  AB.visionRadius = function (w, h, nightF) {
    const cfg = C();
    const cover = AB.lerp(cfg.FOG_DAY_COVER, cfg.FOG_NIGHT_COVER, nightF);
    return Math.sqrt(((1 - cover) * w * h) / Math.PI);
  };

  AB.playerSpeed = function (p) {
    const cfg = C();
    const s = (p.st && p.st.speed) || 0;
    const slow = p.slowT > 0 ? 1 - (p.slowPct || 0) / 100 : 1;
    return cfg.PLAYER_SPEED * cfg.MOVE_SPEED_MULT * Math.max(0.4, 1 + s / 100) * slow;
  };
  AB.movePlayer = function (W, p, dx, dy, dt) {
    if (p.dead) return;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) { p.moving = false; return; }
    const sp = AB.playerSpeed(p);
    const r = AB.resolveCollision(W, p.x + (dx / len) * sp * dt, p.y + (dy / len) * sp * dt, C().PLAYER_RADIUS);
    p.x = r[0]; p.y = r[1]; p.moving = true;
  };

  // Позиции дронов и клинков (одинаково считаются у хоста и гостя)
  AB.dronePos = function (p, i, n, clock) {
    const a = clock * 1.6 + (i / n) * TAU, o = C().DRONE.orbit;
    return { x: p.x + Math.cos(a) * o, y: p.y - 22 + Math.sin(a) * o * 0.6 };
  };
  AB.bladePos = function (p, i, n, clock) {
    const b = C().BLADE, a = clock * b.speed + (i / n) * TAU;
    return { x: p.x + Math.cos(a) * b.radius, y: p.y - 4 + Math.sin(a) * b.radius, a };
  };

  // ---------- Основное обновление ----------
  Sim.update = function (G, dt) {
    if (G.over) return;
    const cfg = C();
    const prevNight = G.isNight, prevDay = G.day;
    G.clock += dt;
    const ti = Sim.timeInfo(G.clock);
    G.day = ti.day; G.isNight = ti.isNight; G.nightF = ti.nightF;
    G.team = AB.Skills.team(G);
    if (ti.isNight && !prevNight) onNight(G);
    if (!ti.isNight && prevNight) {
      if (prevDay >= cfg.NIGHTS_TO_WIN) { G.over = 'win'; Sim.fx(G, { k: 'over', s: 'win' }); return; }
      onDawn(G, prevDay);
      dailyEconomy(G);
    }
    updatePlayers(G, dt);
    updateStructs(G, dt);
    updateMonsters(G, dt);
    updateTele(G, dt);
    updateProjectiles(G, dt);
    updateEnemyShots(G, dt);
    updateDrops(G, dt);
    updateWorld(G, dt);
    spawnLogic(G, dt);
    updateEconomy(G, dt);
    if (G.players.length && G.players.every(p => p.dead)) { G.over = 'lose'; Sim.fx(G, { k: 'over', s: 'lose' }); }
  };

  function onNight(G) {
    const cfg = C();
    if (G.merchant) { G.merchant = null; G.players.forEach(p => p.mo = []); Sim.msg(G, 'Торговец ушёл до следующего визита', -1, '#c8b890'); }
    Sim.msg(G, `Ночь ${G.day}. Держитесь у костра!`, -1, '#9fb8ff');
    Sim.fx(G, { k: 'snd', s: 'night' });
    G.monsters.forEach(m => { if (!m.guard) m.hunter = true; });
    G.players.forEach(p => { p.swl = p.st.secondWind || 0; });
    if (G.day >= G.nextBoss) {
      if (G.monsters.some(m => m.boss)) G.nextBoss = G.day + 1;
      else { spawnBoss(G); G.nextBoss = G.day + cfg.BOSS_EVERY_MIN + Math.floor(rnd() * (cfg.BOSS_EVERY_MAX - cfg.BOSS_EVERY_MIN + 1)); }
    }
  }

  function onDawn(G, prevDay) {
    const cfg = C();
    if ((prevDay + 1) % cfg.MERCHANT.every === 0) {
      const f = G.fires.find(q => q.main);
      G.merchant = { x: f.x + cfg.MERCHANT.offset[0], y: f.y + cfg.MERCHANT.offset[1] };
      for (const p of G.players) p.mgBought = {};
      for (const p of G.players) p.mo = (!cfg.MERCHANT.onlyHunter || p.st.shopBuild > 0) ? merchantOffers(G, p) : [];
      Sim.msg(G, 'К лагерю пришёл торговец! Он уйдёт с наступлением ночи', -1, '#ffd24a');
    }
    Sim.msg(G, `Рассвет! Пережито ночей: ${prevDay} из ${cfg.NIGHTS_TO_WIN}`, -1, '#ffd98a');
    G.monsters.forEach(m => { if (!m.boss) m.hunter = false; if (m.type === 'shade') m.dying = 1.2; });
    for (const p of G.players) {
      p.level++;
      p.queue.push(p.level % cfg.SUPER_EVERY === 0 ? 's' : 'n');
      if (p.st.harvest > 0) { G.store.logs += Math.round(p.st.harvest); Sim.msg(G, `Собиратель: +${Math.round(p.st.harvest)} бревен на лесопилку`, p.id, '#c8f0a0'); }
      AB.Skills.ensureOffers(G, p);
      Sim.fx(G, { k: 'lvl', x: p.x, y: p.y, pid: p.id, n: p.level, sup: p.level % cfg.SUPER_EVERY === 0 ? 1 : 0 });
    }
  }

  function merchantOffers(G, p) {
    const cfg = C(), M = cfg.MERCHANT;
    const out = [];
    for (let i = 0; i < M.offers; i++) {
      const o = AB.Skills.makeOffers(G, p, 'n')[0];
      if (o && !out.some(q => q.id === o.id)) out.push({ id: o.id, tier: o.tier, price: M.prices[o.tier - 1], sold: 0 });
    }
    return out;
  }
  Sim.upgradePrice = (tier) => C().MERCHANT.upgradePrices[tier] || null;

  function spawnBoss(G) {
    const cfg = C();
    const alive = G.players.filter(p => !p.dead);
    if (!alive.length) return;
    const type = cfg.BOSS_ORDER[G.bossCount % cfg.BOSS_ORDER.length];
    const p = alive[Math.floor(rnd() * alive.length)];
    for (let t = 0; t < 40; t++) {
      const a = rnd() * TAU, d = 420 + rnd() * 150;
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 200 || y < 200 || x > G.W.size - 200 || y > G.W.size - 200) continue;
      if (!AB.freeSpot(G.W, x, y, 30) && t < 35) continue;
      const m = Sim.spawnMonster(G, type, x, y, false);
      const k = G.players.length > 1 ? cfg.BOSS_COOP_HP : 1;
      m.hp *= k; m.maxHp *= k;
      G.bossCount++;
      Sim.msg(G, `Приближается босс: ${cfg.BOSSES[type].name}! Уходите из красных зон!`, -1, '#ff6a5a');
      Sim.fx(G, { k: 'snd', s: 'boss' });
      return;
    }
  }

  function nearestPlayer(G, x, y) {
    let best = null, bd = Infinity;
    for (const p of G.players) { if (p.dead) continue; const d = AB.dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
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
    if (k === 'coin') { G.coins += n; return true; }
    if (Sim.bagItem(k) && Sim.bagUsed(p) + n > Sim.bagCap(p)) return false;
    p.inv[k] = (p.inv[k] || 0) + n;
    return true;
  }
  // Рюкзак: дерево и еда занимают место, семена — нет
  Sim.bagItem = (k) => k === 'wood' || k === 'plank' || k === 'hide' || k === 'coal';
  Sim.bagUsed = (p) => { let n = 0; for (const k in p.inv) if (Sim.bagItem(k)) n += p.inv[k] || 0; return n; };
  Sim.bagCap = (p) => C().BACKPACK_START + ((p.st && p.st.bag) || 0) + (p.bagUp || 0);
  // Доски: из рюкзака + с лесопилки
  Sim.woodOf = (G, p) => (p.inv.plank || 0) + ((G.store && G.store.planks) || 0);
  Sim.spendWood = function (G, p, n) {
    const a = Math.min(p.inv.plank || 0, n);
    p.inv.plank -= a; G.store.planks -= n - a;
  };
  // Шкала костра: сумма ступеней до текущего уровня
  Sim.fireCap = (G, f) => {
    const cfg = C();
    if (!f.main) return cfg.FIRE_FUEL_MAX;
    let s2 = 0; for (let i = 0; i < G.fireLevel; i++) s2 += cfg.FIRE_LEVEL_STEPS[i] || 0;
    return s2;
  };
  Sim.fireMaxLevel = () => C().FIRE_LEVEL_STEPS.length;
  // Подбросить единицу топлива; возвращает false, если костёр полон
  Sim.feedFire = function (G, f, val) {
    const cfg = C();
    let cap = Sim.fireCap(G, f);
    if (f.fuel >= cap && !(f.main && G.fireLevel < Sim.fireMaxLevel())) return false;
    f.fuel += val;
    while (f.main && f.fuel >= cap && G.fireLevel < Sim.fireMaxLevel()) {
      G.fireLevel++;
      cap = Sim.fireCap(G, f);
      Sim.msg(G, `Костёр ур. ${G.fireLevel}! Шкала выросла до ${cap}. Территория шире, умения «${cfg.TIER_NAMES[Math.min(3, G.fireLevel - 1)]}»`, -1, cfg.TIER_COLORS[Math.min(3, G.fireLevel - 1)]);
      Sim.fx(G, { k: 'fireup', x: f.x, y: f.y });
    }
    f.fuel = Math.min(cap, f.fuel);
    f.cap = cap;
    return true;
  };
  Sim.millCap = (S) => C().MILL.capacity + C().MILL.capPerLevel * ((S.lvl || 1) - 1);

  Sim.dropItem = function (G, k, n, x, y, spread) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, s = (spread || 18) * (0.4 + rnd());
      G.drops.push({ id: G.nextId++, k, x: x + Math.cos(a) * s, y: y + Math.sin(a) * s, t: 0, age: 0 });
    }
  };

  /* ======================= УРОН ======================= */
  function markMult(G, m, src) {
    if (!(m.mark > 0)) return 1;
    const cfg = C(), T = G.team;
    let b = cfg.MARK_BONUS + (T.markBonus || 0) + (T.syn_thermal || 0);
    if (src === 'turret' || src === 'cannon' || src === 'mine') b += T.syn_bait || 0;
    if (src === 'drone' || src === 'laser') b += T.syn_scope || 0;
    return 1 + b / 100;
  }

  // opts: { p — игрок-источник, src — вид урона, ang — направление, crit, noProc }
  function damageMonster(G, m, dmg, o) {
    if (m.dying || m.dead) return;
    const cfg = C();
    o = o || {};
    dmg *= markMult(G, m, o.src);
    m.hp -= dmg; m.hurt = 0.12;
    if (!m.hunter && m.st !== 'return') m.st = 'chase';
    const p = o.p;
    const st = p ? p.st : null;
    const ang = o.ang !== undefined ? o.ang : (p ? Math.atan2(m.y - p.y, m.x - p.x) : 0);
    let kb = (o.src === 'weapon' ? 7 : 2) + (st && o.src === 'weapon' ? st.knock : 0);
    if (m.boss) kb *= 0.1; else if (m.type === 'brute') kb *= 0.35;
    if (kb > 0.5) { const r = AB.resolveCollision(G.W, m.x + Math.cos(ang) * kb, m.y + Math.sin(ang) * kb, m.r); m.x = r[0]; m.y = r[1]; }
    Sim.fx(G, { k: 'hit', x: m.x, y: m.y, n: Math.round(dmg), t: m.type, c: o.crit ? 1 : 0, s: o.src });
    if (p && o.src === 'weapon' && !o.noProc) {
      if (st.mark > 0) { m.mark = cfg.MARK_TIME; }
      if (st.lifesteal > 0 && !p.dead) p.hp = Math.min(p.mhp, p.hp + dmg * st.lifesteal / 100);
      if (st.elem > 0) m.burn = { dps: st.elem, t: cfg.BURN_TIME, p: p.id, tick: 0.5 };
      if (st.slow > 0) { m.slowT = cfg.SLOW_TIME; m.slowPct = Math.min(70, Math.max(m.slowPct || 0, st.slow)); }
      if (st.explode > 0 && rnd() * 100 < st.explode) explode(G, m.x, m.y, cfg.EXPLODE_RADIUS, dmg * cfg.EXPLODE_DMG, p, m);
      if (st.chain > 0 && rnd() * 100 < st.chain) chain(G, m, dmg * cfg.CHAIN_DMG, p);
    }
    if (m.hp <= 0) killMonster(G, m, p);
  }
  Sim.damageMonster = damageMonster;

  function explode(G, x, y, r, dmg, p, skip, src) {
    Sim.fx(G, { k: 'boom', x, y, r });
    for (const o of G.monsters.slice()) {
      if (o === skip || o.dying) continue;
      if (AB.dist2(x, y, o.x, o.y) < (r + o.r) * (r + o.r)) damageMonster(G, o, dmg, { p, src: src || 'boom', noProc: true, ang: Math.atan2(o.y - y, o.x - x) });
    }
  }
  function chain(G, m, dmg, p) {
    const cfg = C();
    const pts = [[m.x, m.y]];
    let cur = m;
    const hit = new Set([m.id]);
    for (let i = 0; i < cfg.CHAIN_TARGETS; i++) {
      let best = null, bd = cfg.CHAIN_RANGE * cfg.CHAIN_RANGE;
      for (const o of G.monsters) { if (hit.has(o.id) || o.dying) continue; const d = AB.dist2(cur.x, cur.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
      if (!best) break;
      hit.add(best.id); pts.push([best.x, best.y]); cur = best;
      damageMonster(G, best, dmg, { p, src: 'chain', noProc: true });
    }
    if (pts.length > 1) Sim.fx(G, { k: 'bolt', pts });
  }

  function killMonster(G, m, p) {
    const cfg = C(), def = AB.monDef(m.type);
    m.dead = true;
    const i = G.monsters.indexOf(m);
    if (i >= 0) G.monsters.splice(i, 1);
    Sim.fx(G, { k: 'die', x: m.x, y: m.y, t: m.type });
    if (!m.boss) G.tele = G.tele.filter(t => t.owner !== m.id);
    G.stats.kills++;
    if (m.boss) { bossReward(G, m); return; }
    const luck = p ? p.st.luck : 0;
    let meat = def.meat[0] + Math.floor(rnd() * (def.meat[1] - def.meat[0] + 1));
    const mb = p ? p.st.meatBonus : (G.team.meatBonus || 0) / Math.max(1, G.players.length);
    if (mb > 0 && rnd() * 100 < mb) meat++;
    if (meat > 0) Sim.dropItem(G, 'meat', meat, m.x, m.y, 12);
    if (def.hide && rnd() < def.hide * (1 + luck / 100)) Sim.dropItem(G, 'hide', 1, m.x, m.y, 12);
    dropCoins(G, m);
    if (rnd() < def.seedChance * (1 + luck / 100)) Sim.dropItem(G, rnd() < 0.7 ? 'seed_carrot' : 'seed_pumpkin', 1, m.x, m.y, 12);
    if (p && p.st.killHeal > 0 && !p.dead) p.hp = Math.min(p.mhp, p.hp + p.st.killHeal);
  }

  function dropCoins(G, m) {
    const cfg = C(), cd = cfg.COIN_DROP[m.boss ? 'boss' : m.type];
    if (!cd) return;
    const depth = Sim.depth(G, m.x, m.y);
    let n = cd[0] + Math.floor(rnd() * (cd[1] - cd[0] + 1));
    n = Math.round(n * (1 + (cfg.DEPTH_COINS - 1) * depth));
    if (n > 0) Sim.dropItem(G, 'coin', n, m.x, m.y, 16);
  }

  function bossReward(G, m) {
    const cfg = C(), R = cfg.BOSS_REWARD;
    Sim.dropItem(G, 'meat', R.meat, m.x, m.y, 40);
    dropCoins(G, m);
    Sim.dropItem(G, 'wood', R.wood, m.x, m.y, 40);
    if (R.hides) Sim.dropItem(G, 'hide', R.hides, m.x, m.y, 30);
    if (R.coal) Sim.dropItem(G, 'coal', R.coal, m.x, m.y, 30);
    for (let i = 0; i < R.seeds; i++) Sim.dropItem(G, rnd() < 0.5 ? 'seed_carrot' : 'seed_pumpkin', 1, m.x, m.y, 30);
    Sim.msg(G, `Босс «${cfg.BOSSES[m.type].name}» повержен! Бонусное умение каждому`, -1, '#ffd24a');
    G.tele = G.tele.filter(t => t.owner !== m.id);
    for (const p of G.players) { for (let i = 0; i < R.bonusLevel; i++) p.queue.push('n'); AB.Skills.ensureOffers(G, p); }
    Sim.fx(G, { k: 'snd', s: 'chest' });
  }

  function damagePlayer(G, p, dmg, src) {
    if (p.dead) return;
    const cfg = C(), st = p.st;
    if (st.dodge > 0 && rnd() * 100 < Math.min(cfg.DODGE_CAP, st.dodge)) { Sim.fx(G, { k: 'dodge', x: p.x, y: p.y }); return; }
    const a = st.armor || 0;
    dmg *= a >= 0 ? cfg.ARMOR_K / (cfg.ARMOR_K + a) : (cfg.ARMOR_K - a) / cfg.ARMOR_K;
    p.hp -= dmg;
    p.hurt = 0.3; Sim.fx(G, { k: 'phit', x: p.x, y: p.y, pid: p.id, n: Math.round(dmg) });
    if (st.adren > 0) p.adrenT = 2;
    if (src && src.hp !== undefined && st.thorns > 0 && !src.dying) damageMonster(G, src, st.thorns, { p, src: 'thorns', noProc: true });
    if (p.hp <= 0) {
      if (p.swl > 0) {
        p.swl--; p.hp = p.mhp * 0.5;
        Sim.fx(G, { k: 'revive', x: p.x, y: p.y, pid: p.id });
        Sim.msg(G, 'Второе дыхание!', p.id, '#8fe0ff');
        return;
      }
      p.hp = 0; p.dead = true; p.rs = cfg.RESPAWN_TIME;
      Sim.fx(G, { k: 'pdie', x: p.x, y: p.y, pid: p.id });
      if (G.players.length > 1 && G.players.some(o => !o.dead)) Sim.msg(G, `${p.name} погиб! Возрождение через ${cfg.RESPAWN_TIME} с`, -1, '#ff8a8a');
    }
  }

  /* ======================= ИГРОКИ ======================= */
  function updatePlayers(G, dt) {
    const cfg = C();
    const main = G.fires.find(f => f.main);
    for (const p of G.players) {
      p.sw = Math.max(0, p.sw - dt);
      p.hurt = Math.max(0, p.hurt - dt);
      p.adrenT = Math.max(0, p.adrenT - dt);
      p.slowT = Math.max(0, (p.slowT || 0) - dt);
      if (p.dead) {
        if (G.players.some(o => !o.dead)) {
          p.rs -= dt;
          if (p.rs <= 0) {
            p.dead = false; p.hp = Math.min(p.mhp, cfg.RESPAWN_HP); p.food = Math.max(p.food, 40);
            p.x = main.x + 20; p.y = main.y + 40; p.tp++;
            Sim.msg(G, `${p.name} вернулся в лагерь`, -1);
          }
        }
        continue;
      }
      const st = p.st;
      p.food = Math.max(0, p.food - cfg.FOOD_DRAIN * (1 - Math.min(cfg.HUNGER_CAP, st.hunger) / 100) * dt);
      if (p.food <= 0) { p.hp -= cfg.STARVE_DAMAGE * dt; if (p.hp <= 0) damagePlayer(G, p, 1); }
      else if (p.food > cfg.REGEN_FOOD_MIN) p.hp = Math.min(p.mhp, p.hp + cfg.HP_REGEN * dt);
      if (st.regen > 0) p.hp = Math.min(p.mhp, p.hp + st.regen * dt);
      if (p.food < 20 && !p._hungryWarn) { p._hungryWarn = true; Sim.msg(G, 'Вы голодны! Нажмите E, чтобы поесть', p.id, '#ffb36b'); }
      if (p.food > 30) p._hungryWarn = false;

      p.feedCd -= dt;
      for (const f of G.fires) {
        const d = AB.dist(p.x, p.y, f.x, f.y);
        if (f.fuel > 0 && d < cfg.FIRE_HEAL_RADIUS) {
          const lv = f.main ? G.fireLevel : 1;
          p.hp = Math.min(p.mhp, p.hp + cfg.FIRE_HEAL * (1 + cfg.FIRE_LEVEL_HEAL * (lv - 1)) * (1 + st.fireHeal / 100) * dt);
        }
        if (d < cfg.FIRE_FEED_RADIUS && p.feedCd <= 0) {
          // сначала уголь, потом бревна
          const k = ['coal', 'wood'].find(q => (p.inv[q] || 0) > 0);
          if (k && Sim.feedFire(G, f, cfg.FUEL_VALUES[k])) {
            p.inv[k]--; p.feedCd = cfg.FIRE_FEED_INTERVAL;
            Sim.fx(G, { k: 'feed', x: f.x, y: f.y });
          }
        }
      }
      autoActions(G, p, dt);
      extras(G, p, dt);
      // архитектор чинит свои постройки
      if (st.structBuild > 0) {
        for (const s of G.structs) if (s.hp < s.mhp && AB.dist2(p.x, p.y, s.x, s.y) < cfg.STRUCT_REPAIR_RADIUS ** 2) s.hp = Math.min(s.mhp, s.hp + cfg.STRUCT_REPAIR_RATE * dt);
      }
    }
  }

  function nearStruct(G, x, y, r, kinds) {
    for (const s of G.structs) if ((!kinds || kinds.includes(s.kind)) && AB.dist2(x, y, s.x, s.y) < r * r) return s;
    return null;
  }

  // Параметры оружия с учётом характеристик
  Sim.weaponStats = function (G, p) {
    const cfg = C(), st = p.st, T = G.team || {};
    const w = cfg.WEAPONS[p.w] || cfg.WEAPONS.knife;
    const melee = w.type === 'melee';
    const missing = 1 - p.hp / p.mhp;
    let dmgPct = st.dmgPct + st.berserk * Math.floor(missing * 10);
    if (st.syn_nest > 0 && nearStruct(G, p.x, p.y, 80, ['tower'])) dmgPct += st.syn_nest;
    let rangeMul = 1, crit = st.crit;
    if (p.prof === 'hunter' && T.syn_loophole > 0 && nearStruct(G, p.x, p.y, 90, ['wall', 'tower'])) { rangeMul += T.syn_loophole / 100; crit += T.syn_loophole / 2; }
    const wlv = (p.wl && p.wl[p.w]) || 0;
    const dmg = Math.max(1, (w.damage + (melee ? st.melee : st.ranged)) * (1 + dmgPct / 100) * (1 + C().WORKSHOP.dmg * wlv));
    const spd = Math.max(0.5, 1 + (st.atkSpd + (p.adrenT > 0 ? st.adren : 0)) / 100);
    const range = (w.range + (melee ? st.range * 0.4 : st.range)) * (melee ? 1 : rangeMul);
    return { w, melee, dmg, cd: w.cooldown / spd, range, crit, critMult: cfg.CRIT_MULT + st.critMult, proj: 1 + (melee ? 0 : st.proj), pierce: (w.pierce || 1) + st.pierce };
  };

  function rollCrit(ws) { return rnd() * 100 < ws.crit; }

  function autoActions(G, p, dt) {
    const cfg = C(), W = G.W;
    p.atkCd -= dt; p.chopCd -= dt;
    const ws = Sim.weaponStats(G, p);
    let target = null, td = Infinity;
    for (const m of G.monsters) {
      if (m.dying) continue;
      const d = AB.dist(p.x, p.y, m.x, m.y) - m.r;
      if (d < ws.range && d < td) { td = d; target = m; }
    }
    if (target) {
      if (p.atkCd <= 0) {
        p.atkCd = ws.cd;
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        p.sw = ws.melee ? 0.25 : 0.15; p.sk = p.w; p.sa = ang;
        if (ws.melee) {
          const half = (ws.w.arc * Math.PI / 180) / 2;
          for (const m of G.monsters.slice()) {
            if (m.dying) continue;
            const d = AB.dist(p.x, p.y, m.x, m.y) - m.r;
            if (d > ws.range) continue;
            const am = Math.atan2(m.y - p.y, m.x - p.x);
            if (m === target || Math.abs(AB.angDiff(ang, am)) < half) {
              const c = rollCrit(ws);
              damageMonster(G, m, ws.dmg * (c ? ws.critMult : 1), { p, src: 'weapon', ang: am, crit: c });
            }
          }
          Sim.fx(G, { k: 'swing', x: p.x, y: p.y, a: ang, w: p.w });
        } else {
          const w = ws.w;
          const dist = AB.dist(p.x, p.y, target.x, target.y);
          const tt = dist / w.projSpeed;
          const a0 = Math.atan2(target.y + target.vy * tt - p.y, target.x + target.vx * tt - p.x);
          for (let i = 0; i < ws.proj; i++) {
            const a2 = a0 + (i - (ws.proj - 1) / 2) * 0.13;
            G.projs.push({
              id: G.nextId++, k: p.w, x: p.x + Math.cos(a2) * 14, y: p.y + Math.sin(a2) * 14,
              vx: Math.cos(a2) * w.projSpeed, vy: Math.sin(a2) * w.projSpeed,
              dmg: ws.dmg, life: (ws.range * 1.3) / w.projSpeed, pierce: ws.pierce, hit: [], owner: p.id, src: 'weapon', crit: ws.crit, cm: ws.critMult,
            });
          }
          Sim.fx(G, { k: 'shoot', x: p.x, y: p.y, a: a0, w: p.w });
        }
      }
    } else if (p.chopCd <= 0) {
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
    // ягоды
    for (const b of W.bushes) {
      if (b.berries > 0 && AB.dist2(p.x, p.y, b.x, b.y) < 900) {
        b.berries = 0; b.t = cfg.BERRY_REGROW_TIME; G.bushDirty.add(b.id);
        Sim.dropItem(G, 'berry', cfg.BERRIES_PER_BUSH, b.x, b.y, 14);
        Sim.fx(G, { k: 'rustle', x: b.x, y: b.y });
      }
    }
    // урожай
    for (const pl of G.plots) {
      if (pl.ready && AB.dist2(p.x, p.y, pl.x, pl.y) < 34 * 34) {
        const cd = cfg.CROPS[pl.crop];
        let n = cd.yield[0] + Math.floor(rnd() * (cd.yield[1] - cd.yield[0] + 1));
        n = Math.round(n * (1 + p.st.cropBonus / 100));
        Sim.dropItem(G, pl.crop, n, pl.x, pl.y, 14);
        Sim.msg(G, `Урожай: ${cd.name} ×${n}`, p.id, '#b8f28a');
        Sim.fx(G, { k: 'rustle', x: pl.x, y: pl.y });
        pl.crop = null; pl.ready = false; pl.t = 0;
      }
    }
    // сундуки
    for (const s of W.sites) {
      if (s.opened || AB.dist2(p.x, p.y, s.x, s.y) > cfg.CHEST_OPEN_RADIUS ** 2) continue;
      s.opened = true;
      Sim.fx(G, { k: 'chest', x: s.x, y: s.y, id: s.id });
      const found = [];
      if (s.weapon) {
        const got = giveItem(G, p, s.weapon);
        if (!got) { const o = G.players.find(q => q !== p && !q.ws.includes(s.weapon)); if (o) { giveItem(G, o, s.weapon); Sim.msg(G, `${p.name} передал вам: ${cfg.WEAPONS[s.weapon].name}`, o.id, '#ffd24a'); } }
        found.push(cfg.WEAPONS[s.weapon].name);
      }
      for (const k in s.loot) {
        if (k === 'bag') { p.bagUp = (p.bagUp || 0) + s.loot[k]; found.push(`рюкзак +${s.loot[k]}`); Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: `Рюкзак: ${Sim.bagCap(p)} мест`, t: 2 }); continue; }
        Sim.dropItem(G, k, s.loot[k], s.x, s.y + 14, 26); found.push(`${AB.itemName(k)} ×${s.loot[k]}`);
      }
      Sim.msg(G, `Сундук открыт: ${found.join(', ')}`, -1, '#ffd24a');
    }
  }

  function nearestMonster(G, x, y, range, preferMarked) {
    let best = null, bd = range * range, bm = false;
    for (const m of G.monsters) {
      if (m.dying) continue;
      const d = AB.dist2(x, y, m.x, m.y);
      if (d > range * range) continue;
      const mk = preferMarked && m.mark > 0;
      if ((mk && !bm) || ((mk === bm) && d < bd)) { best = m; bd = d; bm = mk; }
    }
    return best;
  }
  function shoot(G, x, y, t, speed, dmg, k, src, extra) {
    const d = AB.dist(x, y, t.x, t.y), tt = d / speed;
    const a = Math.atan2(t.y + t.vy * tt - y, t.x + t.vx * tt - x);
    G.projs.push(Object.assign({ id: G.nextId++, k, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, life: (d * 1.4 + 60) / speed, pierce: 1, hit: [], src }, extra || {}));
  }

  // Дроны, мины, аура, клинки, метеориты, молнии
  function extras(G, p, dt) {
    const cfg = C(), st = p.st, T = G.team;
    // дроны
    const nd = Math.floor(st.drones);
    if (nd > 0) {
      const D = cfg.DRONE;
      const range = D.range * (1 + (T.syn_targeting || 0) / 100);
      for (let i = 0; i < nd; i++) {
        p.droneCd[i] = (p.droneCd[i] || rnd()) - dt;
        if (p.droneCd[i] > 0) continue;
        const pos = AB.dronePos(p, i, nd, G.clock);
        const t = nearestMonster(G, pos.x, pos.y, range, T.syn_scope > 0);
        if (!t) { p.droneCd[i] = 0.2; continue; }
        p.droneCd[i] = D.cooldown / (1 + st.droneSpd / 100);
        shoot(G, pos.x, pos.y + 10, t, D.projSpeed, D.damage + st.eng * D.engScale, 'drone', 'drone');
      }
    }
    // мины
    if (st.mines > 0) {
      p.mineT += dt;
      const M = cfg.MINE;
      if (p.mineT >= M.interval / st.mines) {
        p.mineT = 0;
        G.mines.push({ id: G.nextId++, x: p.x, y: p.y + 6, owner: p.id, dmg: M.damage + st.eng * M.engScale, arm: 0.8 });
        const mine = G.mines.filter(m => m.owner === p.id);
        if (mine.length > M.maxPerStack * st.mines) G.mines.splice(G.mines.indexOf(mine[0]), 1);
      }
    }
    // аура
    if (st.aura > 0) {
      p.auraT -= dt;
      if (p.auraT <= 0) {
        p.auraT = 0.5;
        for (const m of G.monsters.slice()) if (!m.dying && AB.dist2(p.x, p.y, m.x, m.y) < (cfg.AURA_RADIUS + m.r) ** 2) damageMonster(G, m, st.aura * 0.5, { p, src: 'aura', noProc: true });
      }
    }
    // клинки
    const nb = Math.floor(st.blades);
    if (nb > 0) {
      const B = cfg.BLADE, dmg = (B.damage + st.melee) * (1 + st.dmgPct / 100);
      for (let i = 0; i < nb; i++) {
        const bp = AB.bladePos(p, i, nb, G.clock);
        for (const m of G.monsters.slice()) {
          if (m.dying || m.bladeT > 0) continue;
          if (AB.dist2(bp.x, bp.y, m.x, m.y) < (m.r + 12) ** 2) { m.bladeT = B.hitCd; damageMonster(G, m, dmg, { p, src: 'blade', noProc: true }); }
        }
      }
    }
    // метеориты
    if (st.meteor > 0) {
      p.meteorT += dt;
      const M = cfg.METEOR;
      if (p.meteorT >= M.interval / st.meteor) {
        const t = nearestMonster(G, p.x, p.y, 420, false);
        if (t) {
          p.meteorT = 0;
          const tx = t.x + (rnd() - 0.5) * 40, ty = t.y + (rnd() - 0.5) * 40;
          const dmg = M.damage * (1 + st.dmgPct / 100) * (1 + p.level * M.levelScale);
          G.tele.push({ id: G.nextId++, sh: 'c', x: tx, y: ty, r: M.radius, t: 0, dur: M.windup, dmg, fr: 1, pid: p.id });
        }
      }
    }
    // молнии
    if (st.lightning > 0) {
      p.lightT += dt;
      const L = cfg.LIGHTNING;
      if (p.lightT >= L.interval / st.lightning) {
        p.lightT = 0;
        const cands = G.monsters.filter(m => !m.dying && AB.dist2(p.x, p.y, m.x, m.y) < L.range * L.range);
        const dmg = (L.damage * (1 + st.dmgPct / 100) + st.elem * L.elemScale) * (1 + p.level * L.levelScale);
        for (let i = 0; i < L.targets && cands.length; i++) {
          const m = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
          Sim.fx(G, { k: 'bolt', pts: [[m.x + 20, m.y - 260], [m.x, m.y]] });
          damageMonster(G, m, dmg, { p, src: 'lightning', noProc: true });
        }
      }
    }
  }

  /* ======================= ПОСТРОЙКИ ======================= */
  function modMult(G, s) { return s && (s.kind === 'wall' || s.kind === 'tower') ? 1 + (G.team.syn_modular || 0) / 100 : 1; }

  function updateStructs(G, dt) {
    const cfg = C(), T = G.team;
    for (let i = G.structs.length - 1; i >= 0; i--) {
      const s = G.structs[i];
      if (s.hp <= 0) { G.structs.splice(i, 1); Sim.fx(G, { k: 'sbreak', x: s.x, y: s.y }); continue; }
      s.cd -= dt;
      const owner = G.players.find(p => p.id === s.owner) || { st: {} };
      if (s.kind === 'shop') { updateShop(G, s, dt); continue; }
      if (s.kind === 'exchange') {
        if (G.debt > 0) continue;
        s.mineT = (s.mineT || 0) + dt;
        if (s.mineT >= Sim.exRate(s)) {
          s.mineT = 0;
          const n = Sim.exMine(G, s);
          Sim.dropItem(G, 'coin', n, s.x, s.y + 24, 14);
          Sim.fx(G, { k: 'sold', x: s.x, y: s.y, n });
        }
        continue;
      }
      if (s.kind === 'workshop' || s.kind === 'townhall') continue;
      const modLv = 1 + cfg.MODULE_LEVELS.mult * ((s.ml || 1) - 1);
      if (G.debt > 0) continue;
      if (s.kind === 'turret' || (s.kind === 'tower' && (s.armed || s.mod))) {
        let range, dmg, cdv, speed, src, extra = {};
        if (s.kind === 'turret') {
          const Tt = cfg.TURRET, eng = owner.st.eng || 0;
          range = Tt.range; dmg = Tt.damage + eng * Tt.engScale; cdv = Tt.cooldown; speed = Tt.projSpeed; src = 'turret';
          dmg *= 1 + (owner.st.turretDmg || 0) / 100;
          dmg *= 1 + cfg.CANNON_LEVELS.dmg * ((s.cl || 1) - 1);
          if (s.mod) { dmg *= 1 + cfg.MODULES.turret.dmg * modLv / 100; range *= 1 + cfg.MODULES.turret.range * modLv / 100; cdv /= 1 + (T.syn_compat || 0) / 100; }
          if (owner.st.syn_caliber > 0 && G.structs.some(o => o !== s && o.kind !== 'turret' && AB.dist2(o.x, o.y, s.x, s.y) < 150 * 150)) dmg *= 1 + owner.st.syn_caliber / 100;
        } else if (s.armed) {
          const Cn = cfg.CANNON, eng = (G.players.find(p => p.id === s.armedBy) || owner).st.eng || 0;
          range = Cn.range; dmg = (Cn.damage + eng * Cn.engScale) * (1 + (T.syn_mount || 0) / 100); cdv = Cn.cooldown; speed = Cn.projSpeed; src = 'cannon';
          extra.splash = Cn.splash;
          dmg *= 1 + cfg.CANNON_LEVELS.dmg * ((s.cl || 1) - 1);
          if (s.mod) { dmg *= 1 + cfg.MODULES.turret.dmg * modMult(G, s) * modLv / 100; range *= 1 + cfg.MODULES.turret.range * modLv / 100; cdv /= 1 + (T.syn_compat || 0) / 100; }
        } else {
          const Lz = cfg.MODULES.tower, prog = G.players.find(p => p.id === s.modBy) || owner;
          range = Lz.range; dmg = (Lz.damage + (prog.st.eng || 0) * Lz.engScale) * modMult(G, s) * modLv; cdv = Lz.cooldown; speed = 900; src = 'laser';
        }
        if (s.kind === 'tower') range *= 1 + cfg.TOWER_LEVELS.range * ((s.tl || 1) - 1);
        dmg *= 1 + cfg.STRUCT_DMG_PER_NIGHT * (G.day - 1);
        range *= 1 + (T.syn_targeting || 0) / 100;
        if (s.cd <= 0) {
          const t = nearestMonster(G, s.x, s.y - 20, range, src === 'laser' && T.syn_scope > 0);
          if (t) {
            s.cd = cdv; s.a = Math.atan2(t.y - s.y, t.x - s.x);
            const crit = rnd() * 100 < (T.syn_targeting || 0) / 2;
            shoot(G, s.x, s.y - (s.kind === 'tower' ? 34 : 14), t, speed, dmg * (crit ? 2 : 1), src, src, Object.assign(extra, { crit: 0 }));
            Sim.fx(G, { k: 'shoot', x: s.x, y: s.y, a: s.a, w: src });
          } else s.cd = 0.25;
        }
      }
    }
    // мины
    for (let i = G.mines.length - 1; i >= 0; i--) {
      const mn = G.mines[i];
      mn.arm -= dt;
      if (mn.arm > 0) continue;
      const trig = G.monsters.find(m => !m.dying && AB.dist2(mn.x, mn.y, m.x, m.y) < (C().MINE.trigger + m.r) ** 2);
      if (trig) {
        G.mines.splice(i, 1);
        explode(G, mn.x, mn.y, C().MINE.radius, mn.dmg, G.players.find(p => p.id === mn.owner), null, 'mine');
      }
    }
  }

  // Лавка: принимает товары, медленно продаёт, выдаёт монеты владельцу
  function updateShop(G, s, dt) {
    const cfg = C(), SH = cfg.SHOP;
    s.stock = s.stock || []; s.sellT = s.sellT || 0;
    for (const p of G.players) {
      if (p.dead || AB.dist2(p.x, p.y, s.x, s.y) > SH.depositRadius ** 2) continue;
      const got = [];
      let foodLeft = Object.keys(SH.prices).filter(k => cfg.FOOD[k]).reduce((a, k) => a + (p.inv[k] || 0), 0);
      for (const k in SH.prices) {
        let n = p.inv[k] || 0;
        if (cfg.FOOD[k]) n = Math.max(0, Math.min(n, foodLeft - SH.keepFood));
        if (n <= 0) continue;
        if (cfg.FOOD[k]) foodLeft -= n;
        for (let i = 0; i < n; i++) s.stock.push(k);
        p.inv[k] -= n;
        got.push(`${AB.itemName(k).toLowerCase()} ×${n}`);
      }
      if (got.length) { Sim.msg(G, `В лавку: ${got.join(', ')}`, p.id, '#ffd24a'); Sim.fx(G, { k: 'rustle', x: s.x, y: s.y }); }
    }
    if (!s.stock.length) { s.sellT = 0; return; }
    s.sellT += dt;
    if (s.sellT >= Sim.shopSellTime(s)) {
      s.sellT = 0;
      const it = s.stock.shift(), n = Sim.shopPrice(s, it);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, r = 18 + rnd() * 16; G.drops.push({ id: G.nextId++, k: 'coin', x: s.x + Math.cos(a) * r, y: s.y + 20 + Math.sin(a) * r * 0.6, t: 0, age: 0 }); }
      Sim.fx(G, { k: 'sold', x: s.x, y: s.y, n });
    }
  }

  /* ======================= МОНСТРЫ ======================= */
  function updateMonsters(G, dt) {
    const cfg = C(), W = G.W, T = G.team;
    const list = G.monsters;
    const fenceDps = T.syn_fence || 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m) continue;
      const def = AB.monDef(m.type);
      m.hurt = Math.max(0, m.hurt - dt);
      m.atkCd -= dt; m.bladeT -= dt; m.mark = Math.max(0, m.mark - dt); m.slowT -= dt;
      if (m.dying) { m.dying -= dt; if (m.dying <= 0) { list.splice(i, 1); Sim.fx(G, { k: 'die', x: m.x, y: m.y, t: m.type }); } continue; }
      if (m.burn) {
        m.burn.t -= dt; m.burn.tick -= dt;
        if (m.burn.tick <= 0) { m.burn.tick = 0.5; damageMonster(G, m, m.burn.dps * 0.5, { p: G.players.find(p => p.id === m.burn.p), src: 'burn', noProc: true }); if (m.dead) continue; }
        if (m.burn && m.burn.t <= 0) m.burn = null;
      }
      if (m.boss) { bossAI(G, m, dt); continue; }
      const np = nearestPlayer(G, m.x, m.y);
      m.spCd -= dt;
      if (m.sp) { specialStep(G, m, dt); continue; }
      let tx = null, ty = null, sp = m.speed * (m.slowT > 0 ? 1 - m.slowPct / 100 : 1);
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

      if (m.st === 'chase' && np) {
        tx = np.p.x; ty = np.p.y;
        if (def.ranged) {
          const R = def.ranged;
          m.shotCd -= dt;
          if (np.d < R.range * 0.55) { tx = m.x + (m.x - np.p.x); ty = m.y + (m.y - np.p.y); sp *= 0.8; }
          else if (np.d < R.range) { tx = null; m.a = Math.atan2(np.p.y - m.y, np.p.x - m.x); }
          if (np.d < R.range && m.shotCd <= 0) {
            m.shotCd = R.cd; m.atk = 0.3;
            const a = Math.atan2(np.p.y - m.y, np.p.x - m.x);
            G.eprojs.push({ x: m.x, y: m.y - 10, vx: Math.cos(a) * R.speed, vy: Math.sin(a) * R.speed, dmg: m.dmg, life: R.range * 1.4 / R.speed, src: m.id });
          }
        }
      } else if (m.st === 'return') { tx = m.home.x; ty = m.home.y; sp *= 1.1; }
      else {
        // бродит: идёт к точке, останавливается, осматривается
        m.wT -= dt;
        if (m.pause > 0) { m.pause -= dt; if (rnd() < dt * 0.8) m.hd += (rnd() - 0.5) * 1.2; }
        else if (m.wT <= 0 || AB.dist2(m.x, m.y, m.wx, m.wy) < 200) {
          if (m.wT > -50 && AB.dist2(m.x, m.y, m.wx, m.wy) < 200) { const P = cfg.MONSTER_IDLE_PAUSE; m.pause = P[0] + rnd() * (P[1] - P[0]); }
          m.wT = 4 + rnd() * 4;
          const a = m.hd + (rnd() - 0.5) * 2.4, d = 60 + rnd() * (m.guard ? 100 : 180);
          m.wx = (m.guard ? m.home.x : m.x) + Math.cos(a) * d; m.wy = (m.guard ? m.home.y : m.y) + Math.sin(a) * d;
        }
        if (m.pause <= 0) { tx = m.wx; ty = m.wy; sp *= 0.38; }
      }
      // суперудар монстра (с подсказкой на земле)
      const SP = cfg.MONSTER_SPECIALS[m.type];
      if (SP && m.st === 'chase' && np) {
        if (np.d > m.r + cfg.PLAYER_RADIUS + 10) m.chaseT += dt; else m.chaseT = 0;
        if (m.spCd <= 0 && m.chaseT >= (SP.chaseTime || 0) && np.d >= SP.minDist && np.d <= SP.maxDist) { startSpecial(G, m, np.p, SP); continue; }
      } else m.chaseT = 0;
      if (def.fearFire) {
        for (const f of G.fires) {
          if (f.fuel <= 0) continue;
          const lr = AB.fireLight(f) * 0.85, d = AB.dist(m.x, m.y, f.x, f.y);
          if (d < lr) {
            tx = m.x + (m.x - f.x); ty = m.y + (m.y - f.y); sp = m.speed * 1.2;
            if (f.mod) damageMonster(G, m, cfg.MODULES.fire.shadeDps * dt, { src: 'burn', noProc: true });
            break;
          }
        }
        if (m.dead) continue;
      }
      // плавное движение: поворот с ограниченной скоростью, разгон, вилянье, обход препятствий
      let want = 0, da = m.hd;
      if (tx !== null) {
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        const stopD = m.st === 'chase' ? m.r + cfg.PLAYER_RADIUS + 2 : 4;
        da = Math.atan2(dy, dx);
        if (d > stopD) {
          const weave = cfg.MONSTER_WEAVE * (m.st === 'chase' ? Math.min(1, d / 150) : 1.5);
          da += Math.sin(G.clock * 2.3 + m.phase) * weave;
          if (m.stuck > 0) { da += m.side * 1.1; m.stuck -= dt; }
          da = avoid(G, m, da);
          want = sp;
        }
      }
      const diff = AB.angDiff(m.hd, da), maxT = cfg.MONSTER_TURN_RATE * dt * (def.speed > 120 ? 1.3 : 1);
      m.hd += AB.clamp(diff, -maxT, maxT);
      const turnK = 1 - Math.min(0.6, Math.abs(diff) / Math.PI * 0.8);
      m.cs += (want * turnK - m.cs) * Math.min(1, cfg.MONSTER_ACCEL * dt);
      let mvx = Math.cos(m.hd) * m.cs * dt, mvy = Math.sin(m.hd) * m.cs * dt;
      m.a = m.hd;
      separate(m, list, (dx, dy) => { mvx += dx; mvy += dy; });
      const ox = m.x, oy = m.y;
      const r = AB.resolveCollision(W, m.x + mvx, m.y + mvy, m.r);
      m.x = r[0]; m.y = r[1];
      // постройки не пускают монстров; упёршись — ломают
      for (const s of G.structs) {
        const dx = m.x - s.x, dy = m.y - s.y, rr = m.r + s.r, d = Math.hypot(dx, dy);
        if (d < rr && d > 0.01) {
          m.x = s.x + dx / d * rr; m.y = s.y + dy / d * rr;
          if (s.kind === 'wall' && (s.mod || fenceDps > 0)) {
            const own = G.players.find(p => p.id === s.modBy) || { st: {} };
            const dps = (s.mod ? (cfg.MODULES.wall.damage + (own.st.eng || 0) * cfg.MODULES.wall.engScale) * modMult(G, s) * (1 + cfg.MODULE_LEVELS.mult * ((s.ml || 1) - 1)) : 0) + fenceDps;
            m.fenceT = (m.fenceT || 0) - dt;
            if (m.fenceT <= 0) { m.fenceT = 0.5; m.slowT = 1; m.slowPct = Math.max(m.slowPct || 0, cfg.MODULES.wall.slow); damageMonster(G, m, dps * 0.5, { src: 'fence', noProc: true }); Sim.fx(G, { k: 'zap', x: (m.x + s.x) / 2, y: (m.y + s.y) / 2 }); }
          }
          if (m.st === 'chase' && m.atkCd <= 0 && (!np || np.d > m.r + cfg.PLAYER_RADIUS + 10)) { m.atkCd = def.attackCd; m.atk = 0.25; s.hp -= m.dmg; Sim.fx(G, { k: 'shit', x: s.x, y: s.y }); }
        }
      }
      if (m.dead) continue;
      const moved = Math.hypot(m.x - ox, m.y - oy), wantMv = Math.hypot(mvx, mvy);
      if (wantMv > 0.5 && moved < wantMv * 0.35 && m.stuck <= 0) { m.stuck = 0.6; m.side = rnd() < 0.5 ? 1 : -1; }
      m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);
      if (np && m.st === 'chase' && !def.ranged && np.d < m.r + cfg.PLAYER_RADIUS + 8 && m.atkCd <= 0) {
        m.atkCd = def.attackCd; m.atk = 0.25; m.chaseT = 0;
        damagePlayer(G, np.p, m.dmg, m);
        if (m.dead) continue;
      }
      m.atk = Math.max(0, (m.atk || 0) - dt);
      if (!m.guard) {
        let far = true;
        for (const p of G.players) if (AB.dist2(m.x, m.y, p.x, p.y) < cfg.DESPAWN_DIST ** 2) { far = false; break; }
        if (far) list.splice(i, 1);
      }
    }
  }

  // Поиск свободного направления (обход деревьев, камней, воды, построек)
  function blockedAt(G, x, y, r) {
    if (!AB.freeSpot(G.W, x, y, r)) return true;
    for (const s of G.structs) if (AB.dist2(x, y, s.x, s.y) < (s.r + r) ** 2) return true;
    return false;
  }
  function avoid(G, m, a) {
    const look = m.r + 18;
    const ok = (ang) => !blockedAt(G, m.x + Math.cos(ang) * look, m.y + Math.sin(ang) * look, m.r * 0.7);
    if (ok(a)) return a;
    for (const off of [0.5, 1.0, 1.5, 2.1]) {
      if (ok(a + off * m.side)) return a + off * m.side;
      if (ok(a - off * m.side)) { m.side = -m.side; return a + off * m.side; }
    }
    return a;
  }

  // ---------- Суперудары монстров ----------
  function startSpecial(G, m, target, S) {
    const a = Math.atan2(target.y - m.y, target.x - m.x);
    m.sp = { ph: 'wind', t: 0, a, S, hit: false };
    m.act = { k: S.kind }; m.hd = a; m.a = a; m.cs = 0; m.vx = 0; m.vy = 0;
    const dmg = m.dmg * S.dmgMult;
    const T = (o) => G.tele.push(Object.assign({ id: G.nextId++, t: 0, dur: S.windup, owner: m.id, dmg, fr: 0 }, o));
    if (S.kind === 'lunge') T({ sh: 'l', x: m.x, y: m.y, a, len: S.distance + m.r, w: S.width, warn: 1, dmg: 0 });
    else if (S.kind === 'cone') T({ sh: 'k', x: m.x, y: m.y, a, len: S.length + m.r, w: (S.angle / 2) * Math.PI / 180 });
    else if (S.kind === 'nova') T({ sh: 'c', x: m.x, y: m.y, r: S.radius });
    else if (S.kind === 'smash') T({ sh: 'c', x: m.x + Math.cos(a) * (m.r + S.radius * 0.55), y: m.y + Math.sin(a) * (m.r + S.radius * 0.55), r: S.radius });
    else if (S.kind === 'target') T({ sh: 'c', x: target.x, y: target.y, r: S.radius, slow: S.slow, slowTime: S.slowTime });
    else if (S.kind === 'volley') {
      for (let i = 0; i < S.count; i++) {
        const ang = rnd() * TAU, off = i === 0 ? 0 : S.spread * (0.5 + rnd() * 0.5);
        T({ sh: 'c', x: target.x + Math.cos(ang) * off, y: target.y + Math.sin(ang) * off, r: S.radius, dur: S.windup + i * 0.15 });
      }
    }
    Sim.fx(G, { k: 'windup', x: m.x, y: m.y });
  }
  function specialStep(G, m, dt) {
    const cfg = C(), g = m.sp, S = g.S;
    g.t += dt;
    const ox = m.x, oy = m.y;
    const finish = () => { m.sp = null; m.act = null; m.spCd = S.cooldown * (0.8 + rnd() * 0.4); m.chaseT = 0; m.cs = m.speed * 0.3; };
    if (S.kind === 'lunge') {
      if (g.ph === 'wind') {
        if (g.t >= S.windup) { g.ph = 'leap'; g.t = 0; m.act = null; Sim.fx(G, { k: 'leap', x: m.x, y: m.y }); }
      } else if (g.ph === 'leap') {
        const sp = S.distance / S.time;
        const r = AB.resolveCollision(G.W, m.x + Math.cos(g.a) * sp * dt, m.y + Math.sin(g.a) * sp * dt, m.r);
        m.x = r[0]; m.y = r[1];
        const moved = Math.hypot(m.x - ox, m.y - oy);
        if (!g.hit) for (const p of G.players) {
          if (p.dead) continue;
          if (AB.dist2(m.x, m.y, p.x, p.y) < (m.r + cfg.PLAYER_RADIUS + 4) ** 2) { g.hit = true; m.atk = 0.3; damagePlayer(G, p, m.dmg * S.dmgMult, m); break; }
        }
        if (m.dead) return;
        if (g.t >= S.time || moved < sp * dt * 0.3) { g.ph = 'rec'; g.t = 0; }
      } else if (g.t >= S.recover) finish();
    } else {
      if (g.t >= S.windup - 0.1) m.atk = 0.3;
      if (g.t >= S.windup + (S.kind === 'volley' ? S.count * 0.15 : 0) + 0.3) finish();
    }
    m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);
    m.atk = Math.max(0, (m.atk || 0) - dt);
  }

  function separate(m, list, add) {
    for (let j = 0; j < list.length; j++) {
      const o = list[j];
      if (o === m) continue;
      const dx = m.x - o.x, dy = m.y - o.y, rr = m.r + o.r;
      if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
      const d = Math.hypot(dx, dy);
      if (d < rr && d > 0.01) { const push = (rr - d) * (o.boss ? 0.9 : 0.5); add((dx / d) * push, (dy / d) * push); }
    }
  }

  /* ======================= БОССЫ ======================= */
  function bossAI(G, m, dt) {
    const cfg = C(), def = cfg.BOSSES[m.type], MV = cfg.BOSS_MOVES;
    const np = nearestPlayer(G, m.x, m.y);
    m.atk = Math.max(0, (m.atk || 0) - dt);
    if (m.act) {
      const a = m.act;
      a.t += dt;
      if (a.k === 'charge' && a.t >= a.wind) {
        const k = Math.min(1, (a.t - a.wind) / MV.charge.dash);
        const nx = AB.lerp(a.sx, a.ex, k), ny = AB.lerp(a.sy, a.ey, k);
        m.x = AB.clamp(nx, m.r, G.W.size - m.r); m.y = AB.clamp(ny, m.r, G.W.size - m.r);
        if (k >= 1) { const r = AB.resolveCollision(G.W, m.x, m.y, m.r); m.x = r[0]; m.y = r[1]; }
      }
      if (a.t >= a.dur) { m.act = null; m.atkCd = cfg.BOSS_ATTACK_PAUSE; }
      m.vx = 0; m.vy = 0;
      return;
    }
    if (!np) return;
    const dx = np.p.x - m.x, dy = np.p.y - m.y;
    m.a = Math.atan2(dy, dx);
    // выбор приёма
    if (m.atkCd <= 0) {
      const moves = def.attacks.filter(k => np.d <= MV[k].reach);
      if (moves.length) { startMove(G, m, moves[Math.floor(rnd() * moves.length)], np); return; }
    }
    const sp = m.speed * (m.slowT > 0 ? 1 - Math.min(40, m.slowPct) / 100 : 1);
    let mvx = 0, mvy = 0;
    if (np.d > m.r + 20) { mvx = Math.cos(m.a) * sp * dt; mvy = Math.sin(m.a) * sp * dt; }
    const ox = m.x, oy = m.y;
    const r = AB.resolveCollision(G.W, m.x + mvx, m.y + mvy, m.r * 0.6);
    m.x = r[0]; m.y = r[1];
    // босс ломает постройки на пути
    for (const s of G.structs) if (AB.dist2(m.x, m.y, s.x, s.y) < (m.r + s.r) ** 2) { s.hp -= m.dmg * dt; }
    m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);
    if (np.d < m.r + cfg.PLAYER_RADIUS + 6 && m.atkCd <= 0) { m.atkCd = 0.8; m.atk = 0.2; damagePlayer(G, np.p, m.contact, m); }
  }

  function tele(G, m, o) { G.tele.push(Object.assign({ id: G.nextId++, t: 0, owner: m.id, dmg: m.dmg, fr: 0 }, o)); }

  function startMove(G, m, k, np) {
    const cfg = C(), MV = cfg.BOSS_MOVES[k];
    const act = { k, t: 0, dur: MV.windup + 0.25 };
    m.atk = MV.windup;
    if (k === 'slam') tele(G, m, { sh: 'c', x: np.p.x, y: np.p.y, r: MV.radius, dur: MV.windup });
    else if (k === 'stomp') tele(G, m, { sh: 'c', x: m.x, y: m.y, r: MV.radius, dur: MV.windup });
    else if (k === 'charge') {
      const a = Math.atan2(np.p.y - m.y, np.p.x - m.x);
      act.sx = m.x; act.sy = m.y; act.ex = m.x + Math.cos(a) * MV.length; act.ey = m.y + Math.sin(a) * MV.length;
      act.wind = MV.windup; act.dur = MV.windup + MV.dash + 0.2;
      tele(G, m, { sh: 'l', x: m.x, y: m.y, a, len: MV.length, w: MV.width, dur: MV.windup });
    } else if (k === 'howl') {
      Sim.fx(G, { k: 'howl', x: m.x, y: m.y });
      for (let i = 0; i < MV.wolves; i++) {
        const a = rnd() * TAU;
        const w = Sim.spawnMonster(G, 'wolf', m.x + Math.cos(a) * 60, m.y + Math.sin(a) * 60, false);
        w.hunter = true; w.st = 'chase';
      }
    } else if (k === 'hex') {
      for (const p of G.players) {
        if (p.dead) continue;
        tele(G, m, { sh: 'c', x: p.x, y: p.y, r: MV.radius, dur: MV.windup });
        for (let j = 0; j < MV.extra; j++) { const a = rnd() * TAU; tele(G, m, { sh: 'c', x: p.x + Math.cos(a) * 110, y: p.y + Math.sin(a) * 110, r: MV.radius, dur: MV.windup + 0.2 }); }
      }
    } else if (k === 'blink') {
      Sim.fx(G, { k: 'blink', x: m.x, y: m.y });
      for (let t = 0; t < 20; t++) {
        const a = rnd() * TAU, x = np.p.x + Math.cos(a) * 230, y = np.p.y + Math.sin(a) * 230;
        if (AB.freeSpot(G.W, x, y, m.r)) { m.x = x; m.y = y; break; }
      }
      Sim.fx(G, { k: 'blink', x: m.x, y: m.y });
    } else if (k === 'cone') {
      const a = Math.atan2(np.p.y - m.y, np.p.x - m.x);
      tele(G, m, { sh: 'k', x: m.x, y: m.y, a, len: MV.length, w: (MV.angle / 2) * Math.PI / 180, dur: MV.windup });
    } else if (k === 'quake') {
      const a = Math.atan2(np.p.y - m.y, np.p.x - m.x);
      for (let i = 1; i <= MV.count; i++) tele(G, m, { sh: 'c', x: m.x + Math.cos(a) * MV.step * i, y: m.y + Math.sin(a) * MV.step * i, r: MV.radius, dur: MV.windup + i * MV.delay });
      act.dur = MV.windup + MV.count * MV.delay + 0.2;
    }
    m.act = act;
  }

  function inShape(t, x, y, pad) {
    if (t.sh === 'c') return AB.dist2(x, y, t.x, t.y) < (t.r + pad) ** 2;
    const dx = x - t.x, dy = y - t.y;
    if (t.sh === 'l') {
      const along = dx * Math.cos(t.a) + dy * Math.sin(t.a), perp = Math.abs(-dx * Math.sin(t.a) + dy * Math.cos(t.a));
      return along > -pad && along < t.len + pad && perp < t.w / 2 + pad;
    }
    if (t.sh === 'k') return Math.hypot(dx, dy) < t.len + pad && Math.abs(AB.angDiff(t.a, Math.atan2(dy, dx))) < t.w;
    return false;
  }
  AB.inShape = inShape;

  function updateTele(G, dt) {
    for (let i = G.tele.length - 1; i >= 0; i--) {
      const t = G.tele[i];
      t.t += dt;
      if (t.t < t.dur) continue;
      G.tele.splice(i, 1);
      if (t.warn) continue;
      Sim.fx(G, { k: 'strike', sh: t.sh, x: t.x, y: t.y, r: t.r, a: t.a, len: t.len, w: t.w, fr: t.fr });
      if (t.fr) {
        const p = G.players.find(q => q.id === t.pid);
        for (const m of G.monsters.slice()) if (!m.dying && inShape(t, m.x, m.y, m.r)) damageMonster(G, m, t.dmg, { p, src: 'meteor', noProc: true, ang: Math.atan2(m.y - t.y, m.x - t.x) });
      } else {
        const src = G.monsters.find(m => m.id === t.owner);
        for (const p of G.players) if (!p.dead && inShape(t, p.x, p.y, C().PLAYER_RADIUS * 0.6)) {
          damagePlayer(G, p, t.dmg, src);
          if (t.slow) { p.slowT = t.slowTime; p.slowPct = t.slow; Sim.msg(G, 'Вы в паутине! Скорость снижена', p.id, '#dfe8ee'); }
        }
        for (const s of G.structs) if (inShape(t, s.x, s.y, s.r)) s.hp -= t.dmg * 0.7;
      }
    }
  }

  /* ======================= СНАРЯДЫ ======================= */
  function updateProjectiles(G, dt) {
    const W = G.W, T = G.team;
    for (let i = G.projs.length - 1; i >= 0; i--) {
      const pr = G.projs[i];
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      let dead = pr.life <= 0;
      const tx = Math.floor(pr.x / W.T), ty = Math.floor(pr.y / W.T);
      const s = AB.tileSolid(W, tx, ty);
      if (s === AB.S_TREE) { const t = W.trees[W.treeAt[ty * W.N + tx]]; if (t && !t.dead && AB.dist2(pr.x, pr.y, t.x, t.y) < 100) { dead = true; Sim.fx(G, { k: 'thud', x: pr.x, y: pr.y }); } }
      else if (s === AB.S_ROCK) { dead = true; Sim.fx(G, { k: 'thud', x: pr.x, y: pr.y }); }
      if (!dead) for (const m of G.monsters.slice()) {
        if (m.dying || pr.hit.includes(m.id)) continue;
        if (AB.dist2(pr.x, pr.y, m.x, m.y) < (m.r + 5) ** 2) {
          pr.hit.push(m.id);
          const p = pr.owner !== undefined ? G.players.find(q => q.id === pr.owner) : null;
          const ang = Math.atan2(pr.vy, pr.vx);
          if (pr.src === 'weapon') {
            const c = rnd() * 100 < pr.crit;
            damageMonster(G, m, pr.dmg * (c ? pr.cm : 1), { p, src: 'weapon', ang, crit: c });
          } else {
            const marked = m.mark > 0;
            damageMonster(G, m, pr.dmg, { src: pr.src, ang, noProc: true });
            if (pr.splash) explode(G, pr.x, pr.y, pr.splash, pr.dmg * 0.5, null, m, 'cannon');
            if ((pr.src === 'turret' || pr.src === 'cannon') && marked && T.syn_shrapnel > 0) explode(G, pr.x, pr.y, 50, pr.dmg * T.syn_shrapnel / 100, null, m, 'turret');
          }
          pr.pierce--;
          if (pr.pierce <= 0) { dead = true; break; }
        }
      }
      if (dead) G.projs.splice(i, 1);
    }
  }

  function updateEnemyShots(G, dt) {
    const cfg = C(), W = G.W;
    for (let i = G.eprojs.length - 1; i >= 0; i--) {
      const e = G.eprojs[i];
      e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt;
      let dead = e.life <= 0;
      const s = AB.tileSolid(W, Math.floor(e.x / W.T), Math.floor(e.y / W.T));
      if (s === AB.S_ROCK) dead = true;
      for (const st of G.structs) if (!dead && AB.dist2(e.x, e.y, st.x, st.y) < st.r * st.r) { st.hp -= e.dmg; dead = true; }
      if (!dead) for (const p of G.players) {
        if (p.dead) continue;
        if (AB.dist2(e.x, e.y, p.x, p.y) < (cfg.PLAYER_RADIUS + cfg.ENEMY_SHOT_RADIUS) ** 2) { damagePlayer(G, p, e.dmg, G.monsters.find(m => m.id === e.src)); dead = true; break; }
      }
      if (dead) { G.eprojs.splice(i, 1); Sim.fx(G, { k: 'splat', x: e.x, y: e.y }); }
    }
  }

  function updateDrops(G, dt) {
    const cfg = C();
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i];
      d.age += dt;
      if (!cfg.AUTO_PICKUP) continue;
      if (d.age < 0.35) continue;
      let best = null, bd = Infinity, br = 0;
      for (const p of G.players) {
        if (p.dead || (d.o !== undefined && d.o !== p.id)) continue;
        const mr = cfg.MAGNET_RADIUS * (1 + p.st.pickup / 100);
        const dd = AB.dist(d.x, d.y, p.x, p.y);
        if (dd < mr && dd < bd) { bd = dd; best = p; br = mr; }
      }
      if (!best) continue;
      if (Sim.bagItem(d.k) && Sim.bagUsed(best) >= Sim.bagCap(best)) {
        best._fullT = (best._fullT || 0) - dt;
        if (best._fullT <= 0 && bd < cfg.PICKUP_RADIUS * 2) { best._fullT = cfg.BACKPACK_FULL_MSG; Sim.msg(G, `Рюкзак полон (${Sim.bagCap(best)})! Отнесите дерево на склад, а еду — на кухню или съешьте`, best.id, '#ffb36b'); }
        continue;
      }
      if (bd < cfg.PICKUP_RADIUS) {
        giveItem(G, best, d.k, 1);
        G.drops.splice(i, 1);
        Sim.fx(G, { k: 'pick', x: d.x, y: d.y, it: d.k, pid: best.id });
      } else {
        const sp = 260 * dt * (1 - bd / br + 0.3);
        d.x += ((best.x - d.x) / bd) * sp; d.y += ((best.y - d.y) / bd) * sp;
      }
    }
  }

  function updateWorld(G, dt) {
    const cfg = C(), W = G.W;
    for (const t of W.trees) {
      if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
      if (t.dead) {
        t.regrow -= dt;
        if (t.regrow <= 0) {
          const blocked = G.players.some(p => AB.dist2(p.x, p.y, t.x, t.y) < 900) || G.structs.some(s => AB.dist2(s.x, s.y, t.x, t.y) < 900);
          if (!blocked) { t.dead = false; t.hp = cfg.TREE_HP; G.treeDirty.add(t.id); } else t.regrow = 5;
        }
      }
    }
    for (const b of W.bushes) if (b.berries === 0) { b.t -= dt; if (b.t <= 0) { b.berries = 1; G.bushDirty.add(b.id); } }
    for (const pl of G.plots) {
      if (pl.crop && !pl.ready) {
        pl.t += dt * (pl.mod ? 1 + cfg.MODULES.plot.grow / 100 : 1);
        if (pl.t >= cfg.CROPS[pl.crop].grow) pl.ready = true;
      }
    }
    updateKitchen(G, dt);
    updateStore(G, dt);
    // костёр жжёт монстров (нежить — сильнее)
    G.fireT -= dt;
    if (G.fireT <= 0) {
      G.fireT = 0.5;
      for (const f of G.fires) {
        if (f.fuel <= 0) continue;
        const lv = f.lvl || 1;
        const rad = cfg.FIRE_DMG_RADIUS * (1 + cfg.FIRE_LEVEL_LIGHT * (lv - 1));
        const dps = cfg.FIRE_DPS * (1 + cfg.FIRE_DMG_PER_NIGHT * (G.day - 1)) * (1 + cfg.FIRE_DMG_LEVEL * (lv - 1));
        for (const m of G.monsters.slice()) {
          if (m.dying || m.dead || AB.dist2(m.x, m.y, f.x, f.y) > (rad + m.r) ** 2) continue;
          const und = AB.monDef(m.type).undead ? cfg.FIRE_UNDEAD_MULT : 1;
          damageMonster(G, m, dps * 0.5 * und, { src: 'fire', noProc: true, ang: Math.atan2(m.y - f.y, m.x - f.x) });
        }
      }
    }
    for (const f of G.fires) {
      f.fuel = Math.max(0, f.fuel - cfg.FIRE_BURN_RATE * dt);
      f.cap = Sim.fireCap(G, f);
      f.lvl = f.main ? G.fireLevel : 1;
      f.lm = f.mod ? 1 + cfg.MODULES.fire.light / 100 : 1;
    }
  }

  // Лесопилка: принимает бревна, пилит их в доски, подкидывает бревна в главный костёр
  function updateStore(G, dt) {
    const cfg = C(), M = cfg.MILL, S = G.store;
    for (const p of G.players) {
      if (p.dead || !(p.inv.wood > 0) || AB.dist2(p.x, p.y, S.x, S.y) > M.radius ** 2) continue;
      S.logs += p.inv.wood;
      Sim.msg(G, `На лесопилку: бревна ×${p.inv.wood}`, p.id, '#c8a06a');
      Sim.fx(G, { k: 'build', x: S.x, y: S.y });
      p.inv.wood = 0;
    }
    const cap = Sim.millCap(S);
    if (S.logs > 0 && S.planks < cap) {
      S.sawT += dt * (G.debt > 0 ? 0.5 : 1);
      const need = M.sawTime / (1 + M.sawPerLevel * (S.lvl - 1));
      if (S.sawT >= need) { S.sawT = 0; S.logs--; S.planks = Math.min(cap, S.planks + M.planksPerLog); Sim.fx(G, { k: 'saw', x: S.x, y: S.y }); }
    } else S.sawT = 0;
    S.feedT -= dt;
    const f = G.fires.find(q => q.main);
    if (M.feedFire && f && S.logs > 0 && S.feedT <= 0 && f.fuel < Sim.fireCap(G, f) * M.feedBelow) {
      S.feedT = 1; S.logs--; Sim.feedFire(G, f, cfg.FUEL_VALUES.wood);
      Sim.fx(G, { k: 'feed', x: f.x, y: f.y });
    }
  }

  /* ======================= ЭКОНОМИКА ======================= */
  // Список статей содержания: [название, монет]
  Sim.upkeepList = function (G) {
    const cfg = C(), U = cfg.UPKEEP, out = [];
    const add = (name, arr, lvl) => { const v = arr[0] + arr[1] * Math.max(0, (lvl || 1) - 1); if (v > 0) out.push([name, v]); };
    for (const s of G.structs) {
      if (s.kind === 'tower') { add('Вышка', U.tower, s.tl); if (s.armed) add('Пушка', U.cannon, s.cl); }
      else if (U[s.kind]) add(cfg.STRUCTURES[s.kind].name, U[s.kind], s.kind === 'turret' ? s.cl : Sim.bl(s));
      if (s.mod) add('Модуль', U.module, s.ml);
    }
    add('Кухня', U.kitchen, G.kitchen.lvl); add('Лесопилка', U.mill, G.store.lvl); add('Костёр', U.fire, G.fireLevel);
    return out;
  };
  Sim.upkeepTotal = function (G) {
    const cfg = C();
    let t = Sim.upkeepList(G).reduce((a, x) => a + x[1], 0);
    const th = G.structs.find(s => s.kind === 'townhall');
    if (th) t = Math.ceil(t * (1 - Math.min(90, Sim.thDiscount(th)) / 100));
    return t;
  };
  function dailyEconomy(G) {
    const cfg = C();
    const th = G.structs.find(s => s.kind === 'townhall');
    if (th) {
      const tax = Sim.thTax(G, th);
      G.coins += tax;
      Sim.msg(G, `Ратуша собрала налог: +${tax} $`, -1, '#ffd24a');
    }
    const total = Sim.upkeepTotal(G);
    G.upkeepLast = total;
    if (total <= 0) { G.debt = 0; return; }
    if (G.coins >= total) {
      G.coins -= total; G.debt = 0;
      Sim.msg(G, `Содержание построек: −${total} $ (в казне ${G.coins} $)`, -1, '#e0c890');
    } else {
      G.debt = total;
      Sim.msg(G, `Не хватает ${total - G.coins} $ на содержание! Турели и пушки отключены, кухня и лесопилка работают вполовину`, -1, '#ff8a6a');
    }
  }
  function updateEconomy(G, dt) {
    const cfg = C(), E = cfg.EXCHANGE;
    // долг гасится, как только в казне хватает монет
    if (G.debt > 0 && G.coins >= G.debt) { G.coins -= G.debt; G.debt = 0; Sim.msg(G, 'Долг за содержание оплачен — постройки снова работают', -1, '#8fe08a'); }
    // курс крипты
    if (G.structs.some(s => s.kind === 'exchange')) {
      const cr = G.crypto;
      cr.t += dt;
      if (cr.t >= E.tick) {
        cr.t = 0;
        let pr = cr.price * (1 + (rnd() - 0.48) * 2 * E.volatility);
        if (rnd() < E.eventChance) {
          const up = rnd() < 0.5, r = up ? E.pump : E.crash, k = r[0] + rnd() * (r[1] - r[0]);
          pr = cr.price * k;
          Sim.msg(G, up ? `AviCoin взлетел ×${k.toFixed(1)}!` : `Обвал AviCoin ×${k.toFixed(1)}!`, -1, up ? '#8fe08a' : '#ff8a6a');
        }
        cr.price = Math.max(E.minPrice, Math.round(pr * 10) / 10);
        cr.hist.push(cr.price); if (cr.hist.length > 40) cr.hist.shift();
      }
    }
  }

  // Полевая кухня: забирает сырую еду у подошедших игроков и готовит её
  function updateKitchen(G, dt) {
    const cfg = C(), K = G.kitchen;
    const fire = G.fires.find(f => f.main);
    const lit = !cfg.KITCHEN_NEEDS_FIRE || (fire && fire.fuel > 0);
    for (const p of G.players) {
      if (p.dead || AB.dist2(p.x, p.y, K.x, K.y) > cfg.KITCHEN_RADIUS ** 2) continue;
      const got = [];
      for (const k in cfg.COOKING) {
        const n = p.inv[k] || 0;
        if (n <= 0) continue;
        for (let i = 0; i < n; i++) K.queue.push(k);
        p.inv[k] = 0;
        got.push(`${cfg.FOOD[k].name.toLowerCase()} ×${n}`);
      }
      if (got.length) { Sim.msg(G, `На кухню: ${got.join(', ')}`, p.id, '#ffc46b'); Sim.fx(G, { k: 'rustle', x: K.x, y: K.y }); }
      if (!lit && K.queue.length && !(K.warnT > 0)) { K.warnT = 8; Sim.msg(G, 'Кухня не готовит: главный костёр погас!', p.id, '#ff9d7a'); }
    }
    K.warnT = (K.warnT || 0) - dt;
    while (K.slots.length < K.lvl && K.queue.length) K.slots.push({ k: K.queue.shift(), t: 0 });
    if (!lit) return;
    const kdt = G.debt > 0 ? dt * 0.5 : dt;
    for (let i = K.slots.length - 1; i >= 0; i--) {
      const sl = K.slots[i], ck = cfg.COOKING[sl.k];
      sl.t += kdt;
      if (sl.t >= ck.time) {
        K.slots.splice(i, 1);
        Sim.dropItem(G, ck.out, 1, K.x, K.y + 26, 14);
        Sim.fx(G, { k: 'cooked', x: K.x, y: K.y, it: ck.out });
      }
    }
  }

  function spawnLogic(G, dt) {
    const cfg = C(), W = G.W;
    G.spawnT -= dt;
    if (G.spawnT > 0) return;
    G.spawnT = G.isNight ? cfg.SPAWN_INTERVAL_NIGHT : cfg.SPAWN_INTERVAL_DAY;
    const roamers = G.monsters.filter(m => !m.guard && !m.boss).length;
    const coop = G.players.length > 1 ? cfg.COOP_MONSTER_MULT : 1;
    const max = G.isNight ? Math.min(cfg.NIGHT_MONSTERS_CAP, Math.round((cfg.NIGHT_MAX_MONSTERS + (G.day - 1) * cfg.NIGHT_MONSTERS_PER_NIGHT) * coop)) : Math.round(cfg.DAY_MAX_MONSTERS * coop);
    if (roamers >= max) return;
    const alive = G.players.filter(p => !p.dead);
    if (!alive.length) return;
    const p = alive[Math.floor(rnd() * alive.length)];
    const terr = Sim.territory(G);
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd() * TAU, d = AB.lerp(cfg.SPAWN_MIN_DIST, cfg.SPAWN_MAX_DIST, rnd());
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 150 || y < 150 || x > W.size - 150 || y > W.size - 150) continue;
      if (!AB.freeSpot(W, x, y, 14)) continue;
      if (G.players.some(q => AB.dist(q.x, q.y, x, y) < cfg.SPAWN_MIN_DIST * 0.9)) continue;
      if (AB.dist(x, y, W.camp.x, W.camp.y) < terr + 80) continue;
      if (!G.isNight && AB.dist(x, y, W.camp.x, W.camp.y) < cfg.SAFE_CAMP_RADIUS * 2) continue;
      const depth = Sim.depth(G, x, y), effDay = G.day + cfg.DEPTH_NIGHTS * depth;
      const table = cfg.SPAWN_TABLE.filter(e => e.from <= effDay && (G.isNight || e.day));
      if (!table.length) return;
      let r = rnd() * table.reduce((s, e) => s + e.weight, 0), k = 0;
      while (r > table[k].weight) { r -= table[k].weight; k++; }
      const type = table[Math.min(k, table.length - 1)].type;
      const n = type === 'spider' ? 3 : 1;
      for (let j = 0; j < n; j++) {
        const m = Sim.spawnMonster(G, type, x + j * 14, y + (j % 2) * 12, false, depth);
        if (G.isNight) m.hunter = true;
      }
      return;
    }
  }

  /* ======================= КОМАНДЫ ======================= */
  Sim.buildCost = function (p, base) { return Math.max(1, Math.round(base * (1 - Math.min(80, p.st.buildCost || 0) / 100))); };
  Sim.fireUpCost = function (G, p) {
    const c = null;
    return c === undefined ? null : Math.max(1, Math.round(c * (1 - Math.min(80, p.st.fireCost || 0) / 100)));
  };

  function placeOk(G, p, x, y, rad) {
    const W = G.W, gi = Math.floor(y / W.T) * W.N + Math.floor(x / W.T);
    if (!AB.freeSpot(W, x, y, rad) || W.ground[gi] === AB.G_WATER) { Sim.msg(G, 'Здесь нельзя строить', p.id, '#ff9d7a'); return false; }
    if (G.plots.some(q => AB.dist(q.x, q.y, x, y) < 30 + rad) || G.fires.some(q => AB.dist(q.x, q.y, x, y) < 30 + rad) || G.structs.some(s => AB.dist(s.x, s.y, x, y) < (s.r + rad) * 0.95)) {
      Sim.msg(G, 'Слишком близко к другой постройке', p.id, '#ff9d7a'); return false;
    }
    return true;
  }
  function pay(G, p, cost) {
    const have = Sim.woodOf(G, p);
    if (have < cost) { Sim.msg(G, `Нужно дерева: ${cost} (в рюкзаке ${p.inv.wood} + на складе ${G.store.wood})`, p.id, '#ff9d7a'); return false; }
    Sim.spendWood(G, p, cost); return true;
  }

  Sim.command = function (G, pid, c, x, y) {
    const cfg = C();
    const p = G.players.find(q => q.id === pid);
    if (!p || G.over) return;
    if (c === 'pick') { AB.Skills.pick(G, p, x | 0); return; }
    if (c === 'reroll') { AB.Skills.reroll(G, p); return; }
    if (c === 'goods') {
      const M = cfg.MERCHANT, g = cfg.MERCHANT_GOODS.find(q => q.id === x);
      if (!g || !G.merchant || AB.dist(p.x, p.y, G.merchant.x, G.merchant.y) > M.radius * 1.6) return;
      if (g.once && p.mgBought && p.mgBought[g.id]) { Sim.msg(G, 'Этот товар уже куплен в этот визит', p.id, '#ff9d7a'); return; }
      if (G.coins < g.price) { Sim.msg(G, `Нужно монет: ${g.price}`, p.id, '#ff9d7a'); return; }
      G.coins -= g.price;
      if (g.id === 'bag') { p.bagUp = (p.bagUp || 0) + 2; } else p.inv[g.id] = (p.inv[g.id] || 0) + 1;
      p.mgBought = p.mgBought || {}; p.mgBought[g.id] = 1;
      Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: g.name, t: 1 });
      return;
    }
    if (c === 'pickup') { pickupDrop(G, p, x); return; }
    if (c === 'dropk') {
      if (!(p.inv[x] > 0) || x === 'coin') return;
      p.inv[x]--;
      G.drops.push({ id: G.nextId++, k: x, x: p.x + (rnd() - 0.5) * 20, y: p.y + 14 + rnd() * 8, t: 0, age: 0 });
      return;
    }
    if (c === 'eatk') { eatFood(G, p, x); return; }
    if (c === 'upnear') { upgradeNear(G, p, typeof x === 'string' ? x : null); return; }
    if (c === 'build3') { buildEcon(G, p, x, y); return; }
    if (c === 'cbuy' || c === 'csell') { cryptoTrade(G, p, c, x); return; }
    if (c === 'wup') { weaponUpgrade(G, p); return; }
    if (c === 'buy' || c === 'upgrade') {
      const M = cfg.MERCHANT;
      if (!G.merchant || AB.dist(p.x, p.y, G.merchant.x, G.merchant.y) > M.radius * 1.6) { Sim.msg(G, 'Подойдите к торговцу', p.id, '#ff9d7a'); return; }
      if (M.onlyHunter && !(p.st.shopBuild > 0)) { Sim.msg(G, 'Торговец работает только с охотником', p.id, '#ff9d7a'); return; }
      if (c === 'buy') {
        const o = (p.mo || [])[x | 0];
        if (!o || o.sold) return;
        if (G.coins < o.price) { Sim.msg(G, `Нужно монет: ${o.price}`, p.id, '#ff9d7a'); return; }
        G.coins -= o.price; o.sold = 1;
        p.skills.push({ id: o.id, tier: o.tier, sup: 0 });
        AB.Skills.recalc(p);
        Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: AB.Skills.find(o.id).name, t: o.tier });
      } else {
        const list = p.skills.filter(q => q.id === x && !q.sup && q.tier < 4);
        if (!list.length) return;
        const sk = list.reduce((a, b) => (b.tier > a.tier ? b : a));
        const price = Sim.upgradePrice(sk.tier);
        if (G.coins < price) { Sim.msg(G, `Нужно монет: ${price}`, p.id, '#ff9d7a'); return; }
        G.coins -= price; sk.tier++;
        AB.Skills.recalc(p);
        Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: `${AB.Skills.find(sk.id).name} → ${cfg.TIER_NAMES[sk.tier - 1]}`, t: sk.tier });
      }
      return;
    }
    if (p.dead) return;
    let bx = x, by = y;
    if (typeof x === 'number') {
      const d = AB.dist(p.x, p.y, bx, by);
      if (d > cfg.BUILD_RANGE) { bx = p.x + (bx - p.x) / d * cfg.BUILD_RANGE; by = p.y + (by - p.y) / d * cfg.BUILD_RANGE; }
    }
    if (c === 'eat') { eatFood(G, p, null); return; }
    if (false) {
    } else if (c === 'plant') {
      const seedKey = p.inv.seed_carrot > 0 ? 'seed_carrot' : (p.inv.seed_pumpkin > 0 ? 'seed_pumpkin' : null);
      if (!seedKey) { Sim.msg(G, 'Нет семян. Ищите их в сундуках и у сильных монстров', p.id, '#ff9d7a'); return; }
      let best = null, bd = cfg.PLANT_RANGE;
      for (const pl of G.plots) { if (pl.crop) continue; const d = AB.dist(p.x, p.y, pl.x, pl.y); if (d < bd) { bd = d; best = pl; } }
      if (!best) { Sim.msg(G, 'Подойдите к свободной грядке (или постройте её клавишей G)', p.id, '#ff9d7a'); return; }
      p.inv[seedKey]--;
      best.crop = seedKey === 'seed_carrot' ? 'carrot' : 'pumpkin'; best.t = 0; best.ready = false;
      Sim.fx(G, { k: 'plant', x: best.x, y: best.y });
    } else if (c === 'bed' || c === 'fire') {
      const cost = Sim.buildCost(p, c === 'bed' ? cfg.GARDEN_BED_COST : cfg.CAMPFIRE_COST);
      if (Sim.woodOf(G, p) < cost) { pay(G, p, cost); return; }
      if (!placeOk(G, p, bx, by, 16)) return;
      pay(G, p, cost);
      if (c === 'bed') G.plots.push({ id: G.plots.length, x: bx, y: by, crop: null, t: 0, ready: false, mod: false });
      else G.fires.push({ id: G.fires.length, x: bx, y: by, fuel: cfg.FIRE_FUEL_MAX * 0.5, main: false, lvl: 1, mod: false, lm: 1, cap: cfg.FIRE_FUEL_MAX });
      Sim.fx(G, { k: 'build', x: bx, y: by });
    } else if (c === 'upfire_old') {
      const f = G.fires.find(q => q.main);
      if (AB.dist(p.x, p.y, f.x, f.y) > 110) { Sim.msg(G, 'Подойдите к главному костру в лагере', p.id, '#ff9d7a'); return; }
      const cost = Sim.fireUpCost(G, p);
      if (cost === null) { Sim.msg(G, 'Костёр уже максимального уровня', p.id); return; }
      if (!pay(G, p, cost)) return;
      G.fireLevel++;
      f.fuel = cfg.FIRE_FUEL_MAX;
      Sim.msg(G, `Костёр ур. ${G.fireLevel}! Территория расширена, новые умения: «${cfg.TIER_NAMES[G.fireLevel - 1]}»`, -1, cfg.TIER_COLORS[G.fireLevel - 1]);
      Sim.fx(G, { k: 'fireup', x: f.x, y: f.y });
    } else if (c === 'build1' || c === 'build2') {
      // T / Y: действие зависит от профессии
      const st = p.st;
      if (st.shopBuild > 0 && c === 'build1') { buildEcon(G, p, bx, by); }
      else if (st.structBuild > 0) buildStruct(G, p, c === 'build1' ? 'wall' : 'tower', bx, by);
      else if (c === 'build2') Sim.msg(G, 'Вышки строит только архитектор', p.id, '#ff9d7a');
      else if (st.turretBuild > 0) engineerBuild(G, p, bx, by);
      else if (st.moduleBuild > 0) installModule(G, p, bx, by);
      else Sim.msg(G, 'У вашей профессии нет построек — зато есть сила!', p.id, '#aab4aa');
    }
  };

  function eatFood(G, p, key) {
    const cfg = C();
    const avail = Object.keys(cfg.FOOD).filter(k => p.inv[k] > 0);
    if (!avail.length) { Sim.msg(G, 'Нет еды! Охотьтесь, собирайте ягоды, сажайте огород', p.id, '#ff9d7a'); return; }
    const need = cfg.PLAYER_MAX_FOOD - p.food, hurt = p.mhp - p.hp;
    let pick = key && p.inv[key] > 0 ? key : null;
    if (!pick) {
      let cands = avail.filter(k => cfg.FOOD[k].hp >= 0);
      if (need < 3 && !(hurt > 3 && cands.length)) { Sim.msg(G, 'Вы сыты', p.id); return; }
      if (!cands.length) cands = avail;
      cands.sort((a, b) => cfg.FOOD[a].food - cfg.FOOD[b].food);
      pick = cands[0];
      for (const k of cands) if (cfg.FOOD[k].food <= need + 4) pick = k;
    }
    const F = cfg.FOOD[pick];
    p.inv[pick]--;
    p.food = Math.min(cfg.PLAYER_MAX_FOOD, p.food + F.food);
    if (F.hp >= 0) p.hp = Math.min(p.mhp, p.hp + F.hp);
    else if (p.hp > cfg.RAW_EAT_MIN_HP) p.hp = Math.max(cfg.RAW_EAT_MIN_HP, p.hp + F.hp);
    Sim.fx(G, { k: 'eat', x: p.x, y: p.y, it: pick, pid: p.id, hp: F.hp });
    if (F.hp < 0 && !p._rawWarn) { p._rawWarn = true; Sim.msg(G, 'Сырая еда вредит здоровью. Готовьте её на полевой кухне у костра!', p.id, '#ffb36b'); }
  }

  // Подбор предмета кликом: берёт кликнутый и такие же рядом
  function pickupDrop(G, p, id) {
    const cfg = C();
    const d = G.drops.find(q => q.id === id);
    if (!d || AB.dist(p.x, p.y, d.x, d.y) > cfg.PICKUP_REACH + 14) return;
    const group = G.drops.filter(q => q.k === d.k && AB.dist2(q.x, q.y, d.x, d.y) < 40 * 40);
    let got = 0, full = false;
    for (const q of group) {
      if (!giveItem(G, p, q.k, 1)) { full = true; break; }
      G.drops.splice(G.drops.indexOf(q), 1); got++;
    }
    if (got) Sim.fx(G, { k: 'pick', x: d.x, y: d.y, it: d.k, pid: p.id, n: got });
    if (full) Sim.msg(G, `Рюкзак полон (${Sim.bagCap(p)})! Бревна — на лесопилку, шкуры — в лавку, или выбросьте лишнее (клик по ячейке рюкзака)`, p.id, '#ffb36b');
  }

  // ---------- Здания: описание, уровни, улучшения ----------
  const PROF_NAME = (k) => k === 'any' ? 'любой игрок' : ({ hunter: 'охотник', engineer: 'инженер', programmer: 'программист', architect: 'архитектор' })[k];
  const lvlCost = (l) => C().UPGRADE_COST.base + C().UPGRADE_COST.step * (l - 1);
  Sim.bl = (s) => s.bl || 1;

  // Описание здания и список «граней» улучшения
  Sim.buildingInfo = function (G, o, kind) {
    const cfg = C(), BU = cfg.BUILD_UPGRADES, asp = [];
    let title = '', desc = '', now = [];
    const push = (key, name, lvl, max, cost, prog, by, next) => asp.push({ key, name, lvl, max, cost, prog: prog || 0, by, next });
    if (kind === 'fire') {
      title = 'Главный костёр'; desc = 'Лечит игроков, жжёт монстров, отпугивает теней. Уровень определяет территорию лагеря и редкость умений.';
      now = [`Территория: ${Sim.territory(G)}`, `Редкость умений: ${cfg.TIER_NAMES[G.fireLevel - 1]}`];
      const tr = cfg.TERRITORY_RADIUS[Math.min(3, G.fireLevel)];
      const cap = Sim.fireCap(G, o);
      desc += ' Подойдите с бревнами или углём — они сами уходят в огонь. Заполните шкалу до конца — костёр получит уровень, и шкала расширится.';
      now = [`Топливо: ${Math.floor(o.fuel)}/${cap} (прогорает ${cfg.FIRE_BURN_RATE}/с)`].concat(now);
      push('fire', 'Шкала костра', G.fireLevel, Sim.fireMaxLevel(), cap, Math.floor(o.fuel), 'feed', G.fireLevel < Sim.fireMaxLevel() ? `шкала +${cfg.FIRE_LEVEL_STEPS[G.fireLevel]}, территория ${tr}, умения «${cfg.TIER_NAMES[Math.min(3, G.fireLevel)]}»` : 'максимальный уровень — поддерживайте огонь');
    } else if (kind === 'kitchen') {
      title = 'Полевая кухня'; desc = 'Подойдите — сырая еда из рюкзака начнёт готовиться. Готовка идёт, пока горит главный костёр.';
      now = [`Готовит одновременно: ${o.lvl}`, `В очереди: ${o.queue ? o.queue.length : 0}`];
      push('kitchen', 'Кухня', o.lvl, cfg.KITCHEN_MAX_LEVEL, lvlCost(o.lvl), o.up, 'any', `${o.lvl + 1} блюд одновременно`);
    } else if (kind === 'mill') {
      title = 'Лесопилка'; desc = 'Подойдите — бревна из рюкзака выгрузятся. Пилит бревна в доски, подкидывает бревна в главный костёр.';
      now = [`Доски: ${o.planks}/${Sim.millCap(o)}`, `Бревна в очереди: ${o.logs}`];
      push('mill', 'Лесопилка', o.lvl, cfg.MILL.maxLevel, lvlCost(o.lvl), o.up, 'any', `вместимость ${Sim.millCap({ lvl: o.lvl + 1 })}, пилит быстрее`);
    } else {
      const S = cfg.STRUCTURES[o.kind], up = o.up || {}, bl = Sim.bl(o);
      title = S.name;
      if (o.kind === 'wall') { desc = 'Монстры не могут пройти и пытаются сломать. С модулем программиста бьёт током.'; now = [`Прочность: ${Math.round(o.hp)}/${Math.round(o.mhp)}`]; }
      if (o.kind === 'tower') { desc = 'Разгоняет туман вокруг. Инженер ставит на неё пушку (T рядом), программист — модуль (T рядом): без пушки модуль превращает вышку в лазер.'; now = [`Прочность: ${Math.round(o.hp)}/${Math.round(o.mhp)}`, o.armed ? 'Пушка установлена' : 'Без пушки', o.mod ? 'Модуль установлен' : 'Без модуля']; }
      if (o.kind === 'turret') { desc = 'Автоматически стреляет по монстрам. Урон растёт с инженерией владельца и с каждой ночью.'; now = [`Прочность: ${Math.round(o.hp)}/${Math.round(o.mhp)}`, o.mod ? 'Модуль «Наведение»' : 'Без модуля']; }
      if (o.kind === 'shop') { desc = 'Подойдите со шкурами, готовой едой или досками — товары сдаются и медленно продаются, рядом появляются монеты.'; now = [`Товаров: ${o.stockN !== undefined ? o.stockN : (o.stock || []).length}`, `Продажа: ${Math.round(Sim.shopSellTime(o) * 10) / 10} с/товар`]; }
      if (o.kind === 'exchange') { desc = 'Майнит монеты. Подойдите, чтобы покупать и продавать AviCoin.'; now = [`Майнинг: ${Sim.exMine(G, o)} $ раз в ${Math.round(Sim.exRate(o))} с`, `Курс: ${G.crypto.price} $`]; }
      if (o.kind === 'workshop') { desc = 'Подойдите с оружием в руках, чтобы улучшить его за монеты и доски (+15% урона за уровень).'; now = [`Оружие улучшается до ур. ${Sim.wsMax(G)}`]; }
      if (o.kind === 'townhall') { desc = 'Снижает содержание всех построек и каждый рассвет собирает налог.'; now = [`Скидка на содержание: ${Sim.thDiscount(o)}%`, `Налог: ~${Sim.thTax(G, o)} $/день`]; }
      if (o.kind === 'tower') push('tl', 'Вышка', o.tl || 1, cfg.TOWER_LEVELS.max, cfg.TOWER_LEVELS.cost[(o.tl || 1) - 1], up.tl, 'architect', `+${cfg.TOWER_LEVELS.hp * 100}% прочности, +${cfg.TOWER_LEVELS.range * 100}% дальности`);
      if ((o.kind === 'tower' && o.armed) || o.kind === 'turret') push('cl', o.kind === 'turret' ? 'Турель' : 'Пушка', o.cl || 1, cfg.CANNON_LEVELS.max, cfg.CANNON_LEVELS.cost[(o.cl || 1) - 1], up.cl, 'engineer', `+${cfg.CANNON_LEVELS.dmg * 100}% урона`);
      if (o.mod) push('ml', 'Модуль', o.ml || 1, cfg.MODULE_LEVELS.max, cfg.MODULE_LEVELS.cost[(o.ml || 1) - 1], up.ml, 'programmer', `+${cfg.MODULE_LEVELS.mult * 100}% силы модуля`);
      const B = BU[o.kind];
      if (B) {
        const nx = ({ wall: () => `+${B.hp * 100}% прочности`, shop: () => `продажа на ${B.speed * 100}% быстрее, цены +${B.price * 100}%`, exchange: () => `+${B.mine} $ за майнинг, на ${B.rate * 100}% чаще`, workshop: () => `оружие до ур. ${B.weaponMax[bl] || ''}`, townhall: () => `скидка +${B.discount}%, налог +${B.tax * 100}%` })[o.kind]();
        push('bl', title, bl, B.max, B.cost[bl - 1], up.bl, B.by, nx);
      }
      const u = cfg.UPKEEP[o.kind]; if (u) now.push(`Содержание: ${u[0] + u[1] * Math.max(0, bl - 1)} $/день`);
    }
    return { o, kind, title, desc, now, asp };
  };
  Sim.canUpgrade = (p, a) => a.by === 'any' || p.prof === a.by;  // 'feed' — только подбрасыванием топлива

  Sim.nearestBuilding = function (G, p) {
    const R2 = C().UPGRADE_RANGE ** 2;
    const c = [];
    const f = G.fires.find(q => q.main); if (f) c.push([f, 'fire']);
    if (G.kitchen) c.push([G.kitchen, 'kitchen']);
    if (G.store) c.push([G.store, 'mill']);
    for (const s of G.structs) c.push([s, 'struct']);
    let best = null, bd = R2;
    for (const [o, k] of c) { const d = AB.dist2(p.x, p.y, o.x, o.y); if (d < bd) { bd = d; best = [o, k]; } }
    return best ? Sim.buildingInfo(G, best[0], best[1]) : null;
  };
  // для подсказки U: первая грань, которую этот игрок может улучшить
  Sim.upgradeInfo = function (G, p) {
    const b = Sim.nearestBuilding(G, p);
    if (!b) return null;
    const a = b.asp.find(x => Sim.canUpgrade(p, x) && x.lvl < x.max && x.cost != null) || b.asp.find(x => Sim.canUpgrade(p, x));
    return a ? Object.assign({ o: b.o }, a) : null;
  };

  // эффекты уровней
  Sim.shopSellTime = (s) => C().SHOP.sellTime / (1 + C().BUILD_UPGRADES.shop.speed * (Sim.bl(s) - 1));
  Sim.shopPrice = (s, k) => Math.max(1, Math.round((C().SHOP.prices[k] || 1) * (1 + C().BUILD_UPGRADES.shop.price * (Sim.bl(s) - 1))));
  Sim.exRate = (s) => C().EXCHANGE.mineEvery / (1 + C().BUILD_UPGRADES.exchange.rate * (Sim.bl(s) - 1));
  Sim.exMine = (G, s) => { const o = G.players.find(p => p.id === s.owner) || { st: {} }; return C().EXCHANGE.mineCoins + Math.floor((o.st.eng || 0) / 4) + C().BUILD_UPGRADES.exchange.mine * (Sim.bl(s) - 1); };
  Sim.wsMax = (G) => { const w = G.structs.filter(s => s.kind === 'workshop'); if (!w.length) return 0; return Math.max(...w.map(s => C().BUILD_UPGRADES.workshop.weaponMax[Sim.bl(s) - 1])); };
  Sim.thDiscount = (s) => C().TOWNHALL.upkeepDiscount + C().BUILD_UPGRADES.townhall.discount * (Sim.bl(s) - 1);
  Sim.thTax = (G, s) => Math.round((C().TOWNHALL.taxBase + Math.floor(G.structs.length / C().TOWNHALL.taxPerStructs)) * (1 + C().BUILD_UPGRADES.townhall.tax * (Sim.bl(s) - 1)));

  function upgradeNear(G, p, key) {
    const cfg = C(), b = Sim.nearestBuilding(G, p);
    if (!b) { Sim.msg(G, 'Подойдите к зданию, чтобы улучшить его', p.id, '#aab4aa'); return; }
    const info = key ? b.asp.find(a => a.key === key) : (b.asp.find(x => Sim.canUpgrade(p, x) && x.lvl < x.max && x.cost != null) || b.asp[0]);
    if (!info) { Sim.msg(G, `${b.title}: улучшений нет`, p.id); return; }
    if (info.by === 'feed') { Sim.msg(G, 'Костёр растёт от топлива: подойдите с бревнами или углём', p.id, '#ffc46b'); return; }
    if (!Sim.canUpgrade(p, info)) { Sim.msg(G, `${info.name} улучшает ${PROF_NAME(info.by)}`, p.id, '#ff9d7a'); return; }
    if (info.lvl >= info.max || info.cost == null) { Sim.msg(G, `${info.name}: максимальный уровень`, p.id); return; }
    const have = Sim.woodOf(G, p);
    const put = Math.min(have, info.cost - info.prog);
    if (put <= 0) { Sim.msg(G, `Нужны доски (${info.prog}/${info.cost}). Несите бревна на лесопилку`, p.id, '#ff9d7a'); return; }
    Sim.spendWood(G, p, put);
    const o = b.o, prog = info.prog + put;
    const set = (v) => {
      if (info.key === 'fire') G.fireUp = v;
      else if (info.key === 'kitchen' || info.key === 'mill') o.up = v;
      else { o.up = o.up || {}; o.up[info.key] = v; }
    };
    if (prog < info.cost) { set(prog); Sim.msg(G, `${info.name}: вложено ${prog}/${info.cost} досок`, p.id, '#e0c890'); Sim.fx(G, { k: 'build', x: o.x, y: o.y }); return; }
    set(0);
    if (info.key === 'fire') {
      G.fireLevel++; o.fuel = cfg.FIRE_FUEL_MAX;
      Sim.msg(G, `Костёр ур. ${G.fireLevel}! Территория расширена, новые умения: «${cfg.TIER_NAMES[G.fireLevel - 1]}»`, -1, cfg.TIER_COLORS[G.fireLevel - 1]);
      Sim.fx(G, { k: 'fireup', x: o.x, y: o.y });
      return;
    }
    let lv;
    if (info.key === 'kitchen' || info.key === 'mill') lv = ++o.lvl;
    else if (info.key === 'tl') { lv = o.tl = (o.tl || 1) + 1; const k = 1 + cfg.TOWER_LEVELS.hp; o.mhp *= k; o.hp = Math.min(o.mhp, o.hp * k); }
    else if (info.key === 'cl') lv = o.cl = (o.cl || 1) + 1;
    else if (info.key === 'ml') lv = o.ml = (o.ml || 1) + 1;
    else if (info.key === 'bl') {
      lv = o.bl = Sim.bl(o) + 1;
      if (o.kind === 'wall') { const k = 1 + cfg.BUILD_UPGRADES.wall.hp; o.mhp *= k; o.hp = Math.min(o.mhp, o.hp * k); }
    }
    Sim.msg(G, `${info.name} улучшен до ур. ${lv}!`, -1, '#8fe08a');
    Sim.fx(G, { k: 'fireup', x: o.x, y: o.y });
  }

  // Экономическое здание профессии (клавиша H)
  function buildEcon(G, p, x, y) {
    const cfg = C(), kind = cfg.ECON_BUILDINGS[p.prof];
    if (!kind) return;
    if (G.structs.some(q => q.kind === kind && q.owner === p.id)) { Sim.msg(G, `${cfg.STRUCTURES[kind].name} уже построена`, p.id, '#ff9d7a'); return; }
    const d = AB.dist(p.x, p.y, x, y);
    if (d > cfg.BUILD_RANGE) { x = p.x + (x - p.x) / d * cfg.BUILD_RANGE; y = p.y + (y - p.y) / d * cfg.BUILD_RANGE; }
    buildStruct(G, p, kind, x, y);
  }

  function cryptoTrade(G, p, c, n) {
    const cr = G.crypto;
    if (!G.structs.some(s => s.kind === 'exchange' && AB.dist2(p.x, p.y, s.x, s.y) < 90 * 90)) { Sim.msg(G, 'Подойдите к бирже', p.id, '#ff9d7a'); return; }
    if (c === 'cbuy') {
      const k = Math.min(n | 0 || 1, Math.floor(G.coins / cr.price));
      if (k <= 0) { Sim.msg(G, `Нужно ${Math.ceil(cr.price)} $ за 1 AviCoin`, p.id, '#ff9d7a'); return; }
      G.coins -= Math.ceil(cr.price * k); cr.held += k;
      Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: `Куплено ${k} AviCoin`, t: 2 });
    } else {
      const k = n === 'all' ? cr.held : Math.min(n | 0 || 1, cr.held);
      if (k <= 0) return;
      const got = Math.floor(cr.price * k);
      cr.held -= k; G.coins += got;
      Sim.fx(G, { k: 'sold', x: p.x, y: p.y, n: got });
    }
  }

  function weaponUpgrade(G, p) {
    const cfg = C(), W = cfg.WORKSHOP;
    if (!G.structs.some(s => s.kind === 'workshop' && AB.dist2(p.x, p.y, s.x, s.y) < 90 * 90)) { Sim.msg(G, 'Подойдите к мастерской инженера', p.id, '#ff9d7a'); return; }
    p.wl = p.wl || {};
    const lv = p.wl[p.w] || 0;
    const wmax = Math.min(W.maxLevel, Sim.wsMax(G));
    if (lv >= wmax) { Sim.msg(G, lv >= W.maxLevel ? 'Оружие улучшено до максимума' : `Улучшите мастерскую, чтобы поднять оружие выше ур. ${wmax}`, p.id); return; }
    if (G.coins < W.coins[lv] || Sim.woodOf(G, p) < W.planks[lv]) { Sim.msg(G, `Нужно ${W.coins[lv]} $ и ${W.planks[lv]} досок`, p.id, '#ff9d7a'); return; }
    G.coins -= W.coins[lv]; Sim.spendWood(G, p, W.planks[lv]);
    p.wl[p.w] = lv + 1;
    Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: `${cfg.WEAPONS[p.w].name} +${lv + 1}`, t: Math.min(4, lv + 1) });
  }

  function buildStruct(G, p, kind, x, y) {
    const cfg = C(), S = cfg.STRUCTURES[kind];
    const cost = Sim.buildCost(p, S.cost);
    if (Sim.woodOf(G, p) < cost) { pay(G, p, cost); return; }
    if (!placeOk(G, p, x, y, S.radius)) return;
    pay(G, p, cost);
    const mhp = S.hp * (1 + (p.st.structHp || 0) / 100);
    G.structs.push({ id: G.nextId++, kind, x, y, hp: mhp, mhp, r: S.radius, owner: p.id, armed: false, mod: false, cd: 0, a: 0, stock: [], sellT: 0, tl: 1, cl: 1, ml: 1, up: {} });
    Sim.fx(G, { k: 'build', x, y });
  }

  function engineerBuild(G, p, x, y) {
    const cfg = C();
    // рядом с вышкой — поставить пушку
    const tw = G.structs.find(s => s.kind === 'tower' && !s.armed && AB.dist(s.x, s.y, x, y) < 50);
    if (tw) {
      if (!pay(G, p, Sim.buildCost(p, cfg.CANNON.cost))) return;
      tw.armed = true; tw.armedBy = p.id;
      Sim.msg(G, 'Пушка установлена на вышку!', -1, '#ffb23a');
      Sim.fx(G, { k: 'build', x: tw.x, y: tw.y - 30 });
      return;
    }
    const max = cfg.TURRET.baseMax + Math.floor((p.st.eng || 0) / cfg.TURRET.perEng) + (p.st.turretMax || 0);
    const have = G.structs.filter(s => s.kind === 'turret' && s.owner === p.id).length;
    if (have >= max) { Sim.msg(G, `Максимум турелей: ${max} (растёт с инженерией)`, p.id, '#ff9d7a'); return; }
    buildStruct(G, p, 'turret', x, y);
  }

  function installModule(G, p, x, y) {
    const cfg = C();
    let best = null, bd = 70 * 70, kind = null;
    const test = (o, k) => { const d = AB.dist2(o.x, o.y, x, y); if (!o.mod && d < bd) { bd = d; best = o; kind = k; } };
    G.structs.filter(s => s.kind !== 'shop').forEach(s => test(s, s.kind === 'turret' ? 'turret' : s.kind === 'tower' ? (s.armed ? 'turret' : 'tower') : 'wall'));
    G.fires.forEach(f => test(f, 'fire'));
    G.plots.forEach(pl => test(pl, 'plot'));
    if (!best) { Sim.msg(G, 'Наведите курсор на постройку, костёр или грядку без модуля', p.id, '#ff9d7a'); return; }
    if (!pay(G, p, cfg.MODULE_COST)) return;
    best.mod = true; best.modBy = p.id;
    Sim.msg(G, `Модуль «${cfg.MODULES[kind].name}» установлен`, -1, '#5aa8ff');
    Sim.fx(G, { k: 'module', x: best.x, y: best.y });
  }

  /* ======================= СЕТЬ ======================= */
  const r1 = (v) => Math.round(v * 10) / 10;
  function stCompact(st) { const o = {}; for (const k in st) if (st[k]) o[k] = Math.round(st[k] * 100) / 100; return o; }
  Sim.snapshot = function (G, full) {
    const W = G.W;
    const s = {
      t: 's', c: G.clock, o: G.over, k: G.stats.kills, fl: G.fireLevel, nb: G.nextBoss,
      p: G.players.map(p => ({
        id: p.id, n: p.name, pr: p.prof, x: r1(p.x), y: r1(p.y), a: r1(p.a), hp: r1(p.hp), mh: r1(p.mhp), f: r1(p.food), d: p.dead ? 1 : 0, rs: r1(p.rs),
        w: p.w, ws: p.ws, inv: p.inv, sw: r1(p.sw), sk: p.sk, sa: r1(p.sa), tp: p.tp, h: r1(p.hurt), mv: p.moving ? 1 : 0,
        sl: p.slowT > 0 ? p.slowPct : 0, mo: p.mo || [], wl: p.wl || {}, bu: p.bagUp || 0, mg: p.mgBought || {}, lv: p.level, q: p.queue, of: p.offers, sks: p.skills.map(q => q.id + ':' + q.tier + ':' + (q.sup || 0)), st: stCompact(p.st), rr: p.rr, swl: p.swl,
      })),
      m: G.monsters.map(m => [m.id, MON_TYPES.indexOf(m.type), r1(m.x), r1(m.y), r1(m.a), Math.round(m.hp), Math.round(m.maxHp), m.hurt > 0 ? 1 : 0,
        (m.guard ? 1 : 0) | (m.hunter ? 2 : 0) | (m.st === 'chase' ? 4 : 0) | ((m.atk || 0) > 0 ? 8 : 0) | (m.burn ? 16 : 0) | (m.slowT > 0 ? 32 : 0) | (m.act ? 64 : 0) | (m.mark > 0 ? 128 : 0),
        m.dying > 0 ? r1(m.dying) : 0, m.act ? m.act.k : 0]),
      pr: G.projs.map(p => [p.id, p.k, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy)]),
      ep: G.eprojs.map(e => [r1(e.x), r1(e.y), Math.round(e.vx), Math.round(e.vy)]),
      te: G.tele.map(t => [t.sh, r1(t.x), r1(t.y), t.r || 0, r1(t.a || 0), t.len || 0, t.w || 0, Math.round(t.t / t.dur * 100) / 100, t.fr]),
      stc: G.structs.map(q => [q.id, q.kind, r1(q.x), r1(q.y), Math.round(q.hp), Math.round(q.mhp), q.owner, q.armed ? 1 : 0, q.mod ? 1 : 0, r1(q.a), q.stock ? q.stock.length : 0, q.stock && q.stock.length ? Math.round(q.sellT / C().SHOP.sellTime * 100) / 100 : 0, q.tl || 1, q.cl || 1, q.ml || 1, q.up || {}, q.bl || 1]),
      mc: G.merchant ? [G.merchant.x, G.merchant.y] : 0,
      mn: G.mines.map(q => [r1(q.x), r1(q.y)]),
      d: G.drops.map(d => [d.id, d.k, r1(d.x), r1(d.y)]),
      pl: G.plots.map(p => [r1(p.x), r1(p.y), p.crop, Math.round(p.t), p.ready ? 1 : 0, p.mod ? 1 : 0]),
      f: G.fires.map(f => [r1(f.x), r1(f.y), r1(f.fuel), f.main ? 1 : 0, f.lvl, f.mod ? 1 : 0, f.lm, f.cap || Sim.fireCap(G, f)]),
      ch: W.sites.filter(s2 => s2.opened).map(s2 => s2.id),
      so: [G.store.x, G.store.y, G.store.logs, G.store.planks, G.store.lvl, G.store.up, Math.round(G.store.sawT * 10) / 10],
      eco: [G.coins, G.fireUp, G.debt, G.upkeepLast, Math.round(G.crypto.price * 10) / 10, G.crypto.held, G.crypto.hist],
      bag: G.players.map(p => p.bagUp || 0),
      kl: [G.kitchen.lvl, G.kitchen.up],
      kc: [G.kitchen.x, G.kitchen.y, G.kitchen.slots.map(q => [q.k, Math.round(q.t / C().COOKING[q.k].time * 100) / 100]), G.kitchen.queue.length],
      fx: G.fxOut,
    };
    const trees = [], bushes = [];
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

  Sim.applySnapshot = function (G, s, myId) {
    const W = G.W, cfg = C();
    G.clock = s.c; G.stats.kills = s.k; G.fireLevel = s.fl; G.nextBoss = s.nb;
    const ti = Sim.timeInfo(G.clock); G.day = ti.day; G.isNight = ti.isNight; G.nightF = ti.nightF;
    if (s.o && !G.over) G.over = s.o;
    s.p.forEach(sp => {
      let p = G.players.find(q => q.id === sp.id);
      if (!p) { p = { id: sp.id, x: sp.x, y: sp.y, tp: sp.tp, droneCd: [] }; G.players.push(p); }
      const mine = sp.id === myId;
      if (!mine || sp.tp !== p.tp || sp.d) { p.tx = sp.x; p.ty = sp.y; if (mine || p.x === undefined) { p.x = sp.x; p.y = sp.y; } }
      if (!mine) { p.a = sp.a; p.moving = !!sp.mv; }
      p.name = sp.n; p.prof = sp.pr; p.hp = sp.hp; p.mhp = sp.mh; p.food = sp.f; p.dead = !!sp.d; p.rs = sp.rs;
      p.ws = sp.ws; p.inv = sp.inv; p.sw = sp.sw; p.sk = sp.sk; p.sa = sp.sa; p.tp = sp.tp; p.hurt = sp.h;
      p.mo = sp.mo; p.wl = sp.wl; p.bagUp = sp.bu; p.mgBought = sp.mg; p.slowT = sp.sl ? 1 : 0; p.slowPct = sp.sl || 0; p.level = sp.lv; p.queue = sp.q; p.offers = sp.of; p.rr = sp.rr; p.swl = sp.swl;
      p.skills = sp.sks.map(x => { const a = x.split(':'); return { id: a[0], tier: +a[1], sup: +a[2] }; });
      const st = {}; AB.Skills.statKeys().forEach(k => st[k] = sp.st[k] || 0); p.st = st;
      if (!mine || !p.ws.includes(p.w)) p.w = sp.w;
      if (mine && p._lastWs && p.ws.length > p._lastWs) p.w = sp.w;
      p._lastWs = p.ws.length;
    });
    const map = new Map(G.monsters.map(m => [m.id, m]));
    G.monsters = s.m.map(a => {
      let m = map.get(a[0]);
      if (!m) m = { id: a[0], x: a[2], y: a[3], vx: 0, vy: 0 };
      m.type = MON_TYPES[a[1]]; m.tx = a[2]; m.ty = a[3]; m.a = a[4]; m.hp = a[5]; m.maxHp = a[6];
      m.hurt = a[7] ? 0.1 : 0; const f = a[8];
      m.guard = !!(f & 1); m.hunter = !!(f & 2); m.st = f & 4 ? 'chase' : 'idle'; m.atk = f & 8 ? 0.2 : 0;
      m.burn = f & 16 ? {} : null; m.slowT = f & 32 ? 1 : 0; m.mark = f & 128 ? 1 : 0;
      m.act = f & 64 ? { k: a[10] } : null;
      m.dying = a[9]; m.r = AB.monDef(m.type).radius; m.boss = AB.isBoss(m.type);
      return m;
    });
    G.projs = s.pr.map(a => ({ id: a[0], k: a[1], x: a[2], y: a[3], vx: a[4], vy: a[5] }));
    G.eprojs = s.ep.map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3] }));
    G.tele = s.te.map(a => ({ sh: a[0], x: a[1], y: a[2], r: a[3], a: a[4], len: a[5], w: a[6], prog: a[7], fr: a[8] }));
    G.structs = s.stc.map(a => ({ id: a[0], kind: a[1], x: a[2], y: a[3], hp: a[4], mhp: a[5], owner: a[6], armed: !!a[7], mod: !!a[8], a: a[9], r: cfg.STRUCTURES[a[1]].radius, stockN: a[10], sellP: a[11], tl: a[12], cl: a[13], ml: a[14], up: a[15], bl: a[16] }));
    G.merchant = s.mc ? { x: s.mc[0], y: s.mc[1] } : null;
    G.mines = s.mn.map(a => ({ x: a[0], y: a[1] }));
    const dmap = new Map(G.drops.map(d => [d.id, d]));
    G.drops = s.d.map(a => { const o = dmap.get(a[0]); return { id: a[0], k: a[1], x: a[2], y: a[3], age: o ? o.age : 0 }; });
    G.plots = s.pl.map((a, i) => ({ id: i, x: a[0], y: a[1], crop: a[2], t: a[3], ready: !!a[4], mod: !!a[5] }));
    G.fires = s.f.map((a, i) => ({ id: i, x: a[0], y: a[1], fuel: a[2], main: !!a[3], lvl: a[4], mod: !!a[5], lm: a[6], cap: a[7] }));
    s.ch.forEach(id => { if (W.sites[id]) W.sites[id].opened = true; });
    if (s.so) G.store = { x: s.so[0], y: s.so[1], logs: s.so[2], planks: s.so[3], lvl: s.so[4], up: s.so[5], sawT: s.so[6] };
    if (s.eco) { G.coins = s.eco[0]; G.fireUp = s.eco[1]; G.debt = s.eco[2]; G.upkeepLast = s.eco[3]; G.crypto = { price: s.eco[4], held: s.eco[5], hist: s.eco[6] }; }
    if (s.bag) G.players.forEach((p, i) => { p.bagUp = s.bag[i] || 0; });
    if (s.kc) G.kitchen = { x: s.kc[0], y: s.kc[1], slots: s.kc[2].map(a => ({ k: a[0], prog: a[1] })), queue: new Array(s.kc[3]), lvl: s.kl ? s.kl[0] : 1, up: s.kl ? s.kl[1] : 0 };
    s.tr.forEach(a => { const t = W.trees[a[0]]; if (t) { if (a[1] < t.hp && !a[2]) t.shake = 0.35; t.hp = a[1]; t.dead = !!a[2]; } });
    s.bu.forEach(a => { const b = W.bushes[a[0]]; if (b) b.berries = a[1]; });
    if (AB.FX) s.fx.forEach(ev => AB.FX.play(ev));
  };

  function fireLight(f) {
    const cfg = C();
    return cfg.FIRE_LIGHT_RADIUS * (0.35 + 0.65 * Math.min(1, f.fuel / ((f.cap || cfg.FIRE_FUEL_MAX) * 0.5))) * (1 + cfg.FIRE_LEVEL_LIGHT * ((f.lvl || 1) - 1)) * (f.lm || 1);
  }
  AB.fireLight = fireLight;
})(window.AB);
