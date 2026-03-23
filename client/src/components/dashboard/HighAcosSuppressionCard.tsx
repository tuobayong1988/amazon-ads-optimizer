/**
 * 高ACOS抑制建议卡片 v501
 * 
 * 展示ACOS异常偏高的关键词和商品投放，支持一键降低竞价。
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
  TrendingDown,
  Zap,
  ArrowDown,
} from 'lucide-react';

interface Props {
  accountId: number;
}

export function HighAcosSuppressionCard({ accountId }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState(false);

  const { data: scanResult, isLoading, refetch } = trpc.dashboardRecommendation.scan.useQuery(
    { accountId },
    { enabled: !!accountId, staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 }
  );

  const executeMutation = trpc.dashboardRecommendation.executeHighAcosSuppression.useMutation({
    onSuccess: (data) => {
      toast.success(`高ACOS抑制完成！成功${data.successCount}项${data.failCount > 0 ? `，失败${data.failCount}项` : ''}`);
      setExecuting(false);
      setSelectedIds(new Set());
      refetch();
    },
    onError: (err) => {
      toast.error(`执行失败: ${err.message}`);
      setExecuting(false);
    },
  });

  const highAcos = scanResult?.highAcosSuppression;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        正在扫描高ACOS投放...
      </div>
    );
  }

  if (!highAcos || highAcos.totalCount === 0) {
    return (
      <div className="flex items-center gap-2 py-4 px-2 text-sm text-green-400">
        <ShieldCheck className="w-4 h-4" />
        <span>未发现ACOS异常偏高的投放，表现正常</span>
      </div>
    );
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === highAcos.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(highAcos.items.map(i => i.id)));
    }
  };

  const handleExecute = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error('请先选择要优化的项目');
      return;
    }
    setExecuting(true);
    executeMutation.mutate({
      accountId,
      itemIds: ids,
      items: highAcos.items.filter(i => ids.includes(i.id)),
    });
  };

  const displayItems = expanded ? highAcos.items : highAcos.items.slice(0, 5);

  // ACOS颜色分级
  const getAcosColor = (acos: number) => {
    if (acos > 300) return 'text-red-500';
    if (acos > 200) return 'text-red-400';
    return 'text-orange-400';
  };

  return (
    <div className="space-y-2">
      {/* 摘要行 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          发现 <span className="text-orange-400 font-medium">{highAcos.totalCount}</span> 个高ACOS投放
        </span>
        <span className="text-orange-400 font-medium">
          超额花费 ${highAcos.totalExcessSpend.toFixed(0)}
        </span>
      </div>

      {/* 全选 + 一键优化 */}
      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={selectedIds.size === highAcos.items.length && highAcos.items.length > 0}
            onCheckedChange={toggleSelectAll}
            className="h-3.5 w-3.5"
          />
          全选 ({selectedIds.size}/{highAcos.items.length})
        </label>
        <Button
          size="sm"
          className="h-6 text-[11px] px-2 bg-orange-600 hover:bg-orange-700"
          onClick={handleExecute}
          disabled={executing || selectedIds.size === 0}
        >
          {executing ? (
            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />执行中...</>
          ) : (
            <><Zap className="w-3 h-3 mr-1" />一键降价 ({selectedIds.size}项)</>
          )}
        </Button>
      </div>

      {/* 建议列表 */}
      <div className="space-y-1">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 border border-border/50 rounded-lg p-2 hover:border-orange-500/30 transition-colors"
          >
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => toggleSelect(item.id)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-xs font-medium truncate" title={item.entityText}>
                  {item.entityText}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                  {item.entityType === 'keyword' ? item.matchType : '商品投放'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="truncate max-w-[100px]" title={item.campaignName}>{item.campaignName}</span>
                <span>·</span>
                <span className={`font-medium ${getAcosColor(item.acos)}`}>ACoS {item.acos.toFixed(0)}%</span>
                <span>·</span>
                <span>${item.spend.toFixed(2)}花费</span>
                <span>·</span>
                <span>${item.sales.toFixed(2)}销售</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-blue-400">
                <ArrowDown className="w-2.5 h-2.5" />
                竞价 ${item.currentBid.toFixed(2)} → ${item.suggestedBid.toFixed(2)}
                <span className="text-muted-foreground">（降{item.reductionPercent}%）</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 展开/收起 */}
      {highAcos.items.length > 5 && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? '收起' : `查看全部${highAcos.items.length}项`}
        </button>
      )}
    </div>
  );
}
