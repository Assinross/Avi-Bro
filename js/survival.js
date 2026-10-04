/* ============================================================================
 * Avi-Bro — режим ВЫЖИВАНИЕ: логика.
 *
 * Всё, что отличает Выживание, живёт здесь и включается только когда
 * AB.difficulty === 'survival' (см. survival.js с числами, ключи SV_*).
 * Общие файлы вызывают тонкие хуки: если on(G) ложь — режим не активен и
 * игра работает по обычным правилам.
 *
 * Разделы: аффиксы элиты · телеграфы атак (замах) · экономика босса ·
 * карты-модификаторы навыков · итоги забега и рекорд.
 * ==========================================================================*/
(function (AB) {
  const C = () => window.CONFIG;
  const rnd = Math.random;
  const SV = AB.Survival = {};

  /* ------------------------------ включение ------------------------------ */
  // Хуки симуляции: только в живой игре Выживания.
  SV.on = function (G) { return AB.difficulty === 'survival' && !!G && !G.over; };
  // Для UI (экран итогов рисуется, когда G.over уже стоит).
  SV.isMode = function () { return AB.difficulty === 'survival'; };

  /* ============================ АФФИКСЫ ЭЛИТЫ ============================ */
  // Пул случайных свойств монстров (Diablo-стиль). Виден игроку подписью
  // над монстром и окраской; значения механик — здесь.
  const AFFIXES = {
    fast:      { name: 'БЫСТРЫЙ',     color: '#ffe07a' }, // скорость x1.4
    armored:   { name: 'БРОНЕНОСНЫЙ', color: '#9fb8c8' }, // броня +5 (формула ARMOR_K)
    fat:       { name: 'ЖИРНЫЙ',      color: '#c88a5a' }, // HP x2, скорость x0.8
    explosive: { name: 'ВЗРЫВНОЙ',    color: '#ff8a5a' }, // взрыв при смерти (см. sim.js, killMonster)
    vampire:   { name: 'ВАМПИР',      color: '#ff5a7a' }, // лечится на 50% урона по героям
    summoner:  { name: 'ПРИЗЫВАТЕЛЬ', color: '#c07aff' }, // раз в 8 с призывает волка (макс. 4)
    frost:     { name: 'ЛЕДЯНОЙ',     color: '#7ad4ff' }, // удар замедляет героя на 30% на 2 с
    flame:     { name: 'ОГНЕННЫЙ',    color: '#ff9d3a' }, // удар: +30% огненного урона
    shield:    { name: 'ЩИТОВОЙ',     color: '#7ae0b0' }, // щит: 30% урона поглощает, вне боя 10%/с
    frenzy:    { name: 'СУМАТОХА',    color: '#ff4a4a' }, // при HP<50% скорость x1.3
  };
  const AFFIX_POOL = Object.keys(AFFIXES);

  // Назначить аффиксы при спавне (хук из Sim.spawnMonster). Босс — по ночам,
  // остальные — по шансу элиты; у одного монстра аффиксы не повторяются.
  SV.affixSpawn = function (G, m) {
    const cfg = C(), A = cfg.SV_AFFIX, day = G.day || 1;
    m.aff = null; m.arm = 0; m.sh = 0; m.stunT = 0; m.rec = 0; m.svSumT = 8;
    let count = 0;
    if (m.boss) {
      if (day >= A.boss3) count = 3;
      else if (day >= A.boss2) count = 2;
      else if (day >= A.bossFrom) count = 1;
    } else if (day >= A.from) {
      const p = Math.min(A.cap, A.chance * (day - A.from + 1));
      if (rnd() < p) {
        count = 1;
        if (day >= A.tier2 && rnd() < A.tierChance) count++;
        if (day >= A.tier3 && rnd() < A.tierChance) count++;
      }
    }
    if (!count) return;
    const pool = AFFIX_POOL.slice();
    m.aff = [];
    for (let i = 0; i < count && pool.length; i++) m.aff.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    for (const id of m.aff) {
      if (id === 'fat') { m.hp *= 2; m.maxHp *= 2; }
      else if (id === 'armored') m.arm += 5;
      else if (id === 'shield') { m.shMax = m.maxHp * 0.3; m.sh = m.shMax; }
    }
    SV.applySpeed(m);
  };

  // Итоговая скорость: база x аффиксы (fast/fat) x суматоха.
  SV.applySpeed = function (m) {
    if (m.svBase === undefined) m.svBase = m.speed;
    let k = 1;
    if (m.aff) for (const id of m.aff) {
      if (id === 'fast') k *= 1.4;
      else if (id === 'fat') k *= 0.8;
    }
    if (m.aff && m.aff.indexOf('frenzy') >= 0 && m.hp < m.maxHp * 0.5) k *= 1.3;
    m.speed = m.svBase * k;
  };

  // Тик аффиксов — раз в кадр для каждого живого монстра (хук из апдейта монстров).
  SV.affixTick = function (G, m, dt) {
    if (!m.aff) return;
    SV.applySpeed(m);
    if (m.bleed && m.bleed.t > 0) {
      m.bleed.t -= dt; m.bleed.tick -= dt;
      if (m.bleed.tick <= 0 && !m.dead && !m.dying) {
        m.bleed.tick = 0.5;
        AB.Sim.damageMonster(G, m, m.bleed.dps * 0.5, { noProc: true });
        if (m.dead) return;
      }
    }
    if (m.aff.indexOf('shield') >= 0 && m.shMax && m.hurt <= 0 && m.sh < m.shMax) {
      m.sh = Math.min(m.shMax, m.sh + m.shMax * 0.1 * dt);
    }
    if (m.aff.indexOf('summoner') >= 0) {
      m.svSumT -= dt;
      if (m.svSumT <= 0) {
        m.svSumT = 8;
        const own = G.monsters.filter(q => q.svOwner === m.id && !q.dead && !q.dying).length;
        if (own < 4) {
          const q = AB.Sim.spawnMonster(G, 'wolf', m.x + rnd() * 44 - 22, m.y + rnd() * 44 - 22, false, 0, 1, m.lv);
          q.svOwner = m.id; q.nodrop = true; q.hunter = true;
        }
      }
    }
  };

  // Подпись аффикса над монстром (хук из render.js).
  SV.affixLabel = function (m) {
    if (!m.aff || !m.aff.length) return null;
    const a = AFFIXES[m.aff[0]];
    return { text: m.aff.length > 1 ? a.name + ' +' + (m.aff.length - 1) : a.name, color: a.color, super: m.aff.length >= 2 };
  };

  // Входящий урон по монстру: броня БРОНЕНОСНОГО и щит ЩИТОВОГО (хук из damageMonster).
  SV.monsterDamageIn = function (G, m, dmg) {
    const cfg = C();
    if (m.arm) dmg *= cfg.ARMOR_K / (cfg.ARMOR_K + m.arm);
    if (m.sh > 0) { const a = Math.min(m.sh, dmg * 0.3); m.sh -= a; dmg -= a; }
    return dmg;
  };

  // Аффиксы, срабатывающие когда монстр бьёт героя (хук из damagePlayer).
  SV.onPlayerHit = function (G, p, dmg, src) {
    if (!src || src.hp === undefined || !src.aff) return;
    if (src.aff.indexOf('vampire') >= 0) src.hp = Math.min(src.maxHp, src.hp + dmg * 0.5);
    if (src.aff.indexOf('frost') >= 0) { p.slowT = 2; p.slowPct = Math.min(70, Math.max(p.slowPct || 0, 30)); }
  };

  /* ========================= ТЕЛЕГРАФЫ АТАК (ЗАМАХ) ====================== *
   * Зона удара не показывается. О намерении говорят поза и движение:
   * обычный удар — короткий замах с отклоном-сжатием, супер-удар — долгий
   * замах с раздуванием, дрожью и пульсирующим контуром (см. render.js).
   * Удар в конце замаха бьёт по фактическому положению: отошёл — промах.  */
  SV.tryAttack = function (G, m, np, dt) {
    if (m.rec > 0) m.rec -= dt;
    if (m.wu > 0) {
      m.wu -= dt;
      if (m.wu <= 0) SV.strike(G, m, np);
      return;
    }
    if (m.atkCd > 0 || !np) return;
    const cfg = C(), W = cfg.SV_WINDUP;
    const reach = m.r + cfg.PLAYER_RADIUS + 6;
    if (np.d >= reach) return;
    const big = (cfg.SV_BIG || []).indexOf(m.type) >= 0;
    const sup = ((m.aff && m.aff.length >= 2) || big) && rnd() < (W.superChance || 0);
    m.sup = sup;
    m.wu = m.wuMax = sup ? W.super : W.normal;
    if (sup && np.p && AB.dist(m.x, m.y, np.p.x, np.p.y) < 700) AB.Sound.play('growl', 1); // подсказка слухом
  };

  // Удар в конце замаха.
  SV.strike = function (G, m, np) {
    const cfg = C(), W = cfg.SV_WINDUP;
    const sup = !!m.sup;
    m.wu = 0; m.wuMax = 0; m.sup = false;
    m.atkCd = sup ? 1.2 : 0.8;
    m.atk = 0.25;                       // вспышка удара (как в обычной игре)
    m.rec = W.recover || 0.3;           // восстановление: монстр на миг прикован к месту
    if (!np || np.d > (m.r + cfg.PLAYER_RADIUS + 6) * (sup ? (W.superR || 1.6) : 1)) return; // промах
    let dmg = m.dmg !== undefined ? m.dmg : m.contact; // у обычных монстров урон в m.dmg, contact - только у боссов
    if (sup) dmg *= W.superDmg || 2;
    if (m.aff && m.aff.indexOf('flame') >= 0) dmg *= 1.3;
    AB.Sim.damagePlayer(G, np.p, dmg, m);
  };

  /* ====================== ЭКОНОМИКА: МОНЕТЫ С БОССА ====================== */
  // Награда за убитого босса — сразу в казну, с учётом контрактов и обвала биржи.
  SV.bossPayout = function (G, m) {
    const cfg = C(), B = cfg.SV_BOSS_COINS, night = G.day || 1;
    let n = B.base + B.perNight * (night - 1) + Math.floor(rnd() * (B.dice + 1));
    let mult = 1;
    for (const s of G.structs) {
      const rate = (cfg.SV_CONTRACTS || {})[s.kind];
      if (rate) mult += rate * (AB.Sim.bl(s) || 1);
    }
    const crash = !!G.svCrash;
    if (crash) mult *= 0.5;
    n = Math.round(n * mult);
    G.coins += n;
    G.svBossKills = (G.svBossKills || 0) + 1;
    AB.Sim.msg(G, `Босс повержен: казна +${n} $` + (crash ? ' · обвал биржи!' : ''), -1, crash ? '#ff9d7a' : '#ffd24a');
    G.svCrash = false; // обвал действует одну ночь
  };

  // Рассвет: непобеждённый босс уходит, бросок обвала биржи на новую ночь.
  SV.dawn = function (G) {
    const cfg = C(), B = cfg.SV_BOSS_COINS;
    const boss = G.monsters.find(m => m.boss && !m.dying && !m.dead);
    if (boss) {
      boss.nodrop = true; boss.dying = 1.2;
      G.coins += B.miss;
      AB.Sim.msg(G, `Босс ушёл с рассветом. Из его логова вынесли ${B.miss} $`, -1, '#c8b890');
    }
    G.svCrash = G.structs.some(s => s.kind === 'exchange') && rnd() < (cfg.SV_CRASH_CHANCE || 0);
  };

  /* ================== КАРТЫ-МОДИФИКАТОРЫ БОЕВЫХ НАВЫКОВ ================= *
   * Оффер при уровне опыта — пара «навык + эффект». У навыка до 3 слотов
   * эффектов (повторы запрещены); «Чистая сила» не занимает слот и стакается. */
  const CARDS = {
    power:   { name: 'Чистая сила',   desc: 'Урон навыка +25%. Без эффекта' },
    pierce:  { name: 'Пробивание',    desc: 'Снаряды пробивают +2 врагов' },
    proj:    { name: 'Доп. снаряд',   desc: '+1 снаряд, удар или цель' },
    crit:    { name: 'Крит',          desc: 'Шанс крита +10%' },
    haste:   { name: 'Спешка',        desc: 'Перезарядка -15%' },
    range:   { name: 'Дальнобойность', desc: 'Дальность и радиус +20%' },
    burn:    { name: 'Поджог',        desc: 'Поджигает: 40% урона/с на 3 с' },
    slow:    { name: 'Замедление',    desc: 'Попадание замедляет врага на 30%' },
    chain:   { name: 'Цепь',          desc: 'Шанс 50%: урон перескакивает на 2 врагов' },
    explode: { name: 'Взрыв',         desc: 'Шанс 40%: взрыв, 50% урона по площади' },
    leech:   { name: 'Вампиризм',     desc: 'Лечит 5% нанесённого урона' },
    knock:   { name: 'Отбрасывание',  desc: 'Отбрасывание +8' },
    home:    { name: 'Самонаведение', desc: 'Снаряды следуют за врагом' },
    bleed:   { name: 'Разрыв',        desc: 'Кровотечение: 20% урона за 4 с' },
    stun:    { name: 'Оглушение',     desc: 'Шанс 15% оглушить на 0.4 с' },
  };
  SV.CARDS = CARDS;
  SV.cardName = (id) => (CARDS[id] ? CARDS[id].name : id);
  SV.cardDesc = (id) => (CARDS[id] ? CARDS[id].desc : '');

  // Выбрать карту для оффера (хук из Sim.makeAbOffers).
  SV.rollCard = function (G, p, o) {
    const inst = p.ab.find(a => a.id === o.id);
    const have = inst ? (inst.mods || []) : [];
    const pool = Object.keys(CARDS).filter(id => id !== 'power' && have.indexOf(id) < 0);
    o.card = !inst || have.length >= 3 || !pool.length ? 'power' : pool[Math.floor(rnd() * pool.length)];
  };

  // Забрать карту вместе с уровнем навыка (хук из pickAbility).
  SV.takeCard = function (G, p, o) {
    if (!o.card) return;
    const inst = p.ab.find(a => a.id === o.id);
    if (!inst) return;
    if (o.card === 'power') inst.pwBonus = (inst.pwBonus || 0) + 1;
    else { inst.mods = inst.mods || []; inst.mods.push(o.card); }
    AB.Sim.msg(G, `${AB.Sim.abDef(o.id).name}: карта «${CARDS[o.card].name}» — ${CARDS[o.card].desc}`, p.id, '#ffd24a');
  };

  // Применить моды навыка к его боевым параметрам (хук из Sim.abStats).
  SV.applyMods = function (S, a, p) {
    S._cards = {};
    if (a.pwBonus) S.dmg *= 1 + 0.25 * a.pwBonus;
    for (const id of a.mods || []) {
      if (id === 'pierce') S.pierce += 2;
      else if (id === 'proj') S.n += 1;
      else if (id === 'crit') S.crit += 10;
      else if (id === 'haste') S.cd *= 0.85;
      else if (id === 'range') S.range *= 1.2;
      else if (id === 'knock') S._kb = (S._kb || 0) + 8;
      else S._cards[id] = 1;
    }
  };

  // Карточки навыка по его экземпляру (для путей попадания, где S недоступен: снаряды, удары с неба).
  SV.cardsOf = function (p, abId) {
    if (!p || !abId) return null;
    const a = (p.ab || []).find(q => q.id === abId);
    if (!a || (!a.mods && !a.pwBonus)) return null;
    const c = {};
    for (const id of a.mods || []) c[id] = 1;
    return c;
  };

  // Proc-эффекты карт при попадании навыка (хук из hitAb).
  SV.hitMods = function (G, m, dmg, p, S) {
    const c = S._cards;
    if (!c || m.dead || m.dying) return;
    const cfg = C();
    if (c.burn) { const dps = dmg * 0.4; if (!m.burn || !(m.burn.t > 0) || (m.burn.dps || 0) <= dps) m.burn = { dps, t: 3, p: p && p.id, tick: 0.5 }; }
    if (c.bleed && !m.bleed) m.bleed = { dps: dmg * 0.05, t: 4, tick: 0.5 };
    if (c.slow) { m.slowT = cfg.SLOW_TIME; m.slowPct = Math.min(70, Math.max(m.slowPct || 0, 30)); }
    if (c.leech && p) p.hp = Math.min(p.mhp, p.hp + dmg * 0.05);
    if (c.stun && rnd() * 100 < 15) m.stunT = 0.4;
    if (c.chain && rnd() < 0.5) {
      const near = G.monsters.filter(q => q !== m && !q.dying && !q.dead && AB.dist2(m.x, m.y, q.x, q.y) < (cfg.CHAIN_RANGE || 160) ** 2)
        .sort((a, b) => AB.dist2(m.x, m.y, a.x, a.y) - AB.dist2(m.x, m.y, b.x, b.y)).slice(0, cfg.CHAIN_TARGETS || 2);
      for (const q of near) { AB.Sim.damageMonster(G, q, dmg * (cfg.CHAIN_DMG || 0.5), { p, noProc: true }); AB.Sim.fx(G, { k: 'zap', x: q.x, y: q.y }); }
    }
    if (c.explode && rnd() < 0.4) {
      const R = cfg.EXPLODE_RADIUS || 60;
      for (const q of G.monsters) if (q !== m && !q.dying && !q.dead && AB.dist2(m.x, m.y, q.x, q.y) < (R + q.r) ** 2) AB.Sim.damageMonster(G, q, dmg * (cfg.EXPLODE_DMG || 0.5), { p, noProc: true });
      AB.Sim.fx(G, { k: 'boom', x: m.x, y: m.y, r: R });
    }
  };

  /* ======================== ИТОГИ ЗАБЕГА И РЕКОРД ======================== */
  const REC_KEY = 'avibro-survival-record';

  SV.record = function () { try { return JSON.parse(localStorage.getItem(REC_KEY) || 'null'); } catch (e) { return null; } };
  SV.recordLabel = function () { const r = SV.record(); return r ? `Рекорд Выживания: ночь ${r.nights}` : ''; };

  // Конец забега: итоги + обновление рекорда (вызывает main.js, сейв удаляет он же).
  SV.gameEnd = function (G, win) {
    const ti = AB.Sim.timeInfo(G.clock), cfg = C();
    const nights = win ? cfg.NIGHTS_TO_WIN : Math.max(0, ti.day - 1);
    const lv = G.players.reduce((a, p) => Math.max(a, p.level || 1), 1);
    const xl = G.players.reduce((a, p) => Math.max(a, p.xl || 1), 1);
    const kills = (G.stats && G.stats.kills) || 0;
    const bosses = G.svBossKills || 0;
    const rec = SV.record();
    const better = !rec || nights > rec.nights || (nights === rec.nights && lv > (rec.lv || 0));
    if (better) { try { localStorage.setItem(REC_KEY, JSON.stringify({ nights, lv, xl, kills, bosses, at: Date.now() })); } catch (e) { /* нет localStorage */ } }
    const text = (win ? '<b>ЛЕГЕНДА: 99 ночей пережито!</b><br><br>' : '') +
      `Вы продержались до ночи <b>${nights}</b><br>` +
      `Уровень героя: ${lv} · Опыт: ${xl} · Боссов повержено: ${bosses} · Убийств: ${kills}` +
      (better ? '<br><span style="color:#ffd24a">Новый рекорд!</span>' : (rec ? `<br>Рекорд: ночь ${rec.nights}` : ''));
    return { nights, better, text };
  };
})(window.AB);
