/**
 * TargetOverviewPanel.tsx - v272 P3
 * 优化目标概览面板 - 从PerformanceGroupDetail中拆分
 * 
 * 包含:
 * 1. 优化目标设置卡片
 * 2. 优化进度卡片
 * 3. 关键指标卡片
 * 4. 趋势图表
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Target,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';

interface TargetOverviewProps {
  group: any;
  goalProgress: any;
  performanceTrendData: any[];
  goalTypeLabel: string;
}

// 进度颜色
function getProgressColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-red-600';
}

function getProgressBadge(score: number): { label: string; className: string } {
  if (score >= 80) return { label: '优秀', className: 'bg-green-100 text-green-700' };
  if (score >= 60) return { label: '良好', className: 'bg-yellow-100 text-yellow-700' };
  if (score >= 40) return { label: '一般', className: 'bg-orange-100 text-orange-700' };
  return { label: '需改进', className: 'bg-red-100 text-red-700' };
}

export default function TargetOverviewPanel({
  group,
  goalProgress,
  performanceTrendData,
  goalTypeLabel
}: TargetOverviewProps) {
  // 计算关键指标
  const metrics = useMemo(() => {
    if (!performanceTrendData || performanceTrendData.length === 0) return null;
    
    const recent = performanceTrendData.slice(-7);
    const totalSpend = recent.reduce((sum: number, d: any) => sum + (d.spend || 0), 0);
    const totalSales = recent.reduce((sum: number, d: any) => sum + (d.sales || 0), 0);
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;
    const avgRoas = totalSpend > 0 ? (totalSales / totalSpend) : 0;
    
    return {
      weeklySpend: totalSpend,
      weeklySales: totalSales,
      avgAcos,
      avgRoas,
      dataPoints: recent.length,
    };
  }, [performanceTrendData]);

  const overallScore = goalProgress?.overallScore || goalProgress?.score || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 优化目标设置卡片 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              优化目标设置
            </CardTitle>
            <CardDescription>当前绩效组的优化目标和参数</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-muted-foreground">优化类型</span>
              <span className="font-medium">{goalTypeLabel}</span>
            </div>
            {group?.targetAcos && (
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">目标ACoS</span>
                <span className="font-medium">{group.targetAcos}%</span>
              </div>
            )}
            {group?.targetRoas && (
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">目标ROAS</span>
                <span className="font-medium">{group.targetRoas}x</span>
              </div>
            )}
            {group?.dailyBudget && (
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">日预算</span>
                <span className="font-medium">${group.dailyBudget}</span>
              </div>
            )}
            {group?.maxBid && (
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">最高出价</span>
                <span className="font-medium">${group.maxBid}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">状态</span>
              <Badge variant={group?.status === 'active' ? 'default' : 'secondary'}>
                {group?.status === 'active' ? '运行中' : '已暂停'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* 优化进度卡片 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              优化进度
            </CardTitle>
            <CardDescription>7维综合评分和优化进展</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <div className={`text-4xl font-bold ${getProgressColor(overallScore)}`}>
                {overallScore.toFixed(0)}
              </div>
              <div className="flex-1">
                <Progress value={overallScore} className="h-3" />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-muted-foreground">0</span>
                  <Badge className={getProgressBadge(overallScore).className}>
                    {getProgressBadge(overallScore).label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">100</span>
                </div>
              </div>
            </div>
            
            {/* 各维度进度 */}
            {goalProgress?.dimensions && (
              <div className="space-y-2 mt-4">
                {goalProgress.dimensions.map((dim: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="w-20 text-muted-foreground truncate">{dim.name}</span>
                    <div className="flex-1">
                      <Progress value={dim.score || 0} className="h-1.5" />
                    </div>
                    <span className={`w-8 text-right font-medium ${getProgressColor(dim.score || 0)}`}>
                      {(dim.score || 0).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 关键指标概览 */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-red-500" />
                <span className="text-sm text-muted-foreground">7日花费</span>
              </div>
              <p className="text-2xl font-bold mt-1">${metrics.weeklySpend.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">7日销售</span>
              </div>
              <p className="text-2xl font-bold mt-1">${metrics.weeklySales.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">平均ACoS</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${metrics.avgAcos <= (group?.targetAcos || 30) ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.avgAcos.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-purple-500" />
                <span className="text-sm text-muted-foreground">平均ROAS</span>
              </div>
              <p className="text-2xl font-bold mt-1">{metrics.avgRoas.toFixed(2)}x</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
