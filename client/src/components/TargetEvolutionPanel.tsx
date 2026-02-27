/**
 * 算法进化面板 - 展示优化目标的算法自我进化状态
 * v152: 集成到优化目标详情页
 */
import { safeToLocaleDateString } from "@/lib/safeDate";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Progress } from "./ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Brain, TrendingUp, TrendingDown, BarChart3, RefreshCw, Zap, Target, Activity, AlertTriangle, CheckCircle } from "lucide-react";

interface TargetEvolutionPanelProps {
  performanceGroupId: number;
}

export default function TargetEvolutionPanel({ performanceGroupId }: TargetEvolutionPanelProps) {
  const [evalPeriod, setEvalPeriod] = useState<'7' | '14' | '30'>('14');
  const queryClient = useQueryClient();

  // 获取算法配置
  const { data: config, isLoading: configLoading } = trpc.algorithmEvolution.getTargetConfig.useQuery(
    { targetId: performanceGroupId }
  );

  // 获取效果评估
  const { data: evaluation, isLoading: evalLoading } = trpc.algorithmEvolution.evaluateTarget.useQuery(
    { targetId: performanceGroupId, period: evalPeriod }
  );

  // 获取有效出价配置
  const { data: bidConfig } = trpc.algorithmEvolution.getEffectiveBidConfig.useQuery(
    { targetId: performanceGroupId }
  );

  // 手动触发进化
  const evolutionMutation = trpc.algorithmEvolution.runEvolutionCycle.useMutation({
    onSuccess: () => {
      // v268 性能优化: 精确失效而非全局刷新，避免触发所有查询重新请求
      queryClient.invalidateQueries({ queryKey: [['algorithmEvolution']] });
      queryClient.invalidateQueries({ queryKey: [['algorithmEffect']] });
    },
  });

  // 手动触发效果追踪
  const trackingMutation = trpc.algorithmEvolution.runEffectTracking.useMutation({
    onSuccess: () => {
      // v268 性能优化: 精确失效而非全局刷新
      queryClient.invalidateQueries({ queryKey: [['algorithmEvolution']] });
      queryClient.invalidateQueries({ queryKey: [['algorithmEffect']] });
    },
  });

  return (
    <div className="space-y-6">
      {/* 进化状态概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              进化代数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config ? `第 ${config.evolutionGeneration} 代` : '初始'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {config?.lastEvolutionAt
                ? `上次进化: ${safeToLocaleDateString(config.lastEvolutionAt)}`
                : '尚未开始进化'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500" />
              最大调整幅度
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config ? `+${config.maxBidIncreasePercent}% / -${config.maxBidDecreasePercent}%` : '+30% / -20%'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">提价/降价限制</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              探索率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config ? `${(config.explorationRate * 100).toFixed(0)}%` : '20%'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">UCB探索-利用平衡</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              置信度阈值
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config ? `${(config.confidenceThreshold * 100).toFixed(0)}%` : '30%'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">最低执行置信度</p>
          </CardContent>
        </Card>
      </div>

      {/* 算法权重分布 */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              算法权重分布
            </CardTitle>
            <CardDescription>各优化算法的当前权重，基于历史效果自动调整</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(config.algorithmWeights).map(([algo, weight]) => {
                const algoNames: Record<string, string> = {
                  time_decay: '时间衰减ROAS',
                  ucb: 'UCB探索-利用',
                  bayesian: '贝叶斯平滑',
                  market_curve: '市场曲线模型',
                };
                return (
                  <div key={algo} className="flex items-center gap-3">
                    <span className="w-32 text-sm">{algoNames[algo] || algo}</span>
                    <Progress value={(weight as number) * 100} className="flex-1" />
                    <span className="w-12 text-sm font-medium text-right">
                      {((weight as number) * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 效果评估 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                优化效果评估
              </CardTitle>
              <CardDescription>自动追踪每次优化操作的后续效果</CardDescription>
            </div>
            <Select value={evalPeriod} onValueChange={(v) => setEvalPeriod(v as '7' | '14' | '30')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">近7天</SelectItem>
                <SelectItem value="14">近14天</SelectItem>
                <SelectItem value="30">近30天</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {evalLoading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : evaluation ? (
            <div className="space-y-4">
              {/* 总体统计 */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{evaluation.totalEvents}</div>
                  <div className="text-xs text-muted-foreground">总优化次数</div>
                </div>
                <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{evaluation.successfulEvents}</div>
                  <div className="text-xs text-muted-foreground">正面效果</div>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{evaluation.failedEvents}</div>
                  <div className="text-xs text-muted-foreground">负面效果</div>
                </div>
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="text-2xl font-bold text-gray-500">{evaluation.neutralEvents}</div>
                  <div className="text-xs text-muted-foreground">无显著变化</div>
                </div>
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {evaluation.overallEffectScore > 0 ? '+' : ''}{evaluation.overallEffectScore.toFixed(0)}
                  </div>
                  <div className="text-xs text-muted-foreground">综合效果分</div>
                </div>
              </div>

              {/* 按算法分类的效果 */}
              {evaluation.algorithmPerformance && evaluation.algorithmPerformance.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">各算法表现</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2">算法</th>
                          <th className="text-center p-2">使用次数</th>
                          <th className="text-center p-2">成功率</th>
                          <th className="text-center p-2">平均效果分</th>
                          <th className="text-center p-2">评价</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluation.algorithmPerformance.map((ap: any) => (
                          <tr key={ap.algorithm} className="border-t">
                            <td className="p-2">{ap.algorithm}</td>
                            <td className="text-center p-2">{ap.count}</td>
                            <td className="text-center p-2">{ap.successRate.toFixed(0)}%</td>
                            <td className="text-center p-2">
                              <span className={ap.avgEffectScore > 0 ? 'text-green-600' : ap.avgEffectScore < 0 ? 'text-red-600' : ''}>
                                {ap.avgEffectScore > 0 ? '+' : ''}{ap.avgEffectScore.toFixed(1)}
                              </span>
                            </td>
                            <td className="text-center p-2">
                              {ap.successRate >= 60 ? (
                                <Badge variant="default" className="bg-green-500">优秀</Badge>
                              ) : ap.successRate >= 40 ? (
                                <Badge variant="secondary">一般</Badge>
                              ) : (
                                <Badge variant="destructive">待改进</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 按调整幅度分类的效果 */}
              {evaluation.rangePerformance && evaluation.rangePerformance.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">各调整幅度表现</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2">调整幅度</th>
                          <th className="text-center p-2">次数</th>
                          <th className="text-center p-2">成功率</th>
                          <th className="text-center p-2">平均效果分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluation.rangePerformance.map((rp: any) => (
                          <tr key={rp.range} className="border-t">
                            <td className="p-2">{rp.range}</td>
                            <td className="text-center p-2">{rp.count}</td>
                            <td className="text-center p-2">{rp.successRate.toFixed(0)}%</td>
                            <td className="text-center p-2">
                              <span className={rp.avgEffectScore > 0 ? 'text-green-600' : rp.avgEffectScore < 0 ? 'text-red-600' : ''}>
                                {rp.avgEffectScore > 0 ? '+' : ''}{rp.avgEffectScore.toFixed(1)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>暂无足够的优化数据进行效果评估</p>
              <p className="text-xs mt-1">系统会在每次数据同步后自动追踪优化效果</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">手动操作</CardTitle>
          <CardDescription>通常无需手动操作，系统会在每次数据同步后自动执行效果追踪和算法进化</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => trackingMutation.mutate()}
            disabled={trackingMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${trackingMutation.isPending ? 'animate-spin' : ''}`} />
            {trackingMutation.isPending ? '追踪中...' : '手动效果追踪'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => evolutionMutation.mutate({ targetId: performanceGroupId })}
            disabled={evolutionMutation.isPending}
          >
            <Brain className={`h-4 w-4 mr-2 ${evolutionMutation.isPending ? 'animate-spin' : ''}`} />
            {evolutionMutation.isPending ? '进化中...' : '手动触发进化'}
          </Button>
          {evolutionMutation.isSuccess && evolutionMutation.data && (
            <Badge variant="default" className="bg-green-500 self-center">
              <CheckCircle className="h-3 w-3 mr-1" />
              进化完成 - 第{evolutionMutation.data.generation}代
            </Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
