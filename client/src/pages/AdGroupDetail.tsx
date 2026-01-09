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
  Percent,
  TrendingUp,
  Edit2,
  Pause,
  Play,
  Archive,
  Search,
  Filter
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdGroupDetail() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/ad-groups/:id");
  const adGroupId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("keywords");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // 获取广告组详情
  const { data: adGroup, isLoading: adGroupLoading, refetch } = trpc.adGroup.get.useQuery(
    { id: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取关键词列表
  const { data: keywords, isLoading: keywordsLoading } = trpc.keyword.list.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取商品定位列表
  const { data: productTargets, isLoading: targetsLoading } = trpc.productTarget.list.useQuery(
    { adGroupId: adGroupId! },
    { enabled: !!adGroupId }
  );
  
  // 获取广告活动信息（用于面包屑）
  const { data: campaign } = trpc.campaign.get.useQuery(
    { id: adGroup?.campaignId || 0 },
    { enabled: !!adGroup?.campaignId }
  );
  
  const isLoading = adGroupLoading || keywordsLoading || targetsLoading;
  
  // 过滤关键词
  const filteredKeywords = keywords?.filter(kw => {
    const matchesSearch = !searchTerm || 
      kw.keywordText?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || kw.keywordStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];
  
  // 过滤商品定位
  const filteredTargets = productTargets?.filter(pt => {
    const matchesSearch = !searchTerm || 
      pt.targetExpression?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pt.targetValue?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || pt.targetStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];
  
  // 计算汇总数据
  const keywordSummary = {
    total: keywords?.length || 0,
    enabled: keywords?.filter(k => k.keywordStatus === "enabled").length || 0,
    totalSpend: keywords?.reduce((sum, k) => sum + parseFloat(k.spend || "0"), 0) || 0,
    totalSales: keywords?.reduce((sum, k) => sum + parseFloat(k.sales || "0"), 0) || 0,
    totalClicks: keywords?.reduce((sum, k) => sum + (k.clicks || 0), 0) || 0,
    totalImpressions: keywords?.reduce((sum, k) => sum + (k.impressions || 0), 0) || 0,
    totalOrders: keywords?.reduce((sum, k) => sum + (k.orders || 0), 0) || 0,
  };
  
  const targetSummary = {
    total: productTargets?.length || 0,
    enabled: productTargets?.filter(t => t.targetStatus === "enabled").length || 0,
    totalSpend: productTargets?.reduce((sum, t) => sum + parseFloat(t.spend || "0"), 0) || 0,
    totalSales: productTargets?.reduce((sum, t) => sum + parseFloat(t.sales || "0"), 0) || 0,
    totalClicks: productTargets?.reduce((sum, t) => sum + (t.clicks || 0), 0) || 0,
    totalImpressions: productTargets?.reduce((sum, t) => sum + (t.impressions || 0), 0) || 0,
    totalOrders: productTargets?.reduce((sum, t) => sum + (t.orders || 0), 0) || 0,
  };
  
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
    };
    const labels: Record<string, string> = {
      exact: "精确",
      phrase: "词组",
      broad: "广泛",
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
  const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
  const orders = adGroup.orders || 0;
  const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
  
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 头部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation(campaign ? `/campaigns/${campaign.id}` : "/campaigns")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回
            </Button>
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <span 
                  className="hover:text-foreground cursor-pointer"
                  onClick={() => setLocation("/campaigns")}
                >
                  广告活动
                </span>
                <span>/</span>
                {campaign && (
                  <>
                    <span 
                      className="hover:text-foreground cursor-pointer"
                      onClick={() => setLocation(`/campaigns/${campaign.id}`)}
                    >
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
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                默认出价: ${adGroup.defaultBid || "0.00"}
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
                <Percent className="h-3 w-3" />
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
                关键词/定位
              </div>
              <div className="text-lg font-semibold">{(keywords?.length || 0) + (productTargets?.length || 0)}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* 投放词标签页 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">投放词管理</CardTitle>
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
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="keywords" className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  关键词 ({keywords?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="targets" className="flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  商品定位 ({productTargets?.length || 0})
                </TabsTrigger>
              </TabsList>
              
              {/* 关键词列表 */}
              <TabsContent value="keywords" className="mt-4">
                {filteredKeywords.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Tag className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>暂无关键词数据</p>
                    <p className="text-sm mt-1">请先同步数据以获取关键词信息</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>关键词</TableHead>
                          <TableHead>匹配类型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">出价</TableHead>
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
                        {filteredKeywords.map((keyword) => {
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
                )}
              </TabsContent>
              
              {/* 商品定位列表 */}
              <TabsContent value="targets" className="mt-4">
                {filteredTargets.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>暂无商品定位数据</p>
                    <p className="text-sm mt-1">请先同步数据以获取商品定位信息</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>定位表达式/ASIN</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">出价</TableHead>
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
                        {filteredTargets.map((target) => {
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
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
