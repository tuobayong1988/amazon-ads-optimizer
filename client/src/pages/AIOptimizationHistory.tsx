import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Target,
  Calendar,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

// 状态标签映射
const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "待执行", variant: "secondary" },
  executing: { label: "执行中", variant: "default" },
  completed: { label: "已完成", variant: "default" },
  failed: { label: "失败", variant: "destructive" },
  partially_completed: { label: "部分完成", variant: "outline" },
};

// 复盘状态标签
const reviewStatusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "待复盘", color: "text-yellow-500" },
  completed: { label: "已复盘", color: "text-green-500" },
  skipped: { label: "已跳过", color: "text-gray-500" },
};

export default function AIOptimizationHistory() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/campaigns/:id/ai-history");
  const campaignId = params?.id ? parseInt(params.id) : null;
  
  const [expandedExecution, setExpandedExecution] = useState<number | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  
  // 获取广告活动信息
  const { data: campaign } = trpc.campaign.get.useQuery(
    { id: campaignId! },
    { enabled: !!campaignId }
  );
  
  // 获取AI优化执行历史
  const { data: executions, isLoading, refetch } = trpc.campaign.getAIOptimizationHistory.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId }
  );
  
  // 获取执行详情
  const { data: executionDetail, isLoading: detailLoading } = trpc.campaign.getAIOptimizationDetail.useQuery(
    { executionId: selectedExecution?.id },
    { enabled: !!selectedExecution?.id }
  );
  
  const handleViewDetail = (execution: any) => {
    setSelectedExecution(execution);
    setShowDetailDialog(true);
  };
  
  const toggleExpand = (id: number) => {
    setExpandedExecution(expandedExecution === id ? null : id);
  };
  
  if (!match || !campaignId) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <p className="text-muted-foreground">无效的广告活动ID</p>
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 页面头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/campaigns/${campaignId}`)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                AI优化执行记录
              </h1>
              <p className="text-muted-foreground">
                {campaign?.campaignName || "加载中..."} - 查看历史优化记录与效果复盘
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新
          </Button>
        </div>
        
        {/* 执行历史列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              执行历史
            </CardTitle>
            <CardDescription>
              所有AI优化建议的执行记录，包含效果预测和复盘数据
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !executions || executions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无AI优化执行记录</p>
                <p className="text-sm mt-2">在广告活动详情页使用"智能分析与优化"功能生成并执行优化建议</p>
              </div>
            ) : (
              <div className="space-y-4">
                {executions.map((execution: any) => (
                  <div key={execution.id} className="border rounded-lg overflow-hidden">
                    {/* 执行摘要行 */}
                    <div 
                      className="p-4 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => toggleExpand(execution.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            {expandedExecution === execution.id ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                            <span className="font-medium">{execution.executionName || `执行 #${execution.id}`}</span>
                          </div>
                          <Badge variant={statusLabels[execution.status]?.variant || "secondary"}>
                            {statusLabels[execution.status]?.label || execution.status}
                          </Badge>
                          <Badge variant="outline">
                            {execution.executionType === "bid_adjustment" ? "出价调整" :
                             execution.executionType === "status_change" ? "状态变更" :
                             execution.executionType === "negative_keyword" ? "否定词" : "混合操作"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Target className="h-4 w-4" />
                            {execution.totalActions} 项操作
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            {execution.successfulActions} 成功
                          </span>
                          {execution.failedActions > 0 && (
                            <span className="flex items-center gap-1">
                              <XCircle className="h-4 w-4 text-red-500" />
                              {execution.failedActions} 失败
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {new Date(execution.executedAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* 展开详情 */}
                    {expandedExecution === execution.id && (
                      <div className="p-4 border-t bg-background">
                        <div className="grid grid-cols-2 gap-6">
                          {/* 基准数据 */}
                          <div>
                            <h4 className="font-medium mb-3 flex items-center gap-2">
                              <BarChart3 className="h-4 w-4" />
                              执行前基准数据
                            </h4>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="p-2 bg-muted/50 rounded">
                                <span className="text-muted-foreground">花费</span>
                                <p className="font-medium">${parseFloat(execution.baselineSpend || "0").toFixed(2)}</p>
                              </div>
                              <div className="p-2 bg-muted/50 rounded">
                                <span className="text-muted-foreground">销售额</span>
                                <p className="font-medium">${parseFloat(execution.baselineSales || "0").toFixed(2)}</p>
                              </div>
                              <div className="p-2 bg-muted/50 rounded">
                                <span className="text-muted-foreground">ACoS</span>
                                <p className="font-medium">{parseFloat(execution.baselineAcos || "0").toFixed(1)}%</p>
                              </div>
                              <div className="p-2 bg-muted/50 rounded">
                                <span className="text-muted-foreground">ROAS</span>
                                <p className="font-medium">{parseFloat(execution.baselineRoas || "0").toFixed(2)}</p>
                              </div>
                            </div>
                          </div>
                          
                          {/* 操作按钮 */}
                          <div className="flex items-end justify-end">
                            <Button onClick={() => handleViewDetail(execution)}>
                              查看详情与复盘
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* 执行详情弹窗 */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {selectedExecution?.executionName || `执行 #${selectedExecution?.id}`}
              </DialogTitle>
              <DialogDescription>
                执行时间: {selectedExecution && new Date(selectedExecution.executedAt).toLocaleString("zh-CN")}
              </DialogDescription>
            </DialogHeader>
            
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : executionDetail ? (
              <Tabs defaultValue="actions" className="mt-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="actions">执行操作</TabsTrigger>
                  <TabsTrigger value="predictions">效果预测</TabsTrigger>
                  <TabsTrigger value="reviews">复盘分析</TabsTrigger>
                </TabsList>
                
                {/* 执行操作 */}
                <TabsContent value="actions" className="mt-4">
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {executionDetail.actions.map((action: any) => (
                      <div key={action.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {action.status === "success" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : action.status === "failed" ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-yellow-500" />
                            )}
                            <span className="font-medium">{action.targetText}</span>
                          </div>
                          <Badge variant="outline">
                            {action.actionType === "bid_increase" ? "提高出价" :
                             action.actionType === "bid_decrease" ? "降低出价" :
                             action.actionType === "bid_set" ? "设置出价" :
                             action.actionType === "enable_target" ? "启用" :
                             action.actionType === "pause_target" ? "暂停" :
                             action.actionType === "add_negative_phrase" ? "词组否定" :
                             action.actionType === "add_negative_exact" ? "精准否定" : action.actionType}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{action.changeReason}</p>
                        {action.previousValue && action.newValue && (
                          <div className="flex items-center gap-2 mt-2 text-sm">
                            <span className="text-muted-foreground">{action.previousValue}</span>
                            <span>→</span>
                            <span className="font-medium text-primary">{action.newValue}</span>
                          </div>
                        )}
                        {action.errorMessage && (
                          <p className="text-sm text-red-500 mt-1">{action.errorMessage}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </TabsContent>
                
                {/* 效果预测 */}
                <TabsContent value="predictions" className="mt-4">
                  <div className="grid grid-cols-3 gap-4">
                    {executionDetail.predictions.map((pred: any) => (
                      <Card key={pred.id}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            {pred.predictionPeriod === "7_days" ? "7天预测" :
                             pred.predictionPeriod === "14_days" ? "14天预测" : "30天预测"}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">预测花费</span>
                            <span className={parseFloat(pred.spendChangePercent || "0") < 0 ? "text-green-500" : "text-red-500"}>
                              ${parseFloat(pred.predictedSpend || "0").toFixed(2)}
                              <span className="text-xs ml-1">
                                ({parseFloat(pred.spendChangePercent || "0") > 0 ? "+" : ""}{parseFloat(pred.spendChangePercent || "0").toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">预测销售</span>
                            <span className={parseFloat(pred.salesChangePercent || "0") > 0 ? "text-green-500" : "text-red-500"}>
                              ${parseFloat(pred.predictedSales || "0").toFixed(2)}
                              <span className="text-xs ml-1">
                                ({parseFloat(pred.salesChangePercent || "0") > 0 ? "+" : ""}{parseFloat(pred.salesChangePercent || "0").toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">预测ACoS</span>
                            <span className={parseFloat(pred.acosChangePercent || "0") < 0 ? "text-green-500" : "text-red-500"}>
                              {parseFloat(pred.predictedAcos || "0").toFixed(1)}%
                              <span className="text-xs ml-1">
                                ({parseFloat(pred.acosChangePercent || "0") > 0 ? "+" : ""}{parseFloat(pred.acosChangePercent || "0").toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">预测ROAS</span>
                            <span className={parseFloat(pred.roasChangePercent || "0") > 0 ? "text-green-500" : "text-red-500"}>
                              {parseFloat(pred.predictedRoas || "0").toFixed(2)}
                              <span className="text-xs ml-1">
                                ({parseFloat(pred.roasChangePercent || "0") > 0 ? "+" : ""}{parseFloat(pred.roasChangePercent || "0").toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          <div className="pt-2 border-t">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-muted-foreground">置信度</span>
                              <span>{(parseFloat(pred.confidenceLevel || "0") * 100).toFixed(0)}%</span>
                            </div>
                            <Progress value={parseFloat(pred.confidenceLevel || "0") * 100} className="h-2" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
                
                {/* 复盘分析 */}
                <TabsContent value="reviews" className="mt-4">
                  {executionDetail.reviews.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>复盘数据将在预定时间自动采集</p>
                      <p className="text-sm mt-2">系统将在7天、14天、30天后自动对比实际数据与预测数据</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {executionDetail.reviews.map((review: any) => (
                        <Card key={review.id}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base flex items-center gap-2">
                                {review.reviewPeriod === "7_days" ? "7天复盘" :
                                 review.reviewPeriod === "14_days" ? "14天复盘" : "30天复盘"}
                                <span className={reviewStatusLabels[review.status]?.color || ""}>
                                  ({reviewStatusLabels[review.status]?.label || review.status})
                                </span>
                              </CardTitle>
                              <span className="text-sm text-muted-foreground">
                                计划时间: {new Date(review.scheduledAt).toLocaleDateString("zh-CN")}
                              </span>
                            </div>
                          </CardHeader>
                          <CardContent>
                            {review.status === "completed" ? (
                              <div className="space-y-4">
                                {/* 实际数据对比 */}
                                <div className="grid grid-cols-4 gap-4">
                                  <div className="p-3 bg-muted/50 rounded">
                                    <div className="text-sm text-muted-foreground mb-1">实际花费</div>
                                    <div className="font-medium">${parseFloat(review.actualSpend || "0").toFixed(2)}</div>
                                    <div className={`text-xs ${parseFloat(review.actualSpendChange || "0") < 0 ? "text-green-500" : "text-red-500"}`}>
                                      {parseFloat(review.actualSpendChange || "0") > 0 ? "+" : ""}{parseFloat(review.actualSpendChange || "0").toFixed(1)}%
                                    </div>
                                  </div>
                                  <div className="p-3 bg-muted/50 rounded">
                                    <div className="text-sm text-muted-foreground mb-1">实际销售</div>
                                    <div className="font-medium">${parseFloat(review.actualSales || "0").toFixed(2)}</div>
                                    <div className={`text-xs ${parseFloat(review.actualSalesChange || "0") > 0 ? "text-green-500" : "text-red-500"}`}>
                                      {parseFloat(review.actualSalesChange || "0") > 0 ? "+" : ""}{parseFloat(review.actualSalesChange || "0").toFixed(1)}%
                                    </div>
                                  </div>
                                  <div className="p-3 bg-muted/50 rounded">
                                    <div className="text-sm text-muted-foreground mb-1">实际ACoS</div>
                                    <div className="font-medium">{parseFloat(review.actualAcos || "0").toFixed(1)}%</div>
                                    <div className={`text-xs ${parseFloat(review.actualAcosChange || "0") < 0 ? "text-green-500" : "text-red-500"}`}>
                                      {parseFloat(review.actualAcosChange || "0") > 0 ? "+" : ""}{parseFloat(review.actualAcosChange || "0").toFixed(1)}%
                                    </div>
                                  </div>
                                  <div className="p-3 bg-muted/50 rounded">
                                    <div className="text-sm text-muted-foreground mb-1">实际ROAS</div>
                                    <div className="font-medium">{parseFloat(review.actualRoas || "0").toFixed(2)}</div>
                                    <div className={`text-xs ${parseFloat(review.actualRoasChange || "0") > 0 ? "text-green-500" : "text-red-500"}`}>
                                      {parseFloat(review.actualRoasChange || "0") > 0 ? "+" : ""}{parseFloat(review.actualRoasChange || "0").toFixed(1)}%
                                    </div>
                                  </div>
                                </div>
                                
                                {/* 达成率 */}
                                <div className="p-4 bg-primary/5 rounded-lg">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium">综合达成率</span>
                                    <span className="text-2xl font-bold text-primary">
                                      {parseFloat(review.overallAccuracy || "0").toFixed(0)}%
                                    </span>
                                  </div>
                                  <Progress value={parseFloat(review.overallAccuracy || "0")} className="h-3" />
                                </div>
                                
                                {/* 复盘总结 */}
                                {review.reviewSummary && (
                                  <div className="p-3 bg-muted/30 rounded">
                                    <h5 className="font-medium mb-2">复盘总结</h5>
                                    <p className="text-sm text-muted-foreground">{review.reviewSummary}</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-muted-foreground">
                                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">等待复盘时间到达</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
