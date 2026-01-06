import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  Mail,
  Smartphone,
  Settings,
  Check,
  Clock,
  TrendingUp,
  Filter,
  Users,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Eye,
} from "lucide-react";

export default function CollaborationNotifications() {
  const [activeTab, setActiveTab] = useState("notifications");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // 获取通知列表
  const { data: notificationsData, isLoading, refetch } = trpc.collaboration.list.useQuery({
    page,
    pageSize,
  });

  // 获取通知统计
  const { data: stats } = trpc.collaboration.stats.useQuery();

  // 获取用户通知偏好
  const { data: preferences, refetch: refetchPreferences } = trpc.collaboration.getPreferences.useQuery();

  // 标记通知为已读
  const markAsReadMutation = trpc.collaboration.markAsRead.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("已标记为已读");
    },
  });

  // 标记所有通知为已读
  const markAllAsReadMutation = trpc.collaboration.markAllAsRead.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(`已标记 ${data.count} 条通知为已读`);
    },
  });

  // 更新通知偏好
  const updatePreferencesMutation = trpc.collaboration.updatePreferences.useMutation({
    onSuccess: () => {
      refetchPreferences();
      toast.success("偏好设置已更新");
    },
    onError: (error) => {
      toast.error("更新失败", { description: error.message });
    },
  });

  // 更新单个偏好设置
  function updatePreference(key: string, value: boolean | string) {
    updatePreferencesMutation.mutate({ [key]: value });
  }

  // 获取优先级徽章
  function getPriorityBadge(priority: string | null) {
    switch (priority) {
      case "critical":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">紧急</Badge>;
      case "high":
        return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">高</Badge>;
      case "medium":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">中</Badge>;
      case "low":
        return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">低</Badge>;
      default:
        return null;
    }
  }

  // 获取操作类型图标
  function getActionIcon(actionType: string | null) {
    if (!actionType) return <Bell className="w-4 h-4" />;
    if (actionType.startsWith("bid_")) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (actionType.startsWith("negative_")) return <Filter className="w-4 h-4 text-orange-500" />;
    if (actionType.startsWith("campaign_")) return <AlertTriangle className="w-4 h-4 text-blue-500" />;
    if (actionType.startsWith("team_")) return <Users className="w-4 h-4 text-purple-500" />;
    if (actionType.startsWith("data_")) return <Database className="w-4 h-4 text-cyan-500" />;
    return <Bell className="w-4 h-4" />;
  }

  // 格式化时间
  function formatTime(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">协作通知</h1>
            <p className="text-muted-foreground">接收团队成员的重要操作通知，保持协作同步</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
            {(stats?.unreadCount || 0) > 0 && (
              <Button onClick={() => markAllAsReadMutation.mutate()}>
                <Check className="w-4 h-4 mr-2" />
                全部已读
              </Button>
            )}
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">未读通知</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-500" />
                <span className="text-2xl font-bold">{stats?.unreadCount || 0}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">总通知数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-green-500" />
                <span className="text-2xl font-bold">{stats?.totalNotifications || 0}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">高优先级</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <span className="text-2xl font-bold">
                  {(stats?.byPriority?.high || 0) + (stats?.byPriority?.critical || 0)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">出价调整通知</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-500" />
                <span className="text-2xl font-bold">
                  {(stats?.byActionType?.bid_adjust_single || 0) + (stats?.byActionType?.bid_adjust_batch || 0)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="notifications">
              通知列表
              {(stats?.unreadCount || 0) > 0 && (
                <Badge className="ml-2 bg-red-500 text-white">{stats?.unreadCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings">通知设置</TabsTrigger>
          </TabsList>

          <TabsContent value="notifications" className="space-y-4">
            {/* 通知列表 */}
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : notificationsData?.notifications && notificationsData.notifications.length > 0 ? (
                  <div className="divide-y">
                    {notificationsData.notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 hover:bg-muted/50 transition-colors ${
                          notification.status === "sent" ? "bg-blue-500/5" : ""
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            {getActionIcon(notification.actionType)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{notification.title}</span>
                              {getPriorityBadge(notification.priority)}
                              {notification.status === "sent" && (
                                <Badge variant="outline" className="text-xs">未读</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{notification.content}</p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {notification.actionUserName}
                              </span>
                              {notification.accountName && (
                                <span className="flex items-center gap-1">
                                  <Database className="w-3 h-3" />
                                  {notification.accountName}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTime(notification.createdAt)}
                              </span>
                            </div>
                          </div>
                          {notification.status === "sent" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAsReadMutation.mutate({ id: notification.id })}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <BellOff className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">暂无通知</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            {/* 通知渠道设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5" />
                  通知渠道
                </CardTitle>
                <CardDescription>选择接收通知的方式</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>应用内通知</Label>
                    <p className="text-sm text-muted-foreground">在系统内接收实时通知</p>
                  </div>
                  <Switch
                    checked={preferences?.enableAppNotifications ?? true}
                    onCheckedChange={(checked) => updatePreference("enableAppNotifications", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>邮件通知</Label>
                    <p className="text-sm text-muted-foreground">高优先级通知将发送到您的邮箱</p>
                  </div>
                  <Switch
                    checked={preferences?.enableEmailNotifications ?? true}
                    onCheckedChange={(checked) => updatePreference("enableEmailNotifications", checked)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* 操作类型设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  操作类型通知
                </CardTitle>
                <CardDescription>选择需要接收通知的操作类型</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      出价调整
                    </Label>
                    <p className="text-sm text-muted-foreground">单个或批量出价调整操作</p>
                  </div>
                  <Switch
                    checked={preferences?.bidAdjustNotify ?? true}
                    onCheckedChange={(checked) => updatePreference("bidAdjustNotify", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-orange-500" />
                      否定词操作
                    </Label>
                    <p className="text-sm text-muted-foreground">添加或移除否定关键词</p>
                  </div>
                  <Switch
                    checked={preferences?.negativeKeywordNotify ?? true}
                    onCheckedChange={(checked) => updatePreference("negativeKeywordNotify", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-blue-500" />
                      广告活动变更
                    </Label>
                    <p className="text-sm text-muted-foreground">创建、暂停、启用或删除广告活动</p>
                  </div>
                  <Switch
                    checked={preferences?.campaignChangeNotify ?? true}
                    onCheckedChange={(checked) => updatePreference("campaignChangeNotify", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-cyan-500" />
                      自动化操作
                    </Label>
                    <p className="text-sm text-muted-foreground">启用、禁用或配置自动化功能</p>
                  </div>
                  <Switch
                    checked={preferences?.automationNotify ?? true}
                    onCheckedChange={(checked) => updatePreference("automationNotify", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-500" />
                      团队变更
                    </Label>
                    <p className="text-sm text-muted-foreground">邀请、移除成员或权限变更</p>
                  </div>
                  <Switch
                    checked={preferences?.teamChangeNotify ?? true}
                    onCheckedChange={(checked) => updatePreference("teamChangeNotify", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-gray-500" />
                      数据导入导出
                    </Label>
                    <p className="text-sm text-muted-foreground">导入或导出数据操作</p>
                  </div>
                  <Switch
                    checked={preferences?.dataImportExportNotify ?? false}
                    onCheckedChange={(checked) => updatePreference("dataImportExportNotify", checked)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* 优先级设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  优先级过滤
                </CardTitle>
                <CardDescription>选择需要接收通知的优先级</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Badge className="bg-red-500/10 text-red-500 border-red-500/20">紧急</Badge>
                    </Label>
                    <p className="text-sm text-muted-foreground">紧急操作通知</p>
                  </div>
                  <Switch
                    checked={preferences?.notifyOnCritical ?? true}
                    onCheckedChange={(checked) => updatePreference("notifyOnCritical", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">高</Badge>
                    </Label>
                    <p className="text-sm text-muted-foreground">高优先级操作通知</p>
                  </div>
                  <Switch
                    checked={preferences?.notifyOnHigh ?? true}
                    onCheckedChange={(checked) => updatePreference("notifyOnHigh", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">中</Badge>
                    </Label>
                    <p className="text-sm text-muted-foreground">中优先级操作通知</p>
                  </div>
                  <Switch
                    checked={preferences?.notifyOnMedium ?? true}
                    onCheckedChange={(checked) => updatePreference("notifyOnMedium", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">低</Badge>
                    </Label>
                    <p className="text-sm text-muted-foreground">低优先级操作通知</p>
                  </div>
                  <Switch
                    checked={preferences?.notifyOnLow ?? false}
                    onCheckedChange={(checked) => updatePreference("notifyOnLow", checked)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* 免打扰设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  免打扰时段
                </CardTitle>
                <CardDescription>设置不接收通知的时间段</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>启用免打扰</Label>
                    <p className="text-sm text-muted-foreground">在指定时段内暂停通知</p>
                  </div>
                  <Switch
                    checked={preferences?.quietHoursEnabled ?? false}
                    onCheckedChange={(checked) => updatePreference("quietHoursEnabled", checked)}
                  />
                </div>
                {preferences?.quietHoursEnabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>开始时间</Label>
                      <Input
                        type="time"
                        value={preferences?.quietHoursStart || "22:00"}
                        onChange={(e) => updatePreference("quietHoursStart", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>结束时间</Label>
                      <Input
                        type="time"
                        value={preferences?.quietHoursEnd || "08:00"}
                        onChange={(e) => updatePreference("quietHoursEnd", e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>时区</Label>
                  <Select
                    value={preferences?.timezone || "Asia/Shanghai"}
                    onValueChange={(value) => updatePreference("timezone", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Shanghai">中国标准时间 (UTC+8)</SelectItem>
                      <SelectItem value="America/New_York">美国东部时间 (UTC-5)</SelectItem>
                      <SelectItem value="America/Los_Angeles">美国太平洋时间 (UTC-8)</SelectItem>
                      <SelectItem value="Europe/London">英国时间 (UTC+0)</SelectItem>
                      <SelectItem value="Europe/Berlin">中欧时间 (UTC+1)</SelectItem>
                      <SelectItem value="Asia/Tokyo">日本时间 (UTC+9)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
