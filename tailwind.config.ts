import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#07070a", 900: "#0d0d12", 850: "#13131a", 800: "#1a1a23", 700: "#262631", 600: "#3a3a48", 400: "#8b8b9e", 300: "#b4b4c4" },
        lime: { DEFAULT: "#c6ff3d", dim: "#9bd11c" },
        violet: { DEFAULT: "#a78bfa" },
        coral: { DEFAULT: "#ff6b6b" },
        amber: { DEFAULT: "#ffc857" },
        sky: { DEFAULT: "#5cc8ff" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "ui-monospace", "monospace"] },
      borderRadius: { "4xl": "2rem" },
    },
  },
  plugins: [],
} satisfies Config;
