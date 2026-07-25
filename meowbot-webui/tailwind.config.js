/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        canvas: "#ffffff",
        "canvas-soft": "#f8f9fb",
        brand: "#f36458",
        hairline: "#ededed",
        ink: "#0b0b0b",
        "ink-soft": "#212121",
        mute: "#797979",
        ash: "#505b6c",
        slate: "#3c4758",
        success: "#37cd84",
        "link-blue": "#0052ef",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
