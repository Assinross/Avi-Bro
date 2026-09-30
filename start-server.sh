#!/usr/bin/env bash
# Avi-Bro: скачать последнюю версию игры и запустить сервер для игры вдвоём.
# Первый запуск: bash start-server.sh — дальше запускайте «Avi-Bro сервер» из меню приложений.
# Постоянная ссылка для обоих компьютеров: http://<имя-этого-компьютера>.local:8067
set -e
DIR="$HOME/avi-bro-server"
PORT="${AVIBRO_PORT:-8067}"
ZIP="${AVIBRO_ZIP:-https://github.com/Assinross/Avi-Bro/archive/refs/heads/main.zip}"
mkdir -p "$DIR"
# уже запущен? второй сервер не нужен — просто открываем игру
if python3 -c "import urllib.request,sys; sys.exit(0 if b'avibro' in urllib.request.urlopen('http://127.0.0.1:$PORT/info', timeout=2).read() else 1)" 2>/dev/null; then
  echo "Сервер Avi-Bro уже запущен — открываю игру."
  xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
  exit 0
fi
echo "=== Avi-Bro: проверяю обновление игры… ==="
if [ -f "$DIR/server.py" ]; then
  AVIBRO_ZIP="$ZIP" python3 "$DIR/server.py" --update || true
else
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
    new = z.read(info)
    try:
        if open(p, 'rb').read() == new:
            continue
    except OSError:
        pass
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as b:
        b.write(new)
    n += 1
print(f"  изменено файлов: {n}" if n else "  уже последняя версия")
PY
fi
chmod +x "$DIR/start-server.sh" 2>/dev/null || true
# значок в меню приложений (один раз); со стола убираем, если остался от старой версии
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
  echo "  В меню приложений появился значок «Avi-Bro сервер» — дальше запускайте им."
fi
for D in "$(xdg-user-dir DESKTOP 2>/dev/null)" "$HOME/Desktop" "$HOME/Рабочий стол"; do
  [ -n "$D" ] && rm -f "$D/avi-bro-server.desktop" 2>/dev/null || true
done
# открыть порт в брандмауэре, если он включён (спросит пароль один раз)
if command -v ufw >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo ufw allow $PORT >/dev/null 2>&1 || true; fi
cd "$DIR"
( sleep 2; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &
exec python3 server.py $PORT
