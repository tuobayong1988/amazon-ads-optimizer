/**
 * 智能投放管理页面
 * 自动化广告优化决策和执行
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Loader2, Play, Pause, CheckCircle2, AlertCircle, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

interface Decision {
  campaignId: number;
  campaignName: string;
  action: 'pause' | 'enable' | 'increase_bid' | 'decrease_bid' | 'increase_budget' | 'decrease_budget';
  reason: string;
  currentValue?: number;
  recommendedValue?: number;
  confidence: number;
  priority: number;
}

export default function SmartCampaignManagement() {
  const [selectedPerformanceGroup, setSelectedPerformanceGroup] = useState<number | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const queryClient = useQueryClient();

  // 获取绩效组列表
  const { data: performanceGroups, isLoading: groupsLoading } = useQuery({
    queryKey: ['performanceGroups'],
    queryFn: async () => {
      // 实际应该调用TRPC API
      return [
        { id: 1, name: '品牌推广组', campaignCount: 5 },
        { id: 2, name: '产品推广组', campaignCount: 8 },
        { id: 3, name: '季节性推广组', campaignCount: 3 },
      ];
    },
  });

  // 获取优化建议
  const recommendationsMutation = useMutation({
    mutationFn: async (performanceGroupId: number) => {
      return trpc.smartCampaign.getBatchOptimizationRecommendations.mutate({
        performanceGroupId,
      });
    },
  });

  // 执行优化
  const executeMutation = useMutation({
    mutationFn: async (decisions: Decision[]) => {
      return trpc.smartCampaign.executeBatchOptimization.mutate({
        decisions: decisions.map((d) => ({
          campaignId: d.campaignId,
          action: d.action,
          value: d.recommendedValue,
        })),
        dryRun,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  const handleGetRecommendations = () => {
    if (selectedPerformanceGroup) {
      recommendationsMutation.mutate(selectedPerformanceGroup);
    }
  };

  const handleExecuteOptimization = () => {
    if (recommendationsMutation.data?.decisions) {
      executeMutation.mutate(recommendationsMutation.data.decisions);
    }
  };

  const getActionBadge = (action: Decision['action']) => {
    const config = {
      pause: { label: '暂停', variant: 'destructive' as const, icon: Pause },
      enable: { label: '启用', variant: 'default' as const, icon: Play },
      increase_bid: { label: '提高出价', variant: 'default' as const, icon: TrendingUp },
      decrease_bid: { label: '降低出价', variant: 'secondary' as const, icon: TrendingDown },
      increase_budget: { label: '增加预算', variant: 'default' as const, icon: TrendingUp },
      decrease_budget: { label: '减少预算', variant: 'secondary' as const, icon: TrendingDown },
    };

    const { label, variant, icon: Icon } = config[action];
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: number) => {
    if (priority >= 8) return <Badge variant="destructive">高</Badge>;
    if (priority >= 5) return <Badge variant="default">中</Badge>;
    return <Badge variant="secondary">低</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">智能投放管理</h1>
          <p className="text-muted-foreground mt-2">
            自动化广告优化决策和执行
          </p>
        </div>
      </div>

      {/* 控制面板 */}
      <Card>
        <CardHeader>
          <CardTitle>优化控制</CardTitle>
          <CardDescription>选择绩效组并获取优化建议</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>选择绩效组</Label>
              <select
                className="w-full border rounded-md p-2"
                value={selectedPerformanceGroup || ''}
                onChange={(e) => setSelectedPerformanceGroup(Number(e.target.value))}
              >
                <option value="">请选择...</option>
                {performanceGroups?.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.campaignCount}个广告活动)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="dry-run"
                checked={dryRun}
                onCheckedChange={setDryRun}
              />
              <Label htmlFor="dry-run" className="cursor-pointer">
                预览模式 (不实际执行)
              </Label>
            </div>
          </div>

          <Button
            onClick={handleGetRecommendations}
            disabled={!selectedPerformanceGroup || recommendationsMutation.isPending}
            className="w-full"
          >
            {recommendationsMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            获取优化建议
          </Button>
        </CardContent>
      </Card>

      {/* 优化建议列表 */}
      {recommendationsMutation.data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>优化建议</CardTitle>
                <CardDescription>
                  共{recommendationsMutation.data.decisions.length}条建议
                </CardDescription>
              </div>
              <Button
                onClick={handleExecuteOptimization}
                disabled={executeMutation.isPending || recommendationsMutation.data.decisions.length === 0}
              >
                {executeMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {dryRun ? '预览执行' : '执行优化'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recommendationsMutation.data.decisions.length === 0 ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>无需优化</AlertTitle>
                <AlertDescription>
                  所有广告活动表现良好,暂时无需调整。
                </AlertDescription>
              </Alert>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>广告活动</TableHead>
                    <TableHead>操作</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>当前值</TableHead>
                    <TableHead>建议值</TableHead>
                    <TableHead>置信度</TableHead>
                    <TableHead>优先级</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recommendationsMutation.data.decisions.map((decision: Decision, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{decision.campaignName}</TableCell>
                      <TableCell>{getActionBadge(decision.action)}</TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {decision.reason}
                      </TableCell>
                      <TableCell>
                        {decision.currentValue !== undefined
                          ? `$${decision.currentValue.toFixed(2)}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {decision.recommendedValue !== undefined
                          ? `$${decision.recommendedValue.toFixed(2)}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {(decision.confidence * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell>{getPriorityBadge(decision.priority)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* 执行结果 */}
      {executeMutation.data && (
        <Card>
          <CardHeader>
            <CardTitle>执行结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert>
              {executeMutation.data.success ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>执行成功</AlertTitle>
                  <AlertDescription>
                    {dryRun ? (
                      <div>
                        <p>预览模式: 以下操作将被执行</p>
                        <ul className="list-disc list-inside mt-2 space-y-1">
                          {executeMutation.data.results.map((result: any, index: number) => (
                            <li key={index} className="text-sm">
                              {result.campaignName}: {result.action}
                              {result.success ? ' ✓' : ' ✗'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div>
                        <p>成功执行{executeMutation.data.results.filter((r: any) => r.success).length}个优化操作</p>
                      </div>
                    )}
                  </AlertDescription>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>执行失败</AlertTitle>
                  <AlertDescription>
                    部分操作执行失败,请查看详细日志
                  </AlertDescription>
                </>
              )}
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* 优化报告 */}
      {recommendationsMutation.data?.report && (
        <Card>
          <CardHeader>
            <CardTitle>优化报告</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">总广告活动</div>
                  <div className="text-2xl font-bold mt-1">
                    {recommendationsMutation.data.report.totalCampaigns}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">需要优化</div>
                  <div className="text-2xl font-bold mt-1 text-orange-600">
                    {recommendationsMutation.data.report.needsOptimization}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">表现良好</div>
                  <div className="text-2xl font-bold mt-1 text-green-600">
                    {recommendationsMutation.data.report.performingWell}
                  </div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>{recommendationsMutation.data.report.summary}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
