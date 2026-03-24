/**
 * MobileFilterPanel 组件交互测试
 * 
 * 测试移动端筛选面板的展开/收起、清除筛选、活跃筛选标签等交互。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MobileFilterPanel,
  MobileFilterRow,
  MobileActiveFilters,
} from './MobileFilterPanel';

// ==================== MobileFilterPanel 测试 ====================

describe('MobileFilterPanel', () => {
  // Mock useIsMobile 为 true（移动端）
  vi.mock('@/hooks/useMobile', () => ({
    useIsMobile: vi.fn(() => true),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('移动端模式', () => {
    it('应渲染折叠按钮和标题', () => {
      render(
        <MobileFilterPanel>
          <div>筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.getByText('筛选条件')).toBeDefined();
    });

    it('应使用自定义标题', () => {
      render(
        <MobileFilterPanel title="高级筛选">
          <div>筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.getByText('高级筛选')).toBeDefined();
    });

    it('初始状态下子内容不可见', () => {
      render(
        <MobileFilterPanel>
          <div data-testid="filter-content">筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.queryByTestId('filter-content')).toBeNull();
    });

    it('点击折叠按钮应展开子内容', async () => {
      const user = userEvent.setup();
      render(
        <MobileFilterPanel>
          <div data-testid="filter-content">筛选内容</div>
        </MobileFilterPanel>
      );

      // 点击折叠按钮
      await user.click(screen.getByText('筛选条件'));
      expect(screen.getByTestId('filter-content')).toBeDefined();
    });

    it('再次点击应收起子内容', async () => {
      const user = userEvent.setup();
      render(
        <MobileFilterPanel>
          <div data-testid="filter-content">筛选内容</div>
        </MobileFilterPanel>
      );

      // 展开
      await user.click(screen.getByText('筛选条件'));
      expect(screen.getByTestId('filter-content')).toBeDefined();

      // 收起
      await user.click(screen.getByText('筛选条件'));
      expect(screen.queryByTestId('filter-content')).toBeNull();
    });

    it('应显示活跃筛选数量徽标', () => {
      render(
        <MobileFilterPanel activeFiltersCount={3}>
          <div>筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.getByText('3')).toBeDefined();
    });

    it('无活跃筛选时不显示徽标', () => {
      render(
        <MobileFilterPanel activeFiltersCount={0}>
          <div>筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.queryByText('0')).toBeNull();
    });

    it('有活跃筛选时应显示清除按钮', () => {
      const onClearAll = vi.fn();
      render(
        <MobileFilterPanel activeFiltersCount={2} onClearAll={onClearAll}>
          <div>筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.getByText('清除')).toBeDefined();
    });

    it('点击清除按钮应调用 onClearAll', async () => {
      const user = userEvent.setup();
      const onClearAll = vi.fn();
      render(
        <MobileFilterPanel activeFiltersCount={2} onClearAll={onClearAll}>
          <div>筛选内容</div>
        </MobileFilterPanel>
      );

      await user.click(screen.getByText('清除'));
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it('点击清除按钮不应触发展开/收起', async () => {
      const user = userEvent.setup();
      const onClearAll = vi.fn();
      render(
        <MobileFilterPanel activeFiltersCount={2} onClearAll={onClearAll}>
          <div data-testid="filter-content">筛选内容</div>
        </MobileFilterPanel>
      );

      // 点击清除按钮（应该 stopPropagation）
      await user.click(screen.getByText('清除'));

      // 子内容不应展开
      expect(screen.queryByTestId('filter-content')).toBeNull();
    });
  });

  describe('桌面端模式', () => {
    it('桌面端应直接显示子内容', async () => {
      const { useIsMobile } = await import('@/hooks/useMobile');
      // @ts-ignore
      (useIsMobile as Record<string, unknown>).mockReturnValue(false);

      render(
        <MobileFilterPanel>
          <div data-testid="filter-content">筛选内容</div>
        </MobileFilterPanel>
      );
      expect(screen.getByTestId('filter-content')).toBeDefined();
    });
  });
});

// ==================== MobileActiveFilters 测试 ====================

describe('MobileActiveFilters', () => {
  const mockFilters = [
    { key: 'status', label: '状态', value: '活跃' },
    { key: 'type', label: '类型', value: 'SP' },
    { key: 'budget', label: '预算', value: '>$100' },
  ];

  it('应显示所有筛选标签', () => {
    render(
      <MobileActiveFilters
        filters={mockFilters}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('状态: 活跃')).toBeDefined();
    expect(screen.getByText('类型: SP')).toBeDefined();
    expect(screen.getByText('预算: >$100')).toBeDefined();
  });

  it('应显示"当前筛选"标签', () => {
    render(
      <MobileActiveFilters
        filters={mockFilters}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('当前筛选:')).toBeDefined();
  });

  it('空筛选时不渲染任何内容', () => {
    const { container } = render(
      <MobileActiveFilters
        filters={[]}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('点击标签的删除按钮应调用 onRemove', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <MobileActiveFilters
        filters={mockFilters}
        onRemove={onRemove}
        onClearAll={vi.fn()}
      />
    );

    // 找到第一个标签的删除按钮（X 图标按钮）
    const statusTag = screen.getByText('状态: 活跃');
    const removeButton = statusTag.parentElement?.querySelector('button');
    expect(removeButton).toBeDefined();

    await user.click(removeButton!);
    expect(onRemove).toHaveBeenCalledWith('status');
  });

  it('点击"清除全部"应调用 onClearAll', async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    render(
      <MobileActiveFilters
        filters={mockFilters}
        onRemove={vi.fn()}
        onClearAll={onClearAll}
      />
    );

    await user.click(screen.getByText('清除全部'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('应为每个筛选标签显示正确的 label:value 格式', () => {
    render(
      <MobileActiveFilters
        filters={[{ key: 'region', label: '地区', value: '美国' }]}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(screen.getByText('地区: 美国')).toBeDefined();
  });
});
