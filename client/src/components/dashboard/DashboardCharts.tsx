/**
 * DashboardCharts.tsx - v392
 * 从Dashboard中提取的图表组件，支持组件级代码分割
 * recharts库只在此组件中加载，减少Dashboard首屏bundle大小
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  BarChart,
  Bar
} from "recharts";
import { BarChart3, Percent } from "lucide-react";

interface DashboardChartsProps {
  trendData: unknown[];
  weeklyComparison: unknown[];
  regionComparison: unknown[];
  currencySymbol: string;
}

export default function DashboardCharts({ 
  trendData, 
  weeklyComparison, 
  regionComparison, 
  currencySymbol 
}: DashboardChartsProps) {
  return (
    <>
      {/* 区域对比图表 */}
      {regionComparison.length > 1 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium mb-3">区域指标对比</h4>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={regionComparison} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="regionName" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}
                  // @ts-ignore
                  formatter={((value: number, name: string) => [
                    `$${value.toLocaleString()}`,
                    name === 'totalSales' ? '销售额' : '花费'
                  ]) as unknown}
                />
                {/* @ts-ignore */}
                <Legend 
                  // @ts-ignore
                  formatter={((value: string) => value === 'totalSales' ? '销售额' : '花费') as unknown}
                />
                <Bar dataKey="totalSales" name="totalSales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalSpend" name="totalSpend" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Sales & Spend Trend - 占2列 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">销售额与花费趋势</CardTitle>
                <CardDescription>过去30天数据</CardDescription>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-muted-foreground">销售额</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-muted-foreground">花费</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">暂无绩效数据</p>
                  <p className="text-sm mt-1">请先在设置页面同步数据</p>
                </div>
              </div>
            ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${currencySymbol}${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      // @ts-ignore
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                    // @ts-ignore
                    formatter={((value: number) => [`${currencySymbol}${value}`, '']) as unknown}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="sales" 
                    name="销售额" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    fill="url(#salesGradient)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="spend" 
                    name="花费" 
                    stroke="#a855f7" 
                    strokeWidth={2}
                    fill="url(#spendGradient)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            )}
          </CardContent>
        </Card>

        {/* ACoS Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">ACoS趋势</CardTitle>
            <CardDescription>过去30天数据</CardDescription>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Percent className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">暂无ACoS数据</p>
                </div>
              </div>
            ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={11} 
                    unit="%" 
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      // @ts-ignore
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                    // @ts-ignore
                    formatter={((value: number) => [`${value}%`, 'ACoS']) as unknown}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="acos" 
                    name="ACoS" 
                    stroke="#f97316" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Comparison */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">周销售对比</CardTitle>
              <CardDescription>本周 vs 上周</CardDescription>
            {/* @ts-ignore */}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* @ts-ignore */}
          {weeklyComparison.length === 0 || weeklyComparison.every(w => w.thisWeek === 0 && w.lastWeek === 0) ? (
            <div className="h-[200px] flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">暂无周对比数据</p>
              </div>
            </div>
          ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyComparison} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${currencySymbol}${value}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    // @ts-ignore
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}
                  // @ts-ignore
                  formatter={((value: number) => [`${currencySymbol}${value}`, '']) as unknown}
                />
                <Bar dataKey="thisWeek" name="本周" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="lastWeek" name="上周" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
