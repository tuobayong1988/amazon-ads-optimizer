/**
 * 智能分层同步进度组件
 * 显示方案五的分层初始化进度和断点续传状态
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  Clock, 
  Loader2, 
  XCircle, 
  RefreshCw, 
  Play,
  Database,
  Layers,
  TrendingDown,
  AlertTriangle,
  Info
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TieredSyncProgressProps {
  accountId: number;
  accountName?: string;
}

// 分层配置类型
interface TierConfig {
  name: string;
  displayName: string;
  startDay: number;
  endDay: number;
  sliceSize: number;
  reportTypes: string[];
  priority: string;
  description: string;
}

// 分层统计类型
interface TierStats {
  tier: string;
  total: number;
  pending: number;
  submitted: number;
  processing: number;
  completed: number;
  failed: number;
  progressPercent: number;
}

export function TieredSyncProgress({ accountId, accountName }: TieredSyncProgressProps) {
  // 获取分层配置
  const { data: tierConfig } = trpc.reportJobs.getTierConfig.useQuery();

  // 获取分层任务数量
  const { data: taskCounts } = trpc.reportJobs.calculateTieredTaskCounts.useQuery();

  // 获取分层初始化进度
  const { data: tieredStats, isLoading, refetch } = trpc.reportJobs.getTieredInitializationStats.useQuery(
    { accountId },
    { refetchInterval: 5000 }
  );

  // 创建分层初始化任务
  const createTasksMutation = trpc.reportJobs.createTieredInitializationTasks.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建 ${result.totalTasks} 个分层任务`);
      refetch();
    },
    onError: (error) => {
      toast.error(`创建任务失败: ${error.message}`);
    },
  });

  // 重试失败的任务（增量重试）
  const retryMutation = trpc.reportJobs.retryFailedTieredTasks.useMutation({
    onSuccess: (result) => {
      toast.success(`已重试 ${result.retriedCount} 个任务，跳过 ${result.skippedCount} 个（超过最大重试次数）`);
      refetch();
    },
    onError: (error) => {
      toast.error(`重试失败: ${error.message}`);
    },
  });

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'realtime':
        return <Clock className="h-4 w-4 text-red-500" />;
      case 'hot':
        return <Database className="h-4 w-4 text-orange-500" />;
      case 'warm':
        return <Database className="h-4 w-4 text-yellow-500" />;
      case 'cold':
        return <Database className="h-4 w-4 text-blue-500" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'realtime':
        return 'bg-red-500';
      case 'hot':
        return 'bg-orange-500';
      case 'warm':
        return 'bg-yellow-500';
      case 'cold':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'submitted':
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">加载中...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalTasks = tieredStats?.totalTasks || 0;
  const completedTasks = tieredStats?.completedTasks || 0;
  const failedTasks = tieredStats?.failedTasks || 0;
  const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* 智能分层策略说明 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                智能分层同步（方案五）
                {accountName && <span className="text-muted-foreground font-normal">- {accountName}</span>}
              </CardTitle>
              <CardDescription>
                根据数据价值分层，优化任务数量和处理效率
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {totalTasks === 0 && (
                <Button 
                  onClick={() => createTasksMutation.mutate({ accountId, profileId: '' })}
                  disabled={createTasksMutation.isPending}
                >
                  {createTasksMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  开始分层初始化
                </Button>
              )}
              {failedTasks > 0 && (
                <Button 
                  variant="outline"
                  onClick={() => retryMutation.mutate({ accountId, maxRetries: 3 })}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  增量重试失败任务
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 总体进度 */}
          {totalTasks > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {overallProgress === 100 ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : failedTasks > 0 ? (
                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                  )}
                  <span className="font-medium">
                    {overallProgress === 100 ? '初始化完成' : '初始化进行中'}
                  </span>
                </div>
                <span className="text-2xl font-bold">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-3" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>已完成 {completedTasks} / {totalTasks} 任务</span>
                {failedTasks > 0 && (
                  <span className="text-red-500">{failedTasks} 个任务失败</span>
                )}
              </div>
            </div>
          )}

          {/* 分层进度详情 */}
          {tieredStats?.progressByTier && Object.keys(tieredStats.progressByTier).length > 0 && (
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Layers className="h-4 w-4" />
                各层进度
              </h4>
              <div className="space-y-3">
                {Object.entries(tieredStats.progressByTier).map(([tierName, tier]) => (
                  <div key={tierName} className="space-y-2 p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getTierIcon(tierName)}
                        <span className="font-medium">
                          {tierName === 'realtime' && '实时层（1-7天）'}
                          {tierName === 'hot' && '热数据层（8-30天）'}
                          {tierName === 'warm' && '温数据层（31-90天）'}
                          {tierName === 'cold' && '冷数据层（91-365天）'}
                        </span>
                        <Badge className={getTierColor(tierName)}>
                          {tierName === 'realtime' && '高优先级'}
                          {tierName === 'hot' && '中高优先级'}
                          {tierName === 'warm' && '中优先级'}
                          {tierName === 'cold' && '低优先级'}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {tier.completed}/{tier.total}
                      </span>
                    </div>
                    <Progress value={tier.percent} className="h-2" />
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>待处理: {tier.pending}</span>
                      <span>进行中: {tier.processing}</span>
                      <span className="text-green-600">完成: {tier.completed}</span>
                      {tier.failed > 0 && (
                        <span className="text-red-500">失败: {tier.failed}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分层配置说明 */}
      {tierConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              分层策略配置
            </CardTitle>
            <CardDescription>
              根据数据价值和使用频率，采用不同的同步策略
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3">数据层</th>
                    <th className="text-left py-2 px-3">时间范围</th>
                    <th className="text-left py-2 px-3">切片大小</th>
                    <th className="text-left py-2 px-3">报告类型</th>
                    <th className="text-left py-2 px-3">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {(tierConfig as any).tiers?.map((tier: TierConfig) => (
                    <tr key={tier.name} className="border-b">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          {getTierIcon(tier.name)}
                          <span>{tier.displayName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        {tier.startDay}-{tier.endDay}天
                      </td>
                      <td className="py-2 px-3">{tier.sliceSize}天</td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {tier.reportTypes.map((type: string) => (
                            <Badge key={type} variant="outline" className="text-xs">
                              {type}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {tier.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 任务数量对比 */}
      {taskCounts && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              方案五优势
            </CardTitle>
            <CardDescription>
              智能分层策略大幅减少任务数量，同时保证数据质量
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium">初始化任务分布</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {getTierIcon('realtime')}
                      <span>实时层</span>
                    </div>
                    <span className="font-medium">{(taskCounts as any).realtime || 0} 任务</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {getTierIcon('hot')}
                      <span>热数据层</span>
                    </div>
                    <span className="font-medium">{(taskCounts as any).hot || 0} 任务</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {getTierIcon('warm')}
                      <span>温数据层</span>
                    </div>
                    <span className="font-medium">{(taskCounts as any).warm || 0} 任务</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {getTierIcon('cold')}
                      <span>冷数据层</span>
                    </div>
                    <span className="font-medium">{(taskCounts as any).cold || 0} 任务</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t font-medium">
                    <span>总计</span>
                    <span>{(taskCounts as any).total || 0} 任务</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium">方案对比</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">原方案（全量同步）</span>
                    <span className="line-through text-muted-foreground">~420 任务</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">方案四（按类型拆分）</span>
                    <span className="line-through text-muted-foreground">~150 任务</span>
                  </div>
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>方案五（智能分层）</span>
                    <span>{(taskCounts as any).total || 61} 任务</span>
                  </div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-600 dark:text-green-400">
                    相比原方案减少 <span className="font-bold">85%</span> 任务数量
                  </p>
                </div>
              </div>
            </div>

            {/* 增量重试说明 */}
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h5 className="font-medium text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                增量重试机制
              </h5>
              <ul className="text-sm text-blue-600 dark:text-blue-400 space-y-1">
                <li>• 任务失败时，系统记录已成功处理的数据范围</li>
                <li>• 重试时只处理失败的部分，支持断点续传</li>
                <li>• 每个失败范围最多重试3次，超过后跳过</li>
                <li>• 大幅降低重试成本，提高整体成功率</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
