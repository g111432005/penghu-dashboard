/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ph: {
          navy:  '#0b3d59',
          teal:  '#0891b2',
          amber: '#d97706',
          coral: '#ef4444',
          mint:  '#10b981',
          slate: '#64748b',
          bg:    '#f0f6f8',
        }
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      }
    }
  },
  plugins: []
}
