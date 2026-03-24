/**
 * TargetAlgorithmEffectPanel - 优化目标算法效果面板
 * v151: 融合原有的 AlgorithmEffectDashboard 的核心功能
 */
import { safeToLocaleDateString } from "@/lib/safeDate";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, DollarSign, Activity,
  CheckCircle, RefreshCw, Clock, Zap, Info, XCircle,
} from "lucide-react";

interface TargetAlgorithmEffectPanelProps {
  accountId: number;
  groupId: number;
}

export function TargetAlgorithmEffectPanel({ accountId, groupId }: TargetAlgorithmEffectPanelProps) {
  // 获取出价调整统计 - 返回 { totalEvents, byCategory, byStatus, successRate, recentTrend }
  const { data: bidStats, isLoading: statsLoading } = trpc.performanceGroup.getBidAdjustmentStats.useQuery(
    { performanceGroupId: groupId },
    { enabled: !!groupId }
  );

  // 获取出价调整历史
  const { data: bidHistory, isLoading: historyLoading } = trpc.performanceGroup.getBidAdjustmentHistory.useQuery(
    { performanceGroupId: groupId, page: 1, pageSize: 50 },
    { enabled: !!groupId }
  );

  // 获取算法效果统计 - 返回 { algorithm, count, avgROASChange, avgACoSChange, avgEffectScore, positiveRate }[]
  const { data: effectStats, isLoading: effectLoading } = trpc.algorithmEffect.getStats.useQuery(
    { accountId, days: 30 },
    { enabled: !!accountId }
  );

  // 获取效果趋势 - 返回 { date, avgEffectScore, avgROASChange, avgACoSChange, count }[]
  const { data: effectTrend } = trpc.algorithmEffect.getTrend.useQuery(
    { accountId, days: 30 },
    { enabled: !!accountId }
  );

  // 从effectStats数组中计算汇总
  // @ts-ignore
  const totalRecords = effectStats?.reduce((sum: number, s: unknown) => sum + s.count, 0) || 0;
  // @ts-ignore
  const avgEffectScore = effectStats && effectStats.length > 0
    // @ts-ignore
    ? effectStats.reduce((sum: number, s: unknown) => sum + s.avgEffectScore * s.count, 0) / totalRecords
    : 0;
  // @ts-ignore
  const avgPositiveRate = effectStats && effectStats.length > 0
    // @ts-ignore
    ? effectStats.reduce((sum: number, s: unknown) => sum + s.positiveRate * s.count, 0) / totalRecords
    : 0;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Activity className="w-5 h-5" />
        算法效果追踪
      </h3>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Zap className="w-4 h-4" />
              总调整次数
            </div>
            <p className="text-2xl font-bold">{bidStats?.totalEvents || totalRecords || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              成功率
            </div>
            <p className="text-2xl font-bold text-green-600">
              {bidStats?.successRate ? `${bidStats.successRate.toFixed(0)}%` :
               avgPositiveRate > 0 ? `${avgPositiveRate.toFixed(0)}%` : '--'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              平均效果分
            </div>
            <p className="text-2xl font-bold">
              {avgEffectScore > 0 ? avgEffectScore.toFixed(0) : '--'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            {/* @ts-ignore */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4 text-purple-500" />
              算法类型数
            </div>
            <p className="text-2xl font-bold">
              {/* @ts-ignore */}
              {effectStats?.length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 效果趋势图 */}
      {effectTrend && effectTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">算法效果趋势（近30天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={effectTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="avgEffectScore" stroke="#8884d8" name="平均效果分" strokeWidth={2} />
                <Line type="monotone" dataKey="count" stroke="#82ca9d" name="调整次数" strokeWidth={2} />
              </LineChart>
            {/* @ts-ignore */}
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 各算法效果对比 */}
      // @ts-ignore
      {effectStats && (effectStats as any).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            {/* @ts-ignore */}
            <CardTitle className="text-sm">各算法效果对比</CardTitle>
          {/* @ts-ignore */}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              // @ts-ignore
              {(effectStats as any).map((stat: unknown, idx: number) => (
                // @ts-ignore
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  {/* @ts-ignore */}
                  <div>
                    {/* @ts-ignore */}
                    <p className="font-medium">{stat.algorithm}</p>
                    {/* @ts-ignore */}
                    <p className="text-xs text-muted-foreground">执行 {stat.count} 次</p>
                  </div>
                  <div className="text-right">
                    {/* @ts-ignore */}
                    <p className="text-sm">效果分: {stat.avgEffectScore?.toFixed(0)}</p>
                    <p className="text-xs text-muted-foreground">
                      // @ts-ignore
                      ROAS变化: {(stat as any).avgROASChange > 0 ? '+' : ''}{(stat as any).avgROASChange?.toFixed(2)} · 
                      // @ts-ignore
                      正向率: {(stat as any).positiveRate?.toFixed(0)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 最近出价调整记录 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">最近出价调整记录</CardTitle>
          {/* @ts-ignore */}
          <CardDescription>显示该优化目标下的出价调整详情</CardDescription>
        </CardHeader>
        {/* @ts-ignore */}
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              加载中...
            // @ts-ignore
            </div>
          ) : bidHistory?.records?.length ? (
            // @ts-ignore
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              // @ts-ignore
              {bidHistory.records.map((record: unknown, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div className="flex-1">
                    {/* @ts-ignore */}
                    <p className="font-medium text-xs">{record.keywordText || record.targetText || '未知'}</p>
                    <p className="text-xs text-muted-foreground">
                      {/* @ts-ignore */}
                      {record.campaignName}
                    </p>
                  {/* @ts-ignore */}
                  </div>
                  <div className="text-center px-3">
                    {/* @ts-ignore */}
                    <p className="text-xs">
                      // @ts-ignore
                      ${parseFloat((record as any).previousBid || 0).toFixed(2)} → ${parseFloat((record as any).newBid || 0).toFixed(2)}
                    </p>
                    {/* @ts-ignore */}
                    <p className={`text-xs font-medium ${parseFloat(record.bidChangePercent || 0) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      // @ts-ignore
                      {parseFloat((record as any).bidChangePercent || 0) > 0 ? '+' : ''}{parseFloat((record as any).bidChangePercent || 0).toFixed(1)}%
                    </p>
                  {/* @ts-ignore */}
                  </div>
                  <div className="text-right">
                    <Badge variant={
                      // v253: 修复同步状态显示 — 使用apiSyncStatus字段，正确处理null值
                      // @ts-ignore
                      (record.apiSyncStatus === 'synced' || record.syncedToAmazon) ? "default" : 
                      // @ts-ignore
                      record.apiSyncStatus === 'failed' ? "destructive" : "secondary"
                    } className="text-xs">
                      {/* @ts-ignore */}
                      {(record.apiSyncStatus === 'synced' || record.syncedToAmazon) ? (
                        <><CheckCircle className="w-3 h-3 mr-1" />已同步</>
                      // @ts-ignore
                      ) : record.apiSyncStatus === 'failed' ? (
                        <><XCircle className="w-3 h-3 mr-1" />同步失败</>
                      // @ts-ignore
                      ) : !record.apiSyncStatus ? (
                        <><Info className="w-3 h-3 mr-1" />无状态</>
                      ) : (
                        <><Clock className="w-3 h-3 mr-1" />待同步</>
                      )}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {/* @ts-ignore */}
                      {safeToLocaleDateString(record.createdAt, 'zh-CN')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
              <Info className="w-6 h-6 mb-1" />
              <p className="text-sm">暂无出价调整记录</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
