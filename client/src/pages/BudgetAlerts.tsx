/**
 * Budget Alerts Page - 预算消耗预警页面
 * 监控广告活动预算消耗速度，显示预警列表和设置
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Bell, CheckCircle, Clock, RefreshCw, Settings, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";

type AlertType = "overspending" | "underspending" | "budget_depleted" | "near_depletion";
type AlertStatus = "active" | "acknowledged" | "resolved";

export default function BudgetAlerts() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("alerts");

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;
  const [alertTypeFilter, setAlertTypeFilter] = useState<AlertType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");

  // 获取预警列表
  const { data: alertsData, isLoading: alertsLoading, refetch: refetchAlerts } = trpc.budgetAlert.getAlerts.useQuery({
    accountId: selectedAccountId || undefined,
    alertType: alertTypeFilter === "all" ? undefined : alertTypeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 50,
    offset: 0,
  });

  // 获取预警设置
  const { data: settings, isLoading: settingsLoading } = trpc.budgetAlert.getSettings.useQuery({
    accountId: selectedAccountId || undefined,
  });

  // 保存设置
  const saveSettingsMutation = trpc.budgetAlert.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("预警设置已保存");
    },
    onError: (error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });

  // 确认预警
  const acknowledgeMutation = trpc.budgetAlert.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success("预警已确认");
      refetchAlerts();
    },
  });

  // 检查预算消耗
  const checkConsumptionMutation = trpc.budgetAlert.checkConsumption.useMutation({
    onSuccess: (result) => {
      toast.success(`检查完成，发现 ${result.alerts} 个预警`);
      refetchAlerts();
    },
    onError: (error) => {
      toast.error(`检查失败: ${error.message}`);
    },
  });

  // 设置表单状态
  const [settingsForm, setSettingsForm] = useState({
    fastConsumptionThreshold: 200,
    slowConsumptionThreshold: 50,
    checkInterval: 4,
    notifyEmail: true,
    notifyInApp: true,
  });

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({
      accountId: selectedAccountId || undefined,
      ...settingsForm,
    });
  };

  const getAlertTypeIcon = (type: string) => {
    switch (type) {
      case "overspending":
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case "underspending":
        return <TrendingDown className="h-4 w-4 text-yellow-500" />;
      case "budget_depleted":
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case "near_depletion":
        return <Zap className="h-4 w-4 text-orange-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const getAlertTypeName = (type: string) => {
    const names: Record<string, string> = {
      overspending: "消耗过快",
      underspending: "消耗过慢",
      budget_depleted: "预算耗尽",
      near_depletion: "即将耗尽",
    };
    return names[type] || type;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500";
      case "high":
        return "bg-orange-500";
      case "medium":
        return "bg-yellow-500";
      case "low":
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="destructive">活跃</Badge>;
      case "acknowledged":
        return <Badge variant="secondary">已确认</Badge>;
      case "resolved":
        return <Badge variant="outline">已解决</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">预算消耗预警</h1>
          <p className="text-muted-foreground">监控广告活动预算消耗速度，及时发现异常</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetchAlerts()}
            disabled={alertsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${alertsLoading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button
            onClick={() => checkConsumptionMutation.mutate({ accountId: selectedAccountId || undefined })}
            disabled={checkConsumptionMutation.isPending}
          >
            <Zap className="h-4 w-4 mr-2" />
            立即检查
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="alerts">
            <Bell className="h-4 w-4 mr-2" />
            预警列表
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-2" />
            预警设置
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="space-y-4">
          {/* 筛选器 */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-4">
                <div className="w-48">
                  <Label>预警类型</Label>
                  <Select value={alertTypeFilter} onValueChange={(v) => setAlertTypeFilter(v as AlertType | "all")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部类型</SelectItem>
                      <SelectItem value="overspending">消耗过快</SelectItem>
                      <SelectItem value="underspending">消耗过慢</SelectItem>
                      <SelectItem value="budget_depleted">预算耗尽</SelectItem>
                      <SelectItem value="near_depletion">即将耗尽</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <Label>状态</Label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AlertStatus | "all")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="active">活跃</SelectItem>
                      <SelectItem value="acknowledged">已确认</SelectItem>
                      <SelectItem value="resolved">已解决</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 预警统计 */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-red-100 dark:bg-red-900">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">活跃预警</p>
                    <p className="text-2xl font-bold">
                      {alertsData?.alerts.filter(a => a.status === "active").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-orange-100 dark:bg-orange-900">
                    <TrendingUp className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">消耗过快</p>
                    <p className="text-2xl font-bold">
                      {alertsData?.alerts.filter(a => a.alertType === "overspending").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-yellow-100 dark:bg-yellow-900">
                    <TrendingDown className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">消耗过慢</p>
                    <p className="text-2xl font-bold">
                      {alertsData?.alerts.filter(a => a.alertType === "underspending").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">已解决</p>
                    <p className="text-2xl font-bold">
                      {alertsData?.alerts.filter(a => a.status === "resolved").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 预警列表 */}
          <Card>
            <CardHeader>
              <CardTitle>预警记录</CardTitle>
              <CardDescription>共 {alertsData?.total || 0} 条预警</CardDescription>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : alertsData?.alerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无预警记录</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertsData?.alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-1 h-12 rounded-full ${getSeverityColor(alert.severity || "medium")}`} />
                        <div className="flex items-center gap-2">
                          {getAlertTypeIcon(alert.alertType)}
                          <div>
                            <p className="font-medium">{getAlertTypeName(alert.alertType)}</p>
                            <p className="text-sm text-muted-foreground">{alert.recommendation || "消耗异常"}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm">
                            偏差: <span className="font-medium">{Number(alert.deviationPercent || 0).toFixed(1)}%</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ${Number(alert.currentSpend || 0).toFixed(2)} / ${Number(alert.dailyBudget || 0).toFixed(2)}
                          </p>
                        </div>
                        {getStatusBadge(alert.status || "active")}
                        {alert.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledgeMutation.mutate({ alertId: alert.id })}
                            disabled={acknowledgeMutation.isPending}
                          >
                            确认
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>预警阈值设置</CardTitle>
              <CardDescription>配置预算消耗预警的触发条件</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>消耗过快阈值 (%)</Label>
                  <Input
                    type="number"
                    value={settingsForm.fastConsumptionThreshold}
                    onChange={(e) => setSettingsForm(prev => ({ ...prev, fastConsumptionThreshold: Number(e.target.value) }))}
                    min={100}
                    max={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    当消耗速度超过预期的此百分比时触发预警（默认200%）
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>消耗过慢阈值 (%)</Label>
                  <Input
                    type="number"
                    value={settingsForm.slowConsumptionThreshold}
                    onChange={(e) => setSettingsForm(prev => ({ ...prev, slowConsumptionThreshold: Number(e.target.value) }))}
                    min={10}
                    max={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    当消耗速度低于预期的此百分比时触发预警（默认50%）
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>检查间隔（小时）</Label>
                <Select
                  value={String(settingsForm.checkInterval)}
                  onValueChange={(v) => setSettingsForm(prev => ({ ...prev, checkInterval: Number(v) }))}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">每小时</SelectItem>
                    <SelectItem value="4">每4小时</SelectItem>
                    <SelectItem value="8">每8小时</SelectItem>
                    <SelectItem value="24">每天</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <Label>通知方式</Label>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>邮件通知</Label>
                    <p className="text-xs text-muted-foreground">通过邮件接收预警通知</p>
                  </div>
                  <Switch
                    checked={settingsForm.notifyEmail}
                    onCheckedChange={(checked) => setSettingsForm(prev => ({ ...prev, notifyEmail: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>应用内通知</Label>
                    <p className="text-xs text-muted-foreground">在系统内显示预警通知</p>
                  </div>
                  <Switch
                    checked={settingsForm.notifyInApp}
                    onCheckedChange={(checked) => setSettingsForm(prev => ({ ...prev, notifyInApp: checked }))}
                  />
                </div>
              </div>

              <Button onClick={handleSaveSettings} disabled={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? "保存中..." : "保存设置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
