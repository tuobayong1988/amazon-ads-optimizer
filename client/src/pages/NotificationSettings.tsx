import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { Bell, Mail, Clock, AlertTriangle, CheckCircle, XCircle, Info, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function NotificationSettings() {
  const [settings, setSettings] = useState({
    emailEnabled: true,
    inAppEnabled: true,
    acosThreshold: 50,
    ctrDropThreshold: 30,
    conversionDropThreshold: 30,
    spendSpikeThreshold: 50,
    frequency: 'daily' as 'immediate' | 'hourly' | 'daily' | 'weekly',
    quietHoursStart: 22,
    quietHoursEnd: 8,
  });

  const { data: savedSettings, isLoading } = trpc.notification.getSettings.useQuery();
  const { data: notificationHistory, isLoading: historyLoading } = trpc.notification.getHistory.useQuery({ limit: 20 });
  const updateSettingsMutation = trpc.notification.updateSettings.useMutation();
  const sendTestMutation = trpc.notification.sendTest.useMutation();
  const markAsReadMutation = trpc.notification.markAsRead.useMutation();

  useEffect(() => {
    if (savedSettings) {
      setSettings({
        emailEnabled: Boolean(savedSettings.emailEnabled ?? true),
        inAppEnabled: Boolean(savedSettings.inAppEnabled ?? true),
        acosThreshold: parseFloat(savedSettings.acosThreshold || '50'),
        ctrDropThreshold: parseFloat(savedSettings.ctrDropThreshold || '30'),
        conversionDropThreshold: parseFloat(savedSettings.conversionDropThreshold || '30'),
        spendSpikeThreshold: parseFloat(savedSettings.spendSpikeThreshold || '50'),
        frequency: savedSettings.frequency || 'daily',
        quietHoursStart: savedSettings.quietHoursStart ?? 22,
        quietHoursEnd: savedSettings.quietHoursEnd ?? 8,
      });
    }
  }, [savedSettings]);

  const handleSaveSettings = async () => {
    try {
      await updateSettingsMutation.mutateAsync(settings);
      toast.success('通知设置已保存');
    } catch (error) {
      toast.error('保存设置失败');
    }
  };

  const handleSendTest = async () => {
    try {
      const result = await sendTestMutation.mutateAsync();
      if (result.success) {
        toast.success('测试通知已发送');
      } else {
        toast.error('发送测试通知失败');
      }
    } catch (error) {
      toast.error('发送测试通知失败');
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">严重</Badge>;
      case 'warning':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">警告</Badge>;
      default:
        return <Badge variant="secondary">信息</Badge>;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">通知设置</h1>
            <p className="text-muted-foreground">配置健康度监控告警和通知偏好</p>
          </div>
          <Button onClick={handleSendTest} disabled={sendTestMutation.isPending}>
            {sendTestMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Bell className="mr-2 h-4 w-4" />
            )}
            发送测试通知
          </Button>
        </div>

        <Tabs defaultValue="settings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="settings">通知设置</TabsTrigger>
            <TabsTrigger value="thresholds">告警阈值</TabsTrigger>
            <TabsTrigger value="history">通知历史</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    通知渠道
                  </CardTitle>
                  <CardDescription>选择接收通知的方式</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>邮件通知</Label>
                      <p className="text-sm text-muted-foreground">通过邮件接收重要告警</p>
                    </div>
                    <Switch
                      checked={settings.emailEnabled}
                      onCheckedChange={(checked) => setSettings({ ...settings, emailEnabled: checked })}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>应用内通知</Label>
                      <p className="text-sm text-muted-foreground">在系统内显示通知消息</p>
                    </div>
                    <Switch
                      checked={settings.inAppEnabled}
                      onCheckedChange={(checked) => setSettings({ ...settings, inAppEnabled: checked })}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    通知频率
                  </CardTitle>
                  <CardDescription>设置通知发送的频率和免打扰时段</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>通知频率</Label>
                    <Select
                      value={settings.frequency}
                      onValueChange={(value) => setSettings({ ...settings, frequency: value as typeof settings.frequency })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">立即发送</SelectItem>
                        <SelectItem value="hourly">每小时汇总</SelectItem>
                        <SelectItem value="daily">每日汇总</SelectItem>
                        <SelectItem value="weekly">每周汇总</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>免打扰时段</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={settings.quietHoursStart.toString()}
                        onValueChange={(value) => setSettings({ ...settings, quietHoursStart: parseInt(value) })}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {i.toString().padStart(2, '0')}:00
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">至</span>
                      <Select
                        value={settings.quietHoursEnd.toString()}
                        onValueChange={(value) => setSettings({ ...settings, quietHoursEnd: parseInt(value) })}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {i.toString().padStart(2, '0')}:00
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">在此时段内不发送非紧急通知</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveSettings} disabled={updateSettingsMutation.isPending}>
                {updateSettingsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存设置
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="thresholds" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  告警阈值配置
                </CardTitle>
                <CardDescription>设置触发告警的指标阈值</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>ACoS告警阈值 (%)</Label>
                    <Input
                      type="number"
                      value={settings.acosThreshold}
                      onChange={(e) => setSettings({ ...settings, acosThreshold: parseFloat(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">当ACoS超过此值时触发告警</p>
                  </div>

                  <div className="space-y-2">
                    <Label>点击率下降阈值 (%)</Label>
                    <Input
                      type="number"
                      value={settings.ctrDropThreshold}
                      onChange={(e) => setSettings({ ...settings, ctrDropThreshold: parseFloat(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">当CTR下降超过此比例时触发告警</p>
                  </div>

                  <div className="space-y-2">
                    <Label>转化率下降阈值 (%)</Label>
                    <Input
                      type="number"
                      value={settings.conversionDropThreshold}
                      onChange={(e) => setSettings({ ...settings, conversionDropThreshold: parseFloat(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">当转化率下降超过此比例时触发告警</p>
                  </div>

                  <div className="space-y-2">
                    <Label>花费激增阈值 (%)</Label>
                    <Input
                      type="number"
                      value={settings.spendSpikeThreshold}
                      onChange={(e) => setSettings({ ...settings, spendSpikeThreshold: parseFloat(e.target.value) || 0 })}
                    />
                    <p className="text-xs text-muted-foreground">当花费增长超过此比例时触发告警</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSaveSettings} disabled={updateSettingsMutation.isPending}>
                {updateSettingsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存设置
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>通知历史</CardTitle>
                <CardDescription>查看最近的通知记录</CardDescription>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : notificationHistory && notificationHistory.length > 0 ? (
                  <div className="space-y-4">
                    {notificationHistory.map((notification) => (
                      <div
                        key={notification.id}
                        className={`flex items-start gap-4 p-4 rounded-lg border ${
                          notification.status === 'read' ? 'bg-muted/30' : 'bg-background'
                        }`}
                      >
                        {getSeverityIcon(notification.severity || 'info')}
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{notification.title}</span>
                            {getSeverityBadge(notification.severity || 'info')}
                            {notification.status !== 'read' && (
                              <Badge variant="outline" className="text-xs">未读</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{notification.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(notification.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        {notification.status !== 'read' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markAsReadMutation.mutate({ id: notification.id })}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无通知记录</p>
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
