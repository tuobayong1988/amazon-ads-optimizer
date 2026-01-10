import { Router } from "express";

const router = Router();

// 页面配置
const pages = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/dashboard", changefreq: "daily", priority: 0.9 },
  { path: "/campaigns", changefreq: "daily", priority: 0.9 },
  { path: "/strategy-center", changefreq: "weekly", priority: 0.8 },
  { path: "/optimization-targets", changefreq: "weekly", priority: 0.8 },
  { path: "/smart-optimization", changefreq: "daily", priority: 0.8 },
  { path: "/ab-testing", changefreq: "weekly", priority: 0.7 },
  { path: "/reports", changefreq: "daily", priority: 0.7 },
  { path: "/settings", changefreq: "monthly", priority: 0.5 },
];

/**
 * 动态生成sitemap.xml
 * 根据当前日期自动更新lastmod
 */
router.get("/sitemap.xml", (req, res) => {
  const baseUrl = process.env.VITE_APP_URL || "https://amazon-ads-optimizer.manus.space";
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD格式

  const urls = pages.map(page => `
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
  res.header("Cache-Control", "public, max-age=3600"); // 缓存1小时
  res.send(sitemap);
});

/**
 * 返回sitemap配置信息（JSON格式）
 */
router.get("/sitemap.json", (req, res) => {
  const baseUrl = process.env.VITE_APP_URL || "https://amazon-ads-optimizer.manus.space";
  const today = new Date().toISOString().split("T")[0];

  const sitemapData = {
    baseUrl,
    lastmod: today,
    pages: pages.map(page => ({
      url: `${baseUrl}${page.path}`,
      ...page,
      lastmod: today,
    })),
  };

  res.json(sitemapData);
});

export default router;
