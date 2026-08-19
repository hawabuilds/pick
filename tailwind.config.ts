import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        card: "#FFFFFF",
        ink: "#0B0F0C",
        muted: "#5C665F",
        faint: "#8A938C",
        wash: "#F4F7F5",
        hairline: "rgba(11,15,12,0.09)",
        green: {
          DEFAULT: "#00C805",
          deep: "#068A3A",
        },
        red: {
          DEFAULT: "#FF5A52",
        },
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "18px",
        panel: "20px",
        control: "14px",
        pill: "11px",
      },
      boxShadow: {
        card: "0 14px 30px -26px rgba(9,24,14,0.35)",
        lift: "0 22px 40px -26px rgba(9,24,14,0.4)",
        panel: "0 20px 44px -32px rgba(9,24,14,0.45)",
        modal:
          "0 40px 90px -24px rgba(9,24,14,0.55), 0 0 0 1px rgba(11,15,12,0.05)",
        frame:
          "0 44px 100px -34px rgba(9,24,14,0.46), 0 0 0 1px rgba(11,15,12,0.05)",
        menu: "0 24px 50px -18px rgba(9,24,14,0.4)",
        dark: "0 16px 34px -14px rgba(11,15,12,0.55)",
        green: "0 16px 32px -14px rgba(0,200,5,0.6)",
      },
      backgroundImage: {
        premium:
          "radial-gradient(560px 340px at 88% 4%, rgba(0,200,5,0.09), transparent 66%), radial-gradient(700px 480px at 2% 102%, rgba(0,200,5,0.045), transparent 70%), #FFFFFF",
        flex:
          "linear-gradient(150deg, #0B0F0C, #10261A 70%, #0B3D1F)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        nudge: {
          "0%,100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-5px)" },
          "75%": { transform: "translateX(5px)" },
        },
      },
      animation: {
        rise: "rise .35s ease",
        nudge: "nudge .4s ease",
      },
      transitionTimingFunction: {
        sheet: "cubic-bezier(.2,.9,.25,1)",
      },
    },
  },
  plugins: [],
};

export default config;
