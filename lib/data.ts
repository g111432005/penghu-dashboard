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

export interface TrendPoint {
  year: number
  registered: number
  notPass: number
  rate: number | null
  /* 原始檔公布的官方縣值，用於對帳 */
  officialRate: number | null
}

export interface ReconciliationRow {
  year: number
  groups: number
  maxDiffPP: number | null
  medianDiffPP: number | null
}

export interface BacktestCounty {
  actual: number | null
  predicted: number | null
  naive: number | null
  error: number | null
  naiveError: number | null
  inInterval: boolean
}

export interface BacktestSchool {
  n: number
  mae: number | null
  naiveMae: number | null
  coverage: number | null
  shrinkK: number | null
}

export interface Backtest {
  trainYears: number[]
  testYear: number
  county: Record<Subject, BacktestCounty>
  school: Record<Subject, BacktestSchool>
}

export interface CountyTrend {
  series: TrendPoint[]
  trend: { slopePerYear: number | null; r2: number | null } | null
  forecast: { year: number; rate: number | null; lo: number | null; hi: number | null } | null
}

export interface GradeProfilePoint {
  grade: number
  registered: number
  rate: number | null
  delta: number | null
}

export interface DistrictEntry {
  district: string
  rate: number | null
  registered: number
  years: { year: number; rate: number | null; registered: number }[]
}

export interface CohortPoint { grade: number; year: number; registered: number; rate: number | null }
export interface Cohort { cohort: number; points: CohortPoint[]; sizeVariation: number | null }

export interface CorrelationPair {
  a: Subject
  b: Subject
  n: number
  r: number | null
  /* Fisher z 轉換的 95% 信賴區間 */
  ci?: [number, number] | null
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
  registered: number
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
  latestRegistered: number
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

/* ── 學校脈絡變數（教育部公開資料） ── */

export interface TierEntry {
  tier: string
  registered: number
  notPass: number
  rate: number | null
  schools: number
}

export interface TeacherStratum {
  label: string
  n: number
  rate: number | null
  meanSize: number
}

export interface TeacherAnalysis {
  n: number
  /* 原始相關 */
  r: number | null
  /* 控制學校規模後的偏相關——這才是可解讀的數字 */
  rPartial: number | null
  rSizeRate: number | null
  rRatioSize: number | null
  strata: TeacherStratum[]
  points: { ratio: number; rate: number | null; size: number; year: number }[]
}

export interface ContextAnalysis {
  tierYears: number[]
  basecYears: number[]
  tier: Record<Subject, TierEntry[]>
  teacher: Record<Subject, TeacherAnalysis>
  indigenous: Record<Subject, { n: number; r: number | null }>
  notes: Record<string, string>
}

export interface Analytics {
  meta: {
    years: number[]
    forecastYear: number
    subjects: Subject[]
    /* 各科由資料估計的收縮強度 */
    shrinkK: Record<Subject, { k: number | null; tau2: number | null; schools: number }>
    minRegistered: number
    denominator: string
    notes: Record<string, string>
  }
  reconciliation: ReconciliationRow[]
  backtest: Backtest
  countyTrend: Record<Subject, CountyTrend>
  gradeProfile: Record<Subject, GradeProfilePoint[]>
  district: { districts: string[]; bySubject: Record<Subject, DistrictEntry[]> }
  cohorts: Record<Subject, Cohort[]>
  correlation: CorrelationPair[]
  sizeEffect: Record<Subject, { points: SizePoint[]; bins: SizeBin[] }>
  nationalGap: Record<Subject, NationalGapPoint[]>
  risk: Record<Subject, RiskItem[]>
  persistent: PersistentItem[]
  context: ContextAnalysis | null
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
