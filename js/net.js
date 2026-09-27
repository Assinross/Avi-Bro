// Сеть для игры вдвоём. Основной транспорт — WebRTC через PeerJS (данные идут напрямую между ПК).
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
  Net.available = function () { return local || typeof window.Peer === 'function'; };

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
    if (!Net.available()) { h.error('Не загрузилась библиотека PeerJS. Проверьте интернет.'); return; }
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
      bc.onmessage = (e) => { if (e.data.from === 'host') h.data(e.data.d); };
      Net.conn = { send: (d) => bc.postMessage({ from: 'guest', d }) };
      Net.open = true;
      window.addEventListener('beforeunload', () => bc.postMessage({ from: 'guest', d: { t: '_close' } }));
      setTimeout(() => { Net.conn.send({ t: '_open' }); h.open(); }, 50);
      return;
    }
    if (!Net.available()) { h.error('Не загрузилась библиотека PeerJS. Проверьте интернет.'); return; }
    const peer = new Peer(peerOpts());
    Net.peer = peer;
    let opened = false;
    const to = setTimeout(() => { if (!opened) h.error('Не удалось подключиться. Проверьте код комнаты.'); }, 15000);
    peer.on('open', () => {
      const c = peer.connect(C().PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      Net.conn = c;
      c.on('open', () => { opened = true; clearTimeout(to); Net.open = true; h.open(); });
      c.on('data', (d) => h.data(d));
      c.on('close', () => { Net.open = false; h.closed(); });
    });
    peer.on('error', (e) => { clearTimeout(to); h.error(errText(e)); });
  };

  Net.send = function (d) {
    if (!Net.conn || !Net.open) return;
    try { Net.conn.send(d); } catch (e) { /* */ }
  };

  Net.close = function () {
    if (Net.bc) { try { if (Net.role === 'guest') Net.bc.postMessage({ from: 'guest', d: { t: '_close' } }); Net.bc.close(); } catch (e) { /* */ } Net.bc = null; }
    if (Net.conn && Net.conn.close) { try { Net.conn.close(); } catch (e) { /* */ } }
    if (Net.peer) { try { Net.peer.destroy(); } catch (e) { /* */ } }
    Net.conn = null; Net.peer = null; Net.open = false; Net.role = null;
  };

  function errText(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'Комната с таким кодом не найдена.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Нет связи с сервером соединения PeerJS. Проверьте интернет.';
    if (t === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
    return 'Ошибка сети: ' + (t || e);
  }
})(window.AB);
