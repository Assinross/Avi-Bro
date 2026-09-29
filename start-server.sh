#!/usr/bin/env bash
# Avi-Bro: скачать последнюю версию игры и запустить сервер для игры вдвоём.
# Первый запуск: bash start-server.sh — дальше на рабочем столе появится значок «Avi-Bro сервер».
# Постоянная ссылка для обоих компьютеров: http://<имя-этого-компьютера>.local:8080
set -e
DIR="$HOME/avi-bro-server"
PORT="${AVIBRO_PORT:-8080}"
ZIP="${AVIBRO_ZIP:-https://github.com/Assinross/Avi-Bro/archive/refs/heads/main.zip}"
mkdir -p "$DIR"
echo "=== Avi-Bro: скачиваю последнюю версию игры… ==="
python3 - "$DIR" "$ZIP" <<'PY' || echo "Не удалось скачать обновление — запускаю версию, что уже есть."
import io, os, sys, zipfile, urllib.request, shutil
dst, url = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=60).read()))
top = z.namelist()[0].split('/')[0]
n = 0
for info in z.infolist():
    rel = info.filename[len(top) + 1:]
    if not rel or info.is_dir() or rel.startswith('.git'):
        continue
    p = os.path.join(dst, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with z.open(info) as a, open(p, 'wb') as b:
        shutil.copyfileobj(a, b)
    n += 1
print(f"  обновлено файлов: {n}")
PY
chmod +x "$DIR/start-server.sh" 2>/dev/null || true
# значок на рабочем столе и в меню приложений (один раз)
APP="$HOME/.local/share/applications/avi-bro-server.desktop"
if [ ! -f "$APP" ] && [ -f "$DIR/start-server.sh" ]; then
  mkdir -p "$(dirname "$APP")"
  cat > "$APP" <<DESK
[Desktop Entry]
Type=Application
Name=Avi-Bro сервер
Comment=Обновить игру и запустить сервер для игры вдвоём
Exec=bash "$DIR/start-server.sh"
Icon=applications-games
Terminal=true
Categories=Game;
DESK
  chmod +x "$APP"
  for D in "$(xdg-user-dir DESKTOP 2>/dev/null)" "$HOME/Desktop" "$HOME/Рабочий стол"; do
    if [ -n "$D" ] && [ -d "$D" ]; then cp "$APP" "$D/"; chmod +x "$D/avi-bro-server.desktop"; gio set "$D/avi-bro-server.desktop" metadata::trusted true 2>/dev/null || true; break; fi
  done
  echo "  На рабочем столе появился значок «Avi-Bro сервер» — дальше запускайте им."
fi
# открыть порт в брандмауэре, если он включён (спросит пароль один раз)
if command -v ufw >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo ufw allow $PORT >/dev/null 2>&1 || true; fi
cd "$DIR"
( sleep 2; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &
exec python3 server.py $PORT
