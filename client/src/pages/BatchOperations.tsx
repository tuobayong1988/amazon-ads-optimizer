import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import OperationConfirmDialog, { useOperationConfirm, ChangeItem } from "@/components/OperationConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { 
  Layers, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  RotateCcw,
  Plus,
  Eye,
  Trash2,
  AlertTriangle,
  Ban,
  ArrowUpDown,
  MinusCircle
} from "lucide-react";

type BatchStatus = 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
type OperationType = 'negative_keyword' | 'bid_adjustment' | 'keyword_migration' | 'campaign_status';

const statusConfig: Record<BatchStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审批', color: 'bg-yellow-500', icon: <Clock className="h-4 w-4" /> },
  approved: { label: '已审批', color: 'bg-blue-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  executing: { label: '执行中', color: 'bg-purple-500', icon: <Play className="h-4 w-4" /> },
  completed: { label: '已完成', color: 'bg-green-500', icon: <CheckCircle2 className="h-4 w-4" /> },
  failed: { label: '失败', color: 'bg-red-500', icon: <XCircle className="h-4 w-4" /> },
  cancelled: { label: '已取消', color: 'bg-gray-500', icon: <Ban className="h-4 w-4" /> },
  rolled_back: { label: '已回滚', color: 'bg-orange-500', icon: <RotateCcw className="h-4 w-4" /> },
};

const operationTypeConfig: Record<OperationType, { label: string; icon: React.ReactNode }> = {
  negative_keyword: { label: '否定词添加', icon: <MinusCircle className="h-4 w-4" /> },
  bid_adjustment: { label: '出价调整', icon: <ArrowUpDown className="h-4 w-4" /> },
  keyword_migration: { label: '关键词迁移', icon: <Layers className="h-4 w-4" /> },
  campaign_status: { label: '广告活动状态', icon: <AlertTriangle className="h-4 w-4" /> },
};

export default function BatchOperations() {
  const [activeTab, setActiveTab] = useState("all");
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<'negative_keyword' | 'bid_adjustment'>('negative_keyword');
  
  // 确认弹窗状态
  const { showConfirm, dialogProps } = useOperationConfirm();
  
  // Form state for creating batch
  const [batchName, setBatchName] = useState("");
  const [batchDescription, setBatchDescription] = useState("");
  const [negativeKeywordsText, setNegativeKeywordsText] = useState("");
  const [bidAdjustmentsText, setBidAdjustmentsText] = useState("");

  const { data: batches, isLoading, refetch } = trpc.batchOperation.list.useQuery({
    status: activeTab === 'all' ? undefined : activeTab,
  });

  const { data: batchDetails } = trpc.batchOperation.get.useQuery(
    { id: selectedBatch! },
    { enabled: !!selectedBatch }
  );

  const approveMutation = trpc.batchOperation.approve.useMutation({
    onSuccess: () => {
      toast.success("批量操作已审批");
      refetch();
    },
    onError: (error) => {
      toast.error(`审批失败: ${error.message}`);
    },
  });

  const executeMutation = trpc.batchOperation.execute.useMutation({
    onSuccess: (result) => {
      toast.success(`执行完成: ${result.successItems}/${result.totalItems} 成功`);
      refetch();
    },
    onError: (error) => {
      toast.error(`执行失败: ${error.message}`);
    },
  });

  const rollbackMutation = trpc.batchOperation.rollback.useMutation({
    onSuccess: (result) => {
      toast.success(`回滚完成: ${result.rolledBackItems} 项已回滚`);
      refetch();
    },
    onError: (error) => {
      toast.error(`回滚失败: ${error.message}`);
    },
  });

  const cancelMutation = trpc.batchOperation.cancel.useMutation({
    onSuccess: () => {
      toast.success("批量操作已取消");
      refetch();
    },
    onError: (error) => {
      toast.error(`取消失败: ${error.message}`);
    },
  });

  const createNegativeKeywordBatchMutation = trpc.batchOperation.createNegativeKeywordBatch.useMutation({
    onSuccess: (result) => {
      toast.success(`批量操作已创建: ${result.totalItems} 个否定词`);
      setIsCreateDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const createBidAdjustmentBatchMutation = trpc.batchOperation.createBidAdjustmentBatch.useMutation({
    onSuccess: (result) => {
      toast.success(`批量操作已创建: ${result.totalItems} 个出价调整`);
      setIsCreateDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const resetForm = () => {
    setBatchName("");
    setBatchDescription("");
    setNegativeKeywordsText("");
    setBidAdjustmentsText("");
  };

  const handleCreateBatch = () => {
    if (!batchName.trim()) {
      toast.error("请输入批量操作名称");
      return;
    }

    if (createType === 'negative_keyword') {
      // Parse negative keywords text
      const lines = negativeKeywordsText.trim().split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        toast.error("请输入否定词列表");
        return;
      }

      const items = lines.map((line, index) => {
        const parts = line.split(',').map(p => p.trim());
        return {
          entityType: 'campaign' as const,
          entityId: index + 1, // Placeholder - would need real campaign ID
          entityName: parts[0] || `Campaign ${index + 1}`,
          negativeKeyword: parts[1] || parts[0],
          negativeMatchType: (parts[2] === 'exact' ? 'negative_exact' : 'negative_phrase') as 'negative_phrase' | 'negative_exact',
          negativeLevel: 'campaign' as const,
        };
      });

      createNegativeKeywordBatchMutation.mutate({
        name: batchName,
        description: batchDescription,
        items,
      });
    } else {
      // Parse bid adjustments text
      const lines = bidAdjustmentsText.trim().split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        toast.error("请输入出价调整列表");
        return;
      }

      const items = lines.map((line, index) => {
        const parts = line.split(',').map(p => p.trim());
        return {
          entityType: 'keyword' as const,
          entityId: index + 1, // Placeholder - would need real keyword ID
          entityName: parts[0] || `Keyword ${index + 1}`,
          currentBid: parseFloat(parts[1]) || 1.0,
          newBid: parseFloat(parts[2]) || 1.5,
          bidChangeReason: parts[3] || '批量调整',
        };
      });

      createBidAdjustmentBatchMutation.mutate({
        name: batchName,
        description: batchDescription,
        items,
      });
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN');
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status as BatchStatus] || statusConfig.pending;
    return (
      <Badge className={`${config.color} text-white flex items-center gap-1`}>
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const getOperationTypeBadge = (type: string) => {
    const config = operationTypeConfig[type as OperationType] || operationTypeConfig.negative_keyword;
    return (
      <Badge variant="outline" className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">批量操作</h1>
            <p className="text-muted-foreground">管理批量否定词添加和出价调整操作</p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新建批量操作
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>新建批量操作</DialogTitle>
                <DialogDescription>
                  创建批量否定词添加或出价调整操作
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>操作类型</Label>
                    <Select value={createType} onValueChange={(v) => setCreateType(v as 'negative_keyword' | 'bid_adjustment')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="negative_keyword">否定词添加</SelectItem>
                        <SelectItem value="bid_adjustment">出价调整</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>操作名称</Label>
                    <Input 
                      placeholder="例如: Q1否定词优化"
                      value={batchName}
                      onChange={(e) => setBatchName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>描述（可选）</Label>
                  <Input 
                    placeholder="操作描述..."
                    value={batchDescription}
                    onChange={(e) => setBatchDescription(e.target.value)}
                  />
                </div>
                {createType === 'negative_keyword' ? (
                  <div className="space-y-2">
                    <Label>否定词列表</Label>
                    <Textarea 
                      placeholder="每行一个，格式: 广告活动名称,否定词,匹配类型(phrase/exact)&#10;例如:&#10;Campaign A,cheap,phrase&#10;Campaign B,free shipping,exact"
                      className="h-40 font-mono text-sm"
                      value={negativeKeywordsText}
                      onChange={(e) => setNegativeKeywordsText(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      支持批量导入，每行一个否定词
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>出价调整列表</Label>
                    <Textarea 
                      placeholder="每行一个，格式: 关键词名称,当前出价,新出价,调整原因&#10;例如:&#10;wireless earbuds,1.50,2.00,提高曝光&#10;bluetooth speaker,2.00,1.50,降低ACoS"
                      className="h-40 font-mono text-sm"
                      value={bidAdjustmentsText}
                      onChange={(e) => setBidAdjustmentsText(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      支持批量导入，每行一个出价调整
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </Button>
                <Button 
                  onClick={handleCreateBatch}
                  disabled={createNegativeKeywordBatchMutation.isPending || createBidAdjustmentBatchMutation.isPending}
                >
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">待审批</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {batches?.filter(b => b.status === 'pending').length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">执行中</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {batches?.filter(b => b.status === 'executing').length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">已完成</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {batches?.filter(b => b.status === 'completed').length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">失败</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {batches?.filter(b => b.status === 'failed').length || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-3 gap-6">
          {/* Batch List */}
          <div className="col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>批量操作列表</CardTitle>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="all">全部</TabsTrigger>
                    <TabsTrigger value="pending">待审批</TabsTrigger>
                    <TabsTrigger value="approved">已审批</TabsTrigger>
                    <TabsTrigger value="completed">已完成</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">加载中...</div>
                ) : !batches || batches.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无批量操作记录
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>名称</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>进度</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batches.map((batch) => (
                        <TableRow 
                          key={batch.id}
                          className={selectedBatch === batch.id ? 'bg-muted/50' : ''}
                          onClick={() => setSelectedBatch(batch.id)}
                        >
                          <TableCell className="font-medium">{batch.name}</TableCell>
                          <TableCell>{getOperationTypeBadge(batch.operationType)}</TableCell>
                          <TableCell>{getStatusBadge(batch.status || 'pending')}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress 
                                value={batch.totalItems ? (batch.processedItems || 0) / batch.totalItems * 100 : 0} 
                                className="w-16 h-2"
                              />
                              <span className="text-xs text-muted-foreground">
                                {batch.processedItems || 0}/{batch.totalItems || 0}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(batch.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedBatch(batch.id);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {batch.status === 'pending' && (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      approveMutation.mutate({ id: batch.id });
                                    }}
                                  >
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelMutation.mutate({ id: batch.id });
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </Button>
                                </>
                              )}
                              {batch.status === 'approved' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const operationType = operationTypeConfig[batch.operationType as OperationType];
                                    showConfirm({
                                      operationType: 'batch_operation',
                                      title: '执行批量操作',
                                      description: `您即将执行“${batch.name}”批量操作`,
                                      changes: [{
                                        id: batch.id,
                                        name: batch.name,
                                        field: 'operation',
                                        fieldLabel: '操作类型',
                                        oldValue: '待执行',
                                        newValue: operationType?.label || batch.operationType,
                                      }],
                                      affectedCount: batch.totalItems || 0,
                                      warningMessage: (batch.totalItems || 0) > 10 
                                        ? `此操作将影响 ${batch.totalItems} 个项目，请谨慎确认` 
                                        : undefined,
                                      onConfirm: () => {
                                        executeMutation.mutate({ id: batch.id });
                                      },
                                    });
                                  }}
                                >
                                  <Play className="h-4 w-4 text-blue-600" />
                                </Button>
                              )}
                              {batch.status === 'completed' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    rollbackMutation.mutate({ id: batch.id });
                                  }}
                                >
                                  <RotateCcw className="h-4 w-4 text-orange-600" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Batch Details */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>操作详情</CardTitle>
                <CardDescription>
                  {selectedBatch ? `批量操作 #${selectedBatch}` : '选择一个批量操作查看详情'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedBatch ? (
                  <div className="text-center py-8 text-muted-foreground">
                    请从左侧列表选择一个批量操作
                  </div>
                ) : !batchDetails ? (
                  <div className="text-center py-8 text-muted-foreground">加载中...</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-muted-foreground">名称</Label>
                      <p className="font-medium">{batchDetails.name}</p>
                    </div>
                    {batchDetails.description && (
                      <div>
                        <Label className="text-muted-foreground">描述</Label>
                        <p>{batchDetails.description}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-muted-foreground">类型</Label>
                        <p>{getOperationTypeBadge(batchDetails.operationType)}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">状态</Label>
                        <p>{getStatusBadge(batchDetails.status || 'pending')}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-muted-foreground">总计</Label>
                        <p className="text-xl font-bold">{batchDetails.totalItems || 0}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">成功</Label>
                        <p className="text-xl font-bold text-green-600">{batchDetails.successItems || 0}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">失败</Label>
                        <p className="text-xl font-bold text-red-600">{batchDetails.failedItems || 0}</p>
                      </div>
                    </div>
                    
                    {/* Items Preview */}
                    {batchDetails.items && batchDetails.items.length > 0 && (
                      <div>
                        <Label className="text-muted-foreground mb-2 block">操作项目</Label>
                        <div className="max-h-60 overflow-y-auto space-y-2">
                          {batchDetails.items.slice(0, 10).map((item, index) => (
                            <div 
                              key={item.id || index}
                              className="p-2 bg-muted/50 rounded text-sm flex items-center justify-between"
                            >
                              <span>{item.entityName || item.negativeKeyword || `项目 ${index + 1}`}</span>
                              <Badge variant={item.status === 'success' ? 'default' : item.status === 'failed' ? 'destructive' : 'secondary'}>
                                {item.status}
                              </Badge>
                            </div>
                          ))}
                          {batchDetails.items.length > 10 && (
                            <p className="text-xs text-muted-foreground text-center">
                              还有 {batchDetails.items.length - 10} 个项目...
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-4">
                      {batchDetails.status === 'pending' && (
                        <>
                          <Button 
                            className="flex-1"
                            onClick={() => approveMutation.mutate({ id: batchDetails.id })}
                            disabled={approveMutation.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            审批
                          </Button>
                          <Button 
                            variant="destructive"
                            className="flex-1"
                            onClick={() => cancelMutation.mutate({ id: batchDetails.id })}
                            disabled={cancelMutation.isPending}
                          >
                            <Ban className="h-4 w-4 mr-2" />
                            取消
                          </Button>
                        </>
                      )}
                      {batchDetails.status === 'approved' && (
                        <Button 
                          className="w-full"
                          onClick={() => {
                            const operationType = operationTypeConfig[batchDetails.operationType as OperationType];
                            showConfirm({
                              operationType: 'batch_operation',
                              title: '执行批量操作',
                              description: `您即将执行“${batchDetails.name}”批量操作`,
                              changes: [{
                                id: batchDetails.id,
                                name: batchDetails.name,
                                field: 'operation',
                                fieldLabel: '操作类型',
                                oldValue: '待执行',
                                newValue: operationType?.label || batchDetails.operationType,
                              }],
                              affectedCount: batchDetails.totalItems || 0,
                              warningMessage: (batchDetails.totalItems || 0) > 10 
                                ? `此操作将影响 ${batchDetails.totalItems} 个项目，请谨慎确认` 
                                : undefined,
                              onConfirm: () => {
                                executeMutation.mutate({ id: batchDetails.id });
                              },
                            });
                          }}
                          disabled={executeMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          执行
                        </Button>
                      )}
                      {batchDetails.status === 'completed' && (
                        <Button 
                          variant="outline"
                          className="w-full"
                          onClick={() => rollbackMutation.mutate({ id: batchDetails.id })}
                          disabled={rollbackMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          回滚
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* 操作确认弹窗 */}
      {dialogProps && <OperationConfirmDialog {...dialogProps} />}
    </DashboardLayout>
  );
}
