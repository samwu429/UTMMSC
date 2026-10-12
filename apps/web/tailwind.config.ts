import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4eef8',
          100: '#e7dcf0',
          700: '#5B2A86',
          800: '#3C165F',
          900: '#2A1044',
        },
        gold: '#FFD23F',
        canvas: '#F2F3F5',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
