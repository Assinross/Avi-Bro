// Визуальные эффекты (частицы, всплывающие надписи, сообщения) и синтезированные звуки.
(function (AB) {
  const FX = AB.FX = { parts: [], toasts: [], shake: 0, flash: 0, myId: 0, listener: { x: 0, y: 0 } };
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);

  FX.reset = function () { FX.parts = []; FX.toasts = []; FX.shake = 0; FX.flash = 0; };

  FX.add = function (p) {
    if (FX.parts.length >= window.CONFIG.PARTICLES_MAX) FX.parts.shift();
    p.life = p.max = p.life || 1;
    FX.parts.push(p);
    return p;
  };
  function burst(x, y, n, colors, spd, opt) {
    opt = opt || {};
    for (let i = 0; i < n; i++) {
      const a = opt.dir !== undefined ? opt.dir + rnd(-opt.spread, opt.spread) : rnd(0, TAU);
      const s = rnd(spd * 0.3, spd);
      FX.add({ t: opt.type || 'p', x, y, z: opt.z || 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(40, 140) * (opt.up || 1),
        g: opt.g !== undefined ? opt.g : 380, life: rnd(0.4, 0.9) * (opt.life || 1), size: rnd(1.5, 3.5) * (opt.size || 1), c: colors[(Math.random() * colors.length) | 0], rot: rnd(0, TAU), vr: rnd(-8, 8) });
    }
  }
  FX.burst = burst;
  FX.text = function (x, y, s, c, big) { FX.add({ t: 'txt', x, y, z: 20, vx: rnd(-10, 10), vy: 0, vz: 60, g: 90, life: 0.9, s, c, big }); };
  FX.toast = function (s, c) {
    FX.toasts.push({ s, c: c || '#ffe7a8', t: 4 });
    if (FX.toasts.length > 5) FX.toasts.shift();
  };

  const BLOOD = { wolf: ['#8e1c1c', '#b3302a', '#5e1010'], alpha: ['#8e1c1c', '#b3302a', '#5e1010'], ghoul: ['#4c6b2a', '#2f4a1a', '#7a8f3a'], shade: ['#6a3fa0', '#9b6ad8', '#2a1840'], brute: ['#6a1c1c', '#3a4a1a', '#8e2c1c'] };

  FX.play = function (ev) {
    const near = (ev.x === undefined) ? 1 : AB.clamp(1 - AB.dist(ev.x, ev.y, FX.listener.x, FX.listener.y) / 900, 0, 1);
    switch (ev.k) {
      case 'msg': if (ev.p === -1 || ev.p === FX.myId) { FX.toast(ev.s, ev.c); } break;
      case 'snd': Sound.play(ev.s, 1); break;
      case 'chop':
        burst(ev.x, ev.y + 8, 6, ['#c8a06a', '#8a5a30', '#e0c08a'], 110, { size: 1.1 });
        burst(ev.x, ev.y - 30, 3, ['#4f8a3a', '#6fa84a', '#2e5e2a'], 60, { type: 'leaf', g: 40, life: 2.2, up: 0.2 });
        Sound.play('chop', near); break;
      case 'fell':
        burst(ev.x, ev.y - 40, 26, ['#4f8a3a', '#6fa84a', '#2e5e2a', '#8fae45'], 150, { type: 'leaf', g: 50, life: 2.5, up: 0.4, z: 40 });
        burst(ev.x, ev.y, 10, ['#c8a06a', '#8a5a30'], 140);
        FX.add({ t: 'smoke', x: ev.x, y: ev.y, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.8, size: 26, c: 'rgba(150,130,100,' });
        Sound.play('fell', near); break;
      case 'swing': Sound.play('swing', near * 0.7); break;
      case 'shoot': Sound.play(ev.w === 'rifle' ? 'gun' : 'bow', near);
        if (ev.w === 'rifle') FX.add({ t: 'flash', x: ev.x + Math.cos(ev.a) * 30, y: ev.y + Math.sin(ev.a) * 30, z: 10, vx: 0, vy: 0, vz: 0, g: 0, life: 0.08, size: 18 });
        break;
      case 'hit':
        burst(ev.x, ev.y, 8, BLOOD[ev.t] || BLOOD.wolf, 160, { size: 1.1 });
        if (window.CONFIG.SHOW_DAMAGE_NUMBERS) FX.text(ev.x, ev.y - 20, String(ev.n), '#ffffff');
        Sound.play('hit', near); break;
      case 'die':
        burst(ev.x, ev.y, 22, BLOOD[ev.t] || BLOOD.wolf, 200, { size: 1.3 });
        FX.add({ t: 'smoke', x: ev.x, y: ev.y, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.7, size: 22, c: ev.t === 'shade' ? 'rgba(120,80,190,' : 'rgba(70,60,50,' });
        Sound.play('die', near); break;
      case 'phit':
        burst(ev.x, ev.y, 7, ['#b3302a', '#8e1c1c'], 120);
        FX.text(ev.x, ev.y - 26, '-' + ev.n, '#ff6a6a');
        if (ev.pid === FX.myId) { FX.shake = Math.min(12, FX.shake + 6); FX.flash = 0.35; Sound.play('hurt', 1); }
        break;
      case 'pdie': burst(ev.x, ev.y, 30, ['#b3302a', '#8e1c1c', '#ddd'], 200); Sound.play('die', 1); break;
      case 'pick':
        if (ev.pid === FX.myId) { Sound.play('pick', 0.8); FX.add({ t: 'icon', x: ev.x, y: ev.y, z: 10, vx: 0, vy: 0, vz: 50, g: 20, life: 0.7, it: ev.it }); }
        break;
      case 'eat': FX.text(ev.x, ev.y - 30, '+' + window.CONFIG.FOOD[ev.it].food + ' сытость', '#ffc46b'); Sound.play('eat', near); break;
      case 'feed': burst(ev.x, ev.y - 6, 10, ['#ffd24a', '#ff8a2a', '#fff2a8'], 90, { type: 'spark', g: -60, life: 1.3 }); break;
      case 'plant': burst(ev.x, ev.y, 10, ['#6a4a2a', '#8a6a3a'], 70); Sound.play('plant', near); break;
      case 'build': burst(ev.x, ev.y, 18, ['#8a6a3a', '#c8a06a', '#6a4a2a'], 120); FX.add({ t: 'smoke', x: ev.x, y: ev.y, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.6, size: 24, c: 'rgba(160,140,110,' }); Sound.play('build', near); break;
      case 'chest': burst(ev.x, ev.y - 10, 36, ['#ffd24a', '#fff2a8', '#ffb02a'], 160, { type: 'spark', g: 60, life: 1.4 }); Sound.play('chest', near); break;
      case 'rustle': burst(ev.x, ev.y - 10, 6, ['#4f8a3a', '#6fa84a'], 60, { type: 'leaf', g: 40, life: 1.5, up: 0.3 }); break;
      case 'thud': burst(ev.x, ev.y, 5, ['#aaa', '#777'], 80); break;
    }
  };

  FX.update = function (dt) {
    for (let i = FX.parts.length - 1; i >= 0; i--) {
      const p = FX.parts[i];
      p.life -= dt;
      if (p.life <= 0) { FX.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.t === 'leaf') { p.vx *= 0.97; p.vy *= 0.97; p.x += Math.sin(p.life * 5 + p.rot) * 20 * dt; if (p.vz < -30) p.vz = -30; }
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
      p.rot += (p.vr || 0) * dt;
    }
    for (let i = FX.toasts.length - 1; i >= 0; i--) { FX.toasts[i].t -= dt; if (FX.toasts[i].t <= 0) FX.toasts.splice(i, 1); }
    FX.shake = Math.max(0, FX.shake - dt * 30);
    FX.flash = Math.max(0, FX.flash - dt);
  };

  /* ---------------------------- Звук ---------------------------- */
  const Sound = AB.Sound = { ctx: null, last: {} };
  Sound.unlock = function () {
    if (Sound.ctx) { if (Sound.ctx.state === 'suspended') Sound.ctx.resume(); return; }
    try { Sound.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { Sound.ctx = null; }
  };
  function tone(f, dur, type, vol, slide, delay) {
    const a = Sound.ctx, t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq, q, delay) {
    const a = Sound.ctx, t0 = a.currentTime + (delay || 0);
    const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = a.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t0);
  }
  Sound.play = function (k, v) {
    if (!Sound.ctx || v <= 0.02) return;
    const now = performance.now();
    if (Sound.last[k] && now - Sound.last[k] < 45) return;
    Sound.last[k] = now;
    const V = window.CONFIG.SOUND_VOLUME * v;
    try {
      switch (k) {
        case 'chop': noise(0.12, V * 0.9, 900, 2); tone(140, 0.08, 'triangle', V * 0.5, 0.6); break;
        case 'fell': noise(0.5, V, 300, 0.8); tone(90, 0.4, 'sine', V * 0.6, 0.5); break;
        case 'swing': noise(0.12, V * 0.4, 2400, 1.5); break;
        case 'bow': tone(420, 0.1, 'triangle', V * 0.4, 0.5); noise(0.08, V * 0.3, 3000, 2); break;
        case 'gun': noise(0.25, V * 1.3, 700, 0.7); tone(120, 0.15, 'square', V * 0.3, 0.3); break;
        case 'hit': noise(0.08, V * 0.7, 500, 1.5); tone(200, 0.06, 'square', V * 0.2, 0.5); break;
        case 'die': tone(220, 0.3, 'sawtooth', V * 0.25, 0.3); noise(0.25, V * 0.5, 400, 1); break;
        case 'hurt': tone(160, 0.18, 'square', V * 0.35, 0.6); break;
        case 'pick': tone(880, 0.06, 'sine', V * 0.35, 1.5); break;
        case 'eat': noise(0.1, V * 0.5, 1200, 3); noise(0.1, V * 0.5, 1000, 3, 0.14); break;
        case 'plant': noise(0.15, V * 0.5, 600, 1); break;
        case 'build': noise(0.1, V * 0.7, 800, 2); noise(0.1, V * 0.7, 700, 2, 0.15); break;
        case 'chest': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', V * 0.35, 1, i * 0.08)); break;
        case 'night': tone(220, 1.6, 'sine', V * 0.4, 0.5); tone(330, 1.6, 'sine', V * 0.2, 0.5, 0.3); break;
        case 'click': tone(660, 0.05, 'sine', V * 0.3, 1.2); break;
      }
    } catch (e) { /* звук не критичен */ }
  };
})(window.AB);
