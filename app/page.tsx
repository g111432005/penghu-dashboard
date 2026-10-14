'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  School, Users, AlertTriangle, TrendingUp, LayoutGrid, Table as TableIcon, Loader2,
  BookOpen, Layers, Map as MapIcon, Siren, GitCompare, Baby,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter, ErrorBar,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
  ReferenceLine,
} from 'recharts'
import {
  fetchRemedial, fetchRemedialSummary, fetchAnalytics,
  RemedialRow, RemedialSummaryRow, Analytics, Subject,
  SUBJECT_COLOR, YEAR_RAMP,
} from '../lib/data'

const SUBJECTS: Subject[] = ['國語文', '數學', '英語']

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`
/* 百分點（用於差值與斜率，避免與「百分比的百分比」混淆） */
const fmtPP = (v: number | null | undefined, sign = true) =>
  v == null ? '—' : `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pp`

const gradeLabel = (g: number) => (g <= 6 ? `國小${g}` : `國中${g - 6}`)

/* y 軸上限：取資料最大值往上取整到 10%，至少 0.2 */
const topDomain = (max: number) => Math.max(0.2, Math.ceil(max * 10) / 10)

/* 有序變數（世代、年度）用的連續色階：在淺藍與深藍之間插出 n 個互異色階。
   直接取 YEAR_RAMP 的 5 個固定階會在 n > 5 時讓兩條線撞色，故改為內插。 */
function rampColors(n: number): string[] {
  const from = [125, 211, 252]  // #7dd3fc
  const to = [11, 61, 89]       // #0b3d59
  if (n <= 1) return [`rgb(${to.join(',')})`]
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return `rgb(${from.map((f, k) => Math.round(f + (to[k] - f) * t)).join(',')})`
  })
}

function ChartNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-3 p-3 bg-cyan-50 rounded-lg text-sm text-slate-600 leading-relaxed">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 border border-amber-100 rounded-lg
      text-sm text-amber-900 leading-relaxed">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function KpiCard({ label, value, sub, color = '#0b3d59', icon }:
  { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 rounded-full -mr-8 -mt-8 opacity-[0.07]"
        style={{ background: color }} />
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}1a`, color }}>
            {icon}
          </span>
        )}
      </div>
      <span className="stat-value" style={{ color }}>{value}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </div>
  )
}

function SubjectPicker({ value, onChange }: { value: Subject; onChange: (s: Subject) => void }) {
  return (
    <div className="flex gap-2 items-center">
      <span className="text-sm text-slate-500 mr-1">科目</span>
      {SUBJECTS.map(s => (
        <button key={s} onClick={() => onChange(s)}
          className={`tab-btn ${value === s ? 'active' : ''}`}>
          <span className="w-2 h-2 rounded-full" style={{ background: SUBJECT_COLOR[s] }} />
          {s}
        </button>
      ))}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-ph-navy mb-4">{title}</h3>
      {children}
    </div>
  )
}

const TABS = [
  '總覽', '跨年趨勢', '年級斷點', '世代追蹤', '城鄉落差', '學校比較', '風險預警', '關聯分析', '明細表',
] as const
type Tab = typeof TABS[number]
const ic = 'w-3.5 h-3.5'
const TAB_ICON: Record<Tab, React.ReactNode> = {
  '總覽': <LayoutGrid className={ic} />,
  '跨年趨勢': <TrendingUp className={ic} />,
  '年級斷點': <Layers className={ic} />,
  '世代追蹤': <Baby className={ic} />,
  '城鄉落差': <MapIcon className={ic} />,
  '學校比較': <School className={ic} />,
  '風險預警': <Siren className={ic} />,
  '關聯分析': <GitCompare className={ic} />,
  '明細表': <TableIcon className={ic} />,
}

/* ══════════════════════ 總覽 ══════════════════════ */
function OverviewTab({ an, remedial }: { an: Analytics; remedial: RemedialRow[] }) {
  const years = an.meta.years
  const latest = years[years.length - 1]
  const schools = new Set(
    remedial.filter(r => r.year === latest && r.schoolCode).map(r => r.schoolCode)
  ).size
  const students = remedial
    .filter(r => r.year === latest && r.subject === '國語文')
    .reduce((s, r) => s + (r.gradeStudents ?? 0), 0)

  const bySubject = SUBJECTS.map(s => {
    const ser = an.countyTrend[s].series
    return { subject: s, rate: ser[ser.length - 1].rate }
  })
  const worst = bySubject.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a))

  /* 重點發現：全部由資料推導，不寫死 */
  const findings = useMemo(() => {
    const out: string[] = []
    out.push(`${latest} 學年未通過率最高的是「${worst.subject}」（${fmtPct(worst.rate)}），`
      + `約為國語文的 ${((worst.rate ?? 0) / (bySubject[0].rate || 1)).toFixed(1)} 倍。`)

    const rising = SUBJECTS.filter(s => (an.countyTrend[s].trend?.slopePerYear ?? 0) > 0)
    if (rising.length) {
      out.push(`五年間呈上升（惡化）趨勢的科目：${rising
        .map(s => `${s} ${fmtPP(an.countyTrend[s].trend!.slopePerYear)}/學年`).join('、')}。`)
    }

    // 最大年級斷點
    const allJumps = SUBJECTS.flatMap(s =>
      an.gradeProfile[s]
        .filter(p => p.delta != null)
        .map(p => ({ subject: s, grade: p.grade, delta: p.delta as number }))
    )
    const jump = allJumps.length
      ? allJumps.reduce((a, b) => (b.delta > a.delta ? b : a))
      : null
    if (jump) {
      out.push(`年級斷點最明顯之處為${jump.subject}的${gradeLabel(jump.grade)}，`
        + `較前一年級跳升 ${fmtPP(jump.delta, false)}，是介入時機的關鍵點。`)
    }

    // 行政區落差
    const d = an.district.bySubject[worst.subject as Subject]
    if (d.length >= 2) {
      const hi = d[0], lo = d[d.length - 1]
      out.push(`${worst.subject}的區域落差達 ${fmtPP((hi.rate ?? 0) - (lo.rate ?? 0), false)}：`
        + `${hi.district} ${fmtPct(hi.rate)} vs ${lo.district} ${fmtPct(lo.rate)}。`)
    }

    // 世代惡化
    const coh = an.cohorts[worst.subject as Subject].filter(c => c.points.length >= 4)
    const deltas = coh.map(c => (c.points[c.points.length - 1].rate ?? 0) - (c.points[0].rate ?? 0))
    if (deltas.length) {
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
      out.push(`追蹤同一屆學生，${worst.subject}未通過率平均隨年級上升 `
        + `${fmtPP(mean, false)}（${coh.length} 個世代），顯示落差會隨學程累積。`)
    }
    return out
  }, [an, latest, worst, bySubject])

  const maxRate = Math.max(...bySubject.map(b => b.rate ?? 0))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="學校數" value={`${schools} 校`} color="#0b3d59"
          icon={<School className="w-4 h-4" />} />
        <KpiCard label={`${latest}學年學生數`} value={`${students.toLocaleString()} 人`}
          color="#0891b2" icon={<Users className="w-4 h-4" />} />
        <KpiCard label="最高未通過率科目" value={worst.subject} sub={fmtPct(worst.rate)}
          color={SUBJECT_COLOR[worst.subject]} icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiCard label="資料年度" value={`${years[0]}–${latest}`} sub="學習扶助篩選測驗"
          color="#0b3d59" icon={<BookOpen className="w-4 h-4" />} />
      </div>

      <Card title={`${latest}學年 全縣各科未通過率`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bySubject} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, topDomain(maxRate)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [fmtPct(v), '未通過率']} />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={72}>
              {bySubject.map(r => <Cell key={r.subject} fill={SUBJECT_COLOR[r.subject]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartNote>
          依各年級到考人數加權平均。英語自 3 年級起施測，1–2 年級不列入計算。
        </ChartNote>
      </Card>

      <Card title="重點發現">
        <ul className="space-y-2.5">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-ph-navy/10 text-ph-navy
                text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="資料涵蓋範圍與限制">
        <ul className="space-y-2 text-sm text-slate-600 leading-relaxed list-disc pl-5">
          {Object.values(an.meta.notes).map((n, i) => <li key={i}>{n}</li>)}
          <li>
            僅 5 個學年度的觀測點，時間序列預測的不確定性大；校級推估僅供排序參考，
            不應視為精確數值（詳見「風險預警」頁的說明）。
          </li>
        </ul>
      </Card>
    </div>
  )
}

/* ══════════════════════ 跨年趨勢（含 116 推估、全國比較） ══════════════════════ */
function TrendTab({ an, summary }: { an: Analytics; summary: RemedialSummaryRow[] }) {
  const [subject, setSubject] = useState<Subject>('數學')
  const ct = an.countyTrend[subject]
  const fc = ct.forecast
  const color = SUBJECT_COLOR[subject]

  /* 實際線 111-115，推估線自 115 延伸到 116（虛線），116 點附預測區間 */
  const fcData = useMemo(() => {
    const rows: any[] = ct.series.map((s, i) => ({
      year: s.year,
      actual: s.rate,
      forecast: i === ct.series.length - 1 ? s.rate : null,
    }))
    if (fc?.rate != null) {
      rows.push({
        year: fc.year,
        actual: null,
        forecast: fc.rate,
        err: [fc.rate - (fc.lo ?? fc.rate), (fc.hi ?? fc.rate) - fc.rate],
      })
    }
    return rows
  }, [ct, fc])

  const gap = an.nationalGap[subject]
  const gapMax = Math.max(...gap.flatMap(g => [g.county ?? 0, g.national ?? 0]))
  const fcMax = Math.max(...fcData.map(d => Math.max(d.actual ?? 0, (d.forecast ?? 0) + (d.err?.[1] ?? 0))))

  const r2 = ct.trend?.r2 ?? null
  const weak = r2 != null && r2 < 0.5

  const gradeData = useMemo(() => {
    const grades = Array.from(new Set(summary.filter(s => s.subject === subject).map(s => s.grade)))
      .sort((a, b) => a - b)
    return grades.map(g => {
      const row: any = { grade: gradeLabel(g) }
      an.meta.years.forEach(y => {
        const rec = summary.find(s => s.year === y && s.grade === g && s.subject === subject)
        row[`y${y}`] = rec?.notPassRate ?? null
      })
      return row
    })
  }, [summary, subject, an.meta.years])

  return (
    <div className="space-y-6">
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`全縣${subject}未通過率趨勢與 ${an.meta.forecastYear} 學年推估`}>
        <ResponsiveContainer width="100%" height={260}>
          {/* 右邊距讓 116 的推估點與誤差線不被切在圖表邊緣 */}
          <LineChart data={fcData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, topDomain(fcMax)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number, n) => [fmtPct(v), n === 'actual' ? '實際' : '推估']} />
            <Legend />
            <Line name="實際" type="monotone" dataKey="actual" stroke={color} strokeWidth={2}
              dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
            <Line name={`${an.meta.forecastYear} 推估`} type="monotone" dataKey="forecast"
              stroke={color} strokeWidth={2} strokeDasharray="5 4"
              dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} connectNulls>
              <ErrorBar dataKey="err" width={6} strokeWidth={1.5} stroke={color} direction="y" />
            </Line>
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-slate-600">
          <span>每學年變化：<b className="text-slate-800">{fmtPP(ct.trend?.slopePerYear)}</b></span>
          <span>R²：<b className="text-slate-800">{r2?.toFixed(2) ?? '—'}</b></span>
          <span>{an.meta.forecastYear} 推估：
            <b className="text-slate-800">{fmtPct(fc?.rate)}</b>
            <span className="text-slate-400"> [{fmtPct(fc?.lo)} – {fmtPct(fc?.hi)}]</span>
          </span>
        </div>
        {weak ? (
          <Caveat>
            R² 僅 {r2!.toFixed(2)}，代表「學年」只能解釋少部分變異，這條趨勢線的斜率不穩定；
            95% 預測區間寬達 {fmtPct(fc?.lo)}–{fmtPct(fc?.hi)}。此推估僅能視為
            「若維持現況的粗略延伸」，不足以作為單年目標值。
          </Caveat>
        ) : (
          <ChartNote>
            R² = {r2?.toFixed(2)}，趨勢相對穩定；誤差線為 95% 預測區間（5 個觀測點，df=3）。
          </ChartNote>
        )}
      </Card>

      <Card title={`${subject}：澎湖縣 vs 全國`}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={gap}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, topDomain(gapMax)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number, n) => [fmtPct(v), n as string]} />
            <Legend />
            <Line name="澎湖縣" type="monotone" dataKey="county" stroke={color} strokeWidth={2}
              dot={{ r: 4 }} connectNulls={false} />
            <Line name="全國" type="monotone" dataKey="national" stroke="#64748b" strokeWidth={2}
              strokeDasharray="4 3" dot={{ r: 4 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-2 text-sm text-slate-600">
          各年落差（澎湖 − 全國）：{gap.map(g => (
            <span key={g.year} className="inline-block mr-3">
              {g.year}:{' '}
              <b className={g.gap == null ? 'text-slate-400'
                : g.gap > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {g.gap == null ? '無資料' : fmtPP(g.gap)}
              </b>
            </span>
          ))}
        </div>
        <ChartNote>
          113 學年原始檔未填全國未通過率（整欄為 0），已標為缺值而非 0%，故該年斷線。
          正值代表澎湖高於全國。
        </ChartNote>
      </Card>

      <Card title={`各年級${subject}未通過率（依學年）`}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={gradeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="grade" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, 0.7]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number) => fmtPct(v)} />
            <Legend />
            {an.meta.years.map((y, i) => (
              <Line key={y} type="monotone" dataKey={`y${y}`} name={`${y}學年`}
                stroke={YEAR_RAMP[i]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <ChartNote>
          學年為有序變數，採同色相由淺到深（深色＝越近期）而非隨機配色，便於看出年度移動方向。
        </ChartNote>
      </Card>
    </div>
  )
}

/* ══════════════════════ 年級斷點 ══════════════════════ */
function GradeTab({ an }: { an: Analytics }) {
  const [subject, setSubject] = useState<Subject>('數學')
  const prof = an.gradeProfile[subject]
  const data = prof.map(p => ({ ...p, label: gradeLabel(p.grade) }))
  const maxRate = Math.max(...data.map(d => d.rate ?? 0))
  const maxAbsDelta = Math.max(...data.map(d => Math.abs(d.delta ?? 0)))
  const jumps = [...data].filter(d => d.delta != null)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 3)

  return (
    <div className="space-y-6">
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`${subject}各年級未通過率（111–115 學年合併）`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, topDomain(maxRate)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number, _n, p) =>
              [`${fmtPct(v)}（到考 ${p.payload.attendees.toLocaleString()} 人）`, '未通過率']} />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill={SUBJECT_COLOR[subject]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
        <ChartNote>
          五年合併可降低單年波動。到考人數已標於提示框，各年級約 2,500–3,000 人。
        </ChartNote>
      </Card>

      <Card title="相鄰年級的變化（找出惡化斷點）">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.filter(d => d.delta != null)} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[-topDomain(maxAbsDelta), topDomain(maxAbsDelta)]}
              tickFormatter={v => `${(v * 100).toFixed(0)}`}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: '百分點', angle: -90, position: 'insideLeft',
                style: { fill: '#94a3b8', fontSize: 11 } }} />
            <Tooltip formatter={(v: number) => [fmtPP(v), '較前一年級']} />
            <ReferenceLine y={0} stroke="#cbd5e1" />
            <Bar dataKey="delta" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {data.filter(d => d.delta != null).map(d => (
                <Cell key={d.grade} fill={(d.delta ?? 0) > 0 ? '#ef4444' : '#0d9488'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />惡化（較前一年級上升）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#0d9488' }} />改善（下降）
          </span>
        </div>
        <ChartNote>
          最大跳升：{jumps.map(j => `${j.label} ${fmtPP(j.delta)}`).join('、')}。
          正值代表該年級比前一年級更差，是學習落差擴大的斷點，適合作為提前介入的時機。
          {subject === '英語' && '（英語自 3 年級起施測，故無 1–2 年級與其變化。）'}
        </ChartNote>
      </Card>
    </div>
  )
}

/* ══════════════════════ 世代追蹤 ══════════════════════ */
function CohortTab({ an }: { an: Analytics }) {
  const [subject, setSubject] = useState<Subject>('數學')
  const cohorts = an.cohorts[subject].filter(c => c.points.length >= 4)

  /* x = 年級，一條線代表同一屆學生 */
  const data = useMemo(() => {
    const grades = Array.from(new Set(cohorts.flatMap(c => c.points.map(p => p.grade))))
      .sort((a, b) => a - b)
    return grades.map(g => {
      const row: any = { grade: gradeLabel(g) }
      cohorts.forEach(c => {
        row[`c${c.cohort}`] = c.points.find(p => p.grade === g)?.rate ?? null
      })
      return row
    })
  }, [cohorts])

  const deltas = cohorts.map(c => ({
    label: c.label,
    cohort: c.cohort,
    from: c.points[0],
    to: c.points[c.points.length - 1],
    delta: (c.points[c.points.length - 1].rate ?? 0) - (c.points[0].rate ?? 0),
  }))
  const meanDelta = deltas.length
    ? deltas.reduce((s, d) => s + d.delta, 0) / deltas.length : null
  const maxRate = Math.max(...cohorts.flatMap(c => c.points.map(p => p.rate ?? 0)))

  /* 世代是有序的，用同色相漸層；最新世代加粗以突顯當前最該關注的一屆 */
  const colors = rampColors(cohorts.length)

  return (
    <div className="space-y-6">
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`同一屆學生的${subject}未通過率變化（縱貫追蹤）`}>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="grade" tick={{ fill: '#475569', fontSize: 12 }} />
            <YAxis domain={[0, topDomain(maxRate)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip formatter={(v: number) => fmtPct(v)} />
            <Legend />
            {cohorts.map((c, i) => (
              <Line key={c.cohort} type="monotone" dataKey={`c${c.cohort}`}
                name={`${c.cohort + 1}年入學世代`}
                stroke={colors[i]} strokeWidth={i === cohorts.length - 1 ? 3 : 2}
                dot={{ r: 3.5 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <ChartNote>
          每條線是<b>同一群學生</b>（世代 = 學年 − 年級）逐年升級的軌跡，而非不同屆的橫向比較。
          各世代人數穩定（約 500–620 人），確認追蹤有效。只顯示有 4 年以上觀測的世代。
        </ChartNote>
      </Card>

      <Card title="各世代首末觀測的變化">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">世代</th>
                <th className="py-2 pr-4">起始</th>
                <th className="py-2 pr-4">最新</th>
                <th className="py-2 pr-4 text-right">起始未通過率</th>
                <th className="py-2 pr-4 text-right">最新未通過率</th>
                <th className="py-2 pr-4 text-right">變化</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map(d => (
                <tr key={d.cohort} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-4">{d.cohort + 1}年入學</td>
                  <td className="py-1.5 pr-4 text-slate-500">
                    {d.from.year}學年 {gradeLabel(d.from.grade)}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-500">
                    {d.to.year}學年 {gradeLabel(d.to.grade)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(d.from.rate)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(d.to.rate)}</td>
                  <td className={`py-1.5 pr-4 text-right tabular-nums font-medium
                    ${d.delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmtPP(d.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartNote>
          平均變化 <b>{fmtPP(meanDelta)}</b>。
          {(meanDelta ?? 0) > 0
            ? '正值代表同一屆學生隨年級升高，未通過率反而惡化 — 落差隨學程累積，越晚介入成本越高。'
            : '負值代表同一屆學生隨年級升高逐步改善。'}
          {' '}注意：此為同一屆的整體率變化，學生組成會因轉入轉出而略有變動。
        </ChartNote>
      </Card>
    </div>
  )
}

/* ══════════════════════ 城鄉落差 ══════════════════════ */
function DistrictTab({ an }: { an: Analytics }) {
  const [subject, setSubject] = useState<Subject>('數學')
  const entries = an.district.bySubject[subject]
  const countyRate = useMemo(() => {
    const a = entries.reduce((s, e) => s + e.attendees, 0)
    const n = entries.reduce((s, e) => s + e.attendees * (e.rate ?? 0), 0)
    return a ? n / a : null
  }, [entries])
  const maxRate = Math.max(...entries.map(e => e.rate ?? 0))
  const size = an.sizeEffect[subject]
  const maxSizeRate = Math.max(...size.points.map(p => p.rate ?? 0))

  return (
    <div className="space-y-6">
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`各行政區${subject}未通過率（五年合併）`}>
        <ResponsiveContainer width="100%" height={Math.max(240, entries.length * 44)}>
          <BarChart data={entries} layout="vertical" margin={{ left: 16, right: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" domain={[0, topDomain(maxRate)]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis type="category" dataKey="district" width={70}
              tick={{ fill: '#475569', fontSize: 12 }} />
            <Tooltip formatter={(v: number, _n, p) =>
              [`${fmtPct(v)}（到考 ${p.payload.attendees.toLocaleString()} 人次）`, '未通過率']} />
            {countyRate != null && (
              <ReferenceLine x={countyRate} stroke="#0b3d59" strokeDasharray="4 3"
                label={{ value: `全縣 ${fmtPct(countyRate)}`, position: 'top',
                  style: { fill: '#0b3d59', fontSize: 11 } }} />
            )}
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={28}>
              {entries.map(e => (
                <Cell key={e.district}
                  fill={(e.rate ?? 0) > (countyRate ?? 0) ? '#ef4444' : '#0d9488'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />高於全縣平均
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#0d9488' }} />低於全縣平均
          </span>
        </div>
      </Card>

      <Card title={`各行政區${subject}逐年變化（同一 y 軸，可直接比較）`}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {entries.map(e => (
            <div key={e.district} className="border border-slate-100 rounded-lg p-2">
              <div className="flex items-baseline justify-between mb-1 px-1">
                <span className="text-sm font-medium text-slate-700">{e.district}</span>
                <span className="text-xs text-slate-400 tabular-nums">{fmtPct(e.rate)}</span>
              </div>
              <ResponsiveContainer width="100%" height={96}>
                <LineChart data={e.years} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
                  <YAxis domain={[0, topDomain(maxRate)]} hide />
                  <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 9 }}
                    axisLine={false} tickLine={false} interval={0} />
                  <Tooltip formatter={(v: number) => [fmtPct(v), '未通過率']} />
                  {countyRate != null && <ReferenceLine y={countyRate} stroke="#cbd5e1" strokeDasharray="3 3" />}
                  <Line type="monotone" dataKey="rate" stroke={SUBJECT_COLOR[subject]}
                    strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        <ChartNote>
          採小倍數圖（small multiples）而非 6 條疊在一起的折線，避免需要 6 種難以分辨的顏色。
          所有子圖共用 y 軸上限 {fmtPct(topDomain(maxRate))}；灰色虛線為全縣平均。
        </ChartNote>
      </Card>

      <Card title={`學校規模與${subject}未通過率`}>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="size" name="學生數"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: '全校學生數（115學年）', position: 'insideBottom', offset: -8,
                style: { fill: '#94a3b8', fontSize: 11 } }} />
            <YAxis type="number" dataKey="rate" domain={[0, topDomain(maxSizeRate)]}
              tickFormatter={v => fmtPct(v)} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <ZAxis range={[60, 60]} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p: any = payload[0].payload
              return (
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium text-slate-800">{p.school}</div>
                  <div className="text-slate-500">學生數 {p.size} 人</div>
                  <div className="text-slate-500">五年平均未通過率 {fmtPct(p.rate)}</div>
                  <div className="text-slate-500">年度間標準差 {fmtPct(p.volatility)}</div>
                </div>
              )
            }} />
            <Scatter data={size.points} fill={SUBJECT_COLOR[subject]} fillOpacity={0.65}
              stroke="#fff" strokeWidth={1.5} />
          </ScatterChart>
        </ResponsiveContainer>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">規模級距</th>
                <th className="py-2 pr-4 text-right">校數</th>
                <th className="py-2 pr-4 text-right">平均未通過率</th>
                <th className="py-2 pr-4 text-right">年度間波動（標準差）</th>
              </tr>
            </thead>
            <tbody>
              {size.bins.map(b => (
                <tr key={b.label} className="border-b border-slate-50">
                  <td className="py-1.5 pr-4">{b.label}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{b.schools}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(b.rate)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(b.volatility)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Caveat>
          小校的「年度間波動」明顯較大：學生數個位數時，一個學生的成績就能讓未通過率跳動
          10–30 個百分點。因此小校的單年數字不宜直接與大校比較，
          「風險預警」頁已改用經驗貝氏收縮處理此問題。
        </Caveat>
      </Card>
    </div>
  )
}

/* ══════════════════════ 學校比較 ══════════════════════ */
function SchoolTab({ remedial, an }: { remedial: RemedialRow[]; an: Analytics }) {
  const years = an.meta.years
  const [year, setYear] = useState(years[years.length - 1])
  const [subject, setSubject] = useState<Subject>('數學')

  const data = useMemo(() => {
    const rows = remedial.filter(r => r.year === year && r.subject === subject && r.schoolName)
    const bySchool = new Map<string, { school: string; attendees: number; notPass: number }>()
    rows.forEach(r => {
      const key = r.schoolName!
      const cur = bySchool.get(key) ?? { school: key, attendees: 0, notPass: 0 }
      cur.attendees += r.attendees ?? 0
      cur.notPass += r.notPass ?? 0
      bySchool.set(key, cur)
    })
    return Array.from(bySchool.values())
      .filter(s => s.attendees >= an.meta.minAttendees)
      .map(s => ({ ...s, rate: s.notPass / s.attendees }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 20)
  }, [remedial, year, subject, an.meta.minAttendees])

  const persistent = an.persistent.filter(p => (p.totalObserved ?? 0) >= 9).slice(0, 15)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 mr-1">年度</span>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`tab-btn ${year === y ? 'active' : ''}`}>{y}學年</button>
        ))}
      </div>
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`${year}學年 ${subject}未通過率最高 20 校（全年級合計，到考 ≥ ${an.meta.minAttendees} 人）`}>
        <ResponsiveContainer width="100%" height={Math.max(320, data.length * 26)}>
          <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" domain={[0, (max: number) => topDomain(max)]}
              tickFormatter={v => fmtPct(v)} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis type="category" dataKey="school" width={160} tick={{ fontSize: 11, fill: '#475569' }} />
            <Tooltip formatter={(v: number, _n, p) =>
              [`${fmtPct(v)}（到考 ${p.payload.attendees} 人）`, '未通過率']} />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
              {data.map(s => (
                <Cell key={s.school}
                  fill={s.rate > 0.3 ? '#ef4444' : s.rate > 0.15 ? '#d97706' : '#0d9488'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />逾 30%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#d97706' }} />15–30%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#0d9488' }} />15% 以下
          </span>
        </div>
        <ChartNote>
          未通過率 = 該校該科全年級未通過人數 ÷ 到考人數合計。
          到考未達 {an.meta.minAttendees} 人的學校已排除（個位數學生會使比率極不穩定）。
        </ChartNote>
      </Card>

      <Card title="長期落後學校（三科合計，高於縣平均的年次比例）">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">學校</th>
                <th className="py-2 pr-4">行政區</th>
                <th className="py-2 pr-4 text-right">高於縣平均</th>
                <th className="py-2 pr-4 text-right">比例</th>
                {SUBJECTS.map(s => <th key={s} className="py-2 pr-4 text-right">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {persistent.map(p => (
                <tr key={p.schoolCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-4">{p.school}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{p.district ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">
                    {p.totalAbove}/{p.totalObserved} 年次
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums font-medium">
                    {fmtPct(p.aboveCountyRatio)}
                  </td>
                  {SUBJECTS.map(s => {
                    const v = p.subjects[s]
                    return (
                      <td key={s} className="py-1.5 pr-4 text-right tabular-nums text-slate-500">
                        {v ? `${v.yearsAboveCounty}/${v.yearsObserved}` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartNote>
          「年次」= 學校 × 科目 × 學年的觀測數。比例越高代表該校長期穩定落後於縣平均，
          比單年排名更能反映結構性問題（單年墊底可能只是波動）。僅列出觀測 ≥ 9 年次的學校。
        </ChartNote>
      </Card>
    </div>
  )
}

/* ══════════════════════ 風險預警 ══════════════════════ */
function RiskTab({ an }: { an: Analytics }) {
  const [subject, setSubject] = useState<Subject>('數學')
  const items = an.risk[subject]
  const top = items.slice(0, 15)

  return (
    <div className="space-y-6">
      <SubjectPicker value={subject} onChange={setSubject} />

      <Card title={`${subject}：${an.meta.forecastYear} 學年風險排序（前 15 校）`}>
        <ResponsiveContainer width="100%" height={Math.max(320, top.length * 28)}>
          <BarChart data={top} layout="vertical" margin={{ left: 40, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" domain={[0, (max: number) => topDomain(max)]}
              tickFormatter={v => fmtPct(v)} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis type="category" dataKey="school" width={150}
              tick={{ fontSize: 11, fill: '#475569' }} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p: any = payload[0].payload
              return (
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs
                  shadow-sm space-y-0.5">
                  <div className="font-medium text-slate-800">{p.school}</div>
                  <div className="text-slate-500">{p.district}</div>
                  <div className="text-slate-500">115 原始率 {fmtPct(p.latestRaw)}
                    （到考 {p.latestAttendees} 人）</div>
                  <div className="text-slate-500">收縮後 {fmtPct(p.latestShrunk)}</div>
                  <div className="text-slate-500">趨勢 {fmtPP(p.slopePerYear)}/學年</div>
                  <div className="text-slate-500">{an.meta.forecastYear} 推估 {fmtPct(p.forecast)}</div>
                </div>
              )
            }} />
            <Bar dataKey="riskScore" radius={[0, 4, 4, 0]}>
              {top.map(t => (
                <Cell key={t.schoolCode}
                  fill={(t.riskScore ?? 0) > 0.4 ? '#ef4444'
                    : (t.riskScore ?? 0) > 0.25 ? '#d97706' : '#0d9488'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />高風險（&gt; 0.40）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#d97706' }} />中風險（0.25–0.40）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: '#0d9488' }} />較低（&lt; 0.25）
          </span>
        </div>
        <ChartNote>
          風險分數 = 收縮後的 {an.meta.forecastYear} 推估值 × (0.75 + 0.25 × 長期落後比例)。
          分數本身是「相對排序用的指標」，不是預測的未通過率。
        </ChartNote>
      </Card>

      <Card title="風險明細">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">學校</th>
                <th className="py-2 pr-4">行政區</th>
                <th className="py-2 pr-3 text-right">115 原始</th>
                <th className="py-2 pr-3 text-right">115 收縮後</th>
                <th className="py-2 pr-3 text-right">到考</th>
                <th className="py-2 pr-3 text-right">趨勢/學年</th>
                <th className="py-2 pr-3 text-right">{an.meta.forecastYear} 推估</th>
                <th className="py-2 pr-3 text-right">高於縣均</th>
                <th className="py-2 pr-3 text-right">風險</th>
              </tr>
            </thead>
            <tbody>
              {top.map(t => (
                <tr key={t.schoolCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-4">{t.school}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{t.district ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                    {fmtPct(t.latestRaw)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-medium">
                    {fmtPct(t.latestShrunk)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                    {t.latestAttendees}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums
                    ${(t.slopePerYear ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmtPP(t.slopePerYear)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {fmtPct(t.forecast)}
                    <span className="text-slate-400 text-xs">
                      {' '}[{fmtPct(t.forecastLo)}–{fmtPct(t.forecastHi)}]
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                    {t.yearsAboveCounty}/{t.yearsObserved}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">
                    {t.riskScore?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="方法與限制">
        <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
          <p>
            <b className="text-slate-800">為何要「收縮」？</b>
            全縣有多所個位數學生的小校（最小僅 3–7 人）。若直接用原始未通過率，
            3 人中有 1 人未通過就是 33%，會讓小校長期占據排行榜前段，但那主要是隨機波動而非真實落差。
            本頁採經驗貝氏收縮：
          </p>
          <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs
            overflow-x-auto text-slate-700">
{`收縮後未通過率 = (未通過人數 + K × 縣平均) / (到考人數 + K)     K = ${an.meta.shrinkK}`}
          </pre>
          <p>
            到考人數遠大於 K 的大校幾乎不受影響；人數少的小校則被拉回縣平均，
            只有在落差「大到不像雜訊」時才會浮上來。
          </p>
          <Caveat>
            <b>請勿將推估值當成精確預測。</b>
            每校僅 3–5 個年度觀測點，個別學校的 95% 預測區間通常寬達 20–40 個百分點。
            本頁的用途是<b>排序與篩出值得關注的對象</b>，而非預告明年的實際數字。
            實務上應搭配學校訪談、師資與課程資訊再做判斷。
          </Caveat>
        </div>
      </Card>
    </div>
  )
}

/* ══════════════════════ 關聯分析 ══════════════════════ */
function CorrelationTab({ an }: { an: Analytics }) {
  const pairs = an.correlation
  const [idx, setIdx] = useState(0)
  const p = pairs[idx]

  const strength = (r: number | null) => {
    if (r == null) return '—'
    const a = Math.abs(r)
    return a >= 0.7 ? '強' : a >= 0.4 ? '中等' : a >= 0.2 ? '弱' : '極弱'
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {pairs.map((pp, i) => (
          <button key={`${pp.a}-${pp.b}`} onClick={() => setIdx(i)}
            className={`card text-left transition-all ${idx === i
              ? 'ring-2 ring-ph-navy/30' : 'hover:border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: SUBJECT_COLOR[pp.a] }} />
              <span className="text-sm text-slate-600">{pp.a}</span>
              <span className="text-slate-300">×</span>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: SUBJECT_COLOR[pp.b] }} />
              <span className="text-sm text-slate-600">{pp.b}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-ph-navy tabular-nums">
                {pp.r?.toFixed(2) ?? '—'}
              </span>
              <span className="text-xs text-slate-400">r（{strength(pp.r)}相關）</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">n = {pp.n.toLocaleString()} 組</div>
          </button>
        ))}
      </div>

      <Card title={`${p.a} vs ${p.b} 未通過率散布圖`}>
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={[0, 1]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: `${p.a}未通過率`, position: 'insideBottom', offset: -12,
                style: { fill: '#94a3b8', fontSize: 11 } }} />
            <YAxis type="number" dataKey="y" domain={[0, 1]} tickFormatter={v => fmtPct(v)}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: `${p.b}未通過率`, angle: -90, position: 'insideLeft',
                style: { fill: '#94a3b8', fontSize: 11 } }} />
            <ZAxis range={[36, 36]} />
            <Tooltip formatter={(v: number, n) => [fmtPct(v), n === 'x' ? p.a : p.b]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
              stroke="#cbd5e1" strokeDasharray="4 4" />
            <Scatter data={p.scatter ?? []} fill="#0b3d59" fillOpacity={0.35}
              stroke="#fff" strokeWidth={0.5} />
          </ScatterChart>
        </ResponsiveContainer>
        <ChartNote>
          每個點是一個「學校 × 年級 × 學年」組合（兩科到考人數都 ≥ {an.meta.minAttendees} 人）。
          灰色虛線為 45 度參考線：點落在線上方代表該組合的{p.b}比{p.a}更弱。
          Pearson r = {p.r?.toFixed(3) ?? '—'}，n = {p.n.toLocaleString()}。
        </ChartNote>
        <Caveat>
          相關不等於因果。高相關更可能反映共同的背後因素（學生社經背景、學校師資穩定度、
          小校規模效應），而非「國語文差導致數學差」。
        </Caveat>
      </Card>
    </div>
  )
}

/* ══════════════════════ 明細表 ══════════════════════ */
function DetailTab({ remedial, an }: { remedial: RemedialRow[]; an: Analytics }) {
  const years = an.meta.years
  const [year, setYear] = useState(years[years.length - 1])
  const [subject, setSubject] = useState<Subject>('數學')
  const [district, setDistrict] = useState<string>('全部')

  const districts = ['全部', ...an.district.districts]

  const rows = remedial
    .filter(r => r.year === year && r.subject === subject && r.schoolName
      && (district === '全部' || r.district === district))
    .sort((a, b) => (a.schoolCode ?? '').localeCompare(b.schoolCode ?? '') || a.grade - b.grade)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 mr-1">年度</span>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`tab-btn ${year === y ? 'active' : ''}`}>{y}學年</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <SubjectPicker value={subject} onChange={setSubject} />
        <span className="text-sm text-slate-500 ml-4 mr-1">行政區</span>
        {districts.map(d => (
          <button key={d} onClick={() => setDistrict(d)}
            className={`tab-btn ${district === d ? 'active' : ''}`}>{d}</button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <div className="text-xs text-slate-400 mb-2">{rows.length} 筆</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-100">
              <th className="py-2 pr-4">行政區</th>
              <th className="py-2 pr-4">學校</th>
              <th className="py-2 pr-4">年級</th>
              <th className="py-2 pr-4 text-right">到考人數</th>
              <th className="py-2 pr-4 text-right">未通過人數</th>
              <th className="py-2 pr-4 text-right">未通過率</th>
              <th className="py-2 pr-4 text-right">縣平均</th>
              <th className="py-2 pr-4 text-right">全國平均</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-4 text-slate-500">{r.district ?? '—'}</td>
                <td className="py-1.5 pr-4">{r.schoolName}</td>
                <td className="py-1.5 pr-4">{gradeLabel(r.grade)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{r.attendees ?? '—'}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{r.notPass ?? '—'}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-medium">
                  {r.attendees == null ? <span className="text-slate-400">未施測</span>
                    : fmtPct(r.notPassRate)}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">
                  {fmtPct(r.countyRate)}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">
                  {fmtPct(r.nationalRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════ 主頁 ══════════════════════ */
export default function Home() {
  const [tab, setTab] = useState<Tab>('總覽')
  const [remedial, setRemedial] = useState<RemedialRow[] | null>(null)
  const [summary, setSummary] = useState<RemedialSummaryRow[] | null>(null)
  const [an, setAn] = useState<Analytics | null>(null)

  useEffect(() => {
    Promise.all([fetchRemedial(), fetchRemedialSummary(), fetchAnalytics()])
      .then(([r, s, a]) => { setRemedial(r); setSummary(s); setAn(a) })
  }, [])

  if (!remedial || !summary || !an) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-ph-navy animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6 animate-fade-in-up">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ph-navy">澎湖縣學習扶助未通過率分析儀表板</h1>
        <p className="text-sm text-slate-500">
          {an.meta.years[0]}–{an.meta.years[an.meta.years.length - 1]} 學年度學習扶助篩選測驗未通過率
          · 全縣 {an.district.districts.length} 個行政區
        </p>
      </header>

      <nav className="flex gap-1.5 flex-wrap bg-white/60 backdrop-blur rounded-xl p-1.5
        border border-slate-100">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`tab-btn ${tab === t ? 'active' : ''}`}>
            {TAB_ICON[t]}{t}
          </button>
        ))}
      </nav>

      {tab === '總覽' && <OverviewTab an={an} remedial={remedial} />}
      {tab === '跨年趨勢' && <TrendTab an={an} summary={summary} />}
      {tab === '年級斷點' && <GradeTab an={an} />}
      {tab === '世代追蹤' && <CohortTab an={an} />}
      {tab === '城鄉落差' && <DistrictTab an={an} />}
      {tab === '學校比較' && <SchoolTab remedial={remedial} an={an} />}
      {tab === '風險預警' && <RiskTab an={an} />}
      {tab === '關聯分析' && <CorrelationTab an={an} />}
      {tab === '明細表' && <DetailTab remedial={remedial} an={an} />}
    </div>
  )
}
