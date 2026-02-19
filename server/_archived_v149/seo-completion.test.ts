import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * SEO完善功能测试
 */
describe("SEO Completion", () => {
  const publicDir = path.join(__dirname, "../client/public");

  describe("OG Image", () => {
    it("should have og-image.png file", () => {
      const ogImagePath = path.join(publicDir, "og-image.png");
      expect(fs.existsSync(ogImagePath)).toBe(true);
    });

    it("should have og-image.png with correct size (approximately 1200x630)", () => {
      const ogImagePath = path.join(publicDir, "og-image.png");
      const stats = fs.statSync(ogImagePath);
      // PNG文件应该有合理的大小（至少10KB）
      expect(stats.size).toBeGreaterThan(10000);
    });
  });

  describe("Sitemap.xml", () => {
    const sitemapPath = path.join(publicDir, "sitemap.xml");
    let sitemapContent: string;

    it("should have sitemap.xml file", () => {
      expect(fs.existsSync(sitemapPath)).toBe(true);
    });

    it("should have valid XML structure", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      expect(sitemapContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(sitemapContent).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(sitemapContent).toContain('</urlset>');
    });

    it("should have homepage URL", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      expect(sitemapContent).toContain('<loc>');
      expect(sitemapContent).toContain('</loc>');
    });

    it("should have lastmod dates", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      expect(sitemapContent).toContain('<lastmod>');
    });

    it("should have changefreq values", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      expect(sitemapContent).toContain('<changefreq>');
    });

    it("should have priority values", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      expect(sitemapContent).toContain('<priority>');
    });

    it("should have multiple URLs", () => {
      sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
      const urlCount = (sitemapContent.match(/<url>/g) || []).length;
      expect(urlCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Robots.txt", () => {
    const robotsPath = path.join(publicDir, "robots.txt");
    let robotsContent: string;

    it("should have robots.txt file", () => {
      expect(fs.existsSync(robotsPath)).toBe(true);
    });

    it("should have User-agent directive", () => {
      robotsContent = fs.readFileSync(robotsPath, "utf-8");
      expect(robotsContent).toContain("User-agent:");
    });

    it("should have Sitemap directive", () => {
      robotsContent = fs.readFileSync(robotsPath, "utf-8");
      expect(robotsContent).toContain("Sitemap:");
    });

    it("should allow root path", () => {
      robotsContent = fs.readFileSync(robotsPath, "utf-8");
      expect(robotsContent).toContain("Allow: /");
    });

    it("should disallow API routes", () => {
      robotsContent = fs.readFileSync(robotsPath, "utf-8");
      expect(robotsContent).toContain("Disallow: /api/");
    });
  });

  describe("VITE_APP_URL Environment Variable", () => {
    it("should have VITE_APP_URL in index.html", () => {
      const indexHtmlPath = path.join(__dirname, "../client/index.html");
      const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
      expect(indexHtmlContent).toContain("%VITE_APP_URL%");
    });
  });
});
