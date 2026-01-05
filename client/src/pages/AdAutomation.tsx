import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Pause,
  Settings2,
  ChevronRight,
  Info,
  Activity,
  Lightbulb,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Type definitions
interface NgramResult {
  ngram: string;
  frequency: number;
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  isNegativeCandidate: boolean;
  reason: string;
  affectedTerms: string[];
  totalSpend?: number;
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
}

interface TrafficConflict {
  searchTerm: string;
  campaigns: Array<{
    campaignId: number;
    campaignName: string;
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
    loserCampaigns: string[];
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
  const classifyQuery = trpc.adAutomation.classifySearchTerms.useQuery({
    accountId: parseInt(selectedAccount),
    productKeywords: [],
    productCategory: '',
    productBrand: '',
  }, {
    enabled: false,
  });

  const runAnalysis = async (type: string) => {
    try {
      switch (type) {
        case 'ngram':
          await ngramQuery.refetch();
          if (ngramQuery.data) {
            toast.success(`分析完成：发现 ${ngramQuery.data.negativeNgramCandidates.length} 个无效词根`);
          }
          break;
        case 'funnel':
          await funnelQuery.refetch();
          if (funnelQuery.data) {
            toast.success(`分析完成：发现 ${funnelQuery.data.totalSuggestions} 个迁移建议`);
          }
          break;
        case 'conflict':
          await conflictQuery.refetch();
          if (conflictQuery.data) {
            toast.success(`检测完成：发现 ${conflictQuery.data.totalConflicts} 个流量冲突`);
          }
          break;
        case 'bidding':
          await biddingQuery.refetch();
          if (biddingQuery.data) {
            toast.success(`分析完成：生成 ${biddingQuery.data.totalSuggestions} 个竞价建议`);
          }
          break;
        case 'classify':
          await classifyQuery.refetch();
          if (classifyQuery.data) {
            toast.success(`分类完成：处理 ${classifyQuery.data.totalClassified} 个搜索词`);
          }
          break;
      }
    } catch (error) {
      toast.error(`分析失败: ${(error as Error).message}`);
    }
  };

  const isAnalyzing = ngramQuery.isFetching || funnelQuery.isFetching || 
                      conflictQuery.isFetching || biddingQuery.isFetching || 
                      classifyQuery.isFetching;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">广告自动化</h1>
            <p className="text-muted-foreground mt-1">
              基于搜索意图的漏斗式精准流量运营体系
            </p>
          </div>
          <div className="flex items-center gap-4">
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

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">待处理无效词根</p>
                  <p className="text-2xl font-bold text-blue-500">
                    {ngramQuery.data?.negativeNgramCandidates?.length || 0}
                  </p>
                </div>
                <div className="p-3 bg-blue-500/10 rounded-full">
                  <Ban className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">漏斗迁移建议</p>
                  <p className="text-2xl font-bold text-green-500">
                    {funnelQuery.data?.totalSuggestions || 0}
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <GitBranch className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">流量冲突</p>
                  <p className="text-2xl font-bold text-amber-500">
                    {conflictQuery.data?.totalConflicts || 0}
                  </p>
                </div>
                <div className="p-3 bg-amber-500/10 rounded-full">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">竞价调整建议</p>
                  <p className="text-2xl font-bold text-purple-500">
                    {biddingQuery.data?.totalSuggestions || 0}
                  </p>
                </div>
                <div className="p-3 bg-purple-500/10 rounded-full">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
            <TabsTrigger value="ngram" className="gap-2">
              <Filter className="h-4 w-4" />
              N-Gram降噪
            </TabsTrigger>
            <TabsTrigger value="funnel" className="gap-2">
              <GitBranch className="h-4 w-4" />
              漏斗迁移
            </TabsTrigger>
            <TabsTrigger value="conflict" className="gap-2">
              <Layers className="h-4 w-4" />
              流量隔离
            </TabsTrigger>
            <TabsTrigger value="bidding" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              智能竞价
            </TabsTrigger>
            <TabsTrigger value="classify" className="gap-2">
              <Target className="h-4 w-4" />
              搜索词分类
            </TabsTrigger>
          </TabsList>

          {/* N-Gram Analysis Tab */}
          <TabsContent value="ngram" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Filter className="h-5 w-5 text-blue-500" />
                      N-Gram词根分析与批量降噪
                    </CardTitle>
                    <CardDescription>
                      自动分析无效搜索词的共同词根特征，识别高频无效词根（cheap, plastic, used等），生成批量否定词建议
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('ngram')}
                    disabled={isAnalyzing}
                  >
                    {ngramQuery.isFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        开始分析
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ngramQuery.data ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">分析的搜索词</p>
                        <p className="text-xl font-semibold">{ngramQuery.data.totalTermsAnalyzed}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">无效词根数量</p>
                        <p className="text-xl font-semibold text-red-500">{ngramQuery.data.negativeNgramCandidates.length}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">预计节省花费</p>
                        <p className="text-xl font-semibold text-green-500">
                          ${ngramQuery.data.negativeNgramCandidates.reduce((sum: number, r: NgramResult) => sum + (r.totalSpend || 0), 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {ngramQuery.data.negativeNgramCandidates.map((root: NgramResult, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <Badge variant="destructive">{root.ngram}</Badge>
                              <span className="text-sm text-muted-foreground">
                                {root.frequency} 次出现 · {root.affectedTerms.length} 个相关词
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm font-medium">${(root.totalSpend || 0).toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">花费</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium">{root.totalClicks}</p>
                                <p className="text-xs text-muted-foreground">点击</p>
                              </div>
                              <Button size="sm" variant="outline">
                                <Ban className="h-4 w-4 mr-1" />
                                否定
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Filter className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">点击"开始分析"按钮运行N-Gram词根分析</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      系统将自动识别1点击0转化的偶发性无效流量的共同词根特征
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Funnel Migration Tab */}
          <TabsContent value="funnel" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-green-500" />
                      广告漏斗自动迁移系统
                    </CardTitle>
                    <CardDescription>
                      监控广泛匹配中3次以上成交的词自动建议迁移到短语；短语中10次以上成交且ROAS&gt;5的词自动建议迁移到精准
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('funnel')}
                    disabled={isAnalyzing}
                  >
                    {funnelQuery.isFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        开始分析
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {funnelQuery.data ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <Card className="bg-blue-500/5 border-blue-500/20">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500">广泛→短语</Badge>
                          </div>
                          <p className="text-2xl font-bold">
                            {funnelQuery.data.broadToPhrase.length}
                          </p>
                          <p className="text-sm text-muted-foreground">个迁移建议</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-green-500/5 border-green-500/20">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="bg-green-500/10 text-green-500">短语→精准</Badge>
                          </div>
                          <p className="text-2xl font-bold">
                            {funnelQuery.data.phraseToExact.length}
                          </p>
                          <p className="text-sm text-muted-foreground">个迁移建议</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-purple-500/5 border-purple-500/20">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="bg-purple-500/10 text-purple-500">预计提升</Badge>
                          </div>
                          <p className="text-2xl font-bold">
                            {funnelQuery.data.totalSuggestions > 0 ? '15-25%' : '-'}
                          </p>
                          <p className="text-sm text-muted-foreground">ROAS提升</p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-2">
                        {[...funnelQuery.data.broadToPhrase, ...funnelQuery.data.phraseToExact].map((suggestion: FunnelSuggestion, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{suggestion.fromMatchType}</Badge>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                <Badge className="bg-green-500">{suggestion.toMatchType}</Badge>
                              </div>
                              <span className="font-medium">{suggestion.searchTerm}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm font-medium">{suggestion.conversions}</p>
                                <p className="text-xs text-muted-foreground">转化</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium">{suggestion.roas.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">ROAS</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium">${suggestion.suggestedBid.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">建议出价</p>
                              </div>
                              <Button size="sm" variant="outline">
                                <ArrowUpRight className="h-4 w-4 mr-1" />
                                迁移
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <GitBranch className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">点击"开始分析"按钮运行漏斗迁移分析</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      系统将自动识别表现优秀的搜索词，建议从广泛匹配升级到短语或精准匹配
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Traffic Conflict Tab */}
          <TabsContent value="conflict" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="h-5 w-5 text-amber-500" />
                      流量隔离与冲突检测
                    </CardTitle>
                    <CardDescription>
                      自动检测跨广告活动重叠搜索词，分析各活动表现，生成否定词建议将流量指派给最优活动
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('conflict')}
                    disabled={isAnalyzing}
                  >
                    {conflictQuery.isFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        检测中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        开始检测
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {conflictQuery.data ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                      <AlertTriangle className="h-8 w-8 text-amber-500" />
                      <div>
                        <p className="font-medium">检测到 {conflictQuery.data.totalConflicts} 个流量冲突</p>
                        <p className="text-sm text-muted-foreground">
                          预计浪费花费: ${conflictQuery.data.totalWastedSpend.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-3">
                        {conflictQuery.data.conflicts.map((conflict: TrafficConflict, index: number) => (
                          <Card key={index} className="border-amber-500/20">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500">
                                    {conflict.campaigns.length} 个活动冲突
                                  </Badge>
                                  <span className="font-medium">{conflict.searchTerm}</span>
                                </div>
                                <Button size="sm" variant="outline">
                                  <Settings2 className="h-4 w-4 mr-1" />
                                  处理冲突
                                </Button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {conflict.campaigns.map((campaign, cIndex: number) => (
                                  <div 
                                    key={cIndex} 
                                    className={`p-2 rounded-lg text-sm ${
                                      campaign.campaignName === conflict.recommendation.winnerCampaign 
                                        ? 'bg-green-500/10 border border-green-500/30' 
                                        : 'bg-muted/50'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="truncate">{campaign.campaignName}</span>
                                      {campaign.campaignName === conflict.recommendation.winnerCampaign && (
                                        <Badge className="bg-green-500 text-xs">最优</Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                      <span>ROAS: {campaign.roas.toFixed(2)}</span>
                                      <span>CVR: {(campaign.cvr * 100).toFixed(1)}%</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-sm text-muted-foreground mt-2">
                                <Lightbulb className="h-4 w-4 inline mr-1 text-amber-500" />
                                建议：{conflict.recommendation.reason}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">点击"开始检测"按钮运行流量冲突检测</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      系统将自动识别跨广告活动的重叠搜索词，并建议最优的流量分配方案
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Smart Bidding Tab */}
          <TabsContent value="bidding" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-purple-500" />
                      智能竞价调整系统
                    </CardTitle>
                    <CardDescription>
                      爬坡机制（半天+5%）、纠错机制、分时策略、动态竞价建议
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('bidding')}
                    disabled={isAnalyzing}
                  >
                    {biddingQuery.isFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        开始分析
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {biddingQuery.data ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <Card className="bg-green-500/5 border-green-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-green-500" />
                            <span className="text-sm">建议提价</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {biddingQuery.data.suggestions.filter((s: BidSuggestion) => s.adjustmentType === 'increase').length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-red-500/5 border-red-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="h-4 w-4 text-red-500" />
                            <span className="text-sm">建议降价</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {biddingQuery.data.suggestions.filter((s: BidSuggestion) => s.adjustmentType === 'decrease').length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-gray-500/5 border-gray-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Pause className="h-4 w-4 text-gray-500" />
                            <span className="text-sm">建议暂停</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {biddingQuery.data.suggestions.filter((s: BidSuggestion) => s.adjustmentType === 'maintain').length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-amber-500/5 border-amber-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-amber-500" />
                            <span className="text-sm">紧急处理</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {biddingQuery.data.urgentCount}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-2">
                        {biddingQuery.data.suggestions.map((suggestion: BidSuggestion, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-full ${
                                suggestion.adjustmentType === 'increase' ? 'bg-green-500/10' :
                                suggestion.adjustmentType === 'decrease' ? 'bg-red-500/10' :
                                suggestion.adjustmentType === 'maintain' ? 'bg-gray-500/10' :
                                'bg-blue-500/10'
                              }`}>
                                {suggestion.adjustmentType === 'increase' ? <TrendingUp className="h-4 w-4 text-green-500" /> :
                                 suggestion.adjustmentType === 'decrease' ? <TrendingDown className="h-4 w-4 text-red-500" /> :
                                 suggestion.adjustmentType === 'maintain' ? <Pause className="h-4 w-4 text-gray-500" /> :
                                 <Activity className="h-4 w-4 text-blue-500" />}
                              </div>
                              <div>
                                <p className="font-medium">{suggestion.targetName}</p>
                                <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm">${suggestion.currentBid.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">当前出价</p>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              <div className="text-right">
                                <p className={`text-sm font-medium ${
                                  suggestion.adjustmentType === 'increase' ? 'text-green-500' :
                                  suggestion.adjustmentType === 'decrease' ? 'text-red-500' :
                                  ''
                                }`}>
                                  ${suggestion.suggestedBid.toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground">建议出价</p>
                              </div>
                              <Badge variant="outline" className={
                                suggestion.priority === 'urgent' ? 'border-red-500 text-red-500' :
                                suggestion.priority === 'high' ? 'border-amber-500 text-amber-500' :
                                ''
                              }>
                                {suggestion.priority}
                              </Badge>
                              <Button size="sm" variant="outline">
                                应用
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <TrendingUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">点击"开始分析"按钮运行智能竞价分析</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      系统将基于绩效数据和目标ACoS生成竞价调整建议
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Search Term Classification Tab */}
          <TabsContent value="classify" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-cyan-500" />
                      搜索词智能分类
                    </CardTitle>
                    <CardDescription>
                      基于语义分析自动分类为高相关、弱相关、看似相关实则无关、完全无关
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={() => runAnalysis('classify')}
                    disabled={isAnalyzing}
                  >
                    {classifyQuery.isFetching ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        分类中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        开始分类
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {classifyQuery.data ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <Card className="bg-green-500/5 border-green-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm">高相关</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {classifyQuery.data.highRelevance.length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-blue-500/5 border-blue-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Info className="h-4 w-4 text-blue-500" />
                            <span className="text-sm">弱相关</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {classifyQuery.data.weakRelevance.length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-amber-500/5 border-amber-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            <span className="text-sm">看似相关</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {classifyQuery.data.seeminglyRelated.length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-red-500/5 border-red-500/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-500" />
                            <span className="text-sm">完全无关</span>
                          </div>
                          <p className="text-xl font-bold mt-1">
                            {classifyQuery.data.unrelated.length}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-2">
                        {[
                          ...classifyQuery.data.highRelevance,
                          ...classifyQuery.data.weakRelevance,
                          ...classifyQuery.data.seeminglyRelated,
                          ...classifyQuery.data.unrelated,
                        ].map((item: SearchTermClassification, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <Badge className={
                                item.relevance === 'high' ? 'bg-green-500' :
                                item.relevance === 'weak' ? 'bg-blue-500' :
                                item.relevance === 'seemingly_related' ? 'bg-amber-500' :
                                'bg-red-500'
                              }>
                                {item.relevance === 'high' ? '高相关' :
                                 item.relevance === 'weak' ? '弱相关' :
                                 item.relevance === 'seemingly_related' ? '看似相关' :
                                 '完全无关'}
                              </Badge>
                              <span className="font-medium">{item.searchTerm}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="w-32">
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span>置信度</span>
                                  <span>{(item.confidence * 100).toFixed(0)}%</span>
                                </div>
                                <Progress value={item.confidence * 100} className="h-1" />
                              </div>
                              <Badge variant="outline">{item.suggestedAction}</Badge>
                              <Button size="sm" variant="outline">
                                {item.relevance === 'unrelated' || item.relevance === 'seemingly_related' ? (
                                  <>
                                    <Ban className="h-4 w-4 mr-1" />
                                    否定
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="h-4 w-4 mr-1" />
                                    保留
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Target className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">点击"开始分类"按钮运行搜索词智能分类</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      系统将基于语义分析对搜索词进行相关性分类
                    </p>
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
