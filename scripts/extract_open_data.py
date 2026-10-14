# -*- coding: utf-8 -*-
"""
從教育部／各部會公開資料中擷取澎湖縣部分，存進 data/raw/open/。
Run: python scripts/extract_open_data.py [來源目錄]

只取澎湖縣的列，但保留原始欄位名稱與值，確保可追溯回政府公開資料。
擷取後的檔案會進版控，之後重跑分析不需再依賴原始下載目錄。
"""
import csv
import sys
from pathlib import Path

DEFAULT_SRC = Path(r"D:\chnro\Downloads\學習平台數據\原始資料\公開資料")
OUT = Path(__file__).parent.parent / "data" / "raw" / "open"

# (來源相對路徑, 輸出檔名, 縣市欄位名)
SOURCES = [
    (r"教育部_偏遠名錄/104-114學年偏遠地區國中小本校名錄.csv",
     "偏遠地區名錄_本校.csv", "縣市名稱"),
    (r"教育部_偏遠名錄/108-114學年偏遠地區國中小分校分班名錄.csv",
     "偏遠地區名錄_分校分班.csv", "縣市名稱"),
    (r"教育部_國小名錄/114學年國民小學名錄.csv",
     "國小名錄_114.csv", "縣市名稱"),
    (r"教育部_校別資料/112_basec.csv", "校別基本資料_112.csv", "縣市名稱"),
    (r"教育部_校別資料/113_basec.csv", "校別基本資料_113.csv", "縣市名稱"),
    (r"教育部_校別資料/114_basec.csv", "校別基本資料_114.csv", "縣市名稱"),
]

COUNTY = "澎湖"


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        print(f"找不到來源目錄: {src}")
        print("用法: python scripts/extract_open_data.py <公開資料目錄>")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for rel, name, county_col in SOURCES:
        path = src / rel
        if not path.exists():
            print(f"  [略過] 找不到 {rel}")
            continue
        with open(path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            fields = reader.fieldnames or []
            rows = [r for r in reader if COUNTY in (r.get(county_col) or "")]
        with open(OUT / name, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        print(f"  {name}: {len(rows)} 列")
        total += len(rows)

    # 記錄出處，方便日後查證與更新
    (OUT / "SOURCES.txt").write_text(
        "本目錄為各部會公開資料中澎湖縣部分的擷取結果。\n"
        f"擷取自: {src}\n"
        f"擷取腳本: scripts/extract_open_data.py\n\n"
        + "\n".join(f"{name}  <-  {rel}" for rel, name, _ in SOURCES)
        + "\n\n未納入（與澎湖無關）:\n"
          "  新北市115學年度國小學區一覽表.pdf   （純新北市）\n"
          "  財政部_村里所得/*.csv              （只有新北市，0 筆澎湖）\n",
        encoding="utf-8")
    print(f"\n共 {total} 列，輸出至 {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
