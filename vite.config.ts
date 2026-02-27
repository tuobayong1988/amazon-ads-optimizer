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
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,  // v268: 启用CSS代码分割，每个懒加载页面独立CSS
    cssMinify: 'lightningcss',  // v268: 使用lightningcss进行更高效的CSS压缩
    target: 'es2020',  // v268: 现代浏览器目标，减少polyfill体积
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React 核心运行时（react, react-dom, scheduler）
          if (id.includes('node_modules/react-dom/') || 
              id.includes('node_modules/react/') || 
              id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }

          // 路由
          if (id.includes('node_modules/wouter/')) {
            return 'react-vendor';
          }

          // Radix UI 组件库
          if (id.includes('node_modules/@radix-ui/')) {
            return 'ui-vendor';
          }

          // 图表库（recharts + d3 依赖）
          if (id.includes('node_modules/recharts/') || 
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor/') ||
              id.includes('node_modules/internmap/') ||
              id.includes('node_modules/robust-predicates/') ||
              id.includes('node_modules/delaunator/')) {
            return 'chart-vendor';
          }

          // 数据层（tanstack-query + trpc + superjson）
          if (id.includes('node_modules/@tanstack/') || 
              id.includes('node_modules/@trpc/') ||
              id.includes('node_modules/superjson/')) {
            return 'data-vendor';
          }

          // 日期处理库
          if (id.includes('node_modules/date-fns/') || 
              id.includes('node_modules/date-fns-tz/')) {
            return 'date-vendor';
          }

          // Mermaid 图表引擎（非常大，独立分割以支持按需加载）
          if (id.includes('node_modules/mermaid/') || 
              id.includes('node_modules/@streamdown/mermaid/') ||
              id.includes('node_modules/dagre-d3') ||
              id.includes('node_modules/dagre/') ||
              id.includes('node_modules/graphlib/') ||
              id.includes('node_modules/cytoscape') ||
              id.includes('node_modules/elkjs/') ||
              id.includes('node_modules/dompurify/') ||
              id.includes('node_modules/khroma/') ||
              id.includes('node_modules/lodash-es/')) {
            return 'mermaid-vendor';
          }

          // Markdown 渲染（不含 mermaid）
          if (id.includes('node_modules/streamdown/') ||
              id.includes('node_modules/react-markdown/') ||
              id.includes('node_modules/remark-') ||
              id.includes('node_modules/rehype-') ||
              id.includes('node_modules/unified/') ||
              id.includes('node_modules/mdast-') ||
              id.includes('node_modules/hast-') ||
              id.includes('node_modules/micromark') ||
              id.includes('node_modules/unist-') ||
              id.includes('node_modules/vfile')) {
            return 'markdown-vendor';
          }

          // Lucide 图标库
          if (id.includes('node_modules/lucide-react/')) {
            return 'icon-vendor';
          }

          // 导出功能库 - 按需加载，拆分为独立 chunk
          if (id.includes('node_modules/xlsx/')) {
            return 'xlsx-vendor';
          }
          if (id.includes('node_modules/jspdf/')) {
            return 'pdf-vendor';
          }
          if (id.includes('node_modules/html2canvas/')) {
            return 'html2canvas-vendor';
          }
          if (id.includes('node_modules/jszip/')) {
            return 'jszip-vendor';
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
