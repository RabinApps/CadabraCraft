import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    react(),
    lingui(),
    tailwindcss(),
  ],
  clearScreen: false,
  // E2E_PORT lets parallel Playwright runs (e.g. several agents) use their own dev server.
  server: { port: Number(process.env.E2E_PORT) || 1420, strictPort: true },
});
