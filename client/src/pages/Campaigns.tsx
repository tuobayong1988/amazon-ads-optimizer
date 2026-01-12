import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebounce } from "@/hooks/useDebounce";
import { useIsMobile } from "@/hooks/useMobile";
import { MobileFilterPanel, MobileFilterRow } from "@/components/MobileFilterPanel";
import { MobileBottomSpacer } from "@/components/MobileBottomNav";
import { FloatingActionButton, FloatingAction, commonActions } from "@/components/FloatingActionButton";
import { useUrlFilters, serializers } from "@/hooks/useUrlFilters";
import { useFilterPresets, FilterPreset } from "@/hooks/useFilterPresets";
import { exportToCSV, exportToExcel, ExportColumn } from "@/utils/exportTable";
import { Pagination, usePagination } from "@/components/Pagination";
import { useResizableColumns, ResizeHandle, PinButton } from "@/components/ResizableTable";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { TimeRangeSelector, TimeRangeValue, getDefaultTimeRangeValue } from "@/components/TimeRangeSelector";
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
  TrendingDown,
  PinOff,
  Share2,
  Download,
  FileSpreadsheet,
  FileText,
  Save,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Plus,
  Eye,
  EyeOff
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

// 移动端列优先级: 'core' = 核心列(始终显示), 'important' = 重要列(默认显示), 'secondary' = 次要列(移动端隐藏)
type MobilePriority = 'core' | 'important' | 'secondary';

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  minWidth: string;
  align?: 'left' | 'right' | 'center';
  sortable: boolean;
  defaultVisible: boolean;
  sticky?: boolean;
  mobilePriority: MobilePriority; // 移动端优先级
}

const columns: ColumnConfig[] = [
  // 核心列 - 移动端始终显示
  { key: 'campaignName', label: '广告活动名称', minWidth: '250px', align: 'left', sortable: true, defaultVisible: true, sticky: true, mobilePriority: 'core' },
  { key: 'status', label: '状态', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'dailySpend', label: '当日花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'acos', label: 'ACoS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'actions', label: '操作', minWidth: '120px', align: 'center', sortable: false, defaultVisible: true, mobilePriority: 'core' },
  // 重要列 - 移动端默认显示
  { key: 'campaignType', label: '类型', minWidth: '80px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'dailyBudget', label: '日预算', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'dailySales', label: '日销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'roas', label: 'ROAS', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  // 次要列 - 移动端默认隐藏
  { key: 'billingType', label: '计费方式', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'createdAt', label: '创建日期', minWidth: '100px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'impressions', label: '曝光', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'clicks', label: '点击', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'ctr', label: '点击率', minWidth: '80px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'totalSpend', label: '累计花费', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'totalSales', label: '累计销售额', minWidth: '100px', align: 'right', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'performanceGroup', label: '所属绩效组', minWidth: '120px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'optimalBid', label: '最优出价', minWidth: '180px', align: 'center', sortable: false, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'autoOptimization', label: '自动优化', minWidth: '140px', align: 'center', sortable: false, defaultVisible: true, mobilePriority: 'secondary' },
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

// URL筛选条件配置
const filterConfigs = [
  { key: 'search', defaultValue: '' },
  { key: 'store', defaultValue: 'all' },
  { key: 'marketplace', defaultValue: 'all' },
  { key: 'type', defaultValue: 'all' },
  { key: 'billing', defaultValue: 'all' },
  { key: 'status', defaultValue: 'all' },
  { key: 'optimization', defaultValue: 'all' },
  { key: 'sort', defaultValue: '' },
  { key: 'order', defaultValue: 'asc' },
  { key: 'page', defaultValue: '1', ...serializers.string },
  { key: 'pageSize', defaultValue: '25', ...serializers.string },
];

export default function Campaigns() {
  const isMobile = useIsMobile();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  
  // URL筛选条件持久化
  const { filters, setFilter, setFilters, resetFilters, getShareableUrl } = useUrlFilters<{
    search: string;
    store: string;
    marketplace: string;
    type: string;
    billing: string;
    status: string;
    optimization: string;
    sort: string;
    order: string;
    page: string;
    pageSize: string;
  }>(filterConfigs, { debounceMs: 300 });
  
  // 从筛选状态中提取值
  const searchTerm = filters.search;
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const storeFilter = filters.store;
  const marketplaceFilter = filters.marketplace;
  const typeFilter = filters.type;
  const billingTypeFilter = filters.billing;
  const runningStatusFilter = filters.status;
  const optimizationStatusFilter = filters.optimization;
  const sortField = filters.sort as SortField | null || null;
  const sortDirection = filters.order as SortDirection;
  const currentPage = parseInt(filters.page) || 1;
  const pageSize = parseInt(filters.pageSize) || 25;
  
  // 筛选条件设置函数
  const setSearchTerm = (v: string) => setFilter('search', v);
  const setStoreFilter = (v: string) => setFilter('store', v);
  const setMarketplaceFilter = (v: string) => setFilter('marketplace', v);
  const setTypeFilter = (v: string) => setFilter('type', v);
  const setBillingTypeFilter = (v: string) => setFilter('billing', v);
  const setRunningStatusFilter = (v: string) => setFilter('status', v);
  const setOptimizationStatusFilter = (v: string) => setFilter('optimization', v);
  const setSortField = (v: SortField | null) => setFilter('sort', v || '');
  const setSortDirection = (v: SortDirection) => setFilter('order', v);
  const setCurrentPage = (v: number) => setFilter('page', String(v));
  const setPageSize = (v: number) => {
    setFilters({ pageSize: String(v), page: '1' });
  };
  
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  
  // 列宽调整和固定功能
  const resizableColumnDefs = columns.map(col => ({
    key: col.key,
    label: col.label,
    minWidth: parseInt(col.minWidth) || 80,
    maxWidth: 400,
    defaultWidth: parseInt(col.minWidth) || 150,
    resizable: col.key !== 'actions',
    pinnable: col.key !== 'actions',
    align: col.align,
  }));
  
  const {
    columnWidths,
    pinnedColumns,
    resizing,
    startResize,
    togglePin,
    resetWidths,
    resetPinned,
    getPinnedOffset,
    isPinned,
    getWidth,
  } = useResizableColumns(resizableColumnDefs, 'campaigns_columns');
  
  // 时间范围状态 - 使用TimeRangeSelector组件
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(() => getDefaultTimeRangeValue('today'));
  
  // 移动端显示更多列状态
  const [showAllColumnsOnMobile, setShowAllColumnsOnMobile] = useState(false);
  
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
  
  // 移动端实际显示的列（根据优先级过滤）
  const mobileVisibleColumns = useMemo(() => {
    if (!isMobile || showAllColumnsOnMobile) {
      return visibleColumns;
    }
    // 移动端只显示核心列和重要列
    const mobileColumns = new Set<ColumnKey>();
    columns.forEach(col => {
      if (visibleColumns.has(col.key) && (col.mobilePriority === 'core' || col.mobilePriority === 'important')) {
        mobileColumns.add(col.key);
      }
    });
    return mobileColumns;
  }, [isMobile, showAllColumnsOnMobile, visibleColumns]);
  
  // 计算隐藏的次要列数量
  const hiddenSecondaryColumnsCount = useMemo(() => {
    if (!isMobile || showAllColumnsOnMobile) return 0;
    return columns.filter(col => 
      visibleColumns.has(col.key) && col.mobilePriority === 'secondary'
    ).length;
  }, [isMobile, showAllColumnsOnMobile, visibleColumns]);

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
  
  // 筛选预设功能
  const { presets, addPreset, deletePreset } = useFilterPresets('campaigns_filter_presets');
  const [savePresetDialog, setSavePresetDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  
  // 导出加载状态
  const [isExporting, setIsExporting] = useState(false);

  // 保存列显示设置到localStorage
  useEffect(() => {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns]);

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 当选择全部站点时，不传accountId，获取所有账户的campaigns
  const shouldFetchAll = storeFilter === 'all' && marketplaceFilter === 'all';
  const accountId = shouldFetchAll ? undefined : (selectedAccountId || accounts?.[0]?.id);

  // 计算时间范围
  const dateRange = useMemo(() => {
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    return {
      startDate: formatDate(timeRangeValue.dateRange.from),
      endDate: formatDate(timeRangeValue.dateRange.to),
    };
  }, [timeRangeValue]);

  // Fetch campaigns with performance data
  const { data: campaigns, isLoading, refetch } = trpc.campaign.list.useQuery(
    { 
      accountId: accountId, 
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    },
    { enabled: shouldFetchAll || !!accountId }
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

  // Sync all data mutation (async mode)
  const syncAllMutation = trpc.amazonApi.syncAll.useMutation({
    onSuccess: (data) => {
      if (data.jobId) {
        toast.success(`同步任务已启动，正在后台执行...`);
        // 使用轮询检查同步状态
        const checkSyncStatus = async () => {
          try {
            const response = await fetch(`/api/trpc/amazonApi.getSyncJobById?input=${encodeURIComponent(JSON.stringify({ json: { jobId: data.jobId } }))}`, {
              credentials: 'include',
            });
            const result = await response.json();
            const job = result.result?.data?.json;
            if (job?.status === 'completed') {
              toast.success(`同步完成！`);
              setIsSyncing(false);
              refetch();
              return true;
            } else if (job?.status === 'failed') {
              toast.error(`同步失败: ${job.errorMessage || '未知错误'}`);
              setIsSyncing(false);
              return true;
            }
            return false;
          } catch (e) {
            return false;
          }
        };
        // 开始轮询
        const pollInterval = setInterval(async () => {
          const done = await checkSyncStatus();
          if (done) clearInterval(pollInterval);
        }, 3000);
        // 5分钟后自动停止轮询
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsSyncing(false);
        }, 300000);
      }
    },
    onError: (error) => {
      toast.error(`启动同步失败: ${error.message}`);
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

  // Filter campaigns - 使用useMemo优化性能
  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];
    
    const searchLower = debouncedSearchTerm.toLowerCase();
    
    return campaigns.filter((campaign) => {
      // 搜索匹配 - 使用防抖后的搜索词
      const matchesSearch = !searchLower || campaign.campaignName.toLowerCase().includes(searchLower);
      
      // 账号匹配
      const matchesAccount = (storeFilter === "all" && marketplaceFilter === "all") || filteredAccountIds.includes(campaign.accountId);
      
      // 类型匹配
      const matchesType = typeFilter === "all" || campaign.campaignType === typeFilter;
      
      // 计费方式匹配
      const matchesBillingType = billingTypeFilter === "all" || (campaign as any).billingType === billingTypeFilter;
      
      // 运行状态匹配
      const matchesRunningStatus = runningStatusFilter === "all" || campaign.campaignStatus === runningStatusFilter;
      
      // 优化状态匹配
      const matchesOptimizationStatus = optimizationStatusFilter === "all" || 
        (campaign as any).optimizationStatus === optimizationStatusFilter ||
        (optimizationStatusFilter === "managed" && (campaign as any).performanceGroupId) ||
        (optimizationStatusFilter === "unmanaged" && !(campaign as any).performanceGroupId);
      
      return matchesSearch && matchesAccount && matchesType && matchesBillingType && matchesRunningStatus && matchesOptimizationStatus;
    });
  }, [campaigns, debouncedSearchTerm, storeFilter, marketplaceFilter, filteredAccountIds, typeFilter, billingTypeFilter, runningStatusFilter, optimizationStatusFilter]);

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

  // 分页数据计算
  const totalItems = sortedCampaigns.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const validCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  
  // 当当前页超出范围时自动调整
  useEffect(() => {
    if (validCurrentPage !== currentPage && totalPages > 0) {
      setCurrentPage(validCurrentPage);
    }
  }, [validCurrentPage, currentPage, totalPages]);
  
  // 当前页的数据
  const paginatedCampaigns = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedCampaigns.slice(start, end);
  }, [sortedCampaigns, validCurrentPage, pageSize]);

  // 虚拟滚动配置 - 用于当前页数据优化
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 52; // 每行高度
  
  const rowVirtualizer = useVirtualizer({
    count: paginatedCampaigns.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // 预渲染10行
  });

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

  // 导出数据函数
  const handleExport = useCallback((format: 'csv' | 'excel') => {
    if (!sortedCampaigns || sortedCampaigns.length === 0) {
      toast.error('没有可导出的数据');
      return;
    }
    
    setIsExporting(true);
    
    try {
      // 准备导出列（只导出可见列）
      const exportColumns: ExportColumn[] = columns
        .filter(col => visibleColumns.has(col.key) && col.key !== 'actions' && col.key !== 'optimalBid' && col.key !== 'autoOptimization')
        .map(col => ({ key: col.key, label: col.label }));
      
      // 准备导出数据
      const exportData = sortedCampaigns.map(campaign => {
        const row: Record<string, any> = {};
        exportColumns.forEach(col => {
          switch (col.key) {
            case 'campaignName':
              row[col.key] = campaign.campaignName;
              break;
            case 'campaignType':
              const typeConfig = campaignTypes.find(t => t.value === campaign.campaignType);
              row[col.key] = typeConfig?.label || campaign.campaignType;
              break;
            case 'billingType':
              row[col.key] = billingTypeLabels[(campaign as any).billingType || 'cpc'] || (campaign as any).billingType || 'CPC';
              break;
            case 'createdAt':
              row[col.key] = campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString('zh-CN') : '';
              break;
            case 'status':
              row[col.key] = campaign.campaignStatus === 'enabled' ? '投放中' : '已暂停';
              break;
            case 'dailyBudget':
              row[col.key] = `$${parseFloat((campaign as any).dailyBudget || '0').toFixed(2)}`;
              break;
            case 'dailySpend':
              row[col.key] = `$${((campaign as any).performance?.spend || 0).toFixed(2)}`;
              break;
            case 'impressions':
              row[col.key] = (campaign as any).performance?.impressions || 0;
              break;
            case 'clicks':
              row[col.key] = (campaign as any).performance?.clicks || 0;
              break;
            case 'ctr':
              const impressions = (campaign as any).performance?.impressions || 0;
              const clicks = (campaign as any).performance?.clicks || 0;
              row[col.key] = impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : '-';
              break;
            case 'totalSpend':
              row[col.key] = `$${((campaign as any).performance?.totalSpend || 0).toFixed(2)}`;
              break;
            case 'dailySales':
              row[col.key] = `$${((campaign as any).performance?.sales || 0).toFixed(2)}`;
              break;
            case 'totalSales':
              row[col.key] = `$${((campaign as any).performance?.totalSales || 0).toFixed(2)}`;
              break;
            case 'acos':
              row[col.key] = `${((campaign as any).performance?.acos || 0).toFixed(1)}%`;
              break;
            case 'roas':
              row[col.key] = ((campaign as any).performance?.roas || 0).toFixed(2);
              break;
            case 'performanceGroup':
              const group = performanceGroups?.find(g => g.id === campaign.performanceGroupId);
              row[col.key] = group?.name || '';
              break;
            default:
              row[col.key] = (campaign as any)[col.key] || '';
          }
        });
        return row;
      });
      
      const filename = `广告活动_${new Date().toISOString().split('T')[0]}`;
      
      if (format === 'csv') {
        exportToCSV({ filename, columns: exportColumns, data: exportData });
      } else {
        exportToExcel({ filename, columns: exportColumns, data: exportData });
      }
      
      toast.success(`已导出 ${exportData.length} 条记录`);
    } catch (error) {
      toast.error('导出失败');
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  }, [sortedCampaigns, visibleColumns, performanceGroups]);

  // 保存筛选预设
  const handleSavePreset = useCallback(() => {
    if (!newPresetName.trim()) {
      toast.error('请输入预设名称');
      return;
    }
    
    const currentFilters = {
      search: filters.search,
      store: filters.store,
      marketplace: filters.marketplace,
      type: filters.type,
      billing: filters.billing,
      status: filters.status,
      optimization: filters.optimization,
    };
    
    addPreset(newPresetName.trim(), currentFilters);
    toast.success(`预设“${newPresetName.trim()}”已保存`);
    setNewPresetName('');
    setSavePresetDialog(false);
  }, [newPresetName, filters, addPreset]);

  // 应用筛选预设
  const handleApplyPreset = useCallback((preset: FilterPreset) => {
    setFilters(preset.filters);
    toast.success(`已应用预设“${preset.name}”`);
  }, [setFilters]);

  // 删除筛选预设
  const handleDeletePreset = useCallback((preset: FilterPreset, e: React.MouseEvent) => {
    e.stopPropagation();
    deletePreset(preset.id);
    toast.success(`预设“${preset.name}”已删除`);
  }, [deletePreset]);

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
      <PageMeta {...PAGE_META_CONFIG.campaigns} />
      <div className="space-y-6">
        {/* Header */}
        <div className={`flex ${isMobile ? 'flex-col gap-4' : 'items-center justify-between'}`}>
          <div>
            <h1 className={`font-bold ${isMobile ? 'text-xl' : 'text-2xl'}`}>广告活动</h1>
            <p className={`text-muted-foreground ${isMobile ? 'text-sm' : ''}`}>
              管理和优化您的亚马逊广告活动 · <span className="text-green-500">算法自动决策执行，人只做监督</span>
            </p>
          </div>
          <div className={`flex items-center gap-2 ${isMobile ? 'flex-wrap' : ''}`}>
            {/* 时间范围选择器 */}
            <TimeRangeSelector
              value={timeRangeValue}
              onChange={setTimeRangeValue}
            />
            {/* 列设置 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="w-4 h-4" />
                  {!isMobile && <span className="ml-2">列设置</span>}
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
                  重置显示列
                </DropdownMenuItem>
                <DropdownMenuItem onClick={resetWidths}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重置列宽
                </DropdownMenuItem>
                <DropdownMenuItem onClick={resetPinned}>
                  <PinOff className="w-4 h-4 mr-2" />
                  取消所有固定
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  navigator.clipboard.writeText(getShareableUrl());
                  toast.success('已复制分享链接');
                }}>
                  <Share2 className="w-4 h-4 mr-2" />
                  复制分享链接
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 导出按钮 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isExporting}>
                  <Download className="w-4 h-4" />
                  {!isMobile && <span className="ml-2">{isExporting ? '导出中...' : '导出'}</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  <FileText className="w-4 h-4 mr-2" />
                  导出 CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('excel')}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  导出 Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* 筛选预设 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Bookmark className="w-4 h-4" />
                  {!isMobile && <span className="ml-2">筛选预设</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>快捷筛选</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {presets.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    暂无保存的预设
                  </div>
                ) : (
                  presets.map((preset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      className="flex items-center justify-between group"
                      onClick={() => handleApplyPreset(preset)}
                    >
                      <div className="flex items-center">
                        <BookmarkCheck className="w-4 h-4 mr-2 text-primary" />
                        <span className="truncate max-w-[140px]">{preset.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                        onClick={(e) => handleDeletePreset(preset, e)}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSavePresetDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  保存当前筛选
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Button variant="outline" onClick={handleSyncData} disabled={isSyncing}>
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {!isMobile && <span className="ml-2">{isSyncing ? '同步中...' : '同步数据'}</span>}
            </Button>
          </div>
        </div>

        {/* 筛选器卡片 */}
        <Card>
          <CardContent className={isMobile ? 'pt-4 px-3' : 'pt-6'}>
            <MobileFilterPanel
              activeFiltersCount={
                (typeFilter !== 'all' ? 1 : 0) +
                (billingTypeFilter !== 'all' ? 1 : 0) +
                (runningStatusFilter !== 'all' ? 1 : 0) +
                (optimizationStatusFilter !== 'all' ? 1 : 0) +
                (storeFilter !== 'all' ? 1 : 0) +
                (marketplaceFilter !== 'all' ? 1 : 0) +
                (searchTerm ? 1 : 0)
              }
              onClearAll={resetFilters}
            >
            <div className="space-y-4">
              {/* 第一行：店铺和站点筛选 */}
              <div className={`flex ${isMobile ? 'flex-col gap-3' : 'flex-wrap items-center gap-4'}`}>
                {/* 店铺筛选 */}
                <div className={`flex items-center gap-2 ${isMobile ? 'w-full' : ''}`}>
                  <span className="text-sm font-medium text-foreground whitespace-nowrap">店铺:</span>
                  <Select value={storeFilter} onValueChange={setStoreFilter}>
                    <SelectTrigger className={`h-9 ${isMobile ? 'flex-1' : 'w-[180px]'}`}>
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
                <div className={`flex items-center gap-2 ${isMobile ? 'w-full' : ''}`}>
                  <span className="text-sm font-medium text-foreground whitespace-nowrap">站点:</span>
                  <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                    <SelectTrigger className={`h-9 ${isMobile ? 'flex-1' : 'w-[160px]'}`}>
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
                <div className={`${isMobile ? 'w-full' : 'flex-1 min-w-[200px]'}`}>
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
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={resetFilters}>
                      清除全部
                    </Button>
                  </div>
                </div>
              )}
            </div>

            </MobileFilterPanel>

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
            ) : paginatedCampaigns.length > 0 ? (
              <>
                <div 
                  ref={tableContainerRef}
                  className={`overflow-auto ${isMobile ? 'max-h-[400px]' : 'max-h-[600px]'}`}
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background">
                      <TableRow className="bg-muted/50">
                        {/* 复选框列 */}
                        <TableHead className="w-[40px] sticky left-0 bg-muted/50 z-30">
                          <Checkbox
                            checked={selectedCampaigns.size === paginatedCampaigns.length && paginatedCampaigns.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        {columns.filter(col => mobileVisibleColumns.has(col.key)).map((column, colIndex) => {
                          const colWidth = getWidth(column.key);
                          const colIsPinned = isPinned(column.key);
                          const pinnedOffset = colIsPinned ? getPinnedOffset(column.key) + 40 : 0; // 40 for checkbox column
                          
                          return (
                            <TableHead 
                              key={column.key}
                              className={`relative ${colIsPinned ? 'sticky bg-muted/50 z-30' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                              style={{ 
                                width: colWidth,
                                minWidth: colWidth,
                                left: colIsPinned ? pinnedOffset : undefined,
                              }}
                            >
                              <div className="flex items-center gap-1">
                                {column.sortable ? (
                                  <button
                                    className="flex items-center gap-1 hover:text-primary transition-colors flex-1"
                                    onClick={() => handleSort(column.key as SortField)}
                                  >
                                    {column.label}
                                    {getSortIcon(column.key as SortField)}
                                  </button>
                                ) : (
                                  <span className="flex-1">{column.label}</span>
                                )}
                                {column.key !== 'actions' && (
                                  <PinButton
                                    isPinned={colIsPinned}
                                    onClick={() => togglePin(column.key)}
                                  />
                                )}
                              </div>
                              {column.key !== 'actions' && (
                                <ResizeHandle
                                  onMouseDown={(e) => startResize(column.key, e)}
                                  isResizing={resizing === column.key}
                                />
                              )}
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const campaign = paginatedCampaigns[virtualRow.index];
                        if (!campaign) return null;
                        return (
                          <TableRow 
                            key={campaign.id}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            className={`hover:bg-muted/30 ${selectedCampaigns.has(campaign.id) ? 'bg-primary/5' : ''}`}
                            style={{
                              height: `${virtualRow.size}px`,
                            }}
                          >
                            {/* 复选框列 */}
                            <TableCell className="sticky left-0 bg-background z-10 w-[40px]">
                              <Checkbox
                                checked={selectedCampaigns.has(campaign.id)}
                                onCheckedChange={() => toggleSelectCampaign(campaign.id)}
                              />
                            </TableCell>
                            {columns.filter(col => mobileVisibleColumns.has(col.key)).map((column) => {
                              const colWidth = getWidth(column.key);
                              const colIsPinned = isPinned(column.key);
                              const pinnedOffset = colIsPinned ? getPinnedOffset(column.key) + 40 : 0;
                              
                              return (
                                <TableCell 
                                  key={column.key}
                                  className={`${colIsPinned ? 'sticky bg-background z-10' : ''} ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                                  style={{ 
                                    width: colWidth,
                                    minWidth: colWidth,
                                    left: colIsPinned ? pinnedOffset : undefined,
                                  }}
                                >
                                  {renderCell(campaign, column.key)}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                
                {/* 移动端显示更多列按钮 */}
                {isMobile && hiddenSecondaryColumnsCount > 0 && (
                  <div className="flex justify-center py-3 border-t border-border/50">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAllColumnsOnMobile(!showAllColumnsOnMobile)}
                      className="text-xs"
                    >
                      {showAllColumnsOnMobile ? (
                        <>
                          <EyeOff className="w-3 h-3 mr-1" />
                          隐藏次要列
                        </>
                      ) : (
                        <>
                          <Eye className="w-3 h-3 mr-1" />
                          显示更多列 ({hiddenSecondaryColumnsCount})
                        </>
                      )}
                    </Button>
                  </div>
                )}
                
                {/* 分页组件 */}
                <Pagination
                  currentPage={validCurrentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  pageSize={pageSize}
                  pageSizeOptions={[10, 25, 50, 100]}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                />
              </>
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

      {/* 保存筛选预设弹窗 */}
      <Dialog open={savePresetDialog} onOpenChange={setSavePresetDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>保存筛选预设</DialogTitle>
            <DialogDescription>
              保存当前筛选条件为预设，方便下次快速应用
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="presetName">预设名称</Label>
              <Input
                id="presetName"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="例如：SP手动活跃广告"
                onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
              />
            </div>
            <div className="space-y-2">
              <Label>当前筛选条件</Label>
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1">
                {filters.search && <div>搜索: {filters.search}</div>}
                {filters.store !== 'all' && <div>店铺: {storeOptions.find(s => s.value === filters.store)?.label}</div>}
                {filters.marketplace !== 'all' && <div>站点: {marketplaceOptions.find(m => m.value === filters.marketplace)?.label}</div>}
                {filters.type !== 'all' && <div>类型: {campaignTypes.find(t => t.value === filters.type)?.label}</div>}
                {filters.billing !== 'all' && <div>计费: {billingTypeOptions.find(b => b.value === filters.billing)?.label}</div>}
                {filters.status !== 'all' && <div>状态: {runningStatusOptions.find(s => s.value === filters.status)?.label}</div>}
                {filters.optimization !== 'all' && <div>优化: {optimizationStatusOptions.find(o => o.value === filters.optimization)?.label}</div>}
                {Object.values(filters).every(v => v === '' || v === 'all' || v === '1' || v === '25') && (
                  <div className="text-muted-foreground">无筛选条件</div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setSavePresetDialog(false);
              setNewPresetName('');
            }}>
              取消
            </Button>
            <Button onClick={handleSavePreset} disabled={!newPresetName.trim()}>
              <Save className="w-4 h-4 mr-2" />
              保存预设
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 移动端快捷操作浮动按钮 */}
      <FloatingActionButton
        actions={[
          commonActions.refresh(() => refetch()),
          commonActions.export(() => handleExport('csv')),
          {
            id: 'preset',
            icon: Bookmark,
            label: '保存筛选预设',
            onClick: () => setSavePresetDialog(true),
          },
        ]}
        mainIcon={Plus}
      />
      
      {/* 移动端底部间距 */}
      <MobileBottomSpacer />
    </DashboardLayout>
  );
}
