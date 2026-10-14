import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resumeFontPlugins } from "./vite.plugins.ts";

export default defineConfig({
  plugins: [...resumeFontPlugins(), react(), ...(process.env.VERCEL ? [] : [cloudflare()])],
});
