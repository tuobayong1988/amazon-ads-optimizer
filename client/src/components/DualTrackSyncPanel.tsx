/**
 * 双轨制数据同步状态监控面板
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  Database, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  RefreshCw,
  Clock,
  BarChart3,
  Shield,
  ArrowRightLeft
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface DualTrackSyncPanelProps {
  accountId: number;
}

export function DualTrackSyncPanel({ accountId }: DualTrackSyncPanelProps) {
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  
  const { data: dualTrackStatus, isLoading: isLoadingStatus, refetch: refetchStatus } = 
    trpc.amazonApi.getDualTrackStatus.useQuery({ accountId });
  
  const { data: dataSourceStats, isLoading: isLoadingStats, refetch: refetchStats } = 
    trpc.amazonApi.getDataSourceStats.useQuery({ accountId });
  
  const consistencyCheckMutation = trpc.amazonApi.runConsistencyCheck.useMutation({
    onSuccess: () => {
      refetchStatus();
      refetchStats();
    },
  });
  
  const handleConsistencyCheck = async () => {
    setIsCheckingConsistency(true);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    try {
      await consistencyCheckMutation.mutateAsync({
        accountId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
    } finally {
      setIsCheckingConsistency(false);
    }
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'degraded':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30">健康</Badge>;
      case 'degraded':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">降级</Badge>;
      case 'error':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">异常</Badge>;
      default:
        return <Badge variant="outline">未知</Badge>;
    }
  };
  
  const formatDateTime = (date: Date | string | null) => {
    if (!date) return '从未';
    return format(new Date(date), 'MM/dd HH:mm', { locale: zhCN });
  };

  if (isLoadingStatus || isLoadingStats) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">加载同步状态...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 整体状态概览 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">双轨制数据同步</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(dualTrackStatus?.overallHealth || 'unknown')}
              {getStatusBadge(dualTrackStatus?.overallHealth || 'unknown')}
            </div>
          </div>
          <CardDescription>
            同时使用传统报表API和Amazon Marketing Stream实时数据流，确保数据完整性和时效性
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 传统API状态 */}
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  <span className="font-medium">传统报表API</span>
                </div>
                {getStatusBadge(dualTrackStatus?.api?.status || 'unknown')}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最后同步</span>
                  <span>{formatDateTime(dualTrackStatus?.api?.lastSyncAt ?? null)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">记录数</span>
                  <span>{dataSourceStats?.api?.records?.toLocaleString() || 0}</span>
                </div>
                {dualTrackStatus?.api?.errorMessage && (
                  <div className="text-xs text-yellow-500 mt-2">
                    {dualTrackStatus.api.errorMessage}
                  </div>
                )}
              </div>
            </div>
            
            {/* AMS实时流状态 */}
            <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-500" />
                  <span className="font-medium">AMS实时数据流</span>
                </div>
                {getStatusBadge(dualTrackStatus?.ams?.status || 'unknown')}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最后消息</span>
                  <span>{formatDateTime(dualTrackStatus?.ams?.lastSyncAt ?? null)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">24h消息数</span>
                  <span>{dualTrackStatus?.ams?.recordCount?.toLocaleString() || 0}</span>
                </div>
                {dualTrackStatus?.ams?.errorMessage && (
                  <div className="text-xs text-yellow-500 mt-2">
                    {dualTrackStatus.ams.errorMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* 数据源统计 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">数据源分布</CardTitle>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => { refetchStatus(); refetchStats(); }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* API数据 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>传统API数据</span>
                </div>
                <span className="font-medium">{dataSourceStats?.api?.records?.toLocaleString() || 0} 条</span>
              </div>
              <Progress 
                value={100} 
                className="h-2 bg-blue-500/20"
              />
            </div>
            
            {/* AMS数据 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span>AMS实时数据</span>
                </div>
                <span className="font-medium">{dataSourceStats?.ams?.records?.toLocaleString() || 0} 条</span>
              </div>
              <Progress 
                value={0} 
                className="h-2 bg-purple-500/20"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* 数据一致性检查 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">数据一致性检查</CardTitle>
            </div>
            <Button 
              variant="default" 
              size="sm"
              onClick={handleConsistencyCheck}
              disabled={isCheckingConsistency}
            >
              {isCheckingConsistency ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  检查中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  执行检查
                </>
              )}
            </Button>
          </div>
          <CardDescription>
            对比传统API和AMS数据，检测并修复数据差异
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3 mb-3">
              <Clock className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">最后检查时间</div>
                <div className="text-xs text-muted-foreground">
                  {dualTrackStatus?.lastConsistencyCheck 
                    ? formatDateTime(dualTrackStatus.lastConsistencyCheck)
                    : '尚未执行过一致性检查'}
                </div>
              </div>
            </div>
            
            <div className="text-sm text-muted-foreground">
              <p>一致性检查将对比最近7天的数据，检测以下差异：</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>展示量、点击量差异超过5%</li>
                <li>花费、销售额差异超过5%</li>
                <li>订单数差异</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* 同步策略说明 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" />
            双轨制同步策略
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="realtime">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="realtime">实时展示</TabsTrigger>
              <TabsTrigger value="historical">历史分析</TabsTrigger>
              <TabsTrigger value="reporting">报表导出</TabsTrigger>
            </TabsList>
            
            <TabsContent value="realtime" className="mt-4">
              <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-5 h-5 text-purple-500" />
                  <span className="font-medium">优先使用 AMS 实时数据</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Dashboard和实时监控优先使用AMS数据，延迟低（分钟级），适合实时决策。
                  当AMS数据不可用时，自动回退到传统API数据。
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="historical" className="mt-4">
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  <span className="font-medium">优先使用传统API数据</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  历史趋势分析和绩效对比优先使用传统API数据，准确性高，经过Amazon归因窗口完整处理。
                  适合周期性分析和策略制定。
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="reporting" className="mt-4">
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="font-medium">使用合并校验数据</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  报表导出使用经过一致性检查和修复的合并数据，确保数据完整性和准确性。
                  两种数据源互相校验，自动修复差异。
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default DualTrackSyncPanel;
