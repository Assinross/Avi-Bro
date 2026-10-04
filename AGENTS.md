# AGENTS.md — Avi-Bro: 99 ночей в лесу

Браузерная 2D survival-игра, статика без сборки. Вся графика рисуется кодом, внешних ассетов нет.

## Run / verify

- No build, no npm, no tests, no lint, no CI. Do not add tooling.
- Solo quick check: `python3 -m http.server 8067` in repo root, open `http://localhost:8067`.
- Coop check: `python3 server.py [port]` (default 8067, stdlib only). Open the printed LAN URL on both machines. Custom port: `python3 server.py 9000`. `start-server.sh` / `start-server.bat` are player-facing one-click launchers (download latest release to `~/avi-bro-server` + run server) — don't break their contracts with `server.py` CLI flags (`--update` etc.) when editing `server.py`.
- Single-machine coop debug: append `?local=1`, open in two tabs (BroadcastChannel, no server needed — see `js/net.js:5`).
- After any change: hard-reload in browser (`Ctrl+Shift+R`). No hot reload, no cache-busting.
- Verify with `python3 -c "import ast; ast.parse(open('server.py').read())"` for `server.py`, `node --check <file>` for JS if node exists; otherwise rely on browser console.

## Architecture

- `index.html` — page, menus, overlays; loads scripts in fixed order: `config.js → arcade.js → utils → world → skills → sim → sprites → mushrooms → towns → buildings → fx → render → net → save → main`. Order matters; keep it.
- `config.js` — ALL tuning via `window.CONFIG` (world, monsters, abilities, skills, buildings, economy, net). Prefer changing values here over touching logic. Values in `config.js` are the HARDCORE difficulty.
- `arcade.js` — arcade difficulty (default mode): `window.ARCADE.set` overrides only listed `config.js` keys (partial nested overrides OK, arrays replaced wholesale). Tune arcade balance here, hardcore balance in `config.js`; never touch logic for difficulty changes.
- `js/sim.js` (~2850 lines) — game logic: players, combat, buildings, monsters, bosses, day/night, net sync. `js/main.js` — menu, input, game loop. `js/render.js` (~3300 lines) — canvas, fog, lighting, HUD, minimap. `js/mushrooms.js`, `js/towns.js` — decorative sprites/effects (mushroom glade, settlements of the four compass directions), cached at 2× resolution.
- Modules share global namespace `window.AB` (IIFE pattern `(function (AB) {...})(window.AB)`); `window.CONFIG` is the global config. No imports/exports.
- `js/save.js` - saves (`AB.Save`): world = seed + diffs, monsters are not saved. Storage: `saves/` via `server.py` `/saves` API, else `localStorage`. One save per party key (`solo-<uid>`, `pair-<hostUid>-<guestUid>`); uid in `localStorage['avibro-uid']`.
- `server.py` — static file server + WebSocket relay on `/ws` + `/info` endpoint (used by `Net.detect()` to choose local vs PeerJS transport). Path traversal guarded; keep it.

## Net modes (`js/net.js`, `CONFIG.NET_MODE`)

`auto` (default): local `server.py` if page served from it, else PeerJS cloud on GitHub Pages. `?local=1` forces BroadcastChannel. `file://` URLs always fall back to PeerJS/local mode.

## Conventions

- Code comments and UI strings are Russian; keep new user-facing text and comments in Russian.
- Balance numbers live in `config.js` (hardcore) or `arcade.js` (arcade) with inline docs — update the comment if you change a value's meaning.
- `README.md` is player-facing documentation (publishing, coop setup, in-game update button, troubleshooting, performance) — keep it in sync when changing user-visible behavior. `docs/superpowers/` holds process artifacts (plans/specs).
- Deploy = push to `main` (GitHub Pages serves repo root, `.nojekyll` must stay).
