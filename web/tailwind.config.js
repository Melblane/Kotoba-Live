/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 900: '#14151a', 800: '#1a1c23', 700: '#21232c', 600: '#2a2d38', 500: '#363a48' },
        fg: '#ecebf4',
        muted: '#a3a5b8',
        faint: '#727489',
        iris: '#8f7bff',
        azure: '#5c8dff',
        ok: '#46d6a4',
        warn: '#f5b94c',
        bad: '#ff6f86',
      },
      borderColor: { DEFAULT: 'rgba(255,255,255,0.08)' },
      fontFamily: {
        sans: ['"Instrument Sans"', '"IBM Plex Sans Thai"', '"Zen Kaku Gothic New"', 'system-ui', 'sans-serif'],
        thai: ['Kanit', '"IBM Plex Sans Thai"', '"Noto Sans Thai"', 'Tahoma', 'sans-serif'],
        jp: ['"Zen Kaku Gothic New"', '"Hiragino Sans"', '"Yu Gothic"', '"Noto Sans JP"', 'sans-serif'],
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        breathe: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
      },
      animation: { rise: 'rise .22s ease-out', breathe: '1.6s ease-in-out infinite breathe' },
    },
  },
  plugins: [],
};
