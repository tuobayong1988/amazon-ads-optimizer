import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { 
  Plus, Copy, CheckCircle, XCircle, Trash2, RefreshCw, 
  Users, UserPlus, Clock, MoreVertical, Download
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export default function InviteCodeManagement() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    inviteType: "external_user" as "team_member" | "external_user",
    maxUses: 1,
    expiresInDays: 30,
    note: "",
  });
  const [batchCount, setBatchCount] = useState(5);

  // 获取邀请码列表
  const inviteCodesQuery = trpc.inviteCode.list.useQuery();
  const statsQuery = trpc.inviteCode.stats.useQuery();

  // 创建邀请码
  const createMutation = trpc.inviteCode.create.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("邀请码创建成功");
        setCreateDialogOpen(false);
        inviteCodesQuery.refetch();
        statsQuery.refetch();
      } else {
        toast.error(data.error || "创建失败");
      }
    },
    onError: (err) => {
      toast.error(err.message || "创建失败");
    },
  });

  // 批量创建邀请码
  const createBatchMutation = trpc.inviteCode.createBatch.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`成功创建 ${data.inviteCodes?.length || 0} 个邀请码`);
        setBatchDialogOpen(false);
        inviteCodesQuery.refetch();
        statsQuery.refetch();
      } else {
        toast.error(data.error || "批量创建失败");
      }
    },
    onError: (err) => {
      toast.error(err.message || "批量创建失败");
    },
  });

  // 禁用邀请码
  const disableMutation = trpc.inviteCode.disable.useMutation({
    onSuccess: () => {
      toast.success("邀请码已禁用");
      inviteCodesQuery.refetch();
    },
  });

  // 启用邀请码
  const enableMutation = trpc.inviteCode.enable.useMutation({
    onSuccess: () => {
      toast.success("邀请码已启用");
      inviteCodesQuery.refetch();
    },
  });

  // 删除邀请码
  const deleteMutation = trpc.inviteCode.delete.useMutation({
    onSuccess: () => {
      toast.success("邀请码已删除");
      inviteCodesQuery.refetch();
      statsQuery.refetch();
    },
  });

  const copyToClipboard = (code: string) => {
    const registerUrl = `${window.location.origin}/register?code=${code}`;
    navigator.clipboard.writeText(registerUrl);
    toast.success("注册链接已复制到剪贴板");
  };

  const handleCreate = () => {
    createMutation.mutate({
      inviteType: createForm.inviteType,
      maxUses: createForm.maxUses,
      expiresInDays: createForm.expiresInDays || undefined,
      note: createForm.note || undefined,
    });
  };

  const handleBatchCreate = () => {
    createBatchMutation.mutate({
      count: batchCount,
      inviteType: createForm.inviteType,
      maxUses: createForm.maxUses,
      expiresInDays: createForm.expiresInDays || undefined,
      note: createForm.note || undefined,
    });
  };

  const exportInviteCodes = () => {
    const codes = inviteCodesQuery.data || [];
    const csv = [
      ["邀请码", "类型", "状态", "已使用/最大次数", "创建时间", "过期时间", "备注"].join(","),
      ...codes.map((code: any) => [
        code.code,
        code.inviteType === "external_user" ? "外部用户" : "团队成员",
        code.status === "active" ? "有效" : code.status === "disabled" ? "已禁用" : "已过期",
        `${code.usedCount}/${code.maxUses || "无限"}`,
        code.createdAt,
        code.expiresAt || "永不过期",
        code.note || "",
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `invite_codes_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("邀请码列表已导出");
  };

  const stats = statsQuery.data || { total: 0, active: 0, used: 0, expired: 0 };
  const inviteCodes = inviteCodesQuery.data || [];

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">邀请码管理</h1>
          <p className="text-gray-400 mt-1">生成和管理邀请码，邀请团队成员或外部用户</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportInviteCodes}>
            <Download className="h-4 w-4 mr-2" />
            导出
          </Button>
          <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Users className="h-4 w-4 mr-2" />
                批量生成
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-800 border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-white">批量生成邀请码</DialogTitle>
                <DialogDescription className="text-gray-400">
                  一次性生成多个邀请码
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">生成数量</Label>
                  <Input
                    type="number"
                    value={batchCount}
                    onChange={(e) => setBatchCount(parseInt(e.target.value) || 1)}
                    min={1}
                    max={100}
                    className="bg-gray-700/50 border-gray-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">邀请类型</Label>
                  <Select
                    value={createForm.inviteType}
                    onValueChange={(v) => setCreateForm({ ...createForm, inviteType: v as any })}
                  >
                    <SelectTrigger className="bg-gray-700/50 border-gray-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="external_user">外部用户（创建独立团队）</SelectItem>
                      <SelectItem value="team_member">团队成员（加入我的团队）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>取消</Button>
                <Button onClick={handleBatchCreate} disabled={createBatchMutation.isPending}>
                  {createBatchMutation.isPending ? "生成中..." : "生成"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600">
                <Plus className="h-4 w-4 mr-2" />
                生成邀请码
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-800 border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-white">生成邀请码</DialogTitle>
                <DialogDescription className="text-gray-400">
                  创建新的邀请码用于邀请用户注册
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">邀请类型</Label>
                  <Select
                    value={createForm.inviteType}
                    onValueChange={(v) => setCreateForm({ ...createForm, inviteType: v as any })}
                  >
                    <SelectTrigger className="bg-gray-700/50 border-gray-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="external_user">外部用户（创建独立团队）</SelectItem>
                      <SelectItem value="team_member">团队成员（加入我的团队）</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    {createForm.inviteType === "external_user" 
                      ? "外部用户注册后将创建独立的团队，只能看到自己的数据" 
                      : "团队成员注册后将加入您的团队，可以访问您授权的数据"}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">最大使用次数</Label>
                  <Input
                    type="number"
                    value={createForm.maxUses}
                    onChange={(e) => setCreateForm({ ...createForm, maxUses: parseInt(e.target.value) || 1 })}
                    min={1}
                    max={1000}
                    className="bg-gray-700/50 border-gray-600 text-white"
                  />
                  <p className="text-xs text-gray-500">设置为0表示无限次使用</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">有效期（天）</Label>
                  <Input
                    type="number"
                    value={createForm.expiresInDays}
                    onChange={(e) => setCreateForm({ ...createForm, expiresInDays: parseInt(e.target.value) || 0 })}
                    min={0}
                    max={365}
                    className="bg-gray-700/50 border-gray-600 text-white"
                  />
                  <p className="text-xs text-gray-500">设置为0表示永不过期</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">备注（可选）</Label>
                  <Textarea
                    value={createForm.note}
                    onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })}
                    placeholder="例如：发给XX公司测试"
                    className="bg-gray-700/50 border-gray-600 text-white"
                    maxLength={255}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "生成中..." : "生成"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">总邀请码</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <UserPlus className="h-5 w-5 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">有效邀请码</p>
                <p className="text-2xl font-bold text-green-400">{stats.active}</p>
              </div>
              <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">已使用次数</p>
                <p className="text-2xl font-bold text-yellow-400">{stats.used}</p>
              </div>
              <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                <Users className="h-5 w-5 text-yellow-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">已过期</p>
                <p className="text-2xl font-bold text-gray-400">{stats.expired}</p>
              </div>
              <div className="w-10 h-10 bg-gray-500/20 rounded-lg flex items-center justify-center">
                <Clock className="h-5 w-5 text-gray-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 邀请码列表 */}
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">邀请码列表</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => inviteCodesQuery.refetch()}>
              <RefreshCw className={`h-4 w-4 ${inviteCodesQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {inviteCodes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>还没有邀请码</p>
              <p className="text-sm mt-1">点击上方按钮生成邀请码</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inviteCodes.map((code: any) => (
                <div
                  key={code.id}
                  className="flex items-center justify-between p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-lg text-white bg-gray-700 px-3 py-1 rounded">
                      {code.code}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={code.inviteType === "external_user" ? "default" : "secondary"}>
                          {code.inviteType === "external_user" ? "外部用户" : "团队成员"}
                        </Badge>
                        <Badge 
                          variant={
                            code.status === "active" ? "default" : 
                            code.status === "disabled" ? "destructive" : "secondary"
                          }
                          className={
                            code.status === "active" ? "bg-green-500/20 text-green-400" : ""
                          }
                        >
                          {code.status === "active" ? "有效" : 
                           code.status === "disabled" ? "已禁用" : "已过期"}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-400 mt-1">
                        已使用 {code.usedCount}/{code.maxUses || "∞"} 次
                        {code.expiresAt && ` · 过期时间: ${new Date(code.expiresAt).toLocaleDateString()}`}
                        {code.note && ` · ${code.note}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(code.code)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-gray-800 border-gray-700">
                        {code.status === "active" ? (
                          <DropdownMenuItem
                            onClick={() => disableMutation.mutate({ id: code.id })}
                            className="text-yellow-400"
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            禁用
                          </DropdownMenuItem>
                        ) : code.status === "disabled" ? (
                          <DropdownMenuItem
                            onClick={() => enableMutation.mutate({ id: code.id })}
                            className="text-green-400"
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            启用
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onClick={() => deleteMutation.mutate({ id: code.id })}
                          className="text-red-400"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
