"""操作説明書の画面写真用に、ローカルの空のDBへ架空のデモデータを入れる(本番では使わない)

使い方: local.db を退避して空の状態でサーバーを起動し(http://localhost:8010)、このスクリプトを実行する。
お客様名などはすべて架空。
"""
import base64
import datetime
import http.cookiejar
import json
import urllib.request

BASE = "http://localhost:8010"
TODAY = datetime.date.today()
D = TODAY.isoformat()


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers={"Content-Type": "application/json"})
    with op.open(req) as r:
        return json.loads(r.read())


adm = client()
call(adm, "POST", "/api/login", {"username": "admin", "password": "admin"})
for u, name, role in (("sato", "佐藤", "restaurant"), ("suzuki", "鈴木", "front")):
    call(adm, "POST", "/api/users", {"username": u, "display_name": name, "password": "demo", "role": role})
rest, front = client(), client()
call(rest, "POST", "/api/login", {"username": "sato", "password": "demo"})
call(front, "POST", "/api/login", {"username": "suzuki", "password": "demo"})

# ---- 架空の宿泊者リスト(①予約・②部屋割り)を取り込む ----
ymd = lambda d: d.strftime("%Y%m%d")
ci, co1, co2 = TODAY, TODAY + datetime.timedelta(days=1), TODAY + datetime.timedelta(days=2)
res = [  # 予約番号, 枝番, チェックイン, チェックアウト, 名前, 取消
    ("50101", "0", ci, co1, "ﾔﾏﾓﾄﾀﾛｳ_DNBF⑰", ""),
    ("50102", "0", ci, co2, "ｽｽﾞｷﾊﾅｺ_JTBDNBF⑲", ""),
    ("50103", "0", ci, co1, "ｻﾄｳｹﾝｼﾞ_DNBF⑰", ""),
    ("50104", "0", ci, co1, "ﾀﾅｶﾐｷ_RBF", ""),
    ("50105", "0", ci, co1, "ｲﾄｳｼｮｳﾀ_DNBF", ""),
    ("50106", "0", ci, co1, "ﾜﾀﾅﾍﾞﾕｲ_DNBF⑰", ""),
    ("50107", "0", ci, co1, "ﾃﾞﾓﾂｱｰ TC_DNBF⑲", ""),
    ("50107", "0", ci, co1, "ﾃﾞﾓﾂｱｰ 1/2_DNBF⑲2", ""),
    ("50107", "0", ci, co1, "ﾃﾞﾓﾂｱｰ 3/4_DNBF⑲3", ""),
    ("50108", "0", ci, co1, "ｺﾊﾞﾔｼｹｲ_DNBF⑰", "取消"),
]
rooms = [("50101", "0", "0205"), ("50102", "0", "0301"), ("50103", "0", "0207"), ("50104", "0", "0112"),
         ("50105", "0", "0302"), ("50106", "0", "0303"), ("50107", "0", "0210"), ("50107", "0", "0211"),
         ("50107", "0", "0212")]
def csv1(res):
    return "\r\n".join(",".join([n, b, "T", "2", ymd(i), ymd(o), str((o - i).days), "2", "", " ", name,
                                  "1" if c else "0", c, "現金"]) for n, b, i, o, name, c in res) + "\r\n"


def csv2(rooms):
    return "\r\n".join(",".join([n, b, "T", ymd(TODAY), "0", str(k), "0", "2", "913", "x", room, "x"])
                       for k, (n, b, room) in enumerate(rooms)) + "\r\n"


f1, f2 = csv1(res), csv2(rooms)
files = {"files": [{"name": "予約ファイル①.CSV", "data": base64.b64encode(f1.encode("cp932")).decode()},
                   {"name": "予約ファイル②.CSV", "data": base64.b64encode(f2.encode("cp932")).decode()}]}
call(front, "POST", "/api/import/commit", files)
# アップロード画面の写真用: 新しい予約2件と、取消になった予約1件(要確認に出る)を含むファイル
res_new = [x if x[0] != "50106" else (*x[:5], "取消") for x in res] + [
    ("50109", "0", ci, co1, "ｷﾑﾗｱｵｲ_DNBF⑰", ""), ("50110", "0", ci, co1, "ﾊﾔｼﾘｮｳ_JBF", "")]
rooms_new = rooms + [("50109", "0", "0305"), ("50110", "0", "0118")]
with open("demo_予約ファイル①.CSV", "wb") as f:
    f.write(csv1(res_new).encode("cp932"))
with open("demo_予約ファイル②.CSV", "wb") as f:
    f.write(csv2(rooms_new).encode("cp932"))

# ---- 人数・アレルギーなど(一部は人数未入力のまま) ----
rows = {r["resv_no"]: r for r in call(front, "GET", f"/api/dinner/reservations?d={D}")}
counts = {"50101": (2, 0, 0), "50102": (2, 1, 0), "50103": (3, 1, 1), "50106": (2, 0, 0), "50107": (10, 1, 0)}
for no, (a, c, i) in counts.items():
    call(front, "PATCH", f"/api/dinner/reservations/{rows[no]['id']}/counts", {"adults": a, "children": c, "infants": i})
r = rows["50102"]
call(front, "PUT", f"/api/dinner/reservations/{r['id']}", {"room": r["room"], "guest_name": r["guest_name"], "adults": 2,
     "children": 1, "infants": 0, "time_slot": r["time_slot"], "allergy": "えび・かに", "note": "記念日(結婚10周年)", "grouped": False})
r = rows["50103"]
call(front, "PUT", f"/api/dinner/reservations/{r['id']}", {"room": r["room"], "guest_name": r["guest_name"], "adults": 3,
     "children": 1, "infants": 1, "time_slot": r["time_slot"], "allergy": "", "note": "お子様用の椅子", "grouped": False})
# 手入力の予約(外来)
call(front, "POST", "/api/dinner/reservations", {"date": D, "nights": 1, "room": "外来", "guest_name": "中村 様", "adults": 2,
                                                  "children": 0, "infants": 0, "time_slot": "18:00", "allergy": "", "note": "電話予約"})

# グループ(ﾔﾏﾓﾄ様とﾜﾀﾅﾍﾞ様)
r = rows["50106"]
call(front, "PUT", f"/api/dinner/reservations/{r['id']}", {"room": r["room"], "guest_name": r["guest_name"], "adults": 2,
     "children": 0, "infants": 0, "time_slot": r["time_slot"], "allergy": "", "note": "", "grouped": True,
     "group_with": rows["50101"]["id"]})

# ---- 入場済(17:30は一部、19:30は全員) ----
for no in ("50101", "50102", "50107"):
    call(rest, "PATCH", f"/api/dinner/reservations/{rows[no]['id']}/entered", {"entered": True})

# ---- テーブル割り当て・卓メモ ----
A = lambda rid, t, slot: call(rest, "POST", "/api/floor/assign", {"date": D, "time_slot": slot, "table_id": t, "reservation_id": rid})
A(rows["50101"]["id"], "t7", "17:30")
A(rows["50103"]["id"], "t8", "17:30")   # 5名を4名卓へ → 4名が座り、残り1名は未アサインに
A(rows["50106"]["id"], "t9", "17:30")   # ﾔﾏﾓﾄ様(卓7)と同じグループ → 卓7・9の左下に G1
A(rows["50102"]["id"], "t8", "19:30")
A(rows["50107"]["id"], "t1", "19:30")   # 11名のツアー → 卓1・2・3に4・4・3名
A(rows["50107"]["id"], "t2", "19:30")
A(rows["50107"]["id"], "t3", "19:30")
call(rest, "PUT", "/api/floor/memo", {"date": D, "time_slot": "17:30", "table_id": "t8", "reservation_id": rows["50103"]["id"],
                                      "memo": "お子様用の椅子を1脚"})

# ---- 朝食(翌朝): 人数と入場(一部入場を含む) ----
D1 = (TODAY + datetime.timedelta(days=1)).isoformat()
bf = {r["resv_no"]: r for r in call(front, "GET", f"/api/breakfast/reservations?d={D1}")}
for no, (a, c, i) in {"50101": (2, 0, 0), "50102": (2, 1, 0), "50103": (3, 1, 1), "50104": (1, 0, 0),
                      "50106": (2, 0, 0), "50107": (10, 1, 0)}.items():
    call(front, "PATCH", f"/api/breakfast/reservations/{bf[no]['id']}/counts", {"adults": a, "children": c, "infants": i})
for no, n in {"50101": 2, "50103": 3, "50107": 6}.items():
    call(rest, "PATCH", f"/api/breakfast/reservations/{bf[no]['id']}/entered_count", {"count": n})

# ---- 翌日の夕食: 連泊(2泊目)のｽｽﾞｷ様を卓に割り当てる(2泊目の札の写真用) ----
dn1 = {r["resv_no"]: r for r in call(front, "GET", f"/api/dinner/reservations?d={D1}")}
r = dn1["50102"]
call(front, "PATCH", f"/api/dinner/reservations/{r['id']}/counts", {"adults": 2, "children": 1, "infants": 0})
call(rest, "POST", "/api/floor/assign", {"date": D1, "time_slot": r["time_slot"], "table_id": "t8", "reservation_id": r["id"]})

# ---- チャット ----
call(front, "POST", "/api/chat/messages", {"body": "本日19:30のデモツアー様、1名増の可能性ありとのことです。"})
call(rest, "POST", "/api/chat/messages", {"body": "承知しました。卓を空けておきます。"})
# 佐藤さん(レストラン)の画面に未読バッジが出るように、最後にフロントから1件
call(front, "POST", "/api/chat/messages", {"body": "明朝、50103のｻﾄｳ様は7:30ご希望です。"})
print("demo data ready")
