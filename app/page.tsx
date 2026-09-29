'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  School, Users, AlertTriangle, TrendingUp, LayoutGrid, Table as TableIcon, Loader2, BookOpen,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import {
  fetchRemedial, fetchRemedialSummary,
  RemedialRow, RemedialSummaryRow,
  SUBJECT_COLOR,
} from '../lib/data'

const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

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

const TABS = ['總覽', '跨年趨勢', '學校比較', '明細表'] as const
type Tab = typeof TABS[number]
const iconCls = "w-3.5 h-3.5"
const TAB_ICON: Record<Tab, React.ReactNode> = {
  '總覽': <LayoutGrid className={iconCls} />,
  '跨年趨勢': <TrendingUp className={iconCls} />,
  '學校比較': <School className={iconCls} />,
  '明細表': <TableIcon className={iconCls} />,
}

const SUBJECTS = ['國語文', '數學', '英語'] as const

/* county-level weighted rate for a given year+subject across all grades */
function countyRate(summary: RemedialSummaryRow[], year: number, subject: string) {
  const rows = summary.filter(r => r.year === year && r.subject === subject)
  const attendees = rows.reduce((s, r) => s + (r.attendees ?? 0), 0)
  const notPass = rows.reduce((s, r) => s + (r.notPass ?? 0), 0)
  return attendees ? notPass / attendees : null
}

/* ══ OVERVIEW ══ */
function OverviewTab({ summary, remedial }: { summary: RemedialSummaryRow[]; remedial: RemedialRow[] }) {
  const years = Array.from(new Set(summary.map(r => r.year))).sort()
  const latestYear = years[years.length - 1]
  const schools = new Set(remedial.filter(r => r.year === latestYear).map(r => r.schoolCode)).size
  const students = remedial
    .filter(r => r.year === latestYear && r.subject === '國語文')
    .reduce((s, r) => s + (r.gradeStudents ?? 0), 0)

  const bySubject = SUBJECTS.map(s => ({ subject: s, rate: countyRate(summary, latestYear, s) }))
    .filter(r => r.rate != null)

  const worst = bySubject.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a), bySubject[0])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="學校數" value={`${schools} 校`} color="#0b3d59" icon={<School className="w-4 h-4" />} />
        <KpiCard label={`${latestYear}學年學生數`} value={`${students.toLocaleString()} 人`}
          color="#0891b2" icon={<Users className="w-4 h-4" />} />
        <KpiCard label="最高未通過率科目" value={worst.subject}
          sub={fmtPct(worst.rate)} color="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiCard label="資料年度" value={`${years[0]}–${latestYear}`}
          sub="學習扶助篩選測驗" color="#d97706" icon={<BookOpen className="w-4 h-4" />} />
      </div>

      <div className="card">
        <h3 className="font-semibold text-ph-navy mb-4">{latestYear}學年 全縣各科未通過率</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bySubject}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="subject" />
            <YAxis domain={[0, 0.5]} tickFormatter={v => fmtPct(v)} />
            <Tooltip formatter={(v: number) => fmtPct(v)} />
            <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
              {bySubject.map(r => <Cell key={r.subject} fill={SUBJECT_COLOR[r.subject]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartNote>
          此為 {latestYear} 學年度全縣加權平均未通過率（依各年級到考人數加權）。目前資料僅涵蓋 113、114 學年，
          其餘年度待補齊後將自動納入跨年趨勢比較。
        </ChartNote>
      </div>
    </div>
  )
}

/* ══ TREND ══ */
function TrendTab({ summary }: { summary: RemedialSummaryRow[] }) {
  const [subject, setSubject] = useState<typeof SUBJECTS[number]>('數學')
  const years = Array.from(new Set(summary.map(r => r.year))).sort()

  const gradeData = useMemo(() => {
    const grades = Array.from(new Set(summary.map(r => r.grade))).sort((a, b) => a - b)
    return grades.map(g => {
      const row: any = { grade: g <= 6 ? `國小${g}` : `國中${g - 6}` }
      years.forEach(y => {
        const rec = summary.find(r => r.year === y && r.grade === g && r.subject === subject)
        row[`y${y}`] = rec?.notPassRate ?? null
      })
      return row
    })
  }, [summary, subject, years])

  const countyTrend = years.map(y => ({ year: y, rate: countyRate(summary, y, subject) }))

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {SUBJECTS.map(s => (
          <button key={s} onClick={() => setSubject(s)}
            className={`tab-btn ${subject === s ? 'active' : ''}`}>{s}</button>
        ))}
      </div>

      <div className="card">
        <h3 className="font-semibold text-ph-navy mb-4">全縣{subject}未通過率跨年趨勢</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={countyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="year" />
            <YAxis domain={[0, 0.5]} tickFormatter={v => fmtPct(v)} />
            <Tooltip formatter={(v: number) => fmtPct(v)} />
            <Line type="monotone" dataKey="rate" stroke={SUBJECT_COLOR[subject]} strokeWidth={2.5}
              dot={{ r: 4 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3 className="font-semibold text-ph-navy mb-4">各年級{subject}未通過率（依年度）</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={gradeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="grade" />
            <YAxis domain={[0, 0.6]} tickFormatter={v => fmtPct(v)} />
            <Tooltip formatter={(v: number) => fmtPct(v)} />
            <Legend />
            {years.map((y, i) => (
              <Line key={y} type="monotone" dataKey={`y${y}`} name={`${y}學年`}
                stroke={['#0b3d59', '#0891b2', '#ef4444', '#d97706', '#10b981'][i % 5]}
                strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <ChartNote>
          可觀察各年級未通過率隨學年的變化；缺少的年度資料點會以斷線呈現，待資料補齊後會自動連上。
        </ChartNote>
      </div>
    </div>
  )
}

/* ══ SCHOOL COMPARISON ══ */
function SchoolTab({ remedial }: { remedial: RemedialRow[] }) {
  const years = Array.from(new Set(remedial.map(r => r.year))).sort()
  const [year, setYear] = useState(years[years.length - 1])
  const [subject, setSubject] = useState<typeof SUBJECTS[number]>('數學')

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
      .filter(s => s.attendees >= 10) // 低於10人到考時未通過率易受個位數學生數影響，波動過大不具比較意義
      .map(s => ({ ...s, rate: s.notPass / s.attendees }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 20)
  }, [remedial, year, subject])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 mr-1">年度</span>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`tab-btn ${year === y ? 'active' : ''}`}>{y}學年</button>
        ))}
        <span className="text-sm text-slate-500 ml-4 mr-1">科目</span>
        {SUBJECTS.map(s => (
          <button key={s} onClick={() => setSubject(s)}
            className={`tab-btn ${subject === s ? 'active' : ''}`}>{s}</button>
        ))}
      </div>

      <div className="card">
        <h3 className="font-semibold text-ph-navy mb-4">
          {year}學年 {subject}未通過率最高 20 校（全年級合計，到考人數需 ≥10 人）
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(320, data.length * 26)}>
          <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" domain={[0, (max: number) => Math.max(0.6, Math.ceil(max * 10) / 10)]}
              tickFormatter={v => fmtPct(v)} />
            <YAxis type="category" dataKey="school" width={160} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number, _n, p) => [`${fmtPct(v)}（到考 ${p.payload.attendees} 人）`, '未通過率']} />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
              {data.map((s, i) => (
                <Cell key={s.school} fill={s.rate > 0.3 ? '#ef4444' : s.rate > 0.15 ? '#d97706' : '#0891b2'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartNote>
          未通過率 = 該校該科全年級未通過人數 ÷ 到考人數合計。紅色代表逾 30%，橙色為 15–30%，藍色為 15% 以下。
        </ChartNote>
      </div>
    </div>
  )
}

/* ══ DETAIL TABLE ══ */
function DetailTab({ remedial }: { remedial: RemedialRow[] }) {
  const years = Array.from(new Set(remedial.map(r => r.year))).sort()
  const [year, setYear] = useState(years[years.length - 1])
  const [subject, setSubject] = useState<typeof SUBJECTS[number]>('數學')

  const rows = remedial
    .filter(r => r.year === year && r.subject === subject && r.schoolName)
    .sort((a, b) => (a.schoolCode ?? '').localeCompare(b.schoolCode ?? '') || a.grade - b.grade)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 mr-1">年度</span>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`tab-btn ${year === y ? 'active' : ''}`}>{y}學年</button>
        ))}
        <span className="text-sm text-slate-500 ml-4 mr-1">科目</span>
        {SUBJECTS.map(s => (
          <button key={s} onClick={() => setSubject(s)}
            className={`tab-btn ${subject === s ? 'active' : ''}`}>{s}</button>
        ))}
      </div>
      <div className="card overflow-x-auto">
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
                <td className="py-1.5 pr-4">{r.grade <= 6 ? `國小${r.grade}` : `國中${r.grade - 6}`}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{r.attendees ?? '—'}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{r.notPass ?? '—'}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-medium">{fmtPct(r.notPassRate)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{fmtPct(r.countyRate)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{fmtPct(r.nationalRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('總覽')
  const [remedial, setRemedial] = useState<RemedialRow[] | null>(null)
  const [summary, setSummary] = useState<RemedialSummaryRow[] | null>(null)

  useEffect(() => {
    Promise.all([fetchRemedial(), fetchRemedialSummary()]).then(([r, s]) => {
      setRemedial(r)
      setSummary(s)
    })
  }, [])

  if (!remedial || !summary) {
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
        <p className="text-sm text-slate-500">111–115 學年度學習扶助篩選測驗未通過率（目前已收錄 113、114 學年資料)</p>
      </header>

      <nav className="flex gap-1.5 flex-wrap bg-white/60 backdrop-blur rounded-xl p-1.5 border border-slate-100">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`tab-btn ${tab === t ? 'active' : ''}`}>
            {TAB_ICON[t]}{t}
          </button>
        ))}
      </nav>

      {tab === '總覽' && <OverviewTab summary={summary} remedial={remedial} />}
      {tab === '跨年趨勢' && <TrendTab summary={summary} />}
      {tab === '學校比較' && <SchoolTab remedial={remedial} />}
      {tab === '明細表' && <DetailTab remedial={remedial} />}
    </div>
  )
}
