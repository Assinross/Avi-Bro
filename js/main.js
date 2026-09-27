// Главный модуль: меню, управление, игровой цикл, связка одиночной/сетевой игры.
(function (AB) {
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const App = AB.App = {
    state: 'menu', mode: null, G: null, myId: 0, cam: { x: 0, y: 0 },
    keys: new Set(), mouse: { x: 0, y: 0, down: false, onCanvas: false }, moveTarget: null, clickMark: null,
    paused: false, sendT: 0, inT: 0, exploreT: 0,
  };

  /* ============================ ЭКРАНЫ ============================ */
  const screens = ['menu', 'coop', 'lobby', 'joining', 'help', 'pause', 'over', 'prof'];
  function show(id) {
    screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
    document.body.classList.toggle('in-game', id === null);
  }
  function playerName() {
    const n = ($('name').value || '').trim() || 'Игрок';
    try { localStorage.setItem('avibro-name', n); } catch (e) { /* */ }
    return n.slice(0, 12);
  }

  /* ========================== ЗАПУСК РЕЖИМОВ ========================== */
  function startAttract() {
    App.state = 'menu';
    App.mode = 'attract';
    App.G = AB.Sim.create((Math.random() * 1e9) | 0, 'solo');
    App.G.clock = C().DAY_LENGTH - 25;
    AB.Render.setWorld(App.G.W);
    App.cam.x = App.G.W.camp.x; App.cam.y = App.G.W.camp.y;
    AB.FX.reset();
  }

  function beginGame(G, mode, myId) {
    App.G = G; App.mode = mode; App.myId = myId; App.state = 'play'; App.paused = false;
    App.moveTarget = null;
    AB.FX.reset(); AB.FX.myId = myId;
    AB.Render.setWorld(G.W);
    const me = App.me();
    App.cam.x = me ? me.x : G.W.camp.x; App.cam.y = me ? me.y : G.W.camp.y;
    show(null);
    AB.FX.toast('Выживите 99 ночей! Ищите оружие в руинах, охраняемых монстрами', '#ffe7a8');
    AB.FX.toast('Движение: левый клик / стрелки. Атака и рубка — автоматически', '#cfe0ff');
  }
  App.me = function () { return App.G ? App.G.players.find(p => p.id === App.myId) : null; };

  function startSolo() {
    const G = AB.Sim.create((Math.random() * 1e9) | 0, 'solo');
    AB.Sim.addPlayer(G, 0, playerName(), App.prof);
    beginGame(G, 'solo', 0);
  }

  // ----- выбор профессии
  function chooseProf(next, back) {
    const cfg = C();
    const box = $('profCards');
    box.innerHTML = '';
    for (const key in cfg.PROFESSIONS) {
      const pd = cfg.PROFESSIONS[key];
      const lines = AB.Skills.lines({ stats: pd.stats }, 1).map(l => l.s);
      const el = document.createElement('div');
      el.className = 'prof';
      el.style.borderColor = pd.color;
      el.innerHTML = `<div class="pico" style="border-color:${pd.color};color:${pd.color}">${pd.icon}</div>
        <div class="pname" style="color:${pd.color}">${pd.name}</div><div class="pdesc">${pd.desc}</div>
        <div class="pstats">${lines.join('<br>')}</div>`;
      el.addEventListener('click', () => { AB.Sound.play('click', 1); App.prof = key; try { localStorage.setItem('avibro-prof', key); } catch (e) { /* */ } next(); });
      box.appendChild(el);
    }
    $('btnProfBack').onclick = () => show(back);
    show('prof');
  }

  // ----- хост
  let hostSeed = 0;
  function startHost() {
    show('lobby');
    $('lobbyStatus').textContent = 'Создаём комнату…';
    $('roomCode').textContent = '····';
    $('roomLink').value = '';
    hostSeed = (Math.random() * 1e9) | 0;
    const name = playerName();
    AB.Net.host({
      ready(code) {
        $('roomCode').textContent = code;
        const url = location.origin + location.pathname + '?room=' + code + (AB.Net.isLocal ? '&local=1' : '');
        $('roomLink').value = url;
        $('lobbyStatus').textContent = 'Ожидание второго игрока… Сообщите ему код или ссылку.';
      },
      guest() {
        $('lobbyStatus').textContent = 'Игрок подключается…';
      },
      data(m) {
        if (m.t === 'hello') {
          let G = App.G;
          if (App.state !== 'play' || App.mode !== 'host') {
            G = AB.Sim.create(hostSeed, 'host');
            AB.Sim.addPlayer(G, 0, name, App.prof);
            AB.Sim.addPlayer(G, 1, (m.name || 'Друг').slice(0, 12), m.prof);
            beginGame(G, 'host', 0);
          } else {
            let p = G.players.find(q => q.id === 1);
            if (!p) { p = AB.Sim.addPlayer(G, 1, (m.name || 'Друг').slice(0, 12), m.prof); }
            else p.name = (m.name || p.name).slice(0, 12);
            AB.Sim.msg(G, `${p.name} подключился!`, -1, '#8fe08a');
          }
          AB.Net.send({ t: 'init', seed: G.seed, id: 1 });
          AB.Net.send(AB.Sim.snapshot(G, true));
        } else if (App.mode === 'host' && App.G) {
          const p = App.G.players.find(q => q.id === 1);
          if (!p) return;
          if (m.t === 'in') {
            if (!p.dead && m.tp === p.tp) { p.x = m.x; p.y = m.y; }
            p.a = m.a; p.moving = !!m.mv;
            if (p.ws.includes(m.w)) p.w = m.w;
          } else if (m.t === 'cmd') AB.Sim.command(App.G, 1, m.c, m.x, m.y);
        }
      },
      guestLeft() {
        if (App.state === 'play' && App.mode === 'host') AB.Sim.msg(App.G, 'Второй игрок отключился. Он может вернуться по тому же коду.', -1, '#ff9d7a');
        else $('lobbyStatus').textContent = 'Игрок отключился. Ожидание…';
      },
      error(t) { $('lobbyStatus').textContent = t; },
    });
  }

  // ----- гость
  function startJoin(code) {
    code = (code || '').replace(/\D/g, '');
    if (code.length < 3) { $('coopErr').textContent = 'Введите код комнаты'; return; }
    show('joining');
    $('joinStatus').textContent = `Подключение к комнате ${code}…`;
    const name = playerName();
    let G = null;
    AB.Net.join(code, {
      open() { $('joinStatus').textContent = 'Соединение установлено, загрузка мира…'; AB.Net.send({ t: 'hello', name, prof: App.prof }); },
      data(m) {
        if (m.t === 'full') { $('joinStatus').textContent = 'В комнате уже два игрока.'; return; }
        if (m.t === 'init') {
          G = AB.Sim.create(m.seed, 'guest');
          App.myId = m.id;
          App.pendingGuest = G;
        } else if (m.t === 's' && (G || App.G)) {
          const g = App.pendingGuest || App.G;
          AB.Sim.applySnapshot(g, m, App.myId);
          if (App.pendingGuest) { App.pendingGuest = null; beginGame(g, 'guest', App.myId); }
        }
      },
      closed() {
        if (App.state === 'play' && App.mode === 'guest') { endToMenu('Хост закрыл игру или соединение потеряно.'); }
      },
      error(t) { $('joinStatus').textContent = t; },
    });
  }

  function endToMenu(msg) {
    AB.Net.close();
    startAttract();
    show('menu');
    if (msg) { $('menuMsg').textContent = msg; setTimeout(() => $('menuMsg').textContent = '', 6000); }
  }

  /* ============================ УПРАВЛЕНИЕ ============================ */
  function setupInput() {
    const cv = $('game');
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      AB.Sound.unlock();
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (App.state !== 'play') return;
      if (k === 'Tab') { e.preventDefault(); if (!e.repeat) toggleBuild(); return; }
      if (k === 'Escape') { togglePause(); return; }
      if (App.paused) return;
      App.keys.add(k);
      if (e.repeat) return;
      const me0 = App.me();
      if (k.startsWith('Digit')) {
        const i = parseInt(k.slice(5), 10) - 1;
        if (me0 && me0.offers && i < me0.offers.length) { pickSkill(i); return; }
        selectWeapon(i);
      }
      if (k === 'KeyT') command('build1');
      if (k === 'KeyY') command('build2');
      if (k === 'KeyU') command('upfire');
      if (k === 'KeyE') command('eat');
      if (k === 'KeyR') command('plant');
      if (k === 'KeyG') command('bed');
      if (k === 'KeyB') command('fire');
    });
    window.addEventListener('keyup', (e) => App.keys.delete(e.code));
    window.addEventListener('blur', () => { App.keys.clear(); App.mouse.down = false; });
    cv.addEventListener('mousemove', (e) => { App.mouse.x = e.clientX; App.mouse.y = e.clientY; App.mouse.onCanvas = true; App.hoverSlot = slotAt(e.clientX, e.clientY); });
    cv.addEventListener('mouseleave', () => { App.mouse.onCanvas = false; });
    cv.addEventListener('mousedown', (e) => {
      AB.Sound.unlock();
      if (e.button !== 0 || App.state !== 'play' || App.paused) return;
      const s = slotAt(e.clientX, e.clientY);
      if (s >= 0) { selectWeapon(s); return; }
      App.mouse.down = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) App.mouse.down = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      if (App.state !== 'play') return;
      const me = App.me(); if (!me) return;
      const order = C().WEAPON_ORDER.filter(w => me.ws.includes(w));
      let i = order.indexOf(me.w) + (e.deltaY > 0 ? 1 : -1);
      i = (i + order.length) % order.length;
      me.w = order[i];
    }, { passive: true });
  }
  function slotAt(mx, my) {
    const R = AB.Render;
    if (!R.w) return -1;
    const k = AB.clamp(Math.min(R.w / 1400, R.h / 800), 0.7, 1.25);
    const SW = R.w / k, SH = R.h / k, sz = 58, gap = 8, n = C().WEAPON_ORDER.length;
    const tw = (n + 1) * (sz + gap) - gap, hx = SW / 2 - tw / 2, hy = SH - sz - 18;
    const x = mx / k, y = my / k;
    if (y < hy || y > hy + sz) return -1;
    const i = Math.floor((x - hx) / (sz + gap));
    if (i < 0 || i >= n) return -1;
    if (x - hx - i * (sz + gap) > sz) return -1;
    return i;
  }
  function selectWeapon(i) {
    const me = App.me(); if (!me) return;
    const w = C().WEAPON_ORDER[i];
    if (w && me.ws.includes(w)) { me.w = w; AB.Sound.play('click', 1); }
    else if (w) AB.FX.toast(`${C().WEAPONS[w].name}: ещё не найдено`, '#aab4aa');
  }
  function mouseWorld() {
    const z = AB.Render.zoom || 1;
    return { x: App.cam.x + (App.mouse.x - AB.Render.w / 2) / z, y: App.cam.y + (App.mouse.y - AB.Render.h / 2) / z };
  }
  function command(c) {
    const mw = mouseWorld();
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c, x: mw.x, y: mw.y });
    else AB.Sim.command(App.G, App.myId, c, mw.x, mw.y);
  }
  function pickSkill(i) {
    AB.Sound.play('click', 1);
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c: 'pick', x: i, y: 0 });
    else AB.Sim.command(App.G, App.myId, 'pick', i, 0);
    App.lvSig = null;
  }
  function reroll() {
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c: 'reroll', x: 0, y: 0 });
    else AB.Sim.command(App.G, App.myId, 'reroll', 0, 0);
  }
  // Карточки выбора умения
  function updateLevelUI(me) {
    const cfg = C();
    const box = $('levelup');
    const offers = me && !me.dead && me.offers && App.state === 'play' ? me.offers : null;
    if (!offers) { box.classList.add('hidden'); App.lvSig = null; return; }
    const sig = JSON.stringify(offers) + '|' + me.rr + '|' + me.queue.length + '|' + me.inv.wood;
    box.classList.remove('hidden');
    if (sig === App.lvSig) return;
    App.lvSig = sig;
    const sup = me.queue[0] === 's';
    $('lvTitle').textContent = sup ? `Уровень ${me.level}: СУПЕР-УМЕНИЕ!` : `Уровень ${me.level}!`;
    $('lvTitle').className = 'lvtitle' + (sup ? ' super' : '');
    $('lvSub').textContent = (me.queue.length > 1 ? `Ещё выборов: ${me.queue.length - 1}. ` : '') + (App.mode === 'solo' ? 'Игра на паузе.' : 'Игра не останавливается — будьте осторожны!') + ` Редкость умений зависит от уровня костра (сейчас ${App.G.fireLevel}).`;
    const cards = $('lvCards');
    cards.innerHTML = '';
    offers.forEach((o, i) => {
      const def = AB.Skills.find(o.id);
      if (!def) return;
      const col = o.sup ? '#ff7a5a' : cfg.TIER_COLORS[o.tier - 1];
      const own = me.skills.filter(s => s.id === o.id).length;
      const el = document.createElement('div');
      el.className = 'skill';
      el.style.borderColor = col;
      el.style.boxShadow = `0 0 ${6 + o.tier * 4}px ${col}44 inset`;
      const partner = def.partner ? cfg.PROFESSIONS[def.partner] : null;
      el.innerHTML = `<div class="key">${i + 1}</div><div class="sico" style="color:${col}">${def.icon || '✦'}</div>
        <div class="sname">${def.name}${own ? ` <span style="color:var(--muted);font-size:12px">(есть ×${own})</span>` : ''}</div>
        <div class="stier" style="color:${col}">${o.sup ? 'Супер-умение' : cfg.TIER_NAMES[o.tier - 1]}</div>
        ${partner ? `<div class="syn">Синергия с профессией «${partner.name}»</div>` : ''}
        ${AB.Skills.lines(def, o.tier).map(l => `<div class="sline${l.bad ? ' bad' : ''}">${l.s}</div>`).join('')}
        ${def.note ? `<div class="snote">${def.note}</div>` : ''}`;
      el.addEventListener('click', () => pickSkill(i));
      cards.appendChild(el);
    });
    const cost = AB.Skills.rerollCost(me);
    $('btnReroll').textContent = `Перебросить (${cost} дерева)`;
    $('btnReroll').disabled = me.inv.wood < cost;
    $('btnReroll').style.opacity = me.inv.wood < cost ? 0.5 : 1;
  }
  function toggleBuild() { App.showBuild = !App.showBuild; App.buildSig = null; }
  function updateBuildUI(me) {
    const cfg = C();
    const box = $('build');
    if (!App.showBuild || !me || App.state !== 'play') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const sig = JSON.stringify(me.skills) + JSON.stringify(me.st);
    if (sig === App.buildSig) return;
    App.buildSig = sig;
    const agg = {};
    me.skills.forEach(s => { const a = agg[s.id] || (agg[s.id] = { n: 0, tier: 0, sup: s.sup }); a.n++; a.tier = Math.max(a.tier, s.tier); });
    $('buildSkills').innerHTML = Object.keys(agg).length ? Object.keys(agg).map(id => {
      const d = AB.Skills.find(id), a = agg[id], col = a.sup ? '#ff7a5a' : cfg.TIER_COLORS[a.tier - 1];
      return `<span class="bskill" style="border-color:${col};color:${col}">${d.icon || ''} ${d.name}${a.n > 1 ? ' ×' + a.n : ''}</span>`;
    }).join('') : '<span class="note">Пока нет умений. Переживите ночь!</span>';
    const L = cfg.STAT_LABELS;
    $('buildStats').innerHTML = Object.keys(L).filter(k => me.st[k]).map(k => {
      const v = Math.round(me.st[k] * 100) / 100;
      return `<span>${L[k][0]}</span><span class="v${v < 0 ? ' neg' : ''}">${v > 0 ? '+' : ''}${v}${L[k][1] ? '%' : ''}</span>`;
    }).join('') || '<span class="note">Базовые характеристики</span>';
  }

  function togglePause() {
    App.paused = !App.paused;
    show(App.paused ? 'pause' : null);
    $('pauseNote').textContent = App.mode === 'solo' ? 'Игра на паузе' : 'В игре вдвоём время не останавливается!';
  }

  function controlLocal(me, dt) {
    if (!me || me.dead) return;
    let dx = 0, dy = 0;
    const K = App.keys;
    if (K.has('ArrowLeft') || K.has('KeyA')) dx -= 1;
    if (K.has('ArrowRight') || K.has('KeyD')) dx += 1;
    if (K.has('ArrowUp') || K.has('KeyW')) dy -= 1;
    if (K.has('ArrowDown') || K.has('KeyS')) dy += 1;
    const mw = mouseWorld();
    if (dx || dy) App.moveTarget = null;
    else {
      if (App.mouse.down) { App.moveTarget = { x: mw.x, y: mw.y }; App.clickMark = { x: mw.x, y: mw.y, t: 1 }; }
      if (App.moveTarget) {
        const tx = App.moveTarget.x - me.x, ty = App.moveTarget.y - me.y, d = Math.hypot(tx, ty);
        if (d < C().CLICK_STOP_DIST) App.moveTarget = null;
        else { dx = tx; dy = ty; }
      }
    }
    const ox = me.x, oy = me.y;
    AB.movePlayer(App.G.W, me, dx, dy, dt);
    // если упёрлись в препятствие при движении по клику — остановиться
    if (App.moveTarget && !App.mouse.down && Math.hypot(me.x - ox, me.y - oy) < C().PLAYER_SPEED * dt * 0.1) {
      App.stuckT = (App.stuckT || 0) + dt;
      if (App.stuckT > 0.35) { App.moveTarget = null; App.stuckT = 0; }
    } else App.stuckT = 0;
    if (App.mouse.onCanvas) me.a = Math.atan2(mw.y - me.y, mw.x - me.x);
    else if (dx || dy) me.a = Math.atan2(dy, dx);
  }

  /* ============================ ЦИКЛ ============================ */
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;
    try { tick(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    const G = App.G;
    if (!G) return;
    const R = AB.Render;
    R.bakeIdle(1);
    if (App.mode === 'attract') {
      G.clock += dt * 2;
      const ti = AB.Sim.timeInfo(G.clock); G.nightF = ti.nightF;
      const t = performance.now() / 1000;
      App.cam.x = G.W.camp.x + Math.cos(t * 0.05) * 420; App.cam.y = G.W.camp.y + Math.sin(t * 0.07) * 300;
      animateEntities(G, dt);
      AB.FX.update(dt);
      R.draw(G, null, App.cam, dt, null);
      return;
    }
    const me = App.me();
    const choosing = App.mode === 'solo' && me && me.offers && !me.dead;
    const running = !(App.paused && App.mode === 'solo') && !choosing && !G.over;
    if (running) {
      controlLocal(me, dt);
      if (App.mode === 'solo' || App.mode === 'host') {
        AB.Sim.update(G, dt);
        if (App.mode === 'host' && AB.Net.open) {
          App.sendT -= dt;
          if (App.sendT <= 0) { App.sendT = 1 / C().NET_SNAPSHOT_HZ; AB.Net.send(AB.Sim.snapshot(G, false)); }
        } else { G.fxOut = []; G.treeDirty.clear(); G.bushDirty.clear(); }
        if (G.over && App.mode === 'host') AB.Net.send(AB.Sim.snapshot(G, false));
      } else if (App.mode === 'guest') {
        G.clock += dt;
        const ti = AB.Sim.timeInfo(G.clock); G.nightF = ti.nightF; G.isNight = ti.isNight; G.day = ti.day;
        App.inT -= dt;
        if (App.inT <= 0 && me) { App.inT = 1 / C().NET_INPUT_HZ; AB.Net.send({ t: 'in', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, a: Math.round(me.a * 100) / 100, w: me.w, mv: me.moving ? 1 : 0, tp: me.tp }); }
        smoothRemote(G, dt);
      }
    }
    if (G.over && App.state === 'play') gameOver(G);
    animateEntities(G, dt);
    // камера
    if (me) {
      const k = Math.min(1, dt * 6);
      App.cam.x += (me.x - App.cam.x) * k; App.cam.y += (me.y - App.cam.y) * k;
      AB.FX.listener.x = me.x; AB.FX.listener.y = me.y;
      App.exploreT -= dt;
      if (App.exploreT <= 0) { App.exploreT = 0.25; R.explore(G.W, me.x, me.y, AB.visionRadius(R.w, R.h, G.nightF) / (R.zoom || 1) + 40); }
    }
    if (App.clickMark) { App.clickMark.t -= dt * 2; if (App.clickMark.t <= 0) App.clickMark = null; }
    AB.FX.update(dt);
    R.draw(G, me, App.cam, dt, { clickMark: App.clickMark });
    R.hud(G, me, { mouse: App.mouse.onCanvas ? App.mouse : null, hoverSlot: App.hoverSlot });
    updateLevelUI(me);
    updateBuildUI(me);
  }

  function smoothRemote(G, dt) {
    const k = Math.min(1, dt * 12);
    for (const p of G.players) if (p.id !== App.myId && p.tx !== undefined) { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
    for (const m of G.monsters) {
      if (m.tx === undefined) continue;
      if (Math.abs(m.tx - m.x) > 200 || Math.abs(m.ty - m.y) > 200) { m.x = m.tx; m.y = m.ty; }
      m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k;
      if (m.dying > 0) m.dying -= dt;
    }
    for (const p of G.projs) { p.x += p.vx * dt; p.y += p.vy * dt; }
    for (const t of G.W.trees) if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
  }

  function animateEntities(G, dt) {
    const step = (e) => {
      if (e._lx === undefined) { e._lx = e.x; e._ly = e.y; e._walk = Math.random() * 6; }
      const d = Math.hypot(e.x - e._lx, e.y - e._ly);
      e._walk += d * 0.22;
      if (e.type) e.moving = d > 0.2;
      e._lx = e.x; e._ly = e.y;
    };
    G.players.forEach(step); G.monsters.forEach(step);
  }

  function gameOver(G) {
    App.state = 'over';
    const ti = AB.Sim.timeInfo(G.clock);
    const win = G.over === 'win';
    $('overTitle').textContent = win ? 'ПОБЕДА!' : 'Лес победил…';
    $('overTitle').className = win ? 'win' : 'lose';
    $('overText').textContent = win
      ? `Вы пережили все ${C().NIGHTS_TO_WIN} ночей!`
      : `Пережито ночей: ${Math.max(0, ti.day - 1)}. Монстров побеждено: ${G.stats.kills}.`;
    $('btnRetry').classList.toggle('hidden', App.mode !== 'solo');
    setTimeout(() => show('over'), 1200);
  }

  /* ============================ ИНИЦИАЛИЗАЦИЯ ============================ */
  function init() {
    AB.Sprites.init();
    AB.Render.init($('game'));
    setupInput();
    try { $('name').value = $('name2').value = localStorage.getItem('avibro-name') || ''; } catch (e) { /* */ }
    $('name').addEventListener('input', () => $('name2').value = $('name').value);
    $('name2').addEventListener('input', () => $('name').value = $('name2').value);
    const bind = (id, fn) => $(id).addEventListener('click', () => { AB.Sound.unlock(); AB.Sound.play('click', 1); fn(); });
    try { App.prof = localStorage.getItem('avibro-prof') || 'hunter'; } catch (e) { App.prof = 'hunter'; }
    bind('btnSolo', () => chooseProf(startSolo, 'menu'));
    bind('btnReroll', reroll);
    bind('btnCoop', () => { show('coop'); $('coopErr').textContent = ''; $('peerWarn').classList.toggle('hidden', AB.Net.available()); });
    bind('btnHelp', () => show('help'));
    bind('btnHost', () => chooseProf(startHost, 'coop'));
    bind('btnJoin', () => { const code = $('code').value; if (code.replace(/\D/g, '').length < 3) { $('coopErr').textContent = 'Введите код комнаты'; return; } chooseProf(() => startJoin(code), 'coop'); });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { AB.Net.close(); show(b.dataset.back); }));
    bind('btnCopy', () => { const i = $('roomLink'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } $('btnCopy').textContent = 'Скопировано!'; setTimeout(() => $('btnCopy').textContent = 'Копировать', 1500); });
    bind('btnSoloFromLobby', () => { AB.Net.close(); startSolo(); });
    bind('btnResume', togglePause);
    bind('btnQuit', () => endToMenu());
    bind('btnMenu', () => endToMenu());
    bind('btnRetry', () => chooseProf(startSolo, 'menu'));
    $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

    startAttract();
    show('menu');
    const room = new URLSearchParams(location.search).get('room');
    if (room) { show('coop'); $('code').value = room; $('coopErr').textContent = 'Вас пригласили в игру! Введите имя и нажмите «Войти».'; }
    requestAnimationFrame(frame);
  }
  window.addEventListener('load', init);
})(window.AB);
