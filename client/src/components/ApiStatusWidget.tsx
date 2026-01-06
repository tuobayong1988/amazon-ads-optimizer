/**
 * ApiStatusWidget - API连接状态小组件
 * 在仪表盘显示Amazon API连接健康状态
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  Cloud,
  CloudOff,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Clock,
  Loader2
} from "lucide-react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

interface ApiStatusWidgetProps {
  className?: string;
  compact?: boolean;
}

export default function ApiStatusWidget({ className = "", compact = false }: ApiStatusWidgetProps) {
  const [, setLocation] = useLocation();
  
  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const firstAccountId = accounts?.[0]?.id;

  // 获取API健康状态
  const { data: healthStatus, isLoading, refetch, isRefetching } = trpc.amazonApi.checkTokenHealth.useQuery(
    { accountId: firstAccountId! },
    { 
      enabled: !!firstAccountId,
      refetchInterval: 60000, // 每分钟刷新一次
      staleTime: 30000 
    }
  );

  // 获取最近同步时间
  const { data: syncJobs } = trpc.dataSync.getJobs.useQuery(
    { accountId: firstAccountId!, limit: 1 },
    { 
      enabled: !!firstAccountId,
      staleTime: 30000 
    }
  );

  const lastSyncTime = syncJobs?.jobs?.[0]?.completedAt;

  // 确定状态
  const getStatusInfo = () => {
    if (!healthStatus) {
      return {
        status: "unknown",
        label: "未知",
        color: "bg-gray-500",
        icon: <Cloud className="w-4 h-4" />,
        message: "无法获取API状态"
      };
    }

    if (healthStatus.status === "healthy") {
      return {
        status: "healthy",
        label: "正常",
        color: "bg-green-500",
        icon: <CheckCircle2 className="w-4 h-4" />,
        message: healthStatus.syncWarning ? `API正常，但已${healthStatus.daysSinceSync}天未同步` : "API连接正常"
      };
    }

    if (healthStatus.status === "expired") {
      return {
        status: "error",
        label: "已过期",
        color: "bg-red-500",
        icon: <CloudOff className="w-4 h-4" />,
        message: "Token已过期，请重新授权"
      };
    }

    if (healthStatus.status === "error") {
      return {
        status: "error",
        label: "连接错误",
        color: "bg-red-500",
        icon: <CloudOff className="w-4 h-4" />,
        message: healthStatus.message || "API连接异常"
      };
    }

    if (healthStatus.status === "not_configured") {
      return {
        status: "disconnected",
        label: "未配置",
        color: "bg-gray-500",
        icon: <CloudOff className="w-4 h-4" />,
        message: "尚未配置Amazon API凭证"
      };
    }

    return {
      status: "disconnected",
      label: "未连接",
      color: "bg-gray-500",
      icon: <CloudOff className="w-4 h-4" />,
      message: "尚未连接Amazon API"
    };
  };

  const statusInfo = getStatusInfo();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div 
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${className}`}
        onClick={() => setLocation("/amazon-api")}
      >
        <div className={`w-2 h-2 rounded-full ${statusInfo.color}`} />
        <span className="text-sm font-medium">API</span>
        <Badge variant={statusInfo.status === "healthy" ? "default" : statusInfo.status === "warning" ? "secondary" : "destructive"} className="text-xs">
          {statusInfo.label}
        </Badge>
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${
              statusInfo.status === "healthy" ? "bg-green-100 dark:bg-green-900/30" :
              statusInfo.status === "warning" ? "bg-yellow-100 dark:bg-yellow-900/30" :
              statusInfo.status === "error" ? "bg-red-100 dark:bg-red-900/30" :
              "bg-gray-100 dark:bg-gray-800"
            }`}>
              <div className={
                statusInfo.status === "healthy" ? "text-green-600 dark:text-green-400" :
                statusInfo.status === "warning" ? "text-yellow-600 dark:text-yellow-400" :
                statusInfo.status === "error" ? "text-red-600 dark:text-red-400" :
                "text-gray-600 dark:text-gray-400"
              }>
                {statusInfo.icon}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Amazon API</span>
                <Badge 
                  variant={
                    statusInfo.status === "healthy" ? "default" : 
                    statusInfo.status === "warning" ? "secondary" : 
                    "destructive"
                  }
                  className="text-xs"
                >
                  {statusInfo.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {statusInfo.message}
              </p>
            </div>
          </div>
          
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            {isRefetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* 最近同步时间 */}
        {lastSyncTime && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t text-sm text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>
              最近同步: {formatDistanceToNow(new Date(lastSyncTime), { addSuffix: true, locale: zhCN })}
            </span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 mt-3">
          {(statusInfo.status === "error" || statusInfo.status === "disconnected") && (
            <Button 
              size="sm" 
              className="flex-1"
              onClick={() => setLocation("/amazon-api")}
            >
              {statusInfo.status === "error" ? "重新授权" : "连接API"}
            </Button>
          )}
          {statusInfo.status === "warning" && (
            <Button 
              size="sm" 
              variant="outline"
              className="flex-1"
              onClick={() => setLocation("/amazon-api")}
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              刷新Token
            </Button>
          )}
          <Button 
            size="sm" 
            variant="ghost"
            onClick={() => setLocation("/amazon-api")}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            详情
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
