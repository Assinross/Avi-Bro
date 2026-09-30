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
  const screens = ['menu', 'cont', 'saves', 'coop', 'lobby', 'joining', 'help', 'pause', 'over', 'prof'];
  function show(id) {
    screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
    document.body.classList.toggle('in-game', id === null);
  }
  function playerName() {
    const n = ('' + (($('name').value || '').trim() || 'Игрок')).slice(0, 12);
    try { localStorage.setItem('avibro-name', n); } catch (e) { /* */ }
    return n;
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
    AB.FX.toast(App.touch ? 'Выживите 99 ночей! Голубые шарики — опыт' : 'Выживите 99 ночей! Собирайте голубые шарики опыта — они открывают боевые навыки', '#ffe7a8');
    AB.FX.toast(App.touch ? 'Джойстик слева, тап — идти или взять. Оружие бьёт само' : 'Движение: левый клик / стрелки. Оружие бьёт само, топор сам рубит деревья', '#cfe0ff');
    App.pendingDump = null;
   
    App.lvOpen = false; App.aoRef = null; App.aoWasOpen = false;
    App.buildMode = null;
    // сброс переходного UI, чтобы прошлая игра не просвечивала в новую
    App.pendingPick = null; App.selRef = null; App.abDefer = false; App.lvSig = null;
    App.mcSig = null; App.exSig = null; App.wsSig = null; App.bpSig = null;
    App.keys.clear(); App.mouse.down = false; App.clickMark = null;
    setAutoPick(App.autoPick, true);
    // мобильное состояние
    App.mobPanel = null; App.joy = null; App.tw = {}; App.tapSlot = null; App.lp = null;
    App.showGear = false; App.gearSel = null; App.gearSig = null;
    if (App.touch) {
      App.goFull();
      if (innerHeight > innerWidth) AB.FX.toast('Удобнее играть, повернув телефон горизонтально', '#ffe7a8');
    }
  }
  // Полноэкранный режим (на телефоне прячет адресную строку)
  App.goFull = function () {
    const d = document.documentElement;
    try { if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) { /* */ }
  };
  // Автоподбор предметов (у каждого игрока свой, по умолчанию выключен)
  function setAutoPick(on, silent) {
    App.autoPick = !!on;
    try { localStorage.setItem('avibro-autopick', App.autoPick ? '1' : '0'); } catch (e) { /* */ }
    const cb = $('optAutoPick'); if (cb) cb.checked = App.autoPick;
    if (App.state === 'play' && App.G) {
      if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c: 'autopick', x: App.autoPick ? 1 : 0, y: 0 });
      else if (App.mode === 'solo' || App.mode === 'host') AB.Sim.command(App.G, App.myId, 'autopick', App.autoPick ? 1 : 0, 0);
      if (!silent) AB.FX.toast(App.autoPick ? 'Автоподбор включён: предметы поднимаются сами' : 'Автоподбор выключен: поднимайте предметы кликом', '#cfe0ff');
    }
  }
  App.setAutoPick = setAutoPick;
  App.me = function () { return App.G ? App.G.players.find(p => p.id === App.myId) : null; };

  function startSolo() {
    AB.setDifficulty(App.diff);
    const G = AB.Sim.create((Math.random() * 1e9) | 0, 'solo');
    AB.Sim.addPlayer(G, 0, playerName(), App.prof).uid = AB.Save.uid();
    App.saveKey = AB.Save.keySolo();
    beginGame(G, 'solo', 0);
  }

  // Продолжить одиночную игру из сохранения
  function continueSolo(d) {
    let G;
    try { G = AB.Save.unpack(d, 'solo'); } catch (e) { show('menu'); $('menuMsg').textContent = 'Сохранение не загрузилось: ' + e.message; return; }
    const me = G.players.find(q => q.id === 0);
    if (me) { me.name = playerName(); me.uid = AB.Save.uid(); }
    App.saveKey = AB.Save.keySolo();
    beginGame(G, 'solo', 0);
  }

  // Сохранить текущую игру: только одиночная и хост; после поражения - нет (остаётся рассвет).
  // sync - при закрытии вкладки, manual - кнопка "Сохранить" (показать результат)
  function saveGame(sync, manual) {
    const G = App.G;
    if (!G || !App.saveKey || (App.mode !== 'solo' && App.mode !== 'host') || G.over === 'lose') return;
    let d;
    try { d = AB.Save.pack(G, App.saveKey); } catch (e) { AB.FX.toast('Не удалось сохранить: ' + e.message, '#ff9d7a'); return; }
    if (sync) { AB.Save.writeSync(d); return; }
    AB.Save.write(d).then(() => { if (manual) AB.FX.toast('Сохранено ✓', '#8fe08a'); })
      .catch(e => AB.FX.toast((e && e.message) || 'Не удалось сохранить', '#ff9d7a'));
  }

  // ----- выбор профессии
  // Сложность: «Аркада» по умолчанию, выбор запоминается. Гость играет на сложности хоста.
  try { App.diff = localStorage.getItem('avibro-diff') || 'arcade'; } catch (e) { App.diff = 'arcade'; }
  function showDiff() {
    document.querySelectorAll('#diffBox .diff').forEach(b => b.classList.toggle('gold', b.dataset.diff === App.diff));
    const d = AB.DIFFS[App.diff]; $('diffDesc').textContent = d ? d.desc : '';
  }
  function chooseProf(next, back, guest) {
    const cfg = C();
    $('diffBox').classList.toggle('hidden', !!guest);
    if (!guest) showDiff();
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
    $('lobbyChoice').classList.add('hidden');
    App.lobbyGuest = null;
    // Запуск игры хостом: d - сохранение пары (или null - новый мир), gm - гость из hello
    const hostStart = (d, gm) => {
      $('lobbyChoice').classList.add('hidden');
      App.lobbyGuest = null;
      let G = null;
      if (d) try { G = AB.Save.unpack(d, 'host'); } catch (e) { G = null; $('lobbyStatus').textContent = 'Сохранение не загрузилось - начинаем новую игру.'; }
      if (G) {
        const me = G.players.find(q => q.id === 0); if (me) { me.name = name; me.uid = AB.Save.uid(); }
        const p = G.players.find(q => q.id === 1);
        if (p) { p.name = gm.name; p.left = false; p.uid = gm.uid; } else AB.Sim.addPlayer(G, 1, gm.name, gm.prof).uid = gm.uid;
      } else {
        AB.setDifficulty(App.diff);
        G = AB.Sim.create(hostSeed, 'host');
        AB.Sim.addPlayer(G, 0, name, App.prof).uid = AB.Save.uid();
        AB.Sim.addPlayer(G, 1, gm.name, gm.prof).uid = gm.uid;
      }
      App.saveKey = gm.uid === 'anon' ? null : AB.Save.keyPair(AB.Save.uid(), gm.uid); // старая версия у гостя - без сохранений
      beginGame(G, 'host', 0);
      AB.Net.send({ t: 'init', seed: G.seed, id: 1, df: AB.difficulty });
      AB.Net.send(AB.Sim.snapshot(G, true));
    };
    $('btnLobbyCont').onclick = () => { const L = App.lobbyGuest; if (L) hostStart(L.save, L); };
    $('btnLobbyNew').onclick = () => { const L = App.lobbyGuest; if (L) hostStart(null, L); };
    AB.Net.host({
      name, prof: App.prof ? (C().PROFESSIONS[App.prof] || {}).name : '',
      ready(code) {
        $('roomCode').textContent = code;
        const url = AB.Net.shareBase() + '?room=' + code + (AB.Net.isLocal ? '&local=1' : '');
        $('roomLink').value = url;
        $('lobbyStatus').textContent = AB.Net.server ? 'Ожидание второго игрока… Он увидит вашу комнату в списке «Комнаты в сети».' : 'Ожидание второго игрока… Сообщите ему код или ссылку.';
      },
      guest() {
        $('lobbyStatus').textContent = 'Игрок подключается…';
      },
      data(m) {
        if (m.t === 'hello') {
          const gm = { name: (m.name || 'Друг').slice(0, 12), prof: m.prof, uid: AB.Save.cleanUid(m.uid) };
          if (App.state === 'play' && App.mode === 'host') {
            // возвращение в идущую игру: только тот же напарник
            const G = App.G;
            let p = G.players.find(q => q.id === 1);
            if (p && p.uid && p.uid !== 'anon' && gm.uid !== 'anon' && p.uid !== gm.uid) { AB.Net.send({ t: 'deny', s: `В этой игре играет другой напарник (${p.name}).` }); return; }
            if (!p) { p = AB.Sim.addPlayer(G, 1, gm.name, gm.prof); p.uid = gm.uid; }
            else { p.name = gm.name; p.left = false; }
            AB.Sim.msg(G, `${p.name} подключился!`, -1, '#8fe08a');
            AB.Net.send({ t: 'init', seed: G.seed, id: 1, df: AB.difficulty });
            AB.Net.send(AB.Sim.snapshot(G, true));
            return;
          }
          App.lobbyGuest = gm;
          if (gm.uid === 'anon') { hostStart(null, gm); return; }
          AB.Save.load(AB.Save.keyPair(AB.Save.uid(), gm.uid)).then(d => {
            if (App.lobbyGuest !== gm || App.state === 'play') return; // гость ушёл, пока читали сохранение
            if (!AB.Save.ok(d)) { hostStart(null, gm); return; }
            gm.save = d;
            $('lobbyChoiceNote').textContent = `Есть сохранение: ${AB.Save.label(d)}`;
            $('lobbyChoice').classList.remove('hidden');
            $('lobbyStatus').textContent = `${gm.name} подключился. Продолжить сохранение или начать новую игру?`;
            AB.Net.send({ t: 'wait' });
          });
        } else if (App.mode === 'host' && App.G) {
          const p = App.G.players.find(q => q.id === 1);
          if (!p) return;
          if (m.t === 'in') {
            // защита от телепортов: допустимый шаг растёт со временем с прошлого пакета (лаг не «замораживает» гостя навсегда)
            if (!p.dead && !p.left && m.tp === p.tp) {
              const now = performance.now(), gap = Math.min(3, (now - (p._inT || now)) / 1000);
              const lim = 80 + AB.playerSpeed(p) * gap * 1.5, d = AB.dist(p.x, p.y, m.x, m.y);
              if (d <= lim) { p.x = m.x; p.y = m.y; }
              else { p.x += (m.x - p.x) / d * lim; p.y += (m.y - p.y) / d * lim; }
              p._inT = now;
            }
            p.a = m.a; p.moving = !!m.mv; p.run = !!m.rn;
          } else if (m.t === 'cmd') AB.Sim.command(App.G, 1, m.c, m.x, m.y);
        }
      },
      guestLeft() {
        if (App.lobbyGuest) { App.lobbyGuest = null; $('lobbyChoice').classList.add('hidden'); }
        const pl = App.G && App.G.players.find(q => q.id === 1);
        if (pl) pl.left = true; // ушедший не считается в кооп-балансе, но может вернуться тем же кодом
        if (App.state === 'play' && App.mode === 'host') AB.Sim.msg(App.G, 'Второй игрок отключился. Он может вернуться по тому же коду.', -1, '#ff9d7a');
        else $('lobbyStatus').textContent = 'Игрок отключился. Ожидание…';
      },
      error(t) { $('lobbyStatus').textContent = t; },
    });
  }

  // ----- гость
  function startJoin(code) {
    App.saveKey = null;
    code = (code || '').replace(/\D/g, '');
    if (code.length < 3) { $('coopErr').textContent = 'Введите код комнаты'; return; }
    show('joining');
    $('joinStatus').textContent = `Подключение к комнате ${code}…`;
    const name = playerName();
    let G = null;
    AB.Net.join(code, {
      open() { $('joinStatus').textContent = 'Соединение установлено, загрузка мира…'; AB.Net.send({ t: 'hello', name, prof: App.prof, uid: AB.Save.uid() }); },
      data(m) {
        if (m.t === 'full') { $('joinStatus').textContent = 'В комнате уже два игрока.'; return; }
        if (m.t === 'wait') { $('joinStatus').textContent = 'Хост выбирает: продолжить или новая игра…'; return; }
        if (m.t === 'deny') { AB.Net.close(); if (App.state === 'play') endToMenu(m.s); else $('joinStatus').textContent = m.s; return; }
        if (m.t === 'init') {
          AB.setDifficulty(m.df || 'hardcore');
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

  // Экран «Игра вдвоём»: со своего сервера — ссылка и список комнат; из интернета — скачать сервер
  // Экран "Сохранения": все сохранения текущего хранилища, только удаление
  function showSaves() {
    show('saves');
    const box = $('savesList');
    box.innerHTML = '<span class="note">Загрузка…</span>';
    App.netReady.then(() => AB.Save.list()).then(list => {
      box.innerHTML = '';
      if (!list.length) { box.innerHTML = '<span class="note">Сохранений пока нет</span>'; return; }
      list.forEach(h => {
        const row = document.createElement('div'); row.className = 'saverow';
        const t = document.createElement('span'); t.textContent = AB.Save.label(h);
        const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Удалить';
        b.addEventListener('click', () => {
          if (!b.dataset.arm) { b.dataset.arm = 1; b.textContent = 'Точно удалить?'; setTimeout(() => { if (!b.disabled) { delete b.dataset.arm; b.textContent = 'Удалить'; } }, 3000); return; }
          b.disabled = true;
          AB.Save.remove(h.key).then(showSaves).catch(() => { b.disabled = false; b.textContent = 'Ошибка, ещё раз'; });
        });
        row.append(t, b); box.appendChild(row);
      });
    });
  }

  function setupCoopScreen() {
    const sv = AB.Net.server; App.roomsSig = null;
    $('lanBox').classList.toggle('hidden', !sv);
    $('roomsBox').classList.toggle('hidden', !sv);
    $('codeBox').classList.toggle('hidden', !!sv);
    $('srvBox').classList.toggle('hidden', !!sv);
    if (sv) {
      const links = sv.links || [`http://${location.host}`];
      $('lanLink').textContent = links[0]; $('lanLink').href = links[0];
      $('lanAlt').textContent = links.length > 1 ? 'Если не открывается: ' + links.slice(1).join(' · ') : '';
      pollRooms();
    } else { try { $('srvUrl').value = localStorage.getItem('avibro-srv') || ''; } catch (e) { /* */ } }
  }
  function pollRooms() {
    clearTimeout(App.roomsT);
    if (!AB.Net.server || $('coop').classList.contains('hidden')) return;
    fetch('/rooms', { cache: 'no-store' }).then(r => r.json()).then(list => {
      const sig = JSON.stringify(list); if (sig === App.roomsSig) return; App.roomsSig = sig; // перерисовываем только при изменениях — иначе клик «проваливается»
      const box = $('roomsList'); box.innerHTML = '';
      if (!list.length) box.innerHTML = '<span class="note">Пока никто не создал комнату. Создайте её на одном компьютере — на втором она появится здесь сама.</span>';
      list.forEach(rm => {
        const el = document.createElement('div'); el.className = 'room';
        el.innerHTML = `<span><b>${String(rm.name || 'Игрок').replace(/[<>&]/g, '')}</b>${rm.prof ? ' · ' + String(rm.prof).replace(/[<>&]/g, '') : ''}${rm.full ? ' · <span class="note">занята</span>' : ''}</span>`;
        const b = document.createElement('button'); b.className = 'btn small gold'; b.textContent = 'Войти'; b.disabled = rm.full;
        b.addEventListener('click', () => { AB.Sound.play('click', 1); clearTimeout(App.roomsT); chooseProf(() => startJoin(rm.code), 'coop', true); });
        el.appendChild(b); box.appendChild(el);
      });
    }).catch(() => { /* */ }).finally(() => { App.roomsT = setTimeout(pollRooms, 1500); });
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
      if (k === 'KeyI' && !e.repeat && !App.paused) { toggleGear(); return; }
      if (k === 'Escape') { if (App.showGear) { toggleGear(); return; } if (App.buildMode) { App.buildMode = null; return; } if (App.lvOpen) { App.lvOpen = false; App.lvSig = null; return; } const me0e = App.me(); if (me0e && me0e.ao && !me0e.offers && !App.abDefer) { App.abDefer = true; App.lvSig = null; return; } if (App.selRef) { App.selRef = null; return; } togglePause(); return; }
      if (App.paused) return;
      App.keys.add(k);
      if (e.repeat) return;
      const me0 = App.me();
      if (k.startsWith('Digit')) {
        const i = parseInt(k.slice(5), 10) - 1;
        // цифры выбирают только в ОТКРЫТОМ меню (иначе можно взять умение вслепую)
        if (me0 && me0.offers && App.lvOpen && i < me0.offers.length) { pickSkill(i); return; }
        if (me0 && abShown(me0) && i < me0.ao.length) { pickAbility(i); return; }
      }
      if (k === 'KeyK' && me0 && me0.ao) { App.abDefer = !App.abDefer; if (!App.abDefer) App.lvOpen = false; App.lvSig = null; }
      if (k === 'KeyT') command('build1');
      if (k === 'KeyY') command('build2');
      if (k === 'KeyU') command('upnear');
      if (k === 'KeyH') command('build3');
      if (k === 'KeyE') command('eat');
      if (k === 'KeyF') setAutoPick(!App.autoPick);
      if (k === 'CapsLock') setRunAlways(!App.runAlways, true);
    });
    window.addEventListener('keyup', (e) => App.keys.delete(e.code));
    window.addEventListener('blur', () => { App.keys.clear(); App.mouse.down = false; });
    cv.addEventListener('mousemove', (e) => { App.mouse.x = e.clientX; App.mouse.y = e.clientY; App.mouse.onCanvas = true; App.hoverSlot = slotAt(e.clientX, e.clientY); });
    cv.addEventListener('mouseleave', () => { App.mouse.onCanvas = false; });
    cv.addEventListener('mousedown', (e) => {
      AB.Sound.unlock();
      if (e.button === 2 && App.state === 'play' && App.G) { secondaryAt(); return; }
      if (e.button !== 0 || App.state !== 'play' || App.paused) return;
      primaryAt(e.clientX, e.clientY, false);
    });
    function secondaryAt() {
        // в режиме стройки ПКМ отменяет его
        if (App.buildMode) { App.buildMode = null; return; }
        const mw = mouseWorld();
        const ref = AB.Sim.buildingAt(App.G, mw.x, mw.y);
        const me = App.me();
        // правый клик по костру с бревнами в рюкзаке — отдать все бревна в огонь (если далеко — сначала подойти)
        if (ref && ref[0] === 'f' && me && !me.dead && (me.inv.wood || 0) > 0 && !App.paused) {
          const f = App.G.fires.find(q => 'f' + q.id === ref);
          AB.Sound.play('click', 1);
          if (f && AB.dist(me.x, me.y, f.x, f.y) <= C().FIRE_DUMP_RANGE) { sendCmd('dumpfire', ref); App.pendingDump = null; }
          else if (f) { App.pendingDump = ref; App.pendingPick = null; App.moveTarget = { x: f.x, y: f.y + 24 }; App.clickMark = { x: f.x, y: f.y, t: 1 }; }
          return;
        }
        // правый клик по лесопилке со шкурами в рюкзаке — сдать все шкуры в кладовую (если далеко — сначала подойти)
        if (ref === 'm' && me && !me.dead && (me.inv.hide || 0) > 0 && !App.paused) {
          const S = App.G.store;
          AB.Sound.play('click', 1);
          if (S && AB.dist(me.x, me.y, S.x, S.y) <= C().MILL.radius) { sendCmd('dumphide', ref); App.pendingDump = null; }
          else if (S) { App.pendingDump = ref; App.pendingPick = null; App.moveTarget = { x: S.x, y: S.y + 24 }; App.clickMark = { x: S.x, y: S.y, t: 1 }; }
          return;
        }
        // правый клик по кухне с сырой едой — отдать всю еду в очередь (если далеко — сначала подойти)
        const rawN = me ? Object.keys(C().COOKING).reduce((a, k) => a + (me.inv[k] || 0), 0) : 0;
        if (ref === 'k' && me && !me.dead && rawN > 0 && !App.paused) {
          const K = App.G.kitchen;
          AB.Sound.play('click', 1);
          if (K && AB.dist(me.x, me.y, K.x, K.y) <= C().KITCHEN_RADIUS * 1.6) { sendCmd('dumpfood', ref); App.pendingDump = null; }
          else if (K) { App.pendingDump = ref; App.pendingPick = null; App.moveTarget = { x: K.x, y: K.y + 30 }; App.clickMark = { x: K.x, y: K.y, t: 1 }; }
          return;
        }
        App.selRef = ref;
        App.bpSig = null;
        if (App.selRef) AB.Sound.play('click', 1);
    }
    App.secondaryAt = secondaryAt;
    // Левый клик / касание: интерфейс, стройка, подбор предмета, иначе — идти (tap: к точке касания)
    function primaryAt(cx, cy, tap) {
      if (slotAt(cx, cy) >= 0) return;
      // клики по интерфейсу (рюкзак, еда, выбор навыка, стройка)
      const hit = uiHit(cx, cy);
      if (hit) { clickBtn(hit); return; }
      // режим стройки с верхней панели: клик по земле ставит постройку
      if (App.buildMode) { command(App.buildMode); if (App.buildMode === 'build3') App.buildMode = null; return; }
      // клик по предмету на земле
      const d = dropUnderMouse();
      if (d) {
        const me = App.me();
        if (me && AB.dist(me.x, me.y, d.x, d.y) <= C().PICKUP_REACH) sendCmd('pickup', d.id);
        else { App.pendingPick = d.id; App.moveTarget = { x: d.x, y: d.y }; App.clickMark = { x: d.x, y: d.y, t: 1 }; }
        return;
      }
      App.pendingPick = null; App.pendingDump = null;
      if (tap) { const mw = mouseWorld(); App.moveTarget = { x: mw.x, y: mw.y }; App.clickMark = { x: mw.x, y: mw.y, t: 1 }; }
      else App.mouse.down = true;
    }
    App.primaryAt = primaryAt;
    setupTouch(cv);
    // клик колесом (средняя кнопка) — съесть
    cv.addEventListener('mousedown', (e) => {
      if (!(e.button === 1 && App.state === 'play' && App.G && !App.paused)) return;
      e.preventDefault();
      AB.Sound.unlock();
      const hit = uiHit(e.clientX, e.clientY);
      if (hit) { clickBtn(hit); return; }
      command('eat');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) App.mouse.down = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function uiHit(x, y) {
    for (const c of (AB.Render.clicks || [])) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
    return null;
  }

  /* ============================ СЕНСОРНОЕ УПРАВЛЕНИЕ ============================
   * Любая часть экрана — плавающий джойстик (коснуться и вести палец).
   * Короткое касание земли — идти туда / поднять предмет / поставить постройку.
   * Долгое касание (≈0,45 с) — как правый клик: меню здания, бревна в костёр, шкуры на склад, посадка.
   * Второй палец — касание мира (например, тап по земле, пока первый ведёт джойстик). */
  const LONG_PRESS = 0.45;
  App.tw = {}; App.joy = null;
  function setTouchMode(on) {
    App.touch = !!on; AB.Render.touch = App.touch;
    document.body.classList.toggle('touch', App.touch);
  }
  App.setTouchMode = setTouchMode;
  function setupTouch(cv) {
    const opt = { passive: false };
    const now = () => performance.now() / 1000;
    cv.addEventListener('touchstart', (e) => {
      e.preventDefault();
      AB.Sound.unlock();
      if (!App.touch) setTouchMode(true);
      if (App.state !== 'play' || App.paused) return;
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        const hit = uiHit(x, y);
        if (hit) { clickBtn(hit); continue; }
        const si = slotAt(x, y);
        if (si >= 0) { App.tapSlot = si; App.tapSlotT = 2.5; continue; }
        // джойстик появляется там, где коснулись (в любой части экрана); второй палец — касание мира
        if (!App.joy) { App.joy = { id: t.identifier, ox: x, oy: y, x, y, t0: now(), moved: false }; continue; }
        App.tw[t.identifier] = { x0: x, y0: y, x, y, t0: now(), long: false, drag: false };
      }
    }, opt);
    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (App.joy && App.joy.id === t.identifier) { App.joy.x = x; App.joy.y = y; if (Math.hypot(x - App.joy.ox, y - App.joy.oy) > 10) App.joy.moved = true; continue; }
        const w = App.tw[t.identifier]; if (!w) continue;
        w.x = x; w.y = y;
        if (!w.long && Math.hypot(x - w.x0, y - w.y0) > 14) w.drag = true;
        if (w.drag) { App.mouse.x = x; App.mouse.y = y; App.mouse.down = true; App.pendingPick = null; }
      }
    }, opt);
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (App.joy && App.joy.id === t.identifier) {
          const J = App.joy; App.joy = null;
          if (!J.moved && now() - J.t0 < 0.3 && e.type === 'touchend') tapWorld(x, y, false);
          continue;
        }
        const w = App.tw[t.identifier]; if (!w) continue;
        delete App.tw[t.identifier];
        if (w.drag) { App.mouse.down = false; App.moveTarget = null; continue; }
        if (!w.long && e.type === 'touchend') tapWorld(x, y, false);
      }
    };
    cv.addEventListener('touchend', end, opt);
    cv.addEventListener('touchcancel', end, opt);
  }
  // касание по миру в экранных координатах: long=false — как левый клик, true — как правый
  function tapWorld(x, y, long) {
    if (App.state !== 'play' || App.paused || !App.G) return;
    // открытая панель (кроме карты) закрывается касанием мимо неё
    if (!long && App.mobPanel && App.mobPanel !== 'map') { App.mobPanel = null; return; }
    App.mouse.x = x; App.mouse.y = y; App.mouse.onCanvas = true;
    if (long) secondaryAtRef(); else App.primaryAt(x, y, true);
    App.mouse.onCanvas = false;
  }
  const secondaryAtRef = () => App.secondaryAt();
  function touchTick(dt) {
    if (App.tapSlotT > 0) { App.tapSlotT -= dt; if (App.tapSlotT <= 0) App.tapSlot = -1; }
    const t = performance.now() / 1000;
    App.lp = null;
    // джойстик, который держат не двигая, — тоже долгое нажатие (иначе в левой части экрана нельзя открыть здание)
    const J = App.joy;
    if (J && !J.moved) {
      const held = t - J.t0, need = LONG_PRESS + 0.15;
      if (held > 0.2) App.lp = { x: J.x, y: J.y, f: (held - 0.2) / (need - 0.2) };
      if (held >= need) { App.joy = null; App.lp = null; if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* */ } tapWorld(J.x, J.y, true); }
    }
    for (const id in App.tw) {
      const w = App.tw[id];
      if (w.long || w.drag) continue;
      const held = t - w.t0;
      if (held > 0.12) App.lp = { x: w.x, y: w.y, f: (held - 0.12) / (LONG_PRESS - 0.12) };
      if (held >= LONG_PRESS) { w.long = true; App.lp = null; if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* */ } tapWorld(w.x, w.y, true); }
    }
  }

  // Ячейка панели навыков под курсором (для подсказки)
  function slotAt(mx, my) {
    const R = AB.Render, k = R.hudK || 1;
    const x = mx / k, y = my / k;
    return (R.slots || []).findIndex(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
  }
  // меню боевого навыка: не мешает только открытое меню рассветного умения (невзятое умение больше не блокирует навыки)
  const abShown = (me) => me && me.ao && me.ao.length && !(me.offers && App.lvOpen) && !App.abDefer;
  function pickAbility(i) {
    AB.Sound.play('click', 1);
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c: 'apick', x: i, y: 0 });
    else AB.Sim.command(App.G, App.myId, 'apick', i, 0);
    App.lvSig = null;
  }
  function sendCmd(c, x) {
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c, x, y: 0 });
    else AB.Sim.command(App.G, App.myId, c, x, 0);
  }
  // клик по кнопке интерфейса: выбор режима стройки переключается, остальное — команды
  function clickBtn(c) {
    AB.Sound.play('click', 1);
    if (c.c === 'abopen') { App.abDefer = false; App.lvOpen = false; App.lvSig = null; return; }
    if (c.c === 'lvopen') { App.lvOpen = true; App.lvSig = null; return; }
    if (c.c === 'buildno') { AB.FX.toast(c.v, '#ff9d7a'); return; }
    if (c.c === 'm:pause') { togglePause(); return; }
    if (c.c === 'm:gear') { toggleGear(); return; }
    if (c.c === 'm:panel') { App.mobPanel = App.mobPanel === c.v ? null : c.v; return; }
    if (c.c === 'm:nop') return;
    if (c.c === 'm:run') { App.runMob = !App.runMob; AB.FX.toast(App.runMob ? 'Бег включён — сытость тратится в 4 раза быстрее' : 'Шагом', '#bfe4ff'); return; }
    if (c.c === 'm:cancelbuild') { App.buildMode = null; return; }
    if (c.c === 'eat' && !c.v) { command('eat'); return; }
    if (c.c === 'buildmode') {
      App.buildMode = (App.buildMode === c.v) ? null : c.v;
      if (App.touch) App.mobPanel = null; // на телефоне панель прячем, чтобы коснуться земли
      if (App.buildMode && !App.touch) AB.FX.toast('Режим стройки: клик по земле — построить, ПКМ/Esc — отмена', '#ffe7a8');
      return;
    }
    sendCmd(c.c, c.v);
  }
  function dropUnderMouse() {
    if (!App.G || !App.mouse.onCanvas) return null;
    const mw = mouseWorld();
    const r = App.touch ? 34 : 22;
    let best = null, bd = r * r;
    for (const d of App.G.drops) { const dd = AB.dist2(mw.x, mw.y, d.x, d.y - 6); if (dd < bd) { bd = dd; best = d; } }
    return best;
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
    AB.Sound.play('click', 1);
    const c = App.aoWasOpen ? 'areroll' : 'reroll'; // окно боевого навыка или умения
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c, x: 0, y: 0 });
    else AB.Sim.command(App.G, App.myId, c, 0, 0);
    App.lvSig = null;
  }
  // Кнопка «Сменить варианты» — цена в монетах казны
  function rerollButton(n) {
    const cost = AB.Skills.rerollPrice(n), coins = (App.G && App.G.coins) || 0, b = $('btnReroll');
    b.textContent = `Сменить варианты (${cost} $)`;
    b.disabled = coins < cost; b.style.opacity = coins < cost ? 0.5 : 1;
    b.title = coins < cost ? `В казне ${Math.floor(coins)} $` : '';
  }
  // Карточки выбора умения
  function updateLevelUI(me) {
    const cfg = C();
    const box = $('levelup');
    const offers = me && !me.dead && me.offers && App.state === 'play' ? me.offers : null;
    // меню умений открывается только по клику «+» (игра не останавливается)
    const showOffers = offers && App.lvOpen;
    App.aoWasOpen = false;
    if (!showOffers && me && !me.dead && App.state === 'play' && abShown(me)) { App.aoWasOpen = true; abilityUI(me, box); return; }
    if (me && !(me.aq > 0)) App.abDefer = false;
    $('btnLater').classList.add('hidden'); $('btnReroll').classList.remove('hidden');
    if (!showOffers) { box.classList.add('hidden'); App.lvSig = null; if (!offers) App.lvOpen = false; return; }
    const coinsHave = Math.floor(App.G.coins || 0);
    const sig = JSON.stringify(offers) + '|' + me.rr + '|' + me.queue.length + '|' + coinsHave;
    box.classList.remove('hidden');
    $('btnLater').classList.remove('hidden'); // «Выбрать позже» — игра идёт дальше
    if (sig === App.lvSig) return;
    App.lvSig = sig;
    const sup = me.queue[0] === 's';
    $('lvTitle').textContent = sup ? `Уровень ${me.level}: СУПЕР-УМЕНИЕ!` : `Уровень ${me.level}!`;
    $('lvTitle').className = 'lvtitle' + (sup ? ' super' : '');
    $('lvSub').textContent = (me.queue.length > 1 ? `Ещё выборов: ${me.queue.length - 1}. ` : '') + ' Игра продолжается — будьте осторожны!' + ` Редкость умений зависит от уровня костра (сейчас ${App.G.fireLevel}).`;
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
    rerollButton(me.rr);
  }
  // Выбор боевого навыка (уровень опыта)
  function abilityUI(me, box) {
    const cfg = C(), G = App.G;
    const iron = AB.Sim.ironOf(G, me);
    const sig = 'ab' + JSON.stringify(me.ao) + me.aq + iron + '|' + (me.arr || 0) + '|' + Math.floor(G.coins || 0);
    box.classList.remove('hidden');
    $('btnLater').classList.remove('hidden'); $('btnReroll').classList.remove('hidden');
    if (sig === App.lvSig) return;
    App.lvSig = sig;
    rerollButton(me.arr);
    $('lvTitle').textContent = `Уровень опыта ${me.xl}: боевой навык`;
    $('lvTitle').className = 'lvtitle ab';
    const learned = AB.Sim.abLearned(me);
    $('lvSub').textContent = `Навыков: ${learned} из ${cfg.ABILITY_MAX} (плюс начальное оружие). ` + (learned >= cfg.ABILITY_MAX ? 'Все слоты заняты — улучшайте взятые навыки. ' : 'Возьмите новый навык или улучшите взятый. ') + (me.aq > 1 ? `Ещё выборов: ${me.aq - 1}. ` : '') + 'Игра продолжается!';
    const cards = $('lvCards'); cards.innerHTML = '';
    me.ao.forEach((o, i) => {
      const def = AB.Sim.abDef(o.id); if (!def) return;
      const cur = me.ab.find(a => a.id === o.id);
      const pc = cfg.PROFESSIONS[def.prof].color, col = o.lv >= 4 ? '#dfe8ee' : o.lv > 1 ? '#6ac8ff' : pc;
      const S1 = AB.Sim.abStats(G, me, def, o.lv), S0 = cur ? AB.Sim.abStats(G, me, def, cur.lv) : null;
      const lines = [];
      const r1 = (v) => v < 10 ? v.toFixed(1) : Math.round(v);
      if (def.kind !== 'shield') lines.push(`Урон${def.kind === 'shot' && S1.n > 1 ? ' снаряда' : ''}: ${S0 ? r1(S0.dmg) + ' → ' : ''}${r1(S1.dmg)}${def.kind === 'aura' ? '/с' : ''}`);
      else lines.push(`Щит: ${cur ? Math.round(def.amount * (1 + 0.5 * (cur.lv - 1))) + ' → ' : ''}${Math.round(def.amount * (1 + 0.5 * (o.lv - 1)))}`);
      if (def.kind !== 'aura' && def.kind !== 'orbit') lines.push(`Перезарядка: ${S0 ? S0.cd.toFixed(2) + ' → ' : ''}${S1.cd.toFixed(2)} с`);
      if (def.kind !== 'shield') { const d1 = AB.Sim.abDps(G, me, def, S1), d0 = S0 ? AB.Sim.abDps(G, me, def, S0) : 0; lines.push(`≈ урон/с по цели: ${S0 ? d0.toFixed(1) + ' → ' : ''}<b>${d1.toFixed(1)}</b>`); }
      if (S1.radius && ['nova', 'aura', 'strike', 'mine'].includes(def.kind) && (!S0 || Math.round(S1.radius) > Math.round(S0.radius))) lines.push(`Радиус: ${S0 ? Math.round(S0.radius) + ' → ' : ''}${Math.round(S1.radius)}`);
      if (['shot', 'drone', 'orbit', 'strike', 'chain', 'turret', 'mine'].includes(def.kind) && (!S0 || S1.n > S0.n)) lines.push(`${({ shot: 'Снарядов', drone: 'Помощников', orbit: 'Предметов', strike: 'Ударов', chain: 'Перескоков', turret: 'Турелей', mine: 'Мин' })[def.kind]}: ${S0 ? S0.n + ' → ' : ''}${S1.n}`);
      const poor = o.iron > iron;
      const el = document.createElement('div');
      el.className = 'skill' + (poor ? ' poor' : '');
      el.style.borderColor = col; el.style.boxShadow = `0 0 ${6 + o.lv * 4}px ${col}44 inset`;
      el.innerHTML = `<div class="key">${i + 1}</div><div class="sico" style="color:${pc}">${def.icon}</div>
        <div class="sname">${def.name}</div>
        <div class="stier" style="color:${col}">${cur ? `${def.start ? 'Начальное оружие: ' : 'Улучшение: '}ур. ${cur.lv} → ${o.lv}` : 'Новый навык'}</div>
        <div class="snote">${def.desc}</div>
        ${lines.map(l => `<div class="sline">${l}</div>`).join('')}
        ${o.iron ? `<div class="iron${poor ? ' bad' : ''}">Нужно железа: ${o.iron} (есть ${iron})</div>` : ''}`;
      el.addEventListener('click', () => { if (!poor) pickAbility(i); });
      cards.appendChild(el);
    });
  }
  // Окно торговца
  function merchantCmd(c, x) {
    AB.Sound.play('click', 1);
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c, x, y: 0 });
    else AB.Sim.command(App.G, App.myId, c, x, 0);
    App.mcSig = null;
  }
  function updateMerchantUI(me) {
    const cfg = C(), box = $('merchant'), G = App.G;
    const M = G && G.merchant;
    const near = M && me && !me.dead && App.state === 'play' && !(me.offers && App.lvOpen) && AB.dist(me.x, me.y, M.x, M.y) < cfg.MERCHANT.radius;
    if (!near) { box.classList.add('hidden'); App.mcSig = null; return; }
    box.classList.remove('hidden');
    const coins = G.coins || 0;
    const sig = JSON.stringify(me.mo) + coins + JSON.stringify(me.skills) + JSON.stringify(me.mgBought || {}) + (me.axe || 1) + AB.Sim.woodOf(G, me) + (me.pick || 0);
    axeButton($('btnAxeMc'), me);
    if (sig === App.mcSig) return;
    App.mcSig = sig;
    $('mcCoins').innerHTML = `В казне: <b style="color:#ffd24a">${coins} $</b>. Монеты дают монстры, лавка охотника, биржа программиста и ратуша.`;
    const gb = $('mcGoods'); gb.innerHTML = '';
    cfg.MERCHANT_GOODS.forEach(g => {
      const b = document.createElement('button');
      b.className = 'upbtn'; b.style.borderColor = '#ffd24a';
      const done = (g.once && me.mgBought && me.mgBought[g.id]) || (g.id === 'pickaxe' && me.pick);
      b.innerHTML = `${g.name}${g.id === 'pickaxe' ? ' (камень и железо)' : ''} · <b style="color:#ffd24a">${g.price} $</b>${done ? (g.id === 'pickaxe' ? ' (есть)' : ' (куплено)') : ''}`;
      if (coins < g.price || done) b.disabled = true;
      b.addEventListener('click', () => merchantCmd('goods', g.id));
      gb.appendChild(b);
    });
    const box2 = $('mcOffers'); box2.innerHTML = '';
    (me.mo || []).forEach((o, i) => {
      const def = AB.Skills.find(o.id); if (!def) return;
      const col = cfg.TIER_COLORS[o.tier - 1];
      const price = (me.st.shopBuild > 0) ? Math.round(o.price * 0.75) : o.price; // охотнику −25%
      const el = document.createElement('div');
      el.className = 'skill' + (o.sold ? ' sold' : '') + (coins < price ? ' poor' : '');
      el.style.borderColor = col; el.style.minHeight = '150px';
      el.innerHTML = `<div class="sico" style="color:${col}">${def.icon || '✦'}</div><div class="sname">${def.name}</div>
        <div class="stier" style="color:${col}">${cfg.TIER_NAMES[o.tier - 1]}</div>
        ${AB.Skills.lines(def, o.tier).map(l => `<div class="sline${l.bad ? ' bad' : ''}">${l.s}</div>`).join('')}
        <div class="price">${o.sold ? 'Куплено' : price + ' $'}</div>`;
      el.addEventListener('click', () => merchantCmd('buy', i));
      box2.appendChild(el);
    });
    if (!(me.mo || []).length) box2.innerHTML = `<span class="note">Умения закончились.</span>`;
    const up = $('mcUp'); up.innerHTML = '';
    const best = {};
    me.skills.forEach(s => { if (!s.sup && s.tier < 4 && (!best[s.id] || s.tier > best[s.id])) best[s.id] = s.tier; });
    const ids = Object.keys(best);
    if (!ids.length) up.innerHTML = '<span class="note">Нет навыков для улучшения.</span>';
    ids.forEach(id => {
      const def = AB.Skills.find(id), tr = best[id], price = AB.Sim.upgradePrice(tr);
      const b = document.createElement('button');
      b.className = 'upbtn'; b.style.borderColor = cfg.TIER_COLORS[tr];
      const ir = tr === 3 ? (cfg.LEGEND_IRON || 0) : 0;
      b.innerHTML = `${def.icon || ''} ${def.name}: <span style="color:${cfg.TIER_COLORS[tr - 1]}">${cfg.TIER_NAMES[tr - 1]}</span> → <span style="color:${cfg.TIER_COLORS[tr]}">${cfg.TIER_NAMES[tr]}</span> · <b style="color:#ffd24a">${price} $</b>${ir ? ` + <b style="color:#dfe8ee">${ir} железа</b>` : ''}`;
      if (coins < price || AB.Sim.ironOf(G, me) < ir) b.disabled = true;
      b.addEventListener('click', () => merchantCmd('upgrade', id));
      up.appendChild(b);
    });
  }
  // Окна биржи и мастерской
  function nearStructOf(me, kind) {
    return App.G.structs.find(s => s.kind === kind && AB.dist2(me.x, me.y, s.x, s.y) < 80 * 80);
  }
  function updateEcoUI(me) {
    const cfg = C(), G = App.G;
    const ok = me && !me.dead && App.state === 'play' && !(me.offers && App.lvOpen);
    const ex = ok && nearStructOf(me, 'exchange');
    $('exchange').classList.toggle('hidden', !ex);
    if (ex) {
      const cr = G.crypto, h = cr.hist || [];
      const sig = h.join(',') + cr.held + G.coins;
      if (sig !== App.exSig) {
        App.exSig = sig;
        const cv = $('exChart'), c = cv.getContext('2d');
        c.clearRect(0, 0, cv.width, cv.height);
        if (h.length > 1) {
          const mx = Math.max(...h) * 1.05, mn = Math.min(...h) * 0.95;
          c.strokeStyle = 'rgba(255,255,255,0.08)'; for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, i * 27); c.lineTo(300, i * 27); c.stroke(); }
          c.strokeStyle = h[h.length - 1] >= h[0] ? '#5aff8a' : '#ff5a4a'; c.lineWidth = 2; c.beginPath();
          h.forEach((v, i) => { const x = i / (h.length - 1) * 296 + 2, y = 106 - (v - mn) / (mx - mn || 1) * 100; i ? c.lineTo(x, y) : c.moveTo(x, y); });
          c.stroke();
        }
        $('exInfo').innerHTML = `Курс AviCoin: <b style="color:#9fdcff">${cr.price} $</b> · у команды: <b>${cr.held}</b> (≈${Math.floor(cr.held * cr.price)} $) · в казне: <b style="color:#ffd24a">${G.coins} $</b>`;
      }
    }
    const ws = ok && nearStructOf(me, 'workshop');
    $('workshop').classList.toggle('hidden', !ws);
    if (ws) {
      const sig = G.coins + '|' + AB.Sim.woodOf(G, me) + '|' + AB.Sim.ironOf(G, me) + '|' + (me.axe || 1) + '|' + AB.Sim.bl(ws) + '|' + (me.pick || 0);
      if (sig !== App.wsSig) {
        App.wsSig = sig;
        $('wsInfo').innerHTML = `Мастерская ур. ${AB.Sim.bl(ws)}: урон боевых навыков всех игроков <b>+${Math.round(cfg.BUILD_UPGRADES.workshop.abDmg * (AB.Sim.bl(ws) - 1) * 100)}%</b> (улучшение — правый клик по мастерской).<br>Топор ур. ${me.axe || 1}: быстрее рубит деревья. Монстров топор не бьёт.`;
        axeButton($('btnAxeWs'), me);
        pickButton($('btnPickWs'), me, ws);
      }
    }
  }
  function pickButton(b, me, ws) {
    const PC = C().PICKAXE_CRAFT, G = App.G;
    if (me.pick) { b.textContent = 'Кирка: уже есть'; b.disabled = true; }
    else if (AB.Sim.bl(ws) < PC.workshopLevel) { b.textContent = `Кирка: нужна мастерская ур. ${PC.workshopLevel}`; b.disabled = true; }
    else {
      b.textContent = `Сделать кирку: ${PC.coins} $ + ${PC.planks} досок + ${PC.iron} железа`;
      b.disabled = G.coins < PC.coins || AB.Sim.woodOf(G, me) < PC.planks || AB.Sim.ironOf(G, me) < PC.iron;
    }
    b.style.opacity = b.disabled ? 0.5 : 1;
  }
  function axeButton(b, me) {
    const cfg = C(), lv = me.axe || 1, G = App.G;
    if (lv >= AB.Sim.axeMax()) { b.textContent = `Топор: максимум (ур. ${lv}, дерево за ${AB.Sim.axeHits(lv)} удара)`; b.disabled = true; }
    else {
      const hits = AB.Sim.axeHits(lv + 1), ac = AB.Sim.axeCost(G, lv);
      b.textContent = `Топор ур.${lv}→${lv + 1} (дерево за ${hits} ударов): ${ac.coins} $ + ${ac.planks} досок${ac.iron ? ` + ${ac.iron} железа` : ''}`;
      b.disabled = G.coins < ac.coins || AB.Sim.woodOf(G, me) < ac.planks || AB.Sim.ironOf(G, me) < ac.iron;
    }
    b.style.opacity = b.disabled ? 0.5 : 1;
  }
  // Меню здания (правый клик): описание, улучшения, модификации
  function updateBuildingUI(me) {
    const cfg = C(), box = $('bpanel'), G = App.G;
    const b = App.selRef && me && App.state === 'play' && !(me.offers && App.lvOpen) ? AB.Sim.buildingByRef(G, App.selRef) : null;
    if (!b) { box.classList.add('hidden'); App.bpSig = null; if (App.selRef && App.state === 'play' && !(me && me.offers && App.lvOpen)) App.selRef = null; return; }
    box.classList.remove('hidden');
    const planks = AB.Sim.woodOf(G, me);
    const ironH = AB.Sim.ironOf(G, me), stoneH = AB.Sim.stoneOf(G, me);
    const sig = JSON.stringify([b.title, b.now, b.asp, b.mods, planks, G.coins, me.prof, ironH, stoneH, me.axe, App.selRef === 'k' ? Object.keys(cfg.COOKING).map(k => me.inv[k] || 0) : 0]);
    if (sig === App.bpSig) return;
    App.bpSig = sig;
    $('bpTitle').textContent = b.title;
    $('bpDesc').textContent = b.desc;
    $('bpNow').innerHTML = b.now.join('<br>');
    const pn = { feed: 'подбрасывайте бревна и уголь, стоя у костра', any: 'любой игрок', hunter: 'охотник', engineer: 'инженер', programmer: 'программист', architect: 'архитектор' };
    const box2 = $('bpAsp'); box2.innerHTML = '';
    b.asp.forEach(a => {
      const el = document.createElement('div'); el.className = 'asp';
      const max = a.lvl >= a.max || a.cost == null;
      const can = AB.Sim.canUpgrade(me, a);
      let body;
      if (max) body = '<div class="an">Максимальный уровень</div>';
      else if (a.by === 'feed') body = `<div class="an">Следующий уровень: ${a.next}</div><div class="bar"><div style="width:${Math.round(a.prog / a.cost * 100)}%"></div></div><div class="an">Топливо ${a.prog}/${a.cost} — заполните шкалу</div><div class="who">${pn.feed}</div>`;
      else body = `<div class="an">Следующий уровень: ${a.next}</div>` + `<div class="an">Цена: ${a.cost} досок${a.iron ? ` + <b style="color:#dfe8ee">${a.iron} железа</b>` : ''}${a.stone ? ` + <b style="color:#d8d0c0">${a.stone} камня</b>` : ''} · на складе ${planks}${a.iron ? `, железа ${ironH}` : ''}${a.stone ? `, камня ${stoneH}` : ''}</div>` + (can ? `<button class="btn small gold">Улучшить</button>` : `<div class="who">Улучшает: ${pn[a.by]}</div>`);
      el.innerHTML = `<div class="ah"><span>${a.name}</span><span>ур. ${a.lvl}/${a.max}</span></div>` + body;
      const btn = el.querySelector('button');
      if (btn) { if (planks < a.cost || ironH < (a.iron || 0) || stoneH < (a.stone || 0)) { btn.disabled = true; btn.style.opacity = 0.5; } btn.addEventListener('click', () => { AB.Sound.play('click', 1); sendCmd2('bup', b.ref, a.key); }); }
      box2.appendChild(el);
    });
    // кухня: отдать всю сырую еду в очередь
    if (App.selRef === 'k') {
      const raw = Object.keys(cfg.COOKING).reduce((a, k) => a + (me.inv[k] || 0), 0);
      const el = document.createElement('div'); el.className = 'asp';
      el.innerHTML = `<div class="ah"><span>Готовка</span><span>в инвентаре ${raw}</span></div><div class="an">Сырое мясо, морковь и тыква встают в очередь. Готовые блюда появятся на столе у кухни — подойдите, и они попадут в инвентарь.</div><button class="btn small gold">${raw ? `Отдать всю еду (${raw})` : 'Нет сырой еды'}</button>`;
      const btn = el.querySelector('button'); if (!raw) { btn.disabled = true; btn.style.opacity = 0.5; }
      btn.addEventListener('click', () => { AB.Sound.play('click', 1); const K = G.kitchen; if (AB.dist(me.x, me.y, K.x, K.y) <= cfg.KITCHEN_RADIUS * 1.6) sendCmd2('dumpfood', 'k', 0); else { App.pendingDump = 'k'; App.moveTarget = { x: K.x, y: K.y + 30 }; } });
      box2.appendChild(el);
    }
    // на лесопилке любой игрок улучшает свой топор
    if (App.selRef === 'm') {
      const el = document.createElement('div'); el.className = 'asp';
      const lv = me.axe || 1;
      el.innerHTML = `<div class="ah"><span>Ваш топор</span><span>ур. ${lv}/${AB.Sim.axeMax()}</span></div><div class="an">Сейчас дерево падает за ${AB.Sim.axeHits(lv)} ударов${lv < AB.Sim.axeMax() ? `, после улучшения — за ${AB.Sim.axeHits(lv + 1)}` : ''}.</div><button class="btn small gold"></button>`;
      const btn = el.querySelector('button'); axeButton(btn, me);
      if (lv < AB.Sim.axeMax()) { const ac = AB.Sim.axeCost(G, lv); btn.textContent = `Улучшить: ${ac.coins} $ + ${ac.planks} досок${ac.iron ? ` + ${ac.iron} железа` : ''}`; } else btn.textContent = 'Максимальный уровень';
      btn.addEventListener('click', () => { AB.Sound.play('click', 1); sendCmd2('axeup', 'mill', 0); });
      box2.appendChild(el);
    }
    const mb = $('bpMods'); mb.innerHTML = '';
    if (!b.mods.length) mb.innerHTML = '<div class="note left">У этого здания нет модификаций.</div>';
    const MC = cfg.MOD_COST, afford = planks >= MC.planks && G.coins >= MC.coins;
    b.mods.forEach(md => {
      const el = document.createElement('div');
      el.className = 'mod' + (md.on ? ' on' : '') + (!md.on && !afford ? ' poor' : '');
      el.innerHTML = `<b>${md.on ? '✔ ' : ''}${md.name}</b><div class="an">${md.desc}</div>${md.on ? '' : `<div class="an">Установить: ${MC.planks} досок + ${MC.coins} $</div>`}`;
      if (!md.on) el.addEventListener('click', () => { AB.Sound.play('click', 1); sendCmd2('bmod', b.ref, md.id); });
      mb.appendChild(el);
    });
  }
  function sendCmd2(c, x, y) {
    if (App.mode === 'guest') AB.Net.send({ t: 'cmd', c, x, y });
    else AB.Sim.command(App.G, App.myId, c, x, y);
    App.bpSig = null;
  }
  function toggleBuild() { App.showBuild = !App.showBuild; App.buildSig = null; }
  /* ============================ ПОСЕЛЕНИЯ ============================ */
  // Приветствие при входе в поселение и в новый край
  function townArrival(me) {
    const G = App.G; if (!me || !G || !G.W.towns) return;
    const tn = G.W.towns.find(q => AB.dist2(me.x, me.y, q.x, q.y) < (q.r + 40) ** 2);
    const id = tn ? tn.id : -1;
    if (id !== App.inTown) { App.inTown = id; if (tn) AB.FX.toast(`${tn.name}: вечный костёр, торговцы. Здесь безопасно`, '#ffe7a8'); }
    const W = G.W, i = Math.floor(me.y / W.T) * W.N + Math.floor(me.x / W.T), b = W.biome && W.bmix[i] > 0.6 ? W.biome[i] : 0;
    if (b !== App.inBiome) { const was = App.inBiome; App.inBiome = b; if (b && was !== undefined) { const B = C().BIOMES[AB.biomeKey(b)]; AB.FX.toast(`${B.name}`, B.color); } }
  }
  function nearestTrader(me) {
    const G = App.G, R = C().TRADER_RADIUS; let best = null, bd = R * R;
    for (const tn of (G.W.towns || [])) for (const tr of tn.traders) { const d = AB.dist2(me.x, me.y, tr.x, tr.y); if (d < bd) { bd = d; best = tr; } }
    return best;
  }
  function updateTraderUI(me) {
    const cfg = C(), G = App.G, box = $('trader');
    const tr = me && !me.dead && App.state === 'play' && !App.showGear ? nearestTrader(me) : null;
    const st = tr && G.tstock ? G.tstock[tr.id] : null;
    if (!tr || !st) { box.classList.add('hidden'); App.trSig = null; return; }
    box.classList.remove('hidden');
    const sig = JSON.stringify([tr.id, st, G.coins, me.eq, me.pick, me.bagUp]);
    if (sig === App.trSig) return;
    App.trSig = sig;
    const town = G.W.towns[tr.town];
    $('trTitle').textContent = `${tr.name} · ${town.name}`;
    $('trInfo').innerHTML = `В казне: <b style="color:#ffd24a">${G.coins} $</b>. Товар обновляется каждый рассвет. Купленная одежда попадает в снаряжение (I).`;
    const GR = cfg.GEAR, L = cfg.STAT_LABELS;
    const gb = $('trGear'); gb.innerHTML = '';
    st.gear.forEach(it => {
      const R = GR.rarity[it.r], cur = (me.eq || {})[it.s], better = AB.Sim.itemScore(it) > AB.Sim.itemScore(cur);
      const el = document.createElement('div');
      el.className = 'tritem' + (G.coins < it.price ? ' poor' : '');
      el.style.borderColor = R.color;
      const lines = Object.keys(it.m).map(k => { const v = it.m[k], c0 = cur ? (cur.m[k] || 0) : 0, dv = Math.round((v - c0) * 100) / 100; return `<div>${v > 0 ? '+' : ''}${v}${L[k] && L[k][1] ? '%' : ''} ${L[k] ? L[k][0] : k}${dv ? ` <span class="${dv > 0 ? 'up' : 'down'}">(${dv > 0 ? '+' : ''}${dv})</span>` : ''}</div>`; }).join('');
      el.innerHTML = `<div class="th"><img src="${AB.Render.itemIcon(it)}" alt=""><div><div class="tn" style="color:${R.color}">${it.n}${better ? ' ▲' : ''}</div><div class="ts">${R.name} · ${GR.slotNames[it.s]} · сила ${it.pw}</div></div></div>${lines}<div class="price">${it.price} $</div>`;
      el.addEventListener('click', () => { AB.Sound.play('click', 1); sendCmd2('tbuy', tr.id, 'g' + it.id); App.trSig = null; });
      gb.appendChild(el);
    });
    gb.style.display = st.gear.length ? '' : 'none';
    const go = $('trGoods'); go.innerHTML = '';
    st.goods.forEach(id => {
      const g = cfg.TOWN_GOODS[id]; if (!g) return;
      const b = document.createElement('button'); b.className = 'trgood';
      const done = (g.once && st.once[me.id + ':' + id]) || (id === 'pickaxe' && me.pick);
      const icon = { planks: 'plank', bag: 'hide', pickaxe: 'pickaxe' }[id] || id;
      const ic = AB.Sprites.icons[icon];
      b.innerHTML = `${ic ? `<img src="${ic.toDataURL ? ic.toDataURL() : ''}" alt="">` : ''}${g.name}${g.n > 1 ? ' ×' + g.n : ''} · <b>${g.price} $</b>${done ? ' ✓' : ''}`;
      b.disabled = done || G.coins < g.price;
      b.addEventListener('click', () => { AB.Sound.play('click', 1); sendCmd2('tbuy', tr.id, id); App.trSig = null; });
      go.appendChild(b);
    });
  }

  /* ============================ СНАРЯЖЕНИЕ ============================ */
  function toggleGear() { App.showGear = !App.showGear; App.gearSig = null; App.gearSel = null; if (App.showGear) App.mobPanel = null; }
  App.toggleGear = toggleGear;
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function statLine(k, v, cmp) {
    const L = C().STAT_LABELS[k] || [k, false], n = Math.round(v * 100) / 100;
    let d = '';
    if (cmp !== undefined) { const dv = Math.round((v - cmp) * 100) / 100; if (dv) d = ` <span class="${dv > 0 ? 'up' : 'down'}">(${dv > 0 ? '+' : ''}${dv}${L[1] ? '%' : ''})</span>`; }
    return `<div>${n > 0 ? '+' : ''}${n}${L[1] ? '%' : ''} ${esc(L[0])}${d}</div>`;
  }
  function itemInfo(it, eqd, where) {
    const cfg = C(), R = cfg.GEAR.rarity[it.r];
    let h = `<div class="gname" style="color:${R.color}">${esc(it.n)}</div><div class="gsub">${R.name} · ${cfg.GEAR.slotNames[it.s]} · сила ${it.pw}</div>`;
    const keys = new Set(Object.keys(it.m).concat(eqd && where === 'wd' ? Object.keys(eqd.m) : []));
    keys.forEach(k => { const v = it.m[k] || 0; h += where === 'wd' && eqd ? (v ? statLine(k, v, eqd.m[k] || 0) : `<div class="down">−${Math.round(eqd.m[k] * 100) / 100}${(C().STAT_LABELS[k] || [])[1] ? '%' : ''} ${esc((C().STAT_LABELS[k] || [k])[0])} (пропадёт)</div>`) : statLine(k, v); });
    if (where === 'wd') h += `<div class="gbtns"><button class="btn gold" data-g="equip">Надеть${eqd ? ' (заменить)' : ''}</button><button class="btn ghost" data-g="scrap">Разобрать · +${AB.Sim.scrapValue(it)} $</button></div>`;
    else h += `<div class="gbtns"><button class="btn ghost" data-g="unequip">Снять</button></div>`;
    return h;
  }
  function updateGearUI(me) {
    const cfg = C(), box = $('gear');
    if (!App.showGear || !me || App.state !== 'play') { box.classList.add('hidden'); App.gearSig = null; return; }
    box.classList.remove('hidden');
    AB.Render.drawHero($('gearHero'), me);
    const eq = me.eq || {}, wd = me.wd || [];
    const sig = JSON.stringify(eq) + JSON.stringify(wd) + JSON.stringify(App.gearSel) + JSON.stringify(me.st);
    if (sig === App.gearSig) return;
    App.gearSig = sig;
    const GR = cfg.GEAR, sel = App.gearSel;
    document.querySelectorAll('#gear .gslot').forEach(el => {
      const slot = el.dataset.slot, it = eq[slot];
      el.classList.toggle('full', !!it); el.classList.toggle('sel', !!(sel && sel.w === 'eq' && sel.s === slot));
      el.style.borderColor = it ? GR.rarity[it.r].color : '';
      el.innerHTML = (it ? `<img src="${AB.Render.itemIcon(it)}" alt="">` : '') + `<span class="gl">${GR.slotNames[slot]}</span>`;
      el.title = it ? it.n : GR.slotNames[slot];
    });
    $('gearCount').textContent = `${wd.length} / ${GR.wardrobe}`;
    let cells = '';
    for (let i = 0; i < GR.wardrobe; i++) {
      const it = wd[i];
      if (!it) { cells += '<div class="gcell"></div>'; continue; }
      const better = AB.Sim.itemScore(it) > AB.Sim.itemScore(eq[it.s]);
      cells += `<div class="gcell${better ? ' up' : ''}${sel && sel.w === 'wd' && sel.i === i ? ' sel' : ''}" data-i="${i}" style="border-color:${GR.rarity[it.r].color}" title="${esc(it.n)}"><img src="${AB.Render.itemIcon(it)}" alt=""></div>`;
    }
    $('gearWd').innerHTML = cells;
    let info = '<span class="note">Нажмите на вещь, чтобы посмотреть её свойства. Двойной клик — надеть. ▲ — лучше надетой.</span>';
    if (sel && sel.w === 'wd' && wd[sel.i]) info = itemInfo(wd[sel.i], eq[wd[sel.i].s], 'wd');
    else if (sel && sel.w === 'eq' && eq[sel.s]) info = itemInfo(eq[sel.s], null, 'eq');
    $('gearInfo').innerHTML = info;
    // суммарные бонусы одежды
    const sum = {};
    for (const k in eq) { const it = eq[k]; if (it) for (const q in it.m) sum[q] = (sum[q] || 0) + it.m[q]; }
    const L = cfg.STAT_LABELS;
    $('gearStats').innerHTML = Object.keys(sum).length ? '<b>Одежда даёт:</b> ' + Object.keys(sum).map(k => `${Math.round(sum[k] * 100) / 100 > 0 ? '+' : ''}${Math.round(sum[k] * 100) / 100}${L[k] && L[k][1] ? '%' : ''} ${esc(L[k] ? L[k][0] : k)}`).join(' · ') : '<span class="note">Одежды пока нет — ищите её в сундуках охраняемых локаций.</span>';
  }
  function setupGearUI() {
    const GR = () => C().GEAR;
    $('gear').addEventListener('click', (e) => {
      const me = App.me(); if (!me) return;
      const slotEl = e.target.closest('.gslot'), cell = e.target.closest('.gcell[data-i]'), btn = e.target.closest('[data-g]');
      if (btn) {
        const sel = App.gearSel; if (!sel) return;
        AB.Sound.play('click', 1);
        if (btn.dataset.g === 'equip') sendCmd('equip', sel.i);
        else if (btn.dataset.g === 'scrap') sendCmd('scrap', sel.i);
        else if (btn.dataset.g === 'unequip') sendCmd('unequip', GR().slots.indexOf(sel.s));
        App.gearSel = null; App.gearSig = null; return;
      }
      if (slotEl) { App.gearSel = me.eq && me.eq[slotEl.dataset.slot] ? { w: 'eq', s: slotEl.dataset.slot } : null; App.gearSig = null; AB.Sound.play('click', 0.6); return; }
      if (cell) { App.gearSel = { w: 'wd', i: +cell.dataset.i }; App.gearSig = null; AB.Sound.play('click', 0.6); }
    });
    $('gear').addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.gcell[data-i]'); if (!cell) return;
      sendCmd('equip', +cell.dataset.i); App.gearSel = null; App.gearSig = null; AB.Sound.play('click', 1);
    });
    $('gearClose').addEventListener('click', () => { AB.Sound.play('click', 1); toggleGear(); });
  }
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
    $('pauseNote').textContent = (App.mode === 'solo' ? 'Игра на паузе' : 'В игре вдвоём время не останавливается!') + ` · Сложность: ${(AB.DIFFS[AB.difficulty] || {}).name || ''}`;
    $('btnSave').classList.toggle('hidden', !App.saveKey || App.mode === 'guest');
  }

  function controlLocal(me, dt) {
    // смерть чистит очередь действий, иначе после возрождения уводит
    if (!me || me.dead) { App.pendingDump = null; App.pendingPick = null; App.moveTarget = null; return; }
    // упёрлись в туман войны — подсказка (не чаще раза в 6 с)
    if (me.fowHit && App.G && App.G.clock - me.fowHit < 0.2 && !(App.fowToast > performance.now())) {
      App.fowToast = performance.now() + 6000;
      const lv = App.G.fireLevel || 1;
      AB.FX.toast(`Туман войны — дальше не пройти. Прокачайте костёр до ур. ${lv + 1}, чтобы он отступил`, '#9fd3ff');
    }
    let dx = 0, dy = 0;
    const K = App.keys;
    // бег: пробел; при «всегда бегом» пробел наоборот — шагом. На телефоне — кнопка-переключатель.
    me.run = App.touch ? !!App.runMob : (App.runAlways ? !K.has('Space') : K.has('Space'));
    if (me.run && me.moving) {
      App.dustT = (App.dustT || 0) - dt;
      if (App.dustT <= 0) { App.dustT = 0.12; AB.FX.add({ t: 'smoke', x: me.x - Math.cos(me.a || 0) * 6, y: me.y + 4, z: 1, vx: (Math.random() - 0.5) * 16, vy: -4, vz: 8, g: 0, life: 0.45, size: 3 + Math.random() * 2, c: 'rgba(176,156,118,' }); }
    }
    if (K.has('ArrowLeft') || K.has('KeyA')) dx -= 1;
    if (K.has('ArrowRight') || K.has('KeyD')) dx += 1;
    if (K.has('ArrowUp') || K.has('KeyW')) dy -= 1;
    if (K.has('ArrowDown') || K.has('KeyS')) dy += 1;
    // сенсорный джойстик
    if (App.joy && App.joy.moved) { const jx = App.joy.x - App.joy.ox, jy = App.joy.y - App.joy.oy; if (Math.hypot(jx, jy) > 8) { dx = jx; dy = jy; App.pendingPick = null; App.pendingDump = null; } }
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
    if (App.pendingDump) {
      if (App.pendingDump === 'k') {
        const K = App.G.kitchen, raw = Object.keys(C().COOKING).reduce((a, k) => a + (me.inv[k] || 0), 0);
        if (!K || !raw || (dx === 0 && dy === 0 && !App.moveTarget)) App.pendingDump = null;
        else if (AB.dist(me.x, me.y, K.x, K.y) <= C().KITCHEN_RADIUS * 0.9) { sendCmd('dumpfood', 'k'); App.pendingDump = null; App.moveTarget = null; dx = 0; dy = 0; }
      } else if (App.pendingDump === 'm') {
        const S = App.G.store;
        if (!S || !(me.inv.hide > 0) || (dx === 0 && dy === 0 && !App.moveTarget)) App.pendingDump = null;
        else if (AB.dist(me.x, me.y, S.x, S.y) <= C().MILL.radius * 0.9) { sendCmd('dumphide', App.pendingDump); App.pendingDump = null; App.moveTarget = null; dx = 0; dy = 0; }
      } else {
        const f = App.G.fires.find(q => 'f' + q.id === App.pendingDump);
        if (!f || !(me.inv.wood > 0) || (dx === 0 && dy === 0 && !App.moveTarget)) App.pendingDump = null;
        else if (AB.dist(me.x, me.y, f.x, f.y) <= C().FIRE_DUMP_RANGE * 0.9) { sendCmd('dumpfire', App.pendingDump); App.pendingDump = null; App.moveTarget = null; dx = 0; dy = 0; }
      }
    }
    if (App.pendingPick) {
      const d = App.G.drops.find(q => q.id === App.pendingPick);
      if (!d) App.pendingPick = null;
      else if (AB.dist(me.x, me.y, d.x, d.y) <= C().PICKUP_REACH * 0.8) { sendCmd('pickup', d.id); App.pendingPick = null; App.moveTarget = null; dx = 0; dy = 0; }
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

  // «Всегда бегом» (ПК): бег без пробела, пробел — идти шагом. Запоминается в браузере.
  function setRunAlways(on, toast) {
    App.runAlways = !!on;
    try { localStorage.setItem('avibro-run', on ? '1' : '0'); } catch (e) { /* */ }
    const cb = $('optRun'); if (cb) cb.checked = App.runAlways;
    if (toast) AB.FX.toast(on ? 'Всегда бегом (пробел — идти шагом). Бег тратит сытость в 4 раза быстрее' : 'Шагом (пробел — бежать)', '#bfe4ff');
  }
  try { App.runAlways = localStorage.getItem('avibro-run') === '1'; } catch (e) { App.runAlways = false; }

  /* ============================ ЦИКЛ ============================ */
  // Облегчённая графика: включается сама, если кадры долгие (слабый ПК, энергосбережение в браузере)
  function setLowQ(on, manual) {
    AB.Render.lowQ = !!on; App.lowQManual = manual && !on; AB.Render.resize();
    try { localStorage.setItem('avibro-lowq2', on ? '1' : manual ? '0' : ''); } catch (e) { /* */ }
    const cb = $('optLowQ'); if (cb) cb.checked = !!on;
  }
  try { const v = localStorage.getItem('avibro-lowq2'); if (v === '1') AB.Render.lowQ = true; App.lowQManual = v === '0'; } catch (e) { /* */ }
  // Судим по медиане длительности кадра за 5 с (единичные подвисания не в счёт) и только если плохо два окна подряд
  const perf = { t: 0, a: [], bad: 0 };
  function watchPerf(rawDt) {
    if (AB.Render.lowQ || App.lowQManual || App.state !== 'play' || App.paused || document.hidden) { perf.t = 0; perf.a.length = 0; perf.bad = 0; return; }
    if (rawDt > 0.5) return;                       // вкладка была свёрнута
    perf.t += rawDt; perf.a.push(rawDt);
    if (perf.t < 5) return;
    const a = perf.a.sort((x, y) => x - y), med = a[a.length >> 1];
    perf.t = 0; perf.a.length = 0;
    if (App.playT > 8 && med > 1 / 40) perf.bad++; else perf.bad = 0;
    if (perf.bad >= 2) { setLowQ(true); AB.FX.toast('Игра тормозит — включена облегчённая графика (меню паузы)', '#9fd3ff'); }
  }
  // Счётчик FPS: кадры за полсекунды (рисует render.js, галочка в паузе)
  const fpsC = { n: 0, t: 0 };
  function countFps(now) {
    fpsC.n++;
    if (!fpsC.t) fpsC.t = now;
    if (now - fpsC.t >= 500) { AB.Render.fps = Math.round(fpsC.n * 1000 / (now - fpsC.t)); fpsC.n = 0; fpsC.t = now; }
  }
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    App.playT = App.state === 'play' ? (App.playT || 0) + dt : 0;
    watchPerf(dt);
    countFps(now);
    if (dt > 0.05) dt = 0.05;
    try { tick(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    const G = App.G;
    if (!G) return;
    const R = AB.Render;
    R.bakeIdle(2, 4);
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
    // игра не останавливается на выборах: меню умений/навыков открывается только по клику «+»
    const running = !(App.paused && App.mode === 'solo') && !G.over;
    if (running) {
      controlLocal(me, dt);
      if (App.mode === 'solo' || App.mode === 'host') {
        AB.Sim.update(G, dt);
        if (G.saveReq) { G.saveReq = false; saveGame(); }
        if (App.mode === 'host' && AB.Net.open) {
          App.sendT -= dt;
          if (App.sendT <= 0) { App.sendT = 1 / C().NET_SNAPSHOT_HZ; AB.Net.send(AB.Sim.snapshot(G, false)); }
        } else { G.fxOut = []; G.treeDirty.clear(); G.bushDirty.clear(); }
        if (G.over && App.mode === 'host') AB.Net.send(AB.Sim.snapshot(G, false));
      } else if (App.mode === 'guest') {
        G.clock += dt;
        const ti = AB.Sim.timeInfo(G.clock); G.nightF = ti.nightF; G.isNight = ti.isNight; G.day = ti.day;
        App.inT -= dt;
        if (App.inT <= 0 && me) { App.inT = 1 / C().NET_INPUT_HZ; AB.Net.send({ t: 'in', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, a: Math.round(me.a * 100) / 100, mv: me.moving ? 1 : 0, rn: me.run ? 1 : 0, tp: me.tp }); }
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
    R.draw(G, me, App.cam, dt, { clickMark: App.clickMark, sel: App.selRef });
    // новый оффер боевого навыка ждёт клика «+», а не всплывает сам (но для следующего выбора меню не закрываем)
    if (me && me.ao && me.ao !== App.aoRef) {
      App.aoRef = me.ao;
      if (!App.aoWasOpen) { App.abDefer = true; App.lvSig = null; }
    } else if (!me || !me.ao) App.aoRef = null;
    const lvPlus = me && !me.dead && me.offers && !App.lvOpen && App.state === 'play' ? me.queue.length : 0;
    // доски кончились во время стройки — выходим из режима сами (не нужно жать Esc)
    if (App.buildMode && AB.Render.buildBlocked === App.buildMode) { App.buildMode = null; AB.FX.toast('Не хватает досок — режим стройки выключен', '#ff9d7a'); }
    if (App.touch) touchTick(dt);
    R.hud(G, me, { mouse: App.mouse.onCanvas && !App.touch ? App.mouse : null, hoverSlot: App.hoverSlot, lvPlus, buildMode: App.buildMode,
      touch: App.touch, mobPanel: App.mobPanel, joy: App.joy, lp: App.lp, tapSlot: App.tapSlot, showJoyHint: G.clock < 60 });
    AB.Render.hoverDrop = (dropUnderMouse() || {}).id;
    updateLevelUI(me);
    updateMerchantUI(me);
    updateEcoUI(me);
    updateBuildingUI(me);
    updateBuildUI(me);
    updateGearUI(me);
    updateTraderUI(me);
    townArrival(me);
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
    for (const o of (G.W.ores || [])) if (o.shake > 0) o.shake = Math.max(0, o.shake - dt);
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
    const overG = G;
    setTimeout(() => { if (App.G === overG && overG.over) show('over'); }, 1200);
  }

  /* ============================ ИНИЦИАЛИЗАЦИЯ ============================ */
  function init() {
    App.netReady = AB.Net.detect().then(sv => {
      if (sv) { const el = $('netInfo'); el.textContent = `Свой сервер: игра вдвоём без интернета. Ссылка для второго ПК: ${(sv.links && sv.links[0]) || location.origin}`; el.classList.remove('hidden'); }
    });
    AB.Sprites.init();
    AB.Render.init($('game'));
    setupInput();
    { // телефон: по грубому указателю или ?mobile=1 / ?mobile=0
      const qs = new URLSearchParams(location.search);
      let t = false; try { t = matchMedia('(pointer: coarse)').matches; } catch (e) { /* */ }
      setTouchMode(qs.has('mobile') ? qs.get('mobile') !== '0' : t);
    }
    try { $('name').value = $('name2').value = localStorage.getItem('avibro-name') || ''; } catch (e) { /* */ }
    $('name').addEventListener('input', () => $('name2').value = $('name').value);
    $('name2').addEventListener('input', () => $('name').value = $('name2').value);
    const bind = (id, fn) => $(id).addEventListener('click', () => { AB.Sound.unlock(); AB.Sound.play('click', 1); fn(); });
    try { App.prof = localStorage.getItem('avibro-prof') || 'hunter'; } catch (e) { App.prof = 'hunter'; }
    document.querySelectorAll('#diffBox .diff').forEach(b => b.addEventListener('click', () => { AB.Sound.play('click', 1); App.diff = b.dataset.diff; try { localStorage.setItem('avibro-diff', App.diff); } catch (e) { /* */ } showDiff(); }));
    // Один игрок: есть сохранение - выбор "Продолжить / Новая игра" (новая игра иначе молча заменит его на рассвете)
    const soloEntry = (profChosen) => {
      // сервер должен быть уже определён - иначе сохранение ищется не в том хранилище
      App.netReady.then(() => AB.Save.load(AB.Save.keySolo())).then(d => {
        if (!AB.Save.ok(d)) { if (profChosen === true) startSolo(); else chooseProf(startSolo, 'menu'); return; }
        App.contData = d;
        $('contNote').textContent = AB.Save.label(d);
        show('cont');
      });
    };
    bind('btnSolo', soloEntry);
    bind('btnCont', () => { const d = App.contData; App.contData = null; if (d) continueSolo(d); });
    bind('btnNew', () => chooseProf(startSolo, 'cont'));
    bind('btnReroll', reroll);
    bind('bpClose', () => { App.selRef = null; });
    bind('btnLater', () => { App.abDefer = true; App.lvOpen = false; App.lvSig = null; });
    bind('btnAxeWs', () => { sendCmd('axeup', 0); App.wsSig = null; });
    bind('btnAxeMc', () => { sendCmd('axeup', 0); App.mcSig = null; });
    bind('btnPickWs', () => { sendCmd('pickcraft', 0); App.wsSig = null; });
    try { App.autoPick = localStorage.getItem('avibro-autopick') === null ? !!C().AUTO_PICKUP : localStorage.getItem('avibro-autopick') === '1'; } catch (e) { App.autoPick = !!C().AUTO_PICKUP; }
    $('optAutoPick').checked = App.autoPick;
    $('optRun').checked = App.runAlways;
    $('optRun').addEventListener('change', (e) => setRunAlways(e.target.checked, false));
    $('optLowQ').checked = !!AB.Render.lowQ;
    $('optLowQ').addEventListener('change', (e) => setLowQ(e.target.checked, true));
    try { AB.Render.showFps = localStorage.getItem('avibro-fps') !== '0'; } catch (e) { AB.Render.showFps = true; }
    $('optFps').checked = AB.Render.showFps;
    $('optFps').addEventListener('change', (e) => { AB.Render.showFps = e.target.checked; try { localStorage.setItem('avibro-fps', e.target.checked ? '1' : '0'); } catch (e2) { /* */ } });
    $('optAutoPick').addEventListener('change', (e) => setAutoPick(e.target.checked));
    document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { AB.Sound.play('click', 1); const [c, v] = b.dataset.ex.split(':'); sendCmd(c, v === 'all' ? 'all' : +v); App.exSig = null; }));
    bind('btnCoop', () => { show('coop'); $('coopErr').textContent = ''; $('peerWarn').classList.toggle('hidden', AB.Net.available() || !!AB.Net.server); setupCoopScreen(); });
    bind('btnLanCopy', () => { const t = $('lanLink').textContent; try { navigator.clipboard.writeText(t); } catch (e) { /* */ } $('btnLanCopy').textContent = 'Скопировано!'; setTimeout(() => $('btnLanCopy').textContent = 'Копировать', 1500); });
    bind('btnSrvGo', () => { let u = $('srvUrl').value.trim(); if (!u) return; if (!/^https?:\/\//.test(u)) u = 'http://' + u; try { localStorage.setItem('avibro-srv', u); } catch (e) { /* */ } location.href = u; });
    bind('btnUpdate', () => {
      if (!$('btnUpdate').dataset.t) $('btnUpdate').dataset.t = $('btnUpdate').textContent;
      $('btnUpdate').textContent = 'Скачиваю обновление…'; $('btnUpdate').disabled = true;
      fetch('/update', { cache: 'no-store' }).then(r => r.json()).then(j => {
        if (j.ok && !j.files) { const b = $('btnUpdate'); b.textContent = 'Уже последняя версия ✓'; setTimeout(() => { b.textContent = b.dataset.t || 'Обновить игру'; b.disabled = false; }, 2500); }
        else if (j.ok) { $('btnUpdate').textContent = `Обновлено (изменено файлов: ${j.files}). Перезапуск…`; setTimeout(() => location.reload(), 4000); }
        else { $('btnUpdate').textContent = 'Не удалось: ' + (j.error || 'ошибка'); $('btnUpdate').disabled = false; }
      }).catch(() => { $('btnUpdate').textContent = 'Сервер перезапускается…'; setTimeout(() => location.reload(), 4000); });
    });
    bind('btnStop', () => {
      const b = $('btnStop');
      if (!b.dataset.arm) { b.dataset.arm = 1; b.textContent = 'Точно остановить? Нажмите ещё раз'; setTimeout(() => { delete b.dataset.arm; if (!b.disabled) b.textContent = 'Остановить сервер'; }, 3000); return; }
      b.disabled = true; clearTimeout(App.roomsT);
      fetch('/stop', { cache: 'no-store' }).catch(() => { /* */ }).finally(() => {
        b.textContent = 'Сервер остановлен. Запуск — значком «Avi-Bro сервер»';
        $('roomsList').innerHTML = '<span class="note">Сервер выключен.</span>';
        $('btnHost').disabled = true; $('btnUpdate').disabled = true;
      });
    });
    bind('btnHelp', () => show('help'));
    bind('btnSaves', showSaves);
    bind('btnHost', () => chooseProf(startHost, 'coop'));
    bind('btnJoin', () => { const code = $('code').value; if (code.replace(/\D/g, '').length < 3) { $('coopErr').textContent = 'Введите код комнаты'; return; } chooseProf(() => startJoin(code), 'coop', true); });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { AB.Net.close(); show(b.dataset.back); }));
    bind('btnCopy', () => { const i = $('roomLink'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } $('btnCopy').textContent = 'Скопировано!'; setTimeout(() => $('btnCopy').textContent = 'Копировать', 1500); });
    bind('btnSoloFromLobby', () => { AB.Net.close(); soloEntry(true); });
    bind('btnResume', togglePause);
    bind('btnPauseBuild', () => { togglePause(); toggleBuild(); });
    bind('btnPauseGear', () => { togglePause(); if (!App.showGear) toggleGear(); });
    setupGearUI();
    bind('btnFull', () => App.goFull());
    bind('btnBuildClose', () => { if (App.showBuild) toggleBuild(); });
    bind('btnQuit', () => { saveGame(); endToMenu(); });
    bind('btnMenu', () => { saveGame(); endToMenu(); });
    bind('btnSave', () => saveGame(false, true));
    window.addEventListener('beforeunload', () => { if (App.state === 'play') saveGame(true); });
    bind('btnRetry', soloEntry);
    $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

    startAttract();
    show('menu');
    // Приглашение по ссылке: показываем кнопку в главном меню и убираем код из адреса
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      const b = $('btnInvite');
      b.textContent = `Присоединиться к комнате ${room}`;
      b.classList.remove('hidden');
      b.addEventListener('click', () => { AB.Sound.unlock(); $('code').value = room; chooseProf(() => startJoin(room), 'menu', true); b.classList.add('hidden'); });
      try { const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u.pathname + (u.search || '')); } catch (e) { /* */ }
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('load', init);
})(window.AB);
