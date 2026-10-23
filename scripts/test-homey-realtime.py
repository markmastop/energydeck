"""Check the actual C++ Homey protocol and WebSocket transport with a local peer."""
import base64
import hashlib
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root = Path(__file__).resolve().parents[1]
build = root / 'esphome/.esphome/build/energydeck-simulator'
class Handler(BaseHTTPRequestHandler):
    errors = []
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def frame(self, text, opcode=1, fin=True):
        payload = text.encode() if isinstance(text, str) else text
        self.wfile.write(bytes([(128 if fin else 0) | opcode, len(payload)]) + payload)
        self.wfile.flush()
    def packet(self):
        def exact(size):
            result = b''
            while len(result) < size:
                chunk = self.rfile.read(size - len(result))
                assert chunk
                result += chunk
            return result
        first, second = exact(2)
        assert first == 129 and second & 128
        length = second & 127
        if length == 126: length = struct.unpack('!H', exact(2))[0]
        assert length <= 32768
        mask, payload = exact(4), exact(length)
        return bytes(value ^ mask[i % 4] for i, value in enumerate(payload)).decode()
    def do_GET(self):
        try:
            self.connection.settimeout(5)
            assert self.path == '/socket.io/?EIO=3&transport=websocket'
            accept = base64.b64encode(hashlib.sha1((self.headers['Sec-WebSocket-Key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101); self.send_header('Upgrade', 'websocket'); self.send_header('Connection', 'Upgrade'); self.send_header('Sec-WebSocket-Accept', accept); self.end_headers()
            self.frame('0{"pingInterval":25000,"pingTimeout":20000}')
            self.frame('40')
            assert self.packet() == '420["handshakeClient",{"token":"synthetic-test-token","homeyId":"test-homey-id"}]'
            self.frame('430[null,{"namespace":"/api"}]')
            assert self.packet() == '40/api,'
            self.frame('40/api,')
            assert self.packet() == '42/api,1["subscribe","homey:device:meter"]'
            # Fragmented text and an interleaved WebSocket ping exercise the real I/O.
            self.frame('43/api,1[', fin=False); self.frame('ping', opcode=9)
            self.frame('null]', opcode=0)
            # Client answers ping with a masked pong, not a Socket.IO command.
            first, second = self.rfile.read(2); assert first == 138 and second == 132
            mask, payload = self.rfile.read(4), self.rfile.read(4)
            assert bytes(value ^ mask[i % 4] for i, value in enumerate(payload)) == b'ping'
            assert self.packet() == '42/api,2["subscribe","homey:manager:logic"]'
            self.frame('43/api,2[]')
            self.frame('42/api,["homey:device:meter","capability",{"value":0}]')
            self.frame('42/api,["homey:manager:logic","variable.update",{"id":"other"}]')
            self.frame('42/api,["homey:manager:logic","variable.update",{"id":"prices"}]')
            self.frame(b'', opcode=8)
        except Exception as error:
            Handler.errors.append(repr(error))
        finally:
            self.close_connection = True

with tempfile.TemporaryDirectory(prefix='energydeck-realtime-') as temp:
    binary = Path(temp) / 'test'
    subprocess.run(['c++', '-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
        '-DUSE_HOST', '-isystem' + str(build / 'src'), '-isystem' + str(build / '.piolibdeps/energydeck-simulator/ArduinoJson/src'),
        '-I/opt/homebrew/opt/openssl/include', str(root / 'scripts/test-homey-realtime.cpp'),
        str(root / 'esphome/components/homey_realtime/websocket.cpp'), '-L/opt/homebrew/opt/openssl/lib', '-lssl', '-lcrypto', '-o', str(binary)], check=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        subprocess.run([str(binary), '--fixture', f'http://127.0.0.1:{server.server_port}'], check=True, timeout=15)
        assert not Handler.errors, Handler.errors
        if '--live' in __import__('sys').argv:
            # This mode is explicitly requested and read-only. Never print the
            # address, token, response bodies or identifiers from the local .env.
            import urllib.request
            env = dict(os.environ)
            for line in (root / '.env').read_text().splitlines():
                if '=' not in line or line.lstrip().startswith('#'): continue
                key, value = line.split('=', 1)
                if key.startswith('HOMEY_'): env[key] = value.strip().strip('"').strip("'")
            try:
                with urllib.request.urlopen(env['HOMEY_ADDRESS'].rstrip('/') + '/api/manager/system/ping', timeout=6) as response:
                    env['ENERGYDECK_TEST_HOMEY_ID'] = response.headers.get('X-Homey-ID', '')
            except Exception:
                raise SystemExit('Homey could not be reached for the read-only live check') from None
            subprocess.run([str(binary), '--live'], env=env, check=True, timeout=20)
    finally:
        server.shutdown(); server.server_close()
