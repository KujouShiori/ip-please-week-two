#!/usr/bin/env python3
"""演示录像的本地接收端：页面把抓帧和流水账 POST 到这里落盘。

    python tools/demo/sink.py            # 监听 127.0.0.1:8124，输出进 tools/demo/out/

页面（http://127.0.0.1:8000）→ 本服务（:8124）是跨源的，所以响应一律带 CORS 头。
只监听回环地址，不对外。
"""
import base64
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
LOCK = threading.Lock()
COUNT = {}


def safe(name):
    """只留目录名/文件名里能出现的字符，路径穿越一律吃掉。"""
    name = re.sub(r'[^A-Za-z0-9._-]', '_', name)
    return name.lstrip('.') or 'x'


class Sink(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        parts = [p for p in self.path.strip('/').split('/')]
        try:
            if parts and parts[0] == 'frame':
                self.write_frame(body)
            elif len(parts) == 2 and parts[0] == 'file':
                path = os.path.join(OUT, safe(parts[1]))
                with open(path, 'wb') as f:
                    f.write(body)
                print(f'file {path} ({len(body)} bytes)', flush=True)
            else:
                self.send_error(404, 'unknown sink path')
                return
        except Exception as e:
            self.send_error(500, str(e))
            return
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')

    def write_frame(self, body):
        tag, shot, day, data = body.split(b'\n', 3)
        tag, shot = safe(tag.decode()), int(shot)
        d = os.path.join(OUT, 'frames', tag)
        os.makedirs(d, exist_ok=True)
        raw = base64.b64decode(data.split(b',', 1)[1])
        with open(os.path.join(d, f'{shot:06d}.png'), 'wb') as f:
            f.write(raw)
        with LOCK:
            COUNT[tag] = max(COUNT.get(tag, -1), shot)
            n = COUNT[tag]
        if n % 200 == 0:
            print(f'frame {tag} #{n} (day {day.decode()})', flush=True)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print(f'sink on 127.0.0.1:{port}, out={OUT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Sink).serve_forever()
