import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f3f9',
          100: '#dae1f0',
          200: '#b8c7e3',
          300: '#8ea7d2',
          400: '#6685be',
          500: '#4666a6',
          600: '#365089',
          700: '#2d4170',
          800: '#28385d',
          900: '#1e2a45',
          950: '#141c30',
        },
        firm: {
          primary: '#1e3a5f',
          secondary: '#2d5f8a',
          accent: '#4a90d9',
          surface: '#f8fafc',
          muted: '#64748b',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
