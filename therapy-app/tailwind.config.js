/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'Rubik', 'system-ui', 'sans-serif'],
      },
      colors: {
        // פלטת צבעים רכה ורגועה לעולם טיפולי
        calm: {
          50: '#f5f8fa',
          100: '#e6eef3',
          200: '#cfe0ea',
          300: '#a9c8da',
          400: '#7da9c4',
          500: '#5b8cab',
          600: '#477192',
          700: '#3b5c77',
          800: '#344e63',
          900: '#2f4254',
        },
        warmth: {
          50: '#fdf6f3',
          100: '#fbe9e2',
          200: '#f7d2c4',
          300: '#f0b29c',
          400: '#e68a6b',
          500: '#db6a45',
        },
        mint: {
          50: '#f0faf6',
          100: '#d8f1e7',
          200: '#b3e3d2',
          300: '#83cdb6',
          400: '#52b095',
          500: '#36967c',
        },
      },
      boxShadow: {
        soft: '0 4px 20px -4px rgba(59, 92, 119, 0.12)',
        card: '0 2px 12px -2px rgba(59, 92, 119, 0.10)',
      },
    },
  },
  plugins: [],
}
