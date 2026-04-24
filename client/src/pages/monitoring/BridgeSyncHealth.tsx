/**
 * v26.7.6: Bridge 同步健康度面板
 * 
 * 展示 PPCOPT <-> AmzOrbit 跨系统数据同步的健康状态：
 * - 跨系统连接状态
 * - 自动同步运行状态与配置
 * - 最近同步历史记录
 * - 绩效数据摘要
 * - 手动触发同步 / 启停自动同步
 */
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Square,
  Clock,
  Database,
  Server,
  ArrowRightLeft,
  TrendingUp,
  Zap,
  Eye,
  Loader2,
  Wifi,
  WifiOff,
  BarChart3,
  History,
} from "lucide-react";
import { toast } from "sonner";

// Types
interface BridgeHealthResponse {
  success: boolean;
  connected: boolean;
  bridgeVersion: string;
  systemVersion: string;
  error?: string;
}

interface SyncStatusResponse {
  success: boolean;
  autoSyncRunning: boolean;
  configCount: number;
  configs: Array<{ storeName: string; marketplace: string }>;
  lastSyncResults: Record<string, SyncResult>;
  recentHistory: HistoryEntry[];
}

interface SyncResult {
  success: boolean;
  campaignsWritten: number;
  dbSkipped: boolean;
  totalCampaigns: number;
  campaignsWithData: number;
  summary: PerformanceSummary;
  duration: number;
  timestamp?: string;
  error?: string;
}

interface PerformanceSummary {
  totalCampaigns: number;
  activeCampaigns: number;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: string;
  totalSales: string;
  totalOrders: number;
  overallAcos: string;
  overallRoas: string;
  overallCtr: string;
  overallCvr: string;
  overallCpc: string;
  accountId: number;
  accountName: string;
  dateRange: { startDate: string; endDate: string };
}

interface HistoryEntry {
  storeName: string;
  marketplace: string;
  timestamp: string;
  success: boolean;
  campaignsWritten: number;
  duration: number;
  error: string | null;
}

// API base URL - use relative path for same-origin
const API_BASE = "/api/bridge-sync";

async function fetchBridgeApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Health score calculation
function calculateHealthScore(status: SyncStatusResponse | null, health: BridgeHealthResponse | null): number {
  if (!health?.connected) return 0;
  if (!status) return 30;
  
  let score = 40; // Base score for being connected
  
  if (status.autoSyncRunning) score += 20;
  
  const history = status.recentHistory || [];
  if (history.length > 0) {
    const successRate = history.filter(h => h.success).length / history.length;
    score += Math.round(successRate * 30);
    
    // Recent activity bonus
    const lastSync = new Date(history[0]?.timestamp || 0);
    const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync < 3) score += 10;
    else if (hoursSinceSync < 6) score += 5;
  }
  
  return Math.min(100, score);
}

function getHealthLabel(score: number): { text: string; color: string; bgColor: string } {
  if (score >= 80) return { text: "健康", color: "text-green-500", bgColor: "bg-green-500" };
  if (score >= 60) return { text: "一般", color: "text-yellow-500", bgColor: "bg-yellow-500" };
  if (score >= 30) return { text: "警告", color: "text-orange-500", bgColor: "bg-orange-500" };
  return { text: "异常", color: "text-red-500", bgColor: "bg-red-500" };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatNumber(num: number | string): string {
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "0";
  return n.toLocaleString("zh-CN");
}

function formatCurrency(num: string | number): string {
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BridgeSyncHealth() {
  const [activeTab, setActiveTab] = useState("overview");
  const [health, setHealth] = useState<BridgeHealthResponse | null>(null);
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [intervalMinutes, setIntervalMinutes] = useState(120);

  const fetchData = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        fetchBridgeApi<BridgeHealthResponse>("/health"),
        fetchBridgeApi<SyncStatusResponse>("/status"),
      ]);
      setHealth(h);
      setStatus(s);
    } catch (err) {
      console.error("Failed to fetch bridge sync data:", err);
      setHealth({ success: false, connected: false, bridgeVersion: "", systemVersion: "", error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const configs = status?.configs || [];
      if (configs.length === 0) {
        toast.error("没有配置同步账户");
        return;
      }
      const result = await fetchBridgeApi<SyncResult>("/trigger", {
        method: "POST",
        body: JSON.stringify({
          storeName: configs[0].storeName,
          marketplace: configs[0].marketplace,
        }),
      });
      if (result.success) {
        toast.success(`同步完成：${result.campaignsWithData} 个广告活动有数据，耗时 ${formatDuration(result.duration)}`);
        fetchData();
      } else {
        toast.error(`同步失败：${result.error || "未知错误"}`);
      }
    } catch (err) {
      toast.error(`同步请求失败：${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const configs = status?.configs || [];
      const result = await fetchBridgeApi<any>("/preview", {
        method: "POST",
        body: JSON.stringify({
          storeName: configs[0]?.storeName || "ElaraFit 美国",
          marketplace: configs[0]?.marketplace || "US",
        }),
      });
      setPreviewData(result);
      setActiveTab("preview");
      toast.success("数据预览加载完成");
    } catch (err) {
      toast.error(`预览失败：${err}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleToggleAutoSync = async () => {
    try {
      if (status?.autoSyncRunning) {
        await fetchBridgeApi("/auto-stop", { method: "POST" });
        toast.success("自动同步已停止");
      } else {
        const configs = status?.configs || [{ storeName: "ElaraFit 美国", marketplace: "US" }];
        await fetchBridgeApi("/auto-start", {
          method: "POST",
          body: JSON.stringify({ configs, intervalMinutes }),
        });
        toast.success(`自动同步已启动，间隔 ${intervalMinutes} 分钟`);
      }
      fetchData();
    } catch (err) {
      toast.error(`操作失败：${err}`);
    }
  };

  const healthScore = calculateHealthScore(status, health);
  const healthLabel = getHealthLabel(healthScore);
  const history = status?.recentHistory || [];
  const successRate = history.length > 0
    ? Math.round((history.filter(h => h.success).length / history.length) * 100)
    : 0;

  // Get latest sync result
  const latestResult = status?.lastSyncResults
    ? Object.values(status.lastSyncResults)[0]
    : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">加载 Bridge 同步状态...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Bridge 同步健康度</h1>
            <p className="text-muted-foreground mt-1">PPCOPT ↔ AmzOrbit 跨系统数据同步监控</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-1" />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
              {previewing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              预览数据
            </Button>
            <Button size="sm" onClick={handleManualSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              立即同步
            </Button>
          </div>
        </div>

        {/* Top Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Health Score */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">健康评分</p>
                  <p className={`text-3xl font-bold ${healthLabel.color}`}>{healthScore}</p>
                  <Badge className={`mt-1 ${healthScore >= 80 ? 'bg-green-100 text-green-800' : healthScore >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                    {healthLabel.text}
                  </Badge>
                </div>
                <div className="relative h-16 w-16">
                  <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="text-muted/20"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray={`${healthScore}, 100`}
                      className={healthLabel.color}
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Connection Status */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">连接状态</p>
                  <div className="flex items-center gap-2 mt-1">
                    {health?.connected ? (
                      <>
                        <Wifi className="h-5 w-5 text-green-500" />
                        <span className="text-lg font-semibold text-green-500">已连接</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-5 w-5 text-red-500" />
                        <span className="text-lg font-semibold text-red-500">断开</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Bridge {health?.bridgeVersion || "N/A"}
                  </p>
                </div>
                <ArrowRightLeft className="h-8 w-8 text-muted-foreground/30" />
              </div>
            </CardContent>
          </Card>

          {/* Auto-Sync Status */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">自动同步</p>
                  <div className="flex items-center gap-2 mt-1">
                    {status?.autoSyncRunning ? (
                      <>
                        <Activity className="h-5 w-5 text-green-500 animate-pulse" />
                        <span className="text-lg font-semibold text-green-500">运行中</span>
                      </>
                    ) : (
                      <>
                        <Square className="h-5 w-5 text-gray-400" />
                        <span className="text-lg font-semibold text-gray-400">已停止</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status?.configCount || 0} 个账户配置
                  </p>
                </div>
                <Button
                  variant={status?.autoSyncRunning ? "destructive" : "default"}
                  size="sm"
                  onClick={handleToggleAutoSync}
                >
                  {status?.autoSyncRunning ? (
                    <><Square className="h-3 w-3 mr-1" />停止</>
                  ) : (
                    <><Play className="h-3 w-3 mr-1" />启动</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sync Success Rate */}
          <Card>
            <CardContent className="pt-6">
              <div>
                <p className="text-sm text-muted-foreground">同步成功率</p>
                <p className={`text-3xl font-bold ${successRate >= 90 ? 'text-green-500' : successRate >= 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {successRate}%
                </p>
                <Progress value={successRate} className="mt-2 h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  最近 {history.length} 次同步
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">
              <BarChart3 className="h-4 w-4 mr-1" />
              数据概览
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-1" />
              同步历史
            </TabsTrigger>
            <TabsTrigger value="config">
              <Server className="h-4 w-4 mr-1" />
              同步配置
            </TabsTrigger>
            {previewData && (
              <TabsTrigger value="preview">
                <Eye className="h-4 w-4 mr-1" />
                数据预览
              </TabsTrigger>
            )}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {latestResult?.summary ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Performance Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      最新绩效摘要
                    </CardTitle>
                    <CardDescription>
                      {latestResult.summary.accountName} · {latestResult.summary.dateRange.startDate} ~ {latestResult.summary.dateRange.endDate}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">总广告活动</p>
                        <p className="text-xl font-bold">{formatNumber(latestResult.summary.totalCampaigns)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">活跃广告活动</p>
                        <p className="text-xl font-bold text-green-500">{formatNumber(latestResult.summary.activeCampaigns)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">总展示量</p>
                        <p className="text-xl font-bold">{formatNumber(latestResult.summary.totalImpressions)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">总点击量</p>
                        <p className="text-xl font-bold">{formatNumber(latestResult.summary.totalClicks)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">总花费</p>
                        <p className="text-xl font-bold text-orange-500">{formatCurrency(latestResult.summary.totalSpend)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">总销售额</p>
                        <p className="text-xl font-bold text-blue-500">{formatCurrency(latestResult.summary.totalSales)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      核心指标
                    </CardTitle>
                    <CardDescription>
                      订单数：{formatNumber(latestResult.summary.totalOrders)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">ACOS</p>
                        <p className={`text-xl font-bold ${parseFloat(latestResult.summary.overallAcos) > 50 ? 'text-red-500' : parseFloat(latestResult.summary.overallAcos) > 30 ? 'text-yellow-500' : 'text-green-500'}`}>
                          {latestResult.summary.overallAcos}%
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">ROAS</p>
                        <p className={`text-xl font-bold ${parseFloat(latestResult.summary.overallRoas) < 1 ? 'text-red-500' : parseFloat(latestResult.summary.overallRoas) < 2 ? 'text-yellow-500' : 'text-green-500'}`}>
                          {latestResult.summary.overallRoas}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">CTR</p>
                        <p className="text-xl font-bold">{latestResult.summary.overallCtr}%</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">CVR</p>
                        <p className="text-xl font-bold">{latestResult.summary.overallCvr}%</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">CPC</p>
                        <p className="text-xl font-bold">{formatCurrency(latestResult.summary.overallCpc)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">有数据的广告活动</p>
                        <p className="text-xl font-bold">{formatNumber(latestResult.campaignsWithData)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Sync Info */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      同步详情
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">写入记录数</p>
                        <p className="text-lg font-semibold">{formatNumber(latestResult.campaignsWritten)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">同步耗时</p>
                        <p className="text-lg font-semibold">{formatDuration(latestResult.duration)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">同步时间</p>
                        <p className="text-lg font-semibold">
                          {latestResult.timestamp ? new Date(latestResult.timestamp).toLocaleString("zh-CN") : "N/A"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">PPCOPT 版本</p>
                        <p className="text-lg font-semibold">{health?.systemVersion || "N/A"}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Bridge 版本</p>
                        <p className="text-lg font-semibold">{health?.bridgeVersion || "N/A"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <Database className="h-12 w-12 mb-3 opacity-30" />
                    <p>暂无同步数据</p>
                    <p className="text-sm mt-1">点击"立即同步"开始第一次数据同步</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">同步历史记录</CardTitle>
                <CardDescription>最近 {history.length} 次同步操作</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="space-y-2">
                    {history.map((entry, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          entry.success ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {entry.success ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">
                              {entry.storeName} ({entry.marketplace})
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(entry.timestamp).toLocaleString("zh-CN")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">
                            {entry.campaignsWritten} 条写入
                          </span>
                          <span className="text-muted-foreground">
                            {formatDuration(entry.duration)}
                          </span>
                          {entry.error && (
                            <Badge variant="destructive" className="text-xs">
                              {entry.error.substring(0, 30)}...
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                    <History className="h-8 w-8 mb-2 opacity-30" />
                    <p>暂无同步历史</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">自动同步配置</CardTitle>
                  <CardDescription>配置定时同步参数</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>同步间隔（分钟）</Label>
                    <Input
                      type="number"
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 120)}
                      min={30}
                      max={1440}
                    />
                    <p className="text-xs text-muted-foreground">
                      建议设置为 120 分钟（2 小时），最小 30 分钟
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    variant={status?.autoSyncRunning ? "destructive" : "default"}
                    onClick={handleToggleAutoSync}
                  >
                    {status?.autoSyncRunning ? (
                      <><Square className="h-4 w-4 mr-2" />停止自动同步</>
                    ) : (
                      <><Play className="h-4 w-4 mr-2" />启动自动同步</>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">已配置账户</CardTitle>
                  <CardDescription>当前参与自动同步的账户</CardDescription>
                </CardHeader>
                <CardContent>
                  {(status?.configs || []).length > 0 ? (
                    <div className="space-y-2">
                      {status!.configs.map((config, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{config.storeName}</span>
                          </div>
                          <Badge variant="outline">{config.marketplace}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                      <p className="text-sm">未配置同步账户</p>
                      <p className="text-xs mt-1">启动自动同步时将自动配置</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Preview Tab */}
          {previewData && (
            <TabsContent value="preview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">数据预览（只读）</CardTitle>
                  <CardDescription>
                    从 PPCOPT 拉取的最新数据预览，不会写入数据库
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">总广告活动</p>
                      <p className="text-lg font-bold">{formatNumber(previewData.summary?.totalCampaigns || 0)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">有数据的</p>
                      <p className="text-lg font-bold">{formatNumber(previewData.campaignsWithData || 0)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">总花费</p>
                      <p className="text-lg font-bold">{formatCurrency(previewData.summary?.totalSpend || "0")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">总销售额</p>
                      <p className="text-lg font-bold">{formatCurrency(previewData.summary?.totalSales || "0")}</p>
                    </div>
                  </div>

                  {previewData.sampleCampaigns && (
                    <>
                      <h4 className="font-medium mb-2">样本广告活动（前 5 条）</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2">广告活动名称</th>
                              <th className="text-right py-2 px-2">展示</th>
                              <th className="text-right py-2 px-2">点击</th>
                              <th className="text-right py-2 px-2">花费</th>
                              <th className="text-right py-2 px-2">销售</th>
                              <th className="text-right py-2 px-2">ACOS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.sampleCampaigns.map((c: any, idx: number) => (
                              <tr key={idx} className="border-b border-muted/30">
                                <td className="py-2 px-2 max-w-[200px] truncate">{c.campaignName}</td>
                                <td className="text-right py-2 px-2">{formatNumber(c.impressions)}</td>
                                <td className="text-right py-2 px-2">{formatNumber(c.clicks)}</td>
                                <td className="text-right py-2 px-2">{formatCurrency(c.spend)}</td>
                                <td className="text-right py-2 px-2">{formatCurrency(c.sales)}</td>
                                <td className="text-right py-2 px-2">{c.acos ? `${c.acos}%` : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {previewData.sampleTrend && (
                    <>
                      <h4 className="font-medium mt-4 mb-2">每日趋势（前 5 天）</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2">日期</th>
                              <th className="text-right py-2 px-2">展示</th>
                              <th className="text-right py-2 px-2">点击</th>
                              <th className="text-right py-2 px-2">花费</th>
                              <th className="text-right py-2 px-2">销售</th>
                              <th className="text-right py-2 px-2">订单</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.sampleTrend.map((t: any, idx: number) => (
                              <tr key={idx} className="border-b border-muted/30">
                                <td className="py-2 px-2">{t.date}</td>
                                <td className="text-right py-2 px-2">{formatNumber(t.impressions)}</td>
                                <td className="text-right py-2 px-2">{formatNumber(t.clicks)}</td>
                                <td className="text-right py-2 px-2">{formatCurrency(t.spend)}</td>
                                <td className="text-right py-2 px-2">{formatCurrency(t.sales)}</td>
                                <td className="text-right py-2 px-2">{formatNumber(t.orders)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
