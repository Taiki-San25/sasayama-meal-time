"""manual.html を PDF(docs/manual.pdf)にする。画面写真を撮り直すときは先に screenshots.py を実行

PDF を軽くするため(Render の通信量対策)、画面写真は幅 1200px の JPEG に縮めてから埋め込む。
file:// のままだと画像を加工できないので、リポジトリを一時的なローカルの HTTP サーバーで配信して開く。
"""
import asyncio
import functools
import http.server
import threading
from pathlib import Path

from cdp import Browser

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
OUT = HERE.parent / "manual.pdf"
PORT = 8765
IMG_WIDTH, JPEG_QUALITY = 1200, 0.75

SHRINK = """
await Promise.all([...document.querySelectorAll('figure img')].map(async img => {
  await img.decode();
  const s = Math.min(1, %d / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
  img.src = c.toDataURL('image/jpeg', %s);
  await img.decode();
}));
return document.querySelectorAll('figure img[src^="data:image/jpeg"]').length;"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with Browser(width=900, height=1200, scale=1) as b:
            await b.goto(f"http://127.0.0.1:{PORT}/docs/manual/manual.html", 2.0)
            n = await b.js(SHRINK % (IMG_WIDTH, JPEG_QUALITY), 0.5)
            total = await b.js("return document.querySelectorAll('figure img').length", 0)
            if n != total:
                raise RuntimeError(f"画面写真の縮小に失敗しました({n}/{total}枚)")
            await b.pdf(OUT)
    finally:
        server.shutdown()


asyncio.run(main())
