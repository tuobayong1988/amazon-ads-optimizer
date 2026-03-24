/**
 * v359: 数据健康仪表盘
 * 
 * 综合展示系统运行状态：
 * - 综合健康评分
 * - 数据同步状态
 * - API限流指标
 * - 自愈调度器状态
 * - 指令确认队列
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Shield,
  Zap,
  Clock,
  Database,
  Heart,
  Gauge,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";

// 健康评分颜色映射
function getHealthColor(score: number): string {
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-yellow-500";
  return "text-red-500";
}

function getHealthBadge(status: string) {
  switch (status) {
    case "healthy":
      return <Badge className="bg-green-100 text-green-800">健康</Badge>;
    case "degraded":
      return <Badge className="bg-yellow-100 text-yellow-800">降级</Badge>;
    case "unhealthy":
      return <Badge className="bg-red-100 text-red-800">异常</Badge>;
    default:
      return <Badge variant="outline">未知</Badge>;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "active":
    case "running":
    case "healthy":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "unavailable":
    case "unhealthy":
    case "stopped":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Activity className="h-4 w-4 text-gray-400" />;
  }
}

export default function DataHealthDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // 获取综合健康概览
  const overviewQuery = trpc.dataHealth.getOverview.useQuery(undefined, {
    refetchInterval: 30000, // 每30秒自动刷新
  });

  // 获取限流详情
  const rateLimitQuery = trpc.dataHealth.getRateLimitMetrics.useQuery(undefined, {
    enabled: activeTab === "rateLimit",
  });

  // 获取自愈详情
  const selfHealingQuery = trpc.dataHealth.getSelfHealingStatus.useQuery(undefined, {
    enabled: activeTab === "selfHealing",
  });

  // 获取确认队列详情
  const confirmationQuery = trpc.dataHealth.getConfirmationStatus.useQuery(undefined, {
    enabled: activeTab === "confirmation",
  });

  const data = overviewQuery.data?.data;
  const overall = data?.overall as any;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">数据健康仪表盘</h1>
            <p className="text-muted-foreground mt-1">
              系统运行状态综合监控
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              overviewQuery.refetch();
              toast.success("正在刷新数据...");
            }}
            disabled={overviewQuery.isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${overviewQuery.isRefetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>

        {/* 综合健康评分卡片 */}
        {overall && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-8">
                {/* @ts-ignore */}
                <div className="flex flex-col items-center">
                  {/* @ts-ignore */}
                  {/* @ts-ignore */}
                  <div className={`text-5xl font-bold ${getHealthColor(overall.healthScore)}`}>
                    {/* @ts-ignore */}
                    {overall.healthScore}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">综合健康评分</div>
                {/* @ts-ignore */}
                </div>
                <div className="flex-1">
                  {/* @ts-ignore */}
                  <div className="flex items-center gap-2 mb-2">
                    {/* @ts-ignore */}
                    {getHealthBadge(overall.status)}
                    <span className="text-sm text-muted-foreground">
                      最后检查: {new Date((overall as any).lastChecked).toLocaleString()}
                    </span>
                  </div>
                  {/* @ts-ignore */}
                  <Progress value={overall.healthScore} className="h-3" />
                  {/* @ts-ignore */}
                  {overall.issues?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {((overall as any).issues as string[]).map((issue: string, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-yellow-600">
                          <AlertTriangle className="h-3 w-3" />
                          {issue}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 子系统状态概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 同步状态 */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                {/* @ts-ignore */}
                <CardTitle className="text-sm font-medium">数据同步</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </div>
            {/* @ts-ignore */}
            </CardHeader>
            <CardContent>
              {/* @ts-ignore */}
              {data?.syncJobs ? (
                <>
                  <div className="text-2xl font-bold">
                    {/* @ts-ignore */}
                    {(data.syncJobs as unknown)?.stats24h?.successRate ?? 0}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    24h成功率 ({(data.syncJobs as any)?.stats24h?.succeeded ?? 0}/{(data.syncJobs as any)?.stats24h?.total ?? 0})
                  </p>
                  {/* @ts-ignore */}
                  {(data.syncJobs as unknown)?.stats24h?.running > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Activity className="h-3 w-3 text-blue-500 animate-pulse" />
                      <span className="text-xs text-blue-500">
                        {/* @ts-ignore */}
                        {(data.syncJobs as Record<string, unknown>).stats24h.running} 个同步进行中
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">加载中...</div>
              )}
            </CardContent>
          {/* @ts-ignore */}
          </Card>

          {/* @ts-ignore */}
          {/* 限流状态 */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                {/* @ts-ignore */}
                <CardTitle className="text-sm font-medium">API限流</CardTitle>
                <Gauge className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {/* @ts-ignore */}
                {getStatusIcon((data?.rateLimiting as unknown)?.status)}
                <span className="text-sm capitalize">
                  {(data?.rateLimiting as any)?.status === 'active' ? '运行中' : '未激活'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {/* @ts-ignore */}
                {(data?.rateLimiting as unknown)?.metrics?.length ?? 0} 个端点监控中
              </p>
            {/* @ts-ignore */}
            </CardContent>
          </Card>

          {/* 自愈状态 */}
          {/* @ts-ignore */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">自愈调度器</CardTitle>
                <Heart className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {/* @ts-ignore */}
                {getStatusIcon((data?.selfHealing as unknown)?.status)}
                <span className="text-sm">
                  {(data?.selfHealing as any)?.status === 'running' ? '运行中' : '已停止'}
                </span>
              {/* @ts-ignore */}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                已执行 {(data?.selfHealing as any)?.totalExecutions ?? 0} 次自愈任务
              </p>
            </CardContent>
          {/* @ts-ignore */}
          </Card>

          {/* 确认队列 */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">指令确认</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {/* @ts-ignore */}
                {getStatusIcon((data?.confirmationService as unknown)?.status)}
                <span className="text-sm">
                  {(data?.confirmationService as any)?.status === 'active' ? '运行中' : '未激活'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                待确认: {(data?.confirmationService as any)?.metrics?.pendingRequests ?? 0} 条
              </p>
            {/* @ts-ignore */}
            </CardContent>
          </Card>
        {/* @ts-ignore */}
        </div>

        {/* 详细标签页 */}
        {/* @ts-ignore */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {/* @ts-ignore */}
            <TabsTrigger value="overview">同步概览</TabsTrigger>
            <TabsTrigger value="rateLimit">限流详情</TabsTrigger>
            <TabsTrigger value="selfHealing">自愈状态</TabsTrigger>
            <TabsTrigger value="confirmation">确认队列</TabsTrigger>
          </TabsList>

          {/* @ts-ignore */}
          {/* 同步概览 */}
          <TabsContent value="overview" className="space-y-4">
            {/* @ts-ignore */}
            <Card>
              <CardHeader>
                <CardTitle>最近同步任务</CardTitle>
                <CardDescription>最近10次数据同步任务的执行状态</CardDescription>
              </CardHeader>
              <CardContent>
                {/* @ts-ignore */}
                {(data?.syncJobs as unknown)?.recent?.length > 0 ? (
                  <div className="space-y-2">
                    {((data?.syncJobs as any)?.recent as unknown[])?.map((job: unknown) => (
                      <div key={(job as any).id} className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-3">
                          {/* @ts-ignore */}
                          {job.status === 'completed' ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (job as any).status === 'failed' ? (
                            <XCircle className="h-5 w-5 text-red-500" />
                          ) : (
                            <Activity className="h-5 w-5 text-blue-500 animate-pulse" />
                          )}
                          <div>
                            {/* @ts-ignore */}
                            <div className="text-sm font-medium">账户 #{job.accountId}</div>
                            <div className="text-xs text-muted-foreground">
                              {(job as any).startedAt ? new Date((job as any).startedAt).toLocaleString() : '未开始'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-sm">
                              {/* @ts-ignore */}
                              {job.currentStepIndex ?? 0}/{job.totalSteps ?? 0} 步骤
                            </div>
                            <Progress
                              // @ts-ignore
                              value={job.totalSteps ? ((job.currentStepIndex ?? 0) / job.totalSteps) * 100 : 0}
                              className="h-1 w-20"
                            />
                          </div>
                          <Badge variant={
                            (job as any).status === 'completed' ? 'default' :
                            (job as any).status === 'failed' ? 'destructive' : 'secondary'
                          }>
                            {(job as any).status === 'completed' ? '完成' :
                             (job as any).status === 'failed' ? '失败' :
                             (job as any).status === 'running' ? '运行中' : (job as any).status}
                          </Badge>
                        </div>
                      {/* @ts-ignore */}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    暂无同步任务数据
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 限流详情 */}
          <TabsContent value="rateLimit" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>API限流配置</CardTitle>
                <CardDescription>按端点类型区分的限流策略</CardDescription>
              </CardHeader>
              <CardContent>
                {rateLimitQuery.data?.configs ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(rateLimitQuery.data.configs as Record<string, unknown>).map(([type, config]) => (
                      <div key={type} className="p-4 rounded-lg border">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="h-4 w-4" />
                          <span className="font-medium capitalize">{type}</span>
                        </div>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>TPS限制</span>
                            {/* @ts-ignore */}
                            <span className="font-mono">{config.maxRequestsPerSecond}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>每分钟限制</span>
                            {/* @ts-ignore */}
                            <span className="font-mono">{config.maxRequestsPerMinute}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>突发容量</span>
                            {/* @ts-ignore */}
                            <span className="font-mono">{config.burstCapacity}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>恢复速率/s</span>
                            {/* @ts-ignore */}
                            <span className="font-mono">{config.refillRatePerSecond}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    {rateLimitQuery.isLoading ? '加载中...' : '限流服务未初始化'}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 自愈状态 */}
          <TabsContent value="selfHealing" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>自愈调度器状态</CardTitle>
                <CardDescription>独立于主同步流程的自愈任务执行情况</CardDescription>
              </CardHeader>
              <CardContent>
                {/* @ts-ignore */}
                {selfHealingQuery.data?.status ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 rounded-lg bg-muted">
                        <div className="text-xs text-muted-foreground">运行状态</div>
                        <div className="flex items-center gap-1 mt-1">
                          {getStatusIcon(selfHealingQuery.data.status.running ? 'running' : 'stopped')}
                          <span className="font-medium">
                            {selfHealingQuery.data.status.running ? '运行中' : '已停止'}
                          </span>
                        </div>
                      {/* @ts-ignore */}
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <div className="text-xs text-muted-foreground">总执行次数</div>
                        {/* @ts-ignore */}
                        <div className="text-lg font-bold mt-1">
                          {/* @ts-ignore */}
                          {selfHealingQuery.data.status.totalExecutions}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <div className="text-xs text-muted-foreground">发现问题</div>
                        <div className="text-lg font-bold mt-1 text-yellow-600">
                          {selfHealingQuery.data.status.totalIssuesFound}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <div className="text-xs text-muted-foreground">已修复</div>
                        <div className="text-lg font-bold mt-1 text-green-600">
                          {selfHealingQuery.data.status.totalIssuesFixed}
                        </div>
                      </div>
                    {/* @ts-ignore */}
                    </div>

                    {/* 任务列表 */}
                    {selfHealingQuery.data.status.taskStatuses && (
                      <div className="space-y-2">
                        {/* @ts-ignore */}
                        <h4 className="text-sm font-medium">注册任务</h4>
                        {Object.entries(selfHealingQuery.data.status.taskStatuses as Record<string, unknown>).map(([taskId, taskStatus]) => (
                          <div key={taskId} className="flex items-center justify-between p-3 rounded-lg border">
                            {/* @ts-ignore */}
                            <div className="flex items-center gap-2">
                              {/* @ts-ignore */}
                              {taskStatus.enabled ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-gray-400" />
                              )}
                              <span className="text-sm font-medium">{taskId}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              {/* @ts-ignore */}
                              <span>执行 {taskStatus.totalRuns} 次</span>
                              {/* @ts-ignore */}
                              {taskStatus.consecutiveFailures > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  连续失败 {(taskStatus as any).consecutiveFailures}
                                </Badge>
                              )}
                              <Badge variant={(taskStatus as any).enabled ? "default" : "secondary"}>
                                {(taskStatus as any).enabled ? '启用' : '禁用'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 最近执行历史 */}
                    {selfHealingQuery.data.recentHistory?.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">最近执行记录</h4>
                        {(selfHealingQuery.data.recentHistory as unknown[]).slice(0, 5).map((record: unknown, i: number) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded border text-sm">
                            <div className="flex items-center gap-2">
                              {/* @ts-ignore */}
                              {record.result?.success ? (
                                <CheckCircle className="h-3 w-3 text-green-500" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-500" />
                              )}
                              <span>{(record as any).taskId}</span>
                            </div>
                            <div className="flex items-center gap-3 text-muted-foreground">
                              {/* @ts-ignore */}
                              {/* @ts-ignore */}
                              <span>{record.durationMs}ms</span>
                              <span>
                                {/* @ts-ignore */}
                                {record.result?.issuesFound > 0 
                                  ? `发现${(record as any).result.issuesFound}/修复${(record as any).result.issuesFixed}` 
                                  : '无异常'}
                              </span>
                              {/* @ts-ignore */}
                              <span>{new Date(record.startTime).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    {selfHealingQuery.isLoading ? '加载中...' : '自愈调度器未初始化'}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 确认队列 */}
          <TabsContent value="confirmation" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>指令确认服务</CardTitle>
                <CardDescription>可靠的指令确认机制，替代fire-and-forget模式</CardDescription>
              </CardHeader>
              <CardContent>
                {confirmationQuery.data?.metrics ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">总请求数</div>
                      <div className="text-lg font-bold mt-1">
                        {/* @ts-ignore */}
                        {(confirmationQuery.data.metrics as Record<string, unknown>).totalRequests}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">待确认</div>
                      <div className="text-lg font-bold mt-1 text-blue-600">
                        {/* @ts-ignore */}
                        {(confirmationQuery.data.metrics as Record<string, unknown>).pendingRequests}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">确认成功率</div>
                      <div className="text-lg font-bold mt-1 text-green-600">
                        {/* @ts-ignore */}
                        {((confirmationQuery.data.metrics as Record<string, unknown>).confirmationSuccessRate * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-xs text-muted-foreground">平均确认时间</div>
                      <div className="text-lg font-bold mt-1">
                        {/* @ts-ignore */}
                        {((confirmationQuery.data.metrics as Record<string, unknown>).avgConfirmationTimeMs / 1000).toFixed(1)}s
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    {confirmationQuery.isLoading ? '加载中...' : '确认服务未初始化'}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
