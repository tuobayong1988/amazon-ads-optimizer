import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * SEO增强功能测试
 */
describe("SEO Enhancements", () => {
  const indexHtmlPath = path.join(__dirname, "../client/index.html");
  let indexHtmlContent: string;

  // 读取index.html内容
  beforeAll(() => {
    indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
  });

  describe("Open Graph Tags", () => {
    it("should have og:type meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:type"');
      expect(indexHtmlContent).toContain('content="website"');
    });

    it("should have og:url meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:url"');
    });

    it("should have og:title meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:title"');
    });

    it("should have og:description meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:description"');
    });

    it("should have og:image meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:image"');
    });

    it("should have og:locale meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:locale"');
      expect(indexHtmlContent).toContain('content="zh_CN"');
    });

    it("should have og:site_name meta tag", () => {
      expect(indexHtmlContent).toContain('property="og:site_name"');
    });
  });

  describe("Twitter Card Tags", () => {
    it("should have twitter:card meta tag", () => {
      expect(indexHtmlContent).toContain('name="twitter:card"');
      expect(indexHtmlContent).toContain('content="summary_large_image"');
    });

    it("should have twitter:url meta tag", () => {
      expect(indexHtmlContent).toContain('name="twitter:url"');
    });

    it("should have twitter:title meta tag", () => {
      expect(indexHtmlContent).toContain('name="twitter:title"');
    });

    it("should have twitter:description meta tag", () => {
      expect(indexHtmlContent).toContain('name="twitter:description"');
    });

    it("should have twitter:image meta tag", () => {
      expect(indexHtmlContent).toContain('name="twitter:image"');
    });
  });

  describe("Additional SEO Meta Tags", () => {
    it("should have robots meta tag", () => {
      expect(indexHtmlContent).toContain('name="robots"');
      expect(indexHtmlContent).toContain('content="index, follow"');
    });

    it("should have author meta tag", () => {
      expect(indexHtmlContent).toContain('name="author"');
    });

    it("should have canonical link tag", () => {
      expect(indexHtmlContent).toContain('rel="canonical"');
    });
  });

  describe("JSON-LD Structured Data", () => {
    it("should have SoftwareApplication schema", () => {
      expect(indexHtmlContent).toContain('"@type": "SoftwareApplication"');
    });

    it("should have Organization schema", () => {
      expect(indexHtmlContent).toContain('"@type": "Organization"');
    });

    it("should have FAQPage schema", () => {
      expect(indexHtmlContent).toContain('"@type": "FAQPage"');
    });

    it("should have valid JSON-LD script tags", () => {
      expect(indexHtmlContent).toContain('type="application/ld+json"');
    });

    it("should have schema.org context", () => {
      expect(indexHtmlContent).toContain('"@context": "https://schema.org"');
    });

    it("should have application name in SoftwareApplication", () => {
      expect(indexHtmlContent).toContain('"name": "Amazon Ads Optimizer"');
    });

    it("should have application category", () => {
      expect(indexHtmlContent).toContain('"applicationCategory": "BusinessApplication"');
    });

    it("should have operating system", () => {
      expect(indexHtmlContent).toContain('"operatingSystem": "Web"');
    });

    it("should have offers in SoftwareApplication", () => {
      expect(indexHtmlContent).toContain('"@type": "Offer"');
    });

    it("should have aggregate rating", () => {
      expect(indexHtmlContent).toContain('"@type": "AggregateRating"');
    });

    it("should have feature list", () => {
      expect(indexHtmlContent).toContain('"featureList"');
    });

    it("should have FAQ questions", () => {
      expect(indexHtmlContent).toContain('"@type": "Question"');
      expect(indexHtmlContent).toContain('"acceptedAnswer"');
    });
  });

  describe("Basic SEO Tags", () => {
    it("should have title tag", () => {
      expect(indexHtmlContent).toContain("<title>");
      expect(indexHtmlContent).toContain("</title>");
    });

    it("should have description meta tag", () => {
      expect(indexHtmlContent).toContain('name="description"');
    });

    it("should have keywords meta tag", () => {
      expect(indexHtmlContent).toContain('name="keywords"');
    });

    it("should have lang attribute on html tag", () => {
      expect(indexHtmlContent).toContain('lang="zh-CN"');
    });

    it("should have charset meta tag", () => {
      expect(indexHtmlContent).toContain('charset="UTF-8"');
    });

    it("should have viewport meta tag", () => {
      expect(indexHtmlContent).toContain('name="viewport"');
    });
  });

  describe("Title Length", () => {
    it("should have title between 30-60 characters", () => {
      const titleMatch = indexHtmlContent.match(/<title>(.*?)<\/title>/);
      expect(titleMatch).not.toBeNull();
      const titleLength = titleMatch![1].length;
      expect(titleLength).toBeGreaterThanOrEqual(30);
      expect(titleLength).toBeLessThanOrEqual(60);
    });
  });

  describe("Keywords Count", () => {
    it("should have 3-8 keywords", () => {
      const keywordsMatch = indexHtmlContent.match(/name="keywords"\s+content="([^"]+)"/);
      expect(keywordsMatch).not.toBeNull();
      const keywords = keywordsMatch![1].split(",");
      expect(keywords.length).toBeGreaterThanOrEqual(3);
      expect(keywords.length).toBeLessThanOrEqual(8);
    });
  });
});
