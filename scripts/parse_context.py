# -*- coding: utf-8 -*-
"""
把公開資料的學校脈絡變數整理成 public/data/context.json。
Run: python scripts/parse_context.py

產出以 (學年, 學校代碼) 為鍵的脈絡資料：偏遠分級、原住民學生比率、師生比、班級數。
這些是 remedial 資料本身沒有的「解釋變數」，用來回答「哪些學校條件與未通過率有關」。
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
OPEN = ROOT / "data" / "raw" / "open"
OUT = ROOT / "public" / "data"

# 偏遠名錄涵蓋 104–114 學年；remedial 為 111–115。
# 115 學年沒有對應的分級資料，不做外推。
TIER_ORDER = ["偏遠", "特偏", "極偏"]


def num(v, cast=int):
    try:
        return cast(str(v).strip())
    except (ValueError, AttributeError, TypeError):
        return None


def read(name):
    p = OPEN / name
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def parse_remote():
    """偏遠地區名錄 -> 分級、原住民比率、班級數、學生數。"""
    out = {}
    for r in read("偏遠地區名錄_本校.csv"):
        y = num(r.get("學年度"))
        code = (r.get("學校代碼") or "").strip()
        if y is None or not code:
            continue
        boys = num(r.get("男學生數[人]")) or 0
        girls = num(r.get("女學生數[人]")) or 0
        out[(y, code)] = {
            "tier": (r.get("地區屬性") or "").strip() or None,
            "indigenousPct": num(r.get("原住民學生比率"), float),
            "classes": num(r.get("班級數")),
            "students": boys + girls if (boys or girls) else None,
            "level": (r.get("學生等級") or "").strip() or None,
            "district": (r.get("鄉鎮市區") or "").strip() or None,
        }
    return out


def parse_basec():
    """校別基本資料 -> 專任教師數、學生數、師生比（僅國小，112–114）。"""
    out = {}
    for yr in (112, 113, 114):
        for r in read(f"校別基本資料_{yr}.csv"):
            code = (r.get("學校代碼") or "").strip()
            if not code:
                continue
            students = sum((num(r.get(f"{g}年級男學生數")) or 0)
                           + (num(r.get(f"{g}年級女學生數")) or 0) for g in range(1, 7))
            classes = sum(num(r.get(f"{g}年級班級數")) or 0 for g in range(1, 7))
            teachers = (num(r.get("男專任教師")) or 0) + (num(r.get("女專任教師")) or 0)
            out[(yr, code)] = {
                "teachers": teachers or None,
                "elemStudents": students or None,
                "elemClasses": classes or None,
                "studentsPerTeacher": round(students / teachers, 2) if teachers else None,
                "studentsPerClass": round(students / classes, 2) if classes else None,
            }
    return out


def main():
    remote = parse_remote()
    basec = parse_basec()

    merged = defaultdict(dict)
    for (y, code), v in remote.items():
        merged[(y, code)].update(v)
    for (y, code), v in basec.items():
        merged[(y, code)].update(v)

    records = [{"year": y, "schoolCode": code, **v} for (y, code), v in sorted(merged.items())]

    # 分級的年度涵蓋範圍，供前端據實標示
    tier_years = sorted({r["year"] for r in records if r.get("tier")})
    basec_years = sorted({r["year"] for r in records if r.get("teachers")})

    data = {
        "meta": {
            "tierYears": tier_years,
            "basecYears": basec_years,
            "tierOrder": TIER_ORDER,
            "notes": {
                "tier": "偏遠分級來自教育部偏遠地區學校名錄，涵蓋 "
                        f"{tier_years[0]}–{tier_years[-1]} 學年；115 學年無對應資料，不做外推。",
                "basec": "師生比來自教育部校別基本資料，僅涵蓋國小、"
                         f"{basec_years[0]}–{basec_years[-1]} 學年；國中無此資料。",
                "income": "財政部村里所得資料僅有新北市，無澎湖，故無法做社經背景分析。",
                "confound": "師生比與學校規模高度共線：澎湖師生比最低的學校即為極小型離島校。"
                            "分析時必須控制規模，不可直接解讀為師資投入的效果。",
            },
        },
        "records": records,
    }
    (OUT / "context.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    print(f"context.json: {len(records)} 筆 (學年 × 學校)")
    print(f"  偏遠分級涵蓋學年: {tier_years}")
    print(f"  師生比涵蓋學年:   {basec_years}")
    tiers = defaultdict(int)
    for r in records:
        if r.get("tier"):
            tiers[r["tier"]] += 1
    print(f"  分級分布: {dict(tiers)}")


if __name__ == "__main__":
    main()
