/**
 * 组织管理组件
 * 
 * 管理组织信息、成员、订阅计划
 */
import { safeToLocaleDateString } from "@/lib/safeDate";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, Users, CreditCard, Key, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function OrganizationManagement() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');

  // 获取组织信息
  const { data: org, isLoading: orgLoading } = trpc.multiTenant.getOrganization.useQuery();

  // 获取成员列表
  const { data: members, isLoading: membersLoading, refetch: refetchMembers } = 
    trpc.multiTenant.getMembers.useQuery();

  // 邀请成员
  const inviteMutation = trpc.multiTenant.inviteMember.useMutation({
    onSuccess: () => {
      toast.success("邀请已发送");
      setInviteEmail("");
      refetchMembers();
    },
    onError: (error) => {
      toast.error(`邀请失败: ${error.message}`);
    },
  });

  // 移除成员
  const removeMutation = trpc.multiTenant.removeMember.useMutation({
    onSuccess: () => {
      toast.success("成员已移除");
      refetchMembers();
    },
    onError: (error) => {
      toast.error(`移除失败: ${error.message}`);
    },
  });

  if (orgLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 组织信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            组织信息
          </CardTitle>
          <CardDescription>查看和管理组织基本信息</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>组织名称</Label>
              <Input value={org?.organization?.name || "我的组织"} disabled />
            </div>
            <div>
              <Label>组织标识</Label>
              <Input value={org?.organization?.slug || "my-org"} disabled />
            </div>
            <div>
              <Label>订阅计划</Label>
              <div className="flex items-center gap-2">
                <Badge variant="default">
                  {org?.organization?.subscriptionPlan || "免费版"}
                </Badge>
                <Button variant="outline" size="sm">
                  <CreditCard className="w-4 h-4 mr-2" />
                  升级
                </Button>
              </div>
            </div>
            <div>
              <Label>状态</Label>
              <Badge variant={org?.organization?.status === 'active' ? 'default' : 'secondary'}>
                {org?.organization?.status === 'active' ? '正常' : '试用中'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 成员管理 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                成员管理
              </CardTitle>
              <CardDescription>邀请和管理组织成员</CardDescription>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  邀请成员
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>邀请新成员</DialogTitle>
                  <DialogDescription>
                    输入邮箱地址邀请新成员加入组织
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>邮箱地址</Label>
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>角色</Label>
                    <Select value={inviteRole} onValueChange={(v: any) => setInviteRole(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">成员</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                    disabled={!inviteEmail || inviteMutation.isPending}
                  >
                    {inviteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    发送邀请
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>加入时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members && members.length > 0 ? (
                members.map((member: any) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{member.user.name}</div>
                        <div className="text-sm text-muted-foreground">{member.user.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                        {member.role === 'owner' ? '所有者' :
                         member.role === 'admin' ? '管理员' : '成员'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {safeToLocaleDateString(member.joinedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMutation.mutate({ memberId: member.id })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    暂无成员
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* API密钥管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            API密钥
          </CardTitle>
          <CardDescription>管理API访问密钥</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Key className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>API密钥管理功能即将上线</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
