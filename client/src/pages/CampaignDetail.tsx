import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Target,
  MousePointerClick,
  Eye,
  ShoppingCart,
  Percent,
  BarChart3,
  Layers,
  Tag,
  Zap,
  Megaphone,
  Monitor
} from "lucide-react";

// 广告活动类型图标映射
const campaignTypeIcons: Record<string, any> = {
  sp_auto: Zap,
  sp_manual: Target,
  sb: Megaphone,
  sd: Monitor,
};

const campaignTypeLabels: Record<string, string> = {
  sp_auto: "SP 自动",
  sp_manual: "SP 手动",
  sb: "SB 品牌",
  sd: "SD 展示",
};

export default function CampaignDetail() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/campaigns/:id");
  const campaignId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("overview");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryMetrics, setSummaryMetrics] = useState<any>(null);
  
  // 获取广告活动详情
  const { data: campaign, isLoading: campaignLoading, refetch: refetchCampaign } = trpc.campaign.get.useQuery(
    { id: campaignId! },
    { enabled: !!campaignId }
  );
  
  // 获取广告组列表
  const { data: adGroups, isLoading: adGroupsLoading } = trpc.campaign.getAdGroups.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId }
  );
  
  // AI摘要生成
  const generateSummaryMutation = trpc.campaign.generateAISummary.useMutation({
    onSuccess: (data) => {
      setAiSummary(data.summary);
      setSummaryMetrics(data.metrics);
      toast.success("AI摘要生成成功");
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
  });
  
  const handleGenerateSummary = () => {
    if (campaignId) {
      generateSummaryMutation.mutate({ campaignId });
    }
  };
  
  if (!match || !campaignId) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">无效的广告活动ID</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  if (campaignLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }
  
  if (!campaign) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">广告活动不存在</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  // 计算指标
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? (spend / sales * 100) : 0;
  const roas = spend > 0 ? (sales / spend) : 0;
  const clicks = campaign.clicks || 0;
  const impressions = campaign.impressions || 0;
  const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
  const orders = campaign.orders || 0;
  const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
  
  const TypeIcon = campaignTypeIcons[campaign.campaignType] || Target;
  
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 头部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/campaigns")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回列表
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <TypeIcon className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-bold">{campaign.campaignName}</h1>
                <Badge variant={campaign.status === "enabled" ? "default" : "secondary"}>
                  {campaign.status === "enabled" ? "启用" : campaign.status === "paused" ? "暂停" : "归档"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {campaignTypeLabels[campaign.campaignType] || campaign.campaignType} · 
                日预算: ${campaign.dailyBudget || "N/A"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchCampaign()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>
        
        {/* AI摘要卡片 */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">AI 智能分析</CardTitle>
              </div>
              <Button 
                size="sm" 
                onClick={handleGenerateSummary}
                disabled={generateSummaryMutation.isPending}
              >
                {generateSummaryMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {aiSummary ? "重新生成" : "生成摘要"}
                  </>
                )}
              </Button>
            </div>
            <CardDescription>
              基于广告数据的智能分析和优化建议
            </CardDescription>
          </CardHeader>
          <CardContent>
            {aiSummary ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Streamdown>{aiSummary}</Streamdown>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>点击"生成摘要"按钮，AI将分析该广告活动的表现并提供优化建议</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* 核心指标卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs">花费</span>
              </div>
              <p className="text-2xl font-bold">${spend.toFixed(2)}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-xs">销售额</span>
              </div>
              <p className="text-2xl font-bold">${sales.toFixed(2)}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Percent className="h-4 w-4" />
                <span className="text-xs">ACoS</span>
              </div>
              <p className={`text-2xl font-bold ${acos > 30 ? "text-red-500" : acos > 20 ? "text-yellow-500" : "text-green-500"}`}>
                {acos.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs">ROAS</span>
              </div>
              <p className={`text-2xl font-bold ${roas < 2 ? "text-red-500" : roas < 3 ? "text-yellow-500" : "text-green-500"}`}>
                {roas.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Eye className="h-4 w-4" />
                <span className="text-xs">展示次数</span>
              </div>
              <p className="text-2xl font-bold">{impressions.toLocaleString()}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <MousePointerClick className="h-4 w-4" />
                <span className="text-xs">点击次数</span>
              </div>
              <p className="text-2xl font-bold">{clicks.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 更多指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Target className="h-4 w-4" />
                <span className="text-xs">点击率 (CTR)</span>
              </div>
              <p className="text-xl font-bold">{ctr.toFixed(2)}%</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs">转化率 (CVR)</span>
              </div>
              <p className="text-xl font-bold">{cvr.toFixed(2)}%</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-xs">订单数</span>
              </div>
              <p className="text-xl font-bold">{orders}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Layers className="h-4 w-4" />
                <span className="text-xs">广告组数量</span>
              </div>
              <p className="text-xl font-bold">{adGroups?.length || 0}</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 详细数据Tab */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="adgroups">广告组</TabsTrigger>
            <TabsTrigger value="targets">投放词</TabsTrigger>
            <TabsTrigger value="searchterms">搜索词</TabsTrigger>
            <TabsTrigger value="keywords">关键词</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告活动信息</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">活动ID</p>
                    <p className="font-medium">{campaign.campaignId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">活动类型</p>
                    <p className="font-medium">{campaignTypeLabels[campaign.campaignType] || campaign.campaignType}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">定向类型</p>
                    <p className="font-medium">{campaign.targetingType === "auto" ? "自动" : "手动"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">日预算</p>
                    <p className="font-medium">${campaign.dailyBudget || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">最高出价</p>
                    <p className="font-medium">${campaign.maxBid || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">创建时间</p>
                    <p className="font-medium">{campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString() : "N/A"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="adgroups" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告组列表</CardTitle>
                <CardDescription>该广告活动下的所有广告组</CardDescription>
              </CardHeader>
              <CardContent>
                {adGroupsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : adGroups && adGroups.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>广告组名称</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">默认出价</TableHead>
                        <TableHead className="text-right">花费</TableHead>
                        <TableHead className="text-right">销售额</TableHead>
                        <TableHead className="text-right">ACoS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adGroups.map((adGroup: any) => {
                        const agSpend = parseFloat(adGroup.spend || "0");
                        const agSales = parseFloat(adGroup.sales || "0");
                        const agAcos = agSales > 0 ? (agSpend / agSales * 100) : 0;
                        return (
                          <TableRow key={adGroup.id}>
                            <TableCell className="font-medium">{adGroup.adGroupName}</TableCell>
                            <TableCell>
                              <Badge variant={adGroup.status === "enabled" ? "default" : "secondary"}>
                                {adGroup.status === "enabled" ? "启用" : "暂停"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">${adGroup.defaultBid || "N/A"}</TableCell>
                            <TableCell className="text-right">${agSpend.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${agSales.toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              <span className={agAcos > 30 ? "text-red-500" : agAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                                {agAcos.toFixed(2)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无广告组数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="targets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>投放词列表</CardTitle>
                <CardDescription>该广告活动下的所有投放词（关键词 + 商品定向）</CardDescription>
              </CardHeader>
              <CardContent>
                <TargetsList campaignId={campaignId} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="searchterms" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>客户搜索词</CardTitle>
                <CardDescription>触发该广告活动的客户实际搜索词</CardDescription>
              </CardHeader>
              <CardContent>
                <SearchTermsList campaignId={campaignId} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="keywords" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>关键词列表</CardTitle>
                <CardDescription>该广告活动下所有广告组的关键词（按销售额排序，显示前20个）</CardDescription>
              </CardHeader>
              <CardContent>
                <KeywordsList adGroups={adGroups || []} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// 关键词列表子组件
function KeywordsList({ adGroups }: { adGroups: any[] }) {
  const [allKeywords, setAllKeywords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 为每个广告组获取关键词
  const keywordQueries = adGroups.map(ag => 
    trpc.keyword.list.useQuery({ adGroupId: ag.id }, { enabled: !!ag.id })
  );
  
  // 合并所有关键词
  useEffect(() => {
    const keywords: any[] = [];
    let loading = false;
    
    keywordQueries.forEach((query, index) => {
      if (query.isLoading) {
        loading = true;
      }
      if (query.data) {
        keywords.push(...query.data.map((k: any) => ({
          ...k,
          adGroupName: adGroups[index]?.adGroupName
        })));
      }
    });
    
    setIsLoading(loading);
    setAllKeywords(keywords);
  }, [keywordQueries.map(q => q.data).join(",")]);
  
  // 按销售额排序
  const sortedKeywords = [...allKeywords].sort((a, b) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  if (isLoading && allKeywords.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (sortedKeywords.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无关键词数据</p>
      </div>
    );
  }
  
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>关键词</TableHead>
          <TableHead>匹配类型</TableHead>
          <TableHead>广告组</TableHead>
          <TableHead className="text-right">出价</TableHead>
          <TableHead className="text-right">花费</TableHead>
          <TableHead className="text-right">销售额</TableHead>
          <TableHead className="text-right">ACoS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedKeywords.slice(0, 20).map((keyword: any) => {
          const kwSpend = parseFloat(keyword.spend || "0");
          const kwSales = parseFloat(keyword.sales || "0");
          const kwAcos = kwSales > 0 ? (kwSpend / kwSales * 100) : 0;
          return (
            <TableRow key={keyword.id}>
              <TableCell className="font-medium">{keyword.keywordText}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {keyword.matchType === "exact" ? "精确" : keyword.matchType === "phrase" ? "词组" : "广泛"}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{keyword.adGroupName}</TableCell>
              <TableCell className="text-right">${keyword.bid || "N/A"}</TableCell>
              <TableCell className="text-right">${kwSpend.toFixed(2)}</TableCell>
              <TableCell className="text-right">${kwSales.toFixed(2)}</TableCell>
              <TableCell className="text-right">
                <span className={kwAcos > 30 ? "text-red-500" : kwAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                  {kwSales > 0 ? `${kwAcos.toFixed(2)}%` : "N/A"}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}


// 投放词列表子组件
function TargetsList({ campaignId }: { campaignId: number }) {
  const { data: targetsData, isLoading } = trpc.campaign.getTargets.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // 合并关键词和商品定向为统一的投放词列表
  const allTargets: any[] = [];
  
  if (targetsData?.keywords) {
    targetsData.keywords.forEach((k: any) => {
      allTargets.push({
        id: `kw-${k.id}`,
        text: k.keywordText,
        type: 'keyword',
        matchType: k.matchType,
        status: k.status,
        bid: k.bid,
        impressions: k.impressions,
        clicks: k.clicks,
        spend: k.spend,
        sales: k.sales,
        adGroupName: k.adGroupName
      });
    });
  }
  
  if (targetsData?.productTargets) {
    targetsData.productTargets.forEach((pt: any) => {
      allTargets.push({
        id: `pt-${pt.id}`,
        text: pt.targetExpression || pt.asin || 'ASIN定向',
        type: 'product',
        matchType: null,
        status: pt.status,
        bid: pt.bid,
        impressions: pt.impressions,
        clicks: pt.clicks,
        spend: pt.spend,
        sales: pt.sales,
        adGroupName: pt.adGroupName
      });
    });
  }
  
  if (allTargets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无投放词数据</p>
      </div>
    );
  }
  
  // 按销售额排序
  const sortedTargets = [...allTargets].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>投放词</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>匹配方式</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">出价</TableHead>
            <TableHead className="text-right">展示</TableHead>
            <TableHead className="text-right">点击</TableHead>
            <TableHead className="text-right">花费</TableHead>
            <TableHead className="text-right">销售额</TableHead>
            <TableHead className="text-right">ACoS</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTargets.map((target: any) => {
            const tSpend = parseFloat(target.spend || "0");
            const tSales = parseFloat(target.sales || "0");
            const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
            const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
            const isKeyword = target.type === 'keyword';
            
            return (
              <TableRow key={target.id}>
                <TableCell className="font-medium max-w-[200px] truncate" title={target.text}>
                  {target.text}
                </TableCell>
                <TableCell>
                  <Badge variant={isKeyword ? "default" : "secondary"}>
                    {isKeyword ? "关键词" : "商品定向"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {isKeyword ? (
                    <Badge variant="outline">
                      {target.matchType === "exact" ? "精确" : target.matchType === "phrase" ? "词组" : "广泛"}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={target.status === "enabled" ? "default" : "secondary"}>
                    {target.status === "enabled" ? "启用" : "暂停"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">${target.bid || "N/A"}</TableCell>
                <TableCell className="text-right">{target.impressions?.toLocaleString() || 0}</TableCell>
                <TableCell className="text-right">{target.clicks?.toLocaleString() || 0}</TableCell>
                <TableCell className="text-right">${tSpend.toFixed(2)}</TableCell>
                <TableCell className="text-right">${tSales.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <span className={tAcos > 30 ? "text-red-500" : tAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                    {tSales > 0 ? `${tAcos.toFixed(1)}%` : "-"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={tRoas >= 3 ? "text-green-500" : tRoas >= 2 ? "text-yellow-500" : "text-red-500"}>
                    {tSpend > 0 ? tRoas.toFixed(2) : "-"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// 搜索词列表子组件
function SearchTermsList({ campaignId }: { campaignId: number }) {
  const { data: searchTerms, isLoading } = trpc.campaign.getSearchTerms.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (!searchTerms || searchTerms.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无搜索词数据</p>
      </div>
    );
  }
  
  // 按销售额排序
  const sortedTerms = [...searchTerms].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>搜索词</TableHead>
            <TableHead>匹配的投放词</TableHead>
            <TableHead>匹配类型</TableHead>
            <TableHead className="text-right">展示</TableHead>
            <TableHead className="text-right">点击</TableHead>
            <TableHead className="text-right">点击率</TableHead>
            <TableHead className="text-right">花费</TableHead>
            <TableHead className="text-right">销售额</TableHead>
            <TableHead className="text-right">订单</TableHead>
            <TableHead className="text-right">ACoS</TableHead>
            <TableHead className="text-right">转化率</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTerms.map((term: any, index: number) => {
            const stSpend = parseFloat(term.spend || "0");
            const stSales = parseFloat(term.sales || "0");
            const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
            const stCtr = term.impressions > 0 ? (term.clicks / term.impressions * 100) : 0;
            const stCvr = term.clicks > 0 ? (term.orders / term.clicks * 100) : 0;
            
            return (
              <TableRow key={term.id || index}>
                <TableCell className="font-medium max-w-[200px] truncate" title={term.searchTerm}>
                  {term.searchTerm}
                </TableCell>
                <TableCell className="max-w-[150px] truncate text-muted-foreground" title={term.targetText}>
                  {term.targetText || "-"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {term.matchType === "exact" ? "精确" : term.matchType === "phrase" ? "词组" : "广泛"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{term.impressions?.toLocaleString() || 0}</TableCell>
                <TableCell className="text-right">{term.clicks?.toLocaleString() || 0}</TableCell>
                <TableCell className="text-right">{stCtr.toFixed(2)}%</TableCell>
                <TableCell className="text-right">${stSpend.toFixed(2)}</TableCell>
                <TableCell className="text-right">${stSales.toFixed(2)}</TableCell>
                <TableCell className="text-right">{term.orders || 0}</TableCell>
                <TableCell className="text-right">
                  <span className={stAcos > 30 ? "text-red-500" : stAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                    {stSales > 0 ? `${stAcos.toFixed(1)}%` : "-"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={stCvr >= 10 ? "text-green-500" : stCvr >= 5 ? "text-yellow-500" : "text-muted-foreground"}>
                    {term.clicks > 0 ? `${stCvr.toFixed(1)}%` : "-"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
