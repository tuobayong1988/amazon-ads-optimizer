/**
 * OperationConfirmDialog 组件交互测试
 * 
 * 使用 @testing-library/react 和 @testing-library/user-event 模拟用户交互，
 * 测试确认弹窗的完整交互流程：打开、查看变更、勾选确认、提交、取消等。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OperationConfirmDialog, {
  useOperationConfirm,
  type ChangeItem,
  type OperationType,
} from './OperationConfirmDialog';

// ==================== 测试辅助 ====================

function createMockChanges(count: number = 2): ChangeItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `change-${i}`,
    name: `Campaign ${i + 1}`,
    field: 'budget',
    fieldLabel: '日预算',
    oldValue: 50 + i * 10,
    newValue: 80 + i * 10,
    unit: '$',
    changePercent: ((80 + i * 10) - (50 + i * 10)) / (50 + i * 10) * 100,
  }));
}

function createDecreaseChanges(): ChangeItem[] {
  return [
    {
      id: 'dec-1',
      name: 'Campaign A',
      field: 'bid',
      fieldLabel: '竞价',
      oldValue: 2.50,
      newValue: 1.80,
      unit: '$',
      changePercent: -28.0,
    },
  ];
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  operationType: 'budget_adjustment' as OperationType,
  changes: createMockChanges(),
};

// ==================== 测试套件 ====================

describe('OperationConfirmDialog 交互测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染与显示', () => {
    it('应正确渲染弹窗标题和描述', () => {
      render(<OperationConfirmDialog {...defaultProps} />);
      expect(screen.getByText('预算调整确认')).toBeDefined();
      expect(screen.getByText('请确认以下变更内容，此操作将立即生效')).toBeDefined();
    });

    it('应显示自定义标题和描述', () => {
      render(
        <OperationConfirmDialog
          {...defaultProps}
          title="自定义标题"
          description="自定义描述信息"
        />
      );
      expect(screen.getByText('自定义标题')).toBeDefined();
      expect(screen.getByText('自定义描述信息')).toBeDefined();
    });

    it('应根据操作类型显示不同的标题', () => {
      const { rerender } = render(
        <OperationConfirmDialog {...defaultProps} operationType="bid_modification" />
      );
      expect(screen.getByText('竞价修改确认')).toBeDefined();

      rerender(
        <OperationConfirmDialog {...defaultProps} operationType="campaign_pause" />
      );
      expect(screen.getByText('暂停广告活动确认')).toBeDefined();
    });

    it('应显示风险等级标签', () => {
      render(
        <OperationConfirmDialog {...defaultProps} operationType="batch_operation" />
      );
      expect(screen.getByText('高风险')).toBeDefined();
    });

    it('应显示变更统计信息', () => {
      render(<OperationConfirmDialog {...defaultProps} />);
      // 受影响项目数
      expect(screen.getByText('受影响项目')).toBeDefined();
      // 增加数量
      expect(screen.getByText('增加')).toBeDefined();
      // 减少数量
      expect(screen.getByText('减少')).toBeDefined();
    });

    it('应显示变更详情列表', () => {
      render(<OperationConfirmDialog {...defaultProps} />);
      expect(screen.getByText('变更详情预览')).toBeDefined();
      expect(screen.getByText('Campaign 1')).toBeDefined();
      expect(screen.getByText('Campaign 2')).toBeDefined();
    });

    it('应显示警告信息', () => {
      render(
        <OperationConfirmDialog
          {...defaultProps}
          warningMessage="此操作不可撤销，请谨慎操作"
        />
      );
      expect(screen.getByText('此操作不可撤销，请谨慎操作')).toBeDefined();
    });

    it('应在变更超过20项时显示省略提示', () => {
      const manyChanges = createMockChanges(25);
      render(
        <OperationConfirmDialog {...defaultProps} changes={manyChanges} />
      );
      expect(screen.getByText('还有 5 项变更...')).toBeDefined();
    });

    it('应显示自定义的受影响数量', () => {
      render(
        <OperationConfirmDialog {...defaultProps} affectedCount={100} />
      );
      expect(screen.getByText('100')).toBeDefined();
    });

    it('应显示变更百分比', () => {
      render(<OperationConfirmDialog {...defaultProps} />);
      // 变更百分比应该以 +XX.X% 格式显示
      const badges = screen.getAllByText(/\+\d+\.\d%/);
      expect(badges.length).toBeGreaterThan(0);
    });

    it('应正确格式化货币值', () => {
      render(<OperationConfirmDialog {...defaultProps} />);
      // 旧值和新值应该以 $XX.XX 格式显示
      expect(screen.getByText('$50.00')).toBeDefined();
      expect(screen.getByText('$80.00')).toBeDefined();
    });

    it('应正确显示减少的变更', () => {
      render(
        <OperationConfirmDialog
          {...defaultProps}
          changes={createDecreaseChanges()}
        />
      );
      expect(screen.getByText('$2.50')).toBeDefined();
      expect(screen.getByText('$1.80')).toBeDefined();
      expect(screen.getByText('-28.0%')).toBeDefined();
    });
  });

  describe('确认复选框交互', () => {
    it('应在需要确认时显示复选框', () => {
      render(<OperationConfirmDialog {...defaultProps} requireConfirmation={true} />);
      expect(screen.getByText(/我已确认以上变更内容/)).toBeDefined();
    });

    it('应在不需要确认时隐藏复选框', () => {
      render(<OperationConfirmDialog {...defaultProps} requireConfirmation={false} />);
      expect(screen.queryByText(/我已确认以上变更内容/)).toBeNull();
    });

    it('确认按钮在未勾选时应禁用', () => {
      render(<OperationConfirmDialog {...defaultProps} requireConfirmation={true} />);
      const confirmButton = screen.getByText('确认执行');
      expect(confirmButton.closest('button')?.disabled).toBe(true);
    });

    it('勾选确认后确认按钮应启用', async () => {
      const user = userEvent.setup();
      render(<OperationConfirmDialog {...defaultProps} requireConfirmation={true} />);

      // 找到并点击 checkbox
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      const confirmButton = screen.getByText('确认执行');
      expect(confirmButton.closest('button')?.disabled).toBe(false);
    });

    it('不需要确认时确认按钮应直接可用', () => {
      render(<OperationConfirmDialog {...defaultProps} requireConfirmation={false} />);
      const confirmButton = screen.getByText('确认执行');
      expect(confirmButton.closest('button')?.disabled).toBe(false);
    });
  });

  describe('按钮交互', () => {
    it('点击确认按钮应调用 onConfirm（不需要确认时）', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(
        <OperationConfirmDialog
          {...defaultProps}
          onConfirm={onConfirm}
          requireConfirmation={false}
        />
      );

      const confirmButton = screen.getByText('确认执行');
      await user.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('点击确认按钮在未勾选时不应调用 onConfirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(
        <OperationConfirmDialog
          {...defaultProps}
          onConfirm={onConfirm}
          requireConfirmation={true}
        />
      );

      // 确认按钮应该是禁用的，但我们尝试点击
      const confirmButton = screen.getByText('确认执行');
      await user.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('勾选后点击确认应调用 onConfirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(
        <OperationConfirmDialog
          {...defaultProps}
          onConfirm={onConfirm}
          requireConfirmation={true}
        />
      );

      // 先勾选确认
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      // 再点击确认按钮
      const confirmButton = screen.getByText('确认执行');
      await user.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('点击取消按钮应调用 onClose', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <OperationConfirmDialog {...defaultProps} onClose={onClose} />
      );

      const cancelButton = screen.getByText('取消');
      await user.click(cancelButton);
      // AlertDialog 关闭时可能触发多次 onClose（一次来自按钮点击，一次来自 Dialog 关闭回调）
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('加载状态', () => {
    it('应在加载时显示处理中文本', () => {
      render(
        <OperationConfirmDialog {...defaultProps} isLoading={true} />
      );
      expect(screen.getByText('处理中...')).toBeDefined();
    });

    it('加载时确认按钮应禁用', () => {
      render(
        <OperationConfirmDialog
          {...defaultProps}
          isLoading={true}
          requireConfirmation={false}
        />
      );
      const button = screen.getByText('处理中...').closest('button');
      expect(button?.disabled).toBe(true);
    });

    it('加载时取消按钮应禁用', () => {
      render(
        <OperationConfirmDialog {...defaultProps} isLoading={true} />
      );
      const cancelButton = screen.getByText('取消').closest('button');
      expect(cancelButton?.disabled).toBe(true);
    });
  });

  describe('不同操作类型', () => {
    const operationTypes: OperationType[] = [
      'budget_adjustment',
      'bid_modification',
      'status_change',
      'batch_operation',
      'campaign_pause',
      'campaign_enable',
    ];

    operationTypes.forEach((type: any) => {
      it(`应正确渲染 ${type} 类型的弹窗`, () => {
        render(
          <OperationConfirmDialog
            {...defaultProps}
            operationType={type}
          />
        );
        // 每种类型都应该有标题和确认按钮
        expect(screen.getByText('确认执行')).toBeDefined();
        expect(screen.getByText('取消')).toBeDefined();
      });
    });

    it('高风险操作应使用红色确认按钮样式', () => {
      render(
        <OperationConfirmDialog
          {...defaultProps}
          operationType="campaign_pause"
          requireConfirmation={false}
        />
      );
      const confirmButton = screen.getByText('确认执行').closest('button');
      expect(confirmButton?.className).toContain('bg-red-500');
    });
  });

  describe('空变更列表', () => {
    it('应在没有变更时不显示变更详情', () => {
      render(
        <OperationConfirmDialog {...defaultProps} changes={[]} />
      );
      expect(screen.queryByText('变更详情预览')).toBeNull();
    });
  });
});

// ==================== useOperationConfirm Hook 测试 ====================

function TestHookComponent() {
  const { isOpen, isLoading, showConfirm, dialogProps } = useOperationConfirm();

  return (
    <div>
      <span data-testid="is-open">{String(isOpen)}</span>
      <span data-testid="is-loading">{String(isLoading)}</span>
      <button
        data-testid="show-confirm"
        onClick={() =>
          showConfirm({
            operationType: 'budget_adjustment',
            changes: createMockChanges(1),
            onConfirm: async () => {
              // 模拟异步操作
              await new Promise((r) => setTimeout(r, 10));
            },
          })
        }
      >
        Show
      </button>
      {dialogProps && <OperationConfirmDialog {...dialogProps} />}
    </div>
  );
}

describe('useOperationConfirm Hook 交互测试', () => {
  it('初始状态应为关闭', () => {
    render(<TestHookComponent />);
    expect(screen.getByTestId('is-open').textContent).toBe('false');
    expect(screen.getByTestId('is-loading').textContent).toBe('false');
  });

  it('调用 showConfirm 后应打开弹窗', async () => {
    const user = userEvent.setup();
    render(<TestHookComponent />);

    await user.click(screen.getByTestId('show-confirm'));
    expect(screen.getByTestId('is-open').textContent).toBe('true');
    expect(screen.getByText('预算调整确认')).toBeDefined();
  });

  it('点击取消后应关闭弹窗', async () => {
    const user = userEvent.setup();
    render(<TestHookComponent />);

    // 打开弹窗
    await user.click(screen.getByTestId('show-confirm'));
    expect(screen.getByTestId('is-open').textContent).toBe('true');

    // 点击取消
    await user.click(screen.getByText('取消'));
    expect(screen.getByTestId('is-open').textContent).toBe('false');
  });

  it('完整确认流程：打开 → 勾选 → 确认 → 关闭', async () => {
    const user = userEvent.setup();
    render(<TestHookComponent />);

    // 打开弹窗
    await user.click(screen.getByTestId('show-confirm'));
    expect(screen.getByTestId('is-open').textContent).toBe('true');

    // 勾选确认
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    // 点击确认
    const confirmButton = screen.getByText('确认执行');
    await user.click(confirmButton);

    // 等待异步操作完成后弹窗关闭
    await waitFor(() => {
      expect(screen.getByTestId('is-open').textContent).toBe('false');
    });
  });
});
