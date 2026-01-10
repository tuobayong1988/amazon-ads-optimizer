import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('博客功能测试', () => {
  describe('博客数据模型', () => {
    it('应该存在博客数据文件', () => {
      const blogDataPath = path.join(__dirname, '../client/src/data/blogPosts.ts');
      expect(fs.existsSync(blogDataPath)).toBe(true);
    });

    it('博客数据文件应该包含12篇文章', async () => {
      const blogDataPath = path.join(__dirname, '../client/src/data/blogPosts.ts');
      const content = fs.readFileSync(blogDataPath, 'utf-8');
      // 检查是否有12个博客文章定义
      const postMatches = content.match(/id:\s*['"][\w-]+['"]/g);
      expect(postMatches).toBeTruthy();
      expect(postMatches!.length).toBeGreaterThanOrEqual(12);
    });

    it('博客数据应该包含算法解析和客户案例两种分类', async () => {
      const blogDataPath = path.join(__dirname, '../client/src/data/blogPosts.ts');
      const content = fs.readFileSync(blogDataPath, 'utf-8');
      expect(content).toContain('category: "algorithm"');
      expect(content).toContain('category: "case-study"');
    });
  });

  describe('博客配图', () => {
    const blogImagesDir = path.join(__dirname, '../client/public/blog');

    it('博客配图目录应该存在', () => {
      expect(fs.existsSync(blogImagesDir)).toBe(true);
    });

    it('应该有10篇算法解析文章的配图', () => {
      const algorithmImages = [
        'dynamic-bid-optimization.png',
        'acos-target-optimization.png',
        'negative-keyword-automation.png',
        'dayparting-strategy.png',
        'budget-allocation-algorithm.png',
        'conversion-rate-prediction.png',
        'keyword-harvesting.png',
        'placement-optimization.png',
        'ab-testing-framework.png',
        'anomaly-detection.png'
      ];
      
      algorithmImages.forEach(image => {
        const imagePath = path.join(blogImagesDir, image);
        expect(fs.existsSync(imagePath)).toBe(true);
      });
    });

    it('应该有2篇客户案例文章的配图', () => {
      const caseStudyImages = [
        'case-study-elarafit.png',
        'case-study-homeessence.png'
      ];
      
      caseStudyImages.forEach(image => {
        const imagePath = path.join(blogImagesDir, image);
        expect(fs.existsSync(imagePath)).toBe(true);
      });
    });
  });

  describe('博客页面组件', () => {
    it('博客列表页面组件应该存在', () => {
      const blogPagePath = path.join(__dirname, '../client/src/pages/Blog.tsx');
      expect(fs.existsSync(blogPagePath)).toBe(true);
    });

    it('博客详情页面组件应该存在', () => {
      const blogPostPagePath = path.join(__dirname, '../client/src/pages/BlogPost.tsx');
      expect(fs.existsSync(blogPostPagePath)).toBe(true);
    });

    it('博客列表页面应该支持分类筛选', () => {
      const blogPagePath = path.join(__dirname, '../client/src/pages/Blog.tsx');
      const content = fs.readFileSync(blogPagePath, 'utf-8');
      expect(content).toContain('activeCategory');
      expect(content).toContain('算法解析');
      expect(content).toContain('客户案例');
    });

    it('博客列表页面应该支持搜索功能', () => {
      const blogPagePath = path.join(__dirname, '../client/src/pages/Blog.tsx');
      const content = fs.readFileSync(blogPagePath, 'utf-8');
      expect(content).toContain('searchQuery');
      expect(content).toContain('搜索文章');
    });

    it('博客详情页面应该显示相关文章', () => {
      const blogPostPagePath = path.join(__dirname, '../client/src/pages/BlogPost.tsx');
      const content = fs.readFileSync(blogPostPagePath, 'utf-8');
      expect(content).toContain('relatedPosts');
      expect(content).toContain('相关文章');
    });
  });

  describe('首页博客栏', () => {
    it('首页应该包含博客栏', () => {
      const homePagePath = path.join(__dirname, '../client/src/pages/Home.tsx');
      const content = fs.readFileSync(homePagePath, 'utf-8');
      expect(content).toContain('Blog Section');
      expect(content).toContain('广告优化博客');
      expect(content).toContain('getAllPosts');
    });

    it('首页博客栏应该显示最新6篇文章', () => {
      const homePagePath = path.join(__dirname, '../client/src/pages/Home.tsx');
      const content = fs.readFileSync(homePagePath, 'utf-8');
      expect(content).toContain('slice(0, 6)');
    });
  });

  describe('路由配置', () => {
    it('App.tsx应该包含博客路由', () => {
      const appPath = path.join(__dirname, '../client/src/App.tsx');
      const content = fs.readFileSync(appPath, 'utf-8');
      expect(content).toContain('import Blog from "@/pages/Blog"');
      expect(content).toContain('import BlogPost from "@/pages/BlogPost"');
      expect(content).toContain('path="/blog"');
      expect(content).toContain('path="/blog/:slug"');
    });
  });

  describe('客户案例内容', () => {
    it('客户案例应该包含优化前后的数据对比', () => {
      const blogDataPath = path.join(__dirname, '../client/src/data/blogPosts.ts');
      const content = fs.readFileSync(blogDataPath, 'utf-8');
      // 检查ElaraFit案例
      expect(content).toContain('ElaraFit');
      expect(content).toContain('65%');
      expect(content).toContain('28%');
      // 检查HomeEssence案例
      expect(content).toContain('HomeEssence');
      expect(content).toContain('ROI');
    });
  });
});
