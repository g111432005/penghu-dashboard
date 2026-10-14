export type Subject = '國語文' | '數學' | '英語'

export interface RemedialRow {
  year: number
  district: string | null
  schoolCode: string | null
  schoolName: string | null
  schoolType: string | null
  grade: number
  gradeStudents: number | null
  subject: Subject
  testTakers: number | null
  attendees: number | null
  notPass: number | null
  notPassRate: number | null
  gradeNotPassRate: number | null
  countyRate: number | null
  nationalRate: number | null
}

export interface RemedialSummaryRow {
  year: number
  grade: number
  subject: Subject
  attendees: number | null
  notPass: number | null
  notPassRate: number | null
}

/* ── analytics.json (由 scripts/analyze_remedial.py 預先算好) ── */

export interface TrendPoint { year: number; attendees: number; notPass: number; rate: number | null }

export interface CountyTrend {
  series: TrendPoint[]
  trend: { slopePerYear: number | null; r2: number | null } | null
  forecast: { year: number; rate: number | null; lo: number | null; hi: number | null } | null
}

export interface GradeProfilePoint {
  grade: number
  attendees: number
  rate: number | null
  delta: number | null
}

export interface DistrictEntry {
  district: string
  rate: number | null
  attendees: number
  years: { year: number; rate: number | null; attendees: number }[]
}

export interface CohortPoint { grade: number; year: number; attendees: number; rate: number | null }
export interface Cohort { cohort: number; label: string; points: CohortPoint[] }

export interface CorrelationPair {
  a: Subject
  b: Subject
  n: number
  r: number | null
  scatter?: { x: number; y: number }[]
}

export interface SizePoint {
  schoolCode: string
  school: string
  size: number
  rate: number | null
  volatility: number | null
  years: number
}

export interface SizeBin {
  label: string
  schools: number
  rate: number | null
  volatility: number | null
}

export interface NationalGapPoint {
  year: number
  county: number | null
  national: number | null
  gap: number | null
}

export interface RiskSeriesPoint {
  year: number
  raw: number | null
  shrunk: number | null
  attendees: number
  county: number | null
}

export interface RiskItem {
  schoolCode: string
  school: string
  district: string | null
  yearsObserved: number
  yearsAboveCounty: number
  latestShrunk: number | null
  latestRaw: number | null
  latestAttendees: number
  slopePerYear: number | null
  forecast: number | null
  forecastLo: number | null
  forecastHi: number | null
  riskScore: number | null
  series: RiskSeriesPoint[]
}

export interface PersistentItem {
  schoolCode: string
  school: string
  district: string | null
  aboveCountyRatio: number | null
  totalAbove: number
  totalObserved: number
  meanRisk: number | null
  subjects: Record<string, { yearsAboveCounty: number; yearsObserved: number; riskScore: number | null }>
}

export interface Analytics {
  meta: {
    years: number[]
    forecastYear: number
    subjects: Subject[]
    shrinkK: number
    minAttendees: number
    notes: Record<string, string>
  }
  countyTrend: Record<Subject, CountyTrend>
  gradeProfile: Record<Subject, GradeProfilePoint[]>
  district: { districts: string[]; bySubject: Record<Subject, DistrictEntry[]> }
  cohorts: Record<Subject, Cohort[]>
  correlation: CorrelationPair[]
  sizeEffect: Record<Subject, { points: SizePoint[]; bins: SizeBin[] }>
  nationalGap: Record<Subject, NationalGapPoint[]>
  risk: Record<Subject, RiskItem[]>
  persistent: PersistentItem[]
}

const basePath = process.env.NODE_ENV === 'production' ? '/penghu-dashboard' : ''
const BASE = `${basePath}/data`

export const fetchRemedial = () =>
  fetch(`${BASE}/remedial.json`).then(r => r.json()) as Promise<RemedialRow[]>

export const fetchRemedialSummary = () =>
  fetch(`${BASE}/remedial_summary.json`).then(r => r.json()) as Promise<RemedialSummaryRow[]>

export const fetchAnalytics = () =>
  fetch(`${BASE}/analytics.json`).then(r => r.json()) as Promise<Analytics>

/* 科目配色：固定順序的類別色，經 colorblind 檢定（protan/deutan/tritan ΔE 皆 >= 16）。
   原本英語用的琥珀色 #d97706 與數學紅 #ef4444 在紅綠色盲下 ΔE 僅 4.4，已改為紫色。 */
export const SUBJECT_COLOR: Record<string, string> = {
  國語文: '#0891b2',
  數學: '#ef4444',
  英語: '#7c3aed',
}

/* 學年是有序變數，用單一色相由淺到深的漸層（深 = 越近期），而非類別色 */
export const YEAR_RAMP = ['#7dd3fc', '#38bdf8', '#0284c7', '#075985', '#0b3d59']

export const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8' }

export const YEARS = [111, 112, 113, 114, 115]
