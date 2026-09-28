"""テーブルアサイン(夕食)の基本レイアウト

座標は見取り図(横1000×縦460)上の左上位置と大きさ。
番号: 大部屋の下段1〜6・上段7〜11・左の壁際12〜14、小部屋の下段15〜17(4名)・上段18〜20(左から6・4・4名)
"""
import copy

CANVAS_W, CANVAS_H = 1000, 460
LAYOUT_VERSION = 2  # 見取り図を変えたら上げる(古い配置は migrate_tables で移し替える)
SEAT_SIZES = {2: (56, 58), 4: (70, 58), 6: (96, 58)}  # 席数ごとの卓の大きさ(横, 縦)
ROOM_SPLIT_X = 650  # これより左が大部屋、右が小部屋


def _t(no: int, cx: int, cy: int, seats: int = 4) -> dict:
    w, h = SEAT_SIZES[seats]
    return {"id": f"t{no}", "name": str(no), "seats": seats, "x": cx - w // 2, "y": cy - h // 2, "w": w, "h": h}


MAIN_TABLES = (
    [_t(i + 1, x, 383) for i, x in enumerate((95, 200, 298, 399, 500, 599))]
    + [_t(i + 7, x, 292) for i, x in enumerate((200, 298, 399, 500, 599))]
    + [_t(i + 12, 84, y) for i, y in enumerate((82, 162, 261))]
)
SMALL_ROOM_TABLES = (
    [_t(i + 15, x, 250) for i, x in enumerate((730, 830, 930))]
    + [_t(18, 730, 100, 6), _t(19, 840, 100), _t(20, 930, 100)]
)
DEFAULT_TABLES = MAIN_TABLES + SMALL_ROOM_TABLES


def migrate_tables(tables: list[dict], version: int, is_base: bool) -> list[dict]:
    """古い見取り図の配置を今の見取り図に合わせる"""
    if version >= LAYOUT_VERSION:
        return tables
    if is_base:
        return copy.deepcopy(DEFAULT_TABLES)
    # v1 → v2: 大部屋は180上へ。小部屋(旧: 入口側4卓+カウンター側3卓)は新しい6卓に置き換える
    out = [{**t, "y": max(0, t["y"] - 180)} for t in tables if t["x"] + t["w"] / 2 < ROOM_SPLIT_X]
    names, ids = {t["name"] for t in out}, {t["id"] for t in out}
    out += [copy.deepcopy(t) for t in SMALL_ROOM_TABLES if t["id"] not in ids and t["name"] not in names]
    return out
