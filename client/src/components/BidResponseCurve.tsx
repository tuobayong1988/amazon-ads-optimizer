import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  Area,
  AreaChart,
  ComposedChart,
  Bar,
} from "recharts";
import {
  TrendingUp,
  Target,
  DollarSign,
  Info,
  Zap,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

interface BidResponseCurveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keywordId: number;
  keywordText: string;
  currentBid: number;
  matchType?: string;
  campaignId: number;
}

/**
 * 出价响应曲线组件
 * 展示出价与效果的关系，帮助用户找到最优出价点
 */
export function BidResponseCurve({
  open,
  onOpenChange,
  keywordId,
  keywordText,
  currentBid,
  matchType,
  campaignId,
}: BidResponseCurveProps) {
  const [simulatedBid, setSimulatedBid] = useState(currentBid);
  const [activeTab, setActiveTab] = useState<"curve" | "marginal" | "simulation">("curve");
  
  // 获取关键词历史数据用于曲线拟合
  const { data: historyData } = trpc.keyword.getHistoryTrend.useQuery(
    { id: keywordId, days: 30 },
    { enabled: open }
  );
  
  // 生成出价响应曲线数据
  const curveData = useMemo(() => {
    // 基于经济学原理的出价响应模型
    // 使用对数函数模拟边际效益递减
    const baseImpressions = historyData?.summary?.totalImpressions || 10000;
    const baseClicks = historyData?.summary?.totalClicks || 100;
    const baseSales = historyData?.summary?.totalSales || 500;
    const baseSpend = historyData?.summary?.totalSpend || 100;
    const baseCtr = baseClicks > 0 && baseImpressions > 0 ? (baseClicks / baseImpressions) * 100 : 0.5;
    const baseCvr = historyData?.summary?.avgCvr || 5;
    
    // 生成不同出价水平的预测数据
    const bidLevels = [];
    const minBid = Math.max(0.1, currentBid * 0.3);
    const maxBid = currentBid * 3;
    const step = (maxBid - minBid) / 20;
    
    for (let bid = minBid; bid <= maxBid; bid += step) {
      // 出价相对于当前出价的比例
      const bidRatio = bid / currentBid;
      
      // 展示量与出价的对数关系（边际效益递减）
      const impressionMultiplier = Math.log(1 + bidRatio * 2) / Math.log(3);
      const predictedImpressions = baseImpressions * impressionMultiplier;
      
      // 点击率随出价提高略有提升（更好的广告位）
      const ctrBoost = 1 + 0.1 * Math.log(bidRatio + 0.5);
      const predictedCtr = baseCtr * ctrBoost;
      
      // 预测点击数
      const predictedClicks = predictedImpressions * (predictedCtr / 100);
      
      // 预测花费
      const predictedSpend = predictedClicks * bid * 0.85; // 假设实际CPC是出价的85%
      
      // 转化率保持相对稳定
      const predictedCvr = baseCvr * (1 + 0.05 * Math.log(bidRatio + 0.5));
      
      // 预测订单和销售额
      const predictedOrders = predictedClicks * (predictedCvr / 100);
      const avgOrderValue = baseSales / (baseClicks * baseCvr / 100) || 30;
      const predictedSales = predictedOrders * avgOrderValue;
      
      // 计算ACoS和ROAS
      const predictedAcos = predictedSales > 0 ? (predictedSpend / predictedSales) * 100 : 0;
      const predictedRoas = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
      
      // 计算边际收益和边际成本
      const marginalRevenue: number = bidLevels.length > 0 
        ? (predictedSales - bidLevels[bidLevels.length - 1].sales) / step
        : predictedSales / bid;
      const marginalCost: number = bidLevels.length > 0
        ? (predictedSpend - bidLevels[bidLevels.length - 1].spend) / step
        : predictedSpend / bid;
      
      // 利润 = 销售额 - 花费
      const profit = predictedSales - predictedSpend;
      
      bidLevels.push({
        bid: parseFloat(bid.toFixed(2)),
        impressions: Math.round(predictedImpressions),
        clicks: Math.round(predictedClicks),
        ctr: parseFloat(predictedCtr.toFixed(2)),
        spend: parseFloat(predictedSpend.toFixed(2)),
        orders: parseFloat(predictedOrders.toFixed(1)),
        sales: parseFloat(predictedSales.toFixed(2)),
        acos: parseFloat(predictedAcos.toFixed(1)),
        roas: parseFloat(predictedRoas.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        marginalRevenue: parseFloat(marginalRevenue.toFixed(2)),
        marginalCost: parseFloat(marginalCost.toFixed(2)),
        isCurrentBid: Math.abs(bid - currentBid) < step / 2,
        isSimulatedBid: Math.abs(bid - simulatedBid) < step / 2,
      });
    }
    
    return bidLevels;
  }, [historyData, currentBid, simulatedBid]);
  
  // 找到最优出价点（边际收益 = 边际成本）
  const optimalBid = useMemo(() => {
    let optimal = curveData[0];
    let minDiff = Infinity;
    
    for (const point of curveData) {
      // 寻找MR = MC的点
      const diff = Math.abs(point.marginalRevenue - point.marginalCost);
      if (diff < minDiff && point.profit > 0) {
        minDiff = diff;
        optimal = point;
      }
    }
    
    // 如果没找到，选择利润最大的点
    if (minDiff > 10) {
      optimal = curveData.reduce((max, p) => p.profit > max.profit ? p : max, curveData[0]);
    }
    
    return optimal;
  }, [curveData]);
  
  // 获取模拟出价点的数据
  const simulatedPoint = useMemo(() => {
    return curveData.find(p => Math.abs(p.bid - simulatedBid) < 0.1) || curveData[0];
  }, [curveData, simulatedBid]);
  
  // 获取当前出价点的数据
  const currentPoint = useMemo(() => {
    return curveData.find(p => p.isCurrentBid) || curveData[0];
  }, [curveData]);
  
  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            出价响应曲线分析
          </DialogTitle>
          <DialogDescription>
            基于历史数据和经济学模型，分析出价与效果的关系，找到最优出价点
          </DialogDescription>
          <div className="flex items-center gap-2 mt-2">
            <span className="font-medium">{keywordText}</span>
            {matchType && (
              <Badge variant="outline" className="text-xs">
                {matchType === "broad" ? "广泛" : matchType === "phrase" ? "词组" : "精准"}
              </Badge>
            )}
            <Badge variant="secondary">当前出价: ${currentBid}</Badge>
          </div>
        </DialogHeader>
        
        {/* 关键指标卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">当前出价</div>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold mt-1">${currentBid}</div>
              <div className="text-xs text-muted-foreground mt-1">
                预测ROAS: {currentPoint?.roas.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-green-500/50 bg-green-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-green-600">建议出价</div>
                <Target className="h-4 w-4 text-green-500" />
              </div>
              <div className="text-2xl font-bold mt-1 text-green-600">${optimalBid?.bid}</div>
              <div className="text-xs text-green-600 mt-1">
                预测ROAS: {optimalBid?.roas.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">出价调整</div>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={`text-2xl font-bold mt-1 ${
                optimalBid.bid > currentBid ? 'text-green-500' : 
                optimalBid.bid < currentBid ? 'text-red-500' : ''
              }`}>
                {optimalBid.bid > currentBid ? '+' : ''}{((optimalBid.bid - currentBid) / currentBid * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {optimalBid.bid > currentBid ? '建议提高出价' : optimalBid.bid < currentBid ? '建议降低出价' : '维持当前出价'}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">预期利润变化</div>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={`text-2xl font-bold mt-1 ${
                optimalBid.profit > currentPoint.profit ? 'text-green-500' : 'text-red-500'
              }`}>
                {optimalBid.profit > currentPoint.profit ? '+' : ''}
                ${(optimalBid.profit - currentPoint.profit).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                日均利润提升
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 图表Tab */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="mb-4">
            <TabsTrigger value="curve" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              出价响应曲线
            </TabsTrigger>
            <TabsTrigger value="marginal" className="gap-2">
              <Target className="h-4 w-4" />
              边际分析
            </TabsTrigger>
            <TabsTrigger value="simulation" className="gap-2">
              <Zap className="h-4 w-4" />
              出价模拟
            </TabsTrigger>
          </TabsList>
          
          {/* 出价响应曲线 */}
          <TabsContent value="curve">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">出价-效果响应曲线</CardTitle>
                <CardDescription>
                  展示不同出价水平下的预测销售额和ROAS，绿色点为建议出价
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={curveData}>
                    <defs>
                      <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="bid" 
                      tickFormatter={(v) => `$${v}`}
                      className="text-xs"
                      label={{ value: '出价 ($)', position: 'bottom', offset: -5 }}
                    />
                    <YAxis 
                      yAxisId="left" 
                      className="text-xs"
                      label={{ value: '销售额 ($)', angle: -90, position: 'insideLeft' }}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right" 
                      className="text-xs"
                      label={{ value: 'ROAS', angle: 90, position: 'insideRight' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === "销售额") return [formatCurrency(value), name];
                        if (name === "ROAS") return [value.toFixed(2), name];
                        return [value, name];
                      }}
                      labelFormatter={(label) => `出价: $${label}`}
                    />
                    <Legend />
                    
                    {/* 销售额曲线 */}
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="sales"
                      name="销售额"
                      stroke="#10b981"
                      fill="url(#salesGradient)"
                      strokeWidth={2}
                    />
                    
                    {/* ROAS曲线 */}
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="roas"
                      name="ROAS"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                    
                    {/* 当前出价参考线 */}
                    <ReferenceLine 
                      x={currentBid} 
                      stroke="#f59e0b" 
                      strokeDasharray="5 5"
                      label={{ value: '当前', position: 'top', fill: '#f59e0b' }}
                    />
                    
                    {/* 建议出价参考线 */}
                    <ReferenceLine 
                      x={optimalBid.bid} 
                      stroke="#10b981" 
                      strokeDasharray="5 5"
                      label={{ value: '建议', position: 'top', fill: '#10b981' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            {/* 建议说明 */}
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-center gap-2">
                  <span>基于边际收益=边际成本原则，建议将出价从</span>
                  <Badge variant="outline">${currentBid}</Badge>
                  <ArrowRight className="h-4 w-4" />
                  <Badge variant="default" className="bg-green-500">${optimalBid.bid}</Badge>
                  <span>，预计ROAS可提升至 {optimalBid.roas.toFixed(2)}</span>
                </div>
              </AlertDescription>
            </Alert>
          </TabsContent>
          
          {/* 边际分析 */}
          <TabsContent value="marginal">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">边际收益与边际成本分析</CardTitle>
                <CardDescription>
                  当边际收益(MR)等于边际成本(MC)时，达到利润最大化点
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={curveData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="bid" 
                      tickFormatter={(v) => `$${v}`}
                      className="text-xs"
                      label={{ value: '出价 ($)', position: 'bottom', offset: -5 }}
                    />
                    <YAxis 
                      className="text-xs"
                      label={{ value: '边际值 ($)', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      labelFormatter={(label) => `出价: $${label}`}
                    />
                    <Legend />
                    
                    {/* 边际收益曲线 */}
                    <Line
                      type="monotone"
                      dataKey="marginalRevenue"
                      name="边际收益 (MR)"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                    
                    {/* 边际成本曲线 */}
                    <Line
                      type="monotone"
                      dataKey="marginalCost"
                      name="边际成本 (MC)"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                    
                    {/* 最优出价点 */}
                    <ReferenceLine 
                      x={optimalBid.bid} 
                      stroke="#10b981" 
                      strokeDasharray="5 5"
                      label={{ value: 'MR=MC', position: 'top', fill: '#10b981' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            {/* 利润曲线 */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">利润曲线</CardTitle>
                <CardDescription>
                  展示不同出价水平下的预期利润
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={curveData}>
                    <defs>
                      <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="bid" 
                      tickFormatter={(v) => `$${v}`}
                      className="text-xs"
                    />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [formatCurrency(value), "利润"]}
                      labelFormatter={(label) => `出价: $${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="profit"
                      name="利润"
                      stroke="#8b5cf6"
                      fill="url(#profitGradient)"
                      strokeWidth={2}
                    />
                    <ReferenceLine 
                      x={optimalBid.bid} 
                      stroke="#10b981" 
                      strokeDasharray="5 5"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 出价模拟 */}
          <TabsContent value="simulation">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">交互式出价模拟</CardTitle>
                <CardDescription>
                  拖动滑块调整出价，实时查看预测效果
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* 出价滑块 */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-muted-foreground">模拟出价</span>
                    <span className="text-2xl font-bold">${simulatedBid.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground w-16">${(currentBid * 0.3).toFixed(2)}</span>
                    <Slider
                      value={[simulatedBid * 100]}
                      onValueChange={(v) => setSimulatedBid(v[0] / 100)}
                      min={Math.round(currentBid * 30)}
                      max={Math.round(currentBid * 300)}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground w-16 text-right">${(currentBid * 3).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-center gap-2 mt-4">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSimulatedBid(currentBid)}
                    >
                      重置为当前出价
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSimulatedBid(optimalBid.bid)}
                      className="text-green-600 border-green-600"
                    >
                      设为建议出价
                    </Button>
                  </div>
                </div>
                
                {/* 对比卡片 */}
                <div className="grid grid-cols-2 gap-6">
                  {/* 当前出价效果 */}
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="outline">当前出价</Badge>
                      <span className="font-bold">${currentBid}</span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测展示</span>
                        <span>{currentPoint?.impressions?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测点击</span>
                        <span>{currentPoint?.clicks?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测花费</span>
                        <span>${currentPoint?.spend?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测销售</span>
                        <span>${currentPoint?.sales?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测ACoS</span>
                        <span>{currentPoint?.acos?.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测ROAS</span>
                        <span>{currentPoint?.roas?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>预测利润</span>
                        <span>${currentPoint?.profit?.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* 模拟出价效果 */}
                  <div className={`p-4 border rounded-lg ${
                    simulatedPoint?.profit > currentPoint?.profit 
                      ? 'border-green-500/50 bg-green-500/5' 
                      : 'border-red-500/50 bg-red-500/5'
                  }`}>
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant={simulatedPoint?.profit > currentPoint?.profit ? "default" : "destructive"}>
                        模拟出价
                      </Badge>
                      <span className="font-bold">${simulatedBid.toFixed(2)}</span>
                      <span className={`text-sm ${
                        simulatedBid > currentBid ? 'text-green-500' : 'text-red-500'
                      }`}>
                        ({simulatedBid > currentBid ? '+' : ''}{((simulatedBid - currentBid) / currentBid * 100).toFixed(0)}%)
                      </span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测展示</span>
                        <span className="flex items-center gap-2">
                          {simulatedPoint?.impressions?.toLocaleString()}
                          {simulatedPoint?.impressions > currentPoint?.impressions && (
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测点击</span>
                        <span className="flex items-center gap-2">
                          {simulatedPoint?.clicks?.toLocaleString()}
                          {simulatedPoint?.clicks > currentPoint?.clicks && (
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测花费</span>
                        <span>${simulatedPoint?.spend?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测销售</span>
                        <span className="flex items-center gap-2">
                          ${simulatedPoint?.sales?.toFixed(2)}
                          {simulatedPoint?.sales > currentPoint?.sales && (
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测ACoS</span>
                        <span className={simulatedPoint?.acos < currentPoint?.acos ? 'text-green-500' : 'text-red-500'}>
                          {simulatedPoint?.acos?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">预测ROAS</span>
                        <span className={simulatedPoint?.roas > currentPoint?.roas ? 'text-green-500' : 'text-red-500'}>
                          {simulatedPoint?.roas?.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>预测利润</span>
                        <span className={simulatedPoint?.profit > currentPoint?.profit ? 'text-green-500' : 'text-red-500'}>
                          ${simulatedPoint?.profit?.toFixed(2)}
                          <span className="text-sm ml-1">
                            ({simulatedPoint?.profit > currentPoint?.profit ? '+' : ''}
                            ${(simulatedPoint?.profit - currentPoint?.profit).toFixed(2)})
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* 建议提示 */}
                <Alert className="mt-6" variant={simulatedPoint?.profit > currentPoint?.profit ? "default" : "destructive"}>
                  {simulatedPoint?.profit > currentPoint?.profit ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {simulatedPoint?.profit > currentPoint?.profit 
                      ? `模拟出价 $${simulatedBid.toFixed(2)} 预计可提升日均利润 $${(simulatedPoint.profit - currentPoint.profit).toFixed(2)}，建议采用此出价。`
                      : `模拟出价 $${simulatedBid.toFixed(2)} 预计会降低日均利润 $${Math.abs(simulatedPoint.profit - currentPoint.profit).toFixed(2)}，建议维持当前出价或选择建议出价 $${optimalBid.bid}。`
                    }
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
