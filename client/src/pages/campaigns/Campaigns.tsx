import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { useCurrentStore, useCurrentMarketplace } from "@/components/GlobalAccountSelector";
// v402: SmartInsights改为懒加载，非首屏组件
const SmartInsights = lazy(() => import("@/components/SmartInsights").then(m => ({ default: m.SmartInsights })));
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebounce } from "@/hooks/useDebounce";
import { useIsMobile } from "@/hooks/useMobile";
import { MobileFilterPanel, MobileFilterRow } from "@/components/MobileFilterPanel";
import { MobileBottomSpacer } from "@/components/MobileBottomNav";
import { FloatingActionButton, FloatingAction, commonActions } from "@/components/FloatingActionButton";
import { useUrlFilters, serializers } from "@/hooks/useUrlFilters";
import { useFilterPresets, FilterPreset } from "@/hooks/useFilterPresets";
// v402: 导出功能改为动态导入，减小首屏包体积
import type { ExportColumn } from "@/utils/exportTable";
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
// v402: QuickActions改为懒加载，只在表格渲染时需要
const QuickActions = lazy(() => import("@/components/QuickActions").then(m => ({ default: m.QuickActions })));
import { trpc } from "@/lib/trpc";
import { getCurrencySymbol } from "@/utils/currency";
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
  EyeOff,
  Filter,
  ChevronDown,
  ChevronUp,
  X,
  LayoutList,
  LayoutGrid
} from "lucide-react";
import { safeGetTime, safeParseDate, safeToISODateString, safeToISOString, safeToLocaleDateString, safeToLocaleString } from '../../lib/safeDate';
import { useGlobalAccountId } from "@/hooks/useGlobalAccountId";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

// v394: OptimalBidCell拆分为独立组件，支持lazy loading
const OptimalBidCell = lazy(() => import("@/components/campaigns/OptimalBidCell"));

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

// 广告目标映射
const campaignGoalLabels: Record<string, string> = {
  // SB广告目标
  'DRIVE_PAGE_VISITS': '驱动页面访问',
  'drivePageVisits': '驱动页面访问',
  'GROW_BRAND_IMPRESSION_SHARE': '增长品牌展示份额',
  'growBrandImpressionShare': '增长品牌展示份额',
  'PROMOTE_PRODUCTS': '推广产品',
  'promoteProducts': '推广产品',
  // v500: SB Reserve SOV目标
  'RESERVE_SHARE_OF_VOICE': '预留展示份额 (Reserve SOV)',
  'reserveShareOfVoice': '预留展示份额 (Reserve SOV)',
  // SD广告目标
  'reach': '触达用户',
  'pageVisits': '驱动页面访问',
  'page_visits': '驱动页面访问',
  'drive_page_visits': '驱动页面访问',
  'conversions': '促进转化',
  // v500: SD Leads目标
  'leads': '线索收集',
};

// 广告格式映射（SB广告特有）
const adFormatLabels: Record<string, string> = {
  'productCollection': '商品集',
  'video': '视频广告',
  'storeSpotlight': '旗舰店聚焦',
  'brandVideo': '品牌视频',
};

// 列配置 - 按亚马逊后台顺序
type ColumnKey = 
  // 基本信息
  'state' | 'campaignName' | 'countryCode' | 'status' | 'campaignType' | 'targetingType' | 
  'retailer' | 'portfolioName' | 'biddingStrategy' | 'campaignGoal' | 'adFormat' |
  // 日期和预算
  'startDate' | 'endDate' | 'avgTimeInBudget' | 'budgetConverted' | 'dailyBudget' | 'costType' |
  // 曝光指标
  'impressions' | 'topOfSearchImpressionShare' | 'topOfSearchBidAdjustment' | 'productPageBidAdjustment' | 'restBidAdjustment' |
  // 点击和花费指标
  'clicks' | 'ctr' | 'spendConverted' | 'dailySpend' | 'totalSpend' | 'cpcConverted' | 'cpc' |
  // 浏览指标
  'detailPageViews' | 'brandStorePageViews' |
  // 订单和销售指标
  'orders' | 'salesConverted' | 'dailySales' | 'totalSales' | 'acos' | 'roas' |
  // 新客指标 (NTB)
  'ntbOrders' | 'ntbOrdersPercent' | 'ntbSalesConverted' | 'ntbSales' | 'ntbSalesPercent' |
  // 长期指标
  'longTermSalesConverted' | 'longTermSales' | 'longTermRoas' |
  // 触达指标
  'cumulativeReach' | 'householdReach' |
  // 可见性指标
  'viewableImpressions' | 'cpmConverted' | 'cpm' | 'vcpmConverted' | 'vcpm' |
  // 视频指标
  'videoFirstQuartile' | 'videoMidpoint' | 'videoThirdQuartile' | 'videoComplete' | 'videoUnmute' | 'vtr' | 'vctr' |
  // 系统字段
  'performanceGroup' | 'recommendedStrategy' | 'amazonCreatedDate' | 'optimalBid' | 'autoOptimization' | 'actions';

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
  // === 基本信息（按亚马逊后台顺序） ===
  { key: 'state', label: 'State', minWidth: '80px', align: 'left', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'campaignName', label: '广告活动', minWidth: '250px', align: 'left', sortable: true, defaultVisible: true, sticky: true, mobilePriority: 'core' },
  { key: 'countryCode', label: '国家', minWidth: '70px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'status', label: '状态', minWidth: '80px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'campaignType', label: '类型', minWidth: '80px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'targetingType', label: '定向', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'retailer', label: '零售商', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'portfolioName', label: '组合', minWidth: '120px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'biddingStrategy', label: '竞价策略', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 日期和预算 ===
  { key: 'startDate', label: '开始日期', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'endDate', label: '结束日期', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'avgTimeInBudget', label: '预算内时间', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'budgetConverted', label: '预算(转换)', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'dailyBudget', label: '日预算', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'costType', label: '计费类型', minWidth: '80px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'campaignGoal', label: '广告目标', minWidth: '120px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'adFormat', label: '广告格式', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 曝光指标 ===
  { key: 'impressions', label: '曝光', minWidth: '90px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'topOfSearchImpressionShare', label: '搜索顶部曝光份额', minWidth: '130px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'topOfSearchBidAdjustment', label: '搜索顶部出价调整', minWidth: '130px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'productPageBidAdjustment', label: '商品页出价调整', minWidth: '120px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'restBidAdjustment', label: '其他位置出价调整', minWidth: '130px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 点击和花费指标 ===
  { key: 'clicks', label: '点击', minWidth: '80px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'ctr', label: 'CTR', minWidth: '70px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'spendConverted', label: '花费(转换)', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'dailySpend', label: '当日花费', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'totalSpend', label: '累计花费', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'cpcConverted', label: 'CPC(转换)', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'cpc', label: 'CPC', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 浏览指标 ===
  { key: 'detailPageViews', label: '详情页浏览', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'brandStorePageViews', label: '品牌店铺浏览', minWidth: '110px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 订单和销售指标 ===
  { key: 'orders', label: '订单', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'salesConverted', label: '销售额(转换)', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'dailySales', label: '当日销售额', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  { key: 'totalSales', label: '累计销售额', minWidth: '100px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'acos', label: 'ACoS', minWidth: '70px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'core' },
  { key: 'roas', label: 'ROAS', minWidth: '70px', align: 'center', sortable: true, defaultVisible: true, mobilePriority: 'important' },
  
  // === 新客指标 (NTB - New To Brand) ===
  { key: 'ntbOrders', label: '新客订单', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'ntbOrdersPercent', label: '新客订单占比', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'ntbSalesConverted', label: '新客销售额(转换)', minWidth: '120px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'ntbSales', label: '新客销售额', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'ntbSalesPercent', label: '新客销售占比', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 长期指标 ===
  { key: 'longTermSalesConverted', label: '长期销售额(转换)', minWidth: '130px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'longTermSales', label: '长期销售额', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'longTermRoas', label: '长期ROAS', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 触达指标 ===
  { key: 'cumulativeReach', label: '累计触达', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'householdReach', label: '家庭触达', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 可见性指标 ===
  { key: 'viewableImpressions', label: '可见曝光', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'cpmConverted', label: 'CPM(转换)', minWidth: '90px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'cpm', label: 'CPM', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'vcpmConverted', label: 'VCPM(转换)', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'vcpm', label: 'VCPM', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 视频指标 ===
  { key: 'videoFirstQuartile', label: '视频25%', minWidth: '80px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'videoMidpoint', label: '视频50%', minWidth: '80px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'videoThirdQuartile', label: '视频75%', minWidth: '80px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'videoComplete', label: '视频完整播放', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'videoUnmute', label: '视频取消静音', minWidth: '100px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'vtr', label: 'VTR', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'vctr', label: 'vCTR', minWidth: '70px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  
  // === 系统字段 ===
  { key: 'amazonCreatedDate', label: '创建日期(Amazon)', minWidth: '120px', align: 'center', sortable: true, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'performanceGroup', label: '优化目标', minWidth: '140px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'recommendedStrategy', label: '建议策略模板', minWidth: '160px', align: 'left', sortable: true, defaultVisible: true, mobilePriority: 'secondary' },
  { key: 'optimalBid', label: '最优出价', minWidth: '180px', align: 'center', sortable: false, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'autoOptimization', label: '自动优化', minWidth: '140px', align: 'center', sortable: false, defaultVisible: false, mobilePriority: 'secondary' },
  { key: 'actions', label: '操作', minWidth: '120px', align: 'center', sortable: false, defaultVisible: true, mobilePriority: 'core' },
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

// 计费类型筛选选项
const costTypeOptions = [
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
    const startDate = safeParseDate(today);
    startDate.setDate(startDate.getDate() - 7);
    return {
      startDate: safeToISODateString(startDate),
      endDate: safeToISODateString(today),
    };
  }
  
  if (rangeType === 'today') {
    const dateStr = safeToISODateString(today);
    return { startDate: dateStr, endDate: dateStr };
  }
  
  if (rangeType === 'yesterday') {
    const yesterday = safeParseDate(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = safeToISODateString(yesterday);
    return { startDate: dateStr, endDate: dateStr };
  }
  
  const startDate = safeParseDate(today);
  startDate.setDate(startDate.getDate() - option.days);
  return {
    startDate: safeToISODateString(startDate),
    endDate: safeToISODateString(today),
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
  // 高级筛选参数
  { key: 'impMin', defaultValue: '' },
  { key: 'impMax', defaultValue: '' },
  { key: 'clickMin', defaultValue: '' },
  { key: 'clickMax', defaultValue: '' },
  { key: 'spendMin', defaultValue: '' },
  { key: 'spendMax', defaultValue: '' },
  { key: 'orderMin', defaultValue: '' },
  { key: 'orderMax', defaultValue: '' },
  { key: 'acosMin', defaultValue: '' },
  { key: 'acosMax', defaultValue: '' },
  { key: 'roasMin', defaultValue: '' },
  { key: 'roasMax', defaultValue: '' },
  { key: 'cpcMin', defaultValue: '' },
  { key: 'cpcMax', defaultValue: '' },
  { key: 'budgetMin', defaultValue: '' },
  { key: 'budgetMax', defaultValue: '' },
];

export default function Campaigns() {
  const isMobile = useIsMobile();
  // 使用GlobalAccountSelector的选择
  const currentStore = useCurrentStore();
  const currentMarketplace = useCurrentMarketplace();
  
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
    impMin: string;
    impMax: string;
    clickMin: string;
    clickMax: string;
    spendMin: string;
    spendMax: string;
    orderMin: string;
    orderMax: string;
    acosMin: string;
    acosMax: string;
    roasMin: string;
    roasMax: string;
    cpcMin: string;
    cpcMax: string;
    budgetMin: string;
    budgetMax: string;
  }>(filterConfigs, { debounceMs: 300 });
  
  // 从筛选状态中提取值
  const searchTerm = filters.search;
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const storeFilter = filters.store;
  const marketplaceFilter = filters.marketplace;
  const currencySymbol = marketplaceFilter && marketplaceFilter !== 'all' ? getCurrencySymbol(marketplaceFilter) : '$';
  const typeFilter = filters.type;
  const billingTypeFilter = filters.billing;
  const runningStatusFilter = filters.status;
  const optimizationStatusFilter = filters.optimization;
  const sortField = filters.sort as SortField | null || null;
  const sortDirection = filters.order as SortDirection;
  const currentPage = parseInt(filters.page) || 1;
  const pageSize = parseInt(filters.pageSize) || 25;
  
  // 筛选条件设置函数
  const setSearchTerm = (v: string) => setFilters({ search: v, page: '1' });
  const setStoreFilter = (v: string) => setFilter('store', v);
  const setMarketplaceFilter = (v: string) => setFilter('marketplace', v);
  const setTypeFilter = (v: string) => setFilters({ type: v, page: '1' });
  const setBillingTypeFilter = (v: string) => setFilters({ billing: v, page: '1' });
  const setRunningStatusFilter = (v: string) => setFilters({ status: v, page: '1' });
  const setOptimizationStatusFilter = (v: string) => setFilters({ optimization: v, page: '1' });
  const setSortField = (v: SortField | null) => setFilter('sort', v || '');
  const setSortDirection = (v: SortDirection) => setFilter('order', v);
  const setCurrentPage = (v: number) => setFilter('page', String(v));
  const setPageSize = (v: number) => {
    setFilters({ pageSize: String(v), page: '1' });
  };
  
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // 高级筛选是否激活
  const hasAdvancedFilters = !!(filters.impMin || filters.impMax || filters.clickMin || filters.clickMax || 
    filters.spendMin || filters.spendMax || filters.orderMin || filters.orderMax || 
    filters.acosMin || filters.acosMax || filters.roasMin || filters.roasMax || 
    filters.cpcMin || filters.cpcMax || filters.budgetMin || filters.budgetMax);

  // 清除所有高级筛选
  const clearAdvancedFilters = () => {
    setFilters({
      impMin: '', impMax: '', clickMin: '', clickMax: '',
      spendMin: '', spendMax: '', orderMin: '', orderMax: '',
      acosMin: '', acosMax: '', roasMin: '', roasMax: '',
      cpcMin: '', cpcMax: '', budgetMin: '', budgetMax: '',
      page: '1',
    });
  };
  
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
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(() => getDefaultTimeRangeValue('7days'));
  
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
  // P2优化: 紧凑/详细视图切换
  const [isCompactView, setIsCompactView] = useState(false);

  // 保存列显示设置到localStorage
  useEffect(() => {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns]);

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 使用GlobalAccountSelector的选择查找对应的accountId
  const accountId = useMemo(() => {
    if (!accounts || !currentStore || !currentMarketplace) return undefined;
    const account = accounts.find(a => 
      (a.storeName || a.accountName).trim() === currentStore.trim() && 
      a.marketplace === currentMarketplace
    );
    return account?.id;
  }, [accounts, currentStore, currentMarketplace]);
  
  // 同步GlobalAccountSelector的选择到URL筛选（仅用于显示）
  useEffect(() => {
    if (currentStore && currentMarketplace) {
      if (storeFilter !== currentStore) {
        setFilter('store', currentStore);
      }
      if (marketplaceFilter !== currentMarketplace) {
        setFilter('marketplace', currentMarketplace);
      }
    }
  }, [currentStore, currentMarketplace, storeFilter, marketplaceFilter, setFilter]);

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

  // v402: 后端分页版本的数据获取
  // 当有高级筛选时回退到全量模式，否则使用服务端分页
  const useServerPagination = !hasAdvancedFilters;
  
  // v402: 排序字段映射（前端字段名 -> 后端字段名）
  const backendSortField = useMemo(() => {
    if (!sortField) return undefined;
    const sortMap: Record<string, string> = {
      'campaignName': 'campaignName',
      'campaignType': 'campaignType',
      'status': 'status',
      'dailyBudget': 'dailyBudget',
      'startDate': 'startDate',
      'costType': 'costType',
      'campaignGoal': 'campaignGoal',
      'adFormat': 'adFormat',
      'impressions': 'impressions',
      'clicks': 'clicks',
      'totalSpend': 'totalSpend',
      'totalSales': 'totalSales',
      'acos': 'acos',
      'roas': 'roas',
      'ctr': 'ctr',
      'cvr': 'cvr',
      'cpc': 'cpc',
      'dailySpend': 'dailySpend',
      'dailySales': 'dailySales',
    };
    return sortMap[sortField] || undefined;
  }, [sortField]);
  
  const { data: paginatedResponse, isLoading, refetch } = trpc.campaign.listPaginated.useQuery(
    { 
      accountId: accountId!, 
      marketplace: currentMarketplace || undefined,
      // @ts-ignore
      timeRange: (timeRangeValue.preset === 'custom' ? 'custom' : timeRangeValue.preset) as unknown,
      startDate: timeRangeValue.preset === 'custom' ? dateRange.startDate : undefined,
      endDate: timeRangeValue.preset === 'custom' ? dateRange.endDate : undefined,
      // v402: 分页参数
      page: useServerPagination ? currentPage : 1,
      pageSize: useServerPagination ? pageSize : 10000, // 全量模式时获取所有数据
      sortField: useServerPagination ? backendSortField : undefined,
      sortDirection: useServerPagination ? sortDirection : undefined,
      search: useServerPagination ? debouncedSearchTerm || undefined : undefined,
      campaignType: useServerPagination ? (typeFilter !== 'all' ? typeFilter : undefined) : undefined,
      campaignStatus: useServerPagination ? (runningStatusFilter !== 'all' ? runningStatusFilter : undefined) : undefined,
      optimizationStatus: useServerPagination ? (optimizationStatusFilter !== 'all' ? optimizationStatusFilter : undefined) : undefined,
      serverPagination: useServerPagination,
    },
    { enabled: !!accountId, staleTime: 2 * 60 * 1000, keepPreviousData: true } // v386: 2分钟缓存
  );
  
  // v402: 从分页响应中提取数据
  // @ts-ignore
  const campaigns = paginatedResponse?.data || [];
  // @ts-ignore
  const serverTotal = paginatedResponse?.total || 0;
  // @ts-ignore
  const serverFilteredTotal = paginatedResponse?.filteredTotal || 0;
  // @ts-ignore
  const serverStatusCounts = paginatedResponse?.statusCounts;
  const serverTypeCounts = (paginatedResponse as any)?.typeCounts;

  // Fetch performance groups for assignment
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId, staleTime: 5 * 60 * 1000 } // v386: 5分钟缓存
  );

  // Update campaign mutation - v221: 添加乐观更新，用户操作后立即显示预期结果
  const updateCampaign = trpc.campaign.update.useMutation({
    onSuccess: () => {
      toast.success("广告活动已更新");
      // 延迟2秒后refetch，给后端确认同步时间
      setTimeout(() => refetch(), 2000);
    },
    onError: (err, variables, context) => {
      toast.error("更新失败，已恢复原始状态");
      // 失败时立即回滚并重新获取数据
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
            // v407.1: 必须携带Authorization header
            const syncToken = localStorage.getItem('authToken');
            const syncHeaders: Record<string, string> = {};
            if (syncToken) {
              syncHeaders['Authorization'] = `Bearer ${syncToken}`;
            }
            const response = await fetch(`/api/trpc/amazonApi.getSyncJobById?input=${encodeURIComponent(JSON.stringify({ json: { jobId: data.jobId } }))}`, {
              credentials: 'include',
              headers: syncHeaders,
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
        // 30分钟后自动停止轮询
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsSyncing(false);
        }, 1800000);
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
    const storeSet = new Set(accounts.map(a => (a.storeName || a.accountName).trim()).filter(Boolean));
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
        const matchesStore = storeFilter === "all" || (a.storeName || a.accountName).trim() === storeFilter;
        const matchesMarketplace = marketplaceFilter === "all" || a.marketplace === marketplaceFilter;
        return matchesStore && matchesMarketplace;
      })
      .map(a => a.id);
  }, [accounts, storeFilter, marketplaceFilter]);

  // Filter campaigns - 使用useMemo优化性能
  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];
    
    const searchLower = debouncedSearchTerm.toLowerCase();
    
    return campaigns.filter((campaign: unknown) => {
      // 搜索匹配 - 使用防抖后的搜索词
      const matchesSearch = !searchLower || (campaign as any).campaignName.toLowerCase().includes(searchLower);
      
      // 账号匹配
      const matchesAccount = (storeFilter === "all" && marketplaceFilter === "all") || filteredAccountIds.includes((campaign as any).accountId);
      
      // 类型匹配
      const matchesType = typeFilter === "all" || (campaign as any).campaignType === typeFilter;
      
      // 计费方式匹配
      const matchesBillingType = billingTypeFilter === "all" || (campaign as Record<string, unknown>).billingType === billingTypeFilter;
      
      // 运行状态匹配
      const matchesRunningStatus = runningStatusFilter === "all" || (campaign as any).campaignStatus === runningStatusFilter;
      
      // 优化状态匹配
      const matchesOptimizationStatus = optimizationStatusFilter === "all" || 
        (campaign as Record<string, unknown>).optimizationStatus === optimizationStatusFilter ||
        (optimizationStatusFilter === "managed" && (campaign as Record<string, unknown>).performanceGroupId) ||
        (optimizationStatusFilter === "unmanaged" && !(campaign as Record<string, unknown>).performanceGroupId);
      
      // 高级筛选 - 曝光
      const impressions = Number((campaign as any).impressions) || 0;
      const matchesImpMin = !filters.impMin || impressions >= Number(filters.impMin);
      const matchesImpMax = !filters.impMax || impressions <= Number(filters.impMax);
      
      // 高级筛选 - 点击
      const clicks = Number((campaign as any).clicks) || 0;
      const matchesClickMin = !filters.clickMin || clicks >= Number(filters.clickMin);
      const matchesClickMax = !filters.clickMax || clicks <= Number(filters.clickMax);
      
      // 高级筛选 - 花费
      const spend = Number((campaign as Record<string, unknown>).totalSpend) || Number((campaign as Record<string, unknown>).spendConverted) || 0;
      const matchesSpendMin = !filters.spendMin || spend >= Number(filters.spendMin);
      const matchesSpendMax = !filters.spendMax || spend <= Number(filters.spendMax);
      
      // 高级筛选 - 订单数
      const orders = Number((campaign as Record<string, unknown>).orders) || 0;
      const matchesOrderMin = !filters.orderMin || orders >= Number(filters.orderMin);
      const matchesOrderMax = !filters.orderMax || orders <= Number(filters.orderMax);
      
      // 高级筛选 - ACoS
      const acos = Number((campaign as Record<string, unknown>).acos) || 0;
      const matchesAcosMin = !filters.acosMin || acos >= Number(filters.acosMin);
      const matchesAcosMax = !filters.acosMax || acos <= Number(filters.acosMax);
      
      // 高级筛选 - ROAS
      const roas = Number((campaign as Record<string, unknown>).roas) || 0;
      const matchesRoasMin = !filters.roasMin || roas >= Number(filters.roasMin);
      const matchesRoasMax = !filters.roasMax || roas <= Number(filters.roasMax);
      
      // 高级筛选 - CPC
      const cpc = Number((campaign as Record<string, unknown>).cpc) || Number((campaign as Record<string, unknown>).cpcConverted) || 0;
      const matchesCpcMin = !filters.cpcMin || cpc >= Number(filters.cpcMin);
      const matchesCpcMax = !filters.cpcMax || cpc <= Number(filters.cpcMax);
      
      // 高级筛选 - 日预算
      const budget = Number((campaign as Record<string, unknown>).dailyBudget) || 0;
      const matchesBudgetMin = !filters.budgetMin || budget >= Number(filters.budgetMin);
      const matchesBudgetMax = !filters.budgetMax || budget <= Number(filters.budgetMax);
      
      return matchesSearch && matchesAccount && matchesType && matchesBillingType && matchesRunningStatus && matchesOptimizationStatus &&
        matchesImpMin && matchesImpMax && matchesClickMin && matchesClickMax &&
        matchesSpendMin && matchesSpendMax && matchesOrderMin && matchesOrderMax &&
        matchesAcosMin && matchesAcosMax && matchesRoasMin && matchesRoasMax &&
        matchesCpcMin && matchesCpcMax && matchesBudgetMin && matchesBudgetMax;
    });
  }, [campaigns, debouncedSearchTerm, storeFilter, marketplaceFilter, filteredAccountIds, typeFilter, billingTypeFilter, runningStatusFilter, optimizationStatusFilter, filters.impMin, filters.impMax, filters.clickMin, filters.clickMax, filters.spendMin, filters.spendMax, filters.orderMin, filters.orderMax, filters.acosMin, filters.acosMax, filters.roasMin, filters.roasMax, filters.cpcMin, filters.cpcMax, filters.budgetMin, filters.budgetMax]);

  // v402: 使用服务端返回的状态统计（基于全量数据，不受分页影响）
  const statusCounts = useMemo(() => {
    if (serverStatusCounts) {
      return {
        enabled: serverStatusCounts.enabled || 0,
        paused: serverStatusCounts.paused || 0,
        managed: serverStatusCounts.managed || 0,
        unmanaged: serverStatusCounts.unmanaged || 0,
      };
    }
    // 回退：从当前数据计算
    if (!campaigns) return { enabled: 0, paused: 0, managed: 0, unmanaged: 0 };
    return campaigns.reduce((acc: unknown, campaign: unknown) => {
      if ((campaign as any).campaignStatus === 'enabled') (acc as any).enabled++;
      if ((campaign as any).campaignStatus === 'paused') (acc as any).paused++;
      if ((campaign as Record<string, unknown>).performanceGroupId) (acc as any).managed++;
      else (acc as any).unmanaged++;
      return acc;
    }, { enabled: 0, paused: 0, managed: 0, unmanaged: 0 });
  }, [serverStatusCounts, campaigns]);

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
    // @ts-ignore
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
      // @ts-ignore
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
    
    return [...filteredCampaigns].sort((a: unknown, b: unknown) => {
      let aValue: unknown;
      let bValue: unknown;
      
      switch (sortField) {
        case 'campaignName':
          aValue = (a as any).campaignName.toLowerCase();
          bValue = (b as any).campaignName.toLowerCase();
          break;
        case 'campaignType':
          aValue = (a as any).campaignType;
          bValue = (b as any).campaignType;
          break;
        case 'costType':
          aValue = (a as Record<string, unknown>).costType || 'cpc';
          bValue = (b as Record<string, unknown>).costType || 'cpc';
          break;
        case 'campaignGoal':
          aValue = (a as Record<string, unknown>).campaignGoal || '';
          bValue = (b as Record<string, unknown>).campaignGoal || '';
          break;
        case 'adFormat':
          aValue = (a as Record<string, unknown>).adFormat || '';
          bValue = (b as Record<string, unknown>).adFormat || '';
          break;
        case 'startDate':
          aValue = safeGetTime((a as Record<string, unknown>).startDate || 0);
          bValue = safeGetTime((b as Record<string, unknown>).startDate || 0);
          break;
        case 'status':
          aValue = (a as any).campaignStatus || '';
          bValue = (b as any).campaignStatus || '';
          break;
        case 'dailyBudget':
          // @ts-ignore
          aValue = parseFloat((a as Record<string, unknown>).dailyBudget || '0');
          // @ts-ignore
          bValue = parseFloat((b as Record<string, unknown>).dailyBudget || '0');
          break;
        case 'dailySpend':
          // @ts-ignore
          aValue = parseFloat((a as Record<string, unknown>).dailySpend || '0');
          // @ts-ignore
          bValue = parseFloat((b as Record<string, unknown>).dailySpend || '0');
          break;
        case 'impressions':
          aValue = (a as any).impressions || 0;
          bValue = (b as any).impressions || 0;
          break;
        case 'clicks':
          aValue = (a as any).clicks || 0;
          bValue = (b as any).clicks || 0;
          break;
        case 'ctr':
          aValue = (a as any).impressions ? ((a as any).clicks || 0) / (a as any).impressions : 0;
          bValue = (b as any).impressions ? ((b as any).clicks || 0) / (b as any).impressions : 0;
          break;
        case 'totalSpend':
          aValue = parseFloat((a as any).spend || '0');
          bValue = parseFloat((b as any).spend || '0');
          break;
        case 'dailySales':
          // @ts-ignore
          aValue = parseFloat((a as Record<string, unknown>).dailySales || '0');
          // @ts-ignore
          bValue = parseFloat((b as Record<string, unknown>).dailySales || '0');
          break;
        case 'totalSales':
          aValue = parseFloat((a as any).sales || '0');
          bValue = parseFloat((b as any).sales || '0');
          break;
        case 'acos':
          aValue = parseFloat((a as any).acos || '0');
          bValue = parseFloat((b as any).acos || '0');
          break;
        case 'roas':
          aValue = parseFloat((a as any).roas || '0');
          bValue = parseFloat((b as any).roas || '0');
          break;
        case 'performanceGroup':
          // @ts-ignore
          aValue = getPerformanceGroupName((a as Record<string, unknown>).performanceGroupId);
          // @ts-ignore
          bValue = getPerformanceGroupName((b as Record<string, unknown>).performanceGroupId);
          break;
        default:
          return 0;
      }
      
      if ((aValue as any) < (bValue as any)) return sortDirection === 'asc' ? -1 : 1;
      if ((aValue as any) > (bValue as any)) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredCampaigns, sortField, sortDirection, performanceGroups]);

  // v402: 分页数据计算 - 服务端分页模式 vs 前端分页模式
  const totalItems = useServerPagination ? serverFilteredTotal : sortedCampaigns.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const validCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  
  // 当当前页超出范围时自动调整
  useEffect(() => {
    if (validCurrentPage !== currentPage && totalPages > 0) {
      setCurrentPage(validCurrentPage);
    }
  }, [validCurrentPage, currentPage, totalPages]);
  
  // v402: 当前页的数据
  // 服务端分页模式：后端已分页，直接使用sortedCampaigns（即后端返回的当前页数据）
  // 前端分页模式：前端分页，从全量数据中截取
  const paginatedCampaigns = useMemo(() => {
    if (useServerPagination) {
      // 服务端已分页，直接使用
      return sortedCampaigns;
    }
    // 前端分页模式
    const start = (validCurrentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedCampaigns.slice(start, end);
  }, [sortedCampaigns, validCurrentPage, pageSize, useServerPagination]);

  // 虚拟滚动配置 - 用于当前页数据优化
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = isCompactView ? 40 : 52; // P2优化: 紧凑视图行高降低
  
  const rowVirtualizer = useVirtualizer({
    count: paginatedCampaigns.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // 预渲染10行
  });

  // v402: 使用服务端返回的类型统计
  const typeCounts = useMemo(() => {
    if (serverTypeCounts) return serverTypeCounts;
    // 回退：从当前数据计算
    return campaigns?.reduce((acc: unknown, campaign: unknown) => {
      (acc as any)[(campaign as any).campaignType] = ((acc as any)[(campaign as any).campaignType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
  }, [serverTypeCounts, campaigns]);

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
    const date = safeParseDate(dateStr);
    return safeToLocaleDateString(date, 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
  const handleExport = useCallback(async (format: 'csv' | 'excel') => {
    // @ts-ignore
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
      // @ts-ignore
      const exportData = sortedCampaigns.map(campaign => {
        const row: Record<string, unknown> = {};
        exportColumns.forEach(col => {
          switch (col.key) {
            case 'campaignName':
              row[col.key] = campaign.campaignName;
              break;
            case 'campaignType':
              const typeConfig = campaignTypes.find(t => t.value === campaign.campaignType);
              row[col.key] = typeConfig?.label || campaign.campaignType;
              break;
            case 'costType':
              // @ts-ignore
              row[col.key] = billingTypeLabels[(campaign as Record<string, unknown>).costType || 'cpc'] || (campaign as Record<string, unknown>).costType || 'CPC';
              break;
            case 'campaignGoal':
              // @ts-ignore
              row[col.key] = campaignGoalLabels[(campaign as Record<string, unknown>).campaignGoal] || (campaign as Record<string, unknown>).campaignGoal || '-';
              break;
            case 'adFormat':
              // @ts-ignore
              row[col.key] = adFormatLabels[(campaign as Record<string, unknown>).adFormat] || (campaign as Record<string, unknown>).adFormat || '-';
              break;
            case 'startDate':
              row[col.key] = (campaign as Record<string, unknown>).startDate ? safeToLocaleDateString((campaign as Record<string, unknown>).startDate, 'zh-CN') : '';
              break;
            case 'status':
              row[col.key] = campaign.campaignStatus === 'enabled' ? '投放中' : '已暂停';
              break;
            case 'dailyBudget':
              // @ts-ignore
              row[col.key] = `${currencySymbol}${parseFloat((campaign as Record<string, unknown>).dailyBudget || '0').toFixed(2)}`;
              break;
            case 'dailySpend':
              row[col.key] = `${currencySymbol}${(((campaign as Record<string, unknown>).performance as any)?.spend || 0).toFixed(2)}`;
              break;
            case 'impressions':
              row[col.key] = ((campaign as Record<string, unknown>).performance as any)?.impressions || 0;
              break;
            case 'clicks':
              row[col.key] = ((campaign as Record<string, unknown>).performance as any)?.clicks || 0;
              break;
            case 'ctr':
              // @ts-ignore
              const impressions = (campaign as Record<string, unknown>).performance?.impressions || 0;
              const clicks = ((campaign as Record<string, unknown>).performance as any)?.clicks || 0;
              row[col.key] = impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : '-';
              break;
            case 'totalSpend':
              row[col.key] = `${currencySymbol}${(((campaign as Record<string, unknown>).performance as any)?.totalSpend || 0).toFixed(2)}`;
              break;
            case 'dailySales':
              row[col.key] = `${currencySymbol}${(((campaign as Record<string, unknown>).performance as any)?.sales || 0).toFixed(2)}`;
              break;
            case 'totalSales':
              row[col.key] = `${currencySymbol}${(((campaign as Record<string, unknown>).performance as any)?.totalSales || 0).toFixed(2)}`;
              break;
            case 'acos':
              row[col.key] = `${(((campaign as Record<string, unknown>).performance as any)?.acos || 0).toFixed(1)}%`;
              break;
            case 'roas':
              row[col.key] = (((campaign as Record<string, unknown>).performance as any)?.roas || 0).toFixed(2);
              break;
            case 'performanceGroup':
              const group = performanceGroups?.find(g => g.id === campaign.performanceGroupId);
              row[col.key] = group?.name || '';
              break;
            default:
              row[col.key] = (campaign as Record<string, unknown>)[col.key] || '';
          }
        });
        return row;
      });
      
      const filename = `广告活动_${safeToISODateString(new Date())}`;
      
      // v402: 动态导入导出工具，减小首屏包体积
      const { exportToCSV, exportToExcel } = await import("@/utils/exportTable");
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
    // @ts-ignore
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
    // @ts-ignore
    toast.success(`预设“${preset.name}”已删除`);
  // @ts-ignore
  }, [deletePreset]);

  // 处理暂停/启用操作
  const handleToggleStatus = (campaign: unknown) => {
    const newStatus = (campaign as any).campaignStatus === "enabled" ? "paused" : "enabled";
    const isHighRisk = (campaign as any).campaignStatus === "enabled";
    
    // @ts-ignore
    showConfirm({
      operationType: newStatus === "paused" ? 'campaign_pause' : 'campaign_enable',
      title: newStatus === "paused" ? '暂停广告活动' : '启用广告活动',
      description: `您即将${newStatus === "paused" ? '暂停' : '启用'}广告活动"${(campaign as any).campaignName}"`,
      changes: [{
        id: (campaign as any).id,
        name: (campaign as any).campaignName,
        field: 'status',
        fieldLabel: '状态',
        oldValue: (campaign as any).campaignStatus === "enabled" ? '启用中' : '已暂停',
        newValue: newStatus === "paused" ? '已暂停' : '启用中',
      }],
      warningMessage: isHighRisk 
        // @ts-ignore
        ? '暂停广告活动将立即停止广告展示，可能影响销售' 
        : undefined,
      onConfirm: () => {
        updateCampaign.mutate({
          id: (campaign as any).id,
          campaignStatus: newStatus,
        // @ts-ignore
        });
      },
    });
  };

  // 处理编辑预算
  const handleEditBudget = (campaign: unknown) => {
    // @ts-ignore
    setEditBudgetDialog({
      open: true,
      campaignId: (campaign as any).id,
      campaignName: (campaign as any).campaignName,
      // @ts-ignore
      currentBudget: parseFloat((campaign as Record<string, unknown>).dailyBudget || '0'),
      // @ts-ignore
      newBudget: (campaign as Record<string, unknown>).dailyBudget || '0',
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
        oldValue: `${currencySymbol}${editBudgetDialog.currentBudget.toFixed(2)}`,
        newValue: `${currencySymbol}${newBudget.toFixed(2)}`,
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
    // @ts-ignore
    });
  // @ts-ignore
  };

  // 渲染单元格内容
  const renderCell = (campaign: unknown, columnKey: ColumnKey) => {
    // @ts-ignore
    const typeConfig = getCampaignTypeConfig(campaign.campaignType);
    // @ts-ignore
    const dailySpend = parseFloat((campaign as Record<string, unknown>).dailySpend || "0");
    const totalSpend = parseFloat((campaign as any).spend || "0");
    // @ts-ignore
    const dailySales = parseFloat((campaign as Record<string, unknown>).dailySales || "0");
    const totalSales = parseFloat((campaign as any).sales || "0");
    // @ts-ignore
    const dailyBudget = parseFloat((campaign as Record<string, unknown>).dailyBudget || "0");
    const impressions = Number((campaign as any).impressions) || 0;
    const clicks = Number((campaign as any).clicks) || 0;

    switch (columnKey) {
      case 'campaignName': {
        // P2优化: 自动提取广告活动名称中的关键信息生成简短标签
        const name = (campaign as any).campaignName;
        const extractTags = (n: string) => {
          const tags: { label: string; color: string }[] = [];
          // 提取广告类型
          if (/\bSP\b/i.test(n)) tags.push({ label: 'SP', color: 'bg-blue-500/15 text-blue-600' });
          else if (/\bSB\b/i.test(n)) tags.push({ label: 'SB', color: 'bg-purple-500/15 text-purple-600' });
          else if (/\bSD\b/i.test(n)) tags.push({ label: 'SD', color: 'bg-orange-500/15 text-orange-600' });
          // 提取匹配方式
          if (/Exact/i.test(n)) tags.push({ label: '精确', color: 'bg-green-500/15 text-green-600' });
          else if (/Phrase/i.test(n)) tags.push({ label: '词组', color: 'bg-amber-500/15 text-amber-600' });
          else if (/Broad/i.test(n)) tags.push({ label: '广泛', color: 'bg-red-500/15 text-red-600' });
          // 提取ASIN
          const asinMatch = n.match(/B0[A-Z0-9]{8}/i);
          if (asinMatch) tags.push({ label: asinMatch[0], color: 'bg-gray-500/15 text-gray-600' });
          return tags;
        };
        const tags = extractTags(name);
        return (
          <div className="max-w-[280px]" title={name}>
            {/* @ts-ignore */}
            <a 
              // @ts-ignore
              href={`/campaigns/${campaign.id}`}
              className="text-primary hover:underline cursor-pointer text-sm font-medium block truncate"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = `/campaigns/${(campaign as any).id}`;
              }}
            >
              {/* @ts-ignore */}
              {name}
            </a>
            {tags.length > 0 && (
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {tags.map((tag: unknown, i: unknown) => (
                  <span key={String(i)} className={`text-[10px] px-1.5 py-0 rounded-sm font-medium ${(tag as any).color}`}>
                    {(tag as any).label}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'campaignType':
        return (
          <Badge variant="outline" className={typeConfig.color}>
            {getCampaignTypeLabel((campaign as any).campaignType)}
          </Badge>
        );
      case 'costType':
        return (
          <span className="text-sm text-muted-foreground">
            {billingTypeLabels[((campaign as Record<string, unknown>).costType) as string] || "CPC (按点击)"}
          </span>
        );
      case 'campaignGoal': {
        const goal = (campaign as Record<string, unknown>).campaignGoal;
        if (!goal) {
          // SP广告没有goal字段，显示“-”
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        // @ts-ignore
        const goalLabel = campaignGoalLabels[goal] || goal;
        // 根据目标类型显示不同颜色
        const isImpressionGoal = goal === 'GROW_BRAND_IMPRESSION_SHARE' || goal === 'growBrandImpressionShare' || goal === 'reach';
        return (
          <Badge variant="outline" className={isImpressionGoal ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' : 'bg-blue-500/10 text-blue-600 border-blue-500/20'}>
            {goalLabel}
          </Badge>
        );
      }
      case 'adFormat': {
        const format = (campaign as Record<string, unknown>).adFormat;
        if (!format) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        return (
          <span className="text-sm text-muted-foreground">
            {String(adFormatLabels[(format as any)] || format)}
          </span>
        );
      }
      case 'startDate':
        return (
          <span className="text-sm text-muted-foreground">
            {formatDate(((campaign as Record<string, unknown>).startDate as any))}
          </span>
        );
      case 'endDate':
        return (
          <span className="text-sm text-muted-foreground">
            {(campaign as Record<string, unknown>).endDate ? formatDate(((campaign as Record<string, unknown>).endDate as any)) : '-'}
          </span>
        );
      case 'state':
        return (
          <span className="text-sm text-muted-foreground capitalize">
            {(campaign as Record<string, unknown>).state || (campaign as any).campaignStatus || '-'}
          </span>
        );
      case 'countryCode':
        return (
          <span className="text-sm font-medium">
            {String((campaign as Record<string, unknown>).countryCode || '-')}
          </span>
        );
      case 'targetingType':
        return (
          <span className="text-sm text-muted-foreground capitalize">
            {String((campaign as Record<string, unknown>).targetingType || '-')}
          </span>
        );
      case 'retailer':
        return (
          <span className="text-sm text-muted-foreground">
            {String((campaign as Record<string, unknown>).retailer || '-')}
          </span>
        );
      case 'portfolioName':
        return (
          <span className="text-sm text-muted-foreground">
            {String((campaign as Record<string, unknown>).portfolioName || '-')}
          </span>
        );
      case 'biddingStrategy':
        const strategyLabels: Record<string, string> = {
          'legacyForSales': '动态竞价-仅降低',
          'autoForSales': '动态竞价-提高和降低',
          'manual': '固定竞价',
          'ruleBasedBidding': '规则竞价'
        };
        return (
          <span className="text-sm text-muted-foreground">
            {String(strategyLabels[((campaign as Record<string, unknown>).biddingStrategy) as string] || (campaign as Record<string, unknown>).biddingStrategy || '-')}
          </span>
        );
      case 'avgTimeInBudget':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).avgTimeInBudget ? `${parseFloat(((campaign as Record<string, unknown>).avgTimeInBudget as any)).toFixed(1)}%` : '-'}
          </span>
        );
      case 'budgetConverted':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).budgetConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).budgetConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'topOfSearchImpressionShare':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).topOfSearchImpressionShare ? `${parseFloat(((campaign as Record<string, unknown>).topOfSearchImpressionShare as any)).toFixed(1)}%` : '-'}
          </span>
        );
      case 'topOfSearchBidAdjustment':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).placementTopSearchBidAdjustment ? `${(campaign as Record<string, unknown>).placementTopSearchBidAdjustment}%` : '-'}
          </span>
        );
      case 'productPageBidAdjustment':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).placementProductPageBidAdjustment ? `${(campaign as Record<string, unknown>).placementProductPageBidAdjustment}%` : '-'}
          </span>
        );
      case 'restBidAdjustment':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).placementRestBidAdjustment ? `${(campaign as Record<string, unknown>).placementRestBidAdjustment}%` : '-'}
          </span>
        );
      case 'spendConverted':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).spendConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).spendConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'cpcConverted':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).cpcConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).cpcConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'cpc':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).cpc ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).cpc as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'detailPageViews':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).detailPageViews || 0).toLocaleString()}
          </span>
        );
      case 'brandStorePageViews':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).brandStorePageViews || 0).toLocaleString()}
          </span>
        );
      case 'orders':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).orders || 0).toLocaleString()}
          </span>
        );
      case 'salesConverted':
        return (
          <span className="text-sm tabular-nums text-green-600">
            {(campaign as Record<string, unknown>).salesConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).salesConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'ntbOrders':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).ntbOrders || 0).toLocaleString()}
          </span>
        );
      case 'ntbOrdersPercent':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).ntbOrdersPercent ? `${parseFloat(((campaign as Record<string, unknown>).ntbOrdersPercent as any)).toFixed(1)}%` : '-'}
          </span>
        );
      case 'ntbSalesConverted':
        return (
          <span className="text-sm tabular-nums text-green-600">
            {(campaign as Record<string, unknown>).ntbSalesConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).ntbSalesConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'ntbSales':
        return (
          <span className="text-sm tabular-nums text-green-600">
            {(campaign as Record<string, unknown>).ntbSales ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).ntbSales as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'ntbSalesPercent':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).ntbSalesPercent ? `${parseFloat(((campaign as Record<string, unknown>).ntbSalesPercent as any)).toFixed(1)}%` : '-'}
          </span>
        );
      case 'longTermSalesConverted':
        return (
          <span className="text-sm tabular-nums text-green-600">
            {(campaign as Record<string, unknown>).longTermSalesConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).longTermSalesConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'longTermSales':
        return (
          <span className="text-sm tabular-nums text-green-600">
            {(campaign as Record<string, unknown>).longTermSales ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).longTermSales as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'longTermRoas':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).longTermRoas ? parseFloat(((campaign as Record<string, unknown>).longTermRoas as any)).toFixed(2) : '-'}
          </span>
        );
      case 'cumulativeReach':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).cumulativeReach || 0).toLocaleString()}
          </span>
        );
      case 'householdReach':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).householdReach || 0).toLocaleString()}
          </span>
        );
      case 'viewableImpressions':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).viewableImpressions || 0).toLocaleString()}
          </span>
        );
      case 'cpmConverted':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).cpmConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).cpmConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'cpm':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).cpm ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).cpm as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'vcpmConverted':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).vcpmConverted ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).vcpmConverted as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'vcpm':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).vcpm ? `${currencySymbol}${parseFloat(((campaign as Record<string, unknown>).vcpm as any)).toFixed(2)}` : '-'}
          </span>
        );
      case 'videoFirstQuartile':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).videoFirstQuartile || 0).toLocaleString()}
          </span>
        );
      case 'videoMidpoint':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).videoMidpoint || 0).toLocaleString()}
          </span>
        );
      case 'videoThirdQuartile':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).videoThirdQuartile || 0).toLocaleString()}
          </span>
        );
      case 'videoComplete':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).videoComplete || 0).toLocaleString()}
          </span>
        );
      case 'videoUnmute':
        return (
          <span className="text-sm tabular-nums">
            {((campaign as Record<string, unknown>).videoUnmute || 0).toLocaleString()}
          </span>
        );
      case 'vtr':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).vtr ? `${(parseFloat(((campaign as Record<string, unknown>).vtr as any)) * 100).toFixed(2)}%` : '-'}
          </span>
        );
      case 'vctr':
        return (
          <span className="text-sm tabular-nums">
            {(campaign as Record<string, unknown>).vctr ? `${(parseFloat(((campaign as Record<string, unknown>).vctr as any)) * 100).toFixed(2)}%` : '-'}
          </span>
        );
      case 'status':
        return getStatusBadge((campaign as any).campaignStatus || 'paused');
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
        const acos = parseFloat((campaign as any).acos || "0");
        return (
          <span className={`tabular-nums ${acos > 30 ? "text-red-500" : acos > 20 ? "text-orange-500" : "text-green-500"}`}>
            {acos.toFixed(1)}%
          </span>
        );
      case 'roas':
        const roas = parseFloat((campaign as any).roas || "0");
        return (
          <span className={`tabular-nums ${roas < 2 ? "text-red-500" : roas < 3 ? "text-orange-500" : "text-green-500"}`}>
            {roas.toFixed(2)}
          </span>
        );
      case 'performanceGroup':
        const pgName = (campaign as Record<string, unknown>).performanceGroupName;
        const pgStrategy = (campaign as Record<string, unknown>).performanceGroupStrategyTemplate;
        if (pgName) {
          return (
            <div className="flex flex-col gap-0.5">
              {/* @ts-ignore */}
              <div className="flex items-center gap-1">
                {/* @ts-ignore */}
                <Target className="w-3 h-3 text-blue-500" />
                <span className="text-sm font-medium truncate max-w-[120px]" title={String(pgName)}>{String(pgName)}</span>
              </div>
              {pgStrategy && (
                <span className="text-xs text-muted-foreground truncate max-w-[120px]" title={`策略: ${pgStrategy}`}>
                  策略: {String(pgStrategy)}
                </span>
              )}
            </div>
          );
        }
        return (
          <Select
            value={(campaign as Record<string, unknown>).performanceGroupId?.toString() || ""}
            onValueChange={(value) => {
              assignToGroup.mutate({
                campaignId: (campaign as any).id,
                performanceGroupId: parseInt(value),
              });
            }}
          >
            {/* @ts-ignore */}
            <SelectTrigger className="h-8 w-[110px]">
              {/* @ts-ignore */}
              <SelectValue placeholder="选择优化目标" />
            </SelectTrigger>
            <SelectContent>
              {performanceGroups?.map((group: unknown) => (
                <SelectItem key={(group as any).id} value={(group as any).id.toString()}>
                  {(group as any).name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'recommendedStrategy':
        const recTemplateId = (campaign as Record<string, unknown>).recommendedStrategyTemplateId;
        const recTemplateName = (campaign as Record<string, unknown>).recommendedStrategyTemplateName;
        const recReason = (campaign as Record<string, unknown>).recommendationReason;
        if (!recTemplateName) {
          return <span className="text-xs text-muted-foreground">待分析</span>;
        }
        const strategyColorMap: Record<string, string> = {
          'aggressive-growth': 'bg-red-100 text-red-700 border-red-200',
          'balanced': 'bg-blue-100 text-blue-700 border-blue-200',
          'profit-focused': 'bg-green-100 text-green-700 border-green-200',
          'seasonal-boost': 'bg-yellow-100 text-yellow-700 border-yellow-200',
          'brand-defense': 'bg-purple-100 text-purple-700 border-purple-200',
        };
        // @ts-ignore
        const strategyColor = strategyColorMap[recTemplateId] || 'bg-gray-100 text-gray-700 border-gray-200';
        return (
          // @ts-ignore
          <div className="flex flex-col gap-0.5" title={recReason || ''}>
            {/* @ts-ignore */}
            <Badge variant="outline" className={`text-xs px-2 py-0.5 ${strategyColor}`}>
                {String(recTemplateName)}
            </Badge>
            {recReason && (
              // @ts-ignore
              <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={recReason}>
                {String(recReason)}
              </span>
            )}
          </div>
        );
      case 'amazonCreatedDate':
        const amazonDate = (campaign as Record<string, unknown>).amazonCreatedDate;
        return amazonDate ? (
          <span className="text-sm">{String(amazonDate)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        );
      case 'optimalBid':
        // 利润最大化出价点显示
        return (
          <Suspense fallback={<div className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /><span className="text-xs">加载中...</span></div>}>
            <OptimalBidCell campaignId={(campaign as any).amazonCampaignId} accountId={accountId!} />
          </Suspense>
        );
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
          <QuickActions
            // @ts-ignore
            campaignId={campaign.campaignId}
            accountId={(campaign as any).accountId || 0}
            currentBudget={(campaign as any).dailyBudget || 0}
            status={(campaign as any).campaignStatus || 'enabled'}
            onStatusChange={(newStatus) => {
              handleToggleStatus(campaign);
            }}
            onBudgetChange={(newBudget) => {
              handleEditBudget(campaign);
            }}
            onBidChange={(multiplier) => {
              toast.info("竞价调整功能开发中");
            }}
          />
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
            {/* P2优化: 紧凑/详细视图切换 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCompactView(!isCompactView)}
              title={isCompactView ? '切换到详细视图' : '切换到紧凑视图'}
            >
              {isCompactView ? <LayoutList className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              {!isMobile && <span className="ml-2">{isCompactView ? '详细' : '紧凑'}</span>}
            </Button>
            {/* 列设置 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="w-4 h-4" />
                  {!isMobile && <span className="ml-2">列设置</span>}
                </Button>
              </DropdownMenuTrigger>
              {/* @ts-ignore */}
              <DropdownMenuContent align="end" className="w-56">
                {/* @ts-ignore */}
                <DropdownMenuLabel>显示列</DropdownMenuLabel>
                {/* @ts-ignore */}
                <DropdownMenuSeparator />
                {columns.filter(c => c.key !== 'campaignName').map((column: unknown) => (
                  <DropdownMenuCheckboxItem
                    key={(column as any).key}
                    checked={visibleColumns.has((column as any).key)}
                    onCheckedChange={() => toggleColumn((column as any).key)}
                  >
                    {/* @ts-ignore */}
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {/* @ts-ignore */}
                <DropdownMenuItem onClick={resetColumns}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重置显示列
                </DropdownMenuItem>
                {/* @ts-ignore */}
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
            {/* @ts-ignore */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {/* @ts-ignore */}
                  <Bookmark className="w-4 h-4" />
                  {/* @ts-ignore */}
                  {!isMobile && <span className="ml-2">筛选预设</span>}
                </Button>
              {/* @ts-ignore */}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>快捷筛选</DropdownMenuLabel>
                {/* @ts-ignore */}
                <DropdownMenuSeparator />
                {presets.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    暂无保存的预设
                  </div>
                ) : (
                  presets.map((preset: unknown) => (
                    <DropdownMenuItem
                      key={(preset as any).id}
                      className="flex items-center justify-between group"
                      // @ts-ignore
                      onClick={() => handleApplyPreset(preset)}
                    >
                      {/* @ts-ignore */}
                      <div className="flex items-center">
                        <BookmarkCheck className="w-4 h-4 mr-2 text-primary" />
                        <span className="truncate max-w-[140px]">{(preset as any).name}</span>
                      {/* @ts-ignore */}
                      </div>
                      <Button
                        // @ts-ignore
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                        // @ts-ignore
                        onClick={(e) => handleDeletePreset(preset, e)}
                      >
                        {/* @ts-ignore */}
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
                (searchTerm ? 1 : 0)
              }
              onClearAll={resetFilters}
            >
            <div className="space-y-4">
              {/* 第一行：搜索和筛选 */}
              <div className={`flex ${isMobile ? 'flex-col gap-3' : 'flex-wrap items-center gap-4'}`}>

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
              {/* @ts-ignore */}
              <div className="flex flex-wrap items-center gap-2">
                {/* @ts-ignore */}
                <span className="text-sm text-muted-foreground">广告类型:</span>
                {campaignTypes.map((type: unknown) => {
                  const count = (type as any).value === "all" 
                    ? serverTotal || 0 
                    : typeCounts[(type as any).value] || 0;
                  const isActive = typeFilter === (type as any).value;
                  const Icon = (type as any).icon;
                  
                  return (
                    <Button
                      key={(type as any).value}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTypeFilter((type as any).value)}
                      className="h-8"
                    >
                      {Icon && <Icon className="w-3.5 h-3.5 mr-1" />}
                      {(type as any).label}
                      <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                    </Button>
                  );
                })}
              </div>

              {/* 第四行：计费方式筛选 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">计费方式:</span>
                {costTypeOptions.map((option: { value: string; label: string }) => (
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
                {/* @ts-ignore */}
                {/* 运行状态筛选 */}
                <div className="flex items-center gap-2">
                  {/* @ts-ignore */}
                  <span className="text-sm text-muted-foreground">运行状态:</span>
                  <div className="flex gap-1">
                    {runningStatusOptions.map((option: unknown) => {
                      const count = (option as any).value === "all" 
                        ? serverTotal || 0 
                        : (option as any).value === "enabled" ? statusCounts.enabled : statusCounts.paused;
                      return (
                        <Button
                          key={(option as any).value}
                          variant={runningStatusFilter === (option as any).value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRunningStatusFilter((option as any).value)}
                          className="h-8"
                        >
                          {(option as any).label}
                          <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* @ts-ignore */}
                {/* 优化状态筛选 */}
                <div className="flex items-center gap-2">
                  {/* @ts-ignore */}
                  <span className="text-sm text-muted-foreground">优化状态:</span>
                  <div className="flex gap-1">
                    {optimizationStatusOptions.map((option: unknown) => {
                      const count = (option as any).value === "all" 
                        ? serverTotal || 0 
                        : (option as any).value === "managed" ? statusCounts.managed : statusCounts.unmanaged;
                      return (
                        <Button
                          key={(option as any).value}
                          variant={optimizationStatusFilter === (option as any).value ? "default" : "outline"}
                          size="sm"
                          // @ts-ignore
                          onClick={() => setOptimizationStatusFilter(option.value)}
                          className={`h-8 ${(option as any).value === "managed" ? "data-[state=active]:bg-green-600" : (option as any).value === "unmanaged" ? "data-[state=active]:bg-orange-600" : ""}`}
                        >
                          {(option as any).value === "managed" && <Bot className="w-3 h-3 mr-1" />}
                          {(option as any).value === "unmanaged" && <AlertCircle className="w-3 h-3 mr-1" />}
                          {(option as any).label}
                          <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 第六行：高级筛选切换按钮 */}
              <div className="flex items-center gap-2">
                <Button
                  variant={showAdvancedFilters ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="h-8"
                >
                  <Filter className="w-3 h-3 mr-1" />
                  高级筛选
                  {hasAdvancedFilters && <Badge variant="destructive" className="ml-1 text-xs h-4 w-4 p-0 flex items-center justify-center">!</Badge>}
                  {showAdvancedFilters ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                </Button>
                {hasAdvancedFilters && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={clearAdvancedFilters}>
                    <X className="w-3 h-3 mr-1" />
                    清除高级筛选
                  </Button>
                )}
              </div>

              {/* 高级筛选面板 */}
              {showAdvancedFilters && (
                <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* 曝光量 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">曝光量 (Impressions)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          value={filters.impMin || ''}
                          onChange={(e) => setFilters({ impMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          value={filters.impMax || ''}
                          onChange={(e) => setFilters({ impMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* 点击量 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">点击量 (Clicks)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          value={filters.clickMin || ''}
                          onChange={(e) => setFilters({ clickMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          value={filters.clickMax || ''}
                          onChange={(e) => setFilters({ clickMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* 花费 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">花费 (Spend)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          step="0.01"
                          value={filters.spendMin || ''}
                          onChange={(e) => setFilters({ spendMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          step="0.01"
                          value={filters.spendMax || ''}
                          onChange={(e) => setFilters({ spendMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* 订单数 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">订单数 (Orders)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          value={filters.orderMin || ''}
                          onChange={(e) => setFilters({ orderMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          value={filters.orderMax || ''}
                          onChange={(e) => setFilters({ orderMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* ACoS */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">ACoS (%)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          step="0.1"
                          value={filters.acosMin || ''}
                          onChange={(e) => setFilters({ acosMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          step="0.1"
                          value={filters.acosMax || ''}
                          onChange={(e) => setFilters({ acosMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* ROAS */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">ROAS</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          step="0.01"
                          value={filters.roasMin || ''}
                          onChange={(e) => setFilters({ roasMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          // @ts-ignore
                          type="number"
                          placeholder="最大"
                          step="0.01"
                          value={filters.roasMax || ''}
                          onChange={(e) => setFilters({ roasMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* CPC */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">CPC</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          step="0.01"
                          value={filters.cpcMin || ''}
                          onChange={(e) => setFilters({ cpcMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          step="0.01"
                          value={filters.cpcMax || ''}
                          onChange={(e) => setFilters({ cpcMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* 日预算 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">日预算 (Daily Budget)</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="最小"
                          step="0.01"
                          value={filters.budgetMin || ''}
                          onChange={(e) => setFilters({ budgetMin: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大"
                          step="0.01"
                          value={filters.budgetMax || ''}
                          onChange={(e) => setFilters({ budgetMax: e.target.value, page: '1' })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 当前筛选条件摘要 */}
              {(typeFilter !== "all" || billingTypeFilter !== "all" || runningStatusFilter !== "all" || optimizationStatusFilter !== "all" || hasAdvancedFilters) && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <span className="text-sm text-muted-foreground">当前筛选:</span>
                  <div className="flex flex-wrap gap-1">
                    {typeFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setTypeFilter("all")}>
                        类型: {campaignTypes.find(t => t.value === typeFilter)?.label} ×
                      </Badge>
                    )}
                    {billingTypeFilter !== "all" && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setBillingTypeFilter("all")}>
                        计费: {costTypeOptions.find((t: { value: string; label: string }) => t.value === billingTypeFilter)?.label} ×
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
                    {(filters.impMin || filters.impMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ impMin: '', impMax: '', page: '1' })}>
                        曝光: {filters.impMin || '0'}~{filters.impMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.clickMin || filters.clickMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ clickMin: '', clickMax: '', page: '1' })}>
                        点击: {filters.clickMin || '0'}~{filters.clickMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.spendMin || filters.spendMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ spendMin: '', spendMax: '', page: '1' })}>
                        花费: {filters.spendMin || '0'}~{filters.spendMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.orderMin || filters.orderMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ orderMin: '', orderMax: '', page: '1' })}>
                        订单: {filters.orderMin || '0'}~{filters.orderMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.acosMin || filters.acosMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ acosMin: '', acosMax: '', page: '1' })}>
                        ACoS: {filters.acosMin || '0'}%~{filters.acosMax || '∞'}% ×
                      </Badge>
                    )}
                    {(filters.roasMin || filters.roasMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ roasMin: '', roasMax: '', page: '1' })}>
                        ROAS: {filters.roasMin || '0'}~{filters.roasMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.cpcMin || filters.cpcMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ cpcMin: '', cpcMax: '', page: '1' })}>
                        CPC: {filters.cpcMin || '0'}~{filters.cpcMax || '∞'} ×
                      </Badge>
                    )}
                    {(filters.budgetMin || filters.budgetMax) && (
                      <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/20" onClick={() => setFilters({ budgetMin: '', budgetMax: '', page: '1' })}>
                        日预算: {filters.budgetMin || '0'}~{filters.budgetMax || '∞'} ×
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { resetFilters(); clearAdvancedFilters(); }}>
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
                  {/* @ts-ignore */}
                  <span className="text-sm font-medium">已选择 {selectedCampaigns.size} 个广告活动</span>
                {/* @ts-ignore */}
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
                    {/* @ts-ignore */}
                    <SelectTrigger className="h-8 w-[140px]">
                      {/* @ts-ignore */}
                      <SelectValue placeholder="加入绩效组" />
                    </SelectTrigger>
                    <SelectContent>
                      {performanceGroups?.map((group: unknown) => (
                        <SelectItem key={(group as any).id} value={(group as any).id.toString()}>
                          {(group as any).name}
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
                  共 {totalItems} 个广告活动（总计 {serverTotal} 个）
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
                            // @ts-ignore
                            checked={selectedCampaigns.size === paginatedCampaigns.length && paginatedCampaigns.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        {columns.filter(col => mobileVisibleColumns.has(col.key)).map((column: unknown, colIndex: unknown) => {
                          const colWidth = getWidth((column as any).key);
                          const colIsPinned = isPinned((column as any).key);
                          const pinnedOffset = colIsPinned ? getPinnedOffset((column as any).key) + 40 : 0; // 40 for checkbox column
                          
                          return (
                            <TableHead 
                              key={(column as any).key}
                              className={`relative ${colIsPinned ? 'sticky bg-muted/50 z-30' : ''} ${(column as any).align === 'right' ? 'text-right' : (column as any).align === 'center' ? 'text-center' : ''}`}
                              style={{ 
                                width: colWidth,
                                minWidth: colWidth,
                                left: colIsPinned ? pinnedOffset : undefined,
                              }}
                            >
                              <div className={`flex items-center gap-1 ${(column as any).align === 'right' ? 'justify-end' : (column as any).align === 'center' ? 'justify-center' : ''}`}>
                                {/* @ts-ignore */}
                                {column.sortable ? (
                                  <button
                                    className={`flex items-center gap-1 hover:text-primary transition-colors ${(column as any).align === 'right' ? 'justify-end' : ''}`}
                                    onClick={() => handleSort((column as any).key as SortField)}
                                  >
                                    {(column as any).label}
                                    {getSortIcon((column as any).key as SortField)}
                                  </button>
                                ) : (
                                  <span>{(column as any).label}</span>
                                )}
                                {(column as any).key !== 'actions' && (
                                  <PinButton
                                    // @ts-ignore
                                    isPinned={colIsPinned}
                                    onClick={() => togglePin((column as any).key)}
                                  />
                                )}
                              </div>
                              {(column as any).key !== 'actions' && (
                                <ResizeHandle
                                  onMouseDown={(e) => startResize((column as any).key, e)}
                                  isResizing={resizing === (column as any).key}
                                />
                              )}
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowVirtualizer.getVirtualItems().map((virtualRow: unknown) => {
                        const campaign = paginatedCampaigns[(virtualRow as any).index];
                        if (!campaign) return null;
                        return (
                          <TableRow 
                            // @ts-ignore
                            key={campaign.id}
                            data-index={(virtualRow as any).index}
                            ref={rowVirtualizer.measureElement}
                            className={`hover:bg-muted/30 ${selectedCampaigns.has(campaign.id) ? 'bg-primary/5' : ''} ${isCompactView ? 'text-xs' : 'text-sm'}`}
                            style={{
                              height: `${(virtualRow as any).size}px`,
                            }}
                          >
                            {/* 复选框列 */}
                            <TableCell className="sticky left-0 bg-background z-10 w-[40px]">
                              <Checkbox
                                // @ts-ignore
                                checked={selectedCampaigns.has(campaign.id)}
                                onCheckedChange={() => toggleSelectCampaign(campaign.id)}
                              />
                            </TableCell>
                            {columns.filter(col => mobileVisibleColumns.has(col.key)).map((column: unknown) => {
                              const colWidth = getWidth((column as any).key);
                              const colIsPinned = isPinned((column as any).key);
                              const pinnedOffset = colIsPinned ? getPinnedOffset((column as any).key) + 40 : 0;
                              
                              return (
                                <TableCell 
                                  key={(column as any).key}
                                  className={`${colIsPinned ? 'sticky bg-background z-10' : ''} ${(column as any).align === 'right' ? 'text-right' : (column as any).align === 'center' ? 'text-center' : ''}`}
                                  style={{ 
                                    width: colWidth,
                                    minWidth: colWidth,
                                    left: colIsPinned ? pinnedOffset : undefined,
                                  }}
                                >
                                  {renderCell(campaign, (column as any).key)}
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
                {filters.billing !== 'all' && <div>计费: {costTypeOptions.find((b: { value: string; label: string }) => b.value === filters.billing)?.label}</div>}
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
