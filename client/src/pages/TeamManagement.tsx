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

type TeamMemberRole = "admin" | "editor" | "viewer";
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
    email: "",
    name: "",
    role: "viewer" as TeamMemberRole,
  });
  const [permissions, setPermissions] = useState<Permission[]>([]);

  // 获取团队成员列表
  const { data: members, isLoading, refetch } = trpc.team.list.useQuery();
  
  // 获取账号列表（用于权限分配）
  const { data: accounts } = trpc.adAccount.list.useQuery();

  // 邀请成员
  const inviteMutation = trpc.team.invite.useMutation({
    onSuccess: () => {
      toast.success("邀请已发送");
      setIsInviteOpen(false);
      setInviteForm({ email: "", name: "", role: "viewer" });
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "邀请失败");
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

  const handleInvite = () => {
    if (!inviteForm.email) {
      toast.error("请输入邮箱地址");
      return;
    }
    inviteMutation.mutate(inviteForm);
  };

  const handleOpenPermissions = (memberId: number) => {
    setSelectedMemberId(memberId);
    setIsPermissionOpen(true);
  };

  const handleSavePermissions = () => {
    if (!selectedMemberId) return;
    setPermissionsMutation.mutate({
      memberId: selectedMemberId,
      permissions,
    });
  };

  const getRoleBadge = (role: TeamMemberRole) => {
    const roleConfig = {
      admin: { label: "管理员", variant: "default" as const, className: "bg-purple-500" },
      editor: { label: "编辑", variant: "secondary" as const, className: "bg-blue-500" },
      viewer: { label: "只读", variant: "outline" as const, className: "" },
    };
    const config = roleConfig[role];
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getStatusBadge = (status: TeamMemberStatus) => {
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
  };

  // 统计数据
  const stats = {
    total: members?.length || 0,
    active: members?.filter(m => m.status === "active").length || 0,
    pending: members?.filter(m => m.status === "pending").length || 0,
    admins: members?.filter(m => m.role === "admin").length || 0,
  };

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
                邀请成员
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>邀请新成员</DialogTitle>
                <DialogDescription>
                  发送邀请邮件给新成员，他们可以通过邮件中的链接加入团队
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">邮箱地址 *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="member@example.com"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">成员名称</Label>
                  <Input
                    id="name"
                    placeholder="可选"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">角色</Label>
                  <Select
                    value={inviteForm.role}
                    onValueChange={(value: TeamMemberRole) => setInviteForm({ ...inviteForm, role: value })}
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
                  {inviteMutation.isPending ? "发送中..." : "发送邀请"}
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
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role })}
                  getRoleBadge={getRoleBadge}
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
              <TabsContent value="active" className="mt-4">
                <MemberTable 
                  members={(members || []).filter(m => m.status === "active")} 
                  isLoading={isLoading}
                  onOpenPermissions={handleOpenPermissions}
                  onResendInvite={(id) => resendMutation.mutate({ id })}
                  onDelete={(id) => deleteMutation.mutate({ id })}
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role })}
                  getRoleBadge={getRoleBadge}
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
              <TabsContent value="pending" className="mt-4">
                <MemberTable 
                  members={(members || []).filter(m => m.status === "pending")} 
                  isLoading={isLoading}
                  onOpenPermissions={handleOpenPermissions}
                  onResendInvite={(id) => resendMutation.mutate({ id })}
                  onDelete={(id) => deleteMutation.mutate({ id })}
                  onUpdateRole={(id, role) => updateMutation.mutate({ id, role })}
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
            <div className="space-y-4 py-4 max-h-96 overflow-y-auto">
              {accounts?.map((account) => {
                const existingPerm = permissions.find(p => p.accountId === account.id);
                return (
                  <div key={account.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={!!existingPerm}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setPermissions([...permissions, {
                              accountId: account.id,
                              permissionLevel: "view",
                            }]);
                          } else {
                            setPermissions(permissions.filter(p => p.accountId !== account.id));
                          }
                        }}
                      />
                      <div>
                        <div className="font-medium">{account.storeName || account.accountName}</div>
                        <div className="text-sm text-muted-foreground">{account.marketplace}</div>
                      </div>
                    </div>
                    {existingPerm && (
                      <Select
                        value={existingPerm.permissionLevel}
                        onValueChange={(value: "full" | "edit" | "view") => {
                          setPermissions(permissions.map(p => 
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
  members: any[];
  isLoading: boolean;
  onOpenPermissions: (id: number) => void;
  onResendInvite: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdateRole: (id: number, role: TeamMemberRole) => void;
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
      <div className="text-center py-8 text-muted-foreground">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无团队成员</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>成员</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>邀请时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-medium">
                  {(member.name || member.email)[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{member.name || "未设置"}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {member.email}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>{getRoleBadge(member.role)}</TableCell>
            <TableCell>{getStatusBadge(member.status)}</TableCell>
            <TableCell>
              {new Date(member.createdAt).toLocaleDateString("zh-CN")}
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpenPermissions(member.id)}>
                    <Key className="mr-2 h-4 w-4" />
                    设置权限
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onUpdateRole(member.id, member.role === "admin" ? "editor" : "admin")}>
                    <Shield className="mr-2 h-4 w-4" />
                    {member.role === "admin" ? "降为编辑" : "升为管理员"}
                  </DropdownMenuItem>
                  {member.status === "pending" && (
                    <DropdownMenuItem onClick={() => onResendInvite(member.id)}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      重新发送邀请
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-red-500"
                    onClick={() => onDelete(member.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    移除成员
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
