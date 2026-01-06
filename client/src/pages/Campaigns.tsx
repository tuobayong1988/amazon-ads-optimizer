import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Search, 
  Filter, 
  MoreHorizontal,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Campaigns() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

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

  const getCampaignTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      sp_auto: "SP 自动",
      sp_manual: "SP 手动",
      sb: "SB 品牌",
      sd: "SD 展示",
    };
    return labels[type] || type;
  };

  const getCampaignTypeBadgeClass = (type: string) => {
    const classes: Record<string, string> = {
      sp_auto: "campaign-sp",
      sp_manual: "campaign-sp",
      sb: "campaign-sb",
      sd: "campaign-sd",
    };
    return classes[type] || "";
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

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索广告活动..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="广告类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="sp_auto">SP 自动</SelectItem>
                  <SelectItem value="sp_manual">SP 手动</SelectItem>
                  <SelectItem value="sb">SB 品牌</SelectItem>
                  <SelectItem value="sd">SD 展示</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Campaigns Table */}
        <Card>
          <CardHeader>
            <CardTitle>广告活动列表</CardTitle>
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
                    <TableRow>
                      <TableHead className="min-w-[300px]">广告活动名称</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">曝光</TableHead>
                      <TableHead className="text-right">点击</TableHead>
                      <TableHead className="text-right">花费</TableHead>
                      <TableHead className="text-right">销售额</TableHead>
                      <TableHead className="text-right">ACoS</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                      <TableHead>绩效组</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCampaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium">
                          <div className="max-w-[300px] truncate" title={campaign.campaignName}>
                            {campaign.campaignName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={getCampaignTypeBadgeClass(campaign.campaignType)}>
                            {getCampaignTypeLabel(campaign.campaignType)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`status-${campaign.status}`}>
                            {campaign.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(campaign.impressions || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(campaign.clicks || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${parseFloat(campaign.spend || "0").toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${parseFloat(campaign.sales || "0").toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {campaign.acos ? (
                            <span className={parseFloat(campaign.acos) > 30 ? 'text-destructive' : 'text-success'}>
                              {campaign.acos}%
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {campaign.roas ? (
                            <span className={parseFloat(campaign.roas) < 2 ? 'text-destructive' : 'text-success'}>
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
                            <SelectTrigger className="w-[140px] h-8 text-xs">
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
                                  updateCampaign.mutate({
                                    id: campaign.id,
                                    status: campaign.status === "enabled" ? "paused" : "enabled",
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
                <Button onClick={() => window.location.href = '/data-sync'}>
                  同步数据
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
