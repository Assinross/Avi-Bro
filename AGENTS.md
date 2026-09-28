# AGENTS.md — Avi-Bro: 99 ночей в лесу

Браузерная 2D survival-игра, статика без сборки. Вся графика рисуется кодом, внешних ассетов нет.

## Run / verify

- No build, no npm, no tests, no lint, no CI. Do not add tooling.
- Solo quick check: `python3 -m http.server 8080` in repo root, open `http://localhost:8080`.
- Coop check: `python3 server.py [port]` (default 8080, stdlib only). Open the printed LAN URL on both machines. Custom port: `python3 server.py 9000`.
- Single-machine coop debug: append `?local=1`, open in two tabs (BroadcastChannel, no server needed — see `js/net.js:5`).
- After any change: hard-reload in browser (`Ctrl+Shift+R`). No hot reload, no cache-busting.
- Verify with `python3 -c "import ast; ast.parse(open('server.py').read())"` for `server.py`, `node --check <file>` for JS if node exists; otherwise rely on browser console.

## Architecture

- `index.html` — page, menus, overlays; loads scripts in fixed order: `config.js → utils → world → skills → sim → sprites → buildings → fx → render → net → main`. Order matters; keep it.
- `config.js` — ALL tuning via `window.CONFIG` (world, monsters, abilities, skills, buildings, economy, net). Prefer changing values here over touching logic.
- `js/sim.js` (~2450 lines) — game logic: players, combat, buildings, monsters, bosses, day/night, net sync. `js/main.js` — menu, input, game loop. `js/render.js` — canvas, fog, lighting, HUD, minimap.
- Modules share global namespace `window.AB` (IIFE pattern `(function (AB) {...})(window.AB)`); `window.CONFIG` is the global config. No imports/exports.
- `server.py` — static file server + WebSocket relay on `/ws` + `/info` endpoint (used by `Net.detect()` to choose local vs PeerJS transport). Path traversal guarded; keep it.

## Net modes (`js/net.js`, `CONFIG.NET_MODE`)

`auto` (default): local `server.py` if page served from it, else PeerJS cloud on GitHub Pages. `?local=1` forces BroadcastChannel. `file://` URLs always fall back to PeerJS/local mode.

## Conventions

- Code comments and UI strings are Russian; keep new user-facing text and comments in Russian.
- Balance numbers live in `config.js` with inline docs — update the comment if you change a value's meaning.
- Deploy = push to `main` (GitHub Pages serves repo root, `.nojekyll` must stay).
