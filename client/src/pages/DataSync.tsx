/**
 * Data Sync Page - 广告数据自动同步页面
 * 管理Amazon API数据同步任务和限流状态
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Activity, AlertTriangle, Calendar, CheckCircle, Clock, Database, Gauge, History, Loader2, Pause, Play, Plus, RefreshCw, RotateCcw, Server, Trash2, XCircle, Zap } from "lucide-react";
import { InitializationProgress } from "@/components/InitializationProgress";
import { TieredSyncProgress } from "@/components/TieredSyncProgress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type SyncType = "campaigns" | "keywords" | "performance" | "all";
type SyncStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type ScheduleFrequency = "hourly" | "daily" | "weekly" | "monthly";

export default function DataSync() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("tiered");
  const [syncType, setSyncType] = useState<SyncType>("all");
  const [statusFilter, setStatusFilter] = useState<SyncStatus | "all">("all");

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取同步任务列表
  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs } = trpc.dataSync.getJobs.useQuery({
    accountId: accountId || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 50,
    offset: 0,
  });

  // 获取限流状态
  const { data: rateLimitStatus, refetch: refetchRateLimit } = trpc.dataSync.getRateLimitStatus.useQuery();

  // 获取调度配置列表
  const { data: schedules, isLoading: schedulesLoading, refetch: refetchSchedules } = trpc.dataSync.getSchedules.useQuery({
    accountId: accountId || undefined,
  });

  // 新建调度表单状态
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    syncType: "all" as SyncType,
    frequency: "daily" as ScheduleFrequency,
    hour: 2,
    dayOfWeek: 1,
    dayOfMonth: 1,
    isEnabled: true,
  });

  // 创建同步任务
  const createJobMutation = trpc.dataSync.createJob.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`同步任务已创建 (ID: ${result.jobId})`);
        refetchJobs();
      } else {
        toast.error(result.message || "创建失败");
      }
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  // 取消同步任务
  const cancelJobMutation = trpc.dataSync.cancelJob.useMutation({
    onSuccess: () => {
      toast.success("任务已取消");
      refetchJobs();
    },
    onError: (error) => {
      toast.error(`取消失败: ${error.message}`);
    },
  });

  // 创建调度
  const createScheduleMutation = trpc.dataSync.createSchedule.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("调度已创建");
        setShowCreateSchedule(false);
        refetchSchedules();
      } else {
        toast.error(result.message || "创建失败");
      }
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  // 更新调度
  const updateScheduleMutation = trpc.dataSync.updateSchedule.useMutation({
    onSuccess: () => {
      toast.success("调度已更新");
      refetchSchedules();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 删除调度
  const deleteScheduleMutation = trpc.dataSync.deleteSchedule.useMutation({
    onSuccess: () => {
      toast.success("调度已删除");
      refetchSchedules();
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  // 手动触发调度
  const triggerScheduleMutation = trpc.dataSync.triggerSchedule.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`同步任务已启动 (ID: ${result.jobId})`);
        refetchJobs();
        refetchSchedules();
      } else {
        toast.error(result.message || "触发失败");
      }
    },
    onError: (error) => {
      toast.error(`触发失败: ${error.message}`);
    },
  });

  // 手动触发调度（带重试）
  const triggerWithRetryMutation = trpc.dataSync.triggerScheduleWithRetry.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`同步任务已完成 (ID: ${result.jobId})${result.retryCount > 0 ? `, 重试了 ${result.retryCount} 次` : ''}`);
        refetchJobs();
        refetchSchedules();
        refetchExecutionHistory();
      } else {
        toast.error(result.message || "执行失败");
      }
    },
    onError: (error) => {
      toast.error(`执行失败: ${error.message}`);
    },
  });

  // 执行历史状态
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  // 获取执行历史
  const { data: executionHistory, refetch: refetchExecutionHistory } = trpc.dataSync.getScheduleExecutionHistory.useQuery(
    { scheduleId: selectedScheduleId || 0, limit: 50 },
    { enabled: !!selectedScheduleId }
  );

  // 获取执行统计
  const { data: executionStats } = trpc.dataSync.getScheduleExecutionStats.useQuery(
    { scheduleId: selectedScheduleId || 0 },
    { enabled: !!selectedScheduleId }
  );

  const openHistoryDialog = (scheduleId: number) => {
    setSelectedScheduleId(scheduleId);
    setShowHistoryDialog(true);
  };

  const handleCreateJob = () => {
    if (!accountId) {
      toast.error("请先选择广告账号");
      return;
    }
    createJobMutation.mutate({
      accountId,
      syncType,
    });
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled":
        return <XCircle className="h-4 w-4 text-gray-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500">等待中</Badge>;
      case "running":
        return <Badge className="bg-blue-500">运行中</Badge>;
      case "completed":
        return <Badge className="bg-green-500">已完成</Badge>;
      case "failed":
        return <Badge variant="destructive">失败</Badge>;
      case "cancelled":
        return <Badge variant="secondary">已取消</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getSyncTypeName = (type: string | null) => {
    const names: Record<string, string> = {
      campaigns: "广告活动",
      keywords: "关键词",
      performance: "绩效数据",
      all: "全量同步",
    };
    return names[type || ""] || type || "未知";
  };

  const formatDuration = (startedAt: Date | string | null, completedAt: Date | string | null) => {
    if (!startedAt) return "N/A";
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const duration = Math.round((end - start) / 1000);
    if (duration < 60) return `${duration}秒`;
    if (duration < 3600) return `${Math.round(duration / 60)}分钟`;
    return `${Math.round(duration / 3600)}小时`;
  };

  // 检查是否有已授权的账号
  const hasAuthorizedAccounts = accounts && accounts.length > 0;

  // 如果没有已授权账号，显示引导页面
  if (!hasAuthorizedAccounts) {
    return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="p-6 rounded-full bg-muted/50 mb-6">
            <RefreshCw className="w-16 h-16 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">开始同步您的广告数据</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            请先连接Amazon Advertising API授权您的广告账号，系统将自动同步您的广告数据，无需手动上传。
          </p>
          <div className="bg-muted/30 rounded-lg p-4 mb-6 max-w-md text-left">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              API同步的优势
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• 数据实时准确，避免人工错误</li>
              <li>• 自动定时同步，无需手动操作</li>
              <li>• 支持多账号统一管理</li>
              <li>• 完整的数据历史记录</li>
            </ul>
          </div>
          <Button onClick={() => window.location.href = '/amazon-api'}>
            <Server className="w-4 h-4 mr-2" />
            连接Amazon API
          </Button>
        </div>
      </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">数据同步</h1>
          <p className="text-muted-foreground">管理Amazon广告数据同步任务和API限流</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedAccountId?.toString() || "all"} onValueChange={(v) => setSelectedAccountId(v === "all" ? null : Number(v))}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择账号" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部账号</SelectItem>
              {accounts?.map((account) => (
                <SelectItem key={account.id} value={account.id.toString()}>
                  {account.accountName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { refetchJobs(); refetchRateLimit(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="initialization">
            <Zap className="h-4 w-4 mr-2" />
            初始化进度
          </TabsTrigger>
          <TabsTrigger value="tiered">
            <Zap className="h-4 w-4 mr-2" />
            智能分层
          </TabsTrigger>
          <TabsTrigger value="jobs">
            <Database className="h-4 w-4 mr-2" />
            同步任务
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <Calendar className="h-4 w-4 mr-2" />
            定时调度
          </TabsTrigger>
          <TabsTrigger value="ratelimit">
            <Gauge className="h-4 w-4 mr-2" />
            API限流
          </TabsTrigger>
        </TabsList>

        <TabsContent value="initialization" className="space-y-4">
          {accountId ? (
            <InitializationProgress 
              accountId={accountId} 
              accountName={accounts?.find(a => a.id === accountId)?.accountName}
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-center">请先选择一个账号</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tiered" className="space-y-4">
          {accountId ? (
            <TieredSyncProgress 
              accountId={accountId} 
              accountName={accounts?.find(a => a.id === accountId)?.accountName}
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">请先选择一个广告账号</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          {/* 创建任务 */}
          <Card>
            <CardHeader>
              <CardTitle>创建同步任务</CardTitle>
              <CardDescription>从Amazon API拉取最新的广告数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">同步类型</label>
                  <Select value={syncType} onValueChange={(v) => setSyncType(v as SyncType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全量同步</SelectItem>
                      <SelectItem value="campaigns">广告活动</SelectItem>
                      <SelectItem value="keywords">关键词</SelectItem>
                      <SelectItem value="performance">绩效数据</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreateJob} disabled={createJobMutation.isPending || !accountId}>
                  <Play className="h-4 w-4 mr-2" />
                  开始同步
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                    <Loader2 className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">运行中</p>
                    <p className="text-2xl font-bold">
                      {jobsData?.jobs.filter(j => j.status === "running").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">已完成</p>
                    <p className="text-2xl font-bold">
                      {jobsData?.jobs.filter(j => j.status === "completed").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-red-100 dark:bg-red-900">
                    <XCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">失败</p>
                    <p className="text-2xl font-bold">
                      {jobsData?.jobs.filter(j => j.status === "failed").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900">
                    <Database className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">总同步记录</p>
                    <p className="text-2xl font-bold">
                      {jobsData?.jobs.reduce((sum, j) => sum + (j.recordsSynced || 0), 0).toLocaleString() || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 筛选器 */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-4">
                <div className="w-48">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SyncStatus | "all")}>
                    <SelectTrigger>
                      <SelectValue placeholder="状态筛选" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="pending">等待中</SelectItem>
                      <SelectItem value="running">运行中</SelectItem>
                      <SelectItem value="completed">已完成</SelectItem>
                      <SelectItem value="failed">失败</SelectItem>
                      <SelectItem value="cancelled">已取消</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 任务列表 */}
          <Card>
            <CardHeader>
              <CardTitle>同步任务列表</CardTitle>
              <CardDescription>共 {jobsData?.total || 0} 个任务</CardDescription>
            </CardHeader>
            <CardContent>
              {jobsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : jobsData?.jobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无同步任务</p>
                  <p className="text-sm mt-2">点击"开始同步"创建新的同步任务</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {jobsData?.jobs.map((job) => (
                    <div
                      key={job.id}
                      className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(job.status)}
                          <div>
                            <p className="font-medium">任务 #{job.id}</p>
                            <p className="text-sm text-muted-foreground">{getSyncTypeName(job.syncType)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(job.status)}
                          {job.status === "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancelJobMutation.mutate({ jobId: job.id })}
                              disabled={cancelJobMutation.isPending}
                            >
                              取消
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">同步记录</p>
                          <p className="font-medium">{(job.recordsSynced || 0).toLocaleString()}</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">耗时</p>
                          <p className="font-medium">{formatDuration(job.startedAt, job.completedAt)}</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">创建时间</p>
                          <p className="font-medium text-xs">
                            {job.createdAt ? new Date(job.createdAt).toLocaleString() : "N/A"}
                          </p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded">
                          <p className="text-xs text-muted-foreground">完成时间</p>
                          <p className="font-medium text-xs">
                            {job.completedAt ? new Date(job.completedAt).toLocaleString() : "进行中"}
                          </p>
                        </div>
                      </div>

                      {job.errorMessage && (
                        <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-4 w-4 inline mr-1" />
                          {job.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ratelimit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API限流状态</CardTitle>
              <CardDescription>Amazon Advertising API调用配额和使用情况</CardDescription>
            </CardHeader>
            <CardContent>
              {!rateLimitStatus ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Gauge className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无限流数据</p>
                  <p className="text-sm mt-2">开始同步任务后将显示API使用情况</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="h-5 w-5 text-blue-500" />
                          <span className="font-medium">每秒请求</span>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-muted-foreground">
                            {rateLimitStatus.requestCounts?.second || 0} / {rateLimitStatus.limits?.requestsPerSecond || 5}
                          </span>
                          <span className="text-sm">
                            {Math.round(((rateLimitStatus.requestCounts?.second || 0) / (rateLimitStatus.limits?.requestsPerSecond || 5)) * 100)}%
                          </span>
                        </div>
                        <Progress 
                          value={((rateLimitStatus.requestCounts?.second || 0) / (rateLimitStatus.limits?.requestsPerSecond || 5)) * 100} 
                        />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-5 w-5 text-green-500" />
                          <span className="font-medium">每分钟请求</span>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-muted-foreground">
                            {rateLimitStatus.requestCounts?.minute || 0} / {rateLimitStatus.limits?.requestsPerMinute || 100}
                          </span>
                          <span className="text-sm">
                            {Math.round(((rateLimitStatus.requestCounts?.minute || 0) / (rateLimitStatus.limits?.requestsPerMinute || 100)) * 100)}%
                          </span>
                        </div>
                        <Progress 
                          value={((rateLimitStatus.requestCounts?.minute || 0) / (rateLimitStatus.limits?.requestsPerMinute || 100)) * 100} 
                        />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Server className="h-5 w-5 text-purple-500" />
                          <span className="font-medium">每小时请求</span>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-muted-foreground">
                            {rateLimitStatus.requestCounts?.hour || 0} / {rateLimitStatus.limits?.requestsPerHour || 1000}
                          </span>
                          <span className="text-sm">
                            {Math.round(((rateLimitStatus.requestCounts?.hour || 0) / (rateLimitStatus.limits?.requestsPerHour || 1000)) * 100)}%
                          </span>
                        </div>
                        <Progress 
                          value={((rateLimitStatus.requestCounts?.hour || 0) / (rateLimitStatus.limits?.requestsPerHour || 1000)) * 100} 
                        />
                      </CardContent>
                    </Card>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium mb-3">限流配置</h3>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">每秒限制</p>
                        <p className="font-medium">{rateLimitStatus.limits?.requestsPerSecond || 5} 请求</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">每分钟限制</p>
                        <p className="font-medium">{rateLimitStatus.limits?.requestsPerMinute || 100} 请求</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">每小时限制</p>
                        <p className="font-medium">{rateLimitStatus.limits?.requestsPerHour || 1000} 请求</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">队列长度</p>
                        <p className="font-medium">{rateLimitStatus.queueLength || 0} 待处理</p>
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p>说明：系统会自动管理API调用频率，确保不超过Amazon的限制。当达到限制时，请求会自动排队等待。</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4">
          {/* 创建调度 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>定时同步调度</CardTitle>
                  <CardDescription>配置自动化数据同步任务</CardDescription>
                </div>
                <Dialog open={showCreateSchedule} onOpenChange={setShowCreateSchedule}>
                  <DialogTrigger asChild>
                    <Button disabled={!accountId}>
                      <Plus className="h-4 w-4 mr-2" />
                      新建调度
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>创建定时同步调度</DialogTitle>
                      <DialogDescription>配置自动化数据同步任务</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>同步类型</Label>
                        <Select value={newSchedule.syncType} onValueChange={(v) => setNewSchedule({ ...newSchedule, syncType: v as SyncType })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全量同步</SelectItem>
                            <SelectItem value="campaigns">广告活动</SelectItem>
                            <SelectItem value="keywords">关键词</SelectItem>
                            <SelectItem value="performance">绩效数据</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>执行频率</Label>
                        <Select value={newSchedule.frequency} onValueChange={(v) => setNewSchedule({ ...newSchedule, frequency: v as ScheduleFrequency })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hourly">每小时</SelectItem>
                            <SelectItem value="daily">每天</SelectItem>
                            <SelectItem value="weekly">每周</SelectItem>
                            <SelectItem value="monthly">每月</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {newSchedule.frequency !== "hourly" && (
                        <div className="space-y-2">
                          <Label>执行时间 (小时)</Label>
                          <Select value={newSchedule.hour.toString()} onValueChange={(v) => setNewSchedule({ ...newSchedule, hour: Number(v) })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, "0")}:00</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {newSchedule.frequency === "weekly" && (
                        <div className="space-y-2">
                          <Label>执行星期</Label>
                          <Select value={newSchedule.dayOfWeek.toString()} onValueChange={(v) => setNewSchedule({ ...newSchedule, dayOfWeek: Number(v) })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">周日</SelectItem>
                              <SelectItem value="1">周一</SelectItem>
                              <SelectItem value="2">周二</SelectItem>
                              <SelectItem value="3">周三</SelectItem>
                              <SelectItem value="4">周四</SelectItem>
                              <SelectItem value="5">周五</SelectItem>
                              <SelectItem value="6">周六</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {newSchedule.frequency === "monthly" && (
                        <div className="space-y-2">
                          <Label>执行日期</Label>
                          <Select value={newSchedule.dayOfMonth.toString()} onValueChange={(v) => setNewSchedule({ ...newSchedule, dayOfMonth: Number(v) })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 28 }, (_, i) => (
                                <SelectItem key={i + 1} value={(i + 1).toString()}>{i + 1}日</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <Label>立即启用</Label>
                        <Switch checked={newSchedule.isEnabled} onCheckedChange={(v) => setNewSchedule({ ...newSchedule, isEnabled: v })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowCreateSchedule(false)}>取消</Button>
                      <Button onClick={() => {
                        if (!accountId) return;
                        createScheduleMutation.mutate({
                          accountId,
                          ...newSchedule,
                        });
                      }} disabled={createScheduleMutation.isPending}>
                        创建
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {schedulesLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : !schedules || (schedules as any[]).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无调度配置</p>
                  <p className="text-sm mt-2">创建定时调度以自动同步广告数据</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(schedules as any[]).map((schedule: any) => (
                    <div key={schedule.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${schedule.isEnabled ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                            <Calendar className={`h-5 w-5 ${schedule.isEnabled ? 'text-green-500' : 'text-gray-500'}`} />
                          </div>
                          <div>
                            <p className="font-medium">{getSyncTypeName(schedule.syncType)}</p>
                            <p className="text-sm text-muted-foreground">
                              {schedule.frequency === 'hourly' && '每小时执行'}
                              {schedule.frequency === 'daily' && `每天 ${schedule.hour?.toString().padStart(2, '0')}:00 执行`}
                              {schedule.frequency === 'weekly' && `每周${['日', '一', '二', '三', '四', '五', '六'][schedule.dayOfWeek || 0]} ${schedule.hour?.toString().padStart(2, '0')}:00 执行`}
                              {schedule.frequency === 'monthly' && `每月${schedule.dayOfMonth}日 ${schedule.hour?.toString().padStart(2, '0')}:00 执行`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={schedule.isEnabled ? 'bg-green-500' : 'bg-gray-500'}>
                            {schedule.isEnabled ? '已启用' : '已禁用'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openHistoryDialog(schedule.id)}
                            title="查看执行历史"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => triggerWithRetryMutation.mutate({ scheduleId: schedule.id })}
                            disabled={triggerWithRetryMutation.isPending}
                            title="立即执行（带自动重试）"
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            执行
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateScheduleMutation.mutate({ id: schedule.id, isEnabled: !schedule.isEnabled })}
                          >
                            {schedule.isEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteScheduleMutation.mutate({ id: schedule.id })}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">上次执行</p>
                          <p className="font-medium">
                            {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : '从未执行'}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">下次执行</p>
                          <p className="font-medium">
                            {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">创建时间</p>
                          <p className="font-medium">
                            {schedule.createdAt ? new Date(schedule.createdAt).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 调度说明 */}
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p><strong>定时调度说明：</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>每小时：每小时整点执行一次同步</li>
                  <li>每天：在指定时间执行一次同步，建议选择低峰时段（如凌晨 2-4 点）</li>
                  <li>每周：在指定星期和时间执行一次同步</li>
                  <li>每月：在指定日期和时间执行一次同步</li>
                </ul>
                <p className="mt-2">提示：建议根据数据更新频率和业务需求选择合适的同步频率。过于频繁的同步可能会消耗较多API配额。</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 执行历史对话框 */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>调度执行历史</DialogTitle>
            <DialogDescription>查看此调度的历史执行记录和统计信息</DialogDescription>
          </DialogHeader>
          
          {/* 执行统计 */}
          {executionStats && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-6">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">总执行次数</p>
                <p className="text-xl font-semibold">{executionStats.totalExecutions}</p>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <p className="text-xs text-green-500 mb-1">成功次数</p>
                <p className="text-xl font-semibold text-green-500">{executionStats.successCount}</p>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <p className="text-xs text-red-500 mb-1">失败次数</p>
                <p className="text-xl font-semibold text-red-500">{executionStats.failureCount}</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">平均耗时</p>
                <p className="text-xl font-semibold">{executionStats.avgDuration ? `${executionStats.avgDuration.toFixed(0)}s` : 'N/A'}</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">上次成功</p>
                <p className="text-sm font-medium">{executionStats.lastSuccessAt ? new Date(executionStats.lastSuccessAt).toLocaleDateString() : 'N/A'}</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">上次失败</p>
                <p className="text-sm font-medium">{executionStats.lastFailureAt ? new Date(executionStats.lastFailureAt).toLocaleDateString() : 'N/A'}</p>
              </div>
            </div>
          )}

          {/* 执行历史列表 */}
          <div className="space-y-2">
            <h4 className="font-medium mb-3">执行记录</h4>
            {!executionHistory || (executionHistory as any[]).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无执行记录</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">状态</th>
                      <th className="text-left p-2">开始时间</th>
                      <th className="text-left p-2">完成时间</th>
                      <th className="text-right p-2">耗时</th>
                      <th className="text-right p-2">同步记录</th>
                      <th className="text-right p-2">重试次数</th>
                      <th className="text-left p-2">错误信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(executionHistory as any[]).map((record: any, index: number) => (
                      <tr key={index} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <Badge className={record.status === 'success' ? 'bg-green-500' : record.status === 'retrying' ? 'bg-yellow-500' : 'bg-red-500'}>
                            {record.status === 'success' ? '成功' : record.status === 'retrying' ? '重试中' : '失败'}
                          </Badge>
                        </td>
                        <td className="p-2 text-sm">
                          {record.startedAt ? new Date(record.startedAt).toLocaleString() : 'N/A'}
                        </td>
                        <td className="p-2 text-sm">
                          {record.completedAt ? new Date(record.completedAt).toLocaleString() : '-'}
                        </td>
                        <td className="p-2 text-right text-sm">
                          {record.duration ? `${record.duration}s` : '-'}
                        </td>
                        <td className="p-2 text-right text-sm">
                          {record.recordsSynced || 0}
                        </td>
                        <td className="p-2 text-right text-sm">
                          {record.retryCount > 0 ? (
                            <Badge variant="outline" className="text-yellow-500 border-yellow-500">
                              {record.retryCount}次
                            </Badge>
                          ) : '-'}
                        </td>
                        <td className="p-2 text-sm text-red-500 max-w-xs truncate" title={record.errorMessage || ''}>
                          {record.errorMessage || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}
