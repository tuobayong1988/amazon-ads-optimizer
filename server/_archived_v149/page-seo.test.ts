import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * 页面SEO优化功能测试
 */
describe("Page SEO Optimization", () => {
  describe("PageMeta Component", () => {
    const pageMetaPath = path.join(__dirname, "../client/src/components/PageMeta.tsx");

    it("should have PageMeta component file", () => {
      expect(fs.existsSync(pageMetaPath)).toBe(true);
    });

    it("should export PageMeta component", () => {
      const content = fs.readFileSync(pageMetaPath, "utf-8");
      expect(content).toContain("export function PageMeta");
    });

    it("should export PAGE_META_CONFIG", () => {
      const content = fs.readFileSync(pageMetaPath, "utf-8");
      expect(content).toContain("export const PAGE_META_CONFIG");
    });

    it("should have meta config for all main pages", () => {
      const content = fs.readFileSync(pageMetaPath, "utf-8");
      const requiredPages = [
        "dashboard",
        "campaigns",
        "strategyCenter",
        "optimizationTargets",
        "smartOptimization",
        "abTesting",
        "reports",
        "settings"
      ];
      requiredPages.forEach(page => {
        expect(content).toContain(`${page}:`);
      });
    });

    it("should have title and description for each page config", () => {
      const content = fs.readFileSync(pageMetaPath, "utf-8");
      expect(content).toContain("title:");
      expect(content).toContain("description:");
      expect(content).toContain("canonicalPath:");
    });
  });

  describe("PageMeta Integration in Pages", () => {
    const pagesDir = path.join(__dirname, "../client/src/pages");

    it("should have PageMeta in Home.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "Home.tsx"), "utf-8");
      expect(content).toContain("import { PageMeta, PAGE_META_CONFIG }");
      expect(content).toContain("<PageMeta");
    });

    it("should have PageMeta in Campaigns.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "Campaigns.tsx"), "utf-8");
      expect(content).toContain("import { PageMeta, PAGE_META_CONFIG }");
      expect(content).toContain("<PageMeta");
    });

    it("should have PageMeta in StrategyCenter.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "StrategyCenter.tsx"), "utf-8");
      expect(content).toContain("PageMeta");
    });

    it("should have PageMeta in OptimizationTargets.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "OptimizationTargets.tsx"), "utf-8");
      expect(content).toContain("PageMeta");
    });

    it("should have PageMeta in SmartOptimizationCenter.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "SmartOptimizationCenter.tsx"), "utf-8");
      expect(content).toContain("PageMeta");
    });

    it("should have PageMeta in ABTest.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "ABTest.tsx"), "utf-8");
      expect(content).toContain("PageMeta");
    });

    it("should have PageMeta in Settings.tsx", () => {
      const content = fs.readFileSync(path.join(pagesDir, "Settings.tsx"), "utf-8");
      expect(content).toContain("PageMeta");
    });
  });

  describe("Dynamic Sitemap API", () => {
    const sitemapRouterPath = path.join(__dirname, "./routes/sitemap.ts");

    it("should have sitemap router file", () => {
      expect(fs.existsSync(sitemapRouterPath)).toBe(true);
    });

    it("should have sitemap.xml endpoint", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      expect(content).toContain('router.get("/sitemap.xml"');
    });

    it("should have sitemap.json endpoint", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      expect(content).toContain('router.get("/sitemap.json"');
    });

    it("should generate XML with correct structure", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(content).toContain("<urlset");
      expect(content).toContain("<url>");
      expect(content).toContain("<loc>");
      expect(content).toContain("<lastmod>");
      expect(content).toContain("<changefreq>");
      expect(content).toContain("<priority>");
    });

    it("should include all main pages in sitemap", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      const requiredPaths = [
        '"/dashboard"',
        '"/campaigns"',
        '"/strategy-center"',
        '"/optimization-targets"',
        '"/smart-optimization"',
        '"/ab-testing"',
        '"/settings"'
      ];
      requiredPaths.forEach(pagePath => {
        expect(content).toContain(pagePath);
      });
    });

    it("should set correct content type for XML", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      expect(content).toContain('Content-Type", "application/xml"');
    });

    it("should set cache control header", () => {
      const content = fs.readFileSync(sitemapRouterPath, "utf-8");
      expect(content).toContain("Cache-Control");
    });
  });

  describe("Sitemap Router Integration", () => {
    const indexPath = path.join(__dirname, "./_core/index.ts");

    it("should import sitemap router in server index", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toContain('import sitemapRouter from "../routes/sitemap"');
    });

    it("should use sitemap router in express app", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toContain('app.use("/api", sitemapRouter)');
    });
  });
});
