import { describe, it, expect } from 'vitest';

describe('Performance Optimization Tests', () => {
  describe('useDebounce Hook', () => {
    it('should export useDebounce hook from hooks directory', async () => {
      // 验证useDebounce hook文件存在
      const fs = await import('fs');
      const path = await import('path');
      const hookPath = path.join(process.cwd(), 'client/src/hooks/useDebounce.ts');
      expect(fs.existsSync(hookPath)).toBe(true);
    });

    it('should have correct debounce implementation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const hookPath = path.join(process.cwd(), 'client/src/hooks/useDebounce.ts');
      const content = fs.readFileSync(hookPath, 'utf-8');
      
      // 验证hook包含必要的实现
      expect(content).toContain('useState');
      expect(content).toContain('useEffect');
      expect(content).toContain('setTimeout');
      expect(content).toContain('clearTimeout');
    });
  });

  describe('Virtual Scrolling Integration', () => {
    it('should have @tanstack/react-virtual installed', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      
      expect(packageJson.dependencies['@tanstack/react-virtual']).toBeDefined();
    });

    it('should use virtual scrolling in Campaigns page', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const campaignsPath = path.join(process.cwd(), 'client/src/pages/Campaigns.tsx');
      const content = fs.readFileSync(campaignsPath, 'utf-8');
      
      // 验证Campaigns页面使用了虚拟滚动
      expect(content).toContain('useVirtualizer');
      expect(content).toContain('@tanstack/react-virtual');
      expect(content).toContain('rowVirtualizer');
    });

    it('should use virtual scrolling in OptimizationTargets page', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const targetsPath = path.join(process.cwd(), 'client/src/pages/OptimizationTargets.tsx');
      const content = fs.readFileSync(targetsPath, 'utf-8');
      
      // 验证OptimizationTargets页面使用了虚拟滚动
      expect(content).toContain('useVirtualizer');
      expect(content).toContain('@tanstack/react-virtual');
      expect(content).toContain('campaignVirtualizer');
    });
  });

  describe('Debounce Integration', () => {
    it('should use debounce in Campaigns page search', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const campaignsPath = path.join(process.cwd(), 'client/src/pages/Campaigns.tsx');
      const content = fs.readFileSync(campaignsPath, 'utf-8');
      
      // 验证Campaigns页面使用了防抖
      expect(content).toContain('useDebounce');
      expect(content).toContain('debouncedSearchTerm');
    });

    it('should use debounce in OptimizationTargets page search', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const targetsPath = path.join(process.cwd(), 'client/src/pages/OptimizationTargets.tsx');
      const content = fs.readFileSync(targetsPath, 'utf-8');
      
      // 验证OptimizationTargets页面使用了防抖
      expect(content).toContain('useDebounce');
      expect(content).toContain('debouncedFilterCampaignName');
    });
  });

  describe('useMemo Optimization', () => {
    it('should use useMemo for filtered campaigns in Campaigns page', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const campaignsPath = path.join(process.cwd(), 'client/src/pages/Campaigns.tsx');
      const content = fs.readFileSync(campaignsPath, 'utf-8');
      
      // 验证使用了useMemo优化筛选逻辑
      expect(content).toContain('useMemo');
      expect(content).toContain('filteredCampaigns');
    });

    it('should use useMemo for filtered campaigns in OptimizationTargets page', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const targetsPath = path.join(process.cwd(), 'client/src/pages/OptimizationTargets.tsx');
      const content = fs.readFileSync(targetsPath, 'utf-8');
      
      // 验证使用了useMemo优化筛选逻辑
      expect(content).toContain('useMemo');
      expect(content).toContain('filteredCampaigns');
    });
  });
});
