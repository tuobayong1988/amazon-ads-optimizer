import express, { type Express } from "express";
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('Vite');
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";

// 开发模式下的vite配置（内联，避免动态导入vite.config）
// 这样可以确保esbuild在生产构建时不会尝试打包vite.config
async function getViteConfig() {
  // 动态导入vite插件，只在开发模式下使用
  const [
    { default: react },
    { default: tailwindcss },
    { jsxLocPlugin },
    { vitePluginManusRuntime }
  ] = await Promise.all([
    import("@vitejs/plugin-react"),
    import("@tailwindcss/vite"),
    import("@builder.io/vite-plugin-jsx-loc"),
    import("vite-plugin-manus-runtime")
  ]);

  const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];
  const rootDir = path.resolve(import.meta.dirname, "../..");

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "client", "src"),
        "@shared": path.resolve(rootDir, "shared"),
        "@assets": path.resolve(rootDir, "attached_assets"),
      },
    },
    envDir: rootDir,
    root: path.resolve(rootDir, "client"),
    publicDir: path.resolve(rootDir, "client", "public"),
    build: {
      outDir: path.resolve(rootDir, "dist/public"),
      emptyOutDir: true,
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
  };
}

// 动态导入vite，只在开发模式下使用
// 这样可以避免esbuild在生产构建时将vite打包进dist/index.js
// 注意：这个函数只会在 NODE_ENV === "development" 时被调用
export async function setupVite(app: Express, server: Server) {
  // 双重检查确保只在开发模式下运行
  if (process.env.NODE_ENV !== "development") {
    log.warn("[Vite] setupVite called in non-development mode, skipping...");
    return;
  }
  
  // 使用动态导入，确保vite只在开发模式下加载
  // 这是关键：使用字符串变量来防止esbuild静态分析
  const vitePkg = "vite";
  const { createServer: createViteServer } = await import(/* @vite-ignore */ vitePkg);
  
  // 使用内联配置，避免动态导入vite.config
  const viteConfig = await getViteConfig();
  
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // v422: 统一使用项目根目录下的dist/public
  // 无论是esbuild打包模式还是tsx直接运行模式，都使用相同的路径
  const baseDir = typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname;
  const distPath = path.resolve(baseDir, "../..", "dist", "public");
  if (!fs.existsSync(distPath)) {
    log.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // v268.1: 静态资源服务配置
  // 关键修复: 必须设置 etag: false 来防止 express.static 使用 sendfile 系统调用
  // sendfile 会绕过 compression 中间件的流处理，导致 gzip 压缩不生效
  // 带哈希文件名的资源设置长期缓存1年
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
      // HTML文件禁止缓存，确保每次部署后浏览器获取最新版本
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  // fall through to index.html if the file doesn't exist (SPA路由)
  // 对index.html设置禁止缓存，确保部署新版本后浏览器立即获取最新HTML
  app.use("*", (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
