import React, { useState } from 'react';
import { safeToLocaleString } from "@/lib/safeDate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface ApiAuthStatus {
  accountId: number;
  accountName: string;
  profileId: string;
  marketplace: string;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  daysUntilExpiry: number | null;
  lastRefreshAt: string | null;
  authScope: string[];
  status: 'active' | 'expired' | 'expiring_soon' | 'unknown';
  refreshUrl?: string;
}

export default function AmazonApiAuthStatus() {
  const [refreshing, setRefreshing] = useState<number | null>(null);

  // v378: 修复trpc调用方式 — 使用正确的react-query hooks
  const { data: summary, isLoading, refetch } = trpc.amazonApi.getAllAuthStatus.useQuery(
    undefined,
    { refetchInterval: 60000 }
  );

  // v378: 使用useMutation替代直接mutate调用
  const refreshTokenMutation = trpc.amazonApi.refreshToken.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleRefreshToken = async (accountId: number) => {
    setRefreshing(accountId);
    try {
      await refreshTokenMutation.mutateAsync({ accountId });
    } catch (error) {
      console.error('Failed to refresh token:', error);
    } finally {
      setRefreshing(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'expiring_soon':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'expired':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">已授权</Badge>;
      case 'expiring_soon':
        return <Badge className="bg-yellow-100 text-yellow-800">即将过期</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800">已过期</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">未知</Badge>;
    }
  };

  const getStatusDescription = (account: ApiAuthStatus): string => {
    if (account.tokenExpired) {
      return 'Token已过期，需要重新授权';
    }
    if (account.daysUntilExpiry !== null && account.daysUntilExpiry <= 7) {
      return `Token将在${account.daysUntilExpiry}天后过期`;
    }
    if (account.daysUntilExpiry !== null) {
      return `Token有效期${account.daysUntilExpiry}天`;
    }
    return '授权状态未知';
  };

  const safeSummary = summary as any;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">加载授权状态中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Amazon API授权管理</h1>
        <p className="text-gray-600 mt-2">监控和管理所有广告账号的API授权状态</p>
      </div>

      {/* 状态概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">总账号数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeSummary?.totalAccounts || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-green-600">已授权</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{safeSummary?.activeAccounts || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-yellow-600">即将过期</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{safeSummary?.expiringAccounts || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-red-600">已过期</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{safeSummary?.expiredAccounts || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* 警告信息 */}
      {safeSummary && safeSummary.expiredAccounts > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            有{safeSummary.expiredAccounts}个账号的API Token已过期，请立即重新授权以恢复数据同步功能
          </AlertDescription>
        </Alert>
      )}

      {safeSummary && safeSummary.expiringAccounts > 0 && (
        <Alert className="border-yellow-200 bg-yellow-50">
          <Clock className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            有{safeSummary.expiringAccounts}个账号的API Token即将过期，建议提前重新授权
          </AlertDescription>
        </Alert>
      )}

      {/* 账号列表 */}
      <Card>
        <CardHeader>
          <CardTitle>账号授权状态</CardTitle>
          <CardDescription>显示所有广告账号的API授权状态和过期时间</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {safeSummary?.accounts && safeSummary.accounts.length > 0 ? (
              safeSummary.accounts.map((account: any) => (
                <div
                  key={account.accountId}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50/5 transition"
                >
                  <div className="flex items-center gap-4 flex-1">
                    {getStatusIcon(account.status)}
                    <div className="flex-1">
                      <div className="font-semibold">{account.accountName}</div>
                      <div className="text-sm text-gray-600">
                        Profile ID: {account.profileId} | Marketplace: {account.marketplace}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {getStatusDescription(account)}
                      </div>
                      {account.tokenExpiresAt && (
                        <div className="text-xs text-gray-500 mt-1">
                          过期时间: {safeToLocaleString(account.tokenExpiresAt, 'zh-CN')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(account.status)}
                    {(account.status === 'expired' || account.status === 'expiring_soon') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefreshToken(account.accountId)}
                        disabled={refreshing === account.accountId}
                      >
                        {refreshing === account.accountId ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            刷新中...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            重新授权
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-600">
                <p>暂无账号授权信息</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 授权范围说明 */}
      <Card>
        <CardHeader>
          <CardTitle>授权范围说明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-semibold">已授权：</span>
              <span className="text-gray-600">Token有效且在7天以上，数据同步正常</span>
            </div>
            <div>
              <span className="font-semibold">即将过期：</span>
              <span className="text-gray-600">Token有效期在7天以内，建议提前重新授权</span>
            </div>
            <div>
              <span className="font-semibold">已过期：</span>
              <span className="text-gray-600">Token已过期，需要立即重新授权以恢复功能</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
