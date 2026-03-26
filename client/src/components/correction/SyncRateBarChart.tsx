/**
 * v523: 同步率水平条形图组件
 * 
 * 在纠错监控仪表盘的"操作类型"标签页中展示各操作类型的同步率
 * 使用水平条形图 + 颜色编码直观呈现同步健康状况
 * 
 * 颜色编码规则:
 * - 绿色 (#22c55e): 同步率 >= 95%
 * - 琥珀色 (#f59e0b): 同步率 80-95%
 * - 红色 (#ef4444): 同步率 < 80%
 */
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

interface ActionBreakdownEntry {
  synced: number;
  failed: number;
  pending: number;
  total: number;
  notApplicable: number;
}

interface SyncRateBarChartProps {
  actionBreakdown: Map<string, ActionBreakdownEntry>;
  actionTypeLabels: Record<string, string>;
}

// 根据同步率返回对应颜色
function getSyncRateColor(rate: number): string {
  if (rate >= 95) return "#22c55e"; // green-500
  if (rate >= 80) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

// 自定义Tooltip
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-gray-200 font-medium mb-1">{data.label}</p>
      <div className="space-y-0.5">
        <p className="text-gray-400">
          同步率: <span className="font-mono font-medium" style={{ color: getSyncRateColor(data.syncRate) }}>
            {data.syncRate.toFixed(1)}%
          </span>
        </p>
        <p className="text-green-400">已同步: {data.synced.toLocaleString()}</p>
        <p className="text-red-400">失败: {data.failed.toLocaleString()}</p>
        <p className="text-blue-400">待处理: {data.pending.toLocaleString()}</p>
        <p className="text-gray-500">总计(适用): {data.applicable.toLocaleString()}</p>
      </div>
    </div>
  );
}

export default function SyncRateBarChart({ actionBreakdown, actionTypeLabels }: SyncRateBarChartProps) {
  const chartData = useMemo(() => {
    return Array.from(actionBreakdown.entries())
      .map(([type, stats]) => {
        const applicable = stats.total - stats.notApplicable;
        const syncRate = applicable > 0 
          ? (stats.synced / applicable * 100) 
          : (stats.notApplicable > 0 ? 100 : 0);
        return {
          type,
          label: actionTypeLabels[type] || type,
          syncRate: Math.round(syncRate * 10) / 10,
          synced: stats.synced,
          failed: stats.failed,
          pending: stats.pending,
          applicable,
          total: stats.total,
        };
      })
      .filter(d => d.applicable > 0) // 只显示有适用事件的操作类型
      .sort((a, b) => b.applicable - a.applicable); // 按总量排序
  }, [actionBreakdown, actionTypeLabels]);

  if (chartData.length === 0) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="py-8">
          <div className="text-center text-gray-500">
            <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无同步数据</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartHeight = Math.max(200, chartData.length * 36 + 40);

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-400" />
          同步率分布图
        </CardTitle>
        <CardDescription>
          各操作类型的Amazon API同步成功率（
          <span className="text-green-400">绿色≥95%</span>{" / "}
          <span className="text-amber-400">琥珀80-95%</span>{" / "}
          <span className="text-red-400">红色&lt;80%</span>）
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="rgba(255,255,255,0.06)" 
                horizontal={false} 
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                stroke="rgba(255,255,255,0.3)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={100}
                stroke="rgba(255,255,255,0.3)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              {/* @ts-ignore */}
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <ReferenceLine 
                x={95} 
                stroke="rgba(34,197,94,0.3)" 
                strokeDasharray="3 3"
                label={{ value: '95%', position: 'top', fill: 'rgba(34,197,94,0.5)', fontSize: 10 }}
              />
              <ReferenceLine 
                x={80} 
                stroke="rgba(245,158,11,0.3)" 
                strokeDasharray="3 3"
                label={{ value: '80%', position: 'top', fill: 'rgba(245,158,11,0.5)', fontSize: 10 }}
              />
              <Bar 
                dataKey="syncRate" 
                radius={[0, 4, 4, 0]}
                barSize={20}
                // @ts-ignore - recharts label prop
                label={{
                  position: 'right',
                  fill: 'rgba(255,255,255,0.7)',
                  fontSize: 11,
                  formatter: (v: number) => `${v.toFixed(1)}%`,
                }}
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={getSyncRateColor(entry.syncRate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
