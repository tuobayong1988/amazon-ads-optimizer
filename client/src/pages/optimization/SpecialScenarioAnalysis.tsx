import { useState, useMemo, useCallback} from "react";
import { safeToLocaleDateString } from "@/lib/safeDate";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useGlobalAccountId } from "@/hooks/useGlobalAccountId";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Target,
  Calendar,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  BarChart3,
  ArrowRight,
  Info,
  ChevronRight,
  Percent,
  Activity,
  Shield,
  Sparkles,
} from "lucide-react";

export default function SpecialScenarioAnalysis() {
  // v399: 使用全局店铺选择器替代本地状态
  const { accountId: selectedAccountId, accounts, isLoading: accountsLoading } = useGlobalAccountId();
  const setSelectedAccountId = (_: unknown) => {}; // v399: 由全局选择器控制，本地setter为no-op
const [activeTab, setActiveTab] = useState("overview");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [targetAcos, setTargetAcos] = useState("25");
  const [profitMargin, setProfitMargin] = useState("30");
  const [selectedKeywords, setSelectedKeywords] = useState<number[]>([]);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // 获取账号列表
  // v399: accountId 已由全局选择器 Hook 提供（selectedAccountId）
  const accountId = selectedAccountId;
// 获取综合分析结果
  const { data: analysisResult, isLoading: analysisLoading, refetch: refetchAnalysis } = 
    trpc.specialScenario.runFullAnalysis.useQuery(
      { 
        accountId: accountId!, 
        targetAcos: parseFloat(targetAcos) / 100,
        profitMargin: parseFloat(profitMargin) / 100,
      },
      { enabled: !!accountId }
    );

  // 获取预算耗尽风险
  const { data: budgetRisks } = trpc.specialScenario.analyzeBudgetDepletionRisk.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取归因调整数据
  const { data: attributionData } = trpc.specialScenario.getAttributionAdjustedData.useQuery(
    { accountId: accountId!, days: 7 },
    { enabled: !!accountId }
  );

  // 获取竞价效率分析
  const { data: bidEfficiency, refetch: refetchBidEfficiency } = trpc.specialScenario.analyzeBidEfficiency.useQuery(
    { 
      accountId: accountId!,
      targetAcos: parseFloat(targetAcos) / 100,
      profitMargin: parseFloat(profitMargin) / 100,
    },
    { enabled: !!accountId }
  );

  // 获取季节性策略
  const { data: seasonalStrategy } = trpc.specialScenario.getSeasonalStrategy.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取即将到来的大促
  const { data: upcomingEvents } = trpc.specialScenario.getUpcomingEvents.useQuery(
    { daysAhead: 60 }
  );

  // 批量应用建议出价
  const applyBidsMutation = trpc.batchOperation.applyBidAdjustments.useMutation({
    onSuccess: () => {
      toast.success("批量出价调整已应用");
      setSelectedKeywords([]);
      setShowBatchConfirm(false);
      refetchBidEfficiency();
    },
    onError: (error) => {
      // @ts-ignore
      toast.error("应用失败: " + (error as Record<string, unknown>).message);
    },
  });

  const handleRefreshAnalysis = useCallback(() => {
    setIsAnalyzing(true);
    refetchAnalysis().finally(() => setIsAnalyzing(false));
  }, [refetchAnalysis]);

  const handleSelectAllOverbidding = useCallback(() => {
    if (bidEfficiency?.topOverbidding) {
      const allIds = bidEfficiency.topOverbidding
        .filter(k => k.isOverbidding)
        .map(k => k.targetId);
      setSelectedKeywords(allIds);
    }
  }, [bidEfficiency?.topOverbidding]);

  const handleApplySelectedBids = useCallback(() => {
    if (selectedKeywords.length === 0) {
      toast.error("请先选择要调整的投放词");
      return;
    }
    setShowBatchConfirm(true);
  }, [selectedKeywords.length]);

  const confirmApplyBids = useCallback(() => {
    if (!bidEfficiency?.topOverbidding) return;
    
    const adjustments = selectedKeywords.map(id => {
      const keyword = bidEfficiency.topOverbidding.find(k => k.targetId === id);
      return {
        keywordId: id,
        newBid: keyword?.suggestedBid || 0,
        reason: "竞价效率优化 - 过度竞价检测",
      };
    }).filter(a => a.newBid > 0);

    applyBidsMutation.mutate({ adjustments });
  }, [bidEfficiency?.topOverbidding, selectedKeywords, applyBidsMutation]);

  const getRiskBadge = useCallback((level: string) => {
    switch (level) {
      case 'critical':
        return <Badge variant="destructive">严重</Badge>;
      case 'warning':
        return <Badge variant="outline" className="border-orange-500 text-orange-500">警告</Badge>;
      default:
        return <Badge variant="outline" className="border-green-500 text-green-500">正常</Badge>;
    }
  }, []);

  const getConfidenceBadge = useCallback((confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge variant="outline" className="border-green-500 text-green-500">高置信度</Badge>;
      case 'medium':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">中置信度</Badge>;
      default:
        return <Badge variant="outline" className="border-red-500 text-red-500">低置信度</Badge>;
    }
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-500" />
              特殊场景分析
            </h1>
            <p className="text-muted-foreground">
              智能识别预算风险、归因延迟、竞价效率和季节性机会
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                // @ts-ignore
                {accounts?.map((account: unknown) => (
                  // @ts-ignore
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {/* @ts-ignore */}
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleRefreshAnalysis} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              刷新分析
            </Button>
          </div>
        </div>

        {/* 关键风险摘要 */}
        {analysisResult?.summary && (
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                关键风险与机会摘要
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 关键问题 */}
                <div>
                  <h4 className="font-medium mb-2 text-sm text-muted-foreground">发现的问题</h4>
                  {/* @ts-ignore */}
                  {analysisResult.summary.criticalIssues.length > 0 ? (
                    <ul className="space-y-2">
                      // @ts-ignore
                      {analysisResult.summary.criticalIssues.map((issue: unknown, idx: unknown) => (
                        // @ts-ignore
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                          {/* @ts-ignore */}
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      未发现严重问题
                    </p>
                  )}
                </div>
                
                {/* 建议 */}
                {/* @ts-ignore */}
                <div>
                  <h4 className="font-medium mb-2 text-sm text-muted-foreground">优化建议</h4>
                  {/* @ts-ignore */}
                  {analysisResult.summary.recommendations.length > 0 ? (
                    <ul className="space-y-2">
                      {analysisResult.summary.recommendations.slice(0, 4).map((rec: unknown, idx: unknown) => (
                        // @ts-ignore
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <ChevronRight className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          {/* @ts-ignore */}
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">暂无建议</p>
                  )}
                </div>
              </div>
              
              {/* 潜在收益 */}
              <div className="flex items-center gap-6 mt-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-500" />
                  <span className="text-sm">潜在节省:</span>
                  <span className="font-bold text-green-500">
                    ${analysisResult.summary.potentialSavings.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  <span className="text-sm">潜在收益增长:</span>
                  <span className="font-bold text-blue-500">
                    ${analysisResult.summary.potentialRevenueGain.toFixed(2)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 主要内容区 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="budget">预算风险</TabsTrigger>
            <TabsTrigger value="attribution">归因调整</TabsTrigger>
            <TabsTrigger value="bidding">竞价效率</TabsTrigger>
            <TabsTrigger value="seasonal">季节性</TabsTrigger>
          </TabsList>

          {/* 概览Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 预算风险卡片 */}
              <Card 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setActiveTab("budget")}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-red-500/10">
                      <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">预算耗尽风险</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {budgetRisks?.filter(r => r.riskLevel === 'critical').length || 0} 个严重风险
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {budgetRisks?.filter(r => r.riskLevel === 'warning').length || 0} 个警告
                  </p>
                </CardContent>
              </Card>

              {/* 归因调整卡片 */}
              <Card 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setActiveTab("attribution")}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-blue-500/10">
                      <Clock className="w-6 h-6 text-blue-500" />
                    </div>
                    {/* @ts-ignore */}
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">归因数据调整</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    近7天数据已调整
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {/* @ts-ignore */}
                    {attributionData?.filter(d => d.adjusted.confidence === 'low').length || 0} 天低置信度
                  </p>
                </CardContent>
              </Card>

              {/* 竞价效率卡片 */}
              <Card 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setActiveTab("bidding")}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-orange-500/10">
                      <Target className="w-6 h-6 text-orange-500" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">竞价效率分析</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {bidEfficiency?.overbiddingCount || 0} 个过度竞价
                  </p>
                  <p className="text-sm text-green-500">
                    可节省 ${bidEfficiency?.totalPotentialSavings.toFixed(2) || '0.00'}
                  </p>
                </CardContent>
              </Card>

              {/* 季节性卡片 */}
              <Card 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setActiveTab("seasonal")}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-purple-500/10">
                      <Calendar className="w-6 h-6 text-purple-500" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">季节性调整</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {seasonalStrategy?.eventName || '无大促'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    建议系数: {seasonalStrategy?.finalFactor.toFixed(2) || '1.00'}x
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* 即将到来的大促 */}
            {upcomingEvents && upcomingEvents.length > 0 && (
              <Card>
                <CardHeader>
                  {/* @ts-ignore */}
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    // @ts-ignore
                    即将到来的大促活动
                  // @ts-ignore
                  </CardTitle>
                {/* @ts-ignore */}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {upcomingEvents.slice(0, 3).map((event: unknown, idx: unknown) => (
                      // @ts-ignore
                      <div key={idx} className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          {/* @ts-ignore */}
                          <span className="font-semibold">{event.event.name}</span>
                          {/* @ts-ignore */}
                          <Badge variant={event.daysUntil <= 7 ? "destructive" : "secondary"}>
                            {/* @ts-ignore */}
                            {event.daysUntil}天后
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {/* @ts-ignore */}
                          {safeToLocaleDateString(event.event.date, 'zh-CN')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          // @ts-ignore
                          持续 {(event as any).event.duration} 天
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 预算风险Tab */}
          <TabsContent value="budget" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>预算耗尽风险分析</CardTitle>
                <CardDescription>
                  基于历史消耗模式预测今日预算耗尽时间
                </CardDescription>
              </CardHeader>
              <CardContent>
                {budgetRisks && budgetRisks.length > 0 ? (
                  // @ts-ignore
                  <Table>
                    {/* @ts-ignore */}
                    <TableHeader>
                      {/* @ts-ignore */}
                      <TableRow>
                        {/* @ts-ignore */}
                        <TableHead>广告活动</TableHead>
                        <TableHead>日预算</TableHead>
                        <TableHead>当前消耗</TableHead>
                        <TableHead>消耗进度</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>预计耗尽时间</TableHead>
                        <TableHead>风险等级</TableHead>
                        <TableHead>建议</TableHead>
                      </TableRow>
                    {/* @ts-ignore */}
                    </TableHeader>
                    <TableBody>
                      {budgetRisks.map((risk: unknown) => (
                        // @ts-ignore
                        <TableRow key={risk.campaignId}>
                          {/* @ts-ignore */}
                          <TableCell className="font-medium">{risk.campaignName}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${risk.dailyBudget.toFixed(2)}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${risk.currentSpend.toFixed(2)}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>
                            {/* @ts-ignore */}
                            <div className="flex items-center gap-2">
                              <Progress 
                                // @ts-ignore
                                value={(risk.currentSpend / risk.dailyBudget) * 100} 
                                className="w-20 h-2"
                              />
                              <span className="text-sm">
                                {/* @ts-ignore */}
                                {((risk.currentSpend / risk.dailyBudget) * 100).toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {/* @ts-ignore */}
                            {risk.predictedDepletionHour !== null 
                              // @ts-ignore
                              ? `${risk.predictedDepletionHour}:00`
                              : '不会耗尽'}
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell>{getRiskBadge(risk.riskLevel)}</TableCell>
                          <TableCell className="max-w-xs">
                            {/* @ts-ignore */}
                            <p className="text-sm text-muted-foreground truncate" title={risk.recommendation}>
                              {/* @ts-ignore */}
                              {risk.recommendation}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>暂无预算风险数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          {/* @ts-ignore */}
          </TabsContent>

          {/* 归因调整Tab */}
          <TabsContent value="attribution" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>归因窗口数据调整</CardTitle>
                <CardDescription>
                  基于Amazon 7-14天归因窗口，调整近期数据以反映更准确的表现
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-start gap-2">
                    <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                    {/* @ts-ignore */}
                    <div>
                      {/* @ts-ignore */}
                      <p className="font-medium text-blue-500">归因延迟说明</p>
                      {/* @ts-ignore */}
                      <p className="text-sm text-muted-foreground mt-1">
                        // @ts-ignore
                        Amazon广告的转化归因窗口为7-14天。第1天数据约70%完成归因，第3天约90%，第7天接近100%。
                        // @ts-ignore
                        系统自动调整近期数据，帮助您做出更准确的决策。
                      </p>
                    {/* @ts-ignore */}
                    </div>
                  {/* @ts-ignore */}
                  </div>
                </div>

                {/* @ts-ignore */}
                {attributionData && attributionData.length > 0 ? (
                  <Table>
                    {/* @ts-ignore */}
                    <TableHeader>
                      {/* @ts-ignore */}
                      <TableRow>
                        {/* @ts-ignore */}
                        <TableHead>日期</TableHead>
                        <TableHead>数据年龄</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>原始销售额</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>调整后销售额</TableHead>
                        <TableHead>原始ACoS</TableHead>
                        <TableHead>调整后ACoS</TableHead>
                        <TableHead>调整系数</TableHead>
                        <TableHead>置信度</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      // @ts-ignore
                      {(attributionData as any).map((day: unknown) => (
                        // @ts-ignore
                        <TableRow key={day.date}>
                          {/* @ts-ignore */}
                          <TableCell className="font-medium">{day.date}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>{day.adjusted.dataAge}天</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${day.raw.sales.toFixed(2)}</TableCell>
                          <TableCell className="text-blue-500">
                            // @ts-ignore
                            ${(day as any).adjusted.sales.toFixed(2)}
                            // @ts-ignore
                            {(day as any).adjusted.isAdjusted && (
                              <span className="text-xs text-muted-foreground ml-1">
                                // @ts-ignore
                                (+{(((day as any).adjusted.adjustmentFactor - 1) * 100).toFixed(0)}%)
                              </span>
                            )}
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell>{day.raw.acos.toFixed(1)}%</TableCell>
                          {/* @ts-ignore */}
                          <TableCell className={day.adjusted.acos < day.raw.acos ? 'text-green-500' : ''}>
                            {/* @ts-ignore */}
                            {day.adjusted.acos.toFixed(1)}%
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell>{day.adjusted.adjustmentFactor.toFixed(2)}x</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>{getConfidenceBadge(day.adjusted.confidence)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>暂无归因数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 竞价效率Tab */}
          <TabsContent value="bidding" className="space-y-4">
            {/* 参数设置 */}
            <Card>
              <CardHeader>
                <CardTitle>分析参数</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Label>目标ACoS:</Label>
                    <Input
                      type="number"
                      value={targetAcos}
                      onChange={(e) => setTargetAcos(e.target.value)}
                      className="w-20"
                    />
                    <span>%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label>利润率:</Label>
                    <Input
                      type="number"
                      value={profitMargin}
                      onChange={(e) => setProfitMargin(e.target.value)}
                      className="w-20"
                    />
                    <span>%</span>
                  </div>
                  <Button variant="outline" onClick={() => refetchBidEfficiency()}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    重新分析
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 效率概览 */}
            {bidEfficiency && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">分析投放词数</p>
                    <p className="text-2xl font-bold">{bidEfficiency.totalTargets}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">过度竞价数量</p>
                    <p className="text-2xl font-bold text-orange-500">{bidEfficiency.overbiddingCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">过度竞价占比</p>
                    <p className="text-2xl font-bold">{bidEfficiency.overbiddingPercent.toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">潜在节省</p>
                    <p className="text-2xl font-bold text-green-500">
                      ${bidEfficiency.totalPotentialSavings.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* 过度竞价列表 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>过度竞价投放词</CardTitle>
                    <CardDescription>
                      出价效率低于标准的投放词，建议降低出价
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleSelectAllOverbidding}>
                      全选过度竞价
                    </Button>
                    <Button 
                      // @ts-ignore
                      onClick={handleApplySelectedBids}
                      disabled={selectedKeywords.length === 0}
                    >
                      {/* @ts-ignore */}
                      <Zap className="w-4 h-4 mr-2" />
                      批量应用建议出价 ({selectedKeywords.length})
                    </Button>
                  {/* @ts-ignore */}
                  </div>
                </div>
              {/* @ts-ignore */}
              </CardHeader>
              <CardContent>
                {bidEfficiency?.topOverbidding && bidEfficiency.topOverbidding.length > 0 ? (
                  // @ts-ignore
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {/* @ts-ignore */}
                        <TableHead className="w-12">
                          {/* @ts-ignore */}
                          <Checkbox
                            checked={selectedKeywords.length === bidEfficiency.topOverbidding.filter(k => k.isOverbidding).length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                // @ts-ignore
                                handleSelectAllOverbidding();
                              } else {
                                setSelectedKeywords([]);
                              // @ts-ignore
                              }
                            // @ts-ignore
                            }}
                          // @ts-ignore
                          />
                        </TableHead>
                        <TableHead>投放词</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>类型</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>当前出价</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>实际CPC</TableHead>
                        <TableHead>目标CPC</TableHead>
                        <TableHead>效率评分</TableHead>
                        <TableHead>建议出价</TableHead>
                        <TableHead>预期节省</TableHead>
                        {/* @ts-ignore */}
                        <TableHead>问题</TableHead>
                      </TableRow>
                    </TableHeader>
                    {/* @ts-ignore */}
                    <TableBody>
                      {bidEfficiency.topOverbidding.map((item: unknown) => (
                        // @ts-ignore
                        <TableRow key={item.targetId}>
                          <TableCell>
                            {/* @ts-ignore */}
                            <Checkbox
                              // @ts-ignore
                              checked={selectedKeywords.includes(item.targetId)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  // @ts-ignore
                                  setSelectedKeywords([...selectedKeywords, item.targetId]);
                                } else {
                                  // @ts-ignore
                                  setSelectedKeywords(selectedKeywords.filter(id => id !== item.targetId));
                                }
                              }}
                              // @ts-ignore
                              disabled={!item.isOverbidding}
                            />
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell className="font-medium max-w-xs truncate" title={item.targetText}>
                            {/* @ts-ignore */}
                            {item.targetText}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              // @ts-ignore
                              {(item as any).targetType === 'keyword' ? '关键词' : '商品定向'}
                            </Badge>
                          </TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${item.currentBid.toFixed(2)}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${item.actualCpc.toFixed(2)}</TableCell>
                          {/* @ts-ignore */}
                          <TableCell>${item.targetCpc.toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {/* @ts-ignore */}
                              <Progress value={item.efficiencyScore} className="w-16 h-2" />
                              {/* @ts-ignore */}
                              <span className={item.efficiencyScore < 50 ? 'text-red-500' : ''}>
                                {/* @ts-ignore */}
                                {item.efficiencyScore.toFixed(0)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-blue-500 font-medium">
                            // @ts-ignore
                            ${(item as any).suggestedBid.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-green-500">
                            // @ts-ignore
                            ${(item as any).expectedSavings.toFixed(2)}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            {/* @ts-ignore */}
                            {item.overbiddingReasons.length > 0 ? (
                              <ul className="text-xs text-muted-foreground">
                                // @ts-ignore
                                {(item as any).overbiddingReasons.slice(0, 2).map((reason: unknown, idx: unknown) => (
                                  // @ts-ignore
                                  <li key={idx}>• {reason}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-green-500 text-sm">正常</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>暂无竞价效率数据</p>
                    <p className="text-sm">请确保账号有足够的投放数据</p>
                  </div>
                // @ts-ignore
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 季节性Tab */}
          <TabsContent value="seasonal" className="space-y-4">
            {/* 当日策略 */}
            {seasonalStrategy && (
              // @ts-ignore
              <Card>
                <CardHeader>
                  <CardTitle>今日季节性调整建议</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div className="p-4 rounded-lg border bg-card">
                      <p className="text-sm text-muted-foreground">基础季节因子</p>
                      <p className="text-2xl font-bold">{seasonalStrategy.baseFactor.toFixed(2)}x</p>
                    {/* @ts-ignore */}
                    </div>
                    {/* @ts-ignore */}
                    {seasonalStrategy.eventName && (
                      <div className="p-4 rounded-lg border bg-card">
                        <p className="text-sm text-muted-foreground">大促事件</p>
                        {/* @ts-ignore */}
                        <p className="text-2xl font-bold text-purple-500">{seasonalStrategy.eventName}</p>
                      </div>
                    )}
                    <div className="p-4 rounded-lg border bg-card">
                      {/* @ts-ignore */}
                      <p className="text-sm text-muted-foreground">建议预算系数</p>
                      <p className="text-2xl font-bold text-blue-500">{seasonalStrategy.budgetMultiplier.toFixed(2)}x</p>
                    </div>
                    <div className="p-4 rounded-lg border bg-card">
                      {/* @ts-ignore */}
                      <p className="text-sm text-muted-foreground">建议出价系数</p>
                      <p className="text-2xl font-bold text-green-500">{seasonalStrategy.bidMultiplier.toFixed(2)}x</p>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="font-medium mb-2">策略说明</p>
                    <p className="text-muted-foreground">{seasonalStrategy.explanation}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm text-muted-foreground">置信度:</span>
                      <Progress value={seasonalStrategy.confidence * 100} className="w-24 h-2" />
                      <span className="text-sm">{(seasonalStrategy.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 即将到来的大促 */}
            <Card>
              <CardHeader>
                <CardTitle>大促活动日历</CardTitle>
                <CardDescription>未来60天内的重要促销活动</CardDescription>
              </CardHeader>
              <CardContent>
                {upcomingEvents && upcomingEvents.length > 0 ? (
                  <div className="space-y-4">
                    {upcomingEvents.map((event: unknown, idx: unknown) => (
                      // @ts-ignore
                      <div key={idx} className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-500/10">
                              <Calendar className="w-5 h-5 text-purple-500" />
                            </div>
                            <div>
                              {/* @ts-ignore */}
                              <h4 className="font-semibold">{event.event.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                {/* @ts-ignore */}
                                {safeToLocaleDateString(event.event.date, 'zh-CN', {
                                  // @ts-ignore
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            {/* @ts-ignore */}
                            <Badge variant={event.daysUntil <= 7 ? "destructive" : event.daysUntil <= 14 ? "outline" : "secondary"}>
                              // @ts-ignore
                              {(event as any).daysUntil === 0 ? '今天' : `${(event as any).daysUntil}天后`}
                            </Badge>
                            <p className="text-sm text-muted-foreground mt-1">
                              // @ts-ignore
                              持续 {(event as any).event.duration} 天
                            </p>
                          </div>
                        </div>
                        {/* @ts-ignore */}
                        {event.daysUntil <= 14 && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">建议: </span>
                              {/* @ts-ignore */}
                              {event.daysUntil <= 7 
                                ? '大促即将开始，建议立即提高预算和出价'
                                : '建议开始准备大促策略，逐步提升投放力度'}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>未来60天内暂无大促活动</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 批量应用确认弹窗 */}
        <Dialog open={showBatchConfirm} onOpenChange={setShowBatchConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认批量应用建议出价</DialogTitle>
              <DialogDescription>
                您即将对 {selectedKeywords.length} 个投放词应用建议出价。此操作将降低这些投放词的出价以提高竞价效率。
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <span>选中投放词数量</span>
                  <span className="font-bold">{selectedKeywords.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>预计节省金额</span>
                  <span className="font-bold text-green-500">
                    ${bidEfficiency?.topOverbidding
                      .filter(k => selectedKeywords.includes(k.targetId))
                      // @ts-ignore
                      .reduce((sum: number, k: Record<string, unknown>) => sum + k.expectedSavings, 0)
                      // @ts-ignore
                      .toFixed(2) || '0.00'}
                  </span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBatchConfirm(false)}>
                取消
              </Button>
              <Button onClick={confirmApplyBids} disabled={applyBidsMutation.isPending}>
                {applyBidsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                确认应用
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
