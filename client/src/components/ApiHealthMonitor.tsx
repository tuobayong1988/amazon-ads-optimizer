/**
 * ApiHealthMonitor - API连接状态实时监控组件
 * 检测Token过期并提醒用户重新授权
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  Clock,
  Shield,
  Loader2
} from "lucide-react";

interface ApiHealthMonitorProps {
  accountId?: number;
  showCard?: boolean;
  onReauthNeeded?: () => void;
}

export function ApiHealthMonitor({ accountId, showCard = false, onReauthNeeded }: ApiHealthMonitorProps) {
  const [isChecking, setIsChecking] = useState(false);

  // 检查单个账号的Token健康状态
  const { data: healthStatus, refetch: refetchHealth, isLoading } = trpc.amazonApi.checkTokenHealth.useQuery(
    { accountId: accountId! },
    { 
      enabled: !!accountId,
      refetchInterval: 5 * 60 * 1000, // 每5分钟自动检查一次
      staleTime: 4 * 60 * 1000,
    }
  );

  // 检查所有账号的Token健康状态
  const { data: allHealthStatus, refetch: refetchAllHealth } = trpc.amazonApi.checkAllTokensHealth.useQuery(
    undefined,
    {
      enabled: !accountId, // 只在没有指定accountId时检查所有账号
      refetchInterval: 10 * 60 * 1000, // 每10分钟自动检查一次
      staleTime: 9 * 60 * 1000,
    }
  );

  // 当检测到Token过期时显示提醒
  useEffect(() => {
    if (healthStatus?.needsReauth) {
      toast.error("API Token已过期", {
        description: "请重新授权Amazon API以继续同步数据",
        action: {
          label: "重新授权",
          onClick: () => window.location.href = '/amazon-api'
        },
        duration: 10000,
      });
      onReauthNeeded?.();
    }
  }, [healthStatus?.needsReauth, onReauthNeeded]);

  // 当检测到任何账号有问题时显示提醒
  useEffect(() => {
    if (allHealthStatus?.hasIssues) {
      const expiredCount = allHealthStatus.summary.expired;
      if (expiredCount > 0) {
        toast.warning(`${expiredCount}个账号Token已过期`, {
          description: "请前往Amazon API设置页面重新授权",
          action: {
            label: "查看详情",
            onClick: () => window.location.href = '/amazon-api'
          },
          duration: 10000,
        });
      }
    }
  }, [allHealthStatus?.hasIssues]);

  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      if (accountId) {
        await refetchHealth();
      } else {
        await refetchAllHealth();
      }
      toast.success("健康检查完成");
    } catch (error) {
      toast.error("检查失败");
    } finally {
      setIsChecking(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'expired':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'not_configured':
        return <Shield className="w-5 h-5 text-gray-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500">正常</Badge>;
      case 'expired':
        return <Badge variant="destructive">已过期</Badge>;
      case 'error':
        return <Badge className="bg-yellow-500">错误</Badge>;
      case 'not_configured':
        return <Badge variant="secondary">未配置</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // 如果指定了accountId，显示单账号状态
  if (accountId) {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>检查连接状态...</span>
        </div>
      );
    }

    if (!healthStatus) return null;

    // 简洁的内联状态显示
    if (!showCard) {
      if (healthStatus.isHealthy) {
        return (
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">API连接正常</span>
            {healthStatus.syncWarning && (
              <Badge variant="outline" className="text-yellow-500 border-yellow-500">
                {healthStatus.daysSinceSync}天未同步
              </Badge>
            )}
          </div>
        );
      }

      return (
        <Alert variant={healthStatus.status === 'expired' ? 'destructive' : 'default'} className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {healthStatus.status === 'expired' ? 'Token已过期' : 'API连接异常'}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{healthStatus.message}</span>
            {healthStatus.needsReauth && (
              <Button size="sm" variant="outline" onClick={() => window.location.href = '/amazon-api'}>
                <ExternalLink className="w-4 h-4 mr-2" />
                重新授权
              </Button>
            )}
          </AlertDescription>
        </Alert>
      );
    }

    // 卡片形式的详细状态显示
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {getStatusIcon(healthStatus.status)}
              API连接状态
            </CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleManualCheck}
              disabled={isChecking}
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>{healthStatus.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">状态</span>
            {getStatusBadge(healthStatus.status)}
          </div>
          {healthStatus.region && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">区域</span>
              <span className="text-sm">{healthStatus.region}</span>
            </div>
          )}
          {healthStatus.lastSyncAt && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">上次同步</span>
              <span className="text-sm">
                {new Date(healthStatus.lastSyncAt).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
          {healthStatus.needsReauth && (
            <Button className="w-full" onClick={() => window.location.href = '/amazon-api'}>
              <ExternalLink className="w-4 h-4 mr-2" />
              重新授权
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // 显示所有账号的状态概览
  if (!allHealthStatus) return null;

  if (!showCard) {
    // 简洁的状态提示
    if (allHealthStatus.hasIssues) {
      return (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>API连接异常</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {allHealthStatus.summary.expired > 0 && `${allHealthStatus.summary.expired}个账号Token已过期`}
              {allHealthStatus.summary.error > 0 && ` ${allHealthStatus.summary.error}个账号连接错误`}
            </span>
            <Button size="sm" variant="outline" onClick={() => window.location.href = '/amazon-api'}>
              <ExternalLink className="w-4 h-4 mr-2" />
              查看详情
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    return null;
  }

  // 卡片形式的所有账号状态
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">API连接状态概览</CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleManualCheck}
            disabled={isChecking}
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <CardDescription>
          共 {allHealthStatus.summary.total} 个账号
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm">{allHealthStatus.summary.healthy} 正常</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm">{allHealthStatus.summary.expired} 已过期</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-sm">{allHealthStatus.summary.error} 错误</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-500" />
            <span className="text-sm">{allHealthStatus.summary.notConfigured} 未配置</span>
          </div>
        </div>

        {allHealthStatus.accounts.filter(a => !a.isHealthy).length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">需要处理的账号：</p>
            {allHealthStatus.accounts.filter(a => !a.isHealthy).map(account => (
              <div key={account.accountId} className="flex items-center justify-between text-sm">
                <span>{account.accountName}</span>
                {getStatusBadge(account.status)}
              </div>
            ))}
          </div>
        )}

        {allHealthStatus.hasIssues && (
          <Button className="w-full" onClick={() => window.location.href = '/amazon-api'}>
            <ExternalLink className="w-4 h-4 mr-2" />
            前往处理
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// 用于在页面顶部显示的简洁提醒条
export function ApiHealthBanner() {
  const { data: allHealthStatus } = trpc.amazonApi.checkAllTokensHealth.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000,
    staleTime: 9 * 60 * 1000,
  });

  if (!allHealthStatus?.hasIssues) return null;

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2">
      <div className="container flex items-center justify-between">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">
            {allHealthStatus.summary.expired > 0 
              ? `${allHealthStatus.summary.expired}个账号的API Token已过期，请重新授权`
              : `${allHealthStatus.summary.error}个账号API连接异常`
            }
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.location.href = '/amazon-api'}>
          立即处理
        </Button>
      </div>
    </div>
  );
}

export default ApiHealthMonitor;
