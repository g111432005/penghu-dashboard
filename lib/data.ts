export interface RemedialRow {
  year: number
  district: string | null
  schoolCode: string | null
  schoolName: string | null
  schoolType: string | null
  grade: number
  gradeStudents: number | null
  subject: '國語文' | '數學' | '英語'
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
  subject: '國語文' | '數學' | '英語'
  attendees: number | null
  notPass: number | null
  notPassRate: number | null
}

const basePath = process.env.NODE_ENV === 'production' ? '/penghu-dashboard' : ''
const BASE = `${basePath}/data`

export const fetchRemedial = () =>
  fetch(`${BASE}/remedial.json`).then(r => r.json()) as Promise<RemedialRow[]>

export const fetchRemedialSummary = () =>
  fetch(`${BASE}/remedial_summary.json`).then(r => r.json()) as Promise<RemedialSummaryRow[]>

export const SUBJECT_COLOR: Record<string, string> = {
  國語文: '#0891b2',
  數學: '#ef4444',
  英語: '#d97706',
}

export const YEARS = [111, 112, 113, 114, 115]
