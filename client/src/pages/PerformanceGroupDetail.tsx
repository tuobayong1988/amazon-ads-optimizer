import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  LineChart, Line, 
  BarChart, Bar,
  AreaChart, Area,
  ComposedChart,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import DashboardLayout from "@/components/DashboardLayout";
import { OptimizationLogs } from "@/components/OptimizationLogs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
// ScrollArea removed in v122 - dialog now uses overflow-auto div
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useRoute, useLocation } from "wouter";
import { predictFutureDays, predictTrend, detectSeasonality } from "@/lib/trendPrediction";
import { detectAnomaliesCombined, generateAnomalyReport, type Anomaly } from "@/lib/anomalyDetection";
import { 
  ArrowLeft,
  Target, 
  Settings, 
  Play, 
  Pause,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  Loader2,
  Plus,
  Minus,
  Search,
  CheckCircle2,
  AlertCircle,
  Activity,
  Zap,
  Save,
  RefreshCw,
  Download,
  Filter,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X
} from "lucide-react";

// 优化目标类型
const OPTIMIZATION_TYPES = [
  { value: 'maximize_sales', label: '销售最大化', description: '在预算内最大化销售额' },
  { value: 'target_acos', label: '目标ACoS', description: '控制广告成本销售比' },
  { value: 'target_roas', label: '目标ROAS', description: '控制广告投资回报率' },
  { value: 'target_cpa', label: '目标转化成本', description: '控制每次转化的成本' },
];

// 优化大类
const OPTIMIZATION_CATEGORIES = [
  { value: 'revenue', label: '销售额', description: '追求销售转化' },
  { value: 'vcpm', label: 'vCPM', description: '追求品牌曝光' },
];

export default function PerformanceGroupDetail() {
  // 支持两种路由格式
  const [matchPerformance, paramsPerformance] = useRoute("/performance-groups/:id");
  const [matchOptimization, paramsOptimization] = useRoute("/optimization-targets/:id");
  const [, setLocation] = useLocation();
  
  const params = matchPerformance ? paramsPerformance : paramsOptimization;
  const groupId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("overview");
  const [showAddCampaignsDialog, setShowAddCampaignsDialog] = useState(false);
  const [showEditGoalDialog, setShowEditGoalDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  const [timeRange, setTimeRange] = useState("30d");
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area' | 'composed' | 'pie' | 'radar'>('line');
  const [showPrediction, setShowPrediction] = useState(false);
  const [showAnomalies, setShowAnomalies] = useState(false);
  
  // 筛选条件状态
  const [filterCampaignType, setFilterCampaignType] = useState<string>("all");
  const [filterBiddingStrategy, setFilterBiddingStrategy] = useState<string>("all");
  const [filterState, setFilterState] = useState<string>("all");
  const [filterMinSpend, setFilterMinSpend] = useState<string>("");
  const [filterMaxSpend, setFilterMaxSpend] = useState<string>("");
  const [filterMinAcos, setFilterMinAcos] = useState<string>("");
  const [filterMaxAcos, setFilterMaxAcos] = useState<string>("");
  const [filterMinOrders, setFilterMinOrders] = useState<string>("");
  const [filterMaxOrders, setFilterMaxOrders] = useState<string>("");
  const [filterMinRoas, setFilterMinRoas] = useState<string>("");
  const [filterMaxRoas, setFilterMaxRoas] = useState<string>("");
  const [filterMinClicks, setFilterMinClicks] = useState<string>("");
  const [filterMaxClicks, setFilterMaxClicks] = useState<string>("");
  const [filterMinCpc, setFilterMinCpc] = useState<string>("");
  const [filterMaxCpc, setFilterMaxCpc] = useState<string>("");
  const [filterMinImpressions, setFilterMinImpressions] = useState<string>("");
  const [filterMaxImpressions, setFilterMaxImpressions] = useState<string>("");
  const [filterMinBudget, setFilterMinBudget] = useState<string>("");
  const [filterMaxBudget, setFilterMaxBudget] = useState<string>("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  // 添加广告活动对话框排序状态
  type DialogSortField = 'campaignName' | 'campaignType' | 'impressions' | 'clicks' | 'spend' | 'sales' | 'orders' | 'acos' | 'roas' | 'cpc' | 'ctr' | 'cvr' | 'dailyBudget';
  const [dialogSortField, setDialogSortField] = useState<DialogSortField | null>(null);
  const [dialogSortDirection, setDialogSortDirection] = useState<'asc' | 'desc'>('desc');

  // 广告活动管理表格排序状态
  const [campaignSortField, setCampaignSortField] = useState<DialogSortField | null>(null);
  const [campaignSortDirection, setCampaignSortDirection] = useState<'asc' | 'desc'>('desc');

  // 对话框关闭时清空选择和筛选条件
  useEffect(() => {
    if (!showAddCampaignsDialog) {
      setSelectedCampaigns([]);
      setSearchQuery("");
      setFilterCampaignType("all");
      setFilterBiddingStrategy("all");
      setFilterState("all");
      setFilterMinSpend("");
      setFilterMaxSpend("");
      setFilterMinAcos("");
      setFilterMaxAcos("");
      setFilterMinOrders("");
      setFilterMaxOrders("");
      setFilterMinRoas("");
      setFilterMaxRoas("");
      setFilterMinClicks("");
      setFilterMaxClicks("");
      setFilterMinCpc("");
      setFilterMaxCpc("");
      setFilterMinImpressions("");
      setFilterMaxImpressions("");
      setFilterMinBudget("");
      setFilterMaxBudget("");
      setShowAdvancedFilters(false);
      setDialogSortField(null);
      setDialogSortDirection('desc');
    }
  }, [showAddCampaignsDialog]);
  
  // 目标设置状态
  const [editingGoal, setEditingGoal] = useState({
    category: 'revenue',
    type: 'maximize_sales',
    targetValue: '',
    dailyBudget: '',
    maxBid: '',
    strategyTemplateName: '',
    autoOptimize: true,
  });

  // 获取绩效组详情
  const { data: group, isLoading: groupLoading, refetch: refetchGroup } = trpc.performanceGroup.getById.useQuery(
    { id: groupId! },
    { enabled: !!groupId }
  );

  // 获取绩效组内的广告活动
  const { data: groupCampaigns, isLoading: campaignsLoading, refetch: refetchCampaigns } = trpc.performanceGroup.getCampaigns.useQuery(
    { groupId: groupId! },
    { enabled: !!groupId }
  );

  // 获取可添加的广告活动（未加入任何绩效组的）
  const { data: availableCampaigns, isLoading: availableLoading } = trpc.campaign.listUnassigned.useQuery(
    { accountId: group?.accountId },
    { enabled: !!group?.accountId && showAddCampaignsDialog }
  );

  // 获取绩效组KPI汇总
  const { data: kpiSummary, isLoading: kpiLoading } = trpc.performanceGroup.getKpiSummary.useQuery(
    { groupId: groupId! },
    { enabled: !!groupId }
  );

  // 添加广告活动到绩效组
  const addCampaignsMutation = trpc.performanceGroup.addCampaigns.useMutation({
    onSuccess: () => {
      toast.success("广告活动已添加到绩效组");
      setShowAddCampaignsDialog(false);
      setSelectedCampaigns([]);
      refetchCampaigns();
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`添加失败: ${error.message}`);
    },
  });

  // 从绩效组移除广告活动
  const removeCampaignMutation = trpc.performanceGroup.removeCampaign.useMutation({
    onSuccess: () => {
      toast.success("广告活动已从绩效组移除");
      refetchCampaigns();
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`移除失败: ${error.message}`);
    },
  });

  // 更新绩效组目标
  const updateGoalMutation = trpc.performanceGroup.updateGoal.useMutation({
    onSuccess: () => {
      toast.success("优化目标已更新");
      setShowEditGoalDialog(false);
      refetchGroup();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 获取绩效趋势数据
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const { data: trendData, isLoading: trendLoading } = trpc.performanceGroup.getTrendData.useQuery(
    { performanceGroupId: groupId!, days },
    { enabled: !!groupId }
  );
  
  const performanceTrendData = trendData || [];
  
  // 计算趋势预测
  const trendPrediction = useMemo(() => {
    if (performanceTrendData.length < 3) return null;
    
    // 预测花费趋势
    const spendData = performanceTrendData.map(d => ({ date: d.date, value: d.spend || 0 }));
    const spendPrediction = predictFutureDays(spendData, 7);
    const spendTrend = predictTrend(spendData);
    
    // 预测销售额趋势
    const salesData = performanceTrendData.map(d => ({ date: d.date, value: d.sales || 0 }));
    const salesPrediction = predictFutureDays(salesData, 7);
    const salesTrend = predictTrend(salesData);
    
    // 检测季节性
    const seasonality = detectSeasonality(spendData);
    
    return {
      spend: { prediction: spendPrediction, trend: spendTrend },
      sales: { prediction: salesPrediction, trend: salesTrend },
      seasonality
    };
  }, [performanceTrendData]);
  
  // 合并历史数据和预测数据用于图表显示
  const chartData = useMemo(() => {
    if (!showPrediction || !trendPrediction) {
      return performanceTrendData;
    }
    
    // 添加预测数据点
    const predictionData = trendPrediction.spend.prediction.map((pred, i) => ({
      date: pred.date,
      spend: pred.predicted,
      sales: trendPrediction.sales.prediction[i]?.predicted || 0,
      acos: 0, // 预测的ACoS需要根据花费和销售额计算
      isPrediction: true
    }));
    
    return [...performanceTrendData, ...predictionData];
  }, [performanceTrendData, showPrediction, trendPrediction]);
  
  // 计算异常检测
  const anomalyDetection = useMemo(() => {
    if (performanceTrendData.length < 4) return null;
    
    // 检测花费异常
    const spendData = performanceTrendData.map(d => ({ date: d.date, value: d.spend || 0 }));
    const spendAnomalies = detectAnomaliesCombined(spendData);
    
    // 检测销售额异常
    const salesData = performanceTrendData.map(d => ({ date: d.date, value: d.sales || 0 }));
    const salesAnomalies = detectAnomaliesCombined(salesData);
    
    // 检测ACoS异常
    const acosData = performanceTrendData.map(d => ({ date: d.date, value: d.acos || 0 }));
    const acosAnomalies = detectAnomaliesCombined(acosData);
    
    // 生成报告
    const spendReport = generateAnomalyReport(spendAnomalies);
    const salesReport = generateAnomalyReport(salesAnomalies);
    const acosReport = generateAnomalyReport(acosAnomalies);
    
    return {
      spend: { anomalies: spendAnomalies, report: spendReport },
      sales: { anomalies: salesAnomalies, report: salesReport },
      acos: { anomalies: acosAnomalies, report: acosReport },
      totalAnomalies: spendAnomalies.length + salesAnomalies.length + acosAnomalies.length
    };
  }, [performanceTrendData]);
  
  // 标记异常数据点
  const chartDataWithAnomalies = useMemo(() => {
    if (!showAnomalies || !anomalyDetection) {
      return chartData;
    }
    
    // 创建异常日期集合
    const anomalyDates = new Set([
      ...anomalyDetection.spend.anomalies.map(a => a.date),
      ...anomalyDetection.sales.anomalies.map(a => a.date),
      ...anomalyDetection.acos.anomalies.map(a => a.date)
    ]);
    
    return chartData.map(d => ({
      ...d,
      isAnomaly: anomalyDates.has(d.date)
    }));
  }, [chartData, showAnomalies, anomalyDetection]);

  // 筛选可添加的广告活动
  const filteredAvailableCampaigns = useMemo(() => {
    if (!availableCampaigns) return [];
    
    return availableCampaigns.filter((c: any) => {
      // 搜索关键词筛选(支持模糊搜索)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = c.campaignName?.toLowerCase() || '';
        if (!name.includes(query)) return false;
      }
      
      // 广告类型筛选
      if (filterCampaignType !== "all") {
        const type = c.campaignType?.toLowerCase() || '';
        if (filterCampaignType === "sp" && !type.includes('sp')) return false;
        if (filterCampaignType === "sb" && !type.includes('sb')) return false;
        if (filterCampaignType === "sd" && !type.includes('sd')) return false;
      }
      
      // 计费方式筛选
      if (filterBiddingStrategy !== "all") {
        const type = c.campaignType?.toLowerCase() || '';
        if (filterBiddingStrategy === "manual" && !type.includes('manual')) return false;
        if (filterBiddingStrategy === "auto" && !type.includes('auto')) return false;
      }
      
      // 运行状态筛选
      if (filterState !== "all") {
        const state = c.state?.toLowerCase() || '';
        if (state !== filterState) return false;
      }
      
      // 花费范围筛选
      const spend = Number(c.spend || 0);
      if (filterMinSpend && spend < Number(filterMinSpend)) return false;
      if (filterMaxSpend && spend > Number(filterMaxSpend)) return false;
      
      // ACoS范围筛选
      const sales = Number(c.sales || 0);
      const acos = sales > 0 ? (spend / sales) * 100 : 0;
      if (filterMinAcos && acos < Number(filterMinAcos)) return false;
      if (filterMaxAcos && acos > Number(filterMaxAcos)) return false;
      
      // 订单数量筛选
      const orders = Number(c.orders || 0);
      if (filterMinOrders && orders < Number(filterMinOrders)) return false;
      if (filterMaxOrders && orders > Number(filterMaxOrders)) return false;
      
      // ROAS筛选
      const roas = spend > 0 ? sales / spend : 0;
      if (filterMinRoas && roas < Number(filterMinRoas)) return false;
      if (filterMaxRoas && roas > Number(filterMaxRoas)) return false;
      
      // 点击数筛选
      const clicks = Number(c.clicks || 0);
      if (filterMinClicks && clicks < Number(filterMinClicks)) return false;
      if (filterMaxClicks && clicks > Number(filterMaxClicks)) return false;
      
      // CPC筛选
      const cpc = clicks > 0 ? spend / clicks : 0;
      if (filterMinCpc && cpc < Number(filterMinCpc)) return false;
      if (filterMaxCpc && cpc > Number(filterMaxCpc)) return false;
      
      // 曝光数筛选
      const impressions = Number(c.impressions || 0);
      if (filterMinImpressions && impressions < Number(filterMinImpressions)) return false;
      if (filterMaxImpressions && impressions > Number(filterMaxImpressions)) return false;
      
      // 日预算筛选
      const budget = Number(c.dailyBudget || 0);
      if (filterMinBudget && budget < Number(filterMinBudget)) return false;
      if (filterMaxBudget && budget > Number(filterMaxBudget)) return false;
      
      return true;
    });
  }, [availableCampaigns, searchQuery, filterCampaignType, filterBiddingStrategy, filterState, filterMinSpend, filterMaxSpend, filterMinAcos, filterMaxAcos, filterMinOrders, filterMaxOrders, filterMinRoas, filterMaxRoas, filterMinClicks, filterMaxClicks, filterMinCpc, filterMaxCpc, filterMinImpressions, filterMaxImpressions, filterMinBudget, filterMaxBudget]);

  // 计算广告活动的排序值
  const getCampaignSortValue = (campaign: any, field: DialogSortField): number | string => {
    const spend = Number(campaign.spend || 0);
    const sales = Number(campaign.sales || 0);
    const clicks = Number(campaign.clicks || 0);
    const impressions = Number(campaign.impressions || 0);
    const orders = Number(campaign.orders || 0);
    switch (field) {
      case 'campaignName': return (campaign.campaignName || '').toLowerCase();
      case 'campaignType': return campaign.campaignType || '';
      case 'impressions': return impressions;
      case 'clicks': return clicks;
      case 'spend': return spend;
      case 'sales': return sales;
      case 'orders': return orders;
      case 'acos': return sales > 0 ? (spend / sales) * 100 : 0;
      case 'roas': return spend > 0 ? sales / spend : 0;
      case 'cpc': return clicks > 0 ? spend / clicks : 0;
      case 'ctr': return impressions > 0 ? (clicks / impressions) * 100 : 0;
      case 'cvr': return clicks > 0 ? (orders / clicks) * 100 : 0;
      case 'dailyBudget': return Number(campaign.dailyBudget || 0);
      default: return 0;
    }
  };

  // 对话框排序后的广告活动列表
  const sortedFilteredAvailableCampaigns = useMemo(() => {
    if (!dialogSortField) return filteredAvailableCampaigns;
    return [...filteredAvailableCampaigns].sort((a: any, b: any) => {
      const aVal = getCampaignSortValue(a, dialogSortField);
      const bVal = getCampaignSortValue(b, dialogSortField);
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return dialogSortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return dialogSortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [filteredAvailableCampaigns, dialogSortField, dialogSortDirection]);

  // 广告活动管理表格排序后的数据
  const sortedGroupCampaigns = useMemo(() => {
    if (!groupCampaigns || !campaignSortField) return groupCampaigns || [];
    return [...groupCampaigns].sort((a: any, b: any) => {
      const aVal = getCampaignSortValue(a, campaignSortField);
      const bVal = getCampaignSortValue(b, campaignSortField);
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return campaignSortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return campaignSortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [groupCampaigns, campaignSortField, campaignSortDirection]);

  // 排序处理函数
  const handleDialogSort = (field: DialogSortField) => {
    if (dialogSortField === field) {
      setDialogSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setDialogSortField(field);
      setDialogSortDirection('desc');
    }
  };

  const handleCampaignSort = (field: DialogSortField) => {
    if (campaignSortField === field) {
      setCampaignSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setCampaignSortField(field);
      setCampaignSortDirection('desc');
    }
  };

  // 获取排序图标
  const getDialogSortIcon = (field: DialogSortField) => {
    if (dialogSortField !== field) return <ArrowUpDown className="w-3 h-3 ml-0.5 opacity-40" />;
    return dialogSortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-0.5 text-primary" /> : <ArrowDown className="w-3 h-3 ml-0.5 text-primary" />;
  };

  const getCampaignSortIcon = (field: DialogSortField) => {
    if (campaignSortField !== field) return <ArrowUpDown className="w-3 h-3 ml-0.5 opacity-40" />;
    return campaignSortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-0.5 text-primary" /> : <ArrowDown className="w-3 h-3 ml-0.5 text-primary" />;
  };

  // 修复选中计数：只统计当前筛选结果中的选中项
  const visibleSelectedCount = useMemo(() => {
    const filteredIds = new Set(filteredAvailableCampaigns.map((c: any) => c.id));
    return selectedCampaigns.filter(id => filteredIds.has(id)).length;
  }, [selectedCampaigns, filteredAvailableCampaigns]);

  // 处理添加广告活动
  const handleAddCampaigns = () => {
    if (selectedCampaigns.length === 0) {
      toast.error("请选择要添加的广告活动");
      return;
    }
    addCampaignsMutation.mutate({
      groupId: groupId!,
      campaignIds: selectedCampaigns,
    });
  };

  // 处理移除广告活动
  const handleRemoveCampaign = (campaignId: number) => {
    removeCampaignMutation.mutate({
      groupId: groupId!,
      campaignId,
    });
  };

  // 处理更新目标
  const handleUpdateGoal = () => {
    updateGoalMutation.mutate({
      groupId: groupId!,
      goalType: editingGoal.type,
      targetValue: editingGoal.targetValue ? parseFloat(editingGoal.targetValue) : undefined,
      dailyBudget: editingGoal.dailyBudget ? parseFloat(editingGoal.dailyBudget) : undefined,
      maxBid: editingGoal.maxBid ? parseFloat(editingGoal.maxBid) : undefined,
      strategyTemplateName: editingGoal.strategyTemplateName || undefined,
      autoOptimize: editingGoal.autoOptimize,
    });
  };

  // 打开编辑目标对话框
  const openEditGoalDialog = () => {
    if (group) {
      setEditingGoal({
        category: 'revenue',
        type: group.optimizationGoal || 'maximize_sales',
        targetValue: group.targetAcos?.toString() || group.targetRoas?.toString() || '',
        dailyBudget: group.dailyBudget?.toString() || '',
        maxBid: group.maxBid?.toString() || '',
        strategyTemplateName: (group as any).strategyTemplateName || '',
        autoOptimize: (group as any).autoOptimize !== 0 && (group as any).autoOptimize !== false,
      });
    }
    setShowEditGoalDialog(true);
  };

  if (groupLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!group) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertCircle className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground">绩效组不存在</p>
          <Button onClick={() => setLocation("/strategy-center")}>
            返回策略管理
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const goalTypeLabel = OPTIMIZATION_TYPES.find(t => t.value === group.optimizationGoal)?.label || '未设置';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 顶部导航和标题 */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/strategy-center")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <p className="text-muted-foreground">
              {group.name} | {groupCampaigns?.length || 0} 个广告活动
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={group.status === 'active' ? 'default' : 'secondary'}>
              {group.status === 'active' ? '优化中' : '已暂停'}
            </Badge>
            <Button variant="outline" size="sm" onClick={openEditGoalDialog}>
              <Settings className="w-4 h-4 mr-2" />
              编辑目标
            </Button>
          </div>
        </div>

        {/* KPI概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>目标类型</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                {goalTypeLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {group.optimizationGoal === 'target_acos' && (
                <p className="text-sm text-muted-foreground">目标ACoS: {group.targetAcos}%</p>
              )}
              {group.optimizationGoal === 'target_roas' && (
                <p className="text-sm text-muted-foreground">目标ROAS: {group.targetRoas}x</p>
              )}
              {group.optimizationGoal === 'maximize_sales' && (
                <p className="text-sm text-muted-foreground">每日预算: ${group.dailyBudget || '-'}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>30天花费</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-orange-500" />
                ${kpiSummary?.totalSpend?.toFixed(2) || '0.00'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                日均: ${((kpiSummary?.totalSpend || 0) / 30).toFixed(2)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>30天销售额</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                ${kpiSummary?.totalRevenue?.toFixed(2) || '0.00'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                转化: {kpiSummary?.totalConversions || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>实际ACoS</CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                <Percent className="w-5 h-5 text-blue-500" />
                {Number(kpiSummary?.acos)?.toFixed(2) || '0.00'}%
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                ROAS: {kpiSummary?.roas?.toFixed(2) || '0.00'}x
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 主要内容区域 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="campaigns">广告活动 ({groupCampaigns?.length || 0})</TabsTrigger>
            <TabsTrigger value="logs">优化日志</TabsTrigger>
            <TabsTrigger value="scenario">场景模拟</TabsTrigger>
          </TabsList>

          {/* 概览Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 目标设置卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    优化目标设置
                  </CardTitle>
                  <CardDescription>当前绩效组的优化目标和参数</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">优化类型</span>
                    <span className="font-medium">{goalTypeLabel}</span>
                  </div>
                  {group.targetAcos && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">目标ACoS</span>
                      <span className="font-medium">{group.targetAcos}%</span>
                    </div>
                  )}
                  {group.targetRoas && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">目标ROAS</span>
                      <span className="font-medium">{group.targetRoas}x</span>
                    </div>
                  )}
                  {group.dailyBudget && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">每日费用上限</span>
                      <span className="font-medium">${group.dailyBudget}</span>
                    </div>
                  )}
                  {group.maxBid && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-muted-foreground">最高出价</span>
                      <span className="font-medium">${group.maxBid}</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">策略模板</span>
                    <span className="font-medium">
                      {group.strategyTemplateName || <span className="text-yellow-500">未关联</span>}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">自动优化</span>
                    <Badge variant={group.status === 'active' ? 'default' : 'secondary'}>
                      {group.status === 'active' ? '✅ 已开启' : '⛔ 已关闭'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">优化模块</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      <Badge variant="outline" className="text-xs">出价优化</Badge>
                      <Badge variant="outline" className="text-xs">位置优化</Badge>
                      <Badge variant="outline" className="text-xs">分时竞价</Badge>
                      <Badge variant="outline" className="text-xs">搜索词分析</Badge>
                      <Badge variant="outline" className="text-xs">预算分配</Badge>
                    </div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={openEditGoalDialog}>
                    <Settings className="w-4 h-4 mr-2" />
                    编辑目标
                  </Button>
                </CardContent>
              </Card>

              {/* 绩效趋势卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    绩效趋势
                  </CardTitle>
                  <CardDescription>过去30天的绩效变化</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* 关键指标卡片 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="text-xs text-muted-foreground mb-1">花费</div>
                        <div className="text-lg font-bold">${parseFloat(group.totalSpend || '0').toFixed(2)}</div>
                        <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
                          <TrendingUp className="w-3 h-3" />
                          +12.5%
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="text-xs text-muted-foreground mb-1">销售额</div>
                        <div className="text-lg font-bold">${parseFloat(group.totalSales || '0').toFixed(2)}</div>
                        <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
                          <TrendingUp className="w-3 h-3" />
                          +8.3%
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="text-xs text-muted-foreground mb-1">ACoS</div>
                        <div className="text-lg font-bold">{group.currentAcos ? `${parseFloat(group.currentAcos).toFixed(1)}%` : '-'}</div>
                        <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
                          <TrendingUp className="w-3 h-3" />
                          -2.1%
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="text-xs text-muted-foreground mb-1">转化数</div>
                        <div className="text-lg font-bold">{group.totalOrders || 0}</div>
                        <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
                          <TrendingUp className="w-3 h-3" />
                          +15.7%
                        </div>
                      </div>
                    </div>
                    
                    {/* 图表类型和时间范围选择器 */}
                    <div className="flex items-center gap-2 justify-between flex-wrap">
                      <div className="flex items-center gap-2">
                        <Select value={chartType} onValueChange={(v: any) => setChartType(v)}>
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="line">折线图</SelectItem>
                            <SelectItem value="bar">柱状图</SelectItem>
                            <SelectItem value="area">面积图</SelectItem>
                            <SelectItem value="composed">组合图</SelectItem>
                            <SelectItem value="pie">饼图</SelectItem>
                            <SelectItem value="radar">雷达图</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        {/* 趋势预测开关 */}
                        {trendPrediction && chartType !== 'pie' && chartType !== 'radar' && (
                          <div className="flex items-center gap-2">
                            <Checkbox 
                              id="show-prediction" 
                              checked={showPrediction}
                              onCheckedChange={(checked) => setShowPrediction(!!checked)}
                            />
                            <Label htmlFor="show-prediction" className="text-sm cursor-pointer">
                              显示预测
                            </Label>
                          </div>
                        )}
                        
                        {/* 异常检测开关 */}
                        {anomalyDetection && chartType !== 'pie' && chartType !== 'radar' && (
                          <div className="flex items-center gap-2">
                            <Checkbox 
                              id="show-anomalies" 
                              checked={showAnomalies}
                              onCheckedChange={(checked) => setShowAnomalies(!!checked)}
                            />
                            <Label htmlFor="show-anomalies" className="text-sm cursor-pointer">
                              显示异常
                            </Label>
                            {anomalyDetection.totalAnomalies > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {anomalyDetection.totalAnomalies}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Select 
                          value="" 
                          onValueChange={(format) => {
                            if (format === 'csv') {
                              // 导出CSV
                              const csvContent = [
                                ['日期', '花费($)', '销售额($)', 'ACoS(%)', '转化数'],
                                ...performanceTrendData.map(d => [
                                  d.date,
                                  d.spend,
                                  d.sales,
                                  d.acos,
                                  d.orders || 0
                                ])
                              ].map(row => row.join(',')).join('\n');
                              
                              const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
                              const link = document.createElement('a');
                              link.href = URL.createObjectURL(blob);
                              link.download = `绩效趋势_${group?.name}_${timeRange}.csv`;
                              link.click();
                              toast.success('CSV已导出');
                            } else if (format === 'excel') {
                              // 导出Excel
                              const ws = XLSX.utils.json_to_sheet(performanceTrendData.map(d => ({
                                '日期': d.date,
                                '花费($)': d.spend,
                                '销售额($)': d.sales,
                                'ACoS(%)': d.acos,
                                '转化数': d.orders || 0,
                                '点击数': d.clicks || 0,
                                '展示数': d.impressions || 0
                              })));
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, '绩效趋势');
                              XLSX.writeFile(wb, `绩效趋势_${group?.name}_${timeRange}.xlsx`);
                              toast.success('Excel已导出');
                            } else if (format === 'pdf') {
                              // 导出PDF (包含图表)
                              const chartElement = document.querySelector('.h-64') as HTMLElement;
                              if (chartElement) {
                                html2canvas(chartElement, { scale: 2 }).then(canvas => {
                                  const imgData = canvas.toDataURL('image/png');
                                  const pdf = new jsPDF('l', 'mm', 'a4');
                                  const imgWidth = 280;
                                  const imgHeight = (canvas.height * imgWidth) / canvas.width;
                                  pdf.text(`绩效趋势 - ${group?.name}`, 10, 10);
                                  pdf.addImage(imgData, 'PNG', 10, 20, imgWidth, imgHeight);
                                  pdf.save(`绩效趋势_${group?.name}_${timeRange}.pdf`);
                                  toast.success('PDF已导出');
                                });
                              }
                            }
                          }}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="导出数据" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="csv">导出CSV</SelectItem>
                            <SelectItem value="excel">导出Excel</SelectItem>
                            <SelectItem value="pdf">导出PDF</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={timeRange} onValueChange={setTimeRange}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7d">过去7天</SelectItem>
                          <SelectItem value="30d">过去30天</SelectItem>
                          <SelectItem value="90d">过去90天</SelectItem>
                        </SelectContent>
                      </Select>
                      </div>
                    </div>
                    
                    {/* 绩效趋势图表 */}
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'line' ? (
                          <LineChart data={chartDataWithAnomalies}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis 
                            dataKey="date" 
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="left"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
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
                          <Line 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="spend" 
                            stroke="#8b5cf6" 
                            strokeWidth={2}
                            name="花费 ($)"
                            dot={{ fill: '#8b5cf6' }}
                          />
                          <Line 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="sales" 
                            stroke="#10b981" 
                            strokeWidth={2}
                            name="销售额 ($)"
                            dot={{ fill: '#10b981' }}
                          />
                          <Line 
                            yAxisId="right"
                            type="monotone" 
                            dataKey="acos" 
                            stroke="#f59e0b" 
                            strokeWidth={2}
                            name="ACoS (%)"
                            dot={{ fill: '#f59e0b' }}
                          />
                        </LineChart>
                        ) : chartType === 'bar' ? (
                          <BarChart data={chartDataWithAnomalies}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis 
                            dataKey="date" 
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="left"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
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
                          <Bar 
                            yAxisId="left"
                            dataKey="spend" 
                            fill="#8b5cf6" 
                            name="花费 ($)"
                          />
                          <Bar 
                            yAxisId="left"
                            dataKey="sales" 
                            fill="#10b981" 
                            name="销售额 ($)"
                          />
                        </BarChart>
                        ) : chartType === 'area' ? (
                          <AreaChart data={chartDataWithAnomalies}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis 
                            dataKey="date" 
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="left"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
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
                          <Area 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="spend" 
                            fill="#8b5cf6" 
                            stroke="#8b5cf6"
                            fillOpacity={0.6}
                            name="花费 ($)"
                          />
                          <Area 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="sales" 
                            fill="#10b981" 
                            stroke="#10b981"
                            fillOpacity={0.6}
                            name="销售额 ($)"
                          />
                          <Area 
                            yAxisId="right"
                            type="monotone" 
                            dataKey="acos" 
                            fill="#f59e0b" 
                            stroke="#f59e0b"
                            fillOpacity={0.6}
                            name="ACoS (%)"
                          />
                        </AreaChart>
                        ) : chartType === 'pie' ? (
                          <PieChart>
                            <Pie
                              data={[
                                { name: '花费', value: performanceTrendData.reduce((sum, d) => sum + (d.spend || 0), 0), fill: '#8b5cf6' },
                                { name: '销售额', value: performanceTrendData.reduce((sum, d) => sum + (d.sales || 0), 0), fill: '#10b981' },
                              ]}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                              outerRadius={80}
                              dataKey="value"
                            >
                              {[
                                { name: '花费', value: performanceTrendData.reduce((sum, d) => sum + (d.spend || 0), 0), fill: '#8b5cf6' },
                                { name: '销售额', value: performanceTrendData.reduce((sum, d) => sum + (d.sales || 0), 0), fill: '#10b981' },
                              ].map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                          </PieChart>
                        ) : chartType === 'radar' ? (
                          <RadarChart data={performanceTrendData.slice(-7)}>
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis 
                              dataKey="date" 
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                            />
                            <PolarRadiusAxis 
                              angle={90} 
                              tick={{ fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <Radar 
                              name="花费 ($)" 
                              dataKey="spend" 
                              stroke="#8b5cf6" 
                              fill="#8b5cf6" 
                              fillOpacity={0.5}
                            />
                            <Radar 
                              name="销售额 ($)" 
                              dataKey="sales" 
                              stroke="#10b981" 
                              fill="#10b981" 
                              fillOpacity={0.5}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                          </RadarChart>
                        ) : (
                          <ComposedChart data={chartDataWithAnomalies}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis 
                            dataKey="date" 
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="left"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
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
                          <Bar 
                            yAxisId="left"
                            dataKey="spend" 
                            fill="#8b5cf6" 
                            name="花费 ($)"
                          />
                          <Bar 
                            yAxisId="left"
                            dataKey="sales" 
                            fill="#10b981" 
                            name="销售额 ($)"
                          />
                          <Line 
                            yAxisId="right"
                            type="monotone" 
                            dataKey="acos" 
                            stroke="#f59e0b" 
                            strokeWidth={2}
                            name="ACoS (%)"
                            dot={{ fill: '#f59e0b' }}
                          />
                        </ComposedChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 广告活动Tab */}
          <TabsContent value="campaigns" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>广告活动管理</CardTitle>
                    <CardDescription>
                      管理绩效组内的广告活动，加入的广告活动将被算法自动优化
                    </CardDescription>
                  </div>
                  <Button onClick={() => setShowAddCampaignsDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    添加广告活动
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {campaignsLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : groupCampaigns && groupCampaigns.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">状态</th>
                          <th className="text-left p-3 font-medium min-w-[200px]">
                            <button className="flex items-center hover:text-primary transition-colors" onClick={() => handleCampaignSort('campaignName')}>广告活动名称{getCampaignSortIcon('campaignName')}</button>
                          </th>
                          <th className="text-left p-3 font-medium">
                            <button className="flex items-center hover:text-primary transition-colors" onClick={() => handleCampaignSort('campaignType')}>类型{getCampaignSortIcon('campaignType')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('impressions')}>曝光{getCampaignSortIcon('impressions')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('clicks')}>点击{getCampaignSortIcon('clicks')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('spend')}>花费{getCampaignSortIcon('spend')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('sales')}>销售额{getCampaignSortIcon('sales')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('orders')}>订单{getCampaignSortIcon('orders')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('acos')}>ACoS{getCampaignSortIcon('acos')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('roas')}>ROAS{getCampaignSortIcon('roas')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('ctr')}>CTR{getCampaignSortIcon('ctr')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('cvr')}>CVR{getCampaignSortIcon('cvr')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('cpc')}>CPC{getCampaignSortIcon('cpc')}</button>
                          </th>
                          <th className="text-right p-3 font-medium">
                            <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleCampaignSort('dailyBudget')}>日预算{getCampaignSortIcon('dailyBudget')}</button>
                          </th>
                          <th className="text-center p-3 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedGroupCampaigns.map((campaign: any) => {
                          const spend = Number(campaign.spend || 0);
                          const sales = Number(campaign.sales || 0);
                          const clicks = Number(campaign.clicks || 0);
                          const impressions = Number(campaign.impressions || 0);
                          const orders = Number(campaign.orders || 0);
                          const acos = sales > 0 ? (spend / sales) * 100 : 0;
                          const roas = spend > 0 ? sales / spend : 0;
                          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                          const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
                          const cpc = clicks > 0 ? spend / clicks : 0;
                          return (
                            <tr key={campaign.id} className="border-b hover:bg-muted/30 transition-colors">
                              <td className="p-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${campaign.campaignStatus === 'enabled' ? 'bg-green-500' : campaign.campaignStatus === 'paused' ? 'bg-yellow-500' : 'bg-gray-400'}`} title={campaign.campaignStatus === 'enabled' ? '已启用' : campaign.campaignStatus === 'paused' ? '已暂停' : '已归档'} />
                              </td>
                              <td className="p-3">
                                <p className="font-medium text-sm truncate max-w-[280px]" title={campaign.campaignName}>{campaign.campaignName}</p>
                              </td>
                              <td className="p-3">
                                <Badge variant="outline" className="text-xs">{campaign.campaignType}</Badge>
                              </td>
                              <td className="p-3 text-right tabular-nums">{impressions.toLocaleString()}</td>
                              <td className="p-3 text-right tabular-nums">{clicks.toLocaleString()}</td>
                              <td className="p-3 text-right tabular-nums">${spend.toFixed(2)}</td>
                              <td className="p-3 text-right tabular-nums">${sales.toFixed(2)}</td>
                              <td className="p-3 text-right tabular-nums">{orders}</td>
                              <td className="p-3 text-right tabular-nums">
                                <span className={acos > 50 ? 'text-red-500' : acos > 30 ? 'text-yellow-500' : 'text-green-500'}>
                                  {acos.toFixed(1)}%
                                </span>
                              </td>
                              <td className="p-3 text-right tabular-nums">{roas.toFixed(2)}x</td>
                              <td className="p-3 text-right tabular-nums">{ctr.toFixed(2)}%</td>
                              <td className="p-3 text-right tabular-nums">{cvr.toFixed(1)}%</td>
                              <td className="p-3 text-right tabular-nums">${cpc.toFixed(2)}</td>
                              <td className="p-3 text-right tabular-nums">${Number(campaign.dailyBudget || 0).toFixed(2)}</td>
                              <td className="p-3 text-center">
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => handleRemoveCampaign(campaign.id)}
                                  title="从绩效组移除"
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 bg-muted/30 font-medium">
                          <td className="p-3" colSpan={3}>合计 ({groupCampaigns.length} 个广告活动)</td>
                          <td className="p-3 text-right tabular-nums">{groupCampaigns.reduce((s: number, c: any) => s + Number(c.impressions || 0), 0).toLocaleString()}</td>
                          <td className="p-3 text-right tabular-nums">{groupCampaigns.reduce((s: number, c: any) => s + Number(c.clicks || 0), 0).toLocaleString()}</td>
                          <td className="p-3 text-right tabular-nums">${groupCampaigns.reduce((s: number, c: any) => s + Number(c.spend || 0), 0).toFixed(2)}</td>
                          <td className="p-3 text-right tabular-nums">${groupCampaigns.reduce((s: number, c: any) => s + Number(c.sales || 0), 0).toFixed(2)}</td>
                          <td className="p-3 text-right tabular-nums">{groupCampaigns.reduce((s: number, c: any) => s + Number(c.orders || 0), 0)}</td>
                          <td className="p-3 text-right tabular-nums">
                            {(() => { const ts = groupCampaigns.reduce((s: number, c: any) => s + Number(c.spend || 0), 0); const tr = groupCampaigns.reduce((s: number, c: any) => s + Number(c.sales || 0), 0); return tr > 0 ? ((ts/tr)*100).toFixed(1) + '%' : '-'; })()}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {(() => { const ts = groupCampaigns.reduce((s: number, c: any) => s + Number(c.spend || 0), 0); const tr = groupCampaigns.reduce((s: number, c: any) => s + Number(c.sales || 0), 0); return ts > 0 ? (tr/ts).toFixed(2) + 'x' : '-'; })()}
                          </td>
                          <td className="p-3" colSpan={4}></td>
                          <td className="p-3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mb-2" />
                    <p>暂无广告活动</p>
                    <p className="text-sm">点击"添加广告活动"将广告活动加入此绩效组</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 优化日志Tab */}
          <TabsContent value="logs" className="space-y-4">
            <OptimizationLogs 
              performanceGroupId={groupId!} 
              performanceGroupName={group.name}
            />
          </TabsContent>

          {/* 场景模拟Tab */}
          <TabsContent value="scenario" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  场景模拟预测
                </CardTitle>
                <CardDescription>
                  基于历史数据预测不同花费水平下的预期效果
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 预测曲线图 */}
                  <div className="h-64 border rounded-lg flex items-center justify-center text-muted-foreground">
                    <BarChart3 className="w-8 h-8 mr-2" />
                    花费-销售额预测曲线开发中...
                  </div>
                  
                  {/* 预测指标卡片 */}
                  <div className="space-y-4">
                    <h4 className="font-medium">预测指标</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测点击数</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测转化数</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测CPC</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测ACoS</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测ROAS</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">预测销售额</p>
                        <p className="text-lg font-medium">--</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      * 预测基于历史数据计算，实际结果可能因市场竞争等因素而有所不同
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 添加广告活动对话框 */}
        <Dialog open={showAddCampaignsDialog} onOpenChange={setShowAddCampaignsDialog}>
          <DialogContent className="!max-w-[95vw] !w-[95vw] !h-[90vh] !max-h-[90vh] !translate-x-[-50%] !translate-y-[-50%] flex flex-col p-0 gap-0 overflow-hidden">
            {/* 头部区域 */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold">添加广告活动到绩效组</h2>
                <p className="text-sm text-muted-foreground mt-1">选择要添加到“{group.name}”的广告活动</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  可选: <span className="font-medium text-foreground">{filteredAvailableCampaigns.length}</span>个 | 已选: <span className="font-medium text-primary">{visibleSelectedCount}</span>个
                </p>
              </div>
            </div>
            
            {/* 筛选区域 */}
            <div className="px-6 py-3 border-b flex-shrink-0 space-y-2 bg-muted/20">
              {/* 第一行：基本筛选 + 搜索 */}
              <div className="flex items-center gap-2">
                <Select value={filterCampaignType} onValueChange={setFilterCampaignType}>
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue placeholder="广告类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="sp">SP广告</SelectItem>
                    <SelectItem value="sb">SB广告</SelectItem>
                    <SelectItem value="sd">SD广告</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={filterBiddingStrategy} onValueChange={setFilterBiddingStrategy}>
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue placeholder="计费方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部方式</SelectItem>
                    <SelectItem value="manual">手动竞价</SelectItem>
                    <SelectItem value="auto">自动竞价</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={filterState} onValueChange={setFilterState}>
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue placeholder="运行状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="enabled">已启用</SelectItem>
                    <SelectItem value="paused">已暂停</SelectItem>
                    <SelectItem value="archived">已归档</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex-1 relative">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input 
                    placeholder="搜索广告活动名称..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8"
                  />
                </div>

                <Button 
                  variant={showAdvancedFilters ? "secondary" : "outline"}
                  size="sm" 
                  className="h-8 gap-1"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                >
                  <Filter className="w-3.5 h-3.5" />
                  高级筛选
                  {showAdvancedFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>
              </div>
              
              {/* 高级筛选区域 */}
              {showAdvancedFilters && (
                <div className="grid grid-cols-6 gap-x-3 gap-y-2 pt-2 border-t">
                  {/* 花费范围 */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">花费 ($)</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinSpend} onChange={(e) => setFilterMinSpend(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxSpend} onChange={(e) => setFilterMaxSpend(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* 订单数量 */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">订单数</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinOrders} onChange={(e) => setFilterMinOrders(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxOrders} onChange={(e) => setFilterMaxOrders(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* ACoS */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">ACoS (%)</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinAcos} onChange={(e) => setFilterMinAcos(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxAcos} onChange={(e) => setFilterMaxAcos(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* ROAS */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">ROAS</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinRoas} onChange={(e) => setFilterMinRoas(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxRoas} onChange={(e) => setFilterMaxRoas(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* 点击数 */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">点击数</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinClicks} onChange={(e) => setFilterMinClicks(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxClicks} onChange={(e) => setFilterMaxClicks(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* CPC */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">CPC ($)</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinCpc} onChange={(e) => setFilterMinCpc(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxCpc} onChange={(e) => setFilterMaxCpc(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* 曝光数 */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">曝光数</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinImpressions} onChange={(e) => setFilterMinImpressions(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxImpressions} onChange={(e) => setFilterMaxImpressions(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* 日预算 */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">日预算 ($)</label>
                    <div className="flex gap-1">
                      <Input placeholder="最小" value={filterMinBudget} onChange={(e) => setFilterMinBudget(e.target.value)} type="number" className="h-7 text-xs" />
                      <span className="text-muted-foreground self-center text-xs">-</span>
                      <Input placeholder="最大" value={filterMaxBudget} onChange={(e) => setFilterMaxBudget(e.target.value)} type="number" className="h-7 text-xs" />
                    </div>
                  </div>
                  {/* 清除筛选按钮 */}
                  <div className="flex items-end col-span-4">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setFilterMinSpend(""); setFilterMaxSpend("");
                        setFilterMinAcos(""); setFilterMaxAcos("");
                        setFilterMinOrders(""); setFilterMaxOrders("");
                        setFilterMinRoas(""); setFilterMaxRoas("");
                        setFilterMinClicks(""); setFilterMaxClicks("");
                        setFilterMinCpc(""); setFilterMaxCpc("");
                        setFilterMinImpressions(""); setFilterMaxImpressions("");
                        setFilterMinBudget(""); setFilterMaxBudget("");
                      }}
                    >
                      <X className="w-3 h-3" />
                      清除所有筛选
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* 表格区域 - 占据剩余空间 */}
            <div className="flex-1 min-h-0 overflow-auto">
              {availableLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : filteredAvailableCampaigns.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 w-8 sticky left-0 bg-muted/50 z-20">
                        <Checkbox
                          checked={filteredAvailableCampaigns.length > 0 && filteredAvailableCampaigns.every((c: any) => selectedCampaigns.includes(c.id))}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              // 全选：只选择当前筛选可见的广告活动
                              const allFilteredIds = filteredAvailableCampaigns.map((c: any) => c.id);
                              setSelectedCampaigns(allFilteredIds);
                            } else {
                              // 取消全选：清空所有选中
                              setSelectedCampaigns([]);
                            }
                          }}
                        />
                      </th>
                      <th className="text-left p-2 font-medium w-10">状态</th>
                      <th className="text-left p-2 font-medium min-w-[300px]">
                        <button className="flex items-center hover:text-primary transition-colors" onClick={() => handleDialogSort('campaignName')}>广告活动名称{getDialogSortIcon('campaignName')}</button>
                      </th>
                      <th className="text-left p-2 font-medium min-w-[80px]">
                        <button className="flex items-center hover:text-primary transition-colors" onClick={() => handleDialogSort('campaignType')}>类型{getDialogSortIcon('campaignType')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[70px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('impressions')}>曝光{getDialogSortIcon('impressions')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[60px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('clicks')}>点击{getDialogSortIcon('clicks')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[75px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('spend')}>花费{getDialogSortIcon('spend')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[75px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('sales')}>销售额{getDialogSortIcon('sales')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[50px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('orders')}>订单{getDialogSortIcon('orders')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[60px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('acos')}>ACoS{getDialogSortIcon('acos')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[60px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('roas')}>ROAS{getDialogSortIcon('roas')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[55px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('cpc')}>CPC{getDialogSortIcon('cpc')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[50px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('ctr')}>CTR{getDialogSortIcon('ctr')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[50px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('cvr')}>CVR{getDialogSortIcon('cvr')}</button>
                      </th>
                      <th className="text-right p-2 font-medium min-w-[70px]">
                        <button className="flex items-center justify-end w-full hover:text-primary transition-colors" onClick={() => handleDialogSort('dailyBudget')}>日预算{getDialogSortIcon('dailyBudget')}</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredAvailableCampaigns.map((campaign: any) => {
                        const spend = Number(campaign.spend || 0);
                        const sales = Number(campaign.sales || 0);
                        const clicks = Number(campaign.clicks || 0);
                        const impressions = Number(campaign.impressions || 0);
                        const orders = Number(campaign.orders || 0);
                        const acos = sales > 0 ? (spend / sales) * 100 : 0;
                        const roas = spend > 0 ? sales / spend : 0;
                        const cpc = clicks > 0 ? spend / clicks : 0;
                        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                        const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
                        const isSelected = selectedCampaigns.includes(campaign.id);
                      return (
                        <tr 
                          key={campaign.id} 
                          className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${isSelected ? 'bg-primary/10' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedCampaigns(prev => prev.filter(id => id !== campaign.id));
                            } else {
                              setSelectedCampaigns(prev => [...prev, campaign.id]);
                            }
                          }}
                        >
                          <td className="p-2 sticky left-0 bg-background z-10" onClick={(e) => e.stopPropagation()}>
                            <Checkbox 
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedCampaigns(prev => [...prev, campaign.id]);
                                } else {
                                  setSelectedCampaigns(prev => prev.filter(id => id !== campaign.id));
                                }
                              }}
                            />
                          </td>
                          <td className="p-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${campaign.campaignStatus === 'enabled' ? 'bg-green-500' : campaign.campaignStatus === 'paused' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                          </td>
                          <td className="p-2">
                            <p className="font-medium truncate max-w-[400px]" title={campaign.campaignName}>{campaign.campaignName}</p>
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-xs">{campaign.campaignType}</Badge>
                          </td>
                          <td className="p-2 text-right tabular-nums">{impressions.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">{clicks.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">${spend.toFixed(2)}</td>
                          <td className="p-2 text-right tabular-nums">${sales.toFixed(2)}</td>
                          <td className="p-2 text-right tabular-nums">{orders}</td>
                          <td className="p-2 text-right tabular-nums">
                            <span className={acos > 50 ? 'text-red-500' : acos > 30 ? 'text-yellow-500' : 'text-green-500'}>
                              {acos.toFixed(1)}%
                            </span>
                          </td>
                          <td className="p-2 text-right tabular-nums">{roas.toFixed(2)}x</td>
                          <td className="p-2 text-right tabular-nums">${cpc.toFixed(2)}</td>
                          <td className="p-2 text-right tabular-nums">{ctr.toFixed(2)}%</td>
                          <td className="p-2 text-right tabular-nums">{cvr.toFixed(1)}%</td>
                          <td className="p-2 text-right tabular-nums">${Number(campaign.dailyBudget || 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <p className="text-sm">没有可添加的广告活动</p>
                </div>
              )}
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0 bg-muted/20">
              <p className="text-sm text-muted-foreground">
                {visibleSelectedCount > 0 && `已选择 ${visibleSelectedCount} 个广告活动`}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowAddCampaignsDialog(false)}>
                  取消
                </Button>
                <Button 
                  onClick={() => {
                    console.log('Button clicked, selected:', selectedCampaigns);
                    handleAddCampaigns();
                  }}
                  disabled={visibleSelectedCount === 0 || addCampaignsMutation.isPending}
                >
                  {addCampaignsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {visibleSelectedCount > 0 ? `添加 ${visibleSelectedCount} 个广告活动` : '确认添加'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* 编辑目标对话框 */}
        <Dialog open={showEditGoalDialog} onOpenChange={setShowEditGoalDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>编辑优化目标</DialogTitle>
              <DialogDescription>
                设置优化目标的参数、策略模板和自动优化状态
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* 策略模板选择 */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  策略模板
                </Label>
                <Select 
                  value={editingGoal.strategyTemplateName || 'none'} 
                  onValueChange={(value) => {
                    const templateName = value === 'none' ? '' : value;
                    setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName }));
                    // 根据策略模板自动填充目标值
                    if (value === 'aggressive-growth') {
                      setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName, type: 'target_acos', targetValue: '40' }));
                    } else if (value === 'balanced') {
                      setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName, type: 'target_acos', targetValue: '25' }));
                    } else if (value === 'profit-focused') {
                      setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName, type: 'target_acos', targetValue: '15' }));
                    } else if (value === 'seasonal-boost') {
                      setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName, type: 'target_acos', targetValue: '35' }));
                    } else if (value === 'brand-defense') {
                      setEditingGoal(prev => ({ ...prev, strategyTemplateName: templateName, type: 'target_acos', targetValue: '10' }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择策略模板" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">自定义策略</SelectItem>
                    <SelectItem value="aggressive-growth">
                      <div className="flex items-center gap-2">
                        <span>🚀</span>
                        <span>激进增长</span>
                        <span className="text-xs text-muted-foreground">ACoS 40%</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="balanced">
                      <div className="flex items-center gap-2">
                        <span>🎯</span>
                        <span>平衡增长</span>
                        <span className="text-xs text-muted-foreground">ACoS 25% · 推荐</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="profit-focused">
                      <div className="flex items-center gap-2">
                        <span>🛡️</span>
                        <span>利润优先</span>
                        <span className="text-xs text-muted-foreground">ACoS 15%</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="seasonal-boost">
                      <div className="flex items-center gap-2">
                        <span>⚡</span>
                        <span>旺季冲刺</span>
                        <span className="text-xs text-muted-foreground">ACoS 35%</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="brand-defense">
                      <div className="flex items-center gap-2">
                        <span>⭐</span>
                        <span>品牌防御</span>
                        <span className="text-xs text-muted-foreground">ACoS 10%</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {editingGoal.strategyTemplateName && (
                  <p className="text-xs text-blue-400">
                    {`已选择策略模板，目标值已自动填充，您仍可以手动调整`}
                  </p>
                )}
              </div>

              {/* 自动优化开关 */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    自动优化引擎
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    启用后系统将自动调整竞价、预算和否定关键词
                  </p>
                </div>
                <div 
                  className={`relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors ${editingGoal.autoOptimize ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  onClick={() => setEditingGoal(prev => ({ ...prev, autoOptimize: !prev.autoOptimize }))}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingGoal.autoOptimize ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </div>

              <div className="border-t border-border/50 pt-4">
                <p className="text-sm font-medium mb-3">优化参数</p>
              </div>

              <div className="space-y-2">
                <Label>优化目标类型</Label>
                <Select 
                  value={editingGoal.type} 
                  onValueChange={(value) => setEditingGoal(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPTIMIZATION_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        <div>
                          <p>{type.label}</p>
                          <p className="text-xs text-muted-foreground">{type.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(editingGoal.type === 'target_acos' || editingGoal.type === 'target_roas' || editingGoal.type === 'target_cpa') && (
                <div className="space-y-2">
                  <Label>
                    {editingGoal.type === 'target_acos' ? '目标ACoS (%)' : 
                     editingGoal.type === 'target_roas' ? '目标ROAS (倍)' : '目标转化成本 ($)'}
                  </Label>
                  <Input 
                    type="number"
                    value={editingGoal.targetValue}
                    onChange={(e) => setEditingGoal(prev => ({ ...prev, targetValue: e.target.value }))}
                    placeholder={editingGoal.type === 'target_acos' ? '例如: 30' : 
                                editingGoal.type === 'target_roas' ? '例如: 3.0' : '例如: 15'}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>每日费用上限 ($)</Label>
                <Input 
                  type="number"
                  value={editingGoal.dailyBudget}
                  onChange={(e) => setEditingGoal(prev => ({ ...prev, dailyBudget: e.target.value }))}
                  placeholder="例如: 100"
                />
              </div>

              <div className="space-y-2">
                <Label>最高出价 ($)</Label>
                <Input 
                  type="number"
                  value={editingGoal.maxBid}
                  onChange={(e) => setEditingGoal(prev => ({ ...prev, maxBid: e.target.value }))}
                  placeholder="例如: 2.50"
                />
                <p className="text-xs text-muted-foreground">
                  限制单次点击的最高出价，防止出价过高
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditGoalDialog(false)}>
                取消
              </Button>
              <Button 
                onClick={handleUpdateGoal}
                disabled={updateGoalMutation.isPending}
              >
                {updateGoalMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
