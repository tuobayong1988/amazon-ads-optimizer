/**
 * OptimizationLogs - 优化日志组件 v135
 * 展示优化目标的完整操作日志，包含：
 * - 具体关键词/商品定向名称（摘要行直接显示）
 * - 出价变化（旧价 → 新价）
 * - 调整原因
 * - Amazon API同步状态（是否已传递到亚马逊执行）
 * - 完整执行链路：本地决策 → API调用 → Amazon确认
 * - v135: 算法类型可视化、决策上下文面板、置信度进度条、归因保护指示器、AOV计算展示
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { safeParseDate, safeToLocaleString } from '../lib/safeDate';
import {
  History,
  Target,
  DollarSign,
  Layers,
  Settings,
  User,
  Calendar,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Cloud,
  CloudOff,
  Loader2,
  ExternalLink,
  Tag,
  Package,
  Brain,
  BrainCircuit,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Zap,
  Activity,
  Lightbulb,
  Sparkles,
  Eye,
  Info,
  FlaskConical,
  Workflow,
  ShoppingCart,
  CircleDollarSign,
  BarChart3,
  AlertTriangle,
  Filter,
  ArrowUpCircle,
  Scale,
} from "lucide-react";

// ==================== 算法层级配置 ====================
const ALGORITHM_TIER_CONFIG: Record<string, { label: string; icon: typeof Brain; color: string; bgColor: string; description: string }> = {
  advanced: {
    label: '高级算法',
    icon: BrainCircuit,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/15 border-purple-500/30',
    description: '使用UCB/贝叶斯等高级统计算法，基于充分数据做出最优决策',
  },
  rule_engine: {
    label: '规则引擎',
    icon: Workflow,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/15 border-blue-500/30',
    description: '基于真实AOV和归因保护的智能规则引擎，适用于数据量中等的场景',
  },
  conservative: {
    label: '保守策略',
    icon: ShieldCheck,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/15 border-amber-500/30',
    description: '数据不足时采用保守策略，小幅调整以降低风险',
  },
};

// ==================== 决策上下文解析器 ====================
interface DecisionContext {
  aovValue?: number;
  spendRatio?: number;
  actualAcos?: number;
  targetAcos?: number;
  isZeroImpression?: boolean;
  isZeroClick?: boolean;
  isZeroConversion?: boolean;
  isHighSpend?: boolean;
  isExploration?: boolean;
  isAttributionProtected?: boolean;
  acosStatus?: 'excellent' | 'on_target' | 'over_target' | 'critical';
  impressionCount?: number;
  clickCount?: number;
  spendAmount?: number;
  boostPercent?: number;
  reducePercent?: number;
}

function parseDecisionContext(reason: string | undefined): DecisionContext {
  if (!reason) return {};
  const ctx: DecisionContext = {};

  // 解析AOV
  const aovMatch = reason.match(/AOV=\$?([\d.]+)/i);
  if (aovMatch) ctx.aovValue = parseFloat(aovMatch[1]);

  // 解析花费比率
  const spendRatioMatch = reason.match(/([\d.]+)x超标/);
  if (spendRatioMatch) ctx.spendRatio = parseFloat(spendRatioMatch[1]);

  // 解析ACOS
  const acosMatch = reason.match(/ACOS[优秀达标超标]?\(([\d.]+)%\s*(?:vs\s*目标([\d.]+)%)?/);
  if (acosMatch) {
    ctx.actualAcos = parseFloat(acosMatch[1]);
    if (acosMatch[2]) ctx.targetAcos = parseFloat(acosMatch[2]);
  }

  // 解析花费金额
  const spendMatch = reason.match(/\$(\d+\.?\d*)/);
  if (spendMatch) ctx.spendAmount = parseFloat(spendMatch[1]);

  // 解析曝光量
  const impressionMatch = reason.match(/(\d+)次/);
  if (impressionMatch) ctx.impressionCount = parseInt(impressionMatch[1]);

  // 解析提升/降低百分比
  const boostMatch = reason.match(/提升(\d+)%/);
  if (boostMatch) ctx.boostPercent = parseInt(boostMatch[1]);
  const reduceMatch = reason.match(/降低(\d+)%/);
  if (reduceMatch) ctx.reducePercent = parseInt(reduceMatch[1]);

  // 判断场景类型
  ctx.isZeroImpression = reason.includes('零曝光');
  ctx.isZeroClick = reason.includes('零点击');
  ctx.isZeroConversion = reason.includes('零转化');
  ctx.isHighSpend = reason.includes('高花费') || reason.includes('超标');
  ctx.isExploration = reason.includes('探索') || reason.includes('曝光数据');
  ctx.isAttributionProtected = reason.includes('归因') || reason.includes('容忍');

  // 判断ACOS状态
  if (reason.includes('ACOS优秀')) ctx.acosStatus = 'excellent';
  else if (reason.includes('ACOS达标') || reason.includes('微调')) ctx.acosStatus = 'on_target';
  else if (reason.includes('ACOS超标') || reason.includes('超标')) ctx.acosStatus = 'over_target';
  else if (reason.includes('严重超标')) ctx.acosStatus = 'critical';

  return ctx;
}

// 日志分类配置
const LOG_CATEGORIES = {
  all: { label: '全部日志', icon: History, color: 'text-gray-400' },
  performance_target: { label: '绩效组和目标', icon: Target, color: 'text-blue-400' },
  bid_adjustment: { label: '出价调整', icon: DollarSign, color: 'text-orange-400' },
  placement_adjustment: { label: '层面调整', icon: Layers, color: 'text-purple-400' },
  optimization_settings: { label: '优化设置', icon: Settings, color: 'text-green-400' },
};

// 操作类型标签
const ACTION_TYPE_LABELS: Record<string, { label: string; color: string; icon?: string }> = {
  create_target: { label: '创建目标', color: 'bg-green-500/20 text-green-400' },
  update_target: { label: '更新目标', color: 'bg-blue-500/20 text-blue-400' },
  delete_target: { label: '删除目标', color: 'bg-red-500/20 text-red-400' },
  pause_target: { label: '暂停目标', color: 'bg-yellow-500/20 text-yellow-400' },
  resume_target: { label: '恢复目标', color: 'bg-green-500/20 text-green-400' },
  add_campaign: { label: '添加广告活动', color: 'bg-blue-500/20 text-blue-400' },
  remove_campaign: { label: '移除广告活动', color: 'bg-orange-500/20 text-orange-400' },
  bid_increase: { label: '提高出价', color: 'bg-green-500/20 text-green-400', icon: '↑' },
  bid_decrease: { label: '降低出价', color: 'bg-red-500/20 text-red-400', icon: '↓' },
  bid_set: { label: '设置出价', color: 'bg-blue-500/20 text-blue-400' },
  bid_auto_adjust: { label: '自动调整出价', color: 'bg-purple-500/20 text-purple-400' },
  placement_adjust: { label: '调整广告位', color: 'bg-purple-500/20 text-purple-400' },
  placement_enable: { label: '启用广告位', color: 'bg-green-500/20 text-green-400' },
  placement_disable: { label: '禁用广告位', color: 'bg-red-500/20 text-red-400' },
  settings_update: { label: '更新设置', color: 'bg-blue-500/20 text-blue-400' },
  strategy_change: { label: '更换策略', color: 'bg-orange-500/20 text-orange-400' },
  schedule_update: { label: '更新计划', color: 'bg-cyan-500/20 text-cyan-400' },
  search_term_harvest: { label: '搜索词收割', color: 'bg-teal-500/20 text-teal-400' },
  negative_keyword_add: { label: '添加否定词', color: 'bg-red-500/20 text-red-400' },
  negative_keyword_remove: { label: '移除否定词', color: 'bg-green-500/20 text-green-400' },
  keyword_create: { label: '创建关键词', color: 'bg-blue-500/20 text-blue-400' },
  target_pause: { label: '暂停投放词', color: 'bg-yellow-500/20 text-yellow-400', icon: '⏸' },
  target_enable: { label: '启用投放词', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  campaign_pause: { label: '暂停广告活动', color: 'bg-red-500/20 text-red-400', icon: '⏸' },
  campaign_enable: { label: '启用广告活动', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  adgroup_pause: { label: '暂停广告组', color: 'bg-orange-500/20 text-orange-400', icon: '⏸' },
  adgroup_enable: { label: '启用广告组', color: 'bg-green-500/20 text-green-400', icon: '▶' },
  dayparting_bid: { label: '分时竞价', color: 'bg-cyan-500/20 text-cyan-400', icon: '⏰' },
  budget_adjustment: { label: '预算调整', color: 'bg-emerald-500/20 text-emerald-400', icon: '💰' },
};

// API同步状态配置
const API_SYNC_STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string; bgColor: string }> = {
  synced: { label: '已同步到Amazon', icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  failed: { label: 'Amazon同步失败', icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  pending: { label: '待同步', icon: Clock, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  partial: { label: '部分同步', icon: AlertCircle, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  syncing: { label: '同步中(重试)', icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  retry: { label: '等待重试', icon: RefreshCw, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  not_applicable: { label: '无需同步', icon: Cloud, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
};

// 状态标签
const STATUS_LABELS: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  success: { label: '成功', icon: CheckCircle, color: 'text-green-400' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-400' },
  pending: { label: '待执行', icon: Clock, color: 'text-yellow-400' },
  rolled_back: { label: '已回滚', icon: AlertCircle, color: 'text-orange-400' },
};

interface OptimizationLogsProps {
  performanceGroupId: number;
  performanceGroupName?: string;
}

export function OptimizationLogs({ performanceGroupId, performanceGroupName }: OptimizationLogsProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 获取日志列表
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = trpc.performanceGroup.getLogs.useQuery({
    performanceGroupId,
    category: activeCategory as any,
    page,
    pageSize,
  }, {
    enabled: !!performanceGroupId,
  });

  // 过滤日志
  const filteredLogs = useMemo(() => {
    if (!logsData?.logs) return [];
    if (!searchQuery) return logsData.logs;
    
    const query = searchQuery.toLowerCase();
    return logsData.logs.filter((log: any) => 
      log.performanceGroupName?.toLowerCase().includes(query) ||
      log.campaignName?.toLowerCase().includes(query) ||
      log.userName?.toLowerCase().includes(query) ||
      log.actionDetail?.toLowerCase().includes(query) ||
      log.changeReason?.toLowerCase().includes(query) ||
      log.previousValue?.toLowerCase().includes(query) ||
      log.newValue?.toLowerCase().includes(query)
    );
  }, [logsData?.logs, searchQuery]);

  // 格式化日期时间
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = safeParseDate(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // 解析操作详情
  const parseActionDetail = (detail: string | null) => {
    if (!detail) return null;
    try {
      return JSON.parse(detail);
    } catch {
      return { text: detail };
    }
  };

  // 从actionDetail中提取关键词/目标名称
  const getTargetName = (log: any): { name: string; isProductTarget: boolean } | null => {
    const detail = parseActionDetail(log.actionDetail);
    if (!detail) return null;
    
    // 出价调整日志
    if (detail.keywordText) {
      return { name: detail.keywordText, isProductTarget: !!detail.isProductTarget };
    }
    
    // 搜索词分析日志
    if (detail.searchTerm) {
      return { name: detail.searchTerm, isProductTarget: false };
    }
    
    // 位置调整日志
    if (detail.placement) {
      const placementNames: Record<string, string> = {
        'top_of_search': '搜索顶部',
        'product_page': '商品页面',
        'rest_of_search': '搜索其他',
      };
      return { name: placementNames[detail.placement] || detail.placement, isProductTarget: false };
    }
    
    // 关键词状态变更
    if (detail.keywordName || detail.targetName) {
      return { name: detail.keywordName || detail.targetName, isProductTarget: !!detail.isProductTarget };
    }
    
    // v135: 广告活动状态变更 - 显示广告活动名称
    if (detail.entityType === 'campaign' && detail.campaignName) {
      return { name: `广告活动: ${detail.campaignName}`, isProductTarget: false };
    }
    
    // v135: 广告组状态变更 - 显示广告组名称
    if (detail.entityType === 'adGroup' && detail.adGroupName) {
      return { name: `广告组: ${detail.adGroupName}`, isProductTarget: false };
    }
    
    return null;
  };

  // ==================== v135: 算法层级徽章 ====================
  const renderAlgorithmTierBadge = (actionDetail: any, compact: boolean = false) => {
    if (!actionDetail?.algorithmTier) return null;
    const tierConfig = ALGORITHM_TIER_CONFIG[actionDetail.algorithmTier];
    if (!tierConfig) return null;
    const TierIcon = tierConfig.icon;

    if (compact) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${tierConfig.bgColor} ${tierConfig.color}`}>
                <TierIcon className="w-3 h-3" />
                <span className="hidden sm:inline">{tierConfig.label}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">{tierConfig.description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${tierConfig.bgColor} ${tierConfig.color}`}>
        <TierIcon className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">{tierConfig.label}</span>
      </div>
    );
  };

  // ==================== v135: 置信度可视化 ====================
  const renderConfidenceBar = (confidence: number | undefined, compact: boolean = false) => {
    if (confidence === undefined || confidence === null) return null;
    const pct = Math.round(confidence * 100);
    let color = 'text-red-400';
    let progressColor = '[&>[data-slot=progress-indicator]]:bg-red-400';
    if (pct >= 70) {
      color = 'text-green-400';
      progressColor = '[&>[data-slot=progress-indicator]]:bg-green-400';
    } else if (pct >= 40) {
      color = 'text-yellow-400';
      progressColor = '[&>[data-slot=progress-indicator]]:bg-yellow-400';
    }

    if (compact) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`text-[10px] font-mono ${color}`}>{pct}%</span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">算法置信度: {pct}%</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <div className="flex items-center gap-2 min-w-[120px]">
        <Gauge className={`w-3.5 h-3.5 ${color} shrink-0`} />
        <div className="flex-1">
          <Progress value={pct} className={`h-1.5 ${progressColor}`} />
        </div>
        <span className={`text-xs font-mono ${color} shrink-0`}>{pct}%</span>
      </div>
    );
  };

  // ==================== v258: 护栏机制信息展示 ====================
  const renderGuardrailInfo = (actionDetail: any) => {
    const gi = actionDetail?.guardrailInfo;
    if (!gi) return null;
    const hasGuardrail = gi.cooldownActive || gi.circuitBreakerTripped || gi.arbitrationApplied || gi.minAdjustmentFiltered || gi.maxBidCapped || gi.bidRecoveryTriggered || gi.exposureProtectionActive || gi.bidirectionalBid;
    if (!hasGuardrail) return null;
    
    return (
      <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/20 rounded-lg p-3 border border-amber-700/40 mt-2">
        <div className="flex items-center gap-1.5 mb-2">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">护栏机制</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {gi.cooldownActive && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20">
              <Clock className="w-3 h-3 text-blue-400" />
              <span className="text-[11px] text-blue-400">冷却保护已激活</span>
            </div>
          )}
          {gi.circuitBreakerTripped && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <span className="text-[11px] text-red-400">降价熔断触发</span>
            </div>
          )}
          {gi.arbitrationApplied && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20">
              <Scale className="w-3 h-3 text-purple-400" />
              <span className="text-[11px] text-purple-400">仲裁介入</span>
            </div>
          )}
          {gi.minAdjustmentFiltered && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-500/10 border border-gray-500/20">
              <Filter className="w-3 h-3 text-gray-400" />
              <span className="text-[11px] text-gray-400">最小调整过滤</span>
            </div>
          )}
          {gi.maxBidCapped && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20">
              <ArrowUpCircle className="w-3 h-3 text-orange-400" />
              <span className="text-[11px] text-orange-400">最高出价限制</span>
            </div>
          )}
          {gi.bidRecoveryTriggered && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20">
              <ArrowUpCircle className="w-3 h-3 text-emerald-400" />
              <span className="text-[11px] text-emerald-400">v259 提价恢复</span>
            </div>
          )}
          {gi.exposureProtectionActive && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20">
              <ShieldCheck className="w-3 h-3 text-cyan-400" />
              <span className="text-[11px] text-cyan-400">v259 曝光保护</span>
            </div>
          )}
          {gi.bidirectionalBid && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20">
              <TrendingUp className="w-3 h-3 text-indigo-400" />
              <span className="text-[11px] text-indigo-400">v259 双向出价</span>
            </div>
          )}
        </div>
        {gi.details && (
          <p className="text-[11px] text-amber-300/70 mt-2">{gi.details}</p>
        )}
      </div>
    );
  };

  // ==================== v135: 决策上下文面板 ====================
  const renderDecisionContext = (actionDetail: any) => {
    if (!actionDetail?.reason) return null;
    const ctx = parseDecisionContext(actionDetail.reason);
    const hasContext = ctx.aovValue || ctx.spendRatio || ctx.actualAcos || ctx.isZeroImpression || 
                       ctx.isZeroClick || ctx.isZeroConversion || ctx.isExploration;
    if (!hasContext) return null;

    return (
      <div className="bg-gradient-to-r from-slate-900/50 to-slate-800/30 rounded-lg p-3 border border-slate-700/50">
        <div className="flex items-center gap-1.5 mb-2">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">决策上下文</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {/* 场景标签 */}
          {ctx.isExploration && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20">
              <Eye className="w-3 h-3 text-cyan-400" />
              <span className="text-[11px] text-cyan-400">探索阶段</span>
            </div>
          )}
          {ctx.isZeroImpression && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-500/10 border border-gray-500/20">
              <Eye className="w-3 h-3 text-gray-400" />
              <span className="text-[11px] text-gray-400">零曝光</span>
            </div>
          )}
          {ctx.isZeroClick && !ctx.isZeroImpression && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20">
              <Activity className="w-3 h-3 text-orange-400" />
              <span className="text-[11px] text-orange-400">零点击</span>
            </div>
          )}
          {ctx.isZeroConversion && !ctx.isZeroClick && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
              <ShoppingCart className="w-3 h-3 text-red-400" />
              <span className="text-[11px] text-red-400">零转化</span>
            </div>
          )}
          {ctx.isHighSpend && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
              <CircleDollarSign className="w-3 h-3 text-red-400" />
              <span className="text-[11px] text-red-400">
                高花费{ctx.spendRatio ? ` (${ctx.spendRatio.toFixed(1)}x)` : ''}
              </span>
            </div>
          )}

          {/* AOV信息 */}
          {ctx.aovValue && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20">
              <ShoppingCart className="w-3 h-3 text-emerald-400" />
              <span className="text-[11px] text-emerald-400">AOV: ${ctx.aovValue.toFixed(0)}</span>
            </div>
          )}

          {/* ACOS状态 */}
          {ctx.acosStatus && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${
              ctx.acosStatus === 'excellent' ? 'bg-green-500/10 border-green-500/20' :
              ctx.acosStatus === 'on_target' ? 'bg-blue-500/10 border-blue-500/20' :
              ctx.acosStatus === 'over_target' ? 'bg-orange-500/10 border-orange-500/20' :
              'bg-red-500/10 border-red-500/20'
            }`}>
              <BarChart3 className={`w-3 h-3 ${
                ctx.acosStatus === 'excellent' ? 'text-green-400' :
                ctx.acosStatus === 'on_target' ? 'text-blue-400' :
                ctx.acosStatus === 'over_target' ? 'text-orange-400' :
                'text-red-400'
              }`} />
              <span className={`text-[11px] ${
                ctx.acosStatus === 'excellent' ? 'text-green-400' :
                ctx.acosStatus === 'on_target' ? 'text-blue-400' :
                ctx.acosStatus === 'over_target' ? 'text-orange-400' :
                'text-red-400'
              }`}>
                {ctx.acosStatus === 'excellent' ? 'ACOS优秀' :
                 ctx.acosStatus === 'on_target' ? 'ACOS达标' :
                 ctx.acosStatus === 'over_target' ? 'ACOS超标' : 'ACOS严重超标'}
                {ctx.actualAcos ? ` ${ctx.actualAcos.toFixed(1)}%` : ''}
                {ctx.targetAcos ? ` / 目标${ctx.targetAcos.toFixed(1)}%` : ''}
              </span>
            </div>
          )}

          {/* 归因保护 */}
          {ctx.isAttributionProtected && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/20">
              <ShieldCheck className="w-3 h-3 text-violet-400" />
              <span className="text-[11px] text-violet-400">归因保护</span>
            </div>
          )}

          {/* 花费金额 */}
          {ctx.spendAmount && ctx.spendAmount > 0 && !ctx.aovValue && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-500/10 border border-slate-500/20">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span className="text-[11px] text-slate-400">花费: ${ctx.spendAmount.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==================== v135: 归因保护指示器（摘要行） ====================
  const renderAttributionProtectionBadge = (actionDetail: any) => {
    if (!actionDetail?.reason) return null;
    const ctx = parseDecisionContext(actionDetail.reason);
    if (!ctx.isAttributionProtected) return null;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-violet-500/10 border border-violet-500/20">
              <ShieldCheck className="w-3 h-3 text-violet-400" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs">归因保护已启用：考虑Amazon广告归因延迟（7-14天），对花费判断增加1.5x容忍因子</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // 渲染API同步状态徽章
  // v253: 修复 null 值处理 — 区分“功能上线前的历史记录”和“真正待同步”
  const renderApiSyncBadge = (log: any) => {
    let syncStatus = log.apiSyncStatus;
    if (!syncStatus) {
      // apiSyncStatus为null时，检查是否为API操作类型
      const isApiAction = log.logCategory === 'bid_adjustment' || log.logCategory === 'placement_adjustment';
      if (!isApiAction) {
        syncStatus = 'not_applicable';
      } else {
        // v253: 检查日志创建时间 — 如果是24小时前的旧记录且无apiSyncStatus，说明是功能上线前的历史数据
        const logTime = log.createdAt ? new Date(log.createdAt).getTime() : 0;
        const hoursAgo24 = Date.now() - 24 * 3600000;
        syncStatus = logTime < hoursAgo24 ? 'not_applicable' : 'pending';
      }
    }
    const config = API_SYNC_STATUS_CONFIG[syncStatus] || API_SYNC_STATUS_CONFIG.pending;
    const SyncIcon = config.icon;
    
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.bgColor} ${config.color}`}>
        <SyncIcon className="w-3 h-3" />
        <span>{config.label}</span>
      </div>
    );
  };

  // 渲染执行链路
  // v253: 同样修复 null 值处理
  const renderExecutionPipeline = (log: any) => {
    let syncStatus = log.apiSyncStatus;
    if (!syncStatus) {
      const logTime = log.createdAt ? new Date(log.createdAt).getTime() : 0;
      const hoursAgo24 = Date.now() - 24 * 3600000;
      syncStatus = logTime < hoursAgo24 ? 'not_applicable' : 'pending';
    }
    const isApiAction = ['bid_adjustment', 'placement_adjustment', 'optimization_settings'].includes(log.logCategory) ||
      ['bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust', 'placement_adjust', 'target_pause', 'target_enable',
       'campaign_pause', 'campaign_enable', 'adgroup_pause', 'adgroup_enable', 'negative_keyword_add',
       'keyword_create', 'search_term_harvest', 'dayparting_bid', 'budget_adjustment'].includes(log.actionType);
    
    if (!isApiAction) return null;
    
    const steps = [
      { label: '优化决策', status: 'done', icon: Target },
      { label: '本地更新', status: log.status === 'success' || log.status === 'failed' ? 'done' : 'pending', icon: Settings },
      { label: 'Amazon API', status: syncStatus === 'synced' ? 'done' : syncStatus === 'partial' ? 'done' : syncStatus === 'failed' ? 'failed' : syncStatus === 'syncing' || syncStatus === 'retry' ? 'pending' : 'pending', icon: Cloud },
      { label: 'Amazon执行', status: syncStatus === 'synced' ? 'done' : syncStatus === 'partial' ? 'done' : syncStatus === 'failed' ? 'failed' : 'pending', icon: ExternalLink },
    ];
    
    return (
      <div className="flex items-center gap-1 mt-2">
        {steps.map((step: any, idx: any) => {
          const isLast = idx === steps.length - 1;
          let stepColor = 'text-gray-500';
          let dotColor = 'bg-gray-500';
          
          if (step.status === 'done') {
            stepColor = 'text-green-400';
            dotColor = 'bg-green-400';
          } else if (step.status === 'failed') {
            stepColor = 'text-red-400';
            dotColor = 'bg-red-400';
          } else if (step.status === 'pending') {
            stepColor = 'text-yellow-400';
            dotColor = 'bg-yellow-400';
          }
          
          return (
            <div key={idx} className="flex items-center gap-1">
              <div className={`flex items-center gap-1 ${stepColor}`}>
                <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="text-xs whitespace-nowrap">{step.label}</span>
              </div>
              {!isLast && (
                <ArrowRight className="w-3 h-3 text-gray-600" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染出价变化标签
  const renderBidChange = (log: any, compact: boolean = false) => {
    if (!log.previousValue && !log.newValue) return null;
    
    const actionDetail = parseActionDetail(log.actionDetail);
    const changePercent = actionDetail?.changePercent;
    
    return (
      <div className={`flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}`}>
        {log.previousValue && (
          <span className="text-red-400 line-through font-mono">{log.previousValue}</span>
        )}
        {log.previousValue && log.newValue && (
          <ArrowRight className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-muted-foreground`} />
        )}
        {log.newValue && (
          <span className="text-green-400 font-medium font-mono">{log.newValue}</span>
        )}
        {changePercent && (
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} px-1 py-0.5 rounded ${
            parseFloat(changePercent) > 0 
              ? 'bg-green-500/10 text-green-400' 
              : 'bg-red-500/10 text-red-400'
          }`}>
            {parseFloat(changePercent) > 0 ? '+' : ''}{changePercent}%
          </span>
        )}
      </div>
    );
  };

  // 渲染关键词/目标名称标签
  const renderTargetTag = (log: any, compact: boolean = false) => {
    const target = getTargetName(log);
    if (!target) return null;
    
    const TargetIcon = target.isProductTarget ? Package : Tag;
    
    return (
      <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 ${compact ? 'text-[11px]' : 'text-xs'} text-blue-300 max-w-[200px]`}>
        <TargetIcon className="w-3 h-3 shrink-0" />
        <span className="truncate font-mono">{target.name}</span>
      </div>
    );
  };

  // 渲染单条日志
  const renderLogItem = (log: any) => {
    const isExpanded = expandedLogId === log.id;
    const categoryConfig = LOG_CATEGORIES[log.logCategory as keyof typeof LOG_CATEGORIES] || LOG_CATEGORIES.all;
    const actionConfig = ACTION_TYPE_LABELS[log.actionType] || { label: log.actionType || '系统操作', color: 'bg-gray-500/20 text-gray-400' };
    const statusConfig = STATUS_LABELS[log.status] || STATUS_LABELS.success;
    const CategoryIcon = categoryConfig.icon;
    const StatusIcon = statusConfig.icon;
    const actionDetail = parseActionDetail(log.actionDetail);

    return (
      <div key={log.id} className="border rounded-lg mb-2 overflow-hidden">
        {/* 日志头部 */}
        <div 
          className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
        >
          {/* 移动端布局 */}
          <div className="md:hidden space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <Badge className={`${actionConfig.color} text-xs`}>
                {actionConfig.icon && <span className="mr-1">{actionConfig.icon}</span>}
                {actionConfig.label}
              </Badge>
              <StatusIcon className={`w-4 h-4 ${statusConfig.color} shrink-0`} />
              {renderApiSyncBadge(log)}
              {/* v135: 算法层级徽章 - 移动端 */}
              {renderAlgorithmTierBadge(actionDetail, true)}
            </div>
            
            {/* 关键词名称 - 移动端 */}
            {renderTargetTag(log, true) && (
              <div className="pl-6">
                {renderTargetTag(log, true)}
              </div>
            )}
            
            {/* 出价变更 - 移动端 */}
            {(log.previousValue || log.newValue) && (
              <div className="pl-6 flex items-center gap-1.5">
                {renderBidChange(log, true)}
                {/* v135: 置信度 - 移动端 */}
                {renderConfidenceBar(actionDetail?.confidenceScore, true)}
              </div>
            )}
            
            {/* 调整原因 - 移动端 */}
            {log.changeReason && (
              <div className="text-[11px] text-muted-foreground pl-6 line-clamp-1">
                {log.changeReason}
              </div>
            )}
            
            <div className="flex items-center gap-1 text-xs text-muted-foreground pl-6">
              <Calendar className="w-3 h-3" />
              <span>{formatDateTime(log.createdAt)}</span>
            </div>
            {log.campaignName && (
              <div className="text-[11px] text-muted-foreground pl-6 truncate">
                {log.campaignName}
              </div>
            )}
          </div>
          
          {/* PC端布局 */}
          <div className="hidden md:block">
            {/* 第一行：操作类型、关键词、出价变化、同步状态 */}
            <div className="flex items-center gap-2.5">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <CategoryIcon className={`w-4 h-4 ${categoryConfig.color} shrink-0`} />
              
              {/* 时间 */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-[140px] shrink-0">
                <Calendar className="w-3 h-3" />
                {formatDateTime(log.createdAt)}
              </div>
              
              {/* 操作类型 */}
              <Badge className={`${actionConfig.color} text-xs shrink-0`}>
                {actionConfig.icon && <span className="mr-1">{actionConfig.icon}</span>}
                {actionConfig.label}
              </Badge>
              
              {/* v135: 算法层级徽章 - PC端 */}
              {renderAlgorithmTierBadge(actionDetail, true)}
              
              {/* 关键词/目标名称 - 直接在摘要行显示 */}
              {renderTargetTag(log)}
              
              {/* 出价变更摘要 */}
              {renderBidChange(log)}
              
              {/* v135: 置信度 - PC端摘要 */}
              {renderConfidenceBar(actionDetail?.confidenceScore, true)}
              
              {/* v135: 归因保护指示器 */}
              {renderAttributionProtectionBadge(actionDetail)}
              
              {/* Amazon同步状态 */}
              {renderApiSyncBadge(log)}
              
              {/* 执行状态 */}
              <StatusIcon className={`w-4 h-4 ${statusConfig.color} shrink-0`} />
              
              {/* Campaign名称 */}
              {log.campaignName && (
                <div className="flex-1 truncate text-xs text-muted-foreground min-w-0">
                  {log.campaignName}
                </div>
              )}
            </div>
            
            {/* 第二行：调整原因（仅在未展开时显示） */}
            {!isExpanded && log.changeReason && (
              <div className="text-xs text-muted-foreground mt-1.5 ml-[30px] line-clamp-1">
                <span className="text-muted-foreground/60">原因: </span>
                {log.changeReason}
              </div>
            )}
            
            {/* 执行链路（仅在摘要行显示） */}
            {!isExpanded && renderExecutionPipeline(log)}
          </div>
        </div>
        
        {/* 展开的详情 */}
        {isExpanded && (
          <div className="border-t bg-muted/30 p-4 space-y-4">
            {/* v135: 算法与决策概览 */}
            {actionDetail && (actionDetail.algorithmUsed || actionDetail.algorithmTier) && (
              <>
                <div>
                  <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <Brain className="w-4 h-4 text-purple-400" />
                    算法与决策
                  </p>
                  <div className="bg-background rounded-lg p-3 space-y-3">
                    {/* 算法层级和名称 */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {renderAlgorithmTierBadge(actionDetail)}
                      {actionDetail.algorithmUsed && (
                        <div className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">算法:</span>
                          <Badge variant="outline" className="text-xs font-mono">{actionDetail.algorithmUsed}</Badge>
                        </div>
                      )}
                    </div>
                    
                    {/* 置信度进度条 */}
                    {actionDetail.confidenceScore !== undefined && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground shrink-0">置信度:</span>
                        {renderConfidenceBar(actionDetail.confidenceScore)}
                      </div>
                    )}
                    
                    {/* v337: 修正层标记 — GTO/Cascade Fusion/因果推断 */}
                    {actionDetail.correctionLayers && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-xs font-medium text-muted-foreground">修正层:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {actionDetail.correctionLayers.gtoApplied && (
                            <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
                              GTO博弈论修正 (×{actionDetail.correctionLayers.gtoCompositeModifier?.toFixed(3) || '?'})
                            </Badge>
                          )}
                          {actionDetail.correctionLayers.cascadeFusionApplied && (
                            <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
                              Cascade Fusion [{actionDetail.correctionLayers.cascadeFusionAlgorithms?.join('+') || '?'}]
                            </Badge>
                          )}
                          {actionDetail.correctionLayers.causalInferenceApplied && (
                            <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                              因果推断修正
                            </Badge>
                          )}
                          {!actionDetail.correctionLayers.gtoApplied && !actionDetail.correctionLayers.cascadeFusionApplied && !actionDetail.correctionLayers.causalInferenceApplied && (
                            <span className="text-xs text-muted-foreground">无修正层介入</span>
                          )}
                        </div>
                        {actionDetail.correctionLayers.gtoApplied && actionDetail.correctionLayers.gtoActiveEngines?.length > 0 && (
                          <p className="text-xs text-muted-foreground pl-1">
                            GTO子引擎: {actionDetail.correctionLayers.gtoActiveEngines.join(', ')}
                          </p>
                        )}
                        {actionDetail.correctionLayers.cascadeFusionDetail && (
                          <p className="text-xs text-muted-foreground pl-1 break-all">
                            {actionDetail.correctionLayers.cascadeFusionDetail}
                          </p>
                        )}
                      </div>
                    )}
                    
                    {/* v337: Meta-Learning决策详情 */}
                    {actionDetail.metaLearningDetail && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-xs font-medium text-muted-foreground">Meta-Learning算法选择:</p>
                        <div className="bg-muted/30 rounded p-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">模式:</span>
                            <Badge variant="outline" className="text-xs">
                              {actionDetail.metaLearningDetail.fusionMode === 'cascade_ensemble' ? 'Cascade融合' : '单算法'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{actionDetail.metaLearningDetail.selectionReason}</p>
                          {actionDetail.metaLearningDetail.candidateAlgorithms?.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-xs text-muted-foreground">候选算法评分:</p>
                              {actionDetail.metaLearningDetail.candidateAlgorithms.map((alg: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-xs">
                                  <span className={`font-mono ${alg.algorithm === actionDetail.metaLearningDetail.selectedAlgorithm ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                                    {alg.algorithm}
                                  </span>
                                  <span className="text-muted-foreground">得分={alg.score.toFixed(3)}</span>
                                  <Badge variant={alg.eligible ? 'default' : 'destructive'} className="text-[10px] px-1 py-0">
                                    {alg.eligible ? '可用' : '不可用'}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* 决策上下文面板 */}
                    {renderDecisionContext(actionDetail)}
                    {/* v258: 护栏机制信息 */}
                    {renderGuardrailInfo(actionDetail)}
                  </div>
                </div>
                <Separator />
              </>
            )}
            
            {/* 执行链路 */}
            <div>
              <p className="text-sm font-medium mb-2">执行链路</p>
              <div className="bg-background rounded-lg p-3">
                {renderExecutionPipeline(log)}
              </div>
            </div>
            
            <Separator />
            
            {/* 基本信息 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">执行时间</p>
                <p className="font-medium">{formatDateTime(log.executedAt || log.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">操作用户</p>
                <p className="font-medium">{log.userName || '系统自动'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">优化目标</p>
                <p className="font-medium">{log.performanceGroupName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">策略模板</p>
                <p className="font-medium">{log.strategyTemplateName || '默认策略'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">广告活动</p>
                <p className="font-medium">{log.campaignName || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">执行状态</p>
                <div className="flex items-center gap-1">
                  <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                  <span className={`font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
                </div>
              </div>
            </div>
            
            <Separator />
            
            {/* Amazon API同步详情 */}
            <div>
              <p className="text-sm font-medium mb-2">Amazon API 同步状态</p>
              <div className="bg-background rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {renderApiSyncBadge(log)}
                  {log.apiSyncedAt && (
                    <span className="text-xs text-muted-foreground">
                      同步时间: {formatDateTime(log.apiSyncedAt)}
                    </span>
                  )}
                </div>
                
                {/* v140: API同步详情 - 支持单条状态和旧版批量状态 */}
                {log.apiSyncDetail && (() => {
                  try {
                    const syncDetail = JSON.parse(log.apiSyncDetail);
                    
                    // v140新格式: 单条同步状态 {status, error}
                    if (syncDetail.status && !syncDetail.totalSuccess && syncDetail.totalSuccess !== 0) {
                      return (
                        <div className="text-sm space-y-1">
                          {syncDetail.status === 'synced' && (
                            <span className="text-green-400">✅ 已成功同步到Amazon</span>
                          )}
                          {syncDetail.status === 'failed' && (
                            <div>
                              <span className="text-red-400">❌ 同步失败</span>
                              {syncDetail.error && (
                                <p className="text-red-400 text-xs mt-1">原因: {syncDetail.error}</p>
                              )}
                            </div>
                          )}
                          {syncDetail.status === 'pending' && (
                            <span className="text-yellow-400">⏳ 等待同步</span>
                          )}
                        </div>
                      );
                    }
                    
                    // 旧版格式: 批量同步状态 {totalSuccess, totalFailed, errors}
                    return (
                      <div className="text-sm space-y-1">
                        <div className="flex gap-4">
                          <span className="text-green-400">成功: {syncDetail.totalSuccess || 0}</span>
                          <span className="text-red-400">失败: {syncDetail.totalFailed || 0}</span>
                        </div>
                        {syncDetail.errors && syncDetail.errors.length > 0 && (
                          <div className="text-red-400 text-xs mt-1">
                            {syncDetail.errors.map((err: string, i: number) => (
                              <p key={i}>{err}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  } catch {
                    return <p className="text-xs text-muted-foreground">{log.apiSyncDetail}</p>;
                  }
                })()}
                
                {!log.apiSyncStatus && (
                  <p className="text-xs text-muted-foreground">
                    此日志记录于API同步状态追踪功能上线前，无法确认是否已同步到Amazon
                  </p>
                )}
              </div>
            </div>
            
            <Separator />
            
            {/* 操作详情 */}
            <div>
              <p className="text-sm font-medium mb-2">操作详情</p>
              <div className="bg-background rounded-lg p-3 space-y-3">
                {/* 目标关键词/ASIN */}
                {actionDetail && actionDetail.keywordText && (
                  <div className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {actionDetail.isProductTarget ? '商品定向:' : '关键词:'}
                    </span>
                    <span className="font-mono font-medium text-blue-300">{actionDetail.keywordText}</span>
                  </div>
                )}
                
                {/* 出价变更 */}
                {(log.previousValue || log.newValue) && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0">出价变更:</span>
                    {renderBidChange(log)}
                  </div>
                )}
                
                {/* 变更原因 */}
                {log.changeReason && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">调整原因: </span>
                    <span className="text-foreground">{log.changeReason}</span>
                  </div>
                )}
                
                {/* 搜索词信息（用于搜索词收割/否定词日志） */}
                {actionDetail && actionDetail.searchTerm && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">搜索词: </span>
                    <span className="font-mono text-blue-300">{actionDetail.searchTerm}</span>
                  </div>
                )}
                
                {/* 匹配类型 */}
                {actionDetail && actionDetail.matchType && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">匹配类型: </span>
                    <Badge variant="outline" className="text-xs">{actionDetail.matchType}</Badge>
                  </div>
                )}
                
                {/* 分时竞价信息 */}
                {actionDetail && actionDetail.bidMultiplier !== undefined && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">时段: </span>
                        <span className="font-medium">{actionDetail.hour}:00</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">星期: </span>
                        <span className="font-medium">{['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'][actionDetail.dayOfWeek] || actionDetail.dayOfWeek}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">乘数: </span>
                        <span className="font-medium">{actionDetail.bidMultiplier}x</span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 预算调整信息 */}
                {actionDetail && actionDetail.currentBudget !== undefined && actionDetail.suggestedBudget !== undefined && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">当前预算: </span>
                        <span className="font-mono text-red-400 line-through">${actionDetail.currentBudget.toFixed(2)}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">新预算: </span>
                        <span className="font-mono text-green-400 font-medium">${actionDetail.suggestedBudget.toFixed(2)}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">变化: </span>
                        <span className={`font-mono ${actionDetail.changeAmount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {actionDetail.changeAmount > 0 ? '+' : ''}${actionDetail.changeAmount?.toFixed(2)} ({actionDetail.changePercent}%)
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 位置调整信息 */}
                {actionDetail && actionDetail.placement && (
                  <div className="text-sm space-y-1">
                    <div className="flex gap-4 flex-wrap">
                      <span>
                        <span className="text-muted-foreground">广告位: </span>
                        <span className="font-medium">
                          {({'top_of_search': '\u641c\u7d22\u9876\u90e8', 'product_page': '\u5546\u54c1\u9875\u9762', 'rest_of_search': '\u641c\u7d22\u5176\u4ed6'} as Record<string, string>)[actionDetail.placement as string] || actionDetail.placement}
                        </span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">当前乘数: </span>
                        <span className="font-mono text-red-400 line-through">{actionDetail.currentMultiplier}%</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">新乘数: </span>
                        <span className="font-mono text-green-400 font-medium">{actionDetail.suggestedMultiplier}%</span>
                      </span>
                    </div>
                  </div>
                )}
                
                {/* 关键词/广告活动/广告组状态变更信息 */}
                {actionDetail && (actionDetail.action === 'pause' || actionDetail.action === 'enable') && (
                  <div className="text-sm space-y-2">
                    {/* 实体类型和名称 */}
                    <div>
                      <span className="text-muted-foreground">
                        {actionDetail.entityType === 'campaign' ? '广告活动: ' : 
                         actionDetail.entityType === 'adGroup' ? '广告组: ' : '投放词: '}
                      </span>
                      <span className="font-mono font-medium text-blue-300">
                        {actionDetail.entityType === 'campaign' ? actionDetail.campaignName :
                         actionDetail.entityType === 'adGroup' ? actionDetail.adGroupName :
                         actionDetail.keywordText || '-'}
                      </span>
                    </div>
                    
                    {/* 广告组所属广告活动 */}
                    {actionDetail.entityType === 'adGroup' && actionDetail.campaignName && (
                      <div>
                        <span className="text-muted-foreground">所属广告活动: </span>
                        <span className="font-medium">{actionDetail.campaignName}</span>
                      </div>
                    )}
                    
                    {/* 状态变更 */}
                    <div>
                      <span className="text-muted-foreground">状态变更: </span>
                      <span className="text-red-400">{actionDetail.currentStatus}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1 text-muted-foreground" />
                      <span className="text-green-400 font-medium">{actionDetail.newStatus || actionDetail.action}</span>
                    </div>
                    
                    {/* 绩效数据（广告活动/广告组状态变更时显示） */}
                    {(actionDetail.entityType === 'campaign' || actionDetail.entityType === 'adGroup') && (
                      <div className="flex gap-4 flex-wrap text-xs mt-1">
                        {actionDetail.spend !== undefined && (
                          <span>
                            <span className="text-muted-foreground">花费: </span>
                            <span className="font-mono">${Number(actionDetail.spend).toFixed(2)}</span>
                          </span>
                        )}
                        {actionDetail.sales !== undefined && (
                          <span>
                            <span className="text-muted-foreground">销售: </span>
                            <span className="font-mono">${Number(actionDetail.sales).toFixed(2)}</span>
                          </span>
                        )}
                        {actionDetail.clicks !== undefined && (
                          <span>
                            <span className="text-muted-foreground">点击: </span>
                            <span className="font-mono">{actionDetail.clicks}</span>
                          </span>
                        )}
                        {actionDetail.conversions !== undefined && (
                          <span>
                            <span className="text-muted-foreground">转化: </span>
                            <span className="font-mono">{actionDetail.conversions}</span>
                          </span>
                        )}
                        {actionDetail.acos !== undefined && actionDetail.acos > 0 && (
                          <span>
                            <span className="text-muted-foreground">ACoS: </span>
                            <span className="font-mono">{Number(actionDetail.acos).toFixed(1)}%</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* 错误信息 */}
                {log.errorMessage && (
                  <div className="text-sm text-red-400 bg-red-500/10 rounded p-2 mt-2">
                    <span className="font-medium">错误: </span>
                    <span>{log.errorMessage}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              优化日志
            </CardTitle>
            <CardDescription>
              {performanceGroupName || '优化目标'}的完整操作记录与Amazon同步状态
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* 分类标签页 */}
        <Tabs value={activeCategory} onValueChange={(v) => { setActiveCategory(v); setPage(1); }}>
          <TabsList className="grid grid-cols-5 w-full">
            {Object.entries(LOG_CATEGORIES).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <TabsTrigger key={key} value={key} className="text-xs">
                  <Icon className={`w-4 h-4 mr-1 ${config.color}`} />
                  <span className="hidden sm:inline">{config.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        
        {/* 搜索框 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索日志（关键词、广告活动、出价、原因等）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        {/* 日志列表 */}
        <ScrollArea className="h-[600px]">
          {logsLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredLogs.length > 0 ? (
            <div className="space-y-2">
              {filteredLogs.map(renderLogItem)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p>暂无日志记录</p>
            </div>
          )}
        </ScrollArea>
        
        {/* 分页 */}
        {logsData && logsData.total > pageSize && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              共 {logsData.total} 条记录，第 {page} / {Math.ceil(logsData.total / pageSize)} 页
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(logsData.total / pageSize)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OptimizationLogs;
