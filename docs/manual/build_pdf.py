"""manual.html を PDF(docs/manual.pdf)にする。画面写真を撮り直すときは先に screenshots.py を実行"""
import asyncio
from pathlib import Path

from cdp import Browser

HERE = Path(__file__).parent
OUT = HERE.parent / "manual.pdf"


async def main():
    async with Browser(width=900, height=1200, scale=1) as b:
        await b.goto((HERE / "manual.html").resolve().as_uri(), 2.0)
        await b.pdf(OUT)


asyncio.run(main())
