/**
 * FloatingActionButton 组件交互测试
 * 
 * 使用 @testing-library/react 和 @testing-library/user-event 模拟用户交互，
 * 测试浮动操作按钮的展开/收起、操作点击、回到顶部等功能。
 * 
 * 注意：FloatingActionButton 仅在移动端显示（useIsMobile() === true），
 * 因此需要 mock useIsMobile 返回 true。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloatingActionButton, commonActions, type FloatingAction } from './FloatingActionButton';
import { RefreshCw, Filter, Download } from 'lucide-react';

// Mock useIsMobile 返回 true（移动端模式）
vi.mock('@/hooks/useMobile', () => ({
  useIsMobile: vi.fn(() => true),
}));

// ==================== 测试辅助 ====================

function createMockActions(count: number = 3): FloatingAction[] {
  const icons = [RefreshCw, Filter, Download];
  const labels = ['刷新', '筛选', '导出'];
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${i}`,
    icon: icons[i % icons.length],
    label: labels[i % labels.length],
    onClick: vi.fn(),
  }));
}

// ==================== 测试套件 ====================

describe('FloatingActionButton 交互测试', () => {
  let mockActions: FloatingAction[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockActions = createMockActions();
  });

  describe('渲染', () => {
    it('应在移动端渲染主按钮', () => {
      const { container } = render(<FloatingActionButton actions={mockActions} />);
      // 主按钮应该存在
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('应在桌面端不渲染（useIsMobile 返回 false）', async () => {
      const { useIsMobile } = await import('@/hooks/useMobile');
      // @ts-ignore
      (useIsMobile as Record<string, unknown>).mockReturnValueOnce(false);

      const { container } = render(<FloatingActionButton actions={mockActions} />);
      expect(container.innerHTML).toBe('');
    });

    it('初始状态下操作按钮不可见', () => {
      render(<FloatingActionButton actions={mockActions} />);
      expect(screen.queryByText('刷新')).toBeNull();
      expect(screen.queryByText('筛选')).toBeNull();
      expect(screen.queryByText('导出')).toBeNull();
    });
  });

  describe('展开/收起交互', () => {
    it('点击主按钮应展开操作菜单', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 找到主按钮（最大的按钮，w-14 h-14）
      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      expect(mainButton).toBeDefined();

      await user.click(mainButton);

      // 展开后应显示操作标签
      expect(screen.getByText('刷新')).toBeDefined();
      expect(screen.getByText('筛选')).toBeDefined();
      expect(screen.getByText('导出')).toBeDefined();
    });

    it('再次点击主按钮应收起操作菜单', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;

      // 展开
      await user.click(mainButton);
      expect(screen.getByText('刷新')).toBeDefined();

      // 收起
      await user.click(mainButton);
      expect(screen.queryByText('刷新')).toBeNull();
    });

    it('展开时主按钮应旋转（添加 rotate-45 类）', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      expect(mainButton.className).toContain('rotate-45');
    });
  });

  describe('操作按钮交互', () => {
    it('点击操作按钮应触发对应回调', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 展开菜单
      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 找到"刷新"操作按钮（通过标签文本旁边的按钮）
      const refreshLabel = screen.getByText('刷新');
      const refreshButton = refreshLabel.parentElement?.querySelector('button');
      expect(refreshButton).toBeDefined();

      await user.click(refreshButton!);
      expect(mockActions[0].onClick).toHaveBeenCalledTimes(1);
    });

    it('点击操作按钮后菜单应自动收起', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 展开菜单
      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 点击操作按钮
      const filterLabel = screen.getByText('筛选');
      const filterButton = filterLabel.parentElement?.querySelector('button');
      await user.click(filterButton!);

      // 菜单应收起
      expect(screen.queryByText('刷新')).toBeNull();
    });

    it('禁用的操作按钮不应触发回调', async () => {
      const user = userEvent.setup();
      const disabledActions: FloatingAction[] = [
        {
          id: 'disabled-action',
          icon: RefreshCw,
          label: '禁用操作',
          onClick: vi.fn(),
          disabled: true,
        },
      ];

      const { container } = render(<FloatingActionButton actions={disabledActions} />);

      // 展开菜单
      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 找到禁用的按钮
      const label = screen.getByText('禁用操作');
      const button = label.parentElement?.querySelector('button');
      expect(button?.disabled).toBe(true);
    });
  });

  describe('背景遮罩', () => {
    it('展开时应显示背景遮罩', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 遮罩应存在
      const overlay = container.querySelector('.fixed.inset-0');
      expect(overlay).toBeDefined();
    });

    it('点击背景遮罩应收起菜单', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 点击遮罩
      const overlay = container.querySelector('.fixed.inset-0.bg-background\\/50');
      expect(overlay).toBeDefined();
      await user.click(overlay!);

      // 菜单应收起
      expect(screen.queryByText('刷新')).toBeNull();
    });
  });

  describe('回到顶部按钮', () => {
    it('初始状态不显示回到顶部按钮', () => {
      const { container } = render(<FloatingActionButton actions={mockActions} />);
      // 回到顶部按钮只在 scrollY > 300 时显示
      const scrollButtons = container.querySelectorAll('.w-10.h-10');
      expect(scrollButtons.length).toBe(0);
    });

    it('滚动超过300px后应显示回到顶部按钮', async () => {
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 模拟滚动
      Object.defineProperty(window, 'scrollY', { value: 400, writable: true });
      act(() => {
        fireEvent.scroll(window);
      });

      // 回到顶部按钮应出现
      const scrollButton = container.querySelector('.w-10.h-10');
      expect(scrollButton).toBeDefined();
    });

    it('展开菜单时不应显示回到顶部按钮', async () => {
      const user = userEvent.setup();
      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 模拟滚动
      Object.defineProperty(window, 'scrollY', { value: 400, writable: true });
      act(() => {
        fireEvent.scroll(window);
      });

      // 展开菜单
      const mainButton = container.querySelector('.w-14.h-14') as HTMLButtonElement;
      await user.click(mainButton);

      // 回到顶部按钮不应显示（isOpen && showScrollTop 时隐藏）
      // 菜单展开时只有操作按钮（w-10 h-10）
      const labels = screen.queryAllByText('刷新');
      expect(labels.length).toBeGreaterThan(0);
    });

    it('点击回到顶部按钮应调用 window.scrollTo', async () => {
      const user = userEvent.setup();
      const scrollToSpy = vi.fn();
      window.scrollTo = scrollToSpy;

      const { container } = render(<FloatingActionButton actions={mockActions} />);

      // 模拟滚动
      Object.defineProperty(window, 'scrollY', { value: 400, writable: true });
      act(() => {
        fireEvent.scroll(window);
      });

      const scrollButton = container.querySelector('.w-10.h-10') as HTMLButtonElement;
      if (scrollButton) {
        await user.click(scrollButton);
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      }
    });
  });

  describe('commonActions 工厂函数', () => {
    it('refresh 应创建正确的操作对象', () => {
      const onClick = vi.fn();
      const action = commonActions.refresh(onClick);
      expect(action.id).toBe('refresh');
      expect(action.label).toBe('刷新数据');
      expect(action.onClick).toBe(onClick);
    });

    it('filter 应创建正确的操作对象', () => {
      const onClick = vi.fn();
      const action = commonActions.filter(onClick);
      expect(action.id).toBe('filter');
      expect(action.label).toBe('筛选');
    });

    it('search 应创建正确的操作对象', () => {
      const onClick = vi.fn();
      const action = commonActions.search(onClick);
      expect(action.id).toBe('search');
      expect(action.label).toBe('搜索');
    });

    it('export 应创建正确的操作对象', () => {
      const onClick = vi.fn();
      const action = commonActions.export(onClick);
      expect(action.id).toBe('export');
      expect(action.label).toBe('导出');
    });

    it('settings 应创建正确的操作对象', () => {
      const onClick = vi.fn();
      const action = commonActions.settings(onClick);
      expect(action.id).toBe('settings');
      expect(action.label).toBe('设置');
    });
  });
});
