/**
 * 对比分析组件
 * 支持对比多个优化目标的表现
 */
import { useState, useMemo } from 'react';
import {
  LineChart, Line,
  BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PerformanceGroup {
  id: number;
  name: string;
  data: Array<{
    date: string;
    spend: number;
    sales: number;
    acos: number;
    roas?: number;
    orders?: number;
  }>;
}

interface ComparisonAnalysisProps {
  groups: PerformanceGroup[];
}

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'];

export function ComparisonAnalysis({ groups }: ComparisonAnalysisProps) {
  const [open, setOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [metric, setMetric] = useState<'spend' | 'sales' | 'acos' | 'roas'>('sales');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'radar'>('line');

  const handleToggleGroup = (groupId: number) => {
    setSelectedGroups(prev => {
      if (prev.includes(groupId)) {
        return prev.filter(id => id !== groupId);
      } else if (prev.length < 5) {
        return [...prev, groupId];
      } else {
        return prev;
      }
    });
  };

  // 合并数据用于对比
  const comparisonData = useMemo(() => {
    if (selectedGroups.length === 0) return [];

    const selectedGroupsData = groups.filter(g => selectedGroups.includes(g.id));
    
    // 获取所有日期
    const allDates = new Set<string>();
    selectedGroupsData.forEach(g => {
      g.data.forEach(d => allDates.add(d.date));
    });

    const sortedDates = Array.from(allDates).sort();

    // 合并数据
    return sortedDates.map(date => {
      const dataPoint: any = { date };
      
      selectedGroupsData.forEach(group => {
        const dayData = group.data.find(d => d.date === date);
        dataPoint[`${group.name}_${metric}`] = dayData ? dayData[metric] : 0;
      });

      return dataPoint;
    });
  }, [selectedGroups, groups, metric]);

  // 计算统计数据
  const statistics = useMemo(() => {
    if (selectedGroups.length === 0) return [];

    return selectedGroups.map(groupId => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return null;

      const values = group.data.map(d => Number(d[metric as keyof typeof d]) || 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      const avg = total / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);
      
      // 计算趋势
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
      const trend = secondAvg > firstAvg ? 'up' : secondAvg < firstAvg ? 'down' : 'stable';
      const trendPercent = firstAvg === 0 ? 0 : ((secondAvg - firstAvg) / firstAvg) * 100;

      return {
        groupId,
        name: group.name,
        total,
        avg,
        max,
        min,
        trend,
        trendPercent
      };
    }).filter(Boolean);
  }, [selectedGroups, groups, metric]);

  // 雷达图数据
  const radarData = useMemo(() => {
    if (selectedGroups.length === 0) return [];

    const metrics = ['spend', 'sales', 'acos', 'orders'];
    
    return metrics.map(m => {
      const dataPoint: any = { metric: m };
      
      selectedGroups.forEach(groupId => {
        const group = groups.find(g => g.id === groupId);
        if (group) {
          const values = group.data.map(d => Number(d[m as keyof typeof d]) || 0);
          const avg = (values as number[]).reduce((sum: number, v: number) => sum + v, 0) / values.length;
          dataPoint[group.name] = avg;
        }
      });

      return dataPoint;
    });
  }, [selectedGroups, groups]);

  const metricLabels: Record<string, string> = {
    spend: '花费 ($)',
    sales: '销售额 ($)',
    acos: 'ACoS (%)',
    roas: 'ROAS'
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        对比分析
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>优化目标对比分析</DialogTitle>
            <DialogDescription>
              选择最多5个优化目标进行对比分析
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* 选择优化目标 */}
            <div className="space-y-2">
              <Label>选择优化目标 ({selectedGroups.length}/5)</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {groups.map(group => (
                  <div key={group.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`compare-group-${group.id}`}
                      checked={selectedGroups.includes(group.id)}
                      onCheckedChange={() => handleToggleGroup(group.id)}
                      disabled={!selectedGroups.includes(group.id) && selectedGroups.length >= 5}
                    />
                    <Label
                      htmlFor={`compare-group-${group.id}`}
                      className="flex-1 cursor-pointer text-sm"
                    >
                      {group.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {selectedGroups.length > 0 && (
              <>
                {/* 控制器 */}
                <div className="flex items-center gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">对比指标</Label>
                    <Select value={metric} onValueChange={(v: any) => setMetric(v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="spend">花费</SelectItem>
                        <SelectItem value="sales">销售额</SelectItem>
                        <SelectItem value="acos">ACoS</SelectItem>
                        <SelectItem value="roas">ROAS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">图表类型</Label>
                    <Select value={chartType} onValueChange={(v: any) => setChartType(v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="line">折线图</SelectItem>
                        <SelectItem value="bar">柱状图</SelectItem>
                        <SelectItem value="radar">雷达图</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {statistics.map((stat, index) => (
                    <Card key={stat?.groupId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center justify-between">
                          <span>{stat?.name}</span>
                          <Badge
                            variant={stat?.trend === 'up' ? 'default' : stat?.trend === 'down' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {stat?.trend === 'up' ? <TrendingUp className="w-3 h-3 mr-1" /> :
                             stat?.trend === 'down' ? <TrendingDown className="w-3 h-3 mr-1" /> :
                             <Minus className="w-3 h-3 mr-1" />}
                            {Math.abs(stat?.trendPercent || 0).toFixed(1)}%
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">平均:</span>
                            <span className="font-medium">{stat?.avg.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">最大:</span>
                            <span className="font-medium">{stat?.max.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">最小:</span>
                            <span className="font-medium">{stat?.min.toFixed(2)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* 对比图表 */}
                <Card>
                  <CardHeader>
                    <CardTitle>{metricLabels[metric]} 对比</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'line' ? (
                          <LineChart data={comparisonData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                              dataKey="date"
                              className="text-xs"
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <YAxis
                              className="text-xs"
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                            {selectedGroups.map((groupId, index) => {
                              const group = groups.find(g => g.id === groupId);
                              return (
                                <Line
                                  key={groupId}
                                  type="monotone"
                                  dataKey={`${group?.name}_${metric}`}
                                  stroke={COLORS[index % COLORS.length]}
                                  strokeWidth={2}
                                  name={group?.name}
                                  dot={{ fill: COLORS[index % COLORS.length] }}
                                />
                              );
                            })}
                          </LineChart>
                        ) : chartType === 'bar' ? (
                          <BarChart data={comparisonData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                              dataKey="date"
                              className="text-xs"
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <YAxis
                              className="text-xs"
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                            {selectedGroups.map((groupId, index) => {
                              const group = groups.find(g => g.id === groupId);
                              return (
                                <Bar
                                  key={groupId}
                                  dataKey={`${group?.name}_${metric}`}
                                  fill={COLORS[index % COLORS.length]}
                                  name={group?.name}
                                />
                              );
                            })}
                          </BarChart>
                        ) : (
                          <RadarChart data={radarData}>
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis
                              dataKey="metric"
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                            />
                            <PolarRadiusAxis
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            {selectedGroups.map((groupId, index) => {
                              const group = groups.find(g => g.id === groupId);
                              return (
                                <Radar
                                  key={groupId}
                                  name={group?.name}
                                  dataKey={group?.name}
                                  stroke={COLORS[index % COLORS.length]}
                                  fill={COLORS[index % COLORS.length]}
                                  fillOpacity={0.5}
                                />
                              );
                            })}
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                          </RadarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
