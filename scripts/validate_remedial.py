# -*- coding: utf-8 -*-
"""
資料驗證套件：檢查解析結果是否可信，並與原始檔的官方欄位對帳。
Run: python scripts/validate_remedial.py
離開碼 0 = 全部通過，1 = 有檢查失敗（可接進 CI 阻擋壞資料）。

設計原則：每一項檢查都要能指出「哪一筆資料有問題」，而不是只給一個總分。
門檻刻意設在「已知可接受範圍」之上一點，讓真正的迴歸會被擋下來。
"""
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).parent.parent / "public" / "data"

SUBJECTS = ["國語文", "數學", "英語"]
YEARS = [111, 112, 113, 114, 115]
NO_TEST = {("英語", 1), ("英語", 2)}

# 111 學年的各校明細與全縣彙總出自略有出入的名冊快照，
# 同一年級內三科差額一致（最多 9 人 / 約 550 人）。這是來源檔的既有狀況，
# 非解析錯誤，故給予容忍值；其他年度要求幾乎完全吻合。
TOLERANCE_PP = {111: 1.30, 112: 0.05, 113: 0.05, 114: 0.05, 115: 0.05}
ROSTER_TOLERANCE = {111: 10.0, 112: 1.0, 113: 1.0, 114: 1.0, 115: 1.0}


class Report:
    def __init__(self):
        self.failed = 0
        self.passed = 0

    def check(self, ok, name, detail=""):
        if ok:
            self.passed += 1
            print(f"  [PASS] {name}")
        else:
            self.failed += 1
            print(f"  [FAIL] {name}")
        if detail:
            for line in detail.splitlines():
                print(f"         {line}")
        return ok

    def note(self, text):
        for line in text.splitlines():
            print(f"         {line}")


def denom(r):
    """官方「年級未通過率」的分母是應考人數；缺值時退回到考人數。"""
    return r.get("testTakers") or r.get("attendees") or 0


def load():
    rows = json.loads((DATA / "remedial.json").read_text(encoding="utf-8"))
    summary = json.loads((DATA / "remedial_summary.json").read_text(encoding="utf-8"))
    analytics = None
    p = DATA / "analytics.json"
    if p.exists():
        analytics = json.loads(p.read_text(encoding="utf-8"))
    return rows, summary, analytics


# ─────────────────── 1. 結構完整性 ───────────────────
def check_structure(rep, rows):
    print("\n1. 結構完整性")

    years = sorted({r["year"] for r in rows})
    rep.check(years == YEARS, "涵蓋 111–115 五個學年", f"實際: {years}")

    missing = [k for k in ("year", "grade", "subject", "schoolName")
               for r in rows[:1] if k not in r]
    rep.check(not missing, "必要欄位齊備", f"缺少: {missing}" if missing else "")

    # 每年每校每年級每科最多一列
    dup = [k for k, v in Counter(
        (r["year"], r["schoolCode"], r["grade"], r["subject"])
        for r in rows if r["schoolCode"]
    ).items() if v > 1]
    rep.check(not dup, "無重複的 (學年,學校,年級,科目) 鍵",
              f"重複 {len(dup)} 組，例: {dup[:3]}" if dup else "")

    # 學校識別資訊不應有缺漏（曾因 114 年解析位移造成整校遺失）
    no_name = [r for r in rows if r["schoolName"] is None]
    no_code = [r for r in rows if r["schoolCode"] is None]
    rep.check(not no_name and not no_code, "每列都有學校名稱與代碼",
              f"缺名稱 {len(no_name)} 列、缺代碼 {len(no_code)} 列")

    # 各年度學校數應落在合理範圍（校數會因併校而減少，但不該劇變）
    per_year = {y: len({r["schoolCode"] for r in rows if r["year"] == y}) for y in YEARS}
    ok = all(40 <= n <= 60 for n in per_year.values())
    rep.check(ok, "各年度學校數在合理範圍 (40–60)", f"實際: {per_year}")


# ─────────────────── 2. 數值合理性 ───────────────────
def check_values(rep, rows):
    print("\n2. 數值合理性")

    bad_rate = [r for r in rows
                if r["notPassRate"] is not None and not (0 <= r["notPassRate"] <= 1)]
    rep.check(not bad_rate, "未通過率都落在 0–1",
              f"越界 {len(bad_rate)} 列" if bad_rate else "")

    bad_cnt = [r for r in rows
               if r["notPass"] is not None and r["attendees"]
               and r["notPass"] > r["attendees"]]
    rep.check(not bad_cnt, "未通過人數不超過到考人數",
              f"違反 {len(bad_cnt)} 列" if bad_cnt else "")

    bad_att = [r for r in rows
               if r["attendees"] and r["testTakers"] and r["attendees"] > r["testTakers"]]
    rep.check(not bad_att, "到考人數不超過應考人數",
              f"違反 {len(bad_att)} 列" if bad_att else "")

    # 英語 1–2 年級未施測，不得出現 0% 這種假資料點
    phantom = [r for r in rows
               if (r["subject"], r["grade"]) in NO_TEST
               and any(r[f] is not None for f in ("attendees", "notPassRate"))]
    rep.check(not phantom, "英語 1–2 年級標為未施測（非 0%）",
              f"殘留 {len(phantom)} 列" if phantom else "")


# ─────────────────── 3. 內部一致性 ───────────────────
def check_internal(rep, rows):
    print("\n3. 內部一致性（檔案自身的率 vs 由人數重算）")

    bad = []
    for r in rows:
        if r["attendees"] and r["notPass"] is not None and r["notPassRate"] is not None:
            calc = r["notPass"] / r["attendees"]
            if abs(calc - r["notPassRate"]) > 0.011:  # 容忍公布值四捨五入
                bad.append((r["year"], r["schoolName"], r["grade"], r["subject"],
                            calc, r["notPassRate"]))
    total = sum(1 for r in rows if r["attendees"])
    detail = ""
    if bad:
        detail = "\n".join(
            f"{b[0]} {b[1]} G{b[2]} {b[3]}: 重算={b[4]:.4f} 檔案={b[5]:.4f}" for b in bad[:5])
    rep.check(not bad, f"施測未通過率 = 未通過/到考（{total} 列）",
              detail or f"檢查 {total} 列全數吻合")


# ─────────────────── 4. 與官方縣值對帳 ───────────────────
def check_county_reconciliation(rep, rows):
    print("\n4. 與原始檔官方【縣市】年級未通過率對帳")

    # 官方縣值應在同一 (年,年級,科目) 內各校一致
    groups = defaultdict(set)
    for r in rows:
        if r["countyRate"] is not None:
            groups[(r["year"], r["grade"], r["subject"])].add(r["countyRate"])
    inconsistent = {k: v for k, v in groups.items() if len(v) > 1}
    rep.check(not inconsistent, f"官方縣值在各校間一致（{len(groups)} 組）",
              f"不一致 {len(inconsistent)} 組" if inconsistent else "")

    # 由各校加總（應考分母）是否重現官方縣值
    per_year = defaultdict(list)
    worst_rows = []
    for (y, g, s), vals in groups.items():
        sel = [r for r in rows
               if r["year"] == y and r["grade"] == g and r["subject"] == s and r["attendees"]]
        d = sum(denom(r) for r in sel)
        n = sum(r["notPass"] or 0 for r in sel)
        if not d:
            continue
        diff = abs(n / d - list(vals)[0]) * 100
        per_year[y].append(diff)
        worst_rows.append((diff, y, g, s, n / d, list(vals)[0]))

    worst_rows.sort(reverse=True)
    lines = []
    all_ok = True
    for y in YEARS:
        ds = per_year.get(y, [])
        if not ds:
            continue
        mx, med = max(ds), statistics.median(ds)
        tol = TOLERANCE_PP[y]
        ok = mx <= tol
        all_ok &= ok
        lines.append(f"{y}: 最大 {mx:.3f} pp, 中位 {med:.4f} pp (容忍 {tol} pp) "
                     f"{'OK' if ok else '超出'}")
    rep.check(all_ok, "由各校加總可重現官方縣值", "\n".join(lines))

    if worst_rows:
        rep.note("差異最大的 3 組: " + "; ".join(
            f"{y} G{g} {s} {d:.2f}pp" for d, y, g, s, _, _ in worst_rows[:3]))


# ─────────────────── 5. 名冊落差（隱含分母） ───────────────────
def check_roster(rep, rows):
    print("\n5. 名冊落差：由官方率反推的分母 vs 我方加總人數")
    rep.note("同一年級內三科差額一致 => 學生名冊差異，而非科目別的解析錯誤")

    worst = defaultdict(float)
    per_grade = defaultdict(dict)
    for y in YEARS:
        for g in range(1, 9):
            for s in SUBJECTS:
                sel = [r for r in rows if r["year"] == y and r["grade"] == g
                       and r["subject"] == s and r["attendees"]]
                if not sel:
                    continue
                off = sel[0]["countyRate"]
                n = sum(r["notPass"] or 0 for r in sel)
                d = sum(denom(r) for r in sel)
                if not off or not d:
                    continue
                gap = n / off - d
                per_grade[(y, g)][s] = gap
                worst[y] = max(worst[y], abs(gap))

    lines, all_ok = [], True
    for y in YEARS:
        tol = ROSTER_TOLERANCE[y]
        ok = worst[y] <= tol
        all_ok &= ok
        lines.append(f"{y}: 最大差額 {worst[y]:.1f} 人 (容忍 {tol:.0f}) {'OK' if ok else '超出'}")
    rep.check(all_ok, "隱含分母差額在容忍範圍內", "\n".join(lines))

    # 檢驗「跨科一致」這個特徵是否成立
    incons = []
    for (y, g), d in per_grade.items():
        vals = [round(v, 1) for v in d.values()]
        if len(vals) > 1 and (max(vals) - min(vals)) > 1.5:
            incons.append((y, g, d))
    rep.check(not incons, "名冊差額在同年級內跨科一致",
              f"例外 {len(incons)} 組: {[(y, g) for y, g, _ in incons[:5]]}" if incons else
              "成立 => 差異源於學生名冊，非解析錯誤")


# ─────────────────── 6. 世代追蹤前提 ───────────────────
def check_cohorts(rep, rows):
    print("\n6. 世代追蹤前提：同一屆人數是否穩定")

    coh = defaultdict(dict)
    for r in rows:
        if r["subject"] == "數學" and r["attendees"]:
            c = r["year"] - r["grade"]
            coh[c][r["grade"]] = coh[c].get(r["grade"], 0) + denom(r)

    lines, worst = [], 0.0
    for c in sorted(coh):
        seq = [coh[c][g] for g in sorted(coh[c])]
        if len(seq) < 3:
            continue
        var = (max(seq) - min(seq)) / max(seq)
        worst = max(worst, var)
        lines.append(f"世代{c + 1}年入學: {seq} 變動 {var * 100:.1f}%")
    ok = worst <= 0.10
    rep.check(ok, "縣級世代人數變動 ≤ 10%（追蹤才有意義）",
              "\n".join(lines) + f"\n最大變動 {worst * 100:.1f}%")


# ─────────────────── 7. 彙總表與分析檔 ───────────────────
def check_summary(rep, rows, summary, analytics):
    print("\n7. 彙總表與分析檔")

    phantom = [s for s in summary if (s["subject"], s["grade"]) in NO_TEST]
    rep.check(not phantom, "彙總表不含未施測組合",
              f"殘留 {len(phantom)} 列" if phantom else "")

    expect = len(YEARS) * (len(SUBJECTS) * 8 - len(NO_TEST))
    rep.check(len(summary) == expect, f"彙總表列數 = {expect}", f"實際 {len(summary)}")

    if analytics is None:
        rep.note("analytics.json 不存在，略過（請先執行 analyze_remedial.py）")
        return

    # 分析檔的縣級數列應與原始資料加總一致
    bad = []
    for subj in SUBJECTS:
        for pt in analytics["countyTrend"][subj]["series"]:
            sel = [r for r in rows if r["year"] == pt["year"] and r["subject"] == subj
                   and r["attendees"]]
            d = sum(denom(r) for r in sel)
            n = sum(r["notPass"] or 0 for r in sel)
            if d and pt["rate"] is not None and abs(n / d - pt["rate"]) > 0.0005:
                bad.append(f"{subj} {pt['year']}: 分析檔={pt['rate']:.4f} 重算={n / d:.4f}")
    rep.check(not bad, "analytics.json 縣級數列可由原始資料重現",
              "\n".join(bad[:5]) if bad else "")


def main():
    rows, summary, analytics = load()
    rep = Report()

    print("=" * 68)
    print("澎湖縣學習扶助資料驗證")
    print(f"明細 {len(rows)} 列 · 彙總 {len(summary)} 列")
    print("=" * 68)

    check_structure(rep, rows)
    check_values(rep, rows)
    check_internal(rep, rows)
    check_county_reconciliation(rep, rows)
    check_roster(rep, rows)
    check_cohorts(rep, rows)
    check_summary(rep, rows, summary, analytics)

    print("\n" + "=" * 68)
    print(f"通過 {rep.passed} 項，失敗 {rep.failed} 項")
    print("=" * 68)
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
