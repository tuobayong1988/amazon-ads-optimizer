/**
 * Data Sync Page - 广告数据自动同步页面
 * 管理Amazon API数据同步任务和限流状态
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Activity, AlertTriangle, CheckCircle, Clock, Database, Gauge, Loader2, Play, RefreshCw, Server, XCircle } from "lucide-react";
import { toast } from "sonner";

type SyncType = "campaigns" | "keywords" | "performance" | "all";
type SyncStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export default function DataSync() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("jobs");
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

  const formatDuration = (startedAt: Date | null, completedAt: Date | null) => {
    if (!startedAt) return "N/A";
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const duration = Math.round((end - start) / 1000);
    if (duration < 60) return `${duration}秒`;
    if (duration < 3600) return `${Math.round(duration / 60)}分钟`;
    return `${Math.round(duration / 3600)}小时`;
  };

  return (
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
          <TabsTrigger value="jobs">
            <Database className="h-4 w-4 mr-2" />
            同步任务
          </TabsTrigger>
          <TabsTrigger value="ratelimit">
            <Gauge className="h-4 w-4 mr-2" />
            API限流
          </TabsTrigger>
        </TabsList>

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
      </Tabs>
    </div>
  );
}
