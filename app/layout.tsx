import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '澎湖縣學習扶助未通過率分析儀表板',
  description: '111–115 學年度學習扶助篩選測驗未通過率分析',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="bg-ph-bg min-h-screen">{children}</body>
    </html>
  )
}
