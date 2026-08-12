/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // dark trading-desk palette
        ink: {
          950: '#0a0e17',
          900: '#0f1420',
          850: '#141a28',
          800: '#1a2233',
          700: '#232d42',
          600: '#2e3a54',
        },
        profit: '#16c784',
        loss: '#ea3943',
        accent: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
