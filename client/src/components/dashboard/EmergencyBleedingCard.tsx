/**
 * 紧急止血建议卡片 v501
 * 
 * 展示零转化高花费的搜索词和商品投放，支持一键添加否定词或降低竞价。
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { trpc } from '@/lib/trpc';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Zap,
  Loader2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
  Ban,
  TrendingDown,
} from 'lucide-react';

interface Props {
  accountId: number;
}

export function EmergencyBleedingCard({ accountId }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState(false);

  const { data: scanResult, isLoading, refetch } = trpc.dashboardRecommendation.scan.useQuery(
    { accountId },
    { enabled: !!accountId, staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 }
  );

  const executeMutation = trpc.dashboardRecommendation.executeEmergencyBleeding.useMutation({
    onSuccess: (data) => {
      toast.success(`紧急止血完成！成功${data.successCount}项${data.failCount > 0 ? `，失败${data.failCount}项` : ''}`);
      setExecuting(false);
      setSelectedIds(new Set());
      refetch();
    },
    onError: (err) => {
      toast.error(`执行失败: ${err.message}`);
      setExecuting(false);
    },
  });

  const bleeding = scanResult?.emergencyBleeding;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        正在扫描零转化投放...
      </div>
    );
  }

  if (!bleeding || bleeding.totalCount === 0) {
    return (
      <div className="flex items-center gap-2 py-4 px-2 text-sm text-green-400">
        <ShieldCheck className="w-4 h-4" />
        <span>未发现零转化高花费投放，账户状态良好</span>
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
    if (selectedIds.size === bleeding.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bleeding.items.map(i => i.id)));
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
      items: bleeding.items.filter(i => ids.includes(i.id)),
    });
  };

  const displayItems = expanded ? bleeding.items : bleeding.items.slice(0, 5);

  return (
    <div className="space-y-2">
      {/* 摘要行 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          发现 <span className="text-red-400 font-medium">{bleeding.totalCount}</span> 个零转化高花费投放
        </span>
        <span className="text-red-400 font-medium">
          浪费 ${bleeding.totalWastedSpend.toFixed(0)}
        </span>
      </div>

      {/* 全选 + 一键优化 */}
      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={selectedIds.size === bleeding.items.length && bleeding.items.length > 0}
            onCheckedChange={toggleSelectAll}
            className="h-3.5 w-3.5"
          />
          全选 ({selectedIds.size}/{bleeding.items.length})
        </label>
        <Button
          size="sm"
          variant="destructive"
          className="h-6 text-[11px] px-2"
          onClick={handleExecute}
          disabled={executing || selectedIds.size === 0}
        >
          {executing ? (
            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />执行中...</>
          ) : (
            <><Zap className="w-3 h-3 mr-1" />一键止血 ({selectedIds.size}项)</>
          )}
        </Button>
      </div>

      {/* 建议列表 */}
      <div className="space-y-1">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 border border-border/50 rounded-lg p-2 hover:border-red-500/30 transition-colors"
          >
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => toggleSelect(item.id)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                {item.entityType === 'search_term' ? (
                  <Ban className="w-3 h-3 text-red-400 shrink-0" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-orange-400 shrink-0" />
                )}
                <span className="text-xs font-medium truncate" title={item.entityText}>
                  {item.entityText}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                  {item.entityType === 'search_term' ? '搜索词' : '商品投放'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="truncate max-w-[120px]" title={item.campaignName}>{item.campaignName}</span>
                <span>·</span>
                <span className="text-red-400 font-medium">${item.spend.toFixed(2)}</span>
                <span>·</span>
                <span>{item.clicks}次点击</span>
                <span>·</span>
                <span className="text-red-400">0转化</span>
              </div>
              <div className="text-[10px] text-blue-400">
                {item.suggestedAction === 'add_negative_exact'
                  ? `→ 添加精准否定`
                  : `→ 降低竞价90%（$${item.currentBid.toFixed(2)} → $${(item.currentBid * 0.1).toFixed(2)}）`}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 展开/收起 */}
      {bleeding.items.length > 5 && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? '收起' : `查看全部${bleeding.items.length}项`}
        </button>
      )}
    </div>
  );
}
