import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import OperationConfirmDialog, { useOperationConfirm } from "@/components/OperationConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Search, 
  MoreHorizontal,
  Loader2,
  RefreshCw,
  Zap,
  Target,
  Megaphone,
  Monitor,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings2,
  Pause,
  Play,
  DollarSign,
  RotateCcw,
  Bot,
  Activity,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Clock,
  CircleDollarSign,
  TrendingDown
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

// 利润最大化出价点显示组件（带一键采纳按钮）
function OptimalBidCell({ campaignId, accountId, onApplySuccess }: { 
  campaignId: string; 
  accountId: number;
  onApplySuccess?: () => void;
}) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  
  const { data, isLoading, error, refetch } = trpc.placement.getCampaignOptimalBids.useQuery(
    { campaignId, accountId },
    { 
      enabled: !!campaignId && !!accountId,
      staleTime: 5 * 60 * 1000, // 5分钟缓存
      refetchOnWindowFocus: false,
    }
  );
  
  const applyOptimalBids = trpc.placement.applyCampaignOptimalBids.useMutation({
    onSuccess: (result) => {
      toast.success(`已应用${result.summary.appliedCount}个关键词的最优出价，预估利润提升$${result.summary.totalExpectedProfitIncrease}`);
      setShowConfirmDialog(false);
      setIsApplying(false);
      refetch();
      onApplySuccess?.();
    },
    onError: (error) => {
      toast.error(`应用失败: ${error.message}`);
      setIsApplying(false);
    },
  });

  const handleApply = () => {
    setIsApplying(true);
    applyOptimalBids.mutate({
      campaignId,
      accountId,
      minBidDifferencePercent: 5,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-xs">计算中...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">暂无数据</span>
      </div>
    );
  }

  const { summary, keywords } = data;
  
  if (summary.analyzedKeywords === 0) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="text-xs">无市场曲线数据</span>
      </div>
    );
  }

  const bidDiff = summary.avgOptimalBid - summary.avgCurrentBid;
  const bidDiffPercent = summary.avgCurrentBid > 0 
    ? ((bidDiff / summary.avgCurrentBid) * 100).toFixed(1) 
    : '0';
  const isIncrease = bidDiff > 0;
  const isSignificant = Math.abs(bidDiff) > summary.avgCurrentBid * 0.05;
  const hasAdjustments = summary.keywordsNeedIncrease > 0 || summary.keywordsNeedDecrease > 0;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <CircleDollarSign className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-sm font-medium">${summary.avgOptimalBid.toFixed(2)}</span>
          </div>
          {isSignificant && (
            <div className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
              isIncrease 
                ? 'bg-green-500/10 text-green-600' 
                : 'bg-red-500/10 text-red-600'
            }`}>
              {isIncrease ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{isIncrease ? '+' : ''}{bidDiffPercent}%</span>
            </div>
          )}
          {hasAdjustments && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfirmDialog(true);
              }}
            >
              <CheckCircle2 className="w-3 h-3 mr-0.5" />
              采纳
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>当前: ${summary.avgCurrentBid.toFixed(2)}</span>
          <span>·</span>
          <span className="text-green-600">↑{summary.keywordsNeedIncrease}</span>
          <span className="text-red-600">↓{summary.keywordsNeedDecrease}</span>
        </div>
      </div>
      
      {/* 确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="w-5 h-5 text-blue-500" />
              确认应用最优出价
            </DialogTitle>
            <DialogDescription>
              将根据利润最大化算法调整以下关键词的出价
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* 汇总信息 */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">待调整关键词</p>
                <p className="text-lg font-semibold">{summary.keywordsNeedIncrease + summary.keywordsNeedDecrease}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">平均调整幅度</p>
                <p className={`text-lg font-semibold ${isIncrease ? 'text-green-600' : 'text-red-600'}`}>
                  {isIncrease ? '+' : ''}{bidDiffPercent}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">预估利润提升</p>
                <p className="text-lg font-semibold text-green-600">${(summary.totalMaxProfit * 0.1).toFixed(2)}</p>
              </div>
            </div>
            
            {/* 调整明细 */}
            <div className="max-h-48 overflow-y-auto space-y-2">
              <p className="text-xs text-muted-foreground font-medium">调整明细（显示前10个）</p>
              {keywords.slice(0, 10).map((kw) => (
                <div key={kw.keywordId} className="flex items-center justify-between text-xs p-2 bg-muted/20 rounded">
                  <span className="truncate max-w-[200px]" title={kw.keywordText}>{kw.keywordText}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">${kw.currentBid.toFixed(2)}</span>
                    <span>→</span>
                    <span className={kw.recommendation === 'increase' ? 'text-green-600' : kw.recommendation === 'decrease' ? 'text-red-600' : ''}>
                      ${kw.optimalBid.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
              {keywords.length > 10 && (
                <p className="text-xs text-muted-foreground text-center">还有 {keywords.length - 10} 个关键词...</p>
              )}
            </div>
            
            {/* 警告信息 */}
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-700">
                <p className="font-medium">注意事项</p>
                <p>出价调整将立即生效，差距低于5%的关键词将被跳过</p>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} disabled={isApplying}>
              取消
            </Button>
            <Button onClick={handleApply} disabled={isApplying}>
              {isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  应用中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  确认应用
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 广告活动类型配置
const campaignTypes = [
  { value: "all", label: "全部类型", icon: null, count: 0 },
  { value: "sp_auto", label: "SP 自动", icon: Zap, color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  { value: "sp_manual", label: "SP 手动", icon: Target, color: "bg-green-500/10 text-green-500 border-green-500/20" },
  { value: "sb", label: "SB 品牌", icon: Megaphone, color: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  { value: "sd", label: "SD 展示", icon: Monitor, color: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
];

// 计费方式映射
const billingTypeLabels: Record<string, string> = {
  cpc: "CPC (按点击)",
  vcpm: "vCPM (按千次展示)",
  cpm: "CPM (按千次展示)",
};

// 列配置
type ColumnKey = 'campaignName' | 'campaignType' | 'billingType' | 'createdAt' | 'status' | 
  'dailyBudget' | 'dailySpend' | 'impressions' | 'clicks' | 'ctr' | 'totalSpend' | 
  'dailySales' | 'totalSales' | 'acos' | 'roas' | 'performanceGroup' | 'optimalBid' | 'autoOptimization' | 'actions';

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  minWidth: string;
  align?: 'left' | 'right' | 'center';
  sortable: boolean;
  defaultVisible: boolean;
  sticky?: boolean;
}

const columns: ColumnConfig[] = [
  { key: 'campaignName', label: '广告活动名称', minWidth: '250px', align: 'left', sortable: true, defaultVisible: true, sticky: true },
  { key: 'campaignType', label: '类型', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'billingType', label: '计费方式', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'createdAt', label: '创建日期', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'status', label: '状态', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'dailyBudget', label: '日预算', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'dailySpend', label: '当日花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'impressions', label: '曝光', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'clicks', label: '点击', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'ctr', label: '点击率', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'totalSpend', label: '累计花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'dailySales', label: '日销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'totalSales', label: '累计销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'acos', label: 'ACoS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'roas', label: 'ROAS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true },
  { key: 'performanceGroup', label: '所属绩效组', minWidth: '120px', align: 'left', sortable: true, defaultVisible: true },
  { key: 'optimalBid', label: '最优出价', minWidth: '180px', align: 'center', sortable: false, defaultVisible: true },
  { key: 'autoOptimization', label: '自动优化', minWidth: '140px', align: 'center', sortable: false, defaultVisible: true },
  { key: 'actions', label: '操作', minWidth: '120px', align: 'center', sortable: false, defaultVisible: true },
];

// 排序字段类型
type SortField = Exclude<ColumnKey, 'actions'>;
type SortDirection = 'asc' | 'desc';

// localStorage key
const COLUMN_VISIBILITY_KEY = 'campaigns_column_visibility';

// 运行状态筛选选项
const runningStatusOptions = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "活跃" },
  { value: "paused", label: "暂停" },
];

// 优化状态筛选选项
const optimizationStatusOptions = [
  { value: "all", label: "全部" },
  { value: "managed", label: "已介入" },
  { value: "unmanaged", label: "未介入" },
];

// 计费方式筛选选项
const billingTypeOptions = [
  { value: "all", label: "全部计费" },
  { value: "cpc", label: "CPC" },
  { value: "vcpm", label: "vCPM" },
  { value: "cpm", label: "CPM" },
];

// 站点映射
const marketplaceLabels: Record<string, string> = {
  US: "美国站",
  CA: "加拿大站",
  MX: "墨西哥站",
  UK: "英国站",
  DE: "德国站",
  FR: "法国站",
  IT: "意大利站",
  ES: "西班牙站",
  JP: "日本站",
  AU: "澳大利亚站",
  IN: "印度站",
  AE: "阿联酋站",
  SA: "沙特站",
  BR: "巴西站",
  SG: "新加坡站",
  NL: "荷兰站",
  SE: "瑞典站",
  PL: "波兰站",
  BE: "比利时站",
  TR: "土耳其站",
};

// 时间范围选项
const timeRangeOptions = [
  { value: 'today', label: '今天', days: 0 },
  { value: 'yesterday', label: '昨天', days: 1 },
  { value: '7days', label: '近 7 天', days: 7 },
  { value: '14days', label: '近 14 天', days: 14 },
  { value: '30days', label: '近 30 天', days: 30 },
  { value: '60days', label: '近 60 天', days: 60 },
  { value: '90days', label: '近 90 天', days: 90 },
  { value: 'custom', label: '自定义', days: -1 },
];

// 计算日期范围
function getDateRange(rangeType: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (rangeType === 'custom' && customStart && customEnd) {
    return { startDate: customStart, endDate: customEnd };
  }
  
  const option = timeRangeOptions.find(o => o.value === rangeType);
  if (!option) {
    // 默认返回近 7 天
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7);
    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    };
  }
  
  if (rangeType === 'today') {
    const dateStr = today.toISOString().split('T')[0];
    return { startDate: dateStr, endDate: dateStr };
  }
  
  if (rangeType === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    return { startDate: dateStr, endDate: dateStr };
  }
  
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - option.days);
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: today.toISOString().split('T')[0],
  };
}

export default function Campaigns() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [billingTypeFilter, setBillingTypeFilter] = useState<string>("all");
  const [runningStatusFilter, setRunningStatusFilter] = useState<string>("all");
  const [optimizationStatusFilter, setOptimizationStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  
  // 时间范围状态
  const [timeRange, setTimeRange] = useState<string>('7days');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  
  // 列显示状态
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    const saved = localStorage.getItem(COLUMN_VISIBILITY_KEY);
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set(columns.filter(c => c.defaultVisible).map(c => c.key));
      }
    }
    return new Set(columns.filter(c => c.defaultVisible).map(c => c.key));
  });

  // 编辑预算弹窗状态
  const [editBudgetDialog, setEditBudgetDialog] = useState<{
    open: boolean;
    campaignId: number | null;
    campaignName: string;
    currentBudget: number;
    newBudget: string;
  }>({
    open: false,
    campaignId: null,
    campaignName: '',
    currentBudget: 0,
    newBudget: '',
  });
  
  // 确认弹窗状态
  const { showConfirm, dialogProps } = useOperationConfirm();

  // 保存列显示设置到localStorage
  useEffect(() => {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns]);

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 计算时间范围
  const dateRange = useMemo(() => {
    return getDateRange(timeRange, customStartDate, customEndDate);
  }, [timeRange, customStartDate, customEndDate]);

  // Fetch campaigns with performance data
  const { data: campaigns, isLoading, refetch } = trpc.campaign.list.useQuery(
    { 
      accountId: accountId!, 
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    },
    { enabled: !!accountId }
  );

  // Fetch performance groups for assignment
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // Update campaign mutation
  const updateCampaign = trpc.campaign.update.useMutation({
    onSuccess: () => {
      toast.success("广告活动已更新");
      refetch();
    },
  });

  // Sync all data mutation
  const syncAllMutation = trpc.amazonApi.syncAll.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成！广告活动: ${data.campaigns}, 广告组: ${data.adGroups}, 关键词: ${data.keywords}, 商品定位: ${data.targets}`);
      setIsSyncing(false);
      refetch();
    },
    onError: (error) => {
      toast.error(`同步失败: ${error.message}`);
      setIsSyncing(false);
    },
  });

  // Handle sync data
  const handleSyncData = async () => {
    if (!accountId) {
      toast.error("请先选择广告账号");
      return;
    }
    setIsSyncing(true);
    toast.loading('正在同步数据，请稍候...', { id: 'sync-toast' });
    try {
      await syncAllMutation.mutateAsync({ accountId });
      toast.dismiss('sync-toast');
    } catch (error) {
      toast.dismiss('sync-toast');
      setIsSyncing(false);
    }
  };

  // Assign to performance group
  const assignToGroup = trpc.performanceGroup.assignCampaign.useMutation({
    onSuccess: () => {
      toast.success("已分配到绩效组");
      refetch();
    },
  });

  // 获取店铺和站点信息（从账号列表中获取）
  const storeOptions = useMemo(() => {
    if (!accounts) return [{ value: "all", label: "全部店铺" }];
    const storeSet = new Set(accounts.map(a => a.storeName || a.accountName).filter(Boolean));
    const stores = Array.from(storeSet) as string[];
    return [
      { value: "all", label: "全部店铺" },
      ...stores.map(s => ({ value: s, label: s }))
    ];
  }, [accounts]);

  const marketplaceOptions = useMemo(() => {
    if (!accounts) return [{ value: "all", label: "全部站点" }];
    const marketplaceSet = new Set(accounts.map(a => a.marketplace).filter(Boolean));
    const marketplaces = Array.from(marketplaceSet) as string[];
    return [
      { value: "all", label: "全部站点" },
      ...marketplaces.map(m => ({ value: m, label: marketplaceLabels[m] || m }))
    ];
  }, [accounts]);

  // 获取符合店铺和站点筛选的账号ID列表
  const filteredAccountIds = useMemo(() => {
    if (!accounts) return [];
    return accounts
      .filter(a => {
        const matchesStore = storeFilter === "all" || (a.storeName || a.accountName) === storeFilter;
        const matchesMarketplace = marketplaceFilter === "all" || a.marketplace === marketplaceFilter;
        return matchesStore && matchesMarketplace;
      })
      .map(a => a.id);
  }, [accounts, storeFilter, marketplaceFilter]);

  // Filter campaigns
  const filteredCampaigns = campaigns?.filter((campaign) => {
    const matchesSearch = campaign.campaignName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAccount = storeFilter === "all" && marketplaceFilter === "all" || filteredAccountIds.includes(campaign.accountId);
    const matchesType = typeFilter === "all" || campaign.campaignType === typeFilter;
    const matchesBillingType = billingTypeFilter === "all" || (campaign as any).billingType === billingTypeFilter;
    const matchesRunningStatus = runningStatusFilter === "all" || campaign.campaignStatus === runningStatusFilter;
    const matchesOptimizationStatus = optimizationStatusFilter === "all" || 
      (campaign as any).optimizationStatus === optimizationStatusFilter ||
      (optimizationStatusFilter === "managed" && (campaign as any).performanceGroupId) ||
      (optimizationStatusFilter === "unmanaged" && !(campaign as any).performanceGroupId);
    return matchesSearch && matchesAccount && matchesType && matchesBillingType && matchesRunningStatus && matchesOptimizationStatus;
  });

  // 计算各状态数量
  const statusCounts = useMemo(() => {
    if (!campaigns) return { enabled: 0, paused: 0, managed: 0, unmanaged: 0 };
    return campaigns.reduce((acc, campaign) => {
      if (campaign.campaignStatus === 'enabled') acc.enabled++;
      if (campaign.campaignStatus === 'paused') acc.paused++;
      if ((campaign as any).performanceGroupId) acc.managed++;
      else acc.unmanaged++;
      return acc;
    }, { enabled: 0, paused: 0, managed: 0, unmanaged: 0 });
  }, [campaigns]);

  // 批量操作：加入绩效组
  const batchAssignToGroup = trpc.performanceGroup.batchAssignCampaigns.useMutation({
    onSuccess: (result) => {
      toast.success(`已将 ${result.count} 个广告活动加入绩效组`);
      setSelectedCampaigns(new Set());
      refetch();
    },
    onError: (error) => {
      toast.error(`批量分配失败: ${error.message}`);
    },
  });

  // 批量操作：移出绩效组
  const batchRemoveFromGroup = trpc.performanceGroup.batchRemoveCampaigns.useMutation({
    onSuccess: (result) => {
      toast.success(`已将 ${result.count} 个广告活动移出绩效组`);
      setSelectedCampaigns(new Set());
      refetch();
    },
    onError: (error) => {
      toast.error(`批量移除失败: ${error.message}`);
    },
  });

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedCampaigns.size === sortedCampaigns.length) {
      setSelectedCampaigns(new Set());
    } else {
      setSelectedCampaigns(new Set(sortedCampaigns.map(c => c.id)));
    }
  };

  // 切换单个选择
  const toggleSelectCampaign = (id: number) => {
    const newSelected = new Set(selectedCampaigns);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedCampaigns(newSelected);
  };

  // 获取绩效组名称
  const getPerformanceGroupName = (groupId: number | null | undefined) => {
    if (!groupId) return "-";
    const group = performanceGroups?.find(g => g.id === groupId);
    return group?.name || "-";
  };

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 获取排序图标
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // 排序后的数据
  const sortedCampaigns = useMemo(() => {
    if (!filteredCampaigns) return [];
    if (!sortField) return filteredCampaigns;
    
    return [...filteredCampaigns].sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortField) {
        case 'campaignName':
          aValue = a.campaignName.toLowerCase();
          bValue = b.campaignName.toLowerCase();
          break;
        case 'campaignType':
          aValue = a.campaignType;
          bValue = b.campaignType;
          break;
        case 'billingType':
          aValue = (a as any).billingType || 'cpc';
          bValue = (b as any).billingType || 'cpc';
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt || 0).getTime();
          bValue = new Date(b.createdAt || 0).getTime();
          break;
        case 'status':
          aValue = a.campaignStatus || '';
          bValue = b.campaignStatus || '';
          break;
        case 'dailyBudget':
          aValue = parseFloat((a as any).dailyBudget || '0');
          bValue = parseFloat((b as any).dailyBudget || '0');
          break;
        case 'dailySpend':
          aValue = parseFloat((a as any).dailySpend || '0');
          bValue = parseFloat((b as any).dailySpend || '0');
          break;
        case 'impressions':
          aValue = a.impressions || 0;
          bValue = b.impressions || 0;
          break;
        case 'clicks':
          aValue = a.clicks || 0;
          bValue = b.clicks || 0;
          break;
        case 'ctr':
          aValue = a.impressions ? (a.clicks || 0) / a.impressions : 0;
          bValue = b.impressions ? (b.clicks || 0) / b.impressions : 0;
          break;
        case 'totalSpend':
          aValue = parseFloat(a.spend || '0');
          bValue = parseFloat(b.spend || '0');
          break;
        case 'dailySales':
          aValue = parseFloat((a as any).dailySales || '0');
          bValue = parseFloat((b as any).dailySales || '0');
          break;
        case 'totalSales':
          aValue = parseFloat(a.sales || '0');
          bValue = parseFloat(b.sales || '0');
          break;
        case 'acos':
          aValue = parseFloat(a.acos || '0');
          bValue = parseFloat(b.acos || '0');
          break;
        case 'roas':
          aValue = parseFloat(a.roas || '0');
          bValue = parseFloat(b.roas || '0');
          break;
        case 'performanceGroup':
          aValue = getPerformanceGroupName((a as any).performanceGroupId);
          bValue = getPerformanceGroupName((b as any).performanceGroupId);
          break;
        default:
          return 0;
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredCampaigns, sortField, sortDirection, performanceGroups]);

  // 计算各类型数量
  const typeCounts = campaigns?.reduce((acc, campaign) => {
    acc[campaign.campaignType] = (acc[campaign.campaignType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const getCampaignTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      sp_auto: "SP 自动",
      sp_manual: "SP 手动",
      sb: "SB 品牌",
      sd: "SD 展示",
    };
    return labels[type] || type;
  };

  const getCampaignTypeConfig = (type: string) => {
    return campaignTypes.find(t => t.value === type) || campaignTypes[0];
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      enabled: { label: "投放中", className: "bg-green-500/10 text-green-500 border-green-500/20" },
      paused: { label: "已暂停", className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
      archived: { label: "已归档", className: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
    };
    const config = statusConfig[status] || { label: status, className: "bg-gray-500/10 text-gray-500" };
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  // 计算点击率
  const calculateCTR = (clicks: number, impressions: number) => {
    if (!impressions || impressions === 0) return "-";
    return ((clicks / impressions) * 100).toFixed(2) + "%";
  };

  // 格式化日期
  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  // 切换列显示
  const toggleColumn = (key: ColumnKey) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(key)) {
      // 至少保留广告活动名称列
      if (key !== 'campaignName') {
        newVisible.delete(key);
      }
    } else {
      newVisible.add(key);
    }
    setVisibleColumns(newVisible);
  };

  // 重置为默认列
  const resetColumns = () => {
    setVisibleColumns(new Set(columns.filter(c => c.defaultVisible).map(c => c.key)));
  };

  // 处理暂停/启用操作
  const handleToggleStatus = (campaign: any) => {
    const newStatus = campaign.campaignStatus === "enabled" ? "paused" : "enabled";
    const isHighRisk = campaign.campaignStatus === "enabled";
    
    showConfirm({
      operationType: newStatus === "paused" ? 'campaign_pause' : 'campaign_enable',
      title: newStatus === "paused" ? '暂停广告活动' : '启用广告活动',
      description: `您即将${newStatus === "paused" ? '暂停' : '启用'}广告活动"${campaign.campaignName}"`,
      changes: [{
        id: campaign.id,
        name: campaign.campaignName,
        field: 'status',
        fieldLabel: '状态',
        oldValue: campaign.campaignStatus === "enabled" ? '启用中' : '已暂停',
        newValue: newStatus === "paused" ? '已暂停' : '启用中',
      }],
      warningMessage: isHighRisk 
        ? '暂停广告活动将立即停止广告展示，可能影响销售' 
        : undefined,
      onConfirm: () => {
        updateCampaign.mutate({
          id: campaign.id,
          campaignStatus: newStatus,
        });
      },
    });
  };

  // 处理编辑预算
  const handleEditBudget = (campaign: any) => {
    setEditBudgetDialog({
      open: true,
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      currentBudget: parseFloat((campaign as any).dailyBudget || '0'),
      newBudget: (campaign as any).dailyBudget || '0',
    });
  };

  // 确认编辑预算
  const confirmEditBudget = () => {
    const newBudget = parseFloat(editBudgetDialog.newBudget);
    if (isNaN(newBudget) || newBudget < 0) {
      toast.error("请输入有效的预算金额");
      return;
    }

    showConfirm({
      operationType: 'budget_adjustment',
      title: '修改日预算',
      description: `您即将修改广告活动"${editBudgetDialog.campaignName}"的日预算`,
      changes: [{
        id: editBudgetDialog.campaignId!,
        name: editBudgetDialog.campaignName,
        field: 'dailyBudget',
        fieldLabel: '日预算',
        oldValue: `$${editBudgetDialog.currentBudget.toFixed(2)}`,
        newValue: `$${newBudget.toFixed(2)}`,
      }],
      warningMessage: newBudget > editBudgetDialog.currentBudget * 2 
        ? '新预算超过原预算的2倍，请确认是否正确' 
        : undefined,
      onConfirm: () => {
        updateCampaign.mutate({
          id: editBudgetDialog.campaignId!,
          dailyBudget: newBudget.toString(),
        });
        setEditBudgetDialog({ open: false, campaignId: null, campaignName: '', currentBudget: 0, newBudget: '' });
      },
    });
  };

  // 渲染单元格内容
  const renderCell = (campaign: any, columnKey: ColumnKey) => {
    const typeConfig = getCampaignTypeConfig(campaign.campaignType);
    const dailySpend = parseFloat((campaign as any).dailySpend || "0");
    const totalSpend = parseFloat(campaign.spend || "0");
    const dailySales = parseFloat((campaign as any).dailySales || "0");
    const totalSales = parseFloat(campaign.sales || "0");
    const dailyBudget = parseFloat((campaign as any).dailyBudget || "0");
    const impressions = campaign.impressions || 0;
    const clicks = campaign.clicks || 0;

    switch (columnKey) {
      case 'campaignName':
        return (
          <div className="max-w-[250px] truncate font-medium" title={campaign.campaignName}>
            <a 
              href={`/campaigns/${campaign.id}`}
              className="text-primary hover:underline cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = `/campaigns/${campaign.id}`;
              }}
            >
              {campaign.campaignName}
            </a>
          </div>
        );
      case 'campaignType':
        return (
          <Badge variant="outline" className={typeConfig.color}>
            {getCampaignTypeLabel(campaign.campaignType)}
          </Badge>
        );
      case 'billingType':
        return (
          <span className="text-sm text-muted-foreground">
            {billingTypeLabels[(campaign as any).billingType] || "CPC (按点击)"}
          </span>
        );
      case 'createdAt':
        return (
          <span className="text-sm text-muted-foreground">
            {formatDate(campaign.createdAt)}
          </span>
        );
      case 'status':
        return getStatusBadge(campaign.campaignStatus || 'paused');
      case 'dailyBudget':
        return <span className="tabular-nums font-medium">${dailyBudget.toFixed(2)}</span>;
      case 'dailySpend':
        return (
          <span className={`tabular-nums ${dailySpend > dailyBudget * 0.9 ? "text-orange-500" : ""}`}>
            ${dailySpend.toFixed(2)}
          </span>
        );
      case 'impressions':
        return <span className="tabular-nums">{impressions.toLocaleString()}</span>;
      case 'clicks':
        return <span className="tabular-nums">{clicks.toLocaleString()}</span>;
      case 'ctr':
        return <span className="tabular-nums">{calculateCTR(clicks, impressions)}</span>;
      case 'totalSpend':
        return <span className="tabular-nums font-medium">${totalSpend.toFixed(2)}</span>;
      case 'dailySales':
        return <span className="tabular-nums text-green-600">${dailySales.toFixed(2)}</span>;
      case 'totalSales':
        return <span className="tabular-nums text-green-600 font-medium">${totalSales.toFixed(2)}</span>;
      case 'acos':
        const acos = parseFloat(campaign.acos || "0");
        return (
          <span className={`tabular-nums ${acos > 30 ? "text-red-500" : acos > 20 ? "text-orange-500" : "text-green-500"}`}>
            {acos.toFixed(1)}%
          </span>
        );
      case 'roas':
        const roas = parseFloat(campaign.roas || "0");
        return (
          <span className={`tabular-nums ${roas < 2 ? "text-red-500" : roas < 3 ? "text-orange-500" : "text-green-500"}`}>
            {roas.toFixed(2)}
          </span>
        );
      case 'performanceGroup':
        return (
          <Select
            value={(campaign as any).performanceGroupId?.toString() || ""}
            onValueChange={(value) => {
              assignToGroup.mutate({
                campaignId: campaign.id,
                performanceGroupId: parseInt(value),
              });
            }}
          >
            <SelectTrigger className="h-8 w-[110px]">
              <SelectValue placeholder="选择绩效组" />
            </SelectTrigger>
            <SelectContent>
              {performanceGroups?.map((group) => (
                <SelectItem key={group.id} value={group.id.toString()}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'optimalBid':
        // 利润最大化出价点显示
        return <OptimalBidCell campaignId={campaign.amazonCampaignId} accountId={accountId!} />;
      case 'autoOptimization':
        // 自动优化状态显示
        const optimizationEnabled = true; // TODO: 从状态获取
        const pendingDecisions = 0; // TODO: 从状态获取
        const executedToday = 0; // TODO: 从状态获取
        return (
          <div className="flex items-center gap-2">
            <div 
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                optimizationEnabled 
                  ? 'bg-green-500/10 text-green-600 border border-green-500/20' 
                  : 'bg-gray-500/10 text-gray-500 border border-gray-500/20'
              }`}
              title={optimizationEnabled ? '自动优化已启用' : '自动优化已禁用'}
            >
              <Bot className="w-3 h-3" />
              <span>{optimizationEnabled ? '已启用' : '已禁用'}</span>
            </div>
            {pendingDecisions > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                <Clock className="w-3 h-3 mr-1" />
                {pendingDecisions}待执行
              </Badge>
            )}
            {executedToday > 0 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 text-green-600 border-green-500/30">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                今日{executedToday}
              </Badge>
            )}
          </div>
        );
      case 'actions':
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleToggleStatus(campaign)}
              title={campaign.campaignStatus === "enabled" ? "暂停" : "启用"}
            >
              {campaign.campaignStatus === "enabled" ? (
                <Pause className="w-4 h-4 text-yellow-500" />
              ) : (
                <Play className="w-4 h-4 text-green-500" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleEditBudget(campaign)}
              title="编辑预算"
            >
              <DollarSign className="w-4 h-4 text-blue-500" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                  查看关键词
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                  查看竞价日志
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">广告活动</h1>
            <p className="text-muted-foreground">
              管理和优化您的亚马逊广告活动 · <span className="text-green-500">算法自动决策执行，人只做监督</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 列设置 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="w-4 h-4 mr-2" />
                  列设置
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>显示列</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.filter(c => c.key !== 'campaignName').map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={visibleColumns.has(column.key)}
                    onCheckedChange={() => toggleColumn(column.key)}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={resetColumns}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重置为默认
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={handleSyncData} disabled={isSyncing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? '同步中...' : '同步数据'}
            </Button>
          </div>
        </div>

        {/* 筛选器卡片 - 按优先级排列 */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {/* 第一行：时间范围筛选（最高优先级） */}
              <div className="flex flex-wrap items-center gap-4">
                {/* 时间范围筛选 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">时间范围:</span>
                  <div className="flex gap-1">
                    {timeRangeOptions.filter(o => o.value !== 'custom').map((option) => (
                      <Button
                        key={option.value}
                        variant={timeRange === option.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setTimeRange(option.value);
                          setShowCustomDatePicker(false);
                        }}
                        className="h-8"
                      >
                        {option.label}
                      </Button>
                    ))}
                    <Button
                      variant={timeRange === 'custom' ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setTimeRange('custom');
                        setShowCustomDatePicker(true);
                      }}
                      className="h-8"
                    >
                      自定义
                    </Button>
                  </div>
                </div>
                
                {/* 自定义日期选择器 */}
                {showCustomDatePicker && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="h-8 w-[140px]"
                    />
                    <span className="text-muted-foreground">至</span>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="h-8 w-[140px]"
                    />
                  </div>
                )}
                
                {/* 显示当前日期范围 */}
                <span className="text-xs text-muted-foreground">
                  {dateRange.startDate} 至 {dateRange.endDate}
                </span>
              </div>
              
              {/* 第二行：店铺和站点筛选 */}
              <div className="flex flex-wrap items-center gap-4">
                {/* 店铺筛选 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">店铺:</span>
                  <Select value={storeFilter} onValueChange={setStoreFilter}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="选择店铺" />
                    </SelectTrigger>
                    <SelectContent>
                      {storeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 站点筛选 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">站点:</span>
                  <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue placeholder="选择站点" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketplaceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 搜索框 */}
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索广告活动名称..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                </div>
              </div>

              {/* 第三行：广告类型筛选 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">广告类型:</span>
                {campaignTypes.map((type) => {
                  const count = type.value === "all" 
                    ? campaigns?.length || 0 
                    : typeCounts[type.value] || 0;
                  const isActive = typeFilter === type.value;
                  const Icon = type.icon;
                  
                  return (
                    <Button
                      key={type.value}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTypeFilter(type.value)}
                      className="h-8"
                    >
                      {Icon && <Icon className="w-3.5 h-3.5 mr-1" />}
                      {type.label}
                      <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                    </Button>
                  );
                })}
              </div>

              {/* 第四行：计费方式筛选 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">计费方式:</span>
                {billingTypeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={billingTypeFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBillingTypeFilter(option.value)}
                    className="h-8"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>

              {/* 第五行：运行状态和优化状态筛选 */}
              <div className="flex flex-wrap items-center gap-4">
                {/* 运行状态筛选 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">运行状态:</span>
                  <div className="flex gap-1">
                    {runningStatusOptions.map((option) => {
                      const count = option.value === "all" 
                        ? campaigns?.length || 0 
                        : option.value === "enabled" ? statusCounts.enabled : statusCounts.paused;
                      return (
                        <Button
                          key={option.value}
                          variant={runningStatusFilter === option.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRunningStatusFilter(option.value)}
                          className="h-8"
                        >
                          {option.label}
                          <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* 优化状态筛选 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">优化状态:</span>
                  <div className="flex gap-1">
                    {optimizationStatusOptions.map((option) => {
                      const count = option.value === "all" 
                        ? campaigns?.length || 0 
                        : option.value === "managed" ? statusCounts.managed : statusCounts.unmanaged;
                      return (
                        <Button
                          key={option.value}
                          variant={optimizationStatusFilter === option.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setOptimizationStatusFilter(option.value)}
                          className={`h-8 ${option.value === "managed" ? "data-[state=active]:bg-green-600" : option.value === "unmanaged" ? "data-[state=active]:bg-orange-600" : ""}`}
                        >
                          {option.value === "managed" && <Bot className="w-3 h-3 mr-1" />}
                          {option.value === "unmanaged" && <AlertCircle className="w-3 h-3 mr-1" />}
                          {option.label}
                          <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 当前筛选条件摘要 */}
              {(storeFilter !== "all" || marketplaceFilter !== "all" || typeFilter !== "all" || billingTypeFilter !== "all" || runningStatusFilter !== "all" || optimizationStatusFilter !== "all") && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <span className="text-sm text-muted-foreground">当前筛选:</span>
                  <div className="flex flex-wrap gap-1">
                    {storeFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setStoreFilter("all")}>
                        店铺: {storeFilter} ×
                      </Badge>
                    )}
                    {marketplaceFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setMarketplaceFilter("all")}>
                        站点: {marketplaceLabels[marketplaceFilter] || marketplaceFilter} ×
                      </Badge>
                    )}
                    {typeFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setTypeFilter("all")}>
                        类型: {campaignTypes.find(t => t.value === typeFilter)?.label} ×
                      </Badge>
                    )}
                    {billingTypeFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setBillingTypeFilter("all")}>
                        计费: {billingTypeOptions.find(t => t.value === billingTypeFilter)?.label} ×
                      </Badge>
                    )}
                    {runningStatusFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setRunningStatusFilter("all")}>
                        状态: {runningStatusOptions.find(t => t.value === runningStatusFilter)?.label} ×
                      </Badge>
                    )}
                    {optimizationStatusFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setOptimizationStatusFilter("all")}>
                        优化: {optimizationStatusOptions.find(t => t.value === optimizationStatusFilter)?.label} ×
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => {
                      setStoreFilter("all");
                      setMarketplaceFilter("all");
                      setTypeFilter("all");
                      setBillingTypeFilter("all");
                      setRunningStatusFilter("all");
                      setOptimizationStatusFilter("all");
                    }}>
                      清除全部
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 批量操作栏 */}
            {selectedCampaigns.size > 0 && (
              <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedCampaigns.size === sortedCampaigns.length}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm font-medium">已选择 {selectedCampaigns.size} 个广告活动</span>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    onValueChange={(value) => {
                      batchAssignToGroup.mutate({
                        campaignIds: Array.from(selectedCampaigns),
                        performanceGroupId: parseInt(value),
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue placeholder="加入绩效组" />
                    </SelectTrigger>
                    <SelectContent>
                      {performanceGroups?.map((group) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      batchRemoveFromGroup.mutate({
                        campaignIds: Array.from(selectedCampaigns),
                      });
                    }}
                    className="h-8"
                  >
                    移出绩效组
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCampaigns(new Set())}
                    className="h-8"
                  >
                    取消选择
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Campaigns Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {typeFilter === "all" ? "全部广告活动" : getCampaignTypeLabel(typeFilter) + " 广告活动"}
                </CardTitle>
                <CardDescription>
                  共 {sortedCampaigns.length} 个广告活动
                  {sortField && (
                    <span className="ml-2 text-primary">
                      · 按{columns.find(c => c.key === sortField)?.label}
                      {sortDirection === 'asc' ? '升序' : '降序'}排列
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : sortedCampaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {/* 复选框列 */}
                      <TableHead className="w-[40px] sticky left-0 bg-muted/50 z-10">
                        <Checkbox
                          checked={selectedCampaigns.size === sortedCampaigns.length && sortedCampaigns.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      {columns.filter(col => visibleColumns.has(col.key)).map((column) => (
                        <TableHead 
                          key={column.key}
                          className={`min-w-[${column.minWidth}] ${column.sticky ? 'sticky left-[40px] bg-muted/50 z-10' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                          style={{ minWidth: column.minWidth }}
                        >
                          {column.sortable ? (
                            <button
                              className="flex items-center gap-1 hover:text-primary transition-colors"
                              onClick={() => handleSort(column.key as SortField)}
                            >
                              {column.label}
                              {getSortIcon(column.key as SortField)}
                            </button>
                          ) : (
                            column.label
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCampaigns.map((campaign) => (
                      <TableRow 
                        key={campaign.id} 
                        className={`hover:bg-muted/30 ${selectedCampaigns.has(campaign.id) ? 'bg-primary/5' : ''}`}
                      >
                        {/* 复选框列 */}
                        <TableCell className="sticky left-0 bg-background z-10">
                          <Checkbox
                            checked={selectedCampaigns.has(campaign.id)}
                            onCheckedChange={() => toggleSelectCampaign(campaign.id)}
                          />
                        </TableCell>
                        {columns.filter(col => visibleColumns.has(col.key)).map((column) => (
                          <TableCell 
                            key={column.key}
                            className={`${column.sticky ? 'sticky left-[40px] bg-background z-10' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                          >
                            {renderCell(campaign, column.key)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-16">
                <RefreshCw className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">暂无广告活动</h3>
                <p className="text-muted-foreground mb-4">
                  请先连接Amazon API同步您的广告数据
                </p>
                <Button onClick={handleSyncData} disabled={isSyncing}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? '同步中...' : '同步数据'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 编辑预算弹窗 */}
      <Dialog open={editBudgetDialog.open} onOpenChange={(open) => !open && setEditBudgetDialog({ ...editBudgetDialog, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑日预算</DialogTitle>
            <DialogDescription>
              修改广告活动 "{editBudgetDialog.campaignName}" 的日预算
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>当前日预算</Label>
              <div className="text-lg font-semibold">${editBudgetDialog.currentBudget.toFixed(2)}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newBudget">新日预算</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="newBudget"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editBudgetDialog.newBudget}
                  onChange={(e) => setEditBudgetDialog({ ...editBudgetDialog, newBudget: e.target.value })}
                  className="pl-9"
                  placeholder="输入新的日预算"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBudgetDialog({ ...editBudgetDialog, open: false })}>
              取消
            </Button>
            <Button onClick={confirmEditBudget}>
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 操作确认弹窗 */}
      {dialogProps && <OperationConfirmDialog {...dialogProps} />}
    </DashboardLayout>
  );
}
