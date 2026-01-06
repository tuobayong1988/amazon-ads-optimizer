import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { 
  Mail, 
  Plus, 
  Clock, 
  MoreHorizontal,
  Trash2,
  Edit,
  RefreshCw,
  CheckCircle,
  XCircle,
  Send,
  Calendar,
  FileText,
  Settings,
  Play,
  Pause,
  History
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ReportType = "cross_account_summary" | "account_performance" | "campaign_performance" | "keyword_performance" | "health_alert" | "optimization_summary";
type Frequency = "daily" | "weekly" | "monthly";
type DateRange = "last_7_days" | "last_14_days" | "last_30_days" | "last_month" | "custom";

interface SubscriptionForm {
  name: string;
  description: string;
  reportType: ReportType;
  frequency: Frequency;
  sendTime: string;
  sendDayOfWeek?: number;
  sendDayOfMonth?: number;
  recipients: string[];
  ccRecipients: string[];
  accountIds: number[];
  includeCharts: boolean;
  includeDetails: boolean;
  dateRange: DateRange;
}

const defaultForm: SubscriptionForm = {
  name: "",
  description: "",
  reportType: "cross_account_summary",
  frequency: "weekly",
  sendTime: "09:00",
  sendDayOfWeek: 1,
  sendDayOfMonth: 1,
  recipients: [],
  ccRecipients: [],
  accountIds: [],
  includeCharts: true,
  includeDetails: true,
  dateRange: "last_7_days",
};

const reportTypeLabels: Record<ReportType, { name: string; description: string }> = {
  cross_account_summary: { name: "跨账号汇总报表", description: "所有店铺的整体广告表现汇总" },
  account_performance: { name: "单账号表现报表", description: "单个店铺的详细广告表现" },
  campaign_performance: { name: "广告活动表现报表", description: "广告活动级别的详细数据" },
  keyword_performance: { name: "关键词表现报表", description: "关键词级别的详细数据" },
  health_alert: { name: "健康度告警报表", description: "异常指标和健康度告警" },
  optimization_summary: { name: "优化汇总报表", description: "自动优化执行情况汇总" },
};

const frequencyLabels: Record<Frequency, string> = {
  daily: "每日",
  weekly: "每周",
  monthly: "每月",
};

const dayOfWeekLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export default function EmailReports() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SubscriptionForm>(defaultForm);
  const [recipientInput, setRecipientInput] = useState("");

  // 获取订阅列表
  const { data: subscriptions, isLoading, refetch } = trpc.emailReport.list.useQuery();
  
  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取报表类型
  const { data: reportTypes } = trpc.emailReport.getReportTypes.useQuery();

  // 创建订阅
  const createMutation = trpc.emailReport.create.useMutation({
    onSuccess: () => {
      toast.success("订阅创建成功");
      setIsCreateOpen(false);
      setForm(defaultForm);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "创建失败");
    },
  });

  // 更新订阅
  const updateMutation = trpc.emailReport.update.useMutation({
    onSuccess: () => {
      toast.success("订阅更新成功");
      setIsEditOpen(false);
      setEditingId(null);
      setForm(defaultForm);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "更新失败");
    },
  });

  // 删除订阅
  const deleteMutation = trpc.emailReport.delete.useMutation({
    onSuccess: () => {
      toast.success("订阅已删除");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "删除失败");
    },
  });

  // 切换状态
  const toggleMutation = trpc.emailReport.toggleActive.useMutation({
    onSuccess: (data) => {
      toast.success(data.isActive ? "订阅已启用" : "订阅已暂停");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "操作失败");
    },
  });

  // 发送测试邮件
  const sendTestMutation = trpc.emailReport.sendTest.useMutation({
    onSuccess: () => {
      toast.success("测试邮件已发送");
    },
    onError: (error) => {
      toast.error(error.message || "发送失败");
    },
  });

  const handleCreate = () => {
    if (!form.name) {
      toast.error("请输入订阅名称");
      return;
    }
    if (form.recipients.length === 0) {
      toast.error("请添加至少一个收件人");
      return;
    }
    createMutation.mutate(form);
  };

  const handleUpdate = () => {
    if (!editingId) return;
    updateMutation.mutate({ id: editingId, ...form });
  };

  const handleEdit = (subscription: any) => {
    setEditingId(subscription.id);
    setForm({
      name: subscription.name,
      description: subscription.description || "",
      reportType: subscription.reportType,
      frequency: subscription.frequency,
      sendTime: subscription.sendTime || "09:00",
      sendDayOfWeek: subscription.sendDayOfWeek,
      sendDayOfMonth: subscription.sendDayOfMonth,
      recipients: subscription.recipients || [],
      ccRecipients: subscription.ccRecipients || [],
      accountIds: subscription.accountIds || [],
      includeCharts: subscription.includeCharts ?? true,
      includeDetails: subscription.includeDetails ?? true,
      dateRange: subscription.dateRange || "last_7_days",
    });
    setIsEditOpen(true);
  };

  const addRecipient = () => {
    if (!recipientInput || !recipientInput.includes("@")) {
      toast.error("请输入有效的邮箱地址");
      return;
    }
    if (form.recipients.includes(recipientInput)) {
      toast.error("该邮箱已添加");
      return;
    }
    setForm({ ...form, recipients: [...form.recipients, recipientInput] });
    setRecipientInput("");
  };

  const removeRecipient = (email: string) => {
    setForm({ ...form, recipients: form.recipients.filter(r => r !== email) });
  };

  // 统计数据
  const stats = {
    total: subscriptions?.length || 0,
    active: subscriptions?.filter(s => s.isActive).length || 0,
    paused: subscriptions?.filter(s => !s.isActive).length || 0,
  };

  const SubscriptionForm = ({ isEdit = false }: { isEdit?: boolean }) => (
    <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
      <div className="space-y-2">
        <Label htmlFor="name">订阅名称 *</Label>
        <Input
          id="name"
          placeholder="例如：每周销售汇总"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">描述</Label>
        <Input
          id="description"
          placeholder="可选"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>报表类型</Label>
        <Select
          value={form.reportType}
          onValueChange={(value: ReportType) => setForm({ ...form, reportType: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(reportTypes || Object.entries(reportTypeLabels).map(([id, info]) => ({ id, ...info }))).map((type: any) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {reportTypeLabels[form.reportType]?.description}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>发送频率</Label>
          <Select
            value={form.frequency}
            onValueChange={(value: Frequency) => setForm({ ...form, frequency: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">每日</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="monthly">每月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>发送时间</Label>
          <Input
            type="time"
            value={form.sendTime}
            onChange={(e) => setForm({ ...form, sendTime: e.target.value })}
          />
        </div>
      </div>

      {form.frequency === "weekly" && (
        <div className="space-y-2">
          <Label>发送日期</Label>
          <Select
            value={String(form.sendDayOfWeek ?? 1)}
            onValueChange={(value) => setForm({ ...form, sendDayOfWeek: parseInt(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dayOfWeekLabels.map((label, index) => (
                <SelectItem key={index} value={String(index)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {form.frequency === "monthly" && (
        <div className="space-y-2">
          <Label>发送日期</Label>
          <Select
            value={String(form.sendDayOfMonth ?? 1)}
            onValueChange={(value) => setForm({ ...form, sendDayOfMonth: parseInt(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <SelectItem key={day} value={String(day)}>{day}号</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>数据范围</Label>
        <Select
          value={form.dateRange}
          onValueChange={(value: DateRange) => setForm({ ...form, dateRange: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_7_days">最近7天</SelectItem>
            <SelectItem value="last_14_days">最近14天</SelectItem>
            <SelectItem value="last_30_days">最近30天</SelectItem>
            <SelectItem value="last_month">上个月</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>收件人 *</Label>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="输入邮箱地址"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRecipient())}
          />
          <Button type="button" variant="outline" onClick={addRecipient}>
            添加
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {form.recipients.map((email) => (
            <Badge key={email} variant="secondary" className="gap-1">
              {email}
              <button
                type="button"
                className="ml-1 hover:text-red-500"
                onClick={() => removeRecipient(email)}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>包含的账号</Label>
        <p className="text-sm text-muted-foreground mb-2">不选择则包含所有账号</p>
        <div className="space-y-2 max-h-40 overflow-y-auto border rounded-lg p-2">
          {accounts?.map((account) => (
            <div key={account.id} className="flex items-center gap-2">
              <Checkbox
                checked={form.accountIds.includes(account.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setForm({ ...form, accountIds: [...form.accountIds, account.id] });
                  } else {
                    setForm({ ...form, accountIds: form.accountIds.filter(id => id !== account.id) });
                  }
                }}
              />
              <span>{account.storeName || account.accountName}</span>
              <span className="text-sm text-muted-foreground">({account.marketplace})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            checked={form.includeCharts}
            onCheckedChange={(checked) => setForm({ ...form, includeCharts: checked })}
          />
          <Label>包含图表</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={form.includeDetails}
            onCheckedChange={(checked) => setForm({ ...form, includeDetails: checked })}
          />
          <Label>包含详细数据</Label>
        </div>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">邮件报表</h1>
            <p className="text-muted-foreground">配置定期发送的报表邮件</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                创建订阅
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>创建邮件订阅</DialogTitle>
                <DialogDescription>
                  配置定期发送的报表邮件
                </DialogDescription>
              </DialogHeader>
              <SubscriptionForm />
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "创建中..." : "创建订阅"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 统计卡片 */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总订阅数</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">已启用</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">已暂停</CardTitle>
              <Pause className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-500">{stats.paused}</div>
            </CardContent>
          </Card>
        </div>

        {/* 订阅列表 */}
        <Card>
          <CardHeader>
            <CardTitle>邮件订阅</CardTitle>
            <CardDescription>管理您的报表邮件订阅</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : subscriptions?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无邮件订阅</p>
                <p className="text-sm">点击上方按钮创建您的第一个订阅</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>订阅名称</TableHead>
                    <TableHead>报表类型</TableHead>
                    <TableHead>发送频率</TableHead>
                    <TableHead>收件人</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>下次发送</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions?.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{subscription.name}</div>
                          {subscription.description && (
                            <div className="text-sm text-muted-foreground">{subscription.description}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {reportTypeLabels[subscription.reportType as ReportType]?.name || subscription.reportType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {frequencyLabels[subscription.frequency as Frequency]}
                          {subscription.frequency === "weekly" && subscription.sendDayOfWeek !== null && (
                            <span className="text-muted-foreground">
                              ({dayOfWeekLabels[subscription.sendDayOfWeek]})
                            </span>
                          )}
                          {subscription.frequency === "monthly" && subscription.sendDayOfMonth && (
                            <span className="text-muted-foreground">
                              ({subscription.sendDayOfMonth}号)
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{subscription.sendTime}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {((subscription.recipients as string[]) || []).slice(0, 2).map((email) => (
                            <Badge key={email} variant="secondary" className="text-xs">
                              {email.split("@")[0]}
                            </Badge>
                          ))}
                          {((subscription.recipients as string[]) || []).length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{((subscription.recipients as string[]) || []).length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={subscription.isActive ?? false}
                            onCheckedChange={() => toggleMutation.mutate({ id: subscription.id })}
                          />
                          <span className={subscription.isActive ? "text-green-500" : "text-muted-foreground"}>
                            {subscription.isActive ? "已启用" : "已暂停"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {subscription.nextSendAt ? (
                          <div className="text-sm">
                            {new Date(subscription.nextSendAt).toLocaleDateString("zh-CN")}
                            <br />
                            <span className="text-muted-foreground">
                              {new Date(subscription.nextSendAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(subscription)}>
                              <Edit className="mr-2 h-4 w-4" />
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => sendTestMutation.mutate({ id: subscription.id })}>
                              <Send className="mr-2 h-4 w-4" />
                              发送测试
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-red-500"
                              onClick={() => deleteMutation.mutate({ id: subscription.id })}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 编辑对话框 */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>编辑邮件订阅</DialogTitle>
              <DialogDescription>
                修改订阅配置
              </DialogDescription>
            </DialogHeader>
            <SubscriptionForm isEdit />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                取消
              </Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "保存中..." : "保存更改"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
