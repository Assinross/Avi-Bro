// Общие вспомогательные функции: случайные числа, шум, математика.
window.AB = window.AB || {};
(function (AB) {
  // Детерминированный генератор (одинаковый мир у хоста и гостя при одном seed)
  AB.rng = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    return f;
  };

  // Хеш двух целых -> [0,1)
  AB.hash2 = function (x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  // Сглаженный value-noise и фрактальный шум
  AB.noise = function (x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = AB.hash2(xi, yi, s), b = AB.hash2(xi + 1, yi, s);
    const c = AB.hash2(xi, yi + 1, s), d = AB.hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  AB.fbm = function (x, y, s, oct) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < (oct || 4); i++) {
      sum += AB.noise(x * f, y * f, s + i * 17) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };

  AB.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  AB.lerp = (a, b, t) => a + (b - a) * t;
  AB.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  AB.dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  AB.angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  AB.smooth = (t) => t * t * (3 - 2 * t);
  AB.rgb = (c, a) => a === undefined ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
  AB.mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
  AB.hex = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  AB.shade = (hex, k) => { const c = AB.hex(hex); return AB.rgb(k >= 0 ? AB.mix(c, [255, 255, 255], k) : AB.mix(c, [0, 0, 0], -k)); };

  AB.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    return c;
  };

  // Названия предметов для интерфейса
  AB.itemName = function (k) {
    const C = window.CONFIG;
    if (C.FOOD[k]) return C.FOOD[k].name;
    return ({ wood: 'Бревна', plank: 'Доски', coal: 'Уголь', seed_carrot: 'Семена моркови', seed_pumpkin: 'Семена тыквы', hide: 'Шкура', coin: 'Монеты', iron: 'Железо', stone: 'Камень', pickaxe: 'Кирка', xp: 'Опыт' })[k] || k;
  };

  /* Быстрое рисование готовых спрайтов.
     Масштабировать картинку при каждом кадре дорого (особенно без видеокарты — так рисует Яндекс Браузер
     в режиме энергосбережения). Поэтому держим копию спрайта, уже уменьшенную/увеличенную под текущий
     масштаб экрана, и кладём её 1:1 в целые пиксели — это в 10–15 раз дешевле.
     (ax, ay) — точка привязки внутри картинки в единицах dw/dh (обычно «земля под предметом»). */
  AB.blitGen = 1;
  AB.blit = function (ctx, img, dx, dy, dw, dh, ax, ay) {
    const m = ctx.getTransform();
    const iw = img.width, ih = img.height;
    if (m.b !== 0 || m.c !== 0 || m.a <= 0 || Math.abs(m.a - m.d) > 1e-6 || !iw || !ih) { ctx.drawImage(img, dx, dy, dw, dh); return; }
    const S = Math.round(m.a * dw / iw * 20) / 20;              // шаг масштаба ~4% — глазу незаметно
    if (S <= 0) return;
    let mp = img._bc;
    if (!mp || mp.gen !== AB.blitGen || mp.size > 32) { mp = img._bc = new Map(); mp.gen = AB.blitGen; }
    let c = mp.get(S);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(iw * S)); c.height = Math.max(1, Math.round(ih * S));
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      mp.set(S, c);
    }
    const px = m.a * (dx + ax) + m.e, py = m.d * (dy + ay) + m.f;   // точка привязки на экране
    const fx = ax / dw, fy = ay / dh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, Math.round(px - fx * c.width), Math.round(py - fy * c.height));
    ctx.setTransform(m);
  };

  /* Сложность. config.js — «Хардкор»; «Аркада» заменяет часть значений из arcade.js.
     Переключается перед началом игры (у гостя — как у хоста). */
  const BASE = JSON.parse(JSON.stringify(window.CONFIG));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function merge(dst, src) { for (const k in src) { if (isObj(src[k]) && isObj(dst[k])) merge(dst[k], src[k]); else dst[k] = JSON.parse(JSON.stringify(src[k])); } }
  AB.DIFFS = {
    arcade: { name: (window.ARCADE && window.ARCADE.name) || 'Аркада', desc: (window.ARCADE && window.ARCADE.desc) || '' },
    hardcore: { name: 'Хардкор', desc: 'Честная выживалка: меньше здоровья, монстры бьют больнее, голод сильнее.' },
  };
  AB.difficulty = 'hardcore';
  AB.setDifficulty = function (id) {
    if (!AB.DIFFS[id]) id = 'arcade';
    const C = window.CONFIG;
    for (const k of Object.keys(C)) delete C[k];
    merge(C, BASE);
    if (id === 'arcade' && window.ARCADE && window.ARCADE.set) merge(C, window.ARCADE.set);
    AB.difficulty = id;
    return id;
  };
})(window.AB);
