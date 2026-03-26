/**
 * v523: 同步率监控面板
 * 
 * 在数据健康仪表盘中展示同步率监控信息:
 * 1. 仪表盘图 (Gauge) - 显示整体同步率
 * 2. 排行榜 (Leaderboard) - 按账户显示同步成功率排名
 * 3. 7天趋势线 (Trend Line) - 显示同步率的7天变化趋势
 */
import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Gauge,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  XCircle,
  Activity,
} from "lucide-react";

interface SyncJob {
  id: number;
  accountId: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  totalSteps: number | null;
  currentStepIndex: number | null;
  errorMessage: string | null;
}

interface Stats24h {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  successRate: number;
}

interface SyncRateMonitoringPanelProps {
  recentJobs: SyncJob[];
  stats24h: Stats24h;
  trendData?: { date: string; total: number; succeeded: number; failed: number; rate: number }[];
  accountLeaderboard?: { accountId: number; total: number; succeeded: number; rate: number }[];
}

// 仪表盘颜色
function getGaugeColor(rate: number): string {
  if (rate >= 90) return "#22c55e";
  if (rate >= 70) return "#f59e0b";
  return "#ef4444";
}

function getGaugeLabel(rate: number): string {
  if (rate >= 90) return "健康";
  if (rate >= 70) return "警告";
  return "异常";
}

// 自定义Tooltip for trend line
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-gray-300 font-medium mb-1">{data.dateLabel || label}</p>
      <p className="text-gray-400">
        同步率: <span className="font-mono font-medium" style={{ color: getGaugeColor(data.rate) }}>
          {data.rate.toFixed(1)}%
        </span>
      </p>
      <p className="text-green-400">成功: {data.succeeded}</p>
      <p className="text-red-400">失败: {data.failed}</p>
      <p className="text-gray-500">总计: {data.total}</p>
    </div>
  );
}

export default function SyncRateMonitoringPanel({ 
  recentJobs, 
  stats24h, 
  trendData,
  accountLeaderboard,
}: SyncRateMonitoringPanelProps) {
  // 计算仪表盘数据
  const gaugeData = useMemo(() => {
    const rate = stats24h.successRate;
    return [
      { name: "success", value: rate },
      { name: "remaining", value: 100 - rate },
    ];
  }, [stats24h]);

  // 从recentJobs中计算按账户的排行榜（如果没有提供accountLeaderboard）
  const leaderboard = useMemo(() => {
    if (accountLeaderboard && accountLeaderboard.length > 0) return accountLeaderboard;
    
    const accountMap = new Map<number, { total: number; succeeded: number }>();
    for (const job of recentJobs) {
      const entry = accountMap.get(job.accountId) || { total: 0, succeeded: 0 };
      entry.total++;
      if (job.status === 'completed') entry.succeeded++;
      accountMap.set(job.accountId, entry);
    }
    
    return Array.from(accountMap.entries())
      .map(([accountId, stats]) => ({
        accountId,
        total: stats.total,
        succeeded: stats.succeeded,
        rate: stats.total > 0 ? Math.round(stats.succeeded / stats.total * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total);
  }, [recentJobs, accountLeaderboard]);

  // 从recentJobs中计算7天趋势（如果没有提供trendData）
  const trend = useMemo(() => {
    if (trendData && trendData.length > 0) return trendData;
    
    const dayMap = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (const job of recentJobs) {
      if (!job.startedAt) continue;
      const date = new Date(job.startedAt).toISOString().split('T')[0];
      const entry = dayMap.get(date) || { total: 0, succeeded: 0, failed: 0 };
      entry.total++;
      if (job.status === 'completed') entry.succeeded++;
      if (job.status === 'failed') entry.failed++;
      dayMap.set(date, entry);
    }
    
    return Array.from(dayMap.entries())
      .map(([date, stats]) => ({
        date,
        dateLabel: new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        total: stats.total,
        succeeded: stats.succeeded,
        failed: stats.failed,
        rate: stats.total > 0 ? Math.round(stats.succeeded / stats.total * 100 * 10) / 10 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [recentJobs, trendData]);

  const rateColor = getGaugeColor(stats24h.successRate);
  const rateLabel = getGaugeLabel(stats24h.successRate);

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-blue-400" />
        <h3 className="text-lg font-semibold text-white">同步率监控</h3>
        <Badge variant="outline" className="text-xs">v523</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. 仪表盘图 - 整体同步率 */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-blue-400" />
              24h同步成功率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center">
              {/* Semi-circle gauge using PieChart */}
              <div className="w-full h-[140px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gaugeData}
                      cx="50%"
                      cy="85%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius="60%"
                      outerRadius="90%"
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill={rateColor} />
                      <Cell fill="rgba(255,255,255,0.06)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                {/* Center text overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
                  <span className="text-3xl font-bold font-mono" style={{ color: rateColor }}>
                    {stats24h.successRate}%
                  </span>
                  <span className="text-xs text-gray-500">{rateLabel}</span>
                </div>
              </div>
              
              {/* Stats summary */}
              <div className="grid grid-cols-3 gap-4 w-full mt-3 text-center">
                <div>
                  <p className="text-lg font-bold text-green-400">{stats24h.succeeded}</p>
                  <p className="text-xs text-gray-500">成功</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-400">{stats24h.failed}</p>
                  <p className="text-xs text-gray-500">失败</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-blue-400">{stats24h.running}</p>
                  <p className="text-xs text-gray-500">运行中</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. 排行榜 - 按账户同步率 */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              账户同步排行
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard.length > 0 ? (
              <div className="space-y-2.5">
                {leaderboard.slice(0, 6).map((account, index) => (
                  <div key={account.accountId} className="flex items-center gap-2">
                    {/* Rank badge */}
                    <span className={`text-xs font-mono w-5 text-center ${
                      index === 0 ? 'text-amber-400' : 
                      index === 1 ? 'text-gray-300' : 
                      index === 2 ? 'text-amber-600' : 'text-gray-500'
                    }`}>
                      {index + 1}
                    </span>
                    
                    {/* Account info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-gray-300 font-mono">#{account.accountId}</span>
                        <span className={`text-xs font-medium ${
                          account.rate >= 90 ? 'text-green-400' : 
                          account.rate >= 70 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {account.rate}%
                        </span>
                      </div>
                      <Progress 
                        value={account.rate} 
                        className="h-1.5"
                      />
                    </div>
                    
                    {/* Status icon */}
                    {account.rate >= 90 ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                    ) : account.rate >= 70 ? (
                      <Minus className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                    )}
                  </div>
                ))}
                {leaderboard.length === 0 && (
                  <p className="text-gray-500 text-xs text-center py-4">暂无账户数据</p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-xs text-center py-4">暂无账户数据</p>
            )}
          </CardContent>
        </Card>

        {/* 3. 7天趋势线 */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              {trend.length >= 2 && trend[trend.length - 1]?.rate >= (trend[trend.length - 2]?.rate ?? 0) ? (
                <TrendingUp className="h-4 w-4 text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-400" />
              )}
              7天同步趋势
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length > 1 ? (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="dateLabel"
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    {/* @ts-ignore */}
                    <Tooltip content={<TrendTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', r: 3 }}
                      activeDot={{ r: 5, fill: '#60a5fa' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[180px] flex items-center justify-center">
                <p className="text-gray-500 text-xs">数据不足，需要至少2天的同步记录</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
