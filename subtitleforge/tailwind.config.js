/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // A single neutral ramp, sampled from the editors this app sits beside:
        // near-black panels, a hair of blue in the greys, one saturated accent.
        panel: {
          950: '#0A0C10',
          900: '#0F1218',
          850: '#141821',
          800: '#1A1F2A',
          750: '#222834',
          700: '#2B323F',
          600: '#3A4252',
          500: '#4D566A',
        },
        ink: {
          100: '#F3F5F9',
          200: '#D8DEE9',
          300: '#AEB7C7',
          400: '#8089A0',
          500: '#5D667B',
        },
        accent: {
          DEFAULT: '#3B82F6',
          hover: '#60A5FA',
          muted: '#1D4ED8',
          soft: 'rgba(59,130,246,0.14)',
        },
        signal: {
          ok: '#34D399',
          warn: '#FBBF24',
          error: '#F87171',
          speech: '#38BDF8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        pop: '0 16px 48px -16px rgba(0,0,0,0.75)',
      },
      transitionDuration: { 120: '120ms' },
    },
  },
  plugins: [],
};
