import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import OperationConfirmDialog, { useOperationConfirm } from "@/components/OperationConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Calendar,
  DollarSign
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export default function Campaigns() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  
  // 确认弹窗状态
  const { showConfirm, dialogProps } = useOperationConfirm();

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch campaigns
  const { data: campaigns, isLoading, refetch } = trpc.campaign.list.useQuery(
    { accountId: accountId! },
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

  // Assign to performance group
  const assignToGroup = trpc.performanceGroup.assignCampaign.useMutation({
    onSuccess: () => {
      toast.success("已分配到绩效组");
      refetch();
    },
  });

  // Filter campaigns
  const filteredCampaigns = campaigns?.filter((campaign) => {
    const matchesSearch = campaign.campaignName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || campaign.campaignType === typeFilter;
    return matchesSearch && matchesType;
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

  // 获取绩效组名称
  const getPerformanceGroupName = (groupId: number | null | undefined) => {
    if (!groupId) return "-";
    const group = performanceGroups?.find(g => g.id === groupId);
    return group?.name || "-";
  };

  // 格式化日期
  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">广告活动</h1>
            <p className="text-muted-foreground">
              管理和优化您的亚马逊广告活动
            </p>
          </div>
          <Button variant="outline" onClick={() => window.location.href = '/data-sync'}>
            <RefreshCw className="w-4 h-4 mr-2" />
            同步数据
          </Button>
        </div>

        {/* 广告类型筛选标签 */}
        <div className="flex flex-wrap gap-3">
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
                className={`h-auto py-3 px-4 ${isActive ? "" : "hover:bg-accent"}`}
                onClick={() => setTypeFilter(type.value)}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="w-4 h-4" />}
                  <span>{type.label}</span>
                  <Badge variant="secondary" className="ml-1">
                    {count}
                  </Badge>
                </div>
              </Button>
            );
          })}
        </div>

        {/* 搜索框 */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索广告活动名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        {/* Campaigns Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              {typeFilter === "all" ? "全部广告活动" : getCampaignTypeLabel(typeFilter) + " 广告活动"}
            </CardTitle>
            <CardDescription>
              共 {filteredCampaigns?.length || 0} 个广告活动
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredCampaigns && filteredCampaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="min-w-[250px] sticky left-0 bg-muted/50">广告活动名称</TableHead>
                      <TableHead className="min-w-[80px]">类型</TableHead>
                      <TableHead className="min-w-[100px]">计费方式</TableHead>
                      <TableHead className="min-w-[100px]">创建日期</TableHead>
                      <TableHead className="min-w-[80px]">状态</TableHead>
                      <TableHead className="min-w-[100px] text-right">日预算</TableHead>
                      <TableHead className="min-w-[100px] text-right">当日花费</TableHead>
                      <TableHead className="min-w-[80px] text-right">曝光</TableHead>
                      <TableHead className="min-w-[80px] text-right">点击</TableHead>
                      <TableHead className="min-w-[80px] text-right">点击率</TableHead>
                      <TableHead className="min-w-[100px] text-right">累计花费</TableHead>
                      <TableHead className="min-w-[100px] text-right">日销售额</TableHead>
                      <TableHead className="min-w-[100px] text-right">累计销售额</TableHead>
                      <TableHead className="min-w-[80px] text-right">ACoS</TableHead>
                      <TableHead className="min-w-[80px] text-right">ROAS</TableHead>
                      <TableHead className="min-w-[120px]">所属绩效组</TableHead>
                      <TableHead className="min-w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCampaigns.map((campaign) => {
                      const typeConfig = getCampaignTypeConfig(campaign.campaignType);
                      const dailySpend = parseFloat((campaign as any).dailySpend || "0");
                      const totalSpend = parseFloat(campaign.spend || "0");
                      const dailySales = parseFloat((campaign as any).dailySales || "0");
                      const totalSales = parseFloat(campaign.sales || "0");
                      const dailyBudget = parseFloat((campaign as any).dailyBudget || "0");
                      const impressions = campaign.impressions || 0;
                      const clicks = campaign.clicks || 0;
                      
                      return (
                        <TableRow key={campaign.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium sticky left-0 bg-background">
                            <div className="max-w-[250px] truncate" title={campaign.campaignName}>
                              {campaign.campaignName}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={typeConfig.color}>
                              {getCampaignTypeLabel(campaign.campaignType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {billingTypeLabels[(campaign as any).billingType] || "CPC (按点击)"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(campaign.createdAt)}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(campaign.status || 'paused')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            ${dailyBudget.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={dailySpend > dailyBudget * 0.9 ? "text-orange-500" : ""}>
                              ${dailySpend.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {impressions.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {clicks.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {calculateCTR(clicks, impressions)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            ${totalSpend.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${dailySales.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            ${totalSales.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.acos ? (
                              <span className={parseFloat(campaign.acos) > 30 ? 'text-destructive font-medium' : 'text-green-500 font-medium'}>
                                {campaign.acos}%
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.roas ? (
                              <span className={parseFloat(campaign.roas) < 2 ? 'text-destructive font-medium' : 'text-green-500 font-medium'}>
                                {campaign.roas}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={campaign.performanceGroupId?.toString() || "none"}
                              onValueChange={(value) => {
                                assignToGroup.mutate({
                                  campaignId: campaign.id,
                                  performanceGroupId: value === "none" ? null : parseInt(value),
                                });
                              }}
                            >
                              <SelectTrigger className="w-[120px] h-8 text-xs">
                                <SelectValue placeholder="选择绩效组" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未分配</SelectItem>
                                {performanceGroups?.map((group) => (
                                  <SelectItem key={group.id} value={group.id.toString()}>
                                    {group.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    const newStatus = campaign.status === "enabled" ? "paused" : "enabled";
                                    const isHighRisk = campaign.status === "enabled";
                                    
                                    showConfirm({
                                      operationType: newStatus === "paused" ? 'campaign_pause' : 'campaign_enable',
                                      title: newStatus === "paused" ? '暂停广告活动' : '启用广告活动',
                                      description: `您即将${newStatus === "paused" ? '暂停' : '启用'}广告活动"${campaign.campaignName}"`,
                                      changes: [{
                                        id: campaign.id,
                                        name: campaign.campaignName,
                                        field: 'status',
                                        fieldLabel: '状态',
                                        oldValue: campaign.status === "enabled" ? '启用中' : '已暂停',
                                        newValue: newStatus === "paused" ? '已暂停' : '启用中',
                                      }],
                                      warningMessage: isHighRisk 
                                        ? '暂停广告活动将立即停止广告展示，可能影响销售' 
                                        : undefined,
                                      onConfirm: () => {
                                        updateCampaign.mutate({
                                          id: campaign.id,
                                          status: newStatus,
                                        });
                                      },
                                    });
                                  }}
                                >
                                  {campaign.status === "enabled" ? "暂停" : "启用"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                                  查看关键词
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toast.info("功能开发中")}>
                                  查看竞价日志
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                <Button onClick={() => window.location.href = '/data-sync'}>
                  同步数据
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 操作确认弹窗 */}
      {dialogProps && <OperationConfirmDialog {...dialogProps} />}
    </DashboardLayout>
  );
}
