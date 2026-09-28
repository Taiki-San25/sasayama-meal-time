"""テーブルアサイン(夕食)の基本レイアウト

座標は見取り図(横1000×縦640)上の左上位置と大きさ。
番号: メイン下段1〜6・上段7〜11、左の壁際12〜14、カウンター側15〜17、入口側18〜21
"""
CANVAS_W, CANVAS_H = 1000, 640
SEAT_SIZES = {2: (56, 58), 4: (70, 58), 6: (96, 58)}  # 席数ごとの卓の大きさ(横, 縦)


def _t(no: int, cx: int, cy: int, seats: int = 4) -> dict:
    w, h = SEAT_SIZES[seats]
    return {"id": f"t{no}", "name": str(no), "seats": seats, "x": cx - w // 2, "y": cy - h // 2, "w": w, "h": h}


DEFAULT_TABLES = (
    [_t(i + 1, x, 563) for i, x in enumerate((95, 200, 298, 399, 500, 599))]
    + [_t(i + 7, x, 472) for i, x in enumerate((200, 298, 399, 500, 599))]
    + [_t(i + 12, 84, y) for i, y in enumerate((262, 342, 441))]
    + [_t(i + 15, x, 269, 2) for i, x in enumerate((745, 831, 918))]
    + [_t(i + 18, x, 115) for i, x in enumerate((706, 786, 866, 946))]
)
