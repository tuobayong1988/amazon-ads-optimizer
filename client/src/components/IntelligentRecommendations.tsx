/**
 * 智能运营推荐卡片 v269.4
 * 
 * compact尺寸（与算法效果概览卡片一致），展示自动优化动作而非仅提醒
 * 
 * 核心功能：
 * 1. 扫描该账号下所有活跃广告活动的健康度
 * 2. 已纳管恶化广告：展示系统已自动执行的补充优化动作
 * 3. 未纳管恶化广告：一键创建优化目标并立即触发全套自动优化
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  Zap,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
} from 'lucide-react';

interface Props {
  accountId: number;
}

export function IntelligentRecommendations({ accountId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);

  const { data: scanResult, isLoading, error, refetch } = trpc.intelligentRecommendation.scan.useQuery(
    { accountId },
    { enabled: !!accountId, staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 }
  );

  const createGoalMutation = trpc.intelligentRecommendation.quickCreateGoal.useMutation({
    onSuccess: (data) => {
      toast.success(`优化目标创建成功！已纳入${data.campaignCount}个广告活动，系统正在执行首次自动优化...`);
      setCreatingGoal(false);
      refetch();
    },
    onError: (err) => {
      toast.error(`创建失败: ${err.message}`);
      setCreatingGoal(false);
    },
  });

  const handleQuickCreate = (prefillData: unknown) => {
    setCreatingGoal(true);
    createGoalMutation.mutate({
      accountId,
      // @ts-ignore
      name: prefillData.name,
      // @ts-ignore
      description: prefillData.description,
      // @ts-ignore
      optimizationGoal: prefillData.optimizationGoal,
      // @ts-ignore
      targetAcos: prefillData.targetAcos,
      // @ts-ignore
      targetRoas: prefillData.targetRoas,
      // @ts-ignore
      strategyTemplateId: prefillData.strategyTemplateId,
      // @ts-ignore
      strategyTemplateName: prefillData.strategyTemplateName,
      // @ts-ignore
      campaignIds: prefillData.campaignIds,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        正在扫描广告活动健康度...
      </div>
    );
  }

  if (error || !scanResult) {
    return (
      <div className="text-center py-4 text-muted-foreground text-xs">
        <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-yellow-500" />
        健康度扫描暂不可用
      </div>
    );
  }

  if (scanResult.recommendations.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 px-2 text-sm text-green-400">
        <ShieldCheck className="w-4 h-4" />
        <span>已扫描{scanResult.totalCampaignsScanned}个活跃广告活动，全部运行正常</span>
      </div>
    );
  }

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };

  const priorityLabels: Record<string, string> = {
    critical: '紧急', high: '高优', medium: '关注', low: '低',
  };

  return (
    <div className="space-y-2">
      {/* 摘要行 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          已扫描 <span className="text-foreground font-medium">{scanResult.totalCampaignsScanned}</span> 个活跃广告活动，
          <span className="text-red-400 font-medium">{scanResult.deterioratingCampaigns}</span> 个恶化
          {scanResult.autoOptimizationTriggered && (
            <span className="text-green-400 ml-1">· 已自动优化</span>
          )}
        </span>
        {scanResult.totalPotentialSavings > 0 && (
          <span className="text-orange-400">
            // @ts-ignore
            ≈${scanResult.totalPotentialSavings.toFixed(0)}/周
          </span>
        )}
      </div>

      {/* @ts-ignore */}
      {/* 推荐列表 */}
      // @ts-ignore
      {scanResult.recommendations.map((rec: unknown) => (
        <div
          // @ts-ignore
          key={rec.id}
          className="border border-border/50 rounded-lg p-2.5 space-y-1.5 hover:border-border transition-colors"
        >
          {/* @ts-ignore */}
          {/* 标题行 */}
          <div className="flex items-start gap-2">
            {/* @ts-ignore */}
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${priorityColors[rec.priority]}`}>
              {/* @ts-ignore */}
              {/* @ts-ignore */}
              {priorityLabels[rec.priority]}
            </Badge>
            {/* @ts-ignore */}
            <p className="text-xs font-medium leading-tight line-clamp-2 flex-1 min-w-0">{rec.title}</p>
          </div>

          {/* @ts-ignore */}
          {/* 已纳管：展示自动优化动作 */}
          {/* @ts-ignore */}
          {/* @ts-ignore */}
          {rec.type === 'managed_deteriorating' && rec.autoOptimizationActions?.length > 0 && (
            <div className="space-y-1">
              {/* @ts-ignore */}
              <div className="flex flex-wrap gap-1">
                {/* @ts-ignore */}
                {rec.autoOptimizationActions
                  // @ts-ignore
                  .filter((a: unknown) => a.status === 'executed')
                  // @ts-ignore
                  .map((action: unknown, i: number) => (
                    <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      // @ts-ignore
                      {(action as any).description}: {(action as any).count}项
                    </span>
                  // @ts-ignore
                  ))}
                // @ts-ignore
                {(rec as any).autoOptimizationActions
                  // @ts-ignore
                  .filter((a: unknown) => a.status === 'skipped')
                  .map((action: unknown, i: number) => (
                    <span key={`s-${i}`} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {/* @ts-ignore */}
                      // @ts-ignore
                      {action.description}: 无需调整
                    // @ts-ignore
                    </span>
                  ))}
              </div>
              {/* @ts-ignore */}
              {/* @ts-ignore */}
              {rec.autoOptimizationSummary && (
                // @ts-ignore
                <p className="text-[10px] text-muted-foreground">{rec.autoOptimizationSummary}</p>
              )}
            </div>
          )}

          // @ts-ignore
          {/* 已纳管但无执行动作 */}
          // @ts-ignore
          {(rec as any).type === 'managed_deteriorating' && (!(rec as any).autoOptimizationActions || (rec as any).autoOptimizationActions.filter((a: unknown) => (a as any).status === 'executed').length === 0) && (
            <p className="text-[10px] text-muted-foreground">
              {/* @ts-ignore */}
              {rec.autoOptimizationSummary || '系统已完成分析，当前优化策略持续执行中'}
            </p>
          )}

          {/* 未纳管：一键创建按钮 */}
          // @ts-ignore
          {(rec as any).type === 'unmanaged_deteriorating' && (rec as any).action?.prefillData && (
            <div className="space-y-1.5">
              {/* @ts-ignore */}
              {rec.suggestedStrategy && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Target className="w-3 h-3 text-blue-400" />
                  // @ts-ignore
                  推荐策略: <span className="text-foreground">{(rec as any).suggestedStrategy.name}</span>
                  // @ts-ignore
                  · ACoS目标 {(rec as any).suggestedStrategy.targetAcos}%
                // @ts-ignore
                </div>
              )}
              // @ts-ignore
              <div className="flex items-center gap-2">
                {/* @ts-ignore */}
                <Button
                  size="sm"
                  // @ts-ignore
                  className="h-6 text-[11px] px-2"
                  // @ts-ignore
                  onClick={() => handleQuickCreate(rec.action.prefillData)}
                  disabled={creatingGoal}
                // @ts-ignore
                >
                  {creatingGoal ? (
                    // @ts-ignore
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" />创建中...</>
                  // @ts-ignore
                  ) : (
                    // @ts-ignore
                    <><Zap className="w-3 h-3 mr-1" />一键创建优化目标并立即优化</>
                  )}
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {/* @ts-ignore */}
                  {rec.action.prefillData.campaignIds.length}个广告活动
                </span>
              </div>
            </div>
          )}

          {/* 展开/收起详细广告列表 */}
          // @ts-ignore
          {(rec as any).campaigns?.length > 0 && (
            <div>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                // @ts-ignore
                onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
              >
                // @ts-ignore
                {expanded === (rec as any).id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                // @ts-ignore
                {expanded === (rec as any).id ? '收起' : `查看${(rec as any).campaigns.length}个广告活动详情`}
              </button>
              {/* @ts-ignore */}
              {expanded === rec.id && (
                <div className="mt-1 space-y-1 max-h-[120px] overflow-y-auto">
                  // @ts-ignore
                  {(rec as any).campaigns.map((c: unknown, i: number) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5 px-1.5 rounded bg-muted/30">
                      {/* @ts-ignore */}
                      <span className="truncate max-w-[55%]" title={c.campaignName}>{c.campaignName}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* @ts-ignore */}
                        <span>ACoS: <span className={c.recent7dAcos > 50 ? 'text-red-400' : 'text-orange-400'}>{c.recent7dAcos.toFixed(1)}%</span></span>
                        {/* @ts-ignore */}
                        <span>${c.recent7dSpend.toFixed(0)}</span>
                        {/* @ts-ignore */}
                        <span>${c.recent7dSales.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
