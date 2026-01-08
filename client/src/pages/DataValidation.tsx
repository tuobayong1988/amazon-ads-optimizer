import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Database,
  Shield,
  ArrowRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  FileWarning
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { format } from "date-fns";

type ValidationStatus = 'idle' | 'validating' | 'completed' | 'error';

interface ValidationResult {
  entityType: string;
  localCount: number;
  remoteCount: number;
  difference: number;
  status: 'match' | 'mismatch' | 'error';
  lastValidated?: Date;
}

export default function DataValidation() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle');
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // 获取用户的所有账户
  const { data: accounts } = trpc.adAccount.list.useQuery(
    undefined,
    { enabled: !!user?.id }
  );

  // 获取本地数据统计
  const { data: localStats, refetch: refetchLocalStats } = trpc.amazonApi.getLocalDataStats.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 数据校验mutation
  const validateDataMutation = trpc.amazonApi.validateData.useMutation({
    onSuccess: (data) => {
      setValidationStatus('completed');
      if (data.results) {
        setValidationResults(data.results.map((r: any) => ({
          entityType: r.entityType,
          localCount: r.localCount,
          remoteCount: r.remoteCount,
          difference: r.remoteCount - r.localCount,
          status: r.localCount === r.remoteCount ? 'match' : 'mismatch',
          lastValidated: new Date(),
        })));
      }
    },
    onError: (error) => {
      setValidationStatus('error');
      setValidationError(error.message);
    },
  });

  // 执行数据校验
  const handleValidate = async () => {
    if (!selectedAccountId) return;
    
    setValidationStatus('validating');
    setValidationError(null);
    setValidationResults([]);
    
    try {
      await validateDataMutation.mutateAsync({ accountId: selectedAccountId });
    } catch (error) {
      // Error handled in onError callback
    }
  };

  // 计算校验统计
  const validationStats = useMemo(() => {
    if (!validationResults.length) return null;
    
    const matchCount = validationResults.filter(r => r.status === 'match').length;
    const mismatchCount = validationResults.filter(r => r.status === 'mismatch').length;
    const errorCount = validationResults.filter(r => r.status === 'error').length;
    const totalDifference = validationResults.reduce((sum, r) => sum + Math.abs(r.difference), 0);
    
    return { matchCount, mismatchCount, errorCount, totalDifference };
  }, [validationResults]);

  // 获取差异状态的图标和颜色
  const getDifferenceDisplay = (difference: number) => {
    if (difference === 0) {
      return {
        icon: <Minus className="w-4 h-4" />,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted/50',
      };
    } else if (difference > 0) {
      return {
        icon: <TrendingUp className="w-4 h-4" />,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/10',
      };
    } else {
      return {
        icon: <TrendingDown className="w-4 h-4" />,
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
      };
    }
  };

  // 获取实体类型的中文名称
  const getEntityTypeName = (type: string) => {
    const typeMap: Record<string, string> = {
      spCampaigns: 'SP广告活动',
      sbCampaigns: 'SB广告活动',
      sdCampaigns: 'SD广告活动',
      adGroups: '广告组',
      keywords: '关键词',
      productTargets: '商品定位',
      negativeKeywords: '否定关键词',
    };
    return typeMap[type] || type;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6" />
              数据校验
            </h1>
            <p className="text-muted-foreground mt-1">
              对比本地数据与亚马逊后台数据，自动发现差异
            </p>
          </div>
          <Button 
            onClick={handleValidate} 
            disabled={!selectedAccountId || validationStatus === 'validating'}
          >
            {validationStatus === 'validating' ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                校验中...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                开始校验
              </>
            )}
          </Button>
        </div>

        {/* 账户选择和本地数据统计 */}
        <div className="grid lg:grid-cols-2 gap-4">
          {/* 账户选择 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">选择账户</CardTitle>
              <CardDescription>选择要校验数据的账户</CardDescription>
            </CardHeader>
            <CardContent>
              <Select 
                value={selectedAccountId?.toString() || ''} 
                onValueChange={(value) => {
                  setSelectedAccountId(parseInt(value));
                  setValidationStatus('idle');
                  setValidationResults([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择账户" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id.toString()}>
                      {account.accountName} ({account.marketplace})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* 本地数据统计 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="w-4 h-4" />
                本地数据统计
              </CardTitle>
              <CardDescription>当前账户在本地数据库中的数据量</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedAccountId ? (
                <p className="text-sm text-muted-foreground">请先选择账户</p>
              ) : !localStats ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : (
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">广告活动</p>
                    <p className="text-lg font-semibold">
                      {(localStats.spCampaigns || 0) + (localStats.sbCampaigns || 0) + (localStats.sdCampaigns || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">广告组</p>
                    <p className="text-lg font-semibold">{localStats.adGroups || 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">关键词</p>
                    <p className="text-lg font-semibold">{localStats.keywords || 0}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 校验进度 */}
        {validationStatus === 'validating' && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center gap-4">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <div className="flex-1">
                  <p className="font-medium">正在校验数据...</p>
                  <p className="text-sm text-muted-foreground">正在从亚马逊API获取最新数据并与本地数据对比</p>
                  <Progress value={50} className="mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 校验错误 */}
        {validationStatus === 'error' && validationError && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-red-500" />
                <div>
                  <p className="font-medium text-red-500">校验失败</p>
                  <p className="text-sm text-muted-foreground">{validationError}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 校验结果统计 */}
        {validationStatus === 'completed' && validationStats && (
          <div className="grid lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-green-500/10 to-transparent border-green-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/20">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{validationStats.matchCount}</p>
                    <p className="text-xs text-muted-foreground">数据一致</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/20">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{validationStats.mismatchCount}</p>
                    <p className="text-xs text-muted-foreground">数据不一致</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/20">
                    <XCircle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{validationStats.errorCount}</p>
                    <p className="text-xs text-muted-foreground">校验错误</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <FileWarning className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{validationStats.totalDifference}</p>
                    <p className="text-xs text-muted-foreground">总差异数</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 校验结果详情 */}
        {validationStatus === 'completed' && validationResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">校验结果详情</CardTitle>
              <CardDescription>
                校验时间: {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {validationResults.map((result, index) => {
                  const diffDisplay = getDifferenceDisplay(result.difference);
                  return (
                    <div 
                      key={index}
                      className={`p-4 rounded-lg border ${
                        result.status === 'match' 
                          ? 'bg-green-500/5 border-green-500/20' 
                          : result.status === 'error'
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-yellow-500/5 border-yellow-500/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {result.status === 'match' ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : result.status === 'error' ? (
                            <XCircle className="w-5 h-5 text-red-500" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                          )}
                          <div>
                            <p className="font-medium">{getEntityTypeName(result.entityType)}</p>
                            <p className="text-sm text-muted-foreground">
                              {result.status === 'match' ? '数据一致' : 
                               result.status === 'error' ? '校验失败' : '数据不一致'}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">本地数据</p>
                            <p className="text-lg font-semibold">{result.localCount}</p>
                          </div>
                          
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">远程数据</p>
                            <p className="text-lg font-semibold">{result.remoteCount}</p>
                          </div>
                          
                          <div className={`px-3 py-1 rounded-full ${diffDisplay.bgColor}`}>
                            <span className={`flex items-center gap-1 text-sm font-medium ${diffDisplay.color}`}>
                              {diffDisplay.icon}
                              {result.difference > 0 ? '+' : ''}{result.difference}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 修复建议 */}
              {validationStats && validationStats.mismatchCount > 0 && (
                <div className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <h4 className="font-medium flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-blue-500" />
                    修复建议
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    检测到本地数据与亚马逊后台数据存在差异，建议执行以下操作：
                  </p>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• 前往「设置 → API设置」页面重新同步数据</li>
                    <li>• 如果差异持续存在，请检查API权限是否完整</li>
                    <li>• 某些数据可能因为状态变更（如归档）而产生差异</li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 空状态 */}
        {validationStatus === 'idle' && !selectedAccountId && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">请选择账户开始校验</p>
                <p className="text-sm mt-1">选择一个账户后，点击"开始校验"按钮对比本地与远程数据</p>
              </div>
            </CardContent>
          </Card>
        )}

        {validationStatus === 'idle' && selectedAccountId && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">准备就绪</p>
                <p className="text-sm mt-1">点击"开始校验"按钮，对比本地数据与亚马逊后台数据</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
