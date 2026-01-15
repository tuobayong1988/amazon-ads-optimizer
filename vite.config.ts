import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";


const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React核心库
          if (id.includes('node_modules/react/') || 
              id.includes('node_modules/react-dom/') || 
              id.includes('node_modules/wouter/')) {
            return 'react-vendor';
          }
          // Radix UI组件库
          if (id.includes('node_modules/@radix-ui/')) {
            return 'ui-vendor';
          }
          // 图表库
          if (id.includes('node_modules/recharts/') || 
              id.includes('node_modules/chart.js/') || 
              id.includes('node_modules/react-chartjs-2/')) {
            return 'chart-vendor';
          }
          // Mermaid图表（较大）
          if (id.includes('node_modules/mermaid/')) {
            return 'mermaid-vendor';
          }
          // 表单处理
          if (id.includes('node_modules/react-hook-form/') || 
              id.includes('node_modules/@hookform/') || 
              id.includes('node_modules/zod/')) {
            return 'form-vendor';
          }
          // 工具库
          if (id.includes('node_modules/date-fns/') || 
              id.includes('node_modules/lodash/') || 
              id.includes('node_modules/axios/')) {
            return 'utils-vendor';
          }
          // 代码编辑器
          if (id.includes('node_modules/@uiw/') || 
              id.includes('node_modules/@codemirror/')) {
            return 'editor-vendor';
          }
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
