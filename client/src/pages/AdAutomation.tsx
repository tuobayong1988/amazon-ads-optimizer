import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Filter, 
  ArrowUpRight, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  Layers,
  GitBranch,
  Ban,
  RefreshCw,
  Play,
  Settings2,
  ChevronRight,
  Info,
  Activity,
  Lightbulb,
  Building2,
  FolderTree,
  AlertCircle,
  Package,
  Search,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Type definitions - 更新以支持否定层级
interface NgramResult {
  ngram: string;
  frequency: number;
  totalClicks: number;
  totalConversions: number;
  totalSpend: number;
  conversionRate: number;
  isNegativeCandidate: boolean;
  reason: string;
  affectedTerms: string[];
  suggestedNegativeLevel: 'ad_group' | 'campaign';
  hasProductTargeting: boolean;
}

interface FunnelSuggestion {
  searchTerm: string;
  fromCampaign: string;
  fromMatchType: string;
  toMatchType: string;
  reason: string;
  suggestedBid: number;
  currentCpc: number;
  conversions: number;
  roas: number;
  priority: string;
  negativeInOriginal: boolean;
  negativeLevel: 'ad_group' | 'campaign';
}

interface LoserCampaign {
  name: string;
  campaignType: string;
  targetingType: string;
  negativeLevel: 'ad_group' | 'campaign';
}

interface TrafficConflict {
  searchTerm: string;
  campaigns: Array<{
    campaignId: number;
    campaignName: string;
    campaignType?: string;
    targetingType?: string;
    matchType: string;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    ctr: number;
    cvr: number;
  }>;
  recommendation: {
    winnerCampaign: string;
    winnerCampaignType?: string;
    winnerTargetingType?: string;
    loserCampaigns: string[] | LoserCampaign[];
    action: string;
    reason: string;
  };
  totalWastedSpend: number;
}

interface BidSuggestion {
  targetId: number;
  targetType: string;
  targetName: string;
  campaignName: string;
  currentBid: number;
  suggestedBid: number;
  adjustmentPercent: number;
  adjustmentType: string;
  reason: string;
  priority: string;
  metrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number;
    roas: number;
    ctr: number;
    cvr: number;
  };
}

interface SearchTermClassification {
  searchTerm: string;
  relevance: string;
  confidence: number;
  reason: string;
  suggestedAction: string;
  matchTypeSuggestion?: string;
}

// 否定层级徽章组件
function NegativeLevelBadge({ level, hasProductTargeting }: { level: 'ad_group' | 'campaign'; hasProductTargeting?: boolean }) {
  if (level === 'campaign') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 gap-1">
            <Building2 className="w-3 h-3" />
            活动层级
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">
            {hasProductTargeting 
              ? "包含产品定位广告，只能在活动层级否定" 
              : "建议在活动层级否定"}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 gap-1">
          <FolderTree className="w-3 h-3" />
          广告组层级
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>可以在广告组层级精细否定</p>
      </TooltipContent>
    </Tooltip>
  );
}

// 产品定位警告组件
function ProductTargetingWarning() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
      <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-orange-400">产品定位广告注意事项</p>
        <p className="text-sm text-muted-foreground mt-1">
          产品定位广告（Product Targeting）产生的搜索词只能在<strong className="text-orange-400">活动层级</strong>进行否定，
          无法在广告组层级否定。系统会自动识别并标注需要在活动层级否定的词。
        </p>
      </div>
    </div>
  );
}

export default function AdAutomation() {
  const [selectedAccount, setSelectedAccount] = useState<string>("1");
  const [activeTab, setActiveTab] = useState("ngram");
  
  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // N-Gram Analysis
  const ngramQuery = trpc.adAutomation.analyzeNgrams.useQuery({
    accountId: parseInt(selectedAccount),
    days: 30,
  }, {
    enabled: false,
  });
  
  // Funnel Migration
  const funnelQuery = trpc.adAutomation.analyzeFunnelMigration.useQuery({
    accountId: parseInt(selectedAccount),
  }, {
    enabled: false,
  });
  
  // Traffic Conflict Detection
  const conflictQuery = trpc.adAutomation.detectTrafficConflicts.useQuery({
    accountId: parseInt(selectedAccount),
  }, {
    enabled: false,
  });
  
  // Smart Bidding
  const biddingQuery = trpc.adAutomation.analyzeBidAdjustments.useQuery({
    accountId: parseInt(selectedAccount),
    targetAcos: 30,
  }, {
    enabled: false,
  });
  
  // Search Term Classification
  const classificationQuery = trpc.adAutomation.classifySearchTerms.useQuery({
    accountId: parseInt(selectedAccount),
    productKeywords: ["wireless earbuds", "bluetooth headphones", "earphones"],
    productCategory: "Electronics Audio",
    productBrand: "TechSound",
    productColors: ["black", "white"],
    productSizes: [],
  }, {
    enabled: false,
  });

  const runAnalysis = (type: string) => {
    switch (type) {
      case 'ngram':
        ngramQuery.refetch();
        toast.info("正在运行N-Gram词根分析...");
        break;
      case 'funnel':
        funnelQuery.refetch();
        toast.info("正在分析漏斗迁移建议...");
        break;
      case 'conflict':
        conflictQuery.refetch();
        toast.info("正在检测流量冲突...");
        break;
      case 'bidding':
        biddingQuery.refetch();
        toast.info("正在分析智能竞价建议...");
        break;
      case 'classification':
        classificationQuery.refetch();
        toast.info("正在进行搜索词分类...");
        break;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">紧急</Badge>;
      case 'high':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">高</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">中</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">低</Badge>;
    }
  };

  const getRelevanceBadge = (relevance: string) => {
    switch (relevance) {
      case 'high':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">高相关</Badge>;
      case 'weak':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">弱相关</Badge>;
      case 'seemingly_related':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">看似相关</Badge>;
      default:
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">无关</Badge>;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'target':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">投放</Badge>;
      case 'monitor':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">观察</Badge>;
      case 'negative_phrase':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">短语否定</Badge>;
      default:
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">精确否定</Badge>;
    }
  };

  // 统计信息
  const ngramData = ngramQuery.data?.allNgrams || [];
  const ngramStats = ngramQuery.data ? {
    total: ngramData.length,
    negative: ngramData.filter((n: NgramResult) => n.isNegativeCandidate).length,
    campaignLevel: ngramData.filter((n: NgramResult) => n.suggestedNegativeLevel === 'campaign').length,
    adGroupLevel: ngramData.filter((n: NgramResult) => n.suggestedNegativeLevel === 'ad_group').length,
  } : null;

  const biddingData = biddingQuery.data?.suggestions || [];
  const biddingStats = biddingQuery.data ? {
    total: biddingData.length,
    increase: biddingData.filter((b: BidSuggestion) => b.adjustmentType === 'increase').length,
    decrease: biddingData.filter((b: BidSuggestion) => b.adjustmentType === 'decrease').length,
    urgent: biddingData.filter((b: BidSuggestion) => b.priority === 'urgent').length,
  } : null;

  // 漏斗迁移数据
  const funnelData = [...(funnelQuery.data?.broadToPhrase || []), ...(funnelQuery.data?.phraseToExact || [])];
  
  // 流量冲突数据
  const conflictData = conflictQuery.data?.conflicts || [];
  
  // 搜索词分类数据
  const classificationData = [
    ...(classificationQuery.data?.highRelevance || []),
    ...(classificationQuery.data?.weakRelevance || []),
    ...(classificationQuery.data?.seeminglyRelated || []),
    ...(classificationQuery.data?.unrelated || [])
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">广告自动化</h1>
            <p className="text-muted-foreground mt-1">
              智能分析和优化您的亚马逊广告活动
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择广告账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 产品定位广告警告 */}
        <ProductTargetingWarning />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid grid-cols-5 w-full max-w-3xl">
            <TabsTrigger value="ngram" className="gap-2">
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">N-Gram分析</span>
            </TabsTrigger>
            <TabsTrigger value="funnel" className="gap-2">
              <GitBranch className="w-4 h-4" />
              <span className="hidden sm:inline">漏斗迁移</span>
            </TabsTrigger>
            <TabsTrigger value="conflict" className="gap-2">
              <Layers className="w-4 h-4" />
              <span className="hidden sm:inline">流量隔离</span>
            </TabsTrigger>
            <TabsTrigger value="bidding" className="gap-2">
              <Zap className="w-4 h-4" />
              <span className="hidden sm:inline">智能竞价</span>
            </TabsTrigger>
            <TabsTrigger value="classification" className="gap-2">
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">搜索词分类</span>
            </TabsTrigger>
          </TabsList>

          {/* N-Gram Analysis Tab */}
          <TabsContent value="ngram" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Filter className="w-5 h-5 text-primary" />
                      N-Gram词根分析
                    </CardTitle>
                    <CardDescription className="mt-1">
                      分析无效搜索词的共同词根特征，批量识别需要否定的词
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('ngram')}
                    disabled={ngramQuery.isFetching}
                  >
                    {ngramQuery.isFetching ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    开始分析
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ngramStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-2xl font-bold">{ngramStats.total}</p>
                      <p className="text-sm text-muted-foreground">分析词根数</p>
                    </div>
                    <div className="p-4 rounded-lg bg-red-500/10">
                      <p className="text-2xl font-bold text-red-400">{ngramStats.negative}</p>
                      <p className="text-sm text-muted-foreground">建议否定</p>
                    </div>
                    <div className="p-4 rounded-lg bg-orange-500/10">
                      <p className="text-2xl font-bold text-orange-400">{ngramStats.campaignLevel}</p>
                      <p className="text-sm text-muted-foreground">活动层级否定</p>
                    </div>
                    <div className="p-4 rounded-lg bg-blue-500/10">
                      <p className="text-2xl font-bold text-blue-400">{ngramStats.adGroupLevel}</p>
                      <p className="text-sm text-muted-foreground">广告组层级否定</p>
                    </div>
                  </div>
                )}

                {ngramData.length > 0 ? (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {ngramData.map((result: NgramResult, index: number) => (
                        <div 
                          key={index}
                          className={`p-4 rounded-lg border transition-colors ${
                            result.isNegativeCandidate 
                              ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/40' 
                              : 'bg-card hover:border-primary/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <code className="text-lg font-semibold px-2 py-1 bg-muted rounded">
                                  {result.ngram}
                                </code>
                                {result.isNegativeCandidate && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                                    建议否定
                                  </Badge>
                                )}
                                <NegativeLevelBadge 
                                  level={result.suggestedNegativeLevel} 
                                  hasProductTargeting={result.hasProductTargeting}
                                />
                                {result.hasProductTargeting && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="outline" className="gap-1 bg-purple-500/10 text-purple-400 border-purple-500/30">
                                        <Package className="w-3 h-3" />
                                        含产品定位
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>此词根包含来自产品定位广告的搜索词</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-2">
                                {result.reason || `出现${result.frequency}次，${result.totalClicks}次点击，${result.totalConversions}次转化`}
                              </p>
                              {result.totalSpend > 0 && (
                                <p className="text-sm text-red-400 mt-1">
                                  浪费花费: ${result.totalSpend.toFixed(2)}
                                </p>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-2xl font-bold">{result.frequency}</p>
                              <p className="text-xs text-muted-foreground">出现次数</p>
                            </div>
                          </div>
                          {result.affectedTerms.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border/50">
                              <p className="text-xs text-muted-foreground mb-2">影响的搜索词:</p>
                              <div className="flex flex-wrap gap-1">
                                {result.affectedTerms.slice(0, 5).map((term: string, i: number) => (
                                  <Badge key={i} variant="outline" className="text-xs">
                                    {term}
                                  </Badge>
                                ))}
                                {result.affectedTerms.length > 5 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{result.affectedTerms.length - 5} 更多
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>点击"开始分析"运行N-Gram词根分析</p>
                    <p className="text-sm mt-1">系统将自动识别无效搜索词的共同特征</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Funnel Migration Tab */}
          <TabsContent value="funnel" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      广告漏斗迁移
                    </CardTitle>
                    <CardDescription className="mt-1">
                      识别高转化搜索词，建议从广泛匹配迁移到短语/精准匹配
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('funnel')}
                    disabled={funnelQuery.isFetching}
                  >
                    {funnelQuery.isFetching ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    开始分析
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {funnelData.length > 0 ? (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {funnelData.map((suggestion: FunnelSuggestion, index: number) => (
                        <div 
                          key={index}
                          className="p-4 rounded-lg border bg-card hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{suggestion.searchTerm}</span>
                                {getPriorityBadge(suggestion.priority)}
                              </div>
                              <div className="flex items-center gap-2 mt-2 text-sm">
                                <Badge variant="outline">{suggestion.fromMatchType}</Badge>
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                  {suggestion.toMatchType}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-2">
                                {suggestion.reason}
                              </p>
                              {suggestion.negativeInOriginal && (
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-sm text-orange-400">原活动需否定:</span>
                                  <NegativeLevelBadge level={suggestion.negativeLevel} />
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-lg font-bold text-emerald-400">
                                ROAS {suggestion.roas.toFixed(2)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {suggestion.conversions} 转化
                              </p>
                              <p className="text-sm mt-1">
                                建议出价: ${suggestion.suggestedBid.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>点击"开始分析"检测可迁移的高转化搜索词</p>
                    <p className="text-sm mt-1">广泛→短语: 3次以上成交 | 短语→精准: 10次以上成交且ROAS&gt;5</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Traffic Conflict Tab */}
          <TabsContent value="conflict" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="w-5 h-5 text-primary" />
                      流量隔离与冲突检测
                    </CardTitle>
                    <CardDescription className="mt-1">
                      检测同一搜索词在多个广告活动中出现的情况，避免内部竞争
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('conflict')}
                    disabled={conflictQuery.isFetching}
                  >
                    {conflictQuery.isFetching ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    开始检测
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {conflictData.length > 0 ? (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-4">
                      {conflictData.map((conflict: TrafficConflict, index: number) => (
                        <div 
                          key={index}
                          className="p-4 rounded-lg border bg-card hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-lg">{conflict.searchTerm}</span>
                                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                                  {conflict.campaigns.length} 个活动冲突
                                </Badge>
                              </div>
                              <p className="text-sm text-red-400 mt-1">
                                预估浪费: ${conflict.totalWastedSpend.toFixed(2)}
                              </p>
                            </div>
                          </div>
                          
                          {/* 活动对比表格 */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border/50">
                                  <th className="text-left py-2 px-2">活动</th>
                                  <th className="text-left py-2 px-2">类型</th>
                                  <th className="text-right py-2 px-2">点击</th>
                                  <th className="text-right py-2 px-2">转化</th>
                                  <th className="text-right py-2 px-2">ROAS</th>
                                  <th className="text-right py-2 px-2">花费</th>
                                </tr>
                              </thead>
                              <tbody>
                                {conflict.campaigns.map((campaign, i) => (
                                  <tr 
                                    key={i} 
                                    className={`border-b border-border/30 ${
                                      campaign.campaignName === conflict.recommendation.winnerCampaign 
                                        ? 'bg-emerald-500/5' 
                                        : ''
                                    }`}
                                  >
                                    <td className="py-2 px-2">
                                      <div className="flex items-center gap-2">
                                        {campaign.campaignName === conflict.recommendation.winnerCampaign && (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                        )}
                                        <span className="truncate max-w-[150px]">{campaign.campaignName}</span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-2">
                                      <Badge variant="outline" className="text-xs">
                                        {campaign.matchType}
                                      </Badge>
                                    </td>
                                    <td className="text-right py-2 px-2">{campaign.clicks}</td>
                                    <td className="text-right py-2 px-2">{campaign.conversions}</td>
                                    <td className="text-right py-2 px-2">{campaign.roas.toFixed(2)}</td>
                                    <td className="text-right py-2 px-2">${campaign.spend.toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          
                          {/* 建议 */}
                          <div className="mt-4 p-3 rounded-lg bg-muted/50">
                            <div className="flex items-start gap-2">
                              <Lightbulb className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-sm font-medium">优化建议</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {conflict.recommendation.reason}
                                </p>
                                {/* 显示每个失败活动的否定层级 */}
                                {Array.isArray(conflict.recommendation.loserCampaigns) && 
                                 conflict.recommendation.loserCampaigns.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {conflict.recommendation.loserCampaigns.map((loser, i) => {
                                      const loserInfo = typeof loser === 'string' 
                                        ? { name: loser, negativeLevel: 'ad_group' as const }
                                        : loser;
                                      return (
                                        <div key={i} className="flex items-center gap-2 text-sm">
                                          <Ban className="w-3 h-3 text-red-400" />
                                          <span className="text-muted-foreground">{loserInfo.name}:</span>
                                          <NegativeLevelBadge level={loserInfo.negativeLevel} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>点击"开始检测"分析流量冲突情况</p>
                    <p className="text-sm mt-1">系统将识别在多个活动中重复出现的搜索词</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Smart Bidding Tab */}
          <TabsContent value="bidding" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-primary" />
                      智能竞价调整
                    </CardTitle>
                    <CardDescription className="mt-1">
                      基于爬坡机制、纠错机制和分时策略的智能出价建议
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('bidding')}
                    disabled={biddingQuery.isFetching}
                  >
                    {biddingQuery.isFetching ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    开始分析
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {biddingStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-2xl font-bold">{biddingStats.total}</p>
                      <p className="text-sm text-muted-foreground">调整建议</p>
                    </div>
                    <div className="p-4 rounded-lg bg-emerald-500/10">
                      <p className="text-2xl font-bold text-emerald-400">{biddingStats.increase}</p>
                      <p className="text-sm text-muted-foreground">建议提价</p>
                    </div>
                    <div className="p-4 rounded-lg bg-red-500/10">
                      <p className="text-2xl font-bold text-red-400">{biddingStats.decrease}</p>
                      <p className="text-sm text-muted-foreground">建议降价</p>
                    </div>
                    <div className="p-4 rounded-lg bg-orange-500/10">
                      <p className="text-2xl font-bold text-orange-400">{biddingStats.urgent}</p>
                      <p className="text-sm text-muted-foreground">紧急处理</p>
                    </div>
                  </div>
                )}

                {biddingData.length > 0 ? (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {biddingData.map((suggestion: BidSuggestion, index: number) => (
                        <div 
                          key={index}
                          className={`p-4 rounded-lg border transition-colors ${
                            suggestion.priority === 'urgent' 
                              ? 'bg-red-500/5 border-red-500/20' 
                              : 'bg-card hover:border-primary/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{suggestion.targetName}</span>
                                {getPriorityBadge(suggestion.priority)}
                                <Badge variant="outline" className="text-xs">
                                  {suggestion.targetType === 'keyword' ? '关键词' : '产品定位'}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {suggestion.campaignName}
                              </p>
                              <p className="text-sm mt-2">{suggestion.reason}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="flex items-center gap-2 justify-end">
                                <span className="text-muted-foreground">${suggestion.currentBid.toFixed(2)}</span>
                                <ChevronRight className="w-4 h-4" />
                                <span className={`font-bold ${
                                  suggestion.adjustmentType === 'increase' ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                  ${suggestion.suggestedBid.toFixed(2)}
                                </span>
                              </div>
                              <p className={`text-sm mt-1 ${
                                suggestion.adjustmentType === 'increase' ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {suggestion.adjustmentType === 'increase' ? '+' : ''}{suggestion.adjustmentPercent.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          
                          {/* 指标详情 */}
                          <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-4 md:grid-cols-5 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">曝光</p>
                              <p className="font-medium">{suggestion.metrics.impressions.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">点击</p>
                              <p className="font-medium">{suggestion.metrics.clicks}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">转化</p>
                              <p className="font-medium">{suggestion.metrics.conversions}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">ACoS</p>
                              <p className="font-medium">{suggestion.metrics.acos}%</p>
                            </div>
                            <div className="hidden md:block">
                              <p className="text-muted-foreground">ROAS</p>
                              <p className="font-medium">{suggestion.metrics.roas}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>点击"开始分析"获取智能竞价建议</p>
                    <p className="text-sm mt-1">包含爬坡机制、纠错机制和分时策略</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Search Term Classification Tab */}
          <TabsContent value="classification" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Search className="w-5 h-5 text-primary" />
                      搜索词智能分类
                    </CardTitle>
                    <CardDescription className="mt-1">
                      基于语义分析自动分类搜索词的相关性
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('classification')}
                    disabled={classificationQuery.isFetching}
                  >
                    {classificationQuery.isFetching ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    开始分类
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {classificationData.length > 0 ? (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {classificationData.map((item: SearchTermClassification, index: number) => (
                        <div 
                          key={index}
                          className="p-4 rounded-lg border bg-card hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{item.searchTerm}</span>
                                {getRelevanceBadge(item.relevance)}
                                {getActionBadge(item.suggestedAction)}
                              </div>
                              <p className="text-sm text-muted-foreground mt-2">
                                {item.reason}
                              </p>
                              {item.matchTypeSuggestion && (
                                <p className="text-sm mt-1">
                                  建议匹配类型: <Badge variant="outline">{item.matchTypeSuggestion}</Badge>
                                </p>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-lg font-bold">{(item.confidence * 100).toFixed(0)}%</p>
                              <p className="text-xs text-muted-foreground">置信度</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>点击"开始分类"进行搜索词智能分类</p>
                    <p className="text-sm mt-1">分类为：高相关、弱相关、看似相关、完全无关</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
