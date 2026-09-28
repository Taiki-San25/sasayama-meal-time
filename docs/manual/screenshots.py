"""操作説明書用の画面写真を撮る(seed_demo.py でデモデータを入れたローカル環境 http://localhost:8010 が対象)"""
import asyncio
import datetime
import sys
from pathlib import Path

from cdp import Browser

BASE = "http://localhost:8010"
HERE = Path(__file__).parent
IMG = HERE / "img"
IMG.mkdir(exist_ok=True)
D = datetime.date.today().isoformat()
D1 = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
CSV_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")

LOGIN = """await fetch('/logout'); const r = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({username: '%s', password: '%s'})}); return r.status;"""
TAP = """const g = document.querySelector('[data-table="%s"]'); const b = g.querySelector('rect').getBoundingClientRect();
  const o = {bubbles: true, clientX: b.x + 6, clientY: b.y + 6, button: 0, pointerId: 1};
  g.dispatchEvent(new PointerEvent('pointerdown', o)); window.dispatchEvent(new PointerEvent('pointerup', o));"""


async def main():
    async with Browser() as b:
        await b.goto(f"{BASE}/login")
        await b.shot(IMG / "01_login.png")

        # 夕食時間管理表(レストラン)
        await b.js(LOGIN % ("sato", "demo"))
        await b.goto(f"{BASE}/dinner?d={D}", 1.5)
        await b.shot(IMG / "10_dinner.png")
        # 人数の直接入力
        await b.js("""const td = [...document.querySelectorAll('.ledgerTable tbody tr')].find(t => t.innerText.includes('ｲﾄｳ'))
          .querySelector('td.cnt[data-cnt=adults]'); td.click();""")
        await b.shot(IMG / "11_inline.png")
        await b.js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));")
        # 編集画面
        await b.js("""[...document.querySelectorAll('.ledgerTable tbody tr')].find(t => t.innerText.includes('ｽｽﾞｷ'))
          .querySelector('td.guest').click();""", 0.6)
        await b.shot(IMG / "12_edit.png")
        await b.js("document.querySelector('.modalWrap').close();")
        # 時間枠
        await b.js("document.querySelector('[data-act=slots]').click();", 0.6)
        await b.shot(IMG / "13_slots.png")
        await b.js("document.querySelector('.modalWrap').close();")
        # 時間枠カードで絞り込み(19:30・全員入場)
        await b.goto(f"{BASE}/dinner?d={D}&t=19:30", 1.5)
        await b.shot(IMG / "14_slot_filter.png")
        # グループ検索
        await b.goto(f"{BASE}/dinner?d={D}", 1.5)
        await b.js("const s = document.getElementById('ldSearch'); s.value = 'G1'; s.dispatchEvent(new Event('input', {bubbles: true}));", 0.5)
        await b.shot(IMG / "16_search_group.png")
        # 朝食(一部入場)
        await b.goto(f"{BASE}/breakfast?d={D1}", 1.5)
        await b.shot(IMG / "15_breakfast.png")

        # CSVアップロード(フロント)
        await b.js(LOGIN % ("suzuki", "demo"))
        await b.goto(f"{BASE}/dinner?d={D}", 1.5)
        await b.js("document.querySelector('a[href=\"#import\"]').click();", 0.5)
        await b.set_files(".impDrop input[type=file]", [CSV_DIR / "demo_予約ファイル①.CSV", CSV_DIR / "demo_予約ファイル②.CSV"])
        await asyncio.sleep(1.5)
        await b.shot(IMG / "20_upload.png")
        await b.js("document.querySelector('.modalWrap').close();")

        # テーブルアサイン(レストラン)
        await b.js(LOGIN % ("sato", "demo"))
        await b.goto(f"{BASE}/tables?d={D}&t=17:30", 1.5)
        await b.shot(IMG / "30_tables.png")
        await b.js(TAP % "t8", 0.6)
        await b.shot(IMG / "31_table_modal.png")
        await b.js("document.querySelector('.modalWrap').close();")
        await b.js("document.getElementById('flEditBtn').click();", 0.8)
        await b.js(TAP % "t9")
        await b.js(TAP % "t10", 0.5)
        await b.shot(IMG / "32_layout_edit.png")
        await b.js("state = null;")

        # 集計・チャット・操作ログ
        await b.goto(f"{BASE}/dinner-summary", 1.5)
        await b.shot(IMG / "40_summary.png")
        await b.goto(f"{BASE}/chat", 1.5)
        await b.shot(IMG / "50_chat.png")
        await b.goto(f"{BASE}/logs", 1.5)
        await b.shot(IMG / "60_logs.png")

        # 管理者ページ
        await b.js(LOGIN % ("admin", "admin"))
        await b.goto(f"{BASE}/admin", 1.5)
        await b.shot(IMG / "70_admin.png")


asyncio.run(main())
