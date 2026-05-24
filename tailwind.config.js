/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "var(--navy)",
        "navy-light": "var(--navy-light)",
        "navy-hero": "var(--navy-hero)",
        saffron: "var(--saffron)",
        "saffron-dark": "var(--saffron-dark)",
        "saffron-light": "var(--saffron-light)",
        gold: "var(--gold)",
        cream: "var(--cream)",
        "cream-dark": "var(--cream-dark)",
        green: "var(--green)",
        red: "var(--red)",
        text: "var(--text)",
        muted: "var(--muted)",
        "ink-deep": "var(--ink-deep)",
        steel: "var(--steel)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",
        "app-muted": "var(--app-muted)",
        purple: "var(--purple)",
        teal: "var(--teal)",
      },
    },
  },
  plugins: [],
}
