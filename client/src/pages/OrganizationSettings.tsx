/**
 * 组织设置页面
 * 多租户管理、成员管理、订阅管理
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import {
  Loader2,
  Users,
  CreditCard,
  Key,
  TrendingUp,
  Mail,
  Shield,
  Eye,
  Edit,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

export default function OrganizationSettings() {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const queryClient = useQueryClient();

  // 获取组织信息
  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ['organization'],
    queryFn: () => trpc.multiTenant.getOrganization.query(),
  });

  // 获取使用统计
  const { data: usageData } = useQuery({
    queryKey: ['usageStats'],
    queryFn: () => trpc.multiTenant.getUsageStats.query({}),
  });

  // 获取成员列表
  const { data: members } = useQuery({
    queryKey: ['members'],
    queryFn: () => trpc.multiTenant.getMembers.query(),
  });

  // 获取API密钥
  const { data: apiKeys } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: () => trpc.multiTenant.getApiKeys.query(),
  });

  // 获取订阅计划
  const { data: plans } = useQuery({
    queryKey: ['subscriptionPlans'],
    queryFn: () => trpc.multiTenant.getSubscriptionPlans.query(),
  });

  // 邀请成员
  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; role: 'admin' | 'member' | 'viewer' }) =>
      trpc.multiTenant.inviteMember.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setInviteEmail('');
    },
  });

  // 创建API密钥
  const createApiKeyMutation = useMutation({
    mutationFn: (name: string) =>
      trpc.multiTenant.createApiKey.mutate({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      setNewApiKeyName('');
    },
  });

  // 撤销API密钥
  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: number) =>
      trpc.multiTenant.revokeApiKey.mutate({ keyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  const getRoleBadge = (role: string) => {
    const config = {
      owner: { label: '所有者', variant: 'default' as const, icon: Shield },
      admin: { label: '管理员', variant: 'default' as const, icon: Shield },
      member: { label: '成员', variant: 'secondary' as const, icon: Users },
      viewer: { label: '查看者', variant: 'outline' as const, icon: Eye },
    };

    const { label, variant, icon: Icon } = config[role as keyof typeof config] || config.member;
    return (
      <Badge variant={variant} className="flex items-center gap-1 w-fit">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">组织设置</h1>
          <p className="text-muted-foreground mt-2">
            管理组织信息、成员和订阅
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="members">成员管理</TabsTrigger>
          <TabsTrigger value="subscription">订阅计划</TabsTrigger>
          <TabsTrigger value="api-keys">API密钥</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value="overview" className="space-y-6">
          {/* 组织信息 */}
          <Card>
            <CardHeader>
              <CardTitle>组织信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>组织名称</Label>
                  <div className="text-lg font-semibold">{orgData?.organization.name}</div>
                </div>
                <div>
                  <Label>订阅计划</Label>
                  <div className="text-lg font-semibold capitalize">
                    {orgData?.organization.subscriptionPlan}
                  </div>
                </div>
                <div>
                  <Label>状态</Label>
                  <Badge variant={orgData?.organization.status === 'active' ? 'default' : 'secondary'}>
                    {orgData?.organization.status}
                  </Badge>
                </div>
                <div>
                  <Label>您的角色</Label>
                  {getRoleBadge(orgData?.userRole || 'member')}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 配额使用情况 */}
          <Card>
            <CardHeader>
              <CardTitle>配额使用情况</CardTitle>
              <CardDescription>查看当前配额使用和限制</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {usageData?.quotaUsage && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>API调用 (今日)</span>
                      <span>
                        {usageData.quotaUsage.apiCalls.used} / {usageData.quotaUsage.apiCalls.limit}
                      </span>
                    </div>
                    <Progress value={usageData.quotaUsage.apiCalls.percentage} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>广告活动</span>
                      <span>
                        {usageData.quotaUsage.campaigns.used} / {usageData.quotaUsage.campaigns.limit}
                      </span>
                    </div>
                    <Progress value={usageData.quotaUsage.campaigns.percentage} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>用户数</span>
                      <span>
                        {usageData.quotaUsage.users.used} / {usageData.quotaUsage.users.limit}
                      </span>
                    </div>
                    <Progress value={usageData.quotaUsage.users.percentage} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 使用统计 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                使用统计
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">总API调用</div>
                  <div className="text-2xl font-bold mt-1">
                    {usageData?.stats.totalApiCalls.toLocaleString()}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">活跃广告活动</div>
                  <div className="text-2xl font-bold mt-1">
                    {usageData?.stats.activeCampaigns}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">总花费</div>
                  <div className="text-2xl font-bold mt-1">
                    ${usageData?.stats.totalSpend.toLocaleString()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 成员管理 */}
        <TabsContent value="members" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>团队成员</CardTitle>
                  <CardDescription>管理组织成员和权限</CardDescription>
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      邀请成员
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>邀请新成员</DialogTitle>
                      <DialogDescription>
                        输入邮箱地址并选择角色
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">邮箱地址</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="user@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="role">角色</Label>
                        <Select value={inviteRole} onValueChange={(v: any) => setInviteRole(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">管理员</SelectItem>
                            <SelectItem value="member">成员</SelectItem>
                            <SelectItem value="viewer">查看者</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                        disabled={!inviteEmail || inviteMutation.isPending}
                      >
                        {inviteMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
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
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>加入时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members?.map((member: any) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell>{member.email}</TableCell>
                      <TableCell>{getRoleBadge(member.role)}</TableCell>
                      <TableCell>
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 订阅计划 */}
        <TabsContent value="subscription" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans?.map((plan: any) => (
              <Card key={plan.id} className={plan.slug === orgData?.organization.subscriptionPlan ? 'border-primary' : ''}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>
                    <div className="text-2xl font-bold">
                      ${plan.priceMonthly}
                      <span className="text-sm font-normal">/月</span>
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div>✓ {plan.maxUsers} 个用户</div>
                    <div>✓ {plan.maxAdAccounts} 个广告账户</div>
                    <div>✓ {plan.maxCampaigns} 个广告活动</div>
                    <div>✓ {plan.maxApiCallsPerDay.toLocaleString()} API调用/天</div>
                  </div>
                  <Button
                    className="w-full"
                    variant={plan.slug === orgData?.organization.subscriptionPlan ? 'outline' : 'default'}
                    disabled={plan.slug === orgData?.organization.subscriptionPlan}
                  >
                    {plan.slug === orgData?.organization.subscriptionPlan ? '当前计划' : '升级'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* API密钥 */}
        <TabsContent value="api-keys" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>API密钥</CardTitle>
                  <CardDescription>管理API访问密钥</CardDescription>
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      创建密钥
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>创建新API密钥</DialogTitle>
                      <DialogDescription>
                        为API密钥指定一个名称
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="keyName">密钥名称</Label>
                        <Input
                          id="keyName"
                          placeholder="Production API Key"
                          value={newApiKeyName}
                          onChange={(e) => setNewApiKeyName(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => createApiKeyMutation.mutate(newApiKeyName)}
                        disabled={!newApiKeyName || createApiKeyMutation.isPending}
                      >
                        {createApiKeyMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        创建
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
                    <TableHead>名称</TableHead>
                    <TableHead>密钥前缀</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys?.map((key: any) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-xs">{key.keyPrefix}...</code>
                      </TableCell>
                      <TableCell>
                        {new Date(key.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleDateString()
                          : '从未使用'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeApiKeyMutation.mutate(key.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
