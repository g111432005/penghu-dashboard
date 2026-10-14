# -*- coding: utf-8 -*-
"""
從 public/data/remedial.json 預先計算所有分析結果。
Run: python scripts/analyze_remedial.py
Output: public/data/analytics.json

全部統計在此離線完成，前端只負責呈現；瀏覽器不做迴歸/相關係數運算。
"""
import json
import math
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parent.parent / "public" / "data"

SUBJECTS = ["國語文", "數學", "英語"]
YEARS = [111, 112, 113, 114, 115]
FORECAST_YEAR = 116

# 英語自 3 年級起施測
NO_TEST = {("英語", 1), ("英語", 2)}

# 小校單年未通過率波動極大（個位數學生一人未通過就是 10-30 個百分點），
# 校級比較與風險評分一律用經驗貝氏收縮，K 為先驗等效人數。
SHRINK_K = 40
# 單一年級×科目低於此到考人數時，該點不列入校際比較
MIN_ATTENDEES = 10


def rate(not_pass, attendees):
    return not_pass / attendees if attendees else None


def agg(rows):
    """(到考人數, 未通過人數) 合計；自動忽略 None。"""
    a = sum(r["attendees"] or 0 for r in rows)
    n = sum(r["notPass"] or 0 for r in rows)
    return a, n


def linfit(xs, ys):
    """最小平方法直線擬合，回傳 slope/intercept/r2/標準誤。
    樣本僅 5 點，r2 與標準誤一併回傳供前端標示不確定性。"""
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    ss_res = sum(r * r for r in resid)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
    # 殘差標準誤（自由度 n-2），用於預測區間
    se = math.sqrt(ss_res / (n - 2)) if n > 2 else None
    return {
        "slope": slope,
        "intercept": intercept,
        "r2": r2,
        "se": se,
        "mx": mx,
        "sxx": sxx,
        "n": n,
    }


def predict(fit, x):
    """點估計 + 約 95% 預測區間（t≈2.78, df=3）。"""
    if not fit:
        return None, None, None
    y = fit["intercept"] + fit["slope"] * x
    if fit["se"] is None:
        return y, None, None
    # 單點預測的標準誤
    sp = fit["se"] * math.sqrt(1 + 1 / fit["n"] + (x - fit["mx"]) ** 2 / fit["sxx"])
    half = 2.78 * sp
    return y, max(0.0, y - half), min(1.0, y + half)


def r4(v):
    return None if v is None else round(v, 4)


# ────────────────────────────── 1. 縣級趨勢與預測 ──────────────────────────────
def county_trend_and_forecast(rows):
    out = {}
    for subj in SUBJECTS:
        series = []
        for y in YEARS:
            a, n = agg([r for r in rows if r["year"] == y and r["subject"] == subj])
            series.append({"year": y, "attendees": a, "notPass": n, "rate": r4(rate(n, a))})
        pts = [(s["year"], s["rate"]) for s in series if s["rate"] is not None]
        fit = linfit([p[0] for p in pts], [p[1] for p in pts]) if len(pts) >= 3 else None
        yhat, lo, hi = predict(fit, FORECAST_YEAR)
        out[subj] = {
            "series": series,
            "trend": {
                # 每學年變化的百分點
                "slopePerYear": r4(fit["slope"]) if fit else None,
                "r2": r4(fit["r2"]) if fit else None,
            } if fit else None,
            "forecast": {
                "year": FORECAST_YEAR,
                "rate": r4(yhat),
                "lo": r4(lo),
                "hi": r4(hi),
            } if fit else None,
        }
    return out


# ────────────────────────────── 2. 年級斷點 ──────────────────────────────
def grade_profile(rows):
    """各年級未通過率（五年合併，樣本較穩）＋ 相鄰年級的跳升幅度。"""
    out = {}
    for subj in SUBJECTS:
        prof = []
        for g in range(1, 9):
            if (subj, g) in NO_TEST:
                continue
            a, n = agg([r for r in rows if r["subject"] == subj and r["grade"] == g])
            prof.append({"grade": g, "attendees": a, "rate": r4(rate(n, a))})
        for i, p in enumerate(prof):
            prev = prof[i - 1]["rate"] if i > 0 else None
            p["delta"] = r4(p["rate"] - prev) if (prev is not None and p["rate"] is not None) else None
        out[subj] = prof
    return out


# ────────────────────────────── 3. 城鄉／行政區落差 ──────────────────────────────
def district_analysis(rows):
    districts = sorted({r["district"] for r in rows if r["district"]})
    out = {"districts": districts, "bySubject": {}}
    for subj in SUBJECTS:
        per = []
        for d in districts:
            years = []
            for y in YEARS:
                a, n = agg([r for r in rows
                            if r["district"] == d and r["subject"] == subj and r["year"] == y])
                years.append({"year": y, "rate": r4(rate(n, a)), "attendees": a})
            a, n = agg([r for r in rows if r["district"] == d and r["subject"] == subj])
            per.append({
                "district": d,
                "rate": r4(rate(n, a)),
                "attendees": a,
                "years": years,
            })
        per.sort(key=lambda x: -(x["rate"] or 0))
        out["bySubject"][subj] = per
    return out


# ────────────────────────────── 4. 世代（同一屆學生）追蹤 ──────────────────────────────
def cohort_tracking(rows):
    """cohort = year - grade，同一群學生每年升一個年級，可做真正的縱貫追蹤。
    回傳縣級世代曲線（各科），僅保留觀測點 >= 3 的世代。"""
    out = {}
    for subj in SUBJECTS:
        buckets = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in rows:
            if r["subject"] != subj or not r["attendees"]:
                continue
            c = r["year"] - r["grade"]
            b = buckets[c][r["grade"]]
            b[0] += r["attendees"]
            b[1] += r["notPass"] or 0
        cohorts = []
        for c in sorted(buckets):
            pts = [{
                "grade": g,
                "year": c + g,
                "attendees": buckets[c][g][0],
                "rate": r4(rate(buckets[c][g][1], buckets[c][g][0])),
            } for g in sorted(buckets[c])]
            if len(pts) >= 3:
                cohorts.append({
                    "cohort": c,
                    # 以最後一次觀測的學年與年級標示，方便辨識是哪一屆
                    "label": f"{c + pts[-1]['grade']}學年{'國小' if pts[-1]['grade'] <= 6 else '國中'}"
                             f"{pts[-1]['grade'] if pts[-1]['grade'] <= 6 else pts[-1]['grade'] - 6}年級",
                    "points": pts,
                })
        out[subj] = cohorts
    return out


# ────────────────────────────── 5. 科目間相關 ──────────────────────────────
def subject_correlation(rows):
    """以「學校×年級×學年」為單位配對兩科未通過率，算 Pearson r。
    僅納入兩科到考人數都 >= MIN_ATTENDEES 的點。"""
    idx = {}
    for r in rows:
        if r["attendees"] and r["attendees"] >= MIN_ATTENDEES and r["notPassRate"] is not None:
            idx[(r["schoolCode"], r["grade"], r["year"], r["subject"])] = r["notPassRate"]

    pairs_out = []
    for i, a in enumerate(SUBJECTS):
        for b in SUBJECTS[i + 1:]:
            xs, ys = [], []
            for (sc, g, y, subj), v in idx.items():
                if subj != a:
                    continue
                other = idx.get((sc, g, y, b))
                if other is not None:
                    xs.append(v)
                    ys.append(other)
            if len(xs) < 20:
                pairs_out.append({"a": a, "b": b, "n": len(xs), "r": None})
                continue
            n = len(xs)
            mx, my = sum(xs) / n, sum(ys) / n
            sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
            sy = math.sqrt(sum((y - my) ** 2 for y in ys))
            cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
            r = cov / (sx * sy) if sx > 0 and sy > 0 else None
            pairs_out.append({
                "a": a, "b": b, "n": n, "r": r4(r),
                "scatter": [{"x": r4(x), "y": r4(y)} for x, y in zip(xs, ys)],
            })
    return pairs_out


# ────────────────────────────── 6. 學校規模效應 ──────────────────────────────
def size_effect(rows):
    """學校規模 vs 未通過率，並呈現小校的年度間波動（標準差）。"""
    size = defaultdict(int)
    for r in rows:
        if r["year"] == YEARS[-1] and r["subject"] == "國語文":
            size[r["schoolCode"]] += r["gradeStudents"] or 0

    out = {}
    for subj in SUBJECTS:
        per_school = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in rows:
            if r["subject"] == subj and r["attendees"]:
                b = per_school[r["schoolCode"]][r["year"]]
                b[0] += r["attendees"]
                b[1] += r["notPass"] or 0

        pts = []
        for sc, by_year in per_school.items():
            yearly = [rate(v[1], v[0]) for v in by_year.values() if v[0]]
            yearly = [v for v in yearly if v is not None]
            if not yearly or not size.get(sc):
                continue
            m = sum(yearly) / len(yearly)
            sd = (math.sqrt(sum((v - m) ** 2 for v in yearly) / (len(yearly) - 1))
                  if len(yearly) > 1 else None)
            name = next((r["schoolName"] for r in rows if r["schoolCode"] == sc and r["schoolName"]), sc)
            pts.append({
                "schoolCode": sc, "school": name, "size": size[sc],
                "rate": r4(m), "volatility": r4(sd), "years": len(yearly),
            })

        # 依規模分組，看是否存在規模效應
        bins = [(0, 30, "極小型 (<30人)"), (30, 100, "小型 (30-99)"),
                (100, 300, "中型 (100-299)"), (300, 10 ** 6, "大型 (300+)")]
        grouped = []
        for lo, hi, label in bins:
            g = [p for p in pts if lo <= p["size"] < hi]
            if not g:
                continue
            vols = [p["volatility"] for p in g if p["volatility"] is not None]
            grouped.append({
                "label": label, "schools": len(g),
                "rate": r4(sum(p["rate"] for p in g) / len(g)),
                "volatility": r4(sum(vols) / len(vols)) if vols else None,
            })
        out[subj] = {"points": sorted(pts, key=lambda p: p["size"]), "bins": grouped}
    return out


# ────────────────────────────── 7. 與全國落差 ──────────────────────────────
def national_gap(rows):
    """縣 vs 全國。113 年原始檔未填全國值，該年標為缺值。"""
    out = {}
    for subj in SUBJECTS:
        series = []
        for y in YEARS:
            sel = [r for r in rows if r["year"] == y and r["subject"] == subj]
            a, n = agg(sel)
            county = rate(n, a)
            # 全國率為各年級共同值，用到考人數加權還原全縣對應的全國水準
            nat_num = sum((r["nationalRate"] or 0) * (r["attendees"] or 0)
                          for r in sel if r["nationalRate"] is not None)
            nat_den = sum(r["attendees"] or 0 for r in sel if r["nationalRate"] is not None)
            national = nat_num / nat_den if nat_den else None
            series.append({
                "year": y,
                "county": r4(county),
                "national": r4(national),
                "gap": r4(county - national) if (county is not None and national is not None) else None,
            })
        out[subj] = series
    return out


# ────────────────────────────── 8. 校級風險評分與預警名單 ──────────────────────────────
def school_risk(rows, trend):
    """經驗貝氏收縮 + 趨勢，產生下一學年的風險排序。

    收縮後率 = (未通過人數 + K × 縣平均) / (到考人數 + K)
    小校因樣本少會被拉回縣平均，避免「3 人有 1 人未通過 = 33%」這種假訊號。
    """
    out = {}
    for subj in SUBJECTS:
        county_by_year = {}
        for y in YEARS:
            a, n = agg([r for r in rows if r["year"] == y and r["subject"] == subj])
            county_by_year[y] = rate(n, a)

        per = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        meta = {}
        for r in rows:
            if r["subject"] == subj and r["attendees"]:
                b = per[r["schoolCode"]][r["year"]]
                b[0] += r["attendees"]
                b[1] += r["notPass"] or 0
                if r["schoolName"]:
                    meta[r["schoolCode"]] = (r["schoolName"], r["district"])

        items = []
        for sc, by_year in per.items():
            name, district = meta.get(sc, (sc, None))
            yearly = []
            above = 0
            for y in YEARS:
                if y not in by_year or not by_year[y][0]:
                    continue
                a, n = by_year[y]
                cy = county_by_year[y] or 0
                raw = n / a
                shrunk = (n + SHRINK_K * cy) / (a + SHRINK_K)
                if raw > cy:
                    above += 1
                yearly.append({"year": y, "raw": r4(raw), "shrunk": r4(shrunk),
                               "attendees": a, "county": r4(cy)})
            if len(yearly) < 3:
                continue
            fit = linfit([p["year"] for p in yearly], [p["shrunk"] for p in yearly])
            yhat, lo, hi = predict(fit, FORECAST_YEAR)
            latest = yearly[-1]["shrunk"]
            items.append({
                "schoolCode": sc, "school": name, "district": district,
                "yearsObserved": len(yearly),
                "yearsAboveCounty": above,
                "latestShrunk": r4(latest),
                "latestRaw": yearly[-1]["raw"],
                "latestAttendees": yearly[-1]["attendees"],
                "slopePerYear": r4(fit["slope"]) if fit else None,
                "forecast": r4(yhat),
                "forecastLo": r4(lo),
                "forecastHi": r4(hi),
                "series": yearly,
            })

        # 風險分數：以收縮後預測值為主軸（已含趨勢），持續落後再加權
        for it in items:
            base = it["forecast"] if it["forecast"] is not None else it["latestShrunk"]
            persist = it["yearsAboveCounty"] / it["yearsObserved"]
            it["riskScore"] = r4(max(0.0, min(1.0, base)) * (0.75 + 0.25 * persist))
        items.sort(key=lambda x: -(x["riskScore"] or 0))
        out[subj] = items
    return out


def persistent_underperformers(risk):
    """跨科目整合：連續多年高於縣平均的學校。"""
    agg_map = defaultdict(lambda: {"subjects": {}, "school": None, "district": None})
    for subj, items in risk.items():
        for it in items:
            e = agg_map[it["schoolCode"]]
            e["school"] = it["school"]
            e["district"] = it["district"]
            e["subjects"][subj] = {
                "yearsAboveCounty": it["yearsAboveCounty"],
                "yearsObserved": it["yearsObserved"],
                "riskScore": it["riskScore"],
            }
    out = []
    for sc, e in agg_map.items():
        total_above = sum(v["yearsAboveCounty"] for v in e["subjects"].values())
        total_obs = sum(v["yearsObserved"] for v in e["subjects"].values())
        scores = [v["riskScore"] for v in e["subjects"].values() if v["riskScore"] is not None]
        out.append({
            "schoolCode": sc, "school": e["school"], "district": e["district"],
            "aboveCountyRatio": r4(total_above / total_obs) if total_obs else None,
            "totalAbove": total_above, "totalObserved": total_obs,
            "meanRisk": r4(sum(scores) / len(scores)) if scores else None,
            "subjects": e["subjects"],
        })
    out.sort(key=lambda x: (-(x["aboveCountyRatio"] or 0), -(x["meanRisk"] or 0)))
    return out


def main():
    rows = json.loads((OUT / "remedial.json").read_text(encoding="utf-8"))

    trend = county_trend_and_forecast(rows)
    risk = school_risk(rows, trend)

    data = {
        "meta": {
            "years": YEARS,
            "forecastYear": FORECAST_YEAR,
            "subjects": SUBJECTS,
            "shrinkK": SHRINK_K,
            "minAttendees": MIN_ATTENDEES,
            "notes": {
                "attendance": "到考率 111 學年 99.6%、112-115 學年皆 100%，故未另做缺考分析。",
                "national": "113 學年原始檔未填全國未通過率，該年全國值與落差標為缺值。",
                "english": "英語自 3 年級起施測，1-2 年級不列入。",
                "schoolType": "全縣 51 校皆為「特定地區學校」，無對照組，故不做學校屬性比較；"
                              "另以「會考待加強學校」標記單獨呈現。",
            },
        },
        "countyTrend": trend,
        "gradeProfile": grade_profile(rows),
        "district": district_analysis(rows),
        "cohorts": cohort_tracking(rows),
        "correlation": subject_correlation(rows),
        "sizeEffect": size_effect(rows),
        "nationalGap": national_gap(rows),
        "risk": risk,
        "persistent": persistent_underperformers(risk),
    }

    (OUT / "analytics.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )
    size_kb = (OUT / "analytics.json").stat().st_size / 1024
    print(f"analytics.json 已產生（{size_kb:.0f} KB）")
    for subj in SUBJECTS:
        t = trend[subj]
        f = t["forecast"]
        sl = t["trend"]["slopePerYear"] if t["trend"] else None
        print(f"  {subj}: 115={t['series'][-1]['rate']:.1%} "
              f"趨勢={sl:+.4f}/年 r2={t['trend']['r2']:.2f} "
              f"→ 116推估={f['rate']:.1%} [{f['lo']:.1%}, {f['hi']:.1%}]")
    print(f"  風險名單（數學前3）: "
          + ", ".join(f"{i['school']}({i['riskScore']:.2f})" for i in risk['數學'][:3]))


if __name__ == "__main__":
    main()
