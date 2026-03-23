/**
 * 广告活动优化目标调整建议卡片 v501
 * 
 * 展示未纳入优化目标的活跃广告活动，支持一键分配到绩效组。
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { trpc } from '@/lib/trpc';
import toast from 'react-hot-toast';
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Target,
  Zap,
  FolderPlus,
} from 'lucide-react';

interface Props {
  accountId: number;
}

export function GoalAdjustmentCard({ accountId }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const { data: scanResult, isLoading, refetch } = trpc.dashboardRecommendation.scan.useQuery(
    { accountId },
    { enabled: !!accountId, staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 }
  );

  // 获取可用的绩效组列表
  const { data: performanceGroupsData } = trpc.performanceGroup.list.useQuery(
    { accountId },
    { enabled: !!accountId }
  );

  const executeMutation = trpc.dashboardRecommendation.executeGoalAdjustment.useMutation({
    onSuccess: (data) => {
      toast.success(`优化目标分配完成！成功${data.successCount}项${data.failCount > 0 ? `，失败${data.failCount}项` : ''}`);
      setExecuting(false);
      setSelectedIds(new Set());
      refetch();
    },
    onError: (err) => {
      toast.error(`执行失败: ${err.message}`);
      setExecuting(false);
    },
  });

  const goalAdj = scanResult?.goalAdjustment;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        正在扫描未纳管广告活动...
      </div>
    );
  }

  if (!goalAdj || goalAdj.totalCount === 0) {
    return (
      <div className="flex items-center gap-2 py-4 px-2 text-sm text-green-400">
        <ShieldCheck className="w-4 h-4" />
        <span>所有活跃广告活动均已纳入优化目标</span>
      </div>
    );
  }

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === goalAdj.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(goalAdj.items.map(i => i.campaignDbId)));
    }
  };

  const handleExecute = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error('请先选择要分配的广告活动');
      return;
    }
    if (!selectedGroupId) {
      toast.error('请先选择目标绩效组');
      return;
    }
    setExecuting(true);
    executeMutation.mutate({
      accountId,
      campaignDbIds: ids,
      performanceGroupId: selectedGroupId,
    });
  };

  const displayItems = expanded ? goalAdj.items : goalAdj.items.slice(0, 5);
  const groups = performanceGroupsData || [];

  // 广告类型颜色
  const typeColor: Record<string, string> = {
    sp_auto: 'bg-blue-500/20 text-blue-400',
    sp_manual: 'bg-green-500/20 text-green-400',
    sb: 'bg-purple-500/20 text-purple-400',
    sd: 'bg-yellow-500/20 text-yellow-400',
  };

  const typeLabel: Record<string, string> = {
    sp_auto: 'SP自动',
    sp_manual: 'SP手动',
    sb: 'SB品牌',
    sd: 'SD展示',
  };

  return (
    <div className="space-y-2">
      {/* 摘要行 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          发现 <span className="text-yellow-400 font-medium">{goalAdj.totalCount}</span> 个未纳管的活跃广告活动
        </span>
        {goalAdj.totalUnmanagedSpend > 0 && (
          <span className="text-yellow-400 font-medium">
            未管理花费 ${goalAdj.totalUnmanagedSpend.toFixed(0)}
          </span>
        )}
      </div>

      {/* 绩效组选择 + 全选 + 一键分配 */}
      <div className="space-y-1.5 px-1">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
            <Checkbox
              checked={selectedIds.size === goalAdj.items.length && goalAdj.items.length > 0}
              onCheckedChange={toggleSelectAll}
              className="h-3.5 w-3.5"
            />
            全选 ({selectedIds.size}/{goalAdj.items.length})
          </label>
          <select
            className="flex-1 h-6 text-[11px] rounded border border-border bg-background px-1.5 text-foreground min-w-0"
            value={selectedGroupId || ''}
            onChange={(e) => setSelectedGroupId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">选择目标绩效组...</option>
            {groups.map((g: { id: number; name: string }) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-6 text-[11px] px-2 bg-blue-600 hover:bg-blue-700 shrink-0"
            onClick={handleExecute}
            disabled={executing || selectedIds.size === 0 || !selectedGroupId}
          >
            {executing ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" />分配中...</>
            ) : (
              <><FolderPlus className="w-3 h-3 mr-1" />一键分配</>
            )}
          </Button>
        </div>
      </div>

      {/* 广告活动列表 */}
      <div className="space-y-1">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 border border-border/50 rounded-lg p-2 hover:border-blue-500/30 transition-colors"
          >
            <Checkbox
              checked={selectedIds.has(item.campaignDbId)}
              onCheckedChange={() => toggleSelect(item.campaignDbId)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Target className="w-3 h-3 text-blue-400 shrink-0" />
                <span className="text-xs font-medium truncate" title={item.campaignName}>
                  {item.campaignName}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 shrink-0 ${typeColor[item.campaignType] || ''}`}
                >
                  {typeLabel[item.campaignType] || item.campaignType}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {item.recent7dSpend > 0 && (
                  <>
                    <span>7天花费 ${item.recent7dSpend.toFixed(2)}</span>
                    <span>·</span>
                    <span>销售 ${item.recent7dSales.toFixed(2)}</span>
                    {item.recent7dAcos > 0 && (
                      <>
                        <span>·</span>
                        <span className={item.recent7dAcos > 50 ? 'text-red-400' : 'text-green-400'}>
                          ACoS {item.recent7dAcos.toFixed(1)}%
                        </span>
                      </>
                    )}
                  </>
                )}
                {item.recent7dSpend === 0 && (
                  <span className="text-yellow-400">未纳入优化目标，无法自动优化</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 展开/收起 */}
      {goalAdj.items.length > 5 && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? '收起' : `查看全部${goalAdj.items.length}个广告活动`}
        </button>
      )}
    </div>
  );
}
