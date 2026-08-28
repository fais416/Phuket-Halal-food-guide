import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d12",
        panel: "#12151c",
        panel2: "#181c26",
        border: "#252a36",
        accent: "#7c5cff",
        accent2: "#ff5cad",
        good: "#3ddc97",
        warn: "#ffb454",
        bad: "#ff5c5c"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
