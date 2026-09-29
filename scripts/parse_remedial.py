# -*- coding: utf-8 -*-
"""
Parse Penghu 學習扶助篩選測驗未通過率 source files (xls/xlsx) into unified JSON.
Run: python scripts/parse_remedial.py
Output: data/remedial.json (school x grade x subject long format)
        data/remedial_summary.json (county-level grade x subject aggregate, per year)
"""
import json
import math
import re
from pathlib import Path

import pandas as pd

RAW = Path(__file__).parent.parent / "data" / "raw"
OUT = Path(__file__).parent.parent / "public" / "data"

SUBJECTS = ["國語文", "數學", "英語"]
# each subject block has 7 columns: 應考人數,到考人數,未通過人數,施測未通過率,年級未通過率,縣市年級未通過率,全國年級未通過率
BLOCK_LEN = 7


def pct(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, str):
        v = v.strip().rstrip("%")
        if v in ("", "-", "--"):
            return None
        try:
            return round(float(v) / 100, 4)
        except ValueError:
            return None
    if isinstance(v, (int, float)):
        if math.isnan(v):
            return None
        # already a fraction (0-1) in some sheets, or a percent-like number
        return round(float(v), 4) if v <= 1 else round(float(v) / 100, 4)
    return None


def num(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, str):
        v = v.strip()
        if v in ("", "-", "--"):
            return None
        try:
            return int(float(v))
        except ValueError:
            return None
    return int(v)


def parse_school_code_name(raw):
    """'164601縣立馬公國小' -> ('164601', '縣立馬公國小')"""
    raw = str(raw).strip()
    m = re.match(r"^(\d+)(.*)$", raw)
    if m:
        return m.group(1), m.group(2)
    return None, raw


def parse_113(path):
    """113年5月學習扶助篩選測驗未通過率.xls -> Worksheet sheet, per-school per-grade rows."""
    df = pd.read_excel(path, sheet_name="Worksheet", header=None)
    rows = []
    district = school_code = school_name = school_type = None
    for _, r in df.iloc[3:].iterrows():
        if pd.notna(r[1]):
            district = str(r[1]).strip()
            school_code, school_name = parse_school_code_name(r[2])
            school_type = str(r[3]).strip() if pd.notna(r[3]) else None
        if pd.isna(r[4]):
            continue
        grade = num(r[4])
        grade_students = num(r[5])
        for si, subject in enumerate(SUBJECTS):
            base = 6 + si * BLOCK_LEN
            test_takers = num(r[base])
            attendees = num(r[base + 1])
            not_pass = num(r[base + 2])
            rows.append({
                "year": 113,
                "district": district,
                "schoolCode": school_code,
                "schoolName": school_name,
                "schoolType": school_type,
                "grade": grade,
                "gradeStudents": grade_students,
                "subject": subject,
                "testTakers": test_takers,
                "attendees": attendees,
                "notPass": not_pass,
                "notPassRate": pct(r[base + 3]),
                "gradeNotPassRate": pct(r[base + 4]),
                "countyRate": pct(r[base + 5]),
                "nationalRate": pct(r[base + 6]),
            })
    return rows


def parse_113_summary(path):
    """113 sheet '工作表1' -> county-level grade x subject aggregate."""
    df = pd.read_excel(path, sheet_name="工作表1", header=None)
    rows = []
    for _, r in df.iloc[3:12].iterrows():
        grade = num(r[1])
        if grade is None or grade == 9:
            continue
        for si, subject in enumerate(SUBJECTS):
            base = 3 + si * 5
            attendees = num(r[base])
            not_pass = num(r[base + 1])
            rows.append({
                "year": 113,
                "grade": grade,
                "subject": subject,
                "attendees": attendees,
                "notPass": not_pass,
                "notPassRate": pct(r[base + 2]),
            })
    return rows


def parse_114(path):
    """114年5月篩選測驗各校未通過率.xlsx -> 各別學校 sheet, per-school per-grade rows.
    No district column in this file; districts filled in later from a name lookup if needed."""
    df = pd.read_excel(path, sheet_name="各別學校", header=None)
    rows = []
    school_code = school_name = None
    for _, r in df.iloc[3:].iterrows():
        if pd.notna(r[1]):
            school_code, school_name = parse_school_code_name(r[1])
        if pd.isna(r[2]):
            continue
        grade = num(r[2])
        grade_students = num(r[3])
        for si, subject in enumerate(SUBJECTS):
            base = 4 + si * BLOCK_LEN
            test_takers = num(r[base])
            attendees = num(r[base + 1])
            not_pass = num(r[base + 2])
            rows.append({
                "year": 114,
                "district": None,
                "schoolCode": school_code,
                "schoolName": school_name,
                "schoolType": None,
                "grade": grade,
                "gradeStudents": grade_students,
                "subject": subject,
                "testTakers": test_takers,
                "attendees": attendees,
                "notPass": not_pass,
                "notPassRate": pct(r[base + 3]),
                "gradeNotPassRate": pct(r[base + 4]),
                "countyRate": pct(r[base + 5]),
                "nationalRate": pct(r[base + 6]),
            })
    return rows


def parse_114_summary(path):
    """114 sheet '澎湖縣' -> county-level grade x subject aggregate."""
    df = pd.read_excel(path, sheet_name="澎湖縣", header=None)
    rows = []
    for _, r in df.iloc[3:].iterrows():
        grade = num(r[1])
        if grade is None:
            continue
        for si, subject in enumerate(SUBJECTS):
            base = 3 + si * 6
            attendees = num(r[base])
            not_pass = num(r[base + 1])
            rows.append({
                "year": 114,
                "grade": grade,
                "subject": subject,
                "attendees": attendees,
                "notPass": not_pass,
                "notPassRate": pct(r[base + 2]),
            })
    return rows


def fill_district_from_113(rows_114, rows_113):
    lookup = {r["schoolCode"]: (r["district"], r["schoolType"]) for r in rows_113 if r["schoolCode"]}
    for r in rows_114:
        if r["schoolCode"] in lookup:
            r["district"], r["schoolType"] = lookup[r["schoolCode"]]
    return rows_114


def main():
    rows_113 = parse_113(RAW / "113年5月學習扶助篩選測驗未通過率.xls")
    summary_113 = parse_113_summary(RAW / "113年5月學習扶助篩選測驗未通過率.xls")
    rows_114 = parse_114(RAW / "114年5月篩選測驗各校未通過率.xlsx")
    summary_114 = parse_114_summary(RAW / "114年5月篩選測驗各校未通過率.xlsx")

    rows_114 = fill_district_from_113(rows_114, rows_113)

    all_rows = rows_113 + rows_114
    all_summary = summary_113 + summary_114

    (OUT / "remedial.json").write_text(
        json.dumps(all_rows, ensure_ascii=False, indent=None), encoding="utf-8"
    )
    (OUT / "remedial_summary.json").write_text(
        json.dumps(all_summary, ensure_ascii=False, indent=None), encoding="utf-8"
    )
    print(f"remedial.json: {len(all_rows)} rows ({sorted(set(r['year'] for r in all_rows))})")
    print(f"remedial_summary.json: {len(all_summary)} rows")


if __name__ == "__main__":
    main()
