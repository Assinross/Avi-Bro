// Развитие персонажа: характеристики, умения, профессии, выбор при повышении уровня.
(function (AB) {
  const C = () => window.CONFIG;
  const Sk = AB.Skills = {};

  // Все ключи характеристик
  Sk.statKeys = function () {
    if (Sk._keys) return Sk._keys;
    const set = new Set(Object.keys(C().STAT_LABELS));
    ['turretBuild', 'moduleBuild', 'structBuild', 'mark', 'shopBuild'].forEach(k => set.add(k));
    Sk._keys = Array.from(set);
    return Sk._keys;
  };
  Sk.find = function (id) {
    return C().SKILLS.find(s => s.id === id) || C().SUPER_SKILLS.find(s => s.id === id);
  };
  const val = (v, tier) => Array.isArray(v) ? (v[Math.max(0, Math.min(v.length - 1, tier - 1))] || 0) : v;
  Sk.value = val;

  // Пересчитать характеристики игрока
  Sk.recalc = function (p) {
    const cfg = C();
    const st = {};
    Sk.statKeys().forEach(k => st[k] = 0);
    const prof = cfg.PROFESSIONS[p.prof];
    if (prof) for (const k in prof.stats) st[k] = (st[k] || 0) + prof.stats[k];
    for (const s of p.skills) {
      const def = Sk.find(s.id);
      if (!def) continue;
      for (const k in def.stats) st[k] = (st[k] || 0) + val(def.stats[k], s.tier);
    }
    const oldM = p.mhp || cfg.PLAYER_MAX_HP;
    p.st = st;
    p.mhp = Math.max(20, cfg.PLAYER_MAX_HP + st.maxHp);
    if (p.mhp > oldM) p.hp += p.mhp - oldM;
    p.hp = Math.min(p.hp, p.mhp);
  };

  // Описание умения: строки «+12% Урон»
  Sk.lines = function (def, tier) {
    const L = C().STAT_LABELS, out = [];
    for (const k in def.stats) {
      const v = val(def.stats[k], tier);
      if (!v || !L[k]) continue;
      const num = Math.round(v * 100) / 100;
      out.push({ s: `${v > 0 ? '+' : ''}${num}${L[k][1] ? '%' : ''} ${L[k][0]}`, bad: v < 0 });
    }
    return out;
  };

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Сгенерировать варианты для игрока. kind: 'n' — обычное, 's' — супер
  Sk.makeOffers = function (G, p, kind) {
    const cfg = C();
    const owned = new Set(p.skills.map(s => s.id));
    const n = cfg.SKILL_CHOICES;
    if (kind === 's') {
      const pool = shuffle(cfg.SUPER_SKILLS.filter(s => !owned.has(s.id)));
      if (pool.length) return pool.slice(0, n).map(s => ({ id: s.id, tier: 4, sup: 1 }));
    }
    const profs = new Set(G.players.map(q => q.prof));
    const pool = cfg.SKILLS.filter(s => (!s.prof || s.prof === p.prof) && (!s.partner || profs.has(s.partner)) && (!s.unique || !owned.has(s.id)));
    const base = kind === 's' ? 4 : G.fireLevel;
    const out = [];
    for (let i = 0; i < n; i++) {
      let tier = base;
      if (tier < 4 && Math.random() * 100 < (p.st.luck || 0) * cfg.LUCK_TIER_UP) tier++;
      let cand = pool.filter(s => (s.min || 1) <= tier && !out.some(o => o.id === s.id));
      if (!cand.length) cand = pool.filter(s => !out.some(o => o.id === s.id));
      if (!cand.length) break;
      // умения профессий и синергии выпадают чуть чаще
      const weights = cand.map(s => s.partner ? 1.8 : s.prof ? 1.4 : 1);
      let r = Math.random() * weights.reduce((a, b) => a + b, 0), k = 0;
      while (r > weights[k]) { r -= weights[k]; k++; }
      const s = cand[Math.min(k, cand.length - 1)];
      out.push({ id: s.id, tier: Math.max(tier, s.min || 1), sup: 0 });
    }
    return out;
  };

  Sk.ensureOffers = function (G, p) {
    if (!p.offers && p.queue.length) p.offers = Sk.makeOffers(G, p, p.queue[0]);
  };

  Sk.pick = function (G, p, i) {
    if (!p.offers || !p.offers[i]) return;
    const o = p.offers[i];
    p.skills.push({ id: o.id, tier: o.tier, sup: o.sup });
    Sk.recalc(p);
    p.queue.shift(); p.offers = null; p.rr = 0;
    const def = Sk.find(o.id);
    AB.Sim.fx(G, { k: 'skill', x: p.x, y: p.y, pid: p.id, s: def.name, t: o.tier, sup: o.sup });
    Sk.ensureOffers(G, p);
  };

  Sk.reroll = function (G, p) {
    if (!p.offers) return;
    const cfg = C();
    const cost = cfg.REROLL_COST + p.rr * cfg.REROLL_COST_STEP;
    if (AB.Sim.woodOf(G, p) < cost) { AB.Sim.msg(G, `Для переброса нужно ${cost} дерева (рюкзак + склад)`, p.id, '#ff9d7a'); return; }
    AB.Sim.spendWood(G, p, cost); p.rr++;
    p.offers = Sk.makeOffers(G, p, p.queue[0]);
  };

  Sk.rerollCost = function (p) { return C().REROLL_COST + (p.rr || 0) * C().REROLL_COST_STEP; };

  // Сумма характеристики по всей команде (для синергий)
  Sk.team = function (G) {
    const t = {};
    for (const p of G.players) if (p.st) for (const k in p.st) if (p.st[k]) t[k] = (t[k] || 0) + p.st[k];
    return t;
  };
})(window.AB);
