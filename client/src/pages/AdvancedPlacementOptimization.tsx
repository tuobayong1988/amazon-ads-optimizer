import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Minus, 
  TrendingUp, 
  Target, 
  Settings, 
  Play, 
  History,
  RefreshCw,
  Info,
  CheckCircle2,
  AlertTriangle,
  Zap,
  BarChart3,
  Layers,
  Search,
  Package,
  List,
  Brain,
  LineChart,
  TreeDeciduous,
  DollarSign,
  Calculator,
  Sparkles,
  ChevronRight,
  Eye,
  GitBranch,
  Activity
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ==================== 类型定义 ====================

interface MarketCurvePoint {
  bid: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  profit: number;
  marginalProfit: number;
}

interface KeywordPrediction {
  keywordId: number;
  keywordText: string;
  matchType: string;
  predictedCR: number;
  predictedCV: number;
  confidence: number;
  predictionSource: string;
  actualCR?: number;
  actualCV?: number;
}

interface OptimizationRecommendation {
  id: number;
  type: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  expectedProfitChange: number;
  createdAt: string;
}

interface BidObjectProfit {
  bidObjectId: string;
  bidObjectText: string;
  bidObjectType: 'keyword' | 'asin';
  currentBid: number;
  optimalBid: number;
  currentProfit: number;
  expectedProfit: number;
  profitChange: number;
  confidence: number;
}

// ==================== 常量定义 ====================

const PLACEMENT_LABELS: Record<string, { name: string; icon: React.ReactNode; description: string }> = {
  top_of_search: { 
    name: "搜索顶部", 
    icon: <Search className="h-4 w-4" />,
    description: "搜索结果页面顶部位置，通常转化率最高"
  },
  product_page: { 
    name: "商品详情页", 
    icon: <Package className="h-4 w-4" />,
    description: "商品详情页面的广告位置"
  },
  rest_of_search: { 
    name: "其他搜索位置", 
    icon: <List className="h-4 w-4" />,
    description: "搜索结果页面的其他位置（基准位置，无法调整）"
  },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

// ==================== 辅助函数 ====================

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function getConfidenceLevel(confidence: number): { level: string; color: string; bgColor: string } {
  if (confidence >= 0.8) return { level: "高", color: "text-green-500", bgColor: "bg-green-500/10" };
  if (confidence >= 0.5) return { level: "中", color: "text-yellow-500", bgColor: "bg-yellow-500/10" };
  return { level: "低", color: "text-red-500", bgColor: "bg-red-500/10" };
}

// ==================== 子组件 ====================

// 市场曲线可视化组件
function MarketCurveVisualization({ 
  curveData, 
  optimalPoint 
}: { 
  curveData: MarketCurvePoint[]; 
  optimalPoint?: { bid: number; profit: number } 
}) {
  if (!curveData || curveData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <LineChart className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>暂无市场曲线数据</p>
        </div>
      </div>
    );
  }

  const maxProfit = Math.max(...curveData.map(p => p.profit));
  const minProfit = Math.min(...curveData.map(p => p.profit));
  const profitRange = maxProfit - minProfit || 1;
  const maxBid = Math.max(...curveData.map(p => p.bid));

  return (
    <div className="h-64 relative">
      {/* Y轴标签 */}
      <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-xs text-muted-foreground">
        <span>{formatCurrency(maxProfit)}</span>
        <span>{formatCurrency((maxProfit + minProfit) / 2)}</span>
        <span>{formatCurrency(minProfit)}</span>
      </div>
      
      {/* 图表区域 */}
      <div className="ml-14 mr-4 h-56 relative border-l border-b border-border">
        {/* 利润曲线 */}
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* 填充区域 */}
          <path
            d={`
              M 0 ${100}
              ${curveData.map((p, i) => {
                const x = (p.bid / maxBid) * 100;
                const y = 100 - ((p.profit - minProfit) / profitRange) * 100;
                return `L ${x} ${y}`;
              }).join(' ')}
              L 100 100
              Z
            `}
            fill="url(#profitGradient)"
          />
          
          {/* 曲线 */}
          <path
            d={`
              M ${(curveData[0].bid / maxBid) * 100} ${100 - ((curveData[0].profit - minProfit) / profitRange) * 100}
              ${curveData.slice(1).map((p) => {
                const x = (p.bid / maxBid) * 100;
                const y = 100 - ((p.profit - minProfit) / profitRange) * 100;
                return `L ${x} ${y}`;
              }).join(' ')}
            `}
            fill="none"
            stroke="rgb(34, 197, 94)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          
          {/* 最优点标记 */}
          {optimalPoint && (
            <circle
              cx={`${(optimalPoint.bid / maxBid) * 100}%`}
              cy={`${100 - ((optimalPoint.profit - minProfit) / profitRange) * 100}%`}
              r="6"
              fill="rgb(234, 179, 8)"
              stroke="white"
              strokeWidth="2"
            />
          )}
        </svg>
        
        {/* 最优点提示 */}
        {optimalPoint && (
          <div 
            className="absolute bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1 text-xs"
            style={{
              left: `${(optimalPoint.bid / maxBid) * 100}%`,
              top: `${100 - ((optimalPoint.profit - minProfit) / profitRange) * 100}%`,
              transform: 'translate(-50%, -150%)'
            }}
          >
            <span className="text-yellow-500 font-medium">最优出价: {formatCurrency(optimalPoint.bid)}</span>
          </div>
        )}
      </div>
      
      {/* X轴标签 */}
      <div className="ml-14 mr-4 flex justify-between text-xs text-muted-foreground mt-1">
        <span>$0</span>
        <span>{formatCurrency(maxBid / 2)}</span>
        <span>{formatCurrency(maxBid)}</span>
      </div>
      
      {/* 图例 */}
      <div className="absolute top-2 right-4 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-green-500" />
          <span className="text-muted-foreground">利润曲线</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">最优出价点</span>
        </div>
      </div>
    </div>
  );
}

// 决策树可视化组件
function DecisionTreeVisualization({ 
  treeData,
  depth = 0 
}: { 
  treeData: any;
  depth?: number;
}) {
  if (!treeData) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <TreeDeciduous className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>暂无决策树数据</p>
        </div>
      </div>
    );
  }

  const isLeaf = treeData.isLeaf || (!treeData.left && !treeData.right);
  
  return (
    <div className={`${depth > 0 ? 'ml-6 border-l border-dashed border-border pl-4' : ''}`}>
      <div className={`
        p-3 rounded-lg mb-2
        ${isLeaf ? 'bg-green-500/10 border border-green-500/20' : 'bg-muted/50'}
      `}>
        {isLeaf ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <div>
              <div className="text-sm font-medium">
                预测CR: {(treeData.predictedCR * 100).toFixed(2)}%
              </div>
              <div className="text-xs text-muted-foreground">
                样本数: {treeData.samples || 0}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <div>
              <div className="text-sm font-medium">
                {treeData.feature} {treeData.operator || '<='} {treeData.threshold}
              </div>
              <div className="text-xs text-muted-foreground">
                分裂特征
              </div>
            </div>
          </div>
        )}
      </div>
      
      {!isLeaf && depth < 3 && (
        <div className="flex flex-col gap-2">
          {treeData.left && (
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ChevronRight className="h-3 w-3" /> 是
              </div>
              <DecisionTreeVisualization treeData={treeData.left} depth={depth + 1} />
            </div>
          )}
          {treeData.right && (
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ChevronRight className="h-3 w-3" /> 否
              </div>
              <DecisionTreeVisualization treeData={treeData.right} depth={depth + 1} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 关键词预测表格组件
function KeywordPredictionTable({ 
  predictions,
  onRefresh
}: { 
  predictions: KeywordPrediction[];
  onRefresh: () => void;
}) {
  const [sortBy, setSortBy] = useState<'confidence' | 'predictedCR' | 'predictedCV'>('confidence');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const sortedPredictions = useMemo(() => {
    return [...predictions].sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [predictions, sortBy, sortOrder]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          共 {predictions.length} 个关键词预测
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新预测
        </Button>
      </div>
      
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>关键词</TableHead>
              <TableHead>匹配类型</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('predictedCR')}
              >
                预测CR {sortBy === 'predictedCR' && (sortOrder === 'desc' ? '↓' : '↑')}
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('predictedCV')}
              >
                预测CV {sortBy === 'predictedCV' && (sortOrder === 'desc' ? '↓' : '↑')}
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('confidence')}
              >
                置信度 {sortBy === 'confidence' && (sortOrder === 'desc' ? '↓' : '↑')}
              </TableHead>
              <TableHead>预测来源</TableHead>
              <TableHead>实际CR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPredictions.slice(0, 20).map((pred) => {
              const confidenceInfo = getConfidenceLevel(pred.confidence);
              return (
                <TableRow key={pred.keywordId}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {pred.keywordText}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{pred.matchType}</Badge>
                  </TableCell>
                  <TableCell>{(pred.predictedCR * 100).toFixed(2)}%</TableCell>
                  <TableCell>{formatCurrency(pred.predictedCV)}</TableCell>
                  <TableCell>
                    <Badge className={confidenceInfo.bgColor + ' ' + confidenceInfo.color}>
                      {confidenceInfo.level} ({(pred.confidence * 100).toFixed(0)}%)
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {pred.predictionSource === 'decision_tree' ? '决策树' : 
                       pred.predictionSource === 'bayesian' ? '贝叶斯' : '历史数据'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {pred.actualCR !== undefined ? (
                      <span className={pred.actualCR > pred.predictedCR ? 'text-green-500' : 'text-red-500'}>
                        {(pred.actualCR * 100).toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// 优化建议卡片组件
function RecommendationCard({ 
  recommendation,
  onApply,
  onDismiss,
  isApplying
}: { 
  recommendation: OptimizationRecommendation;
  onApply: () => void;
  onDismiss: () => void;
  isApplying: boolean;
}) {
  const priorityClass = PRIORITY_COLORS[recommendation.priority] || PRIORITY_COLORS.medium;
  
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${
        recommendation.priority === 'critical' ? 'bg-red-500' :
        recommendation.priority === 'high' ? 'bg-orange-500' :
        recommendation.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
      }`} />
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={priorityClass}>
                {PRIORITY_LABELS[recommendation.priority]}
              </Badge>
              <span className="text-sm font-medium">{recommendation.title}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {recommendation.description}
            </p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <DollarSign className="h-4 w-4 text-green-500" />
                <span className={recommendation.expectedProfitChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                  预期利润变化: {formatCurrency(recommendation.expectedProfitChange)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {new Date(recommendation.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button 
              size="sm" 
              onClick={onApply}
              disabled={isApplying}
            >
              {isApplying ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  应用
                </>
              )}
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={onDismiss}
            >
              忽略
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 竞价对象利润表格组件
function BidObjectProfitTable({ 
  profitData,
  onOptimize
}: { 
  profitData: BidObjectProfit[];
  onOptimize: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (selectedIds.size === profitData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(profitData.map(p => p.bidObjectId)));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          已选择 {selectedIds.size} / {profitData.length} 个竞价对象
        </div>
        <Button 
          onClick={() => onOptimize(Array.from(selectedIds))}
          disabled={selectedIds.size === 0}
        >
          <Zap className="h-4 w-4 mr-2" />
          优化选中项
        </Button>
      </div>
      
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={selectedIds.size === profitData.length && profitData.length > 0}
                  onChange={selectAll}
                  className="rounded"
                />
              </TableHead>
              <TableHead>竞价对象</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>当前出价</TableHead>
              <TableHead>最优出价</TableHead>
              <TableHead>当前利润</TableHead>
              <TableHead>预期利润</TableHead>
              <TableHead>利润变化</TableHead>
              <TableHead>置信度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profitData.map((item) => {
              const confidenceInfo = getConfidenceLevel(item.confidence);
              const profitChangePercent = item.currentProfit !== 0 
                ? ((item.profitChange / Math.abs(item.currentProfit)) * 100)
                : 0;
              
              return (
                <TableRow key={item.bidObjectId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.bidObjectId)}
                      onChange={() => toggleSelect(item.bidObjectId)}
                      className="rounded"
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {item.bidObjectText}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {item.bidObjectType === 'keyword' ? '关键词' : 'ASIN'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(item.currentBid)}</TableCell>
                  <TableCell className="font-medium text-blue-500">
                    {formatCurrency(item.optimalBid)}
                  </TableCell>
                  <TableCell>{formatCurrency(item.currentProfit)}</TableCell>
                  <TableCell className="font-medium text-green-500">
                    {formatCurrency(item.expectedProfit)}
                  </TableCell>
                  <TableCell>
                    <span className={item.profitChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                      {formatCurrency(item.profitChange)}
                      <span className="text-xs ml-1">
                        ({formatPercent(profitChangePercent)})
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={confidenceInfo.bgColor + ' ' + confidenceInfo.color}>
                      {confidenceInfo.level}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export default function AdvancedPlacementOptimization() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [applyingRecommendationId, setApplyingRecommendationId] = useState<number | null>(null);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取位置表现数据
  const { data: performanceData, refetch: refetchPerformance } = trpc.placement.getPerformance.useQuery(
    { campaignId: selectedCampaignId!, accountId: selectedAccountId! },
    { enabled: !!selectedCampaignId && !!selectedAccountId }
  );

  // 获取优化建议 - 使用generateSuggestions代替
  const generateSuggestionsMutation = trpc.placement.generateSuggestions.useMutation({
    onSuccess: (data: any) => {
      toast.success(`分析完成，发现 ${data.suggestions?.length || 0} 条优化建议`);
      refetchPerformance();
    },
    onError: (error: any) => {
      toast.error(`分析失败: ${error.message}`);
    }
  });

  // 应用建议 mutation
  const applyRecommendationMutation = trpc.placement.applyRecommendation.useMutation({
    onSuccess: () => {
      toast.success("优化建议已成功应用");
      setApplyingRecommendationId(null);
      refetchPerformance();
    },
    onError: (error) => {
      toast.error(`应用失败: ${error.message}`);
      setApplyingRecommendationId(null);
    }
  });

  // 训练决策树 mutation
  const trainDecisionTreeMutation = trpc.placement.trainDecisionTree.useMutation({
    onSuccess: (data) => {
      toast.success(`决策树训练完成，样本数: ${data.totalSamples}`);
    },
    onError: (error) => {
      toast.error(`训练失败: ${error.message}`);
    }
  });

  // 构建市场曲线 mutation
  const buildMarketCurveMutation = trpc.placement.buildMarketCurve.useMutation({
    onSuccess: (data) => {
      toast.success(`市场曲线构建完成，最优出价: ${formatCurrency(data?.optimalBid || 0)}`);
    },
    onError: (error) => {
      toast.error(`构建失败: ${error.message}`);
    }
  });

  // 处理分析
  const handleAnalyze = () => {
    if (!selectedAccountId) {
      toast.error("请先选择账号");
      return;
    }
    generateSuggestionsMutation.mutate({
      accountId: selectedAccountId,
      campaignId: selectedCampaignId || '',
      days: 7
    });
  };

  // 处理应用建议
  const handleApplyRecommendation = (id: number) => {
    setApplyingRecommendationId(id);
    applyRecommendationMutation.mutate({ recommendationId: id });
  };

  // 处理忽略建议
  const handleDismissRecommendation = (id: number) => {
    toast.info("建议已忽略");
    // TODO: 实现忽略逻辑
  };

  // 处理训练决策树
  const handleTrainDecisionTree = () => {
    if (!selectedAccountId) {
      toast.error("请先选择账号");
      return;
    }
    trainDecisionTreeMutation.mutate({ accountId: selectedAccountId, modelType: 'cr_prediction' });
  };

  // 计算汇总数据
  const summaryData = useMemo(() => {
    if (!performanceData || performanceData.length === 0) {
      return {
        totalSpend: 0,
        totalSales: 0,
        totalProfit: 0,
        avgRoas: 0,
        avgAcos: 0,
        recommendationCount: 0,
      };
    }

    const totalSpend = performanceData.reduce((sum, p) => sum + (p.metrics?.spend || 0), 0);
    const totalSales = performanceData.reduce((sum, p) => sum + (p.metrics?.sales || 0), 0);
    const totalProfit = totalSales - totalSpend;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;

    return { 
      totalSpend, 
      totalSales, 
      totalProfit,
      avgRoas, 
      avgAcos,
      recommendationCount: 0,
    };
  }, [performanceData]);

  // 模拟市场曲线数据
  const mockMarketCurveData: MarketCurvePoint[] = useMemo(() => {
    const points: MarketCurvePoint[] = [];
    for (let bid = 0.1; bid <= 3.0; bid += 0.1) {
      const impressions = Math.floor(1000 * Math.log(bid * 10 + 1));
      const ctr = 0.02 + 0.01 * Math.sin(bid);
      const clicks = Math.floor(impressions * ctr);
      const cvr = 0.05 - 0.01 * bid;
      const conversions = clicks * Math.max(0.01, cvr);
      const spend = clicks * bid;
      const aov = 25;
      const revenue = conversions * aov;
      const profit = revenue - spend;
      const marginalProfit = points.length > 0 ? profit - points[points.length - 1].profit : profit;
      
      points.push({
        bid: Number(bid.toFixed(2)),
        impressions,
        clicks,
        conversions,
        spend,
        revenue,
        profit,
        marginalProfit
      });
    }
    return points;
  }, []);

  const optimalPoint = useMemo(() => {
    if (mockMarketCurveData.length === 0) return undefined;
    const maxProfitPoint = mockMarketCurveData.reduce((max, p) => p.profit > max.profit ? p : max);
    return { bid: maxProfitPoint.bid, profit: maxProfitPoint.profit };
  }, [mockMarketCurveData]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              高级位置优化
            </h1>
            <p className="text-muted-foreground">
              基于Adspert核心算法：市场曲线建模、决策树预测、利润最大化优化
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={handleTrainDecisionTree}
              disabled={!selectedAccountId || trainDecisionTreeMutation.isPending}
            >
              {trainDecisionTreeMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TreeDeciduous className="h-4 w-4 mr-2" />
              )}
              训练决策树
            </Button>
            <Button 
              onClick={handleAnalyze}
              disabled={!selectedAccountId || generateSuggestionsMutation.isPending}
            >
              {generateSuggestionsMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              智能分析
            </Button>
          </div>
        </div>

        {/* 选择器 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>选择账号</Label>
                <Select
                  value={selectedAccountId?.toString() || ""}
                  onValueChange={(value) => {
                    setSelectedAccountId(Number(value));
                    setSelectedCampaignId(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择账号" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.storeName || account.accountName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label>选择广告活动（可选）</Label>
                <Select
                  value={selectedCampaignId || "all"}
                  onValueChange={(value) => setSelectedCampaignId(value === "all" ? null : value)}
                  disabled={!selectedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="全部广告活动" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部广告活动</SelectItem>
                    {campaigns?.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.campaignId}>
                        {campaign.campaignName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 核心指标卡片 */}
        {selectedAccountId && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">总花费</p>
                    <p className="text-2xl font-bold">{formatCurrency(summaryData.totalSpend)}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-blue-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">总销售额</p>
                    <p className="text-2xl font-bold">{formatCurrency(summaryData.totalSales)}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">广告利润</p>
                    <p className={`text-2xl font-bold ${summaryData.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatCurrency(summaryData.totalProfit)}
                    </p>
                  </div>
                  <Calculator className="h-8 w-8 text-purple-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">待处理建议</p>
                    <p className="text-2xl font-bold">{summaryData.recommendationCount}</p>
                  </div>
                  <Sparkles className="h-8 w-8 text-orange-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 主要内容区域 - Tabs */}
        {selectedAccountId && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                概览
              </TabsTrigger>
              <TabsTrigger value="market-curve" className="flex items-center gap-2">
                <LineChart className="h-4 w-4" />
                市场曲线
              </TabsTrigger>
              <TabsTrigger value="decision-tree" className="flex items-center gap-2">
                <TreeDeciduous className="h-4 w-4" />
                决策树
              </TabsTrigger>
              <TabsTrigger value="recommendations" className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                优化建议
              </TabsTrigger>
            </TabsList>

            {/* 概览 Tab */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Adspert算法说明 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      Adspert核心算法
                    </CardTitle>
                    <CardDescription>
                      基于金融市场量化分析方法的广告优化系统
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <LineChart className="h-5 w-5 text-blue-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">市场曲线建模</h4>
                        <p className="text-sm text-muted-foreground">
                          建立CPC与展现、点击、转化的函数关系，通过对利润函数求导找到最优出价点
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <TreeDeciduous className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">决策树预测</h4>
                        <p className="text-sm text-muted-foreground">
                          基于转化率和转化价值的分叉标准，预测长尾关键词的最佳表现
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <Target className="h-5 w-5 text-purple-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">竞价对象层面优化</h4>
                        <p className="text-sm text-muted-foreground">
                          在关键词/ASIN层面设置精确出价，设置较低的位置调整以实现更细致控制
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 利润公式说明 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calculator className="h-5 w-5" />
                      利润最大化公式
                    </CardTitle>
                    <CardDescription>
                      广告利润 = 收入 - 广告支出
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-muted/50 rounded-lg font-mono text-sm">
                      <p className="mb-2">Profit = Clicks × (CVR × AOV - CPC)</p>
                      <p className="text-muted-foreground text-xs">
                        其中: CVR=转化率, AOV=平均订单价值, CPC=点击成本
                      </p>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="font-medium">关键洞察</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• 当边际利润 = 0 时，达到利润最大化点</li>
                        <li>• 出价过高会导致CPC超过转化价值</li>
                        <li>• 出价过低会错失高价值流量</li>
                        <li>• 最优出价点随市场竞争动态变化</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 位置表现概览 */}
              {performanceData && performanceData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>位置表现概览</CardTitle>
                    <CardDescription>各广告位置的效率对比</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {performanceData.map((placement) => {
                        const placementInfo = PLACEMENT_LABELS[placement.placementType];
                        const profit = (placement.metrics?.sales || 0) - (placement.metrics?.spend || 0);
                        
                        return (
                          <div 
                            key={placement.placementType}
                            className="p-4 rounded-lg border bg-card"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              {placementInfo?.icon}
                              <span className="font-medium">{placementInfo?.name}</span>
                            </div>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">花费</span>
                                <span>{formatCurrency(placement.metrics?.spend || 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">销售额</span>
                                <span>{formatCurrency(placement.metrics?.sales || 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">利润</span>
                                <span className={profit >= 0 ? 'text-green-500' : 'text-red-500'}>
                                  {formatCurrency(profit)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">ROAS</span>
                                <span className="font-medium">
                                  {placement.metrics?.roas?.toFixed(2) || 'N/A'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* 市场曲线 Tab */}
            <TabsContent value="market-curve" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LineChart className="h-5 w-5" />
                    利润曲线可视化
                  </CardTitle>
                  <CardDescription>
                    展示出价与利润的关系，黄色点标记最优出价位置
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <MarketCurveVisualization 
                    curveData={mockMarketCurveData} 
                    optimalPoint={optimalPoint}
                  />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>曲线参数</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">最优出价</p>
                        <p className="text-xl font-bold text-blue-500">
                          {optimalPoint ? formatCurrency(optimalPoint.bid) : 'N/A'}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">最大利润</p>
                        <p className="text-xl font-bold text-green-500">
                          {optimalPoint ? formatCurrency(optimalPoint.profit) : 'N/A'}
                        </p>
                      </div>
                    </div>
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        市场曲线会根据竞争环境和季节性因素动态变化，建议定期重新构建
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>曲线构建</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      选择一个关键词或ASIN来构建其市场曲线
                    </p>
                    <div className="space-y-2">
                      <Label>竞价对象ID</Label>
                      <Input placeholder="输入关键词ID或ASIN" />
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => {
                        if (!selectedAccountId) {
                          toast.error("请先选择账号");
                          return;
                        }
                        buildMarketCurveMutation.mutate({
                          accountId: selectedAccountId,
                          campaignId: selectedCampaignId || '',
                          keywordId: 1,
                          daysBack: 30
                        });
                      }}
                      disabled={buildMarketCurveMutation.isPending}
                    >
                      {buildMarketCurveMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <LineChart className="h-4 w-4 mr-2" />
                      )}
                      构建市场曲线
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 决策树 Tab */}
            <TabsContent value="decision-tree" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TreeDeciduous className="h-5 w-5" />
                      决策树结构
                    </CardTitle>
                    <CardDescription>
                      基于转化率(CR)和转化价值(CV)的分叉标准
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <DecisionTreeVisualization 
                        treeData={{
                          feature: "matchType",
                          threshold: "exact",
                          left: {
                            feature: "wordCount",
                            threshold: 3,
                            left: {
                              isLeaf: true,
                              predictedCR: 0.0426,
                              samples: 1250
                            },
                            right: {
                              isLeaf: true,
                              predictedCR: 0.0312,
                              samples: 890
                            }
                          },
                          right: {
                            feature: "keywordType",
                            threshold: "brand",
                            left: {
                              isLeaf: true,
                              predictedCR: 0.0285,
                              samples: 2100
                            },
                            right: {
                              isLeaf: true,
                              predictedCR: 0.0081,
                              samples: 3500
                            }
                          }
                        }}
                      />
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>特征重要性</CardTitle>
                    <CardDescription>影响转化率预测的关键因素</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { name: "匹配类型", importance: 0.35, color: "bg-blue-500" },
                      { name: "关键词字数", importance: 0.25, color: "bg-green-500" },
                      { name: "关键词类型", importance: 0.20, color: "bg-purple-500" },
                      { name: "产品类别", importance: 0.12, color: "bg-orange-500" },
                      { name: "平均出价", importance: 0.08, color: "bg-pink-500" },
                    ].map((feature) => (
                      <div key={feature.name} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{feature.name}</span>
                          <span className="text-muted-foreground">
                            {(feature.importance * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${feature.color}`}
                            style={{ width: `${feature.importance * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    
                    <Separator className="my-4" />
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">模型统计</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="p-2 rounded bg-muted/50">
                          <span className="text-muted-foreground">训练样本</span>
                          <p className="font-medium">12,450</p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <span className="text-muted-foreground">树深度</span>
                          <p className="font-medium">5</p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <span className="text-muted-foreground">叶节点数</span>
                          <p className="font-medium">32</p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <span className="text-muted-foreground">R²分数</span>
                          <p className="font-medium">0.847</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 长尾关键词预测说明 */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>长尾关键词预测</AlertTitle>
                <AlertDescription>
                  决策树特别适合预测长尾关键词的表现，因为它可以从相似关键词群体继承数据。
                  例如：品牌词精确匹配的平均CR(4.26%)远高于通用词广泛匹配(0.81%)。
                </AlertDescription>
              </Alert>
            </TabsContent>

            {/* 优化建议 Tab */}
            <TabsContent value="recommendations" className="space-y-6">
              <Card>
                <CardContent className="py-12 text-center">
                  <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">生成优化建议</h3>
                  <p className="text-muted-foreground mb-4">
                    点击"智能分析"按钮生成基于Adspert算法的优化建议
                  </p>
                  <Button onClick={handleAnalyze} disabled={generateSuggestionsMutation.isPending}>
                    {generateSuggestionsMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    开始分析
                  </Button>
                </CardContent>
              </Card>

              {/* Adspert策略说明 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Adspert展示位置策略
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert className="bg-blue-500/10 border-blue-500/20">
                    <Info className="h-4 w-4 text-blue-500" />
                    <AlertDescription className="text-foreground">
                      <strong>核心策略：</strong>由于Adspert在<strong>竞价对象层面</strong>上设置出价，
                      并在竞价对象层面上估算广告利润（收入 - 广告支出），
                      我们将为亚马逊设置<strong>较低的展示位置竞价调整</strong>（0-50%范围），
                      以便<strong>更细致地</strong>进行针对竞价对象出价。
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* 未选择账号提示 */}
        {!selectedAccountId && (
          <Card>
            <CardContent className="py-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">请选择账号</h3>
              <p className="text-muted-foreground">
                选择一个广告账号以开始使用高级位置优化功能
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
