// Extracted from production dist/index.js
// Original module: server/routes/sitemap.ts
// Lines: 52

var import_express2, router2, pages, sitemap_default;
var init_sitemap = __esm({
  "server/routes/sitemap.ts"() {
    "use strict";
    import_express2 = require("express");
    router2 = (0, import_express2.Router)();
    pages = [
      { path: "/", changefreq: "weekly", priority: 1 },
      { path: "/dashboard", changefreq: "daily", priority: 0.9 },
      { path: "/campaigns", changefreq: "daily", priority: 0.9 },
      { path: "/strategy-center", changefreq: "weekly", priority: 0.8 },
      { path: "/optimization-targets", changefreq: "weekly", priority: 0.8 },
      { path: "/smart-optimization", changefreq: "daily", priority: 0.8 },
      { path: "/ab-testing", changefreq: "weekly", priority: 0.7 },
      { path: "/reports", changefreq: "daily", priority: 0.7 },
      { path: "/settings", changefreq: "monthly", priority: 0.5 }
    ];
    router2.get("/sitemap.xml", (req, res) => {
      const baseUrl = process.env.VITE_APP_URL || "https://amazon-ads-optimizer.manus.space";
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const urls = pages.map((page) => `
  <url>
    <loc>${baseUrl}${page.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join("");
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;
      res.header("Content-Type", "application/xml");
      res.header("Cache-Control", "public, max-age=3600");
      res.send(sitemap);
    });
    router2.get("/sitemap.json", (req, res) => {
      const baseUrl = process.env.VITE_APP_URL || "https://amazon-ads-optimizer.manus.space";
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const sitemapData = {
        baseUrl,
        lastmod: today,
        pages: pages.map((page) => ({
          url: `${baseUrl}${page.path}`,
          ...page,
          lastmod: today
        }))
      };
      res.json(sitemapData);
    });
    sitemap_default = router2;
  }
});

