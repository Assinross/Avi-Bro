// Сохранения прогресса. Мир = зерно + изменения (деревья, кусты, руда, открытые локации);
// монстры не сохраняются - при загрузке мир заселяется заново.
// Хранилище: папка saves/ у server.py, если игра открыта с него, иначе localStorage браузера.
(function (AB) {
  const Save = AB.Save = {};
  const C = () => window.CONFIG;
  const VER = 1;
  Save.VER = VER;

  // Поля G, которые не сохраняем: мир строится из зерна, монстры появляются заново, остальное - мгновенное
  const SKIP_G = new Set(['W', 'mode', 'over', 'monsters', 'projs', 'eprojs', 'tele', 'bots', 'bolts', 'fxOut',
    'treeDirty', 'bushDirty', 'oreDirty', 'tsDirty', 'team', 'saveReq', 'isNight', 'nightF']);
  // Переходные поля игрока: сглаживание сети и ввод
  const SKIP_P = new Set(['tx', 'ty', '_inT', 'moving', 'run', 'left']);
  const TREE_F = ['id', 'x', 'y', 'tx', 'ty', 'v', 's', 'hp', 'dead', 'sap', 'sg', 'regrow', 'wild', 'border'];

  // ---------- кто играет ----------
  let myUid = null;
  Save.uid = function () {
    if (myUid) return myUid;
    try { myUid = localStorage.getItem('avibro-uid'); } catch (e) { /* */ }
    if (!/^[a-z0-9]{12}$/.test(myUid || '')) {
      myUid = '';
      for (let i = 0; i < 12; i++) myUid += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)];
      try { localStorage.setItem('avibro-uid', myUid); } catch (e) { /* */ }
    }
    return myUid;
  };
  Save.cleanUid = (u) => (/^[a-z0-9]{12}$/.test(u || '') ? u : 'anon');
  Save.keySolo = () => 'solo-' + Save.uid();
  Save.keyPair = (h, g) => 'pair-' + h + '-' + g;

  // ---------- упаковка ----------
  Save.pack = function (G, key) {
    const W = G.W, cfg = C();
    const g = {};
    for (const k in G) if (!SKIP_G.has(k)) g[k] = G[k];
    g.players = G.players.map(p => { const o = {}; for (const k in p) if (!SKIP_P.has(k)) o[k] = p[k]; return o; });
    const w = { tr: [], bu: [], or: [], sites: [] };
    W.trees.forEach(t => {
      if (t.gone) return; // поляна разросшейся локации - восстановится из уровня костра
      if (!(t.dead || t.hp < cfg.TREE_HP || t.id >= W.treeBase)) return;
      const o = {}; TREE_F.forEach(f => { if (t[f] !== undefined) o[f] = t[f]; }); w.tr.push(o);
    });
    W.bushes.forEach(b => { if (b.berries === 0) w.bu.push([b.id, b.t]); });
    (W.ores || []).forEach(o => { if (o.dead || o.hp < cfg.ORE_HITS) w.or.push([o.id, o.hp, o.dead ? 1 : 0, o.regrow || 0]); });
    W.sites.forEach(s => { if (s.opened) w.sites.push(s.id); });
    const data = {
      v: VER, key, at: Date.now(), seed: G.seed, diff: AB.difficulty,
      meta: { day: G.day, players: G.players.map(p => ({ n: p.name, pr: p.prof, lv: p.level })) },
      g, w,
    };
    return JSON.parse(JSON.stringify(data)); // копия: запись асинхронная, а игра идёт дальше
  };

  // ---------- распаковка: свежий мир из зерна + сохранённое ----------
  Save.unpack = function (data, mode) {
    AB.setDifficulty(data.diff);
    const G = AB.Sim.create(data.seed, mode); // стража локаций уже заселена
    const W = G.W, n0 = G.nextId;
    for (const k in data.g) if (k !== 'players') G[k] = data.g[k];
    G.players = data.g.players.map(p => Object.assign({ tx: p.x, ty: p.y, moving: false, run: false, left: false }, p));
    G.nextId = Math.max(G.nextId || 1, n0);
    const ti = AB.Sim.timeInfo(G.clock); G.day = ti.day; G.isNight = ti.isNight; G.nightF = ti.nightF;
    AB.WX = AB.Sim.wxDef(G.wx.id);
    (data.w.tr || []).forEach(r => {
      let t = W.trees[r.id];
      if (!t) { // выросший побег
        t = { shake: 0 }; W.trees[r.id] = t;
        const i = r.ty * W.N + r.tx; W.treeAt[i] = r.id; W.solid[i] = AB.S_TREE;
      }
      Object.assign(t, r);
    });
    (data.w.bu || []).forEach(a => { const b = W.bushes[a[0]]; if (b) { b.berries = 0; b.t = a[1]; } });
    (data.w.or || []).forEach(a => {
      const o = W.ores && W.ores[a[0]]; if (!o) return;
      o.hp = a[1]; o.dead = !!a[2]; o.regrow = a[3];
      W.solid[o.ty * W.N + o.tx] = o.dead ? AB.S_NONE : AB.S_ROCK;
    });
    (data.w.sites || []).forEach(id => { if (W.sites[id]) W.sites[id].opened = true; });
    if ((G.fireLevel || 1) > 1) AB.growSites(W, G.fireLevel); // поляны локаций - как при росте костра, без новой стражи
    G.team = AB.Skills.team(G);
    return G;
  };

  // ---------- для меню ----------
  Save.ok = (h) => !!h && !h.bad && h.v <= VER && !!h.meta;
  Save.label = function (h) {
    if (h.bad) return `${h.key} · Повреждено`;
    const m = h.meta || {}, ps = m.players || [], cfg = C();
    const pad = (n) => String(n).padStart(2, '0'), dt = new Date(h.at || 0);
    const who = ps.map(p => p.n).join(' + ');
    const prof = ps.length === 1 ? ' · ' + ((cfg.PROFESSIONS[ps[0].pr] || {}).name || '') : '';
    const df = (AB.DIFFS[h.diff] || {}).name || '';
    return `${who}${prof} · День ${m.day || 1} · ${df} · ${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}` + (Save.ok(h) ? '' : ' · Несовместимо');
  };
})(window.AB);
