import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        oat: "#f7f0e5",
        linen: "#fffaf1",
        parchment: "#efe1cd",
        clay: "#bd8068",
        moss: "#7f9074",
        sage: "#d8e1cf",
        skywash: "#dbe7ea",
        ink: "#40382f",
        bark: "#776556"
      },
      boxShadow: {
        soft: "0 22px 60px rgba(77, 63, 48, 0.12)"
      }
    }
  },
  plugins: []
} satisfies Config;
