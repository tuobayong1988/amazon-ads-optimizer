import { useState, useMemo, useCallback} from "react";
import { safeToLocaleDateString } from "@/lib/safeDate";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { 
  Users, 
  UserPlus, 
  Mail, 
  Shield, 
  Clock, 
  MoreHorizontal,
  Trash2,
  Edit,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Key
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TeamMemberRole = "owner" | "admin" | "editor" | "viewer";
type InviteRole = Exclude<TeamMemberRole, "owner">;
type TeamMemberStatus = "pending" | "active" | "inactive" | "revoked";

interface Permission {
  accountId: number;
  permissionLevel: "full" | "edit" | "view";
  canExport?: boolean;
  canManageCampaigns?: boolean;
  canAdjustBids?: boolean;
  canManageNegatives?: boolean;
}

export default function TeamManagement() {
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isPermissionOpen, setIsPermissionOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [inviteForm, setInviteForm] = useState({
    username: "",
    name: "",
    password: "",
    email: "",
    role: "viewer" as InviteRole,
  });
  const [permissions, setPermissions] = useState<Permission[]>([]);

  // 获取团队成员列表
  // @ts-ignore
  const { data: members, isLoading, refetch } = trpc.team.list.useQuery() as unknown;
  
  // 获取账号列表（用于权限分配）
  // @ts-ignore
  const { data: accounts } = trpc.adAccount.list.useQuery() as unknown;

  // v483: 直接创建成员账号（替代邮箱邀请）
  const inviteMutation = trpc.team.createMember.useMutation({
    onSuccess: () => {
      toast.success("成员账号已创建");
      setIsInviteOpen(false);
      setInviteForm({ username: "", name: "", password: "", email: "", role: "viewer" });
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "创建失败");
    },
  });

  // 更新成员
  const updateMutation = trpc.team.update.useMutation({
    onSuccess: () => {
      toast.success("更新成功");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "更新失败");
    },
  });

  // 删除成员
  const deleteMutation = trpc.team.delete.useMutation({
    onSuccess: () => {
      toast.success("成员已移除");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "删除失败");
    },
  });

  // 重新发送邀请
  const resendMutation = trpc.team.resendInvite.useMutation({
    onSuccess: () => {
      toast.success("邀请已重新发送");
    },
    onError: (error) => {
      toast.error(error.message || "发送失败");
    },
  });

  // 设置权限
  const setPermissionsMutation = trpc.team.setPermissions.useMutation({
    onSuccess: () => {
      toast.success("权限已更新");
      setIsPermissionOpen(false);
      setSelectedMemberId(null);
    },
    onError: (error) => {
      toast.error(error.message || "设置权限失败");
    },
  });

  // 获取成员权限
  const { data: memberPermissions } = trpc.team.getPermissions.useQuery(
    { memberId: selectedMemberId! },
    { enabled: !!selectedMemberId }
  );

  const handleInvite = useCallback(() => {
    if (!inviteForm.username) {
      toast.error("请输入用户名");
      return;
    }
    if (!inviteForm.name) {
      toast.error("请输入真实姓名");
      return;
    }
    if (!inviteForm.password || inviteForm.password.length < 6) {
      toast.error("密码至少6个字符");
      return;
    }
    inviteMutation.mutate(inviteForm);
  }, [inviteForm, inviteMutation]);

  const handleOpenPermissions = useCallback((memberId: number) => {
    setSelectedMemberId(memberId);
    setIsPermissionOpen(true);
  }, []);

  const handleSavePermissions = useCallback(() => {
    if (!selectedMemberId) return;
    setPermissionsMutation.mutate({
      memberId: selectedMemberId,
      permissions,
    });
  }, [selectedMemberId, permissions, setPermissionsMutation]);

  const getRoleBadge = useCallback((role: TeamMemberRole) => {
    const roleConfig = {
      owner: { label: "所有者", variant: "default" as const, className: "bg-gradient-to-r from-amber-500 to-orange-500" },
      admin: { label: "管理员", variant: "default" as const, className: "bg-purple-500" },
      editor: { label: "编辑", variant: "secondary" as const, className: "bg-blue-500" },
      viewer: { label: "只读", variant: "outline" as const, className: "" },
      member: { label: "成员", variant: "secondary" as const, className: "bg-green-600" },
    };
    const config = roleConfig[role] || { label: role || '未知', variant: "outline" as const, className: "" };
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  }, []);

  const getStatusBadge = useCallback((status: TeamMemberStatus) => {
    const statusConfig = {
      pending: { label: "待接受", icon: Clock, className: "text-yellow-500" },
      active: { label: "已激活", icon: CheckCircle, className: "text-green-500" },
      inactive: { label: "已停用", icon: XCircle, className: "text-gray-500" },
      revoked: { label: "已撤销", icon: AlertCircle, className: "text-red-500" },
    };
    const config = statusConfig[status];
    const Icon = config.icon;
    return (
      <div className={`flex items-center gap-1 ${config.className}`}>
        <Icon className="h-4 w-4" />
        <span>{config.label}</span>
      </div>
    );
  }, []);

  // 统计数据 - v446: useMemo避免重复计算
  const stats = useMemo(() => ({
    total: members?.length || 0,
    // @ts-expect-error - array method type inference
    active: members?.filter(m => m.status === "active").length || 0,
    // @ts-expect-error - array method type inference
    pending: members?.filter(m => m.status === "pending").length || 0,
    // @ts-expect-error - array method type inference
    admins: members?.filter(m => m.role === "admin" || m.role === "owner").length || 0,
  }), [members]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">团队管理</h1>
            <p className="text-muted-foreground">管理团队成员和访问权限</p>
          </div>
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" />
                添加成员
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>添加团队成员</DialogTitle>
                <DialogDescription>
                  直接创建成员账号，创建完成后将账号信息发送给团队成员即可登录
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="username">用户名 *</Label>
                  <Input
                    id="username"
                    placeholder="用于登录的用户名"
                    value={inviteForm.username}
                    onChange={(e) => setInviteForm({ ...inviteForm, username: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">真实姓名 *</Label>
                  <Input
                    id="name"
                    placeholder="成员的真实姓名"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">登录密码 *</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="至少6个字符"
                    value={inviteForm.password}
                    onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">邮箱地址</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="可选，用于接收通知"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">角色</Label>
                  <Select
                    value={inviteForm.role}
                    onValueChange={(value: InviteRole) => setInviteForm({ ...inviteForm, role: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理员 - 可以管理所有设置和成员</SelectItem>
                      <SelectItem value="editor">编辑 - 可以编辑广告设置和数据</SelectItem>
                      <SelectItem value="viewer">只读 - 只能查看数据</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsInviteOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleInvite} disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? "创建中..." : "创建账号"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 统计卡片 */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总成员数</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">已激活</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">待接受</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-500">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">管理员</CardTitle>
              <Shield className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-500">{stats.admins}</div>
            </CardContent>
          </Card>
        </div>

        {/* 成员列表 */}
        <Card>
          <CardHeader>
            <CardTitle>团队成员</CardTitle>
            <CardDescription>管理团队成员的角色和权限</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">全部 ({stats.total})</TabsTrigger>
                <TabsTrigger value="active">已激活 ({stats.active})</TabsTrigger>
                <TabsTrigger value="pending">待接受 ({stats.pending})</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-4">
                <MemberTable 
                  members={members || []} 
                  isLoading={isLoading}
                  onOpenPermissions={handleOpenPermissions}
                  onResendInvite={(id) => resendMutation.mutate({ id })}
                  onDelete={(id) => deleteMutation.mutate({ id })}
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role: role as "admin" | "editor" | "viewer" })}
                  getRoleBadge={getRoleBadge}
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
              <TabsContent value="active" className="mt-4">
                <MemberTable 
                  // @ts-expect-error - array method type inference
                  members={(members || []).filter(m => m.status === "active")} 
                  isLoading={isLoading}
                  onOpenPermissions={handleOpenPermissions}
                  onResendInvite={(id) => resendMutation.mutate({ id })}
                  onDelete={(id) => deleteMutation.mutate({ id })}
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role: role as "admin" | "editor" | "viewer" })}
                  getRoleBadge={getRoleBadge}
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
              <TabsContent value="pending" className="mt-4">
                <MemberTable 
                  // @ts-expect-error - array method type inference
                  members={(members || []).filter(m => m.status === "pending")} 
                  isLoading={isLoading}
                  onOpenPermissions={handleOpenPermissions}
                  onResendInvite={(id) => resendMutation.mutate({ id })}
                  onDelete={(id) => deleteMutation.mutate({ id })}
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role: role as "admin" | "editor" | "viewer" })}
                  getRoleBadge={getRoleBadge}
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 权限设置对话框 */}
        <Dialog open={isPermissionOpen} onOpenChange={setIsPermissionOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>设置账号权限</DialogTitle>
              <DialogDescription>
                为该成员分配可访问的广告账号和权限级别
              </DialogDescription>
            </DialogHeader>
            {/* @ts-ignore */}
            <div className="space-y-4 py-4 max-h-96 overflow-y-auto">
              {accounts?.map((account: unknown) => {
                // @ts-ignore
                const existingPerm = permissions.find(p => p.accountId === account.id);
                return (
                  // @ts-ignore
                  <div key={account.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        // @ts-ignore
                        checked={!!existingPerm}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setPermissions([...permissions, {
                              // @ts-ignore
                              accountId: account.id,
                              permissionLevel: "view",
                            }]);
                          } else {
                            // @ts-ignore
                            setPermissions(permissions.filter(p => p.accountId !== account.id));
                          }
                        }}
                      />
                      <div>
                        {/* @ts-ignore */}
                        <div className="font-medium">{account.storeName || account.accountName}</div>
                        {/* @ts-ignore */}
                        <div className="text-sm text-muted-foreground">{account.marketplace}</div>
                      </div>
                    </div>
                    {existingPerm && (
                      <Select
                        value={existingPerm.permissionLevel}
                        onValueChange={(value: "full" | "edit" | "view") => {
                          setPermissions(permissions.map(p => 
                            // @ts-ignore
                            p.accountId === account.id ? { ...p, permissionLevel: value } : p
                          ));
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">完全控制</SelectItem>
                          <SelectItem value="edit">可编辑</SelectItem>
                          <SelectItem value="view">只读</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
              {(!accounts || accounts.length === 0) && (
                <div className="text-center text-muted-foreground py-8">
                  暂无可分配的广告账号
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPermissionOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSavePermissions} disabled={setPermissionsMutation.isPending}>
                {setPermissionsMutation.isPending ? "保存中..." : "保存权限"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// 成员表格组件
interface MemberTableProps {
  members: unknown[];
  isLoading: boolean;
  onOpenPermissions: (id: number) => void;
  onResendInvite: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdateRole: (id: number, role: "admin" | "editor" | "viewer") => void;
  getRoleBadge: (role: TeamMemberRole) => React.ReactNode;
  getStatusBadge: (status: TeamMemberStatus) => React.ReactNode;
}

function MemberTable({ 
  members, 
  isLoading, 
  onOpenPermissions, 
  onResendInvite, 
  onDelete,
  onUpdateRole,
  getRoleBadge, 
  getStatusBadge 
}: MemberTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4">
          <Users className="h-8 w-8 text-purple-400/50" />
        </div>
        <h3 className="text-base font-semibold mb-2">还没有团队成员</h3>
        <p className="text-muted-foreground text-sm text-center max-w-sm mb-4">
          邀请同事一起管理广告账户，您可以为每个成员分配不同的角色和账户权限。
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {/* @ts-ignore */}
          <TableHead>成员</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>邀请时间</TableHead>
          {/* @ts-ignore */}
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      {/* @ts-ignore */}
      <TableBody>
        {members.map((member: unknown) => (
          // @ts-ignore
          <TableRow key={member.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-medium">
                  {/* @ts-ignore */}
                  {(member.name || member.email)[0].toUpperCase()}
                // @ts-ignore
                </div>
                <div>
                  {/* @ts-ignore */}
                  {/* @ts-ignore */}
                  <div className="font-medium">{member.name || "未设置"}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    {/* @ts-ignore */}
                    <Mail className="h-3 w-3" />
                    {/* @ts-ignore */}
                    {member.email}
                  </div>
                </div>
              </div>
            </TableCell>
            {/* @ts-ignore */}
            <TableCell>{getRoleBadge(member.role)}</TableCell>
            {/* @ts-ignore */}
            <TableCell>{getStatusBadge(member.status)}</TableCell>
            <TableCell>
              {/* @ts-ignore */}
              {safeToLocaleDateString(member.createdAt, "zh-CN")}
            // @ts-ignore
            </TableCell>
            <TableCell className="text-right">
              {/* @ts-ignore */}
              {/* @ts-ignore */}
              {(member as Record<string, unknown>).isOwner || member.role === 'owner' ? (
                // @ts-ignore
                <span className="text-xs text-muted-foreground">账户所有者</span>
              // @ts-ignore
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* @ts-ignore */}
                    {/* @ts-ignore */}
                    <DropdownMenuItem onClick={() => onOpenPermissions(member.id)}>
                      <Key className="mr-2 h-4 w-4" />
                      设置权限
                    </DropdownMenuItem>
                    {/* @ts-ignore */}
                    <DropdownMenuItem onClick={() => onUpdateRole(member.id, member.role === "admin" ? "editor" : "admin")}>
                      <Shield className="mr-2 h-4 w-4" />
                      // @ts-ignore
                      {(member as any).role === "admin" ? "降为编辑" : "升为管理员"}
                    </DropdownMenuItem>
                    {/* @ts-ignore */}
                    {member.status === "pending" && (
                      // @ts-ignore
                      <DropdownMenuItem onClick={() => onResendInvite(member.id)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        重新发送邀请
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      className="text-red-500"
                      // @ts-ignore
                      onClick={() => onDelete(member.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      移除成员
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
