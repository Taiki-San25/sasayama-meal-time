"""Edge(ヘッドレス)を DevTools プロトコルで操作する小さなヘルパー(画面写真・PDF作成用)"""
import asyncio
import base64
import itertools
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9333


class Browser:
    def __init__(self, width=1366, height=768, scale=1.5):
        self.width, self.height, self.scale = width, height, scale
        self.ids = itertools.count(1)
        self.pending = {}

    async def __aenter__(self):
        self.profile = tempfile.mkdtemp(prefix="edge-manual-")
        self.proc = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={PORT}",
                                      f"--user-data-dir={self.profile}", "--no-first-run", "--disable-gpu",
                                      "--hide-scrollbars", "about:blank"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                pages = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
                ws = next(p["webSocketDebuggerUrl"] for p in pages if p["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        self.ws = await websockets.connect(ws, max_size=None)
        self.reader = asyncio.create_task(self._read())
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.viewport(self.width, self.height)
        return self

    async def __aexit__(self, *exc):
        # terminate だけでは Edge が残り、次回の実行が古いブラウザにつながるので、先に Browser.close で閉じる
        try:
            await asyncio.wait_for(self.send("Browser.close"), 5)
        except Exception:
            pass
        self.reader.cancel()
        await self.ws.close()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    async def _read(self):
        async for msg in self.ws:
            m = json.loads(msg)
            if "id" in m and m["id"] in self.pending:
                self.pending.pop(m["id"]).set_result(m)

    async def send(self, method, **params):
        i = next(self.ids)
        fut = asyncio.get_running_loop().create_future()
        self.pending[i] = fut
        await self.ws.send(json.dumps({"id": i, "method": method, "params": params}))
        m = await asyncio.wait_for(fut, 60)
        if "error" in m:
            raise RuntimeError(f"{method}: {m['error']}")
        return m.get("result", {})

    async def viewport(self, w, h):
        await self.send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=self.scale, mobile=False)

    async def goto(self, url, wait=1.2):
        await self.send("Page.navigate", url=url)
        await asyncio.sleep(wait)

    async def js(self, expr, wait=0.3):
        r = await self.send("Runtime.evaluate", expression=f"(async () => {{ {expr} }})()", awaitPromise=True, returnByValue=True)
        await asyncio.sleep(wait)
        return r.get("result", {}).get("value")

    async def shot(self, path, full=False):
        params = {"format": "png"}
        if full:
            h = await self.js("return document.documentElement.scrollHeight", 0)
            params["clip"] = {"x": 0, "y": 0, "width": self.width, "height": h, "scale": 1}
            params["captureBeyondViewport"] = True
        r = await self.send("Page.captureScreenshot", **params)
        Path(path).write_bytes(base64.b64decode(r["data"]))
        print("saved", path)

    async def set_files(self, selector, files):
        doc = await self.send("DOM.getDocument", depth=-1, pierce=True)
        node = await self.send("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)
        await self.send("DOM.setFileInputFiles", nodeId=node["nodeId"], files=[str(Path(f).resolve()) for f in files])

    async def pdf(self, path):
        r = await self.send("Page.printToPDF", printBackground=True, preferCSSPageSize=True,
                            displayHeaderFooter=True, headerTemplate="<div></div>",
                            footerTemplate='<div style="font-size:8px;width:100%;text-align:center;color:#888">'
                                           '<span class="pageNumber"></span> / <span class="totalPages"></span></div>')
        Path(path).write_bytes(base64.b64decode(r["data"]))
        print("saved", path)
