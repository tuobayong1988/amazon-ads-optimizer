import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { 
  FileSearch, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Target,
  BarChart3,
  ArrowRight,
  Info,
  Lightbulb,
  RefreshCw
} from "lucide-react";

type SessionStatus = 'analyzing' | 'ready_for_review' | 'reviewed' | 'corrections_applied';
type CorrectionType = 'over_decreased' | 'over_increased' | 'correct';

const statusConfig: Record<SessionStatus, { label: string; color: string; icon: React.ReactNode }> = {
  analyzing: { label: '分析中', color: 'bg-blue-500', icon: <RefreshCw className="h-4 w-4 animate-spin" /> },
  ready_for_review: { label: '待复盘', color: 'bg-yellow-500', icon: <FileSearch className="h-4 w-4" /> },
  reviewed: { label: '已复盘', color: 'bg-green-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  corrections_applied: { label: '已纠正', color: 'bg-purple-500', icon: <Target className="h-4 w-4" /> },
};

const correctionTypeConfig: Record<CorrectionType, { label: string; color: string; icon: React.ReactNode }> = {
  over_decreased: { label: '过度降价', color: 'text-red-600 bg-red-50', icon: <TrendingDown className="h-4 w-4" /> },
  over_increased: { label: '过度加价', color: 'text-orange-600 bg-orange-50', icon: <TrendingUp className="h-4 w-4" /> },
  correct: { label: '正确', color: 'text-green-600 bg-green-50', icon: <CheckCircle2 className="h-4 w-4" /> },
};

export default function CorrectionReview() {
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [selectedCorrections, setSelectedCorrections] = useState<number[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [periodDays, setPeriodDays] = useState("14");

  const { data: adAccounts } = trpc.adAccount.list.useQuery();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = trpc.correction.listSessions.useQuery({
    accountId: selectedAccountId || undefined,
  });

  const { data: sessionDetails } = trpc.correction.getSession.useQuery(
    { id: selectedSession! },
    { enabled: !!selectedSession }
  );

  const { data: corrections, refetch: refetchCorrections } = trpc.correction.getCorrections.useQuery(
    { sessionId: selectedSession! },
    { enabled: !!selectedSession }
  );

  const { data: recommendations } = trpc.correction.getRecommendations.useQuery(
    { sessionId: selectedSession! },
    { enabled: !!selectedSession }
  );

  const createSessionMutation = trpc.correction.createSession.useMutation({
    onSuccess: (result) => {
      toast.success(`纠错复盘会话已创建`);
      setIsCreateDialogOpen(false);
      setSelectedSession(result.sessionId);
      refetchSessions();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const analyzeSessionMutation = trpc.correction.analyzeSession.useMutation({
    onSuccess: (report) => {
      toast.success(`分析完成: 发现 ${report.incorrectAdjustments} 个错误调价`);
      refetchSessions();
      refetchCorrections();
    },
    onError: (error) => {
      toast.error(`分析失败: ${error.message}`);
    },
  });

  const applyCorrectionsMutation = trpc.correction.applyCorrections.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建纠错批量操作: ${result.itemCount} 个出价调整`);
      setSelectedCorrections([]);
      refetchSessions();
      refetchCorrections();
    },
    onError: (error) => {
      toast.error(`应用纠错失败: ${error.message}`);
    },
  });

  const dismissCorrectionsMutation = trpc.correction.dismissCorrections.useMutation({
    onSuccess: () => {
      toast.success("已忽略选中的纠错建议");
      setSelectedCorrections([]);
      refetchCorrections();
    },
    onError: (error) => {
      toast.error(`操作失败: ${error.message}`);
    },
  });

  const handleCreateSession = () => {
    if (!selectedAccountId) {
      toast.error("请选择广告账户");
      return;
    }
    createSessionMutation.mutate({
      accountId: selectedAccountId,
      periodDays: parseInt(periodDays),
    });
  };

  const handleToggleCorrection = (id: number) => {
    setSelectedCorrections(prev => 
      prev.includes(id) 
        ? prev.filter(c => c !== id)
        : [...prev, id]
    );
  };

  const handleSelectAllCorrections = () => {
    if (!corrections) return;
    const incorrectIds = corrections
      .filter(c => c.wasIncorrect)
      .map(c => c.id);
    
    if (selectedCorrections.length === incorrectIds.length) {
      setSelectedCorrections([]);
    } else {
      setSelectedCorrections(incorrectIds);
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('zh-CN');
  };

  const formatCurrency = (value: number | string | null) => {
    if (value === null || value === undefined) return '$0.00';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `$${num.toFixed(2)}`;
  };

  const formatPercent = (value: number | string | null) => {
    if (value === null || value === undefined) return '0%';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `${(num * 100).toFixed(0)}%`;
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status as SessionStatus] || statusConfig.analyzing;
    return (
      <Badge className={`${config.color} text-white flex items-center gap-1`}>
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const getCorrectionTypeBadge = (type: string | null) => {
    if (!type) return null;
    const config = correctionTypeConfig[type as CorrectionType] || correctionTypeConfig.correct;
    return (
      <Badge variant="outline" className={`${config.color} flex items-center gap-1`}>
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const incorrectCorrections = corrections?.filter(c => c.wasIncorrect) || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">半月纠错复盘</h1>
            <p className="text-muted-foreground">检测归因延迟导致的错误调价，生成纠错建议</p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <FileSearch className="h-4 w-4 mr-2" />
                新建复盘
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建纠错复盘</DialogTitle>
                <DialogDescription>
                  分析过去一段时间的出价调整，检测因归因延迟导致的错误决策
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>广告账户</Label>
                  <Select 
                    value={selectedAccountId?.toString() || ""} 
                    onValueChange={(v) => setSelectedAccountId(parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择广告账户" />
                    </SelectTrigger>
                    <SelectContent>
                      {adAccounts?.map((account) => (
                        <SelectItem key={account.id} value={account.id.toString()}>
                          {account.accountName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>分析周期</Label>
                  <Select value={periodDays} onValueChange={setPeriodDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">过去7天</SelectItem>
                      <SelectItem value="14">过去14天（推荐）</SelectItem>
                      <SelectItem value="30">过去30天</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    分析周期应至少为14天，以确保归因数据完整
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </Button>
                <Button 
                  onClick={handleCreateSession}
                  disabled={createSessionMutation.isPending || !selectedAccountId}
                >
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>关于归因延迟</AlertTitle>
          <AlertDescription>
            亚马逊广告的归因窗口通常为7-14天。在此期间内做出的出价调整可能基于不完整的数据，
            导致过度降价（错失销售机会）或过度加价（浪费广告费）。本功能帮助您识别和纠正这些错误决策。
          </AlertDescription>
        </Alert>

        {/* Main Content */}
        <div className="grid grid-cols-3 gap-6">
          {/* Session List */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>复盘会话</CardTitle>
                <CardDescription>选择或创建复盘会话</CardDescription>
              </CardHeader>
              <CardContent>
                {sessionsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">加载中...</div>
                ) : !sessions || sessions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无复盘会话，点击上方按钮创建
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedSession === session.id 
                            ? 'border-primary bg-primary/5' 
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => setSelectedSession(session.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">
                            {formatDate(session.periodStart)} - {formatDate(session.periodEnd)}
                          </span>
                          {getStatusBadge(session.sessionStatus || 'analyzing')}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>审查: {session.totalAdjustmentsReviewed || 0}</div>
                          <div>错误: {session.incorrectAdjustments || 0}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Session Details & Analysis */}
          <div className="col-span-2 space-y-6">
            {!selectedSession ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  请从左侧选择一个复盘会话，或创建新的复盘
                </CardContent>
              </Card>
            ) : !sessionDetails ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  加载中...
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        总审查
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {sessionDetails.totalAdjustmentsReviewed || 0}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        过度降价
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">
                        {sessionDetails.overDecreasedCount || 0}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-orange-500" />
                        过度加价
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-orange-600">
                        {sessionDetails.overIncreasedCount || 0}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-green-500" />
                        可挽回
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">
                        {formatCurrency(sessionDetails.potentialRecovery)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Analysis Button */}
                {sessionDetails.sessionStatus === 'analyzing' && (
                  <Card>
                    <CardContent className="py-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">开始分析</h3>
                          <p className="text-sm text-muted-foreground">
                            分析 {formatDate(sessionDetails.periodStart)} 至 {formatDate(sessionDetails.periodEnd)} 期间的出价调整
                          </p>
                        </div>
                        <Button 
                          onClick={() => analyzeSessionMutation.mutate({ sessionId: selectedSession })}
                          disabled={analyzeSessionMutation.isPending}
                        >
                          {analyzeSessionMutation.isPending ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              分析中...
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              开始分析
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recommendations */}
                {recommendations && recommendations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-yellow-500" />
                        优化建议
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {recommendations.map((rec, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm">
                            <ArrowRight className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Corrections Table */}
                {corrections && corrections.length > 0 && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>纠错建议</CardTitle>
                          <CardDescription>
                            已选择 {selectedCorrections.length} 个纠错建议
                          </CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={handleSelectAllCorrections}
                          >
                            {selectedCorrections.length === incorrectCorrections.length ? '取消全选' : '全选错误'}
                          </Button>
                          {selectedCorrections.length > 0 && (
                            <>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => dismissCorrectionsMutation.mutate({ correctionIds: selectedCorrections })}
                                disabled={dismissCorrectionsMutation.isPending}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                忽略
                              </Button>
                              <Button 
                                size="sm"
                                onClick={() => applyCorrectionsMutation.mutate({ 
                                  sessionId: selectedSession, 
                                  correctionIds: selectedCorrections 
                                })}
                                disabled={applyCorrectionsMutation.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                应用纠错
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>目标</TableHead>
                            <TableHead>类型</TableHead>
                            <TableHead>原出价</TableHead>
                            <TableHead>调整后</TableHead>
                            <TableHead>建议出价</TableHead>
                            <TableHead>置信度</TableHead>
                            <TableHead>状态</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {corrections.map((correction) => (
                            <TableRow key={correction.id}>
                              <TableCell>
                                {correction.wasIncorrect && (
                                  <Checkbox
                                    checked={selectedCorrections.includes(correction.id)}
                                    onCheckedChange={() => handleToggleCorrection(correction.id)}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <div>
                                  <div className="font-medium">{correction.targetName || `目标 #${correction.targetId}`}</div>
                                  <div className="text-xs text-muted-foreground">{correction.correctionTargetType}</div>
                                </div>
                              </TableCell>
                              <TableCell>{getCorrectionTypeBadge(correction.correctionType)}</TableCell>
                              <TableCell>{formatCurrency(correction.originalBid)}</TableCell>
                              <TableCell>{formatCurrency(correction.adjustedBid)}</TableCell>
                              <TableCell className="font-medium text-primary">
                                {correction.wasIncorrect ? formatCurrency(correction.suggestedBid) : '-'}
                              </TableCell>
                              <TableCell>
                                {correction.confidenceScore ? (
                                  <div className="flex items-center gap-2">
                                    <Progress 
                                      value={parseFloat(correction.confidenceScore) * 100} 
                                      className="w-12 h-2"
                                    />
                                    <span className="text-xs">
                                      {formatPercent(correction.confidenceScore)}
                                    </span>
                                  </div>
                                ) : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={
                                  correction.correctionStatus === 'applied' ? 'default' :
                                  correction.correctionStatus === 'dismissed' ? 'secondary' :
                                  'outline'
                                }>
                                  {correction.correctionStatus === 'pending_review' ? '待复盘' :
                                   correction.correctionStatus === 'approved' ? '已批准' :
                                   correction.correctionStatus === 'applied' ? '已应用' :
                                   correction.correctionStatus === 'dismissed' ? '已忽略' : correction.correctionStatus}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
