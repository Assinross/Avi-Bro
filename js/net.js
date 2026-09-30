// Сеть для игры вдвоём. Три транспорта:
//  1) ЛОКАЛЬНЫЙ СЕРВЕР (server.py): если игра открыта с него (http://IP:8067) — сообщения идут через него по WebSocket.
//     Интернет не нужен, работает в любой локальной сети.
//  2) PeerJS (WebRTC) — если игра открыта с GitHub Pages; нужен доступ к облачному серверу PeerJS.
// Для отладки на одном компьютере: добавьте к адресу ?local=1 — тогда вкладки общаются через BroadcastChannel.
(function (AB) {
  const Net = AB.Net = { role: null, conn: null, peer: null, open: false };
  const C = () => window.CONFIG;
  const local = new URLSearchParams(location.search).has('local');
  Net.isLocal = local;

  function genCode() {
    let s = '';
    for (let i = 0; i < C().ROOM_CODE_LENGTH; i++) s += Math.floor(Math.random() * 10);
    if (s[0] === '0') s = '1' + s.slice(1);
    return s;
  }
  function peerOpts() {
    const o = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } };
    if (C().PEER_SERVER) Object.assign(o, C().PEER_SERVER);
    return o;
  }
  // Определяем, открыта ли игра с нашего локального сервера
  Net.server = null;
  Net.detect = function () {
    const mode = C().NET_MODE || 'auto';
    if (local || mode === 'peerjs' || location.protocol === 'file:' || location.hostname.endsWith('github.io')) return Promise.resolve(null);
    return fetch('/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      if (j && j.server === 'avibro') Net.server = j;
      return Net.server;
    }).catch(() => null);
  };
  // Адрес страницы, который можно отправить второму игроку
  Net.shareBase = function () {
    if (Net.server && /^(localhost|127\.)/.test(location.hostname) && Net.server.ips.length) return `http://${Net.server.ips[0]}:${location.port || Net.server.port}${location.pathname}`;
    return location.origin + location.pathname;
  };
  Net.available = function () { return local || !!Net.server || typeof window.Peer === 'function'; };
  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }

  // ---------- ХОСТ ----------
  // h: { ready(code), guest(), data(msg), guestLeft(), error(text) }
  Net.host = function (h) {
    Net.close();
    Net.role = 'host';
    const code = genCode();
    Net.code = code;
    if (local) {
      const bc = new BroadcastChannel('avibro-' + code);
      Net.bc = bc;
      bc.onmessage = (e) => {
        const m = e.data;
        if (m.from !== 'guest') return;
        if (m.d && m.d.t === '_open') { Net.open = true; h.guest(); return; }
        if (m.d && m.d.t === '_close') { Net.open = false; h.guestLeft(); return; }
        h.data(m.d);
      };
      Net.conn = { send: (d) => bc.postMessage({ from: 'host', d }) };
      setTimeout(() => h.ready(code), 50);
      return;
    }
    if (Net.server) {
      const ws = new WebSocket(wsUrl());
      Net.ws = ws;
      Net.conn = { send: (d) => { if (ws.readyState === 1) ws.send(JSON.stringify(d)); }, close: () => ws.close() };
      ws.onopen = () => ws.send(JSON.stringify({ t: '_host', code: Net.code, name: h.name || '', prof: h.prof || '' }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === '_ok') { h.ready(Net.code); return; }
        if (m.t === '_taken') { Net.code = genCode(); ws.send(JSON.stringify({ t: '_host', code: Net.code, name: h.name || '', prof: h.prof || '' })); h.ready(Net.code); return; }
        if (m.t === '_open') { Net.open = true; h.guest(); return; }
        if (m.t === '_close') { Net.open = false; h.guestLeft(); return; }
        h.data(m);
      };
      ws.onclose = () => { if (Net.ws !== ws) return; Net.ws = null; Net.open = false; h.error('Нет связи с локальным сервером игры. Хост: проверьте, что server.py запущен.'); };
      ws.onerror = () => h.error('Нет связи с локальным сервером игры. Он запущен (python3 server.py)?');
      return;
    }
    if (!Net.available()) { h.error('Не загрузилась библиотека PeerJS. Проверьте интернет или запустите локальный сервер (python3 server.py).'); return; }
    const peer = new Peer(C().PEER_PREFIX + code, peerOpts());
    Net.peer = peer;
    peer.on('open', () => h.ready(code));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { Net.host(h); return; }
      h.error(errText(e));
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* */ } });
    peer.on('connection', (c) => {
      if (Net.conn && Net.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); }); return; }
      Net.conn = c;
      c.on('open', () => { Net.open = true; h.guest(); });
      c.on('data', (d) => h.data(d));
      c.on('close', () => { if (Net.conn === c) { Net.open = false; h.guestLeft(); } });
      c.on('error', () => { /* */ });
    });
  };

  // ---------- ГОСТЬ ----------
  // h: { open(), data(msg), closed(), error(text) }
  Net.join = function (code, h) {
    Net.close();
    Net.role = 'guest';
    Net.code = code;
    if (local) {
      const bc = new BroadcastChannel('avibro-' + code);
      Net.bc = bc;
      bc.onmessage = (e) => {
        if (e.data.from !== 'host') return;
        const d = e.data.d;
        if (d && d.t === '_close') { Net.open = false; h.closed(); return; }
        h.data(d);
      };
      Net.conn = { send: (d) => bc.postMessage({ from: 'guest', d }) };
      Net.open = true;
      const onun = () => { try { bc.postMessage({ from: 'guest', d: { t: '_close' } }); } catch (e2) { /* */ } };
      window.addEventListener('beforeunload', onun);
      Net._onun = onun;
      setTimeout(() => { Net.conn.send({ t: '_open' }); h.open(); }, 50);
      return;
    }
    if (Net.server) {
      const ws = new WebSocket(wsUrl());
      Net.ws = ws;
      let opened = false;
      Net.conn = { send: (d) => { if (ws.readyState === 1) ws.send(JSON.stringify(d)); }, close: () => ws.close() };
      ws.onopen = () => ws.send(JSON.stringify({ t: '_join', code }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === '_joined') { opened = true; Net.open = true; h.open(); return; }
        if (m.t === '_nf') { h.error('Комната с таким кодом не найдена.'); return; }
        if (m.t === '_full') { h.error('В комнате уже два игрока.'); return; }
        if (m.t === '_hostgone') { Net.open = false; h.closed(); return; }
        h.data(m);
      };
      ws.onclose = () => { if (Net.ws !== ws) return; Net.ws = null; if (opened) { Net.open = false; h.closed(); } else h.error('Нет связи с локальным сервером игры.'); };
      ws.onerror = () => { if (!opened) h.error('Нет связи с локальным сервером игры.'); };
      return;
    }
    if (!Net.available()) { h.error('Не загрузилась библиотека PeerJS. Проверьте интернет или откройте игру с локального сервера (python3 server.py).'); return; }
    const peer = new Peer(peerOpts());
    Net.peer = peer;
    let opened = false;
    const to = setTimeout(() => { if (!opened) h.error('Не удалось подключиться. Проверьте код комнаты.'); }, 15000);
    peer.on('open', () => {
      const c = peer.connect(C().PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      Net.conn = c;
      c.on('open', () => { opened = true; clearTimeout(to); Net.open = true; h.open(); });
      c.on('data', (d) => h.data(d));
      c.on('close', () => { clearTimeout(to); Net.open = false; h.closed(); });
    });
    peer.on('error', (e) => { clearTimeout(to); h.error(errText(e)); });
  };

  Net.send = function (d) {
    if (!Net.conn || !Net.open) return;
    try { Net.conn.send(d); } catch (e) { /* */ }
  };

  Net.close = function () {
    if (Net._onun) { window.removeEventListener('beforeunload', Net._onun); Net._onun = null; }
    if (Net.bc) { try { if (Net.role === 'host') Net.bc.postMessage({ from: 'host', d: { t: '_close' } }); else if (Net.role === 'guest') Net.bc.postMessage({ from: 'guest', d: { t: '_close' } }); Net.bc.close(); } catch (e) { /* */ } Net.bc = null; }
    if (Net.conn && Net.conn.close) { try { Net.conn.close(); } catch (e) { /* */ } }
    Net.ws = null;
    if (Net.peer) { try { Net.peer.destroy(); } catch (e) { /* */ } }
    Net.conn = null; Net.peer = null; Net.open = false; Net.role = null;
  };

  function errText(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'Комната с таким кодом не найдена.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Нет связи с облачным сервером PeerJS (его может блокировать провайдер, VPN или антивирус). Запустите локальный сервер: python3 server.py — см. README.';
    if (t === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
    return 'Ошибка сети: ' + (t || e);
  }
})(window.AB);
