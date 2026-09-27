// Игровая логика. Выполняется у одиночного игрока и у ХОСТА (гость получает готовое состояние).
(function (AB) {
  const C = () => window.CONFIG;
  const TAU = Math.PI * 2;
  const MON_TYPES = ['wolf', 'ghoul', 'shade', 'brute', 'alpha', 'spider', 'spitter', 'giant', 'packlord', 'witch', 'golem'];
  AB.MON_TYPES = MON_TYPES;
  const ITEM_KEYS = ['wood', 'meat', 'berry', 'carrot', 'pumpkin', 'seed_carrot', 'seed_pumpkin'];
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
    };
    if (mode !== 'guest') {
      W.sites.forEach((s) => {
        s.guards.forEach((type, k) => {
          const a = (k / s.guards.length) * TAU;
          const m = Sim.spawnMonster(G, type, s.x + Math.cos(a) * 55, s.y + Math.sin(a) * 55, true);
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
      level: 1, queue: [], offers: null, skills: [], rr: 0, st: {}, swl: 0,
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

  Sim.spawnMonster = function (G, type, x, y, guard) {
    const cfg = C(), def = AB.monDef(type);
    const hm = guard ? 1 : Sim.hpMult(G.day), dm = guard ? 1 : Sim.dmgMult(G.day);
    const m = {
      id: G.nextId++, type, x, y, a: rnd() * TAU, hp: def.hp * hm, maxHp: def.hp * hm,
      dmg: def.damage * dm, speed: def.speed * cfg.MOVE_SPEED_MULT * (0.92 + rnd() * 0.16), r: def.radius,
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
    return cfg.PLAYER_SPEED * cfg.MOVE_SPEED_MULT * Math.max(0.4, 1 + s / 100);
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
    if (G.players.length && G.players.every(p => p.dead)) { G.over = 'lose'; Sim.fx(G, { k: 'over', s: 'lose' }); }
  };

  function onNight(G) {
    const cfg = C();
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
    Sim.msg(G, `Рассвет! Пережито ночей: ${prevDay} из ${cfg.NIGHTS_TO_WIN}`, -1, '#ffd98a');
    G.monsters.forEach(m => { if (!m.boss) m.hunter = false; if (m.type === 'shade') m.dying = 1.2; });
    for (const p of G.players) {
      p.level++;
      p.queue.push(p.level % cfg.SUPER_EVERY === 0 ? 's' : 'n');
      if (p.st.harvest > 0) { p.inv.wood += Math.round(p.st.harvest); Sim.msg(G, `Собиратель: +${Math.round(p.st.harvest)} дерева`, p.id, '#c8f0a0'); }
      AB.Skills.ensureOffers(G, p);
      Sim.fx(G, { k: 'lvl', x: p.x, y: p.y, pid: p.id, n: p.level, sup: p.level % cfg.SUPER_EVERY === 0 ? 1 : 0 });
    }
  }

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
    p.inv[k] = (p.inv[k] || 0) + n;
    return true;
  }

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
    G.stats.kills++;
    if (m.boss) { bossReward(G, m); return; }
    const luck = p ? p.st.luck : 0;
    let meat = def.meat[0] + Math.floor(rnd() * (def.meat[1] - def.meat[0] + 1));
    const mb = p ? p.st.meatBonus : (G.team.meatBonus || 0) / Math.max(1, G.players.length);
    if (mb > 0 && rnd() * 100 < mb) meat++;
    if (meat > 0) Sim.dropItem(G, 'meat', meat, m.x, m.y, 12);
    if (rnd() < def.seedChance * (1 + luck / 100)) Sim.dropItem(G, rnd() < 0.7 ? 'seed_carrot' : 'seed_pumpkin', 1, m.x, m.y, 12);
    if (p && p.st.killHeal > 0 && !p.dead) p.hp = Math.min(p.mhp, p.hp + p.st.killHeal);
  }

  function bossReward(G, m) {
    const cfg = C(), R = cfg.BOSS_REWARD;
    Sim.dropItem(G, 'meat', R.meat, m.x, m.y, 40);
    Sim.dropItem(G, 'wood', R.wood, m.x, m.y, 40);
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
        if (d < cfg.FIRE_FEED_RADIUS && f.fuel < cfg.FIRE_FUEL_MAX * cfg.FIRE_FEED_BELOW && p.inv.wood > 0 && p.feedCd <= 0) {
          p.inv.wood--; f.fuel = Math.min(cfg.FIRE_FUEL_MAX, f.fuel + cfg.FUEL_PER_WOOD); p.feedCd = 0.4;
          Sim.fx(G, { k: 'feed', x: f.x, y: f.y });
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
    const dmg = Math.max(1, (w.damage + (melee ? st.melee : st.ranged)) * (1 + dmgPct / 100));
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
      for (const k in s.loot) { Sim.dropItem(G, k, s.loot[k], s.x, s.y + 14, 26); found.push(`${AB.itemName(k)} ×${s.loot[k]}`); }
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
      if (s.kind === 'turret' || (s.kind === 'tower' && (s.armed || s.mod))) {
        let range, dmg, cdv, speed, src, extra = {};
        if (s.kind === 'turret') {
          const Tt = cfg.TURRET, eng = owner.st.eng || 0;
          range = Tt.range; dmg = Tt.damage + eng * Tt.engScale; cdv = Tt.cooldown; speed = Tt.projSpeed; src = 'turret';
          dmg *= 1 + (owner.st.turretDmg || 0) / 100;
          if (s.mod) { dmg *= 1 + cfg.MODULES.turret.dmg / 100; range *= 1 + cfg.MODULES.turret.range / 100; cdv /= 1 + (T.syn_compat || 0) / 100; }
          if (owner.st.syn_caliber > 0 && G.structs.some(o => o !== s && o.kind !== 'turret' && AB.dist2(o.x, o.y, s.x, s.y) < 150 * 150)) dmg *= 1 + owner.st.syn_caliber / 100;
        } else if (s.armed) {
          const Cn = cfg.CANNON, eng = (G.players.find(p => p.id === s.armedBy) || owner).st.eng || 0;
          range = Cn.range; dmg = (Cn.damage + eng * Cn.engScale) * (1 + (T.syn_mount || 0) / 100); cdv = Cn.cooldown; speed = Cn.projSpeed; src = 'cannon';
          extra.splash = Cn.splash;
          if (s.mod) { dmg *= 1 + cfg.MODULES.turret.dmg * modMult(G, s) / 100; range *= 1 + cfg.MODULES.turret.range / 100; cdv /= 1 + (T.syn_compat || 0) / 100; }
        } else {
          const Lz = cfg.MODULES.tower, prog = G.players.find(p => p.id === s.modBy) || owner;
          range = Lz.range; dmg = (Lz.damage + (prog.st.eng || 0) * Lz.engScale) * modMult(G, s); cdv = Lz.cooldown; speed = 900; src = 'laser';
        }
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
        m.wT -= dt;
        if (m.wT <= 0) {
          m.wT = 2 + rnd() * 4;
          const a = rnd() * TAU, d = rnd() * (m.guard ? 120 : 200);
          m.wx = (m.guard ? m.home.x : m.x) + Math.cos(a) * d; m.wy = (m.guard ? m.home.y : m.y) + Math.sin(a) * d;
        }
        if (AB.dist2(m.x, m.y, m.wx, m.wy) > 100) { tx = m.wx; ty = m.wy; sp *= 0.4; }
      }
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
            const dps = (s.mod ? (cfg.MODULES.wall.damage + (own.st.eng || 0) * cfg.MODULES.wall.engScale) * modMult(G, s) : 0) + fenceDps;
            m.fenceT = (m.fenceT || 0) - dt;
            if (m.fenceT <= 0) { m.fenceT = 0.5; m.slowT = 1; m.slowPct = Math.max(m.slowPct || 0, cfg.MODULES.wall.slow); damageMonster(G, m, dps * 0.5, { src: 'fence', noProc: true }); Sim.fx(G, { k: 'zap', x: (m.x + s.x) / 2, y: (m.y + s.y) / 2 }); }
          }
          if (m.st === 'chase' && m.atkCd <= 0 && (!np || np.d > m.r + cfg.PLAYER_RADIUS + 10)) { m.atkCd = def.attackCd; m.atk = 0.25; s.hp -= m.dmg; Sim.fx(G, { k: 'shit', x: s.x, y: s.y }); }
        }
      }
      if (m.dead) continue;
      const moved = Math.hypot(m.x - ox, m.y - oy), want = Math.hypot(mvx, mvy);
      if (want > 0.5 && moved < want * 0.35 && m.stuck <= 0) { m.stuck = 0.6; m.side = rnd() < 0.5 ? 1 : -1; }
      m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);
      if (np && m.st === 'chase' && !def.ranged && np.d < m.r + cfg.PLAYER_RADIUS + 8 && m.atkCd <= 0) {
        m.atkCd = def.attackCd; m.atk = 0.25;
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
      Sim.fx(G, { k: 'strike', sh: t.sh, x: t.x, y: t.y, r: t.r, a: t.a, len: t.len, w: t.w, fr: t.fr });
      if (t.fr) {
        const p = G.players.find(q => q.id === t.pid);
        for (const m of G.monsters.slice()) if (!m.dying && inShape(t, m.x, m.y, m.r)) damageMonster(G, m, t.dmg, { p, src: 'meteor', noProc: true, ang: Math.atan2(m.y - t.y, m.x - t.x) });
      } else {
        const src = G.monsters.find(m => m.id === t.owner);
        for (const p of G.players) if (!p.dead && inShape(t, p.x, p.y, C().PLAYER_RADIUS * 0.6)) damagePlayer(G, p, t.dmg, src);
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
      if (d.age < 0.35) continue;
      let best = null, bd = Infinity, br = 0;
      for (const p of G.players) {
        if (p.dead) continue;
        const mr = cfg.MAGNET_RADIUS * (1 + p.st.pickup / 100);
        const dd = AB.dist(d.x, d.y, p.x, p.y);
        if (dd < mr && dd < bd) { bd = dd; best = p; br = mr; }
      }
      if (!best) continue;
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
    for (const f of G.fires) {
      f.fuel = Math.max(0, f.fuel - cfg.FIRE_BURN_RATE * dt);
      f.lvl = f.main ? G.fireLevel : 1;
      f.lm = f.mod ? 1 + cfg.MODULES.fire.light / 100 : 1;
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
    const table = cfg.SPAWN_TABLE.filter(e => e.from <= G.day && (G.isNight || e.day));
    if (!table.length) return;
    const p = alive[Math.floor(rnd() * alive.length)];
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd() * TAU, d = AB.lerp(cfg.SPAWN_MIN_DIST, cfg.SPAWN_MAX_DIST, rnd());
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 150 || y < 150 || x > W.size - 150 || y > W.size - 150) continue;
      if (!AB.freeSpot(W, x, y, 14)) continue;
      if (G.players.some(q => AB.dist(q.x, q.y, x, y) < cfg.SPAWN_MIN_DIST * 0.9)) continue;
      if (!G.isNight && AB.dist(x, y, W.camp.x, W.camp.y) < cfg.SAFE_CAMP_RADIUS * 2) continue;
      let r = rnd() * table.reduce((s, e) => s + e.weight, 0), k = 0;
      while (r > table[k].weight) { r -= table[k].weight; k++; }
      const type = table[Math.min(k, table.length - 1)].type;
      const n = type === 'spider' ? 3 : 1;
      for (let j = 0; j < n; j++) {
        const m = Sim.spawnMonster(G, type, x + j * 14, y + (j % 2) * 12, false);
        if (G.isNight) m.hunter = true;
      }
      return;
    }
  }

  /* ======================= КОМАНДЫ ======================= */
  Sim.buildCost = function (p, base) { return Math.max(1, Math.round(base * (1 - Math.min(80, p.st.buildCost || 0) / 100))); };
  Sim.fireUpCost = function (G, p) {
    const c = C().FIRE_UPGRADE_COST[G.fireLevel - 1];
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
    if (p.inv.wood < cost) { Sim.msg(G, `Нужно дерева: ${cost} (есть ${p.inv.wood})`, p.id, '#ff9d7a'); return false; }
    p.inv.wood -= cost; return true;
  }

  Sim.command = function (G, pid, c, x, y) {
    const cfg = C();
    const p = G.players.find(q => q.id === pid);
    if (!p || G.over) return;
    if (c === 'pick') { AB.Skills.pick(G, p, x | 0); return; }
    if (c === 'reroll') { AB.Skills.reroll(G, p); return; }
    if (p.dead) return;
    let bx = x, by = y;
    if (typeof x === 'number') {
      const d = AB.dist(p.x, p.y, bx, by);
      if (d > cfg.BUILD_RANGE) { bx = p.x + (bx - p.x) / d * cfg.BUILD_RANGE; by = p.y + (by - p.y) / d * cfg.BUILD_RANGE; }
    }
    if (c === 'eat') {
      const miss = p.mhp - p.hp > 10 ? 999 : cfg.PLAYER_MAX_FOOD - p.food;
      const need = cfg.PLAYER_MAX_FOOD - p.food;
      const avail = Object.keys(cfg.FOOD).filter(k => p.inv[k] > 0);
      if (!avail.length) { Sim.msg(G, 'Нет еды! Охотьтесь или сажайте огород', p.id, '#ff9d7a'); return; }
      if (need < 3 && miss < 3) { Sim.msg(G, 'Вы сыты', p.id); return; }
      avail.sort((a, b) => cfg.FOOD[a].food - cfg.FOOD[b].food);
      let pick = avail[0];
      for (const k of avail) if (cfg.FOOD[k].food <= need + 4) pick = k;
      p.inv[pick]--;
      p.food = Math.min(cfg.PLAYER_MAX_FOOD, p.food + cfg.FOOD[pick].food);
      p.hp = Math.min(p.mhp, p.hp + cfg.FOOD[pick].hp);
      Sim.fx(G, { k: 'eat', x: p.x, y: p.y, it: pick, pid: p.id });
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
      if (p.inv.wood < cost) { pay(G, p, cost); return; }
      if (!placeOk(G, p, bx, by, 16)) return;
      pay(G, p, cost);
      if (c === 'bed') G.plots.push({ id: G.plots.length, x: bx, y: by, crop: null, t: 0, ready: false, mod: false });
      else G.fires.push({ id: G.fires.length, x: bx, y: by, fuel: cfg.FIRE_FUEL_MAX * 0.5, main: false, lvl: 1, mod: false, lm: 1 });
      Sim.fx(G, { k: 'build', x: bx, y: by });
    } else if (c === 'upfire') {
      const f = G.fires.find(q => q.main);
      if (AB.dist(p.x, p.y, f.x, f.y) > 110) { Sim.msg(G, 'Подойдите к главному костру в лагере', p.id, '#ff9d7a'); return; }
      const cost = Sim.fireUpCost(G, p);
      if (cost === null) { Sim.msg(G, 'Костёр уже максимального уровня', p.id); return; }
      if (!pay(G, p, cost)) return;
      G.fireLevel++;
      f.fuel = cfg.FIRE_FUEL_MAX;
      Sim.msg(G, `Костёр ур. ${G.fireLevel}! Новые умения: «${cfg.TIER_NAMES[G.fireLevel - 1]}»`, -1, cfg.TIER_COLORS[G.fireLevel - 1]);
      Sim.fx(G, { k: 'fireup', x: f.x, y: f.y });
    } else if (c === 'build1' || c === 'build2') {
      // T / Y: действие зависит от профессии
      const st = p.st;
      if (st.structBuild > 0) buildStruct(G, p, c === 'build1' ? 'wall' : 'tower', bx, by);
      else if (c === 'build2') Sim.msg(G, 'Вышки строит только архитектор', p.id, '#ff9d7a');
      else if (st.turretBuild > 0) engineerBuild(G, p, bx, by);
      else if (st.moduleBuild > 0) installModule(G, p, bx, by);
      else Sim.msg(G, 'У вашей профессии нет построек — зато есть сила!', p.id, '#aab4aa');
    }
  };

  function buildStruct(G, p, kind, x, y) {
    const cfg = C(), S = cfg.STRUCTURES[kind];
    const cost = Sim.buildCost(p, S.cost);
    if (p.inv.wood < cost) { pay(G, p, cost); return; }
    if (!placeOk(G, p, x, y, S.radius)) return;
    pay(G, p, cost);
    const mhp = S.hp * (1 + (p.st.structHp || 0) / 100);
    G.structs.push({ id: G.nextId++, kind, x, y, hp: mhp, mhp, r: S.radius, owner: p.id, armed: false, mod: false, cd: 0, a: 0 });
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
    G.structs.forEach(s => test(s, s.kind === 'turret' ? 'turret' : s.kind === 'tower' ? (s.armed ? 'turret' : 'tower') : 'wall'));
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
        lv: p.level, q: p.queue, of: p.offers, sks: p.skills.map(q => q.id + ':' + q.tier + ':' + (q.sup || 0)), st: stCompact(p.st), rr: p.rr, swl: p.swl,
      })),
      m: G.monsters.map(m => [m.id, MON_TYPES.indexOf(m.type), r1(m.x), r1(m.y), r1(m.a), Math.round(m.hp), Math.round(m.maxHp), m.hurt > 0 ? 1 : 0,
        (m.guard ? 1 : 0) | (m.hunter ? 2 : 0) | (m.st === 'chase' ? 4 : 0) | ((m.atk || 0) > 0 ? 8 : 0) | (m.burn ? 16 : 0) | (m.slowT > 0 ? 32 : 0) | (m.act ? 64 : 0) | (m.mark > 0 ? 128 : 0),
        m.dying > 0 ? r1(m.dying) : 0, m.act ? m.act.k : 0]),
      pr: G.projs.map(p => [p.id, p.k, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy)]),
      ep: G.eprojs.map(e => [r1(e.x), r1(e.y), Math.round(e.vx), Math.round(e.vy)]),
      te: G.tele.map(t => [t.sh, r1(t.x), r1(t.y), t.r || 0, r1(t.a || 0), t.len || 0, t.w || 0, Math.round(t.t / t.dur * 100) / 100, t.fr]),
      stc: G.structs.map(q => [q.id, q.kind, r1(q.x), r1(q.y), Math.round(q.hp), Math.round(q.mhp), q.owner, q.armed ? 1 : 0, q.mod ? 1 : 0, r1(q.a)]),
      mn: G.mines.map(q => [r1(q.x), r1(q.y)]),
      d: G.drops.map(d => [d.id, d.k, r1(d.x), r1(d.y)]),
      pl: G.plots.map(p => [r1(p.x), r1(p.y), p.crop, Math.round(p.t), p.ready ? 1 : 0, p.mod ? 1 : 0]),
      f: G.fires.map(f => [r1(f.x), r1(f.y), r1(f.fuel), f.main ? 1 : 0, f.lvl, f.mod ? 1 : 0, f.lm]),
      ch: W.sites.filter(s2 => s2.opened).map(s2 => s2.id),
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
      p.level = sp.lv; p.queue = sp.q; p.offers = sp.of; p.rr = sp.rr; p.swl = sp.swl;
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
    G.structs = s.stc.map(a => ({ id: a[0], kind: a[1], x: a[2], y: a[3], hp: a[4], mhp: a[5], owner: a[6], armed: !!a[7], mod: !!a[8], a: a[9], r: cfg.STRUCTURES[a[1]].radius }));
    G.mines = s.mn.map(a => ({ x: a[0], y: a[1] }));
    const dmap = new Map(G.drops.map(d => [d.id, d]));
    G.drops = s.d.map(a => { const o = dmap.get(a[0]); return { id: a[0], k: a[1], x: a[2], y: a[3], age: o ? o.age : 0 }; });
    G.plots = s.pl.map((a, i) => ({ id: i, x: a[0], y: a[1], crop: a[2], t: a[3], ready: !!a[4], mod: !!a[5] }));
    G.fires = s.f.map((a, i) => ({ id: i, x: a[0], y: a[1], fuel: a[2], main: !!a[3], lvl: a[4], mod: !!a[5], lm: a[6] }));
    s.ch.forEach(id => { if (W.sites[id]) W.sites[id].opened = true; });
    s.tr.forEach(a => { const t = W.trees[a[0]]; if (t) { if (a[1] < t.hp && !a[2]) t.shake = 0.35; t.hp = a[1]; t.dead = !!a[2]; } });
    s.bu.forEach(a => { const b = W.bushes[a[0]]; if (b) b.berries = a[1]; });
    if (AB.FX) s.fx.forEach(ev => AB.FX.play(ev));
  };

  function fireLight(f) {
    const cfg = C();
    return cfg.FIRE_LIGHT_RADIUS * (0.35 + 0.65 * Math.min(1, f.fuel / (cfg.FIRE_FUEL_MAX * 0.6))) * (1 + cfg.FIRE_LEVEL_LIGHT * ((f.lvl || 1) - 1)) * (f.lm || 1);
  }
  AB.fireLight = fireLight;
})(window.AB);
