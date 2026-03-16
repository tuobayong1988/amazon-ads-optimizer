/**
 * v381: Ad Group详情页面 - 严格对齐Amazon后台Ad Group层级tabs
 * 
 * Ad Group层级tabs（根据广告类型）：
 * SP Auto/KW/PT & SB: Ads → Targeting → Negative targeting → Search terms → Ad group settings → History
 * SD: Ads → Targeting → Negative targeting → Ad group settings → History（无Search terms）
 */
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Target,
  Tag,
  Package,
  DollarSign,
  Eye,
  MousePointerClick,
  ShoppingCart,
  TrendingUp,
  Search,
  Clock,
  Settings,
  Ban,
  FileText,
  Image as ImageIcon,
  Video,
  Monitor,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// 广告类型标签映射
const campaignTypeLabels: Record<string, string> = {
  sp_auto: "SP 自动广告",
  sp_manual: "SP 手动广告",
  sb: "SB 品牌广告",
  sd: "SD 展示型广告",
};

export default function AdGroupDetail() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/ad-groups/:id");
  const adGroupId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("targeting");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // 获取广告组详情
  const { data: adGroup, isLoading: adGroupLoading, refetch } = trpc.adGroup.get.useQuery(
    { id: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取关键词列表（Targeting tab - 关键词部分）
  const { data: keywords, isLoading: keywordsLoading } = trpc.keyword.list.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取商品定位列表（Targeting tab - 商品定位部分）
  const { data: productTargets, isLoading: targetsLoading } = trpc.productTarget.list.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取搜索词列表（Search terms tab）
  const { data: adGroupSearchTerms, isLoading: searchTermsLoading } = trpc.adGroup.getSearchTerms.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取否定词列表（Negative targeting tab）
  const { data: adGroupNegatives, isLoading: negativesLoading } = trpc.adGroup.getNegativeTargeting.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // v381: 通过adGroupId获取所属广告活动信息（解决campaignId类型不匹配问题）
  const { data: campaign } = trpc.adGroup.getCampaign.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId && !!adGroup }
  );
  
  // v381: 获取变更历史（History tab）
  const { data: changeHistory, isLoading: historyLoading } = trpc.adGroup.getChangeHistory.useQuery(
    { adGroupId: adGroupId!, page: 1, pageSize: 50 },
    { enabled: !!adGroupId && activeTab === 'history' }
  );
  
  const campaignType = campaign?.campaignType || "sp_manual";
  const isSD = campaignType === "sd";
  const isSB = campaignType === "sb";
  const isSP = campaignType === "sp_auto" || campaignType === "sp_manual";
  const isSPAuto = campaignType === "sp_auto";
  
  const isLoading = adGroupLoading || keywordsLoading || targetsLoading;
  
  // 过滤关键词
  const filteredKeywords = keywords?.filter((kw: any) => {
    const matchesSearch = !searchTerm || 
      kw.keywordText?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || kw.keywordStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];
  
  // 过滤商品定位
  const filteredTargets = productTargets?.filter((pt: any) => {
    const matchesSearch = !searchTerm || 
      pt.targetExpression?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pt.targetValue?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || pt.targetStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "enabled":
        return <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">投放中</Badge>;
      case "paused":
        return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">已暂停</Badge>;
      case "archived":
        return <Badge variant="outline" className="bg-gray-500/20 text-gray-400 border-gray-500/30">已归档</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  const getMatchTypeBadge = (matchType: string) => {
    const colors: Record<string, string> = {
      exact: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      phrase: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      broad: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      negative_exact: "bg-red-500/20 text-red-400 border-red-500/30",
      negative_phrase: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    const labels: Record<string, string> = {
      exact: "精确",
      phrase: "词组",
      broad: "广泛",
      negative_exact: "否定精确",
      negative_phrase: "否定词组",
    };
    return (
      <Badge variant="outline" className={colors[matchType] || ""}>
        {labels[matchType] || matchType}
      </Badge>
    );
  };
  
  if (!match || !adGroupId) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">无效的广告组ID</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }
  
  if (!adGroup) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">广告组不存在</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  // 计算指标
  const spend = parseFloat(adGroup.spend || "0");
  const sales = parseFloat(adGroup.sales || "0");
  const acos = sales > 0 ? (spend / sales * 100) : 0;
  const roas = spend > 0 ? (sales / spend) : 0;
  const clicks = adGroup.clicks || 0;
  const impressions = adGroup.impressions || 0;
  const orders = adGroup.orders || 0;
  
  // 获取定向tab的标题（根据广告类型）
  const getTargetingLabel = () => {
    if (isSPAuto) return "定向（自动匹配类型）";
    if (isSB) return "定向";
    if (isSD) return "定向";
    return "定向（关键词 / 商品定位）";
  };
  
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 头部导航 - 面包屑 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation(campaign ? `/campaigns/${campaign.id}` : "/campaigns")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回
            </Button>
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <span className="hover:text-foreground cursor-pointer" onClick={() => setLocation("/campaigns")}>
                  广告活动
                </span>
                <span>/</span>
                {campaign && (
                  <>
                    <span className="hover:text-foreground cursor-pointer" onClick={() => setLocation(`/campaigns/${campaign.id}`)}>
                      {campaign.campaignName}
                    </span>
                    <span>/</span>
                  </>
                )}
                <span className="text-foreground">{adGroup.adGroupName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-bold">{adGroup.adGroupName}</h1>
                {getStatusBadge(adGroup.adGroupStatus || "enabled")}
                {campaign && (
                  <Badge variant="outline" className="ml-2">
                    {campaignTypeLabels[campaign.campaignType] || campaign.campaignType}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                默认出价: ${adGroup.defaultBid || "0.00"} | 
                广告组ID: {adGroup.adGroupId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>
        
        {/* 汇总指标卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3 w-3" />
                花费
              </div>
              <div className="text-lg font-semibold">${spend.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3 w-3" />
                销售额
              </div>
              <div className="text-lg font-semibold text-green-400">${sales.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3 w-3" />
                ACoS
              </div>
              <div className={`text-lg font-semibold ${acos > 30 ? "text-red-400" : acos > 20 ? "text-yellow-400" : "text-green-400"}`}>
                {acos.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3 w-3" />
                ROAS
              </div>
              <div className={`text-lg font-semibold ${roas < 2 ? "text-red-400" : roas < 3 ? "text-yellow-400" : "text-green-400"}`}>
                {roas.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Eye className="h-3 w-3" />
                曝光
              </div>
              <div className="text-lg font-semibold">{impressions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <MousePointerClick className="h-3 w-3" />
                点击
              </div>
              <div className="text-lg font-semibold">{clicks.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <ShoppingCart className="h-3 w-3" />
                订单
              </div>
              <div className="text-lg font-semibold">{orders}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Tag className="h-3 w-3" />
                定向数
              </div>
              <div className="text-lg font-semibold">{(keywords?.length || 0) + (productTargets?.length || 0)}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* v381: 严格对齐Amazon后台Ad Group层级tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {/* Tab 1: Ads（广告） */}
            <TabsTrigger value="ads">广告</TabsTrigger>
            {/* Tab 2: Targeting（定向） */}
            <TabsTrigger value="targeting">定向</TabsTrigger>
            {/* Tab 3: Negative targeting（否定定向） */}
            <TabsTrigger value="negative_targeting">否定定向</TabsTrigger>
            {/* Tab 4: Search terms（搜索词）- SD广告没有此tab */}
            {!isSD && (
              <TabsTrigger value="search_terms">搜索词</TabsTrigger>
            )}
            {/* Tab 5: Ad group settings（广告组设置） */}
            <TabsTrigger value="settings">广告组设置</TabsTrigger>
            {/* Tab 6: History（历史记录） */}
            <TabsTrigger value="history">历史记录</TabsTrigger>
          </TabsList>
          
          {/* ==================== Tab 1: Ads（广告） ==================== */}
          <TabsContent value="ads" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告</CardTitle>
                <CardDescription>
                  {isSB 
                    ? "品牌广告创意（品牌Logo、标题、商品、视频等）" 
                    : isSD 
                      ? "展示型广告创意（产品广告和自定义创意素材）"
                      : "广告商品列表（产品广告）"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* SB品牌广告创意信息 */}
                {isSB && (
                  <div className="space-y-4">
                    {adGroup.headline && (
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1">广告标题</p>
                        <p className="font-medium text-lg">{adGroup.headline}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {adGroup.creativeType && (
                        <div>
                          <p className="text-sm text-muted-foreground">创意类型</p>
                          <Badge variant="outline" className="mt-1">{adGroup.creativeType}</Badge>
                        </div>
                      )}
                      {adGroup.brandLogoUrl && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">品牌Logo</p>
                          <img src={adGroup.brandLogoUrl} alt="Brand Logo" className="h-12 w-12 rounded object-contain bg-white" />
                        </div>
                      )}
                      {adGroup.customImageUrl && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">自定义图片</p>
                          <img src={adGroup.customImageUrl} alt="Custom Image" className="h-24 w-auto rounded object-contain bg-white" />
                        </div>
                      )}
                      {adGroup.videoUrl && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">视频素材</p>
                          <div className="flex items-center gap-2">
                            <Video className="h-5 w-5 text-muted-foreground" />
                            <a href={adGroup.videoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm">
                              查看视频
                            </a>
                          </div>
                          {adGroup.videoThumbnailUrl && (
                            <img src={adGroup.videoThumbnailUrl} alt="Video Thumbnail" className="h-16 w-auto rounded mt-2 object-contain bg-white" />
                          )}
                        </div>
                      )}
                      {adGroup.landingPageUrl && (
                        <div className="col-span-2">
                          <p className="text-sm text-muted-foreground">落地页URL</p>
                          <a href={adGroup.landingPageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm break-all">
                            {adGroup.landingPageUrl}
                          </a>
                        </div>
                      )}
                    </div>
                    {!adGroup.headline && !adGroup.brandLogoUrl && !adGroup.videoUrl && (
                      <div className="text-center py-8 text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>暂无广告创意数据</p>
                        <p className="text-sm mt-1">请先同步数据以获取品牌广告创意信息</p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* SP广告商品列表 */}
                {isSP && (
                  <div className="space-y-4">
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <h4 className="font-medium mb-2">广告商品 (Product Ads)</h4>
                      <p className="text-sm text-muted-foreground">该广告组下投放的产品广告（ASIN）列表。在Amazon后台，每个广告组可以包含多个产品广告，每个产品广告对应一个ASIN。</p>
                    </div>
                    <div className="border rounded-lg">
                      <div className="p-4 border-b bg-muted/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">广告组统计概览</h4>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">曝光</p>
                            <p className="text-xl font-bold">{(adGroup.impressions || 0).toLocaleString()}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">点击</p>
                            <p className="text-xl font-bold">{(adGroup.clicks || 0).toLocaleString()}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">花费</p>
                            <p className="text-xl font-bold">${parseFloat(adGroup.spend || "0").toFixed(2)}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">订单</p>
                            <p className="text-xl font-bold">{adGroup.orders || 0}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-center py-6 text-muted-foreground border rounded-lg">
                      <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
                      <p className="font-medium">产品广告列表</p>
                      <p className="text-sm mt-1">产品广告（ASIN）数据将在后续版本中通过Amazon Ads API同步</p>
                      <p className="text-xs mt-1 text-muted-foreground/70">将展示每个ASIN的状态、曝光、点击、花费、订单等绩效数据</p>
                    </div>
                  </div>
                )}
                
                {/* SD展示型广告商品列表 */}
                {isSD && (
                  <div className="space-y-4">
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <h4 className="font-medium mb-2">展示型广告创意 (Ads)</h4>
                      <p className="text-sm text-muted-foreground">该广告组下的展示型广告创意，包括产品广告和自定义创意素材。</p>
                    </div>
                    <div className="border rounded-lg">
                      <div className="p-4 border-b bg-muted/20">
                        <h4 className="font-medium">广告组统计概览</h4>
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">曝光</p>
                            <p className="text-xl font-bold">{(adGroup.impressions || 0).toLocaleString()}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">点击</p>
                            <p className="text-xl font-bold">{(adGroup.clicks || 0).toLocaleString()}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">花费</p>
                            <p className="text-xl font-bold">${parseFloat(adGroup.spend || "0").toFixed(2)}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">订单</p>
                            <p className="text-xl font-bold">{adGroup.orders || 0}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* SD特有的可见性指标 */}
                    {(adGroup.viewAttributedSales || adGroup.viewAttributedOrders || adGroup.dpv) && (
                      <div className="border rounded-lg">
                        <div className="p-4 border-b bg-muted/20">
                          <h4 className="font-medium">可见性与浏览归因指标</h4>
                        </div>
                        <div className="p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-3 border rounded-lg text-center">
                              <p className="text-sm text-muted-foreground">详情页浏览</p>
                              <p className="text-xl font-bold">{adGroup.dpv || 0}</p>
                            </div>
                            <div className="p-3 border rounded-lg text-center">
                              <p className="text-sm text-muted-foreground">浏览归因销售</p>
                              <p className="text-xl font-bold">${parseFloat(adGroup.viewAttributedSales || "0").toFixed(2)}</p>
                            </div>
                            <div className="p-3 border rounded-lg text-center">
                              <p className="text-sm text-muted-foreground">浏览归因订单</p>
                              <p className="text-xl font-bold">{adGroup.viewAttributedOrders || 0}</p>
                            </div>
                            <div className="p-3 border rounded-lg text-center">
                              <p className="text-sm text-muted-foreground">新客销售</p>
                              <p className="text-xl font-bold">${parseFloat(adGroup.ntbSales || "0").toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="text-center py-6 text-muted-foreground border rounded-lg">
                      <Monitor className="h-10 w-10 mx-auto mb-3 opacity-50" />
                      <p className="font-medium">广告创意列表</p>
                      <p className="text-sm mt-1">展示型广告创意数据将在后续版本中通过Amazon Ads API同步</p>
                      <p className="text-xs mt-1 text-muted-foreground/70">将展示产品广告和自定义创意素材的详细信息</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== Tab 2: Targeting（定向） ==================== */}
          <TabsContent value="targeting" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{getTargetingLabel()}</CardTitle>
                    <CardDescription className="mt-1">
                      {isSPAuto 
                        ? "自动定向的匹配类型（Close match / Loose match / Substitutes / Complements）及出价"
                        : campaignType === "sp_manual" 
                          ? "手动添加的关键词和商品定向及其出价和绩效数据"
                          : isSB 
                            ? "品牌广告的关键词定向或商品定向及其绩效数据"
                            : "展示型广告的受众定向或商品定向及其绩效数据"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="搜索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 w-[200px]"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="enabled">投放中</SelectItem>
                        <SelectItem value="paused">已暂停</SelectItem>
                        <SelectItem value="archived">已归档</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* 关键词列表 */}
                {filteredKeywords.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      关键词 ({keywords?.length || 0})
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>关键词</TableHead>
                            <TableHead>匹配类型</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">出价</TableHead>
                            <TableHead className="text-right">建议竞价</TableHead>
                            <TableHead className="text-right">花费</TableHead>
                            <TableHead className="text-right">销售额</TableHead>
                            <TableHead className="text-right">曝光</TableHead>
                            <TableHead className="text-right">点击</TableHead>
                            <TableHead className="text-right">CTR</TableHead>
                            <TableHead className="text-right">订单</TableHead>
                            <TableHead className="text-right">CVR</TableHead>
                            <TableHead className="text-right">ACoS</TableHead>
                            <TableHead className="text-right">ROAS</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredKeywords.map((keyword: any) => {
                            const kwSpend = parseFloat(keyword.spend || "0");
                            const kwSales = parseFloat(keyword.sales || "0");
                            const kwImpressions = keyword.impressions || 0;
                            const kwClicks = keyword.clicks || 0;
                            const kwOrders = keyword.orders || 0;
                            const kwAcos = kwSales > 0 ? (kwSpend / kwSales * 100) : 0;
                            const kwRoas = kwSpend > 0 ? (kwSales / kwSpend) : 0;
                            const kwCtr = kwImpressions > 0 ? (kwClicks / kwImpressions * 100) : 0;
                            const kwCvr = kwClicks > 0 ? (kwOrders / kwClicks * 100) : 0;
                            
                            return (
                              <TableRow key={keyword.id}>
                                <TableCell className="font-medium">{keyword.keywordText}</TableCell>
                                <TableCell>{getMatchTypeBadge(keyword.matchType || "broad")}</TableCell>
                                <TableCell>{getStatusBadge(keyword.keywordStatus || "enabled")}</TableCell>
                                <TableCell className="text-right">${keyword.bid || "0.00"}</TableCell>
                                <TableCell className="text-right">
                                  {keyword.suggestedBid ? (
                                    <span className={parseFloat(keyword.suggestedBid) > parseFloat(keyword.bid || "0") ? "text-yellow-400" : "text-green-400"}>
                                      ${parseFloat(keyword.suggestedBid).toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">${kwSpend.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-green-400">${kwSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{kwImpressions.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{kwClicks.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{kwCtr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">{kwOrders}</TableCell>
                                <TableCell className="text-right">{kwCvr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">
                                  <span className={kwAcos > 30 ? "text-red-400" : kwAcos > 20 ? "text-yellow-400" : "text-green-400"}>
                                    {kwAcos.toFixed(1)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={kwRoas < 2 ? "text-red-400" : kwRoas < 3 ? "text-yellow-400" : "text-green-400"}>
                                    {kwRoas.toFixed(2)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
                
                {/* 商品定位列表 */}
                {filteredTargets.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      商品定位 ({productTargets?.length || 0})
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>定位表达式/ASIN</TableHead>
                            <TableHead>类型</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">出价</TableHead>
                            <TableHead className="text-right">建议竞价</TableHead>
                            <TableHead className="text-right">花费</TableHead>
                            <TableHead className="text-right">销售额</TableHead>
                            <TableHead className="text-right">曝光</TableHead>
                            <TableHead className="text-right">点击</TableHead>
                            <TableHead className="text-right">CTR</TableHead>
                            <TableHead className="text-right">订单</TableHead>
                            <TableHead className="text-right">CVR</TableHead>
                            <TableHead className="text-right">ACoS</TableHead>
                            <TableHead className="text-right">ROAS</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTargets.map((target: any) => {
                            const tSpend = parseFloat(target.spend || "0");
                            const tSales = parseFloat(target.sales || "0");
                            const tImpressions = target.impressions || 0;
                            const tClicks = target.clicks || 0;
                            const tOrders = target.orders || 0;
                            const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
                            const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
                            const tCtr = tImpressions > 0 ? (tClicks / tImpressions * 100) : 0;
                            const tCvr = tClicks > 0 ? (tOrders / tClicks * 100) : 0;
                            
                            return (
                              <TableRow key={target.id}>
                                <TableCell className="font-medium">
                                  {target.targetValue || target.targetExpression || "N/A"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {target.targetType === "asin" ? "ASIN" : target.targetType === "category" ? "类目" : target.targetType}
                                  </Badge>
                                </TableCell>
                                <TableCell>{getStatusBadge(target.targetStatus || "enabled")}</TableCell>
                                <TableCell className="text-right">${target.bid || "0.00"}</TableCell>
                                <TableCell className="text-right">
                                  {target.suggestedBid ? (
                                    <span className={parseFloat(target.suggestedBid) > parseFloat(target.bid || "0") ? "text-yellow-400" : "text-green-400"}>
                                      ${parseFloat(target.suggestedBid).toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">${tSpend.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-green-400">${tSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{tImpressions.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{tClicks.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{tCtr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">{tOrders}</TableCell>
                                <TableCell className="text-right">{tCvr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">
                                  <span className={tAcos > 30 ? "text-red-400" : tAcos > 20 ? "text-yellow-400" : "text-green-400"}>
                                    {tAcos.toFixed(1)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={tRoas < 2 ? "text-red-400" : tRoas < 3 ? "text-yellow-400" : "text-green-400"}>
                                    {tRoas.toFixed(2)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
                
                {/* 无数据提示 */}
                {filteredKeywords.length === 0 && filteredTargets.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无定向数据</p>
                    <p className="text-sm mt-1">请先同步数据以获取定向信息</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== Tab 3: Negative targeting（否定定向） ==================== */}
          <TabsContent value="negative_targeting" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>否定定向</CardTitle>
                <CardDescription>
                  {isSPAuto || campaignType === "sp_manual"
                    ? "Ad Group级别的否定关键词和否定商品定向"
                    : isSB 
                      ? "品牌广告的否定关键词和否定商品定向"
                      : "展示型广告的否定商品定向"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {adGroupNegatives && adGroupNegatives.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>否定词/ASIN</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>匹配类型</TableHead>
                          <TableHead>层级</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>来源</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adGroupNegatives.map((neg: any) => (
                          <TableRow key={neg.id}>
                            <TableCell className="font-medium">{neg.negativeText}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {neg.negativeType === "keyword" ? "关键词" : "商品"}
                              </Badge>
                            </TableCell>
                            <TableCell>{getMatchTypeBadge(neg.negativeMatchType)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {neg.negativeLevel === "ad_group" ? "广告组" : "广告活动"}
                              </Badge>
                            </TableCell>
                            <TableCell>{getStatusBadge(neg.negativeStatus || "active")}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {neg.negativeSource === "manual" ? "手动" : 
                               neg.negativeSource === "auto_optimization" ? "自动优化" :
                               neg.negativeSource === "search_term_harvest" ? "搜索词收割" :
                               neg.negativeSource || "未知"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Ban className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无否定定向数据</p>
                    <p className="text-sm mt-1">该广告组尚未添加否定关键词或否定商品定向</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== Tab 4: Search terms（搜索词）- SD广告没有此tab ==================== */}
          {!isSD && (
            <TabsContent value="search_terms" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>搜索词</CardTitle>
                  <CardDescription>触发该广告组广告的客户实际搜索词及其绩效数据</CardDescription>
                </CardHeader>
                <CardContent>
                  {adGroupSearchTerms && adGroupSearchTerms.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>搜索词</TableHead>
                            <TableHead>匹配类型</TableHead>
                            <TableHead>定向类型</TableHead>
                            <TableHead className="text-right">曝光</TableHead>
                            <TableHead className="text-right">点击</TableHead>
                            <TableHead className="text-right">CTR</TableHead>
                            <TableHead className="text-right">花费</TableHead>
                            <TableHead className="text-right">销售额</TableHead>
                            <TableHead className="text-right">订单</TableHead>
                            <TableHead className="text-right">ACoS</TableHead>
                            <TableHead className="text-right">ROAS</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adGroupSearchTerms.map((st: any) => {
                            const stSpend = parseFloat(st.searchTermSpend || "0");
                            const stSales = parseFloat(st.searchTermSales || "0");
                            const stImpressions = st.searchTermImpressions || 0;
                            const stClicks = st.searchTermClicks || 0;
                            const stOrders = st.searchTermOrders || 0;
                            const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
                            const stRoas = stSpend > 0 ? (stSales / stSpend) : 0;
                            const stCtr = stImpressions > 0 ? (stClicks / stImpressions * 100) : 0;
                            
                            return (
                              <TableRow key={st.id}>
                                <TableCell className="font-medium">{st.searchTerm}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{st.searchTermMatchType || "N/A"}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {st.searchTermTargetType === "keyword" ? "关键词" : "商品定位"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">{stImpressions.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{stClicks.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{stCtr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">${stSpend.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-green-400">${stSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{stOrders}</TableCell>
                                <TableCell className="text-right">
                                  <span className={stAcos > 30 ? "text-red-400" : stAcos > 20 ? "text-yellow-400" : "text-green-400"}>
                                    {stAcos.toFixed(1)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={stRoas < 2 ? "text-red-400" : stRoas < 3 ? "text-yellow-400" : "text-green-400"}>
                                    {stRoas.toFixed(2)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>暂无搜索词数据</p>
                      <p className="text-sm mt-1">请先同步数据以获取客户搜索词信息</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
          
          {/* ==================== Tab 5: Ad group settings（广告组设置） ==================== */}
          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告组设置</CardTitle>
                <CardDescription>广告组的基本配置信息</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-muted-foreground">广告组名称</p>
                    <p className="font-medium mt-1">{adGroup.adGroupName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">广告组ID (Amazon)</p>
                    <p className="font-medium mt-1">{adGroup.adGroupId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">状态</p>
                    <div className="mt-1">{getStatusBadge(adGroup.adGroupStatus || "enabled")}</div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">默认出价</p>
                    <p className="font-medium mt-1">${adGroup.defaultBid || "0.00"}</p>
                  </div>
                  {campaign && (
                    <div>
                      <p className="text-sm text-muted-foreground">所属广告活动</p>
                      <p className="font-medium mt-1 text-blue-400 cursor-pointer hover:underline" 
                         onClick={() => setLocation(`/campaigns/${campaign.id}`)}>
                        {campaign.campaignName}
                      </p>
                    </div>
                  )}
                  {campaign && (
                    <div>
                      <p className="text-sm text-muted-foreground">广告类型</p>
                      <Badge variant="outline" className="mt-1">
                        {campaignTypeLabels[campaign.campaignType] || campaign.campaignType}
                      </Badge>
                    </div>
                  )}
                  {adGroup.tactic && (
                    <div>
                      <p className="text-sm text-muted-foreground">策略 (Tactic)</p>
                      <p className="font-medium mt-1">{adGroup.tactic}</p>
                    </div>
                  )}
                  {adGroup.creativeType && (
                    <div>
                      <p className="text-sm text-muted-foreground">创意类型</p>
                      <p className="font-medium mt-1">{adGroup.creativeType}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== Tab 6: History（历史记录） ==================== */}
          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>历史记录</CardTitle>
                <CardDescription>该广告组的变更历史记录，包括出价调整、状态变更、定向修改等（对应Amazon后台的History）</CardDescription>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">加载历史记录...</span>
                  </div>
                ) : changeHistory && changeHistory.records && changeHistory.records.length > 0 ? (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      共 {changeHistory.total} 条变更记录
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>时间</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>目标</TableHead>
                          <TableHead>原始值</TableHead>
                          <TableHead>新值</TableHead>
                          <TableHead>变化</TableHead>
                          <TableHead>来源</TableHead>
                          <TableHead>状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {changeHistory.records.map((record: any) => (
                          <TableRow key={record.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {record.timestamp ? new Date(record.timestamp).toLocaleString('zh-CN') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="default">{record.typeLabel}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate" title={record.target}>
                              {record.target}
                              {record.matchType && (
                                <span className="text-xs text-muted-foreground ml-1">({record.matchType})</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{record.previousValue}</TableCell>
                            <TableCell className="font-mono text-sm">{record.newValue}</TableCell>
                            <TableCell className="text-sm">
                              {record.changePercent && (
                                <span className={parseFloat(record.changePercent) > 0 ? 'text-green-500' : 'text-red-500'}>
                                  {parseFloat(record.changePercent) > 0 ? '+' : ''}{record.changePercent}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {record.source === 'auto_optimal' ? '自动优化' :
                                 record.source === 'auto_dayparting' ? '分时优化' :
                                 record.source === 'auto_placement' ? '广告位优化' :
                                 record.source === 'manual' ? '手动' :
                                 record.source === 'batch_campaign' ? '批量操作' :
                                 record.source || '未知'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={record.status === 'applied' ? 'default' : record.status === 'failed' ? 'destructive' : 'secondary'}>
                                {record.status === 'applied' ? '已应用' :
                                 record.status === 'pending' ? '待执行' :
                                 record.status === 'failed' ? '失败' :
                                 record.status === 'rolled_back' ? '已回滚' : record.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无变更历史记录</p>
                    <p className="text-sm mt-2">当系统执行出价调整、定向修改等操作时，变更记录将显示在此处</p>
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
