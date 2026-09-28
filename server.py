#!/usr/bin/env python3
"""
Avi-Bro — локальный сервер для игры вдвоём в одной сети Wi-Fi (без интернета).

Запуск на ПК первого игрока (в папке с игрой):
    python3 server.py            # порт 8080
    python3 server.py 9000       # другой порт

Сервер покажет адрес вида http://192.168.1.5:8080 — откройте его на обоих компьютерах.
Он отдаёт файлы игры и пересылает игровые сообщения между игроками (WebSocket /ws).
Нужен только Python 3, дополнительные библиотеки не требуются.
"""
import asyncio, os, sys, hashlib, base64, json, mimetypes, socket, struct

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
rooms = {}  # код комнаты -> {'host': WS, 'guest': WS | None}


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
                msg = json.loads(text)
                t, code = msg.get('t'), str(msg.get('code', ''))
                if t == '_host':
                    r = rooms.get(code)
                    if r and r['host'] and not r['host'].closed:
                        await ws.send('{"t":"_taken"}')
                        continue
                    rooms[code] = {'host': ws, 'guest': None}
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
        head = await reader.readuntil(b'\r\n\r\n')
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

    if path == '/info':
        body = json.dumps({'server': 'avibro', 'ips': lan_ips(), 'port': PORT}).encode()
        ctype = 'application/json'
        status = '200 OK'
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


async def main():
    mimetypes.add_type('application/javascript', '.js')
    server = await asyncio.start_server(handle, '0.0.0.0', PORT)
    print('\n=== Avi-Bro: локальный сервер запущен ===')
    ips = lan_ips()
    for ip in ips:
        print(f'  Откройте на ОБОИХ компьютерах:  http://{ip}:{PORT}')
    if not ips:
        print(f'  Адрес: http://<IP этого компьютера>:{PORT}')
    print('  (на этом компьютере можно и http://localhost:%d)' % PORT)
    print('  Если второй компьютер не открывает страницу — разрешите порт в брандмауэре:')
    print(f'    Linux:   sudo ufw allow {PORT}')
    print('    Windows: разрешите Python в «Брандмауэр Защитника Windows»')
    print('  Остановить сервер: Ctrl+C\n')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nСервер остановлен')
