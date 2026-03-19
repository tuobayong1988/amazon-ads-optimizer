/**
 * MobileDataCard 组件交互测试
 * 
 * 测试移动端数据卡片的渲染、点击交互、趋势显示、列表卡片等功能。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MobileDataCard,
  MobileDataCardGrid,
  MobileListCard,
} from './MobileDataCard';

// Mock useIsMobile
vi.mock('@/hooks/useMobile', () => ({
  useIsMobile: vi.fn(() => true),
}));

// ==================== MobileDataCard 测试 ====================

describe('MobileDataCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本渲染', () => {
    it('应显示标题和值', () => {
      render(<MobileDataCard title="总花费" value="$1,234.56" />);
      expect(screen.getByText('总花费')).toBeDefined();
      expect(screen.getByText('$1,234.56')).toBeDefined();
    });

    it('应显示数字类型的值', () => {
      render(<MobileDataCard title="点击数" value={12345} />);
      expect(screen.getByText('12345')).toBeDefined();
    });

    it('应显示副标题', () => {
      render(
        <MobileDataCard
          title="ACoS"
          value="25.3%"
          subtitle="目标: 20%"
        />
      );
      expect(screen.getByText('目标: 20%')).toBeDefined();
    });

    it('应显示图标', () => {
      render(
        <MobileDataCard
          title="收入"
          value="$5,000"
          icon={<span data-testid="custom-icon">💰</span>}
        />
      );
      expect(screen.getByTestId('custom-icon')).toBeDefined();
    });

    it('应应用自定义 className', () => {
      const { container } = render(
        <MobileDataCard
          title="测试"
          value="100"
          className="custom-class"
        />
      );
      expect(container.querySelector('.custom-class')).toBeDefined();
    });
  });

  describe('趋势显示', () => {
    it('应显示正向趋势（↑）', () => {
      render(
        <MobileDataCard
          title="收入"
          value="$5,000"
          trend={{ value: 15.3, isPositive: true }}
        />
      );
      expect(screen.getByText('↑')).toBeDefined();
      expect(screen.getByText('15.3%')).toBeDefined();
      expect(screen.getByText('vs 上期')).toBeDefined();
    });

    it('应显示负向趋势（↓）', () => {
      render(
        <MobileDataCard
          title="花费"
          value="$3,000"
          trend={{ value: -8.7, isPositive: false }}
        />
      );
      expect(screen.getByText('↓')).toBeDefined();
      expect(screen.getByText('8.7%')).toBeDefined();
    });

    it('应使用绿色显示正向趋势', () => {
      const { container } = render(
        <MobileDataCard
          title="收入"
          value="$5,000"
          trend={{ value: 10, isPositive: true }}
        />
      );
      const trendElement = container.querySelector('.text-green-500');
      expect(trendElement).toBeDefined();
    });

    it('应使用红色显示负向趋势', () => {
      const { container } = render(
        <MobileDataCard
          title="花费"
          value="$3,000"
          trend={{ value: -5, isPositive: false }}
        />
      );
      const trendElement = container.querySelector('.text-red-500');
      expect(trendElement).toBeDefined();
    });

    it('不传 trend 时不显示趋势区域', () => {
      render(<MobileDataCard title="测试" value="100" />);
      expect(screen.queryByText('vs 上期')).toBeNull();
    });
  });

  describe('点击交互', () => {
    it('有 onClick 时应渲染为 button', () => {
      const onClick = vi.fn();
      const { container } = render(
        <MobileDataCard title="测试" value="100" onClick={onClick} />
      );
      const button = container.querySelector('button');
      expect(button).toBeDefined();
    });

    it('无 onClick 时应渲染为 div', () => {
      const { container } = render(
        <MobileDataCard title="测试" value="100" />
      );
      const button = container.querySelector('button');
      expect(button).toBeNull();
    });

    it('点击卡片应触发 onClick', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const { container } = render(
        <MobileDataCard title="测试" value="100" onClick={onClick} />
      );

      const button = container.querySelector('button')!;
      await user.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('有 onClick 时应显示右箭头图标', () => {
      const { container } = render(
        <MobileDataCard title="测试" value="100" onClick={vi.fn()} />
      );
      // ChevronRight 图标应该存在
      const svg = container.querySelector('svg');
      expect(svg).toBeDefined();
    });
  });
});

// ==================== MobileDataCardGrid 测试 ====================

describe('MobileDataCardGrid', () => {
  it('应渲染网格容器', () => {
    const { container } = render(
      <MobileDataCardGrid>
        <div>Card 1</div>
        <div>Card 2</div>
      </MobileDataCardGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toBeDefined();
    expect(grid?.className).toContain('grid-cols-2');
  });

  it('应应用自定义 className', () => {
    const { container } = render(
      <MobileDataCardGrid className="my-custom-class">
        <div>Card 1</div>
      </MobileDataCardGrid>
    );
    expect(container.querySelector('.my-custom-class')).toBeDefined();
  });
});

// ==================== MobileListCard 测试 ====================

describe('MobileListCard', () => {
  const mockItems = [
    { id: '1', label: 'Campaign Alpha', value: '$1,234', subtitle: 'SP' },
    { id: '2', label: 'Campaign Beta', value: '$567', subtitle: 'SB' },
    { id: '3', label: 'Campaign Gamma', value: '$890' },
  ];

  describe('基本渲染', () => {
    it('应显示标题', () => {
      render(
        <MobileListCard
          title="Top Campaigns"
          items={mockItems}
        />
      );
      expect(screen.getByText('Top Campaigns')).toBeDefined();
    });

    it('应显示所有列表项', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
        />
      );
      expect(screen.getByText('Campaign Alpha')).toBeDefined();
      expect(screen.getByText('Campaign Beta')).toBeDefined();
      expect(screen.getByText('Campaign Gamma')).toBeDefined();
    });

    it('应显示列表项的值', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
        />
      );
      expect(screen.getByText('$1,234')).toBeDefined();
      expect(screen.getByText('$567')).toBeDefined();
      expect(screen.getByText('$890')).toBeDefined();
    });

    it('应显示列表项的副标题', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
        />
      );
      expect(screen.getByText('SP')).toBeDefined();
      expect(screen.getByText('SB')).toBeDefined();
    });
  });

  describe('空状态', () => {
    it('空列表应显示默认空消息', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={[]}
        />
      );
      expect(screen.getByText('暂无数据')).toBeDefined();
    });

    it('空列表应显示自定义空消息', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={[]}
          emptyMessage="没有找到匹配的广告活动"
        />
      );
      expect(screen.getByText('没有找到匹配的广告活动')).toBeDefined();
    });
  });

  describe('点击交互', () => {
    it('有 onItemClick 时点击列表项应触发回调', async () => {
      const user = userEvent.setup();
      const onItemClick = vi.fn();
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
          onItemClick={onItemClick}
        />
      );

      await user.click(screen.getByText('Campaign Alpha'));
      expect(onItemClick).toHaveBeenCalledWith('1');
    });

    it('点击不同列表项应传递正确的 id', async () => {
      const user = userEvent.setup();
      const onItemClick = vi.fn();
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
          onItemClick={onItemClick}
        />
      );

      await user.click(screen.getByText('Campaign Beta'));
      expect(onItemClick).toHaveBeenCalledWith('2');

      await user.click(screen.getByText('Campaign Gamma'));
      expect(onItemClick).toHaveBeenCalledWith('3');
    });

    it('无 onItemClick 时列表项按钮应禁用', () => {
      render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button: unknown) => {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it('有 onItemClick 时应显示右箭头图标', () => {
      const { container } = render(
        <MobileListCard
          title="Campaigns"
          items={mockItems}
          onItemClick={vi.fn()}
        />
      );
      // 每个列表项都应有 ChevronRight 图标
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBe(mockItems.length);
    });

    it('支持数字类型的 id', async () => {
      const user = userEvent.setup();
      const onItemClick = vi.fn();
      const numericItems = [
        { id: 42, label: 'Item 42', value: '100' },
      ];
      render(
        <MobileListCard
          title="Items"
          items={numericItems}
          onItemClick={onItemClick}
        />
      );

      await user.click(screen.getByText('Item 42'));
      expect(onItemClick).toHaveBeenCalledWith(42);
    });
  });
});
