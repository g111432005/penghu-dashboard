# -*- coding: utf-8 -*-
"""
從 public/data/remedial.json 預先計算所有分析結果。
Run: python scripts/analyze_remedial.py
Output: public/data/analytics.json

全部統計在此離線完成，前端只負責呈現；瀏覽器不做迴歸/相關係數運算。
每個估計都附帶不確定性（R²、預測區間、回測誤差），不輸出沒有脈絡的點估計。
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

# 單一學校低於此應考人數時，不列入校際比較（個位數學生的比率無統計意義）
MIN_REGISTERED = 10


def denom(r):
    """未通過率的分母採應考人數，與原始檔【縣市】年級未通過率的定義一致。
    112–115 學年到考率 100%，應考=到考；111 學年有 13 筆缺考，
    唯有用應考人數才能重現官方公布的縣值（已由 validate_remedial.py 驗證）。"""
    return r.get("testTakers") or r.get("attendees") or 0


def rate(not_pass, registered):
    return not_pass / registered if registered else None


def agg(rows):
    """(應考人數合計, 未通過人數合計)；自動忽略 None。"""
    d = sum(denom(r) for r in rows)
    n = sum(r["notPass"] or 0 for r in rows)
    return d, n


def has_data(r):
    return bool(r["attendees"]) and denom(r) > 0


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
    se = math.sqrt(ss_res / (n - 2)) if n > 2 else None
    return {"slope": slope, "intercept": intercept, "r2": r2, "se": se,
            "mx": mx, "sxx": sxx, "n": n}


# t 分布 97.5 分位（雙尾 95%），對應自由度 1..6
T_CRIT = {1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45}


def predict(fit, x):
    """點估計 + 95% 預測區間（依實際自由度選 t 臨界值）。"""
    if not fit:
        return None, None, None
    y = fit["intercept"] + fit["slope"] * x
    if fit["se"] is None:
        return y, None, None
    sp = fit["se"] * math.sqrt(1 + 1 / fit["n"] + (x - fit["mx"]) ** 2 / fit["sxx"])
    t = T_CRIT.get(fit["n"] - 2, 2.45)
    half = t * sp
    return y, max(0.0, y - half), min(1.0, y + half)


def r4(v):
    return None if v is None else round(v, 4)


# ───────────────── 收縮強度 K：由資料估計，而非寫死 ─────────────────
def estimate_shrink_k(obs, p):
    """Beta-Binomial 動差估計：K = p(1-p)/τ²，τ² 為扣除二項抽樣變異後的校間真實變異。

    obs: [(應考人數, 未通過人數), ...]；p: 縣平均未通過率。
    直覺：若各校差異大多能用「抽樣運氣」解釋（τ² 小），K 就大、收縮強；
    若校間確實存在真實差距（τ² 大），K 就小、保留各校原貌。
    """
    pts = [(n, x) for n, x in obs if n and n > 0]
    if len(pts) < 5 or not p or p <= 0 or p >= 1:
        return None, None
    N = len(pts)
    obs_var = sum((x / n - p) ** 2 for n, x in pts) / (N - 1)
    exp_binom = sum(p * (1 - p) / n for n, _ in pts) / N
    tau2 = obs_var - exp_binom
    if tau2 <= 0:
        # 校間差異完全可由抽樣解釋 => 極強收縮
        return 500.0, 0.0
    return p * (1 - p) / tau2, tau2


# ───────────────── 1. 縣級趨勢與預測 ─────────────────
def county_trend_and_forecast(rows):
    out = {}
    for subj in SUBJECTS:
        series = []
        for y in YEARS:
            sel = [r for r in rows if r["year"] == y and r["subject"] == subj and has_data(r)]
            d, n = agg(sel)
            # 原始檔的官方縣值（各年級共同值，以應考人數加權還原全科水準）
            off_num = sum((r["countyRate"] or 0) * denom(r) for r in sel if r["countyRate"] is not None)
            off_den = sum(denom(r) for r in sel if r["countyRate"] is not None)
            series.append({
                "year": y,
                "registered": d,
                "notPass": n,
                "rate": r4(rate(n, d)),
                "officialRate": r4(off_num / off_den) if off_den else None,
            })
        pts = [(s["year"], s["rate"]) for s in series if s["rate"] is not None]
        fit = linfit([p[0] for p in pts], [p[1] for p in pts]) if len(pts) >= 3 else None
        yhat, lo, hi = predict(fit, FORECAST_YEAR)
        out[subj] = {
            "series": series,
            "trend": {"slopePerYear": r4(fit["slope"]), "r2": r4(fit["r2"])} if fit else None,
            "forecast": {"year": FORECAST_YEAR, "rate": r4(yhat),
                         "lo": r4(lo), "hi": r4(hi)} if fit else None,
        }
    return out


# ───────────────── 2. 預測方法回測 ─────────────────
def backtest(rows):
    """用 111–114 配適、預測 115，與實際值比較。

    同時對照「沿用前一年數值」的樸素基準：若線性外推贏不過什麼都不做，
    就必須誠實說明這個預測方法在本資料上沒有加值。
    """
    train = YEARS[:-1]
    test = YEARS[-1]
    county = {}
    for subj in SUBJECTS:
        hist = []
        for y in YEARS:
            d, n = agg([r for r in rows if r["year"] == y and r["subject"] == subj and has_data(r)])
            hist.append((y, rate(n, d)))
        tr = [(y, v) for y, v in hist if y in train and v is not None]
        actual = dict(hist).get(test)
        fit = linfit([p[0] for p in tr], [p[1] for p in tr])
        pred, lo, hi = predict(fit, test)
        naive = tr[-1][1] if tr else None
        county[subj] = {
            "actual": r4(actual),
            "predicted": r4(pred),
            "naive": r4(naive),
            "error": r4(abs(pred - actual)) if (pred is not None and actual is not None) else None,
            "naiveError": r4(abs(naive - actual)) if (naive is not None and actual is not None) else None,
            "inInterval": bool(lo is not None and hi is not None and actual is not None
                               and lo <= actual <= hi),
        }

    # 校級回測：以收縮後數列配適，衡量排序用途的實際誤差
    school = {}
    for subj in SUBJECTS:
        county_by_year = {}
        for y in YEARS:
            d, n = agg([r for r in rows if r["year"] == y and r["subject"] == subj and has_data(r)])
            county_by_year[y] = rate(n, d)

        per = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in rows:
            if r["subject"] == subj and has_data(r):
                b = per[r["schoolCode"]][r["year"]]
                b[0] += denom(r)
                b[1] += r["notPass"] or 0

        obs_latest = [(v[test][0], v[test][1]) for v in per.values() if test in v and v[test][0]]
        k, _ = estimate_shrink_k(obs_latest, county_by_year[test])
        k = k or 40.0

        errs, naive_errs, covered, total = [], [], 0, 0
        for sc, by_year in per.items():
            tr = [(y, (by_year[y][1] + k * (county_by_year[y] or 0)) / (by_year[y][0] + k))
                  for y in train if y in by_year and by_year[y][0]]
            if len(tr) < 3 or test not in by_year or not by_year[test][0]:
                continue
            actual = ((by_year[test][1] + k * (county_by_year[test] or 0))
                      / (by_year[test][0] + k))
            fit = linfit([p[0] for p in tr], [p[1] for p in tr])
            pred, lo, hi = predict(fit, test)
            if pred is None:
                continue
            errs.append(abs(pred - actual))
            naive_errs.append(abs(tr[-1][1] - actual))
            total += 1
            if lo is not None and hi is not None and lo <= actual <= hi:
                covered += 1
        school[subj] = {
            "n": total,
            "mae": r4(sum(errs) / len(errs)) if errs else None,
            "naiveMae": r4(sum(naive_errs) / len(naive_errs)) if naive_errs else None,
            "coverage": r4(covered / total) if total else None,
            "shrinkK": r4(k),
        }

    return {"trainYears": train, "testYear": test, "county": county, "school": school}


# ───────────────── 3. 年級斷點 ─────────────────
def grade_profile(rows):
    out = {}
    for subj in SUBJECTS:
        prof = []
        for g in range(1, 9):
            if (subj, g) in NO_TEST:
                continue
            d, n = agg([r for r in rows if r["subject"] == subj and r["grade"] == g and has_data(r)])
            prof.append({"grade": g, "registered": d, "rate": r4(rate(n, d))})
        for i, p in enumerate(prof):
            prev = prof[i - 1]["rate"] if i > 0 else None
            p["delta"] = r4(p["rate"] - prev) if (prev is not None and p["rate"] is not None) else None
        out[subj] = prof
    return out


# ───────────────── 4. 行政區落差 ─────────────────
def district_analysis(rows):
    districts = sorted({r["district"] for r in rows if r["district"]})
    out = {"districts": districts, "bySubject": {}}
    for subj in SUBJECTS:
        per = []
        for dist in districts:
            years = []
            for y in YEARS:
                d, n = agg([r for r in rows if r["district"] == dist
                            and r["subject"] == subj and r["year"] == y and has_data(r)])
                years.append({"year": y, "rate": r4(rate(n, d)), "registered": d})
            d, n = agg([r for r in rows if r["district"] == dist
                        and r["subject"] == subj and has_data(r)])
            per.append({"district": dist, "rate": r4(rate(n, d)), "registered": d, "years": years})
        per.sort(key=lambda x: -(x["rate"] or 0))
        out["bySubject"][subj] = per
    return out


# ───────────────── 5. 世代追蹤 ─────────────────
def cohort_tracking(rows):
    """cohort = year - grade，同一群學生每年升一個年級。"""
    out = {}
    for subj in SUBJECTS:
        buckets = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in rows:
            if r["subject"] != subj or not has_data(r):
                continue
            b = buckets[r["year"] - r["grade"]][r["grade"]]
            b[0] += denom(r)
            b[1] += r["notPass"] or 0
        cohorts = []
        for c in sorted(buckets):
            pts = [{"grade": g, "year": c + g, "registered": buckets[c][g][0],
                    "rate": r4(rate(buckets[c][g][1], buckets[c][g][0]))}
                   for g in sorted(buckets[c])]
            if len(pts) >= 3:
                sizes = [p["registered"] for p in pts]
                cohorts.append({
                    "cohort": c,
                    "points": pts,
                    # 人數變動幅度：追蹤是否成立的前提，一併輸出供前端揭露
                    "sizeVariation": r4((max(sizes) - min(sizes)) / max(sizes)) if sizes else None,
                })
        out[subj] = cohorts
    return out


# ───────────────── 6. 科目間相關 ─────────────────
def subject_correlation(rows):
    idx = {}
    for r in rows:
        if has_data(r) and denom(r) >= MIN_REGISTERED and r["notPassRate"] is not None:
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
            # Fisher z 轉換求 95% 信賴區間
            ci = None
            if r is not None and abs(r) < 1 and n > 3:
                z = 0.5 * math.log((1 + r) / (1 - r))
                se = 1 / math.sqrt(n - 3)
                lo, hi = z - 1.96 * se, z + 1.96 * se
                ci = [r4(math.tanh(lo)), r4(math.tanh(hi))]
            pairs_out.append({
                "a": a, "b": b, "n": n, "r": r4(r), "ci": ci,
                "scatter": [{"x": r4(x), "y": r4(y)} for x, y in zip(xs, ys)],
            })
    return pairs_out


# ───────────────── 7. 學校規模效應 ─────────────────
def size_effect(rows):
    size = defaultdict(int)
    for r in rows:
        if r["year"] == YEARS[-1] and r["subject"] == "國語文":
            size[r["schoolCode"]] += r["gradeStudents"] or 0

    out = {}
    for subj in SUBJECTS:
        per_school = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for r in rows:
            if r["subject"] == subj and has_data(r):
                b = per_school[r["schoolCode"]][r["year"]]
                b[0] += denom(r)
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
            name = next((r["schoolName"] for r in rows
                         if r["schoolCode"] == sc and r["schoolName"]), sc)
            pts.append({"schoolCode": sc, "school": name, "size": size[sc],
                        "rate": r4(m), "volatility": r4(sd), "years": len(yearly)})

        bins = [(0, 30, "極小型 (<30人)"), (30, 100, "小型 (30-99)"),
                (100, 300, "中型 (100-299)"), (300, 10 ** 6, "大型 (300+)")]
        grouped = []
        for lo, hi, label in bins:
            g = [p for p in pts if lo <= p["size"] < hi]
            if not g:
                continue
            vols = [p["volatility"] for p in g if p["volatility"] is not None]
            grouped.append({"label": label, "schools": len(g),
                            "rate": r4(sum(p["rate"] for p in g) / len(g)),
                            "volatility": r4(sum(vols) / len(vols)) if vols else None})
        out[subj] = {"points": sorted(pts, key=lambda p: p["size"]), "bins": grouped}
    return out


# ───────────────── 8. 與全國落差 ─────────────────
def national_gap(rows):
    """113 年原始檔未填全國值，該年標為缺值。"""
    out = {}
    for subj in SUBJECTS:
        series = []
        for y in YEARS:
            sel = [r for r in rows if r["year"] == y and r["subject"] == subj and has_data(r)]
            d, n = agg(sel)
            county = rate(n, d)
            nat_num = sum((r["nationalRate"] or 0) * denom(r)
                          for r in sel if r["nationalRate"] is not None)
            nat_den = sum(denom(r) for r in sel if r["nationalRate"] is not None)
            national = nat_num / nat_den if nat_den else None
            series.append({
                "year": y, "county": r4(county), "national": r4(national),
                "gap": r4(county - national) if (county is not None and national is not None) else None,
            })
        out[subj] = series
    return out


# ───────────────── 9. 校級風險評分 ─────────────────
def school_risk(rows):
    out, k_used = {}, {}
    for subj in SUBJECTS:
        county_by_year = {}
        for y in YEARS:
            d, n = agg([r for r in rows if r["year"] == y and r["subject"] == subj and has_data(r)])
            county_by_year[y] = rate(n, d)

        per = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        meta = {}
        for r in rows:
            if r["subject"] == subj and has_data(r):
                b = per[r["schoolCode"]][r["year"]]
                b[0] += denom(r)
                b[1] += r["notPass"] or 0
                if r["schoolName"]:
                    meta[r["schoolCode"]] = (r["schoolName"], r["district"])

        latest = YEARS[-1]
        obs = [(v[latest][0], v[latest][1]) for v in per.values()
               if latest in v and v[latest][0]]
        k, tau2 = estimate_shrink_k(obs, county_by_year[latest])
        k = k or 40.0
        k_used[subj] = {"k": r4(k), "tau2": r4(tau2), "schools": len(obs)}

        items = []
        for sc, by_year in per.items():
            name, district = meta.get(sc, (sc, None))
            yearly, above = [], 0
            for y in YEARS:
                if y not in by_year or not by_year[y][0]:
                    continue
                d, n = by_year[y]
                cy = county_by_year[y] or 0
                raw = n / d
                shrunk = (n + k * cy) / (d + k)
                if raw > cy:
                    above += 1
                yearly.append({"year": y, "raw": r4(raw), "shrunk": r4(shrunk),
                               "registered": d, "county": r4(cy)})
            if len(yearly) < 3:
                continue
            fit = linfit([p["year"] for p in yearly], [p["shrunk"] for p in yearly])
            yhat, lo, hi = predict(fit, FORECAST_YEAR)
            items.append({
                "schoolCode": sc, "school": name, "district": district,
                "yearsObserved": len(yearly), "yearsAboveCounty": above,
                "latestShrunk": r4(yearly[-1]["shrunk"]),
                "latestRaw": yearly[-1]["raw"],
                "latestRegistered": yearly[-1]["registered"],
                "slopePerYear": r4(fit["slope"]) if fit else None,
                "forecast": r4(yhat), "forecastLo": r4(lo), "forecastHi": r4(hi),
                "series": yearly,
            })

        # 風險分數以「最新收縮值」為基準，而非線性外推的 116 推估：
        # 回測（見 backtest）顯示線性外推在本資料上六項比較全數輸給
        # 「沿用最新值」的樸素基準，因此不應讓它主導排序。
        # 趨勢仍一併輸出，但只作為人工研判的佐證欄位，不計入分數。
        for it in items:
            base = it["latestShrunk"]
            persist = it["yearsAboveCounty"] / it["yearsObserved"]
            it["riskScore"] = r4(max(0.0, min(1.0, base)) * (0.75 + 0.25 * persist))
        items.sort(key=lambda x: -(x["riskScore"] or 0))
        out[subj] = items
    return out, k_used


def persistent_underperformers(risk):
    agg_map = defaultdict(lambda: {"subjects": {}, "school": None, "district": None})
    for subj, items in risk.items():
        for it in items:
            e = agg_map[it["schoolCode"]]
            e["school"] = it["school"]
            e["district"] = it["district"]
            e["subjects"][subj] = {"yearsAboveCounty": it["yearsAboveCounty"],
                                   "yearsObserved": it["yearsObserved"],
                                   "riskScore": it["riskScore"]}
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


# ───────────────── 對帳摘要（供前端揭露） ─────────────────
def reconciliation(rows):
    import statistics
    per_year = defaultdict(list)
    for y in YEARS:
        for g in range(1, 9):
            for s in SUBJECTS:
                sel = [r for r in rows if r["year"] == y and r["grade"] == g
                       and r["subject"] == s and has_data(r)]
                if not sel or sel[0]["countyRate"] is None:
                    continue
                d, n = agg(sel)
                if d:
                    per_year[y].append(abs(n / d - sel[0]["countyRate"]))
    return [{"year": y,
             "groups": len(v),
             "maxDiffPP": r4(max(v) * 100),
             "medianDiffPP": r4(statistics.median(v) * 100)}
            for y, v in sorted(per_year.items()) if v]


def main():
    rows = json.loads((OUT / "remedial.json").read_text(encoding="utf-8"))

    trend = county_trend_and_forecast(rows)
    risk, k_used = school_risk(rows)
    bt = backtest(rows)

    data = {
        "meta": {
            "years": YEARS,
            "forecastYear": FORECAST_YEAR,
            "subjects": SUBJECTS,
            "minRegistered": MIN_REGISTERED,
            "shrinkK": k_used,
            "denominator": "應考人數（與原始檔【縣市】年級未通過率定義一致）",
            "notes": {
                "denominator": "未通過率分母採應考人數。112–115 學年到考率 100%，"
                               "應考等於到考；111 學年有 13 筆缺考，用應考人數才能重現官方縣值。",
                "attendance": "到考率 111 學年 99.6%、112–115 學年皆 100%，故未另做缺考分析。",
                "national": "113 學年原始檔未填全國未通過率（整欄為 0），該年全國值與落差標為缺值。",
                "english": "英語自 3 年級起施測，1–2 年級不列入。",
                "schoolType": "全縣各校皆為「特定地區學校」，無對照組，故不做學校屬性比較。",
                "roster111": "111 學年各校明細與全縣彙總出自略有出入的名冊快照，"
                             "同一年級內三科差額一致，最多 9 人（約 1.6%）。",
            },
        },
        "reconciliation": reconciliation(rows),
        "backtest": bt,
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

    (OUT / "analytics.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"analytics.json 已產生（{(OUT / 'analytics.json').stat().st_size / 1024:.0f} KB）")

    print("\n縣級趨勢與推估:")
    for s in SUBJECTS:
        t = trend[s]
        f, tr = t["forecast"], t["trend"]
        print(f"  {s}: 115={t['series'][-1]['rate']:.1%} 趨勢={tr['slopePerYear']:+.4f}/年 "
              f"r2={tr['r2']:.2f} -> 116={f['rate']:.1%} [{f['lo']:.1%}, {f['hi']:.1%}]")

    print(f"\n回測（以 {bt['trainYears'][0]}–{bt['trainYears'][-1]} 預測 {bt['testYear']}）:")
    for s in SUBJECTS:
        c, sc = bt["county"][s], bt["school"][s]
        print(f"  {s} 縣級: 實際={c['actual']:.1%} 預測={c['predicted']:.1%} "
              f"(誤差 {c['error']*100:.2f}pp) vs 樸素基準 {c['naiveError']*100:.2f}pp "
              f"{'[預測較佳]' if c['error'] < c['naiveError'] else '[樸素較佳]'}")
        print(f"  {s} 校級: n={sc['n']} MAE={sc['mae']*100:.2f}pp "
              f"vs 樸素 {sc['naiveMae']*100:.2f}pp, 區間涵蓋率={sc['coverage']:.0%}, K={sc['shrinkK']}")

    print("\n收縮強度 K（由資料估計）:")
    for s in SUBJECTS:
        print(f"  {s}: K={k_used[s]['k']} (校間真實變異 tau2={k_used[s]['tau2']}, "
              f"{k_used[s]['schools']} 校)")


if __name__ == "__main__":
    main()
