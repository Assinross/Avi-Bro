#!/usr/bin/env python3
"""
Avi-Bro — локальный сервер для игры вдвоём в одной сети Wi-Fi (без интернета).

Проще всего запускать через start-server.sh (Linux) или start-server.bat (Windows):
они сами скачивают последнюю версию игры с GitHub и запускают этот сервер.

Вручную (в папке с игрой):
    python3 server.py            # порт 8080
    python3 server.py 9000       # другой порт

Постоянная ссылка для обоих компьютеров: http://<имя-компьютера>.local:8080 (или http://IP:8080).
Сервер отдаёт файлы игры, показывает список комнат (/rooms), пересылает игровые сообщения (WebSocket /ws)
и умеет обновлять игру до последней версии с GitHub (/update). Нужен только Python 3.
"""
import asyncio, os, sys, hashlib, base64, json, mimetypes, re, socket, struct, io, shutil, threading, time, zipfile, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(ARGS[0]) if ARGS else 8080
MAX_ROOMS = 30          # защита от мусора: не больше комнат
MAX_MSG = 16 * 1024 * 1024  # и не больше 16 МБ в одном сообщении
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
rooms = {}  # код комнаты -> {'host': WS, 'guest': WS | None, 'name': имя хоста, 'prof': профессия}
REPO_ZIP = os.environ.get('AVIBRO_ZIP', 'https://github.com/Assinross/Avi-Bro/archive/refs/heads/main.zip')


def host_links():
    """Постоянная ссылка (имя компьютера в сети .local) и запасные по IP."""
    name = socket.gethostname().split('.')[0]
    links = [f'http://{name}.local:{PORT}']
    links += [f'http://{ip}:{PORT}' for ip in lan_ips()]
    return name, links


MANIFEST = os.path.join(ROOT, '.avibro-files.json')  # какие файлы положило обновление — чтобы убирать устаревшие
SAVES = os.path.join(ROOT, 'saves')  # сохранения игр; обновление с GitHub эту папку не трогает
SAVE_KEY = re.compile(r'^(solo|pair)-[a-z0-9-]{1,64}$')
SAVE_MAX = 5 * 1024 * 1024  # больше не бывает: мир хранится как зерно + изменения


def saves_list():
    """Витрины всех сохранений (без данных мира). Битый файл - {key, bad: True}, чтобы его можно было удалить."""
    out = []
    try:
        names = os.listdir(SAVES)
    except OSError:
        return out
    for fn in names:
        key = fn[:-5]
        if not fn.endswith('.json') or not SAVE_KEY.match(key):
            continue
        try:
            with open(os.path.join(SAVES, fn), encoding='utf-8') as f:
                d = json.load(f)
            out.append({k: d.get(k) for k in ('key', 'at', 'v', 'diff', 'meta')})
        except (OSError, ValueError):
            out.append({'key': key, 'bad': True})
    return out


def save_write(key, data):
    """Записать сохранение целиком: файл никогда не бывает "наполовину записан"."""
    os.makedirs(SAVES, exist_ok=True)
    dst = os.path.join(SAVES, key + '.json')
    tmp = dst + '.part'
    with open(tmp, 'wb') as out:
        out.write(data)
    os.replace(tmp, dst)


def update_from_github():
    """Скачать последнюю версию игры с GitHub. Пишет только изменившиеся файлы,
    удаляет файлы, которых больше нет в игре, и не оставляет временных файлов.
    Возвращает число изменённых/удалённых файлов (0 — уже последняя версия)."""
    data = urllib.request.urlopen(REPO_ZIP, timeout=60).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    top = z.namelist()[0].split('/')[0]
    n, files = 0, []
    for info in z.infolist():
        rel = info.filename[len(top) + 1:]
        if not rel or info.is_dir() or rel.startswith('.git') or '..' in rel.split('/'):
            continue
        files.append(rel)
        dst = os.path.join(ROOT, rel)
        new = z.read(info)
        try:
            with open(dst, 'rb') as f:
                if f.read() == new:
                    continue  # файл не изменился — не трогаем
        except OSError:
            pass
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + '.part'
        with open(tmp, 'wb') as out:
            out.write(new)
        os.replace(tmp, dst)  # подмена целиком: файл никогда не бывает «наполовину записан»
        n += 1
    # мусор: файлы прошлой версии, которых в новой нет
    try:
        with open(MANIFEST, encoding='utf-8') as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = []
    keep = set(files)
    for rel in old:
        if rel in keep or '..' in rel.split('/'):
            continue
        p = os.path.join(ROOT, rel)
        if os.path.isfile(p):
            os.remove(p)
            n += 1
            d = os.path.dirname(p)
            while d != ROOT and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(sorted(files), f)
    # недокачанные остатки прошлых обновлений
    for dp, _, fns in os.walk(ROOT):
        for fn in fns:
            if fn.endswith('.part'):
                try:
                    os.remove(os.path.join(dp, fn))
                except OSError:
                    pass
    return n


def restart_soon():
    """Перезапустить сервер (новая версия server.py подхватится сама)."""
    def go():
        time.sleep(1.2)
        args = [a for a in sys.argv if a != '--restarted']
        os.execv(sys.executable, [sys.executable] + args + ['--restarted'])
    threading.Thread(target=go, daemon=True).start()


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


class WS:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.closed = False
        self.room = None
        self.role = None

    async def send(self, text):
        if self.closed:
            return
        data = text.encode('utf-8')
        n = len(data)
        if n < 126:
            hdr = bytes([0x81, n])
        elif n < 65536:
            hdr = bytes([0x81, 126]) + struct.pack('>H', n)
        else:
            hdr = bytes([0x81, 127]) + struct.pack('>Q', n)
        try:
            self.w.write(hdr + data)
            await self.w.drain()
        except Exception:
            self.closed = True

    async def recv(self):
        buf = b''
        while True:
            h = await self.r.readexactly(2)
            fin, op = h[0] & 0x80, h[0] & 0x0F
            masked, n = h[1] & 0x80, h[1] & 0x7F
            if n == 126:
                n = struct.unpack('>H', await self.r.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', await self.r.readexactly(8))[0]
            if n > MAX_MSG or len(buf) + n > MAX_MSG:
                raise ConnectionError('слишком большое сообщение')
            mask = await self.r.readexactly(4) if masked else None
            payload = await self.r.readexactly(n)
            if mask and n:
                m = (mask * (n // 4 + 1))[:n]
                payload = (int.from_bytes(payload, 'big') ^ int.from_bytes(m, 'big')).to_bytes(n, 'big')
            if op == 8:
                return None
            if op == 9:  # ping -> pong
                try:
                    self.w.write(bytes([0x8A, len(payload)]) + payload)
                except Exception:
                    pass
                continue
            if op == 10:
                continue
            buf += payload
            if fin:
                return buf.decode('utf-8', 'replace')


async def ws_session(ws):
    try:
        while True:
            text = await ws.recv()
            if text is None:
                break
            if text.startswith('{"t":"_'):
                try:
                    msg = json.loads(text)
                except ValueError:
                    continue
                t, code = msg.get('t'), str(msg.get('code', ''))[:12]
                if t == '_host':
                    r = rooms.get(code)
                    if r and r['host'] and not r['host'].closed:
                        await ws.send('{"t":"_taken"}')
                        continue
                    for c in [c for c, v in rooms.items() if not v['host'] or v['host'].closed]:
                        rooms.pop(c, None)  # брошенные комнаты
                    if len(rooms) >= MAX_ROOMS:
                        await ws.send('{"t":"_taken"}')
                        continue
                    rooms[code] = {'host': ws, 'guest': None, 'name': str(msg.get('name', 'Игрок'))[:16], 'prof': str(msg.get('prof', ''))[:16], 't': time.time()}
                    ws.room, ws.role = code, 'host'
                    await ws.send('{"t":"_ok"}')
                    print(f'  комната {code} создана')
                elif t == '_join':
                    r = rooms.get(code)
                    if not r or not r['host'] or r['host'].closed:
                        await ws.send('{"t":"_nf"}')
                        continue
                    if r['guest'] and not r['guest'].closed:
                        await ws.send('{"t":"_full"}')
                        continue
                    r['guest'] = ws
                    ws.room, ws.role = code, 'guest'
                    await ws.send('{"t":"_joined"}')
                    await r['host'].send('{"t":"_open"}')
                    print(f'  игрок подключился к комнате {code}')
                continue
            # пересылка игрового сообщения второй стороне
            r = rooms.get(ws.room)
            if not r:
                continue
            other = r['guest'] if ws.role == 'host' else r['host']
            if other:
                await other.send(text)
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        ws.closed = True
        r = rooms.get(ws.room)
        if r:
            if ws.role == 'host' and r['host'] is ws:
                if r['guest']:
                    await r['guest'].send('{"t":"_hostgone"}')
                rooms.pop(ws.room, None)
                print(f'  комната {ws.room} закрыта')
            elif ws.role == 'guest' and r['guest'] is ws:
                r['guest'] = None
                if r['host']:
                    await r['host'].send('{"t":"_close"}')
                print(f'  игрок вышел из комнаты {ws.room}')
        try:
            ws.w.close()
        except Exception:
            pass


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 15)  # зависшие/мусорные подключения не держим
    except Exception:
        writer.close()
        return
    lines = head.decode('latin-1').split('\r\n')
    try:
        method, path, _ = lines[0].split(' ', 2)
    except ValueError:
        writer.close()
        return
    headers = {}
    for ln in lines[1:]:
        if ':' in ln:
            k, v = ln.split(':', 1)
            headers[k.strip().lower()] = v.strip()
    path = path.split('?', 1)[0]

    if path == '/ws' and headers.get('upgrade', '').lower() == 'websocket':
        key = headers.get('sec-websocket-key', '')
        acc = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      f'Sec-WebSocket-Accept: {acc}\r\n\r\n').encode())
        await writer.drain()
        await ws_session(WS(reader, writer))
        return

    if path == '/stop':
        body = json.dumps({'ok': True}).encode()
        writer.write((f'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n'
                      'Connection: close\r\n\r\n').encode() + body)
        try:
            await writer.drain()
        except Exception:
            pass
        writer.close()
        print('\nСервер остановлен кнопкой в игре. Это окно можно закрыть.')
        asyncio.get_event_loop().call_later(0.3, lambda: os._exit(0))
        return

    if path == '/info':
        name, links = host_links()
        body = json.dumps({'server': 'avibro', 'ips': lan_ips(), 'port': PORT, 'host': name, 'links': links}).encode()
        ctype = 'application/json'
        status = '200 OK'
    elif path == '/rooms':
        # список комнат: второй игрок просто выбирает комнату, коды не нужны
        lst = [{'code': c, 'name': r.get('name', 'Игрок'), 'prof': r.get('prof', ''), 'full': bool(r['guest'] and not r['guest'].closed)}
               for c, r in rooms.items() if r['host'] and not r['host'].closed]
        body = json.dumps(lst, ensure_ascii=False).encode()
        ctype, status = 'application/json', '200 OK'
    elif path == '/update':
        try:
            n = await asyncio.get_event_loop().run_in_executor(None, update_from_github)
            body = json.dumps({'ok': True, 'files': n}).encode()
            if n:
                print(f'  игра обновлена с GitHub (изменено файлов: {n}), перезапуск…')
                restart_soon()
            else:
                print('  обновлений нет — уже последняя версия')
        except Exception as e:
            body = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode()
        ctype, status = 'application/json', '200 OK'
    elif path == '/saves' or path.startswith('/saves/'):
        key = path[len('/saves/'):]
        ctype, status, body = 'application/json', '200 OK', b'{"ok":true}'
        try:
            if path == '/saves':
                body = json.dumps(saves_list(), ensure_ascii=False).encode()
            elif not SAVE_KEY.match(key):
                status, body = '400 Bad Request', b'{"ok":false,"error":"bad key"}'
            elif method == 'GET':
                try:
                    with open(os.path.join(SAVES, key + '.json'), 'rb') as f:
                        body = f.read()
                except OSError:
                    status, body = '404 Not Found', b'null'
            elif method == 'POST':
                n = int(headers.get('content-length') or 0)
                if n <= 0 or n > SAVE_MAX:
                    status, body = '413 Payload Too Large', b'{"ok":false,"error":"size"}'
                else:
                    data = await asyncio.wait_for(reader.readexactly(n), 30)
                    json.loads(data)  # мусор не пишем
                    save_write(key, data)
            elif method == 'DELETE':
                try:
                    os.remove(os.path.join(SAVES, key + '.json'))
                except FileNotFoundError:
                    pass
            else:
                status, body = '405 Method Not Allowed', b'{"ok":false}'
        except Exception as e:
            status, body = '500 Internal Server Error', json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode()
    else:
        rel = path.lstrip('/') or 'index.html'
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            body, ctype, status = b'Not found', 'text/plain', '404 Not Found'
        else:
            with open(full, 'rb') as f:
                body = f.read()
            ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype in ('application/javascript',):
                ctype += '; charset=utf-8'
            status = '200 OK'
    writer.write((f'HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n'
                  'Cache-Control: no-cache\r\nConnection: close\r\n\r\n').encode() + (body if method != 'HEAD' else b''))
    try:
        await writer.drain()
    except Exception:
        pass
    writer.close()


def already_running():
    """На этом порту уже работает наш сервер?"""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/info', timeout=2) as r:
            return json.loads(r.read().decode()).get('server') == 'avibro'
    except Exception:
        return False


async def main():
    mimetypes.add_type('application/javascript', '.js')
    # второй экземпляр не запускаем. После обновления старый процесс может ещё держать порт — ждём его
    tries = 25 if '--restarted' in sys.argv else 1
    for k in range(tries):
        try:
            server = await asyncio.start_server(handle, '0.0.0.0', PORT)
            break
        except OSError:
            if k + 1 < tries:
                await asyncio.sleep(0.4)
                continue
            if already_running():
                print(f'\nСервер Avi-Bro уже запущен (http://localhost:{PORT}) — второй не нужен.')
                try:
                    import webbrowser
                    webbrowser.open(f'http://localhost:{PORT}')
                except Exception:
                    pass
                sys.exit(0)
            print(f'\nПорт {PORT} занят другой программой. Запустите с другим портом: python3 server.py 8090')
            sys.exit(1)
    print('\n=== Avi-Bro: локальный сервер запущен ===')
    name, links = host_links()
    print(f'  ПОСТОЯННАЯ ССЫЛКА для обоих компьютеров:  {links[0]}')
    for ln in links[1:]:
        print(f'  запасная (по IP, может меняться):        {ln}')
    print('  (на этом компьютере можно и http://localhost:%d)' % PORT)
    print('  Если второй компьютер не открывает страницу — разрешите порт в брандмауэре:')
    print(f'    Linux:   sudo ufw allow {PORT}')
    print('    Windows: разрешите Python в «Брандмауэр Защитника Windows»')
    print('  Остановить сервер: кнопка «Остановить сервер» в игре, Ctrl+C или просто закройте это окно\n')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    if '--update' in sys.argv:  # только обновить файлы (так делает start-server при запуске)
        try:
            k = update_from_github()
            print(f'  изменено файлов: {k}' if k else '  уже последняя версия')
        except Exception as e:
            print(f'  не удалось скачать обновление ({e}) — запускаю версию, что уже есть')
        sys.exit(0)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nСервер остановлен')
