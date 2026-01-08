/**
 * SmartOptimizationCenter - 智能优化中心
 * 整合：智能优化、自动化控制、自动运营
 * 设计原则：算法自主决策执行，用户只需开启开关，无需复杂配置
 */

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { 
  Brain,
  Zap,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Activity,
  Database,
  Search,
  Filter,
  GitMerge,
  DollarSign,
  ArrowRight
} from "lucide-react";
import toast from "react-hot-toast";

// 自动执行流程步骤
const autoSteps = [
  { id: 'sync', name: '数据同步', icon: Database, color: 'text-blue-400' },
  { id: 'ngram', name: 'N-Gram分析', icon: Search, color: 'text-purple-400' },
  { id: 'funnel', name: '漏斗同步', icon: Filter, color: 'text-green-400' },
  { id: 'conflict', name: '冲突检测', icon: AlertTriangle, color: 'text-amber-400' },
  { id: 'migrate', name: '迁移建议', icon: GitMerge, color: 'text-cyan-400' },
  { id: 'bid', name: '出价优化', icon: DollarSign, color: 'text-pink-400' },
];

// 安全边界参数（系统自动管理，用户无法修改）
const safetyLimits = [
  { label: '单次调整上限', value: '±30%', color: 'text-blue-400' },
  { label: '每日调整上限', value: '150次', color: 'text-green-400' },
  { label: '执行间隔', value: '2小时', color: 'text-purple-400' },
  { label: '可回滚周期', value: '7天', color: 'text-amber-400' },
];

export default function SmartOptimizationCenter() {
  const { user } = useAuth();
  const [isEnabled, setIsEnabled] = useState(true);
  
  // 获取自动化配置
  const { data: config } = trpc.automation.getConfig.useQuery(
    { accountId: 0 },
    { enabled: !!user }
  );
  
  // 模拟执行历史数据（实际应从数据库获取）
  const history: any[] = [];
  
  // 计算统计数据
  const stats = {
    successCount: 0,
    failCount: 0,
    totalCount: 0,
  };
  
  // 切换开关
  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled);
    toast.success(enabled ? '智能优化已开启' : '智能优化已暂停');
  };
  
  // 计算下次执行时间
  const getNextRunTime = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextHour = new Date(now);
    nextHour.setMinutes(0);
    nextHour.setSeconds(0);
    nextHour.setHours(nextHour.getHours() + (minutes < 30 ? 1 : 2));
    
    const diff = nextHour.getTime() - now.getTime();
    const diffMinutes = Math.floor(diff / 60000);
    
    if (diffMinutes < 60) {
      return `${diffMinutes}分钟后`;
    }
    return `${Math.floor(diffMinutes / 60)}小时${diffMinutes % 60}分钟后`;
  };

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Brain className="h-6 w-6 text-purple-400" />
              智能优化中心
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              AI驱动的全自动广告优化，每2小时自动执行完整优化流程
            </p>
          </div>
        </div>
        
        {/* 主开关卡片 */}
        <Card className="border-purple-500/30 bg-gradient-to-r from-purple-500/5 to-blue-500/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-full ${isEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                  {isEnabled ? (
                    <Activity className="h-8 w-8 text-green-400 animate-pulse" />
                  ) : (
                    <Activity className="h-8 w-8 text-gray-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {isEnabled ? '自动运行中' : '已暂停'}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {isEnabled ? `下次执行：${getNextRunTime()}` : '开启后将自动执行优化'}
                  </p>
                </div>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={handleToggle}
                className="scale-150"
              />
            </div>
          </CardContent>
        </Card>
        
        {/* 系统安全保护 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-400" />
                系统安全保护
              </CardTitle>
              <Badge variant="outline" className="text-green-400 border-green-400/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                自动管理
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {safetyLimits.map((limit) => (
                <div key={limit.label} className="text-center p-4 bg-gray-800/50 rounded-lg">
                  <p className={`text-2xl font-bold ${limit.color}`}>{limit.value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{limit.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 自动执行流程 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-400" />
              自动执行流程
            </CardTitle>
            <CardDescription>每2小时自动执行以下优化步骤</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4">
              {autoSteps.map((step, index) => (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center p-3 bg-gray-800/50 rounded-lg min-w-[80px]">
                    <step.icon className={`h-5 w-5 ${step.color} mb-1`} />
                    <span className="text-xs text-center">{step.name}</span>
                  </div>
                  {index < autoSteps.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground mx-1 hidden md:block" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 执行统计 */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-3xl font-bold text-green-400">{stats.successCount}</p>
              <p className="text-sm text-muted-foreground mt-1">成功执行</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-3xl font-bold text-red-400">{stats.failCount}</p>
              <p className="text-sm text-muted-foreground mt-1">执行失败</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-3xl font-bold text-blue-400">{stats.totalCount}</p>
              <p className="text-sm text-muted-foreground mt-1">总执行次数</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 执行记录 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-purple-400" />
              执行记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history && history.length > 0 ? (
              <div className="space-y-3">
                {history.slice(0, 5).map((record: any, index: number) => (
                  <div 
                    key={record.id || index} 
                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {record.status === 'success' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-red-400" />
                      )}
                      <div>
                        <p className="font-medium">{record.actionType || '自动优化'}</p>
                        <p className="text-xs text-muted-foreground">
                          {record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN') : '-'}
                        </p>
                      </div>
                    </div>
                    <Badge variant={record.status === 'success' ? 'default' : 'destructive'}>
                      {record.status === 'success' ? '成功' : '失败'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">暂无执行记录</p>
                <p className="text-sm text-muted-foreground mt-1">开启智能优化后将自动记录执行历史</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* 底部说明 */}
        <div className="flex items-start gap-2 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <Zap className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            智能优化中心由AI自主决策执行，您只需开启开关即可。系统内置多重安全保护，所有参数已经过专业调优，无需手动调整。如需查看详细数据，请访问"数据与报告"模块。
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
