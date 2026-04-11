// Extracted from production dist/index.js
// Original module: server/_core/vite.ts
// Lines: 138

async function getViteConfig() {
  const [
    { default: react },
    { default: tailwindcss },
    { jsxLocPlugin },
    { vitePluginManusRuntime: vitePluginManusRuntime2 }
  ] = await Promise.all([
    Promise.resolve().then(() => (init_dist4(), dist_exports2)),
    import("@tailwindcss/vite"),
    Promise.resolve().then(() => __toESM(require_dist4())),
    Promise.resolve().then(() => (init_dist5(), dist_exports3))
  ]);
  const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime2()];
  const rootDir = import_path.default.resolve(__dirname, "../..");
  return {
    plugins,
    resolve: {
      alias: {
        "@": import_path.default.resolve(rootDir, "client", "src"),
        "@shared": import_path.default.resolve(rootDir, "shared"),
        "@assets": import_path.default.resolve(rootDir, "attached_assets")
      }
    },
    envDir: rootDir,
    root: import_path.default.resolve(rootDir, "client"),
    publicDir: import_path.default.resolve(rootDir, "client", "public"),
    build: {
      outDir: import_path.default.resolve(rootDir, "dist/public"),
      emptyOutDir: true
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
        "127.0.0.1"
      ],
      fs: {
        strict: true,
        deny: ["**/.*"]
      }
    }
  };
}
async function setupVite(app, server) {
  if (process.env.NODE_ENV !== "development") {
    log203.warn("[Vite] setupVite called in non-development mode, skipping...");
    return;
  }
  const vitePkg = "vite";
  const { createServer: createViteServer } = await import(
    /* @vite-ignore */
    vitePkg
  );
  const viteConfig = await getViteConfig();
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite2 = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite2.middlewares);
  app.use("*", async (req, res, next) => {
    const url3 = req.originalUrl;
    try {
      const clientTemplate = import_path.default.resolve(
        __dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await import_fs.default.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid3()}"`
      );
      const page = await vite2.transformIndexHtml(url3, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite2.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const baseDir = __dirname;
  const isEsbuildBundle = baseDir.endsWith("/dist") || baseDir.endsWith("\\dist");
  const distPath = isEsbuildBundle ? import_path.default.resolve(baseDir, "public") : import_path.default.resolve(baseDir, "../..", "dist", "public");
  if (!import_fs.default.existsSync(distPath)) {
    log203.warn(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(import_express.default.static(distPath, {
    maxAge: "1y",
    immutable: true,
    etag: false,
    lastModified: false,
    setHeaders: /* @__PURE__ */ __name((res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    }, "setHeaders")
  }));
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(import_path.default.resolve(distPath, "index.html"));
  });
}
var import_express, import_fs, import_path, log203;
var init_vite = __esm({
  "server/_core/vite.ts"() {
    "use strict";
    import_express = __toESM(require("express"));
    init_logger();
    import_fs = __toESM(require("fs"));
    init_nanoid();
    import_path = __toESM(require("path"));
    log203 = createModuleLogger("Vite");
    __name(getViteConfig, "getViteConfig");
    __name(setupVite, "setupVite");
    __name(serveStatic, "serveStatic");
  }
});

