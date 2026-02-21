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
  BarChart3,
  Clock,
  Zap,
  TrendingUp,
  Search,
  MinusCircle,
  Settings,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";

export default function AutoCorrectionDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  
  // 获取仪表盘数据
  const dashboardQuery = trpc.autoCorrection.getDashboard.useQuery(undefined, {
    refetchInterval: 60000, // 每60秒刷新
  });
  
  // 获取扫描历史
  const historyQuery = trpc.autoCorrection.getScanHistory.useQuery();
  
  // 手动触发扫描
  const runScanMutation = trpc.autoCorrection.runScan.useMutation({
    onSuccess: (result) => {
      toast.success(`纠错扫描完成: 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个`);
      dashboardQuery.refetch();
      historyQuery.refetch();
    },
    onError: (error) => {
      toast.error(`扫描失败: ${error.message}`);
    },
  });
  
  const dashboard = dashboardQuery.data;
  const history = historyQuery.data || [];
  
  // 计算状态分布
  const statusMap = new Map<string, number>();
  if (dashboard?.statusDistribution) {
    for (const s of dashboard.statusDistribution as any[]) {
      statusMap.set(s.api_sync_status, Number(s.count));
    }
  }
  const totalEvents = Array.from(statusMap.values()).reduce((a, b) => a + b, 0);
  const syncedCount = statusMap.get('synced') || 0;
  const failedCount = (statusMap.get('failed') || 0) + (statusMap.get('not_applicable') || 0) + (statusMap.get('invalid_legacy') || 0);
  const pendingCount = statusMap.get('pending') || 0;
  const syncRate = totalEvents > 0 ? ((syncedCount / totalEvents) * 100) : 0;
  
  // 按操作类型分组统计
  const actionBreakdown = new Map<string, { synced: number; failed: number; pending: number; total: number }>();
  if (dashboard?.actionTypeBreakdown) {
    for (const a of dashboard.actionTypeBreakdown as any[]) {
      const type = a.action_type;
      if (!actionBreakdown.has(type)) actionBreakdown.set(type, { synced: 0, failed: 0, pending: 0, total: 0 });
      const entry = actionBreakdown.get(type)!;
      const count = Number(a.count);
      entry.total += count;
      if (a.api_sync_status === 'synced') entry.synced += count;
      else if (a.api_sync_status === 'failed' || a.api_sync_status === 'not_applicable' || a.api_sync_status === 'invalid_legacy') entry.failed += count;
      else if (a.api_sync_status === 'pending') entry.pending += count;
    }
  }
  
  const actionTypeLabels: Record<string, string> = {
    'bid_auto_adjust': '出价调整',
    'bid_increase': '出价提高',
    'bid_decrease': '出价降低',
    'bid_set': '出价设定',
    'budget_adjustment': '预算调整',
    'budget_increase': '预算提高',
    'budget_decrease': '预算降低',
    'budget_set': '预算设定',
    'placement_adjust': '位置倾斜',
    'keyword_create': '关键词创建',
    'negative_keyword_add': '否定关键词',
    'search_term_harvest': '搜索词收割',
    'settings_update': '设置变更',
    'dayparting_bid': '分时出价',
    'target_pause': '暂停投放',
    'target_enable': '启用投放',
    'campaign_pause': '暂停活动',
    'campaign_enable': '启用活动',
  };
  
  const formatDate = (d: any) => {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="h-7 w-7 text-blue-400" />
              AutoCorrector 纠错监控
            </h1>
            <p className="text-gray-400 mt-1">
              v177 - 实时监控自动纠错系统运行状态、同步成功率和历史趋势
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { dashboardQuery.refetch(); historyQuery.refetch(); }}
              disabled={dashboardQuery.isRefetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${dashboardQuery.isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => runScanMutation.mutate({})}
              disabled={runScanMutation.isPending || dashboard?.scanStatus?.isScanning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <PlayCircle className="h-4 w-4 mr-1" />
              {runScanMutation.isPending ? '扫描中...' : '手动扫描'}
            </Button>
          </div>
        </div>
        
        {/* 顶部统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">总事件数</p>
                  <p className="text-3xl font-bold text-white">{totalEvents.toLocaleString()}</p>
                </div>
                <BarChart3 className="h-10 w-10 text-blue-400 opacity-50" />
              </div>
              <div className="mt-2">
                <Progress value={syncRate} className="h-2" />
                <p className="text-xs text-gray-500 mt-1">同步率 {syncRate.toFixed(1)}%</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">已同步</p>
                  <p className="text-3xl font-bold text-green-400">{syncedCount.toLocaleString()}</p>
                </div>
                <CheckCircle className="h-10 w-10 text-green-400 opacity-50" />
              </div>
              <p className="text-xs text-gray-500 mt-2">成功同步到Amazon的优化事件</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">失败/不适用</p>
                  <p className="text-3xl font-bold text-amber-400">{failedCount.toLocaleString()}</p>
                </div>
                <AlertTriangle className="h-10 w-10 text-amber-400 opacity-50" />
              </div>
              <p className="text-xs text-gray-500 mt-2">包含历史遗留和永久失败事件</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">待处理</p>
                  <p className="text-3xl font-bold text-blue-400">{pendingCount.toLocaleString()}</p>
                </div>
                <Clock className="h-10 w-10 text-blue-400 opacity-50" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {dashboard?.harvestRetryStats ? `搜索词收割待重试: ${(dashboard.harvestRetryStats as any).retryable || 0}` : '加载中...'}
              </p>
            </CardContent>
          </Card>
        </div>
        
        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-gray-900 border-gray-800">
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="actions">操作类型</TabsTrigger>
            <TabsTrigger value="history">扫描历史</TabsTrigger>
            <TabsTrigger value="recent">最近纠错</TabsTrigger>
          </TabsList>
          
          {/* 概览标签 */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 最近扫描结果 */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-400" />
                    最近扫描结果
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dashboard?.lastScan ? (
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">扫描ID</span>
                        <span className="text-gray-300 font-mono text-xs">{(dashboard.lastScan as any).scanId}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">扫描时间</span>
                        <span className="text-gray-300">{formatDate((dashboard.lastScan as any).completedAt)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">账户数</span>
                        <span className="text-gray-300">{(dashboard.lastScan as any).accountsScanned}</span>
                      </div>
                      <div className="border-t border-gray-800 pt-3 mt-3">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-2xl font-bold text-white">{(dashboard.lastScan as any).totalIssuesFound}</p>
                            <p className="text-xs text-gray-500">发现问题</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-green-400">{(dashboard.lastScan as any).totalCorrected}</p>
                            <p className="text-xs text-gray-500">已纠正</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-red-400">{(dashboard.lastScan as any).totalFailed}</p>
                            <p className="text-xs text-gray-500">失败</p>
                          </div>
                        </div>
                      </div>
                      {/* 详细分类 */}
                      {(dashboard.lastScan as any).details && (
                        <div className="border-t border-gray-800 pt-3 mt-3 space-y-2">
                          <p className="text-xs text-gray-500 font-medium">分类详情</p>
                          {Object.entries((dashboard.lastScan as any).details).map(([key, val]: [string, any]) => {
                            if (val.found === 0) return null;
                            const labels: Record<string, string> = {
                              bidRetries: '出价重试',
                              bidMismatches: '出价不一致',
                              budgetRetries: '预算重试',
                              budgetMismatches: '预算不一致',
                              placementMismatches: '位置不一致',
                              rollbackExecutions: '回滚执行',
                              settingsRetries: '设置重试',
                              keywordCreateRetries: '关键词创建重试',
                              maxBidViolations: '最高出价违规',
                              orphanKeywordCleanups: '孤儿关键词清理',
                            };
                            return (
                              <div key={key} className="flex justify-between text-xs">
                                <span className="text-gray-400">{labels[key] || key}</span>
                                <span>
                                  <span className="text-green-400">{val.corrected}</span>
                                  <span className="text-gray-600">/</span>
                                  <span className="text-gray-300">{val.found}</span>
                                  {val.failed > 0 && <span className="text-red-400 ml-1">({val.failed}失败)</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">暂无扫描记录</p>
                  )}
                </CardContent>
              </Card>
              
              {/* 扫描状态和配置 */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <Settings className="h-5 w-5 text-gray-400" />
                    系统状态与配置
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">扫描状态</span>
                      <Badge variant={dashboard?.scanStatus?.isScanning ? "default" : "secondary"}>
                        {dashboard?.scanStatus?.isScanning ? '扫描中' : '空闲'}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">上次扫描</span>
                      <span className="text-gray-300">{formatDate(dashboard?.scanStatus?.lastScanTime)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">历史扫描数</span>
                      <span className="text-gray-300">{dashboard?.scanStatus?.historyCount || 0}</span>
                    </div>
                    
                    {dashboard?.config && (
                      <>
                        <div className="border-t border-gray-800 pt-3 mt-3">
                          <p className="text-xs text-gray-500 font-medium mb-2">纠错配置</p>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">最大出价纠正/次</span>
                          <span className="text-gray-300">{(dashboard.config as any).maxBidCorrectionsPerRun}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">最大预算纠正/次</span>
                          <span className="text-gray-300">{(dashboard.config as any).maxBudgetCorrectionsPerRun}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">最大重试次数</span>
                          <span className="text-gray-300">{(dashboard.config as any).maxRetryAttempts}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">重试过期天数</span>
                          <span className="text-gray-300">{(dashboard.config as any).retryExpiryDays}天</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">出价容差</span>
                          <span className="text-gray-300">${(dashboard.config as any).bidToleranceDollar}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">预算容差</span>
                          <span className="text-gray-300">${(dashboard.config as any).budgetToleranceDollar}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">扫描间隔</span>
                          <span className="text-gray-300">{(dashboard.config as any).scanIntervalHours}小时</span>
                        </div>
                      </>
                    )}
                    
                    {/* 搜索词收割重试统计 */}
                    {dashboard?.harvestRetryStats && (
                      <>
                        <div className="border-t border-gray-800 pt-3 mt-3">
                          <p className="text-xs text-gray-500 font-medium mb-2">搜索词收割重试</p>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">待处理总数</span>
                          <span className="text-gray-300">{Number((dashboard.harvestRetryStats as any).total || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">可重试数</span>
                          <span className="text-amber-400 font-medium">{Number((dashboard.harvestRetryStats as any).retryable || 0).toLocaleString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 7天趋势 */}
            {dashboard?.trendData && (dashboard.trendData as any[]).length > 0 && (
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-400" />
                    最近7天纠错趋势
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-left text-gray-400 py-2 px-3">日期</th>
                          <th className="text-right text-gray-400 py-2 px-3">总纠正数</th>
                          <th className="text-right text-gray-400 py-2 px-3">成功</th>
                          <th className="text-right text-gray-400 py-2 px-3">失败</th>
                          <th className="text-right text-gray-400 py-2 px-3">成功率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard.trendData as any[]).map((t: any, i: number) => {
                          const total = Number(t.corrections);
                          const synced = Number(t.synced);
                          const failed = Number(t.failed);
                          const rate = total > 0 ? (synced / total * 100) : 0;
                          return (
                            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                              <td className="py-2 px-3 text-gray-300">{t.date ? new Date(t.date).toLocaleDateString('zh-CN') : '-'}</td>
                              <td className="py-2 px-3 text-right text-gray-300">{total}</td>
                              <td className="py-2 px-3 text-right text-green-400">{synced}</td>
                              <td className="py-2 px-3 text-right text-red-400">{failed}</td>
                              <td className="py-2 px-3 text-right">
                                <Badge variant={rate >= 95 ? "default" : rate >= 80 ? "secondary" : "destructive"} className="text-xs">
                                  {rate.toFixed(1)}%
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          {/* 操作类型标签 */}
          <TabsContent value="actions" className="space-y-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-lg">按操作类型统计</CardTitle>
                <CardDescription>各类优化操作的同步状态分布</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-400 py-2 px-3">操作类型</th>
                        <th className="text-right text-gray-400 py-2 px-3">总数</th>
                        <th className="text-right text-gray-400 py-2 px-3">已同步</th>
                        <th className="text-right text-gray-400 py-2 px-3">失败</th>
                        <th className="text-right text-gray-400 py-2 px-3">待处理</th>
                        <th className="text-right text-gray-400 py-2 px-3">同步率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(actionBreakdown.entries())
                        .sort((a, b) => b[1].total - a[1].total)
                        .map(([type, stats]) => {
                          const rate = stats.total > 0 ? (stats.synced / stats.total * 100) : 0;
                          return (
                            <tr key={type} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                              <td className="py-2 px-3">
                                <span className="text-gray-300">{actionTypeLabels[type] || type}</span>
                                <span className="text-gray-600 text-xs ml-2">({type})</span>
                              </td>
                              <td className="py-2 px-3 text-right text-gray-300">{stats.total.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right text-green-400">{stats.synced.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right text-red-400">{stats.failed > 0 ? stats.failed.toLocaleString() : '-'}</td>
                              <td className="py-2 px-3 text-right text-blue-400">{stats.pending > 0 ? stats.pending.toLocaleString() : '-'}</td>
                              <td className="py-2 px-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Progress value={rate} className="h-1.5 w-16" />
                                  <span className={`text-xs font-medium ${rate >= 95 ? 'text-green-400' : rate >= 80 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {rate.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            
            {/* 否定关键词状态 */}
            {dashboard?.negKeywordStats && (dashboard.negKeywordStats as any[]).length > 0 && (
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <MinusCircle className="h-5 w-5 text-red-400" />
                    否定关键词状态
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {(dashboard.negKeywordStats as any[]).map((s: any, i: number) => (
                      <div key={i} className="text-center p-3 bg-gray-800/50 rounded-lg">
                        <p className="text-2xl font-bold text-white">{Number(s.count).toLocaleString()}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {s.api_sync_status === 'synced' ? '已同步' :
                           s.api_sync_status === 'not_applicable' ? '不适用' :
                           s.api_sync_status === 'failed' ? '失败' :
                           s.api_sync_status === 'pending' ? '待处理' :
                           s.api_sync_status}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          {/* 扫描历史标签 */}
          <TabsContent value="history" className="space-y-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-lg">扫描历史记录</CardTitle>
                <CardDescription>最近20次自动纠错扫描的结果</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-left text-gray-400 py-2 px-3">扫描ID</th>
                          <th className="text-left text-gray-400 py-2 px-3">完成时间</th>
                          <th className="text-right text-gray-400 py-2 px-3">账户数</th>
                          <th className="text-right text-gray-400 py-2 px-3">发现</th>
                          <th className="text-right text-gray-400 py-2 px-3">纠正</th>
                          <th className="text-right text-gray-400 py-2 px-3">失败</th>
                          <th className="text-right text-gray-400 py-2 px-3">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((scan: any, i: number) => (
                          <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="py-2 px-3 text-gray-400 font-mono text-xs">{scan.scanId?.substring(0, 20)}</td>
                            <td className="py-2 px-3 text-gray-300">{formatDate(scan.completedAt)}</td>
                            <td className="py-2 px-3 text-right text-gray-300">{scan.accountsScanned}</td>
                            <td className="py-2 px-3 text-right text-gray-300">{scan.totalIssuesFound}</td>
                            <td className="py-2 px-3 text-right text-green-400">{scan.totalCorrected}</td>
                            <td className="py-2 px-3 text-right text-red-400">{scan.totalFailed > 0 ? scan.totalFailed : '-'}</td>
                            <td className="py-2 px-3 text-right">
                              <Badge variant={scan.totalFailed === 0 ? "default" : "destructive"} className="text-xs">
                                {scan.totalFailed === 0 ? '全部成功' : `${scan.totalFailed}失败`}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm text-center py-8">暂无扫描历史记录（系统启动后将自动生成）</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 最近纠错标签 */}
          <TabsContent value="recent" className="space-y-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Search className="h-5 w-5 text-blue-400" />
                  最近纠错活动
                </CardTitle>
                <CardDescription>AutoCorrector 最近处理的纠错事件</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard?.recentCorrections && (dashboard.recentCorrections as any[]).length > 0 ? (
                  <div className="space-y-3">
                    {(dashboard.recentCorrections as any[]).map((c: any, i: number) => {
                      let detail: any = {};
                      try { detail = typeof c.api_sync_detail === 'string' ? JSON.parse(c.api_sync_detail) : c.api_sync_detail; } catch {}
                      
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg">
                          {c.api_sync_status === 'synced' ? (
                            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                {actionTypeLabels[c.action_type] || c.action_type}
                              </Badge>
                              <span className="text-xs text-gray-500">{formatDate(c.api_synced_at)}</span>
                            </div>
                            <p className="text-sm text-gray-300 mt-1 truncate">
                              {c.campaign_name || '未知活动'}
                              {c.keyword_text && <span className="text-gray-500"> / {c.keyword_text}</span>}
                            </p>
                            {detail.correctedBy && (
                              <p className="text-xs text-gray-500 mt-1">
                                纠正者: {detail.correctedBy}
                                {detail.retryCount && ` (重试${detail.retryCount}次)`}
                              </p>
                            )}
                            {detail.reason && (
                              <p className="text-xs text-gray-500 mt-0.5 truncate">{detail.reason}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm text-center py-8">暂无纠错活动记录</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
