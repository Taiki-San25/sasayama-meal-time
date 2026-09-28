"""宿泊者リストCSV(①予約・②部屋割り)の読み込みと、管理表への取り込み計画づくり

① 予約: A=予約番号 B=枝番 D=1桁の整数 E=チェックイン F=チェックアウト K=名前 M=取消フラグ
② 部屋割り: A=予約番号 B=枝番 D=宿泊日(8桁) F=部屋の並び順 K=部屋番号 L=名前
どちらも Shift_JIS・見出し行なし・1部屋1行。予約番号+枝番を1件として、複数部屋はまとめる。
"""
import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

UNASSIGNED_ROOM = "未割当"
DINNER_TIMES = {"⑰": "17:30", "⑲": "19:30"}


class CsvError(ValueError):
    pass


def read_rows(raw: bytes) -> list[list[str]]:
    for enc in ("utf-8-sig", "cp932"):  # UTF-8 を先に(Shift_JIS は UTF-8 として読めないので誤判定しない)
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise CsvError("文字コードを判別できません(Shift_JIS の CSV を選んでください)")
    return [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]


def detect_kind(rows: list[list[str]]) -> str | None:
    """D列が1桁の整数なら①、8桁の日付なら②"""
    if not rows or len(rows[0]) < 4:
        return None
    d = rows[0][3].strip()
    if re.fullmatch(r"\d", d):
        return "reservations"
    if re.fullmatch(r"\d{8}", d):
        return "rooms"
    return None


def split_name(raw: str) -> tuple[str, str]:
    """「名前_印」を (名前, 印) に分ける。印は「_」より後ろ"""
    name, _, marks = raw.strip().partition("_")
    return name.strip(), marks


def parse_ymd(v: str) -> date:
    return datetime.strptime(v.strip(), "%Y%m%d").date()


def norm_room(v: str) -> str:
    v = v.strip()
    return v.lstrip("0") or v


@dataclass
class Stay:
    key: str                    # 予約番号-枝番
    name: str
    checkin: date
    checkout: date
    cancelled: bool
    dinner: bool = False
    dinner_time: str | None = None
    breakfast: bool = False
    rooms: list[str] = field(default_factory=list)

    @property
    def room(self) -> str:
        return ", ".join(self.rooms) or UNASSIGNED_ROOM

    def dates(self, meal: str) -> list[date]:
        """夕食はチェックイン日〜チェックアウト前日、朝食はチェックイン翌日〜チェックアウト日"""
        n = (self.checkout - self.checkin).days
        start = self.checkin if meal == "dinner" else self.checkin + timedelta(days=1)
        return [start + timedelta(days=i) for i in range(n)]


def build_stays(res_rows: list[list[str]], room_rows: list[list[str]]) -> list[Stay]:
    groups: dict[str, list[list[str]]] = {}
    for r in res_rows:
        if len(r) < 13:
            raise CsvError("予約ファイル(①)の列数が足りません")
        groups.setdefault(f"{r[0].strip()}-{r[1].strip()}", []).append(r)

    rooms: dict[str, list[tuple[int, str]]] = {}
    for r in room_rows:
        if len(r) < 12:
            raise CsvError("部屋割りファイル(②)の列数が足りません")
        order = int(r[5]) if r[5].strip().isdigit() else 0
        rooms.setdefault(f"{r[0].strip()}-{r[1].strip()}", []).append((order, norm_room(r[10])))

    stays = []
    for key, rows in groups.items():
        live = [r for r in rows if not r[12].strip()]  # M列に値があれば取消
        use = live or rows
        try:
            checkin = min(parse_ymd(r[4]) for r in use)
            checkout = max(parse_ymd(r[5]) for r in use)
        except ValueError:
            raise CsvError(f"予約番号 {key} のチェックイン・チェックアウト日が読めません")
        s = Stay(key=key, name=split_name(use[0][10])[0], checkin=checkin, checkout=checkout, cancelled=not live)
        for r in use:
            marks = split_name(r[10])[1]
            for sym, t in DINNER_TIMES.items():
                if sym in marks:
                    s.dinner = True
                    s.dinner_time = s.dinner_time or t
            if "DN" in marks:
                s.dinner = True
            if "BF" in marks:
                s.breakfast = True
        seen = []
        for _, room in sorted(rooms.get(key, [])):
            if room and room not in seen:
                seen.append(room)
        s.rooms = seen
        stays.append(s)
    return stays
