// @ts-nocheck
/**
 * v361: 从CampaignDetail.tsx拆分的TargetsList子组件
 */

import { useState, useMemo, useCallback} from "react";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Pause, Play, Target, TrendingUp } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { formatAutoTargetingExpression } from '../campaigns/CampaignDetail';

export function TargetsList({ campaignId }: { campaignId: number }) {
  const utils = trpc.useUtils();
  const { data: targetsData, isLoading, refetch } = trpc.campaign.getTargets.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  // 编辑出价状态
  const [editBidOpen, setEditBidOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [newBid, setNewBid] = useState("");
  
  // 确认状态变更弹窗
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState<any>(null);
  const [newStatus, setNewStatus] = useState<"enabled" | "paused">("enabled");
  
  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  
  // 批量操作弹窗
  const [batchBidOpen, setBatchBidOpen] = useState(false);
  const [batchBidType, setBatchBidType] = useState<"fixed" | "increase_percent" | "decrease_percent" | "cpc_multiplier" | "cpc_increase_percent" | "cpc_decrease_percent">("fixed");
  const [batchBidValue, setBatchBidValue] = useState("");
  const [batchStatusOpen, setBatchStatusOpen] = useState(false);
  const [batchStatus, setBatchStatus] = useState<"enabled" | "paused">("enabled");
  
  // 趋势图弹窗状态
  const [trendChartOpen, setTrendChartOpen] = useState(false);
  const [trendTarget, setTrendTarget] = useState<{ id: number; type: "keyword" | "productTarget"; name: string; matchType?: string } | null>(null);
  
  // 出价响应曲线弹窗状态
  const [bidCurveOpen, setBidCurveOpen] = useState(false);
  const [bidCurveTarget, setBidCurveTarget] = useState<{ id: number; text: string; bid: number; matchType?: string } | null>(null);
  
  // 筛选状态 - 默认展开筛选面板
  const [showFilters, setShowFilters] = useState(true);
  const [filters, setFilters] = useState({
    matchType: "all" as "all" | "broad" | "phrase" | "exact" | "product",
    status: "all" as "all" | "enabled" | "paused",
    bidMin: "",
    bidMax: "",
    clicksMin: "",
    clicksMax: "",
    spendMin: "",
    spendMax: "",
    salesMin: "",
    salesMax: "",
    acosMin: "",
    acosMax: "",
    roasMin: "",
    roasMax: "",
    ordersMin: "",
    ordersMax: "",
    ctrMin: "",
    ctrMax: "",
    cvrMin: "",
    cvrMax: "",
  });
  
  // 更新关键词出价
  const updateKeywordMutation = trpc.keyword.update.useMutation({
    onSuccess: () => {
      toast.success("出价更新成功");
      refetch();
      setEditBidOpen(false);
      setEditingTarget(null);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  
  // 更新商品定向出价
  const updateProductTargetMutation = trpc.productTarget.update.useMutation({
    onSuccess: () => {
      toast.success("出价更新成功");
      refetch();
      setEditBidOpen(false);
      setEditingTarget(null);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  
  // 批量更新关键词出价
  const batchUpdateKeywordBidMutation = trpc.keyword.batchUpdateBid.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个关键词出价`);
      refetch();
      setBatchBidOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新商品定向出价
  const batchUpdateProductTargetBidMutation = trpc.productTarget.batchUpdateBid.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个商品定向出价`);
      refetch();
      setBatchBidOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新关键词状态
  const batchUpdateKeywordStatusMutation = trpc.keyword.batchUpdateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个关键词状态`);
      refetch();
      setBatchStatusOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新商品定向状态
  const batchUpdateProductTargetStatusMutation = trpc.productTarget.batchUpdateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个商品定向状态`);
      refetch();
      setBatchStatusOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 打开编辑出价弹窗
  const handleEditBid = useCallback((target: any) => {
    setEditingTarget(target);
    setNewBid(target.bid || "");
    setEditBidOpen(true);
  }, []);
  
  // 保存出价
  const handleSaveBid = useCallback(() => {
    if (!editingTarget || !newBid) return;
    
    const realId = parseInt(editingTarget.id.split("-")[1]);
    const isKeyword = editingTarget.type === "keyword";
    
    if (isKeyword) {
      updateKeywordMutation.mutate({ id: realId, bid: newBid });
    } else {
      updateProductTargetMutation.mutate({ id: realId, bid: newBid });
    }
  }, [editingTarget, newBid, updateKeywordMutation, updateProductTargetMutation]);
  
  // 打开状态变更确认弹窗
  const handleStatusChange = useCallback((target: any, status: "enabled" | "paused") => {
    setStatusChangeTarget(target);
    setNewStatus(status);
    setConfirmStatusOpen(true);
  }, []);
  
  // 确认状态变更
  const handleConfirmStatusChange = useCallback(() => {
    if (!statusChangeTarget) return;
    
    const realId = parseInt(statusChangeTarget.id.split("-")[1]);
    const isKeyword = statusChangeTarget.type === "keyword";
    
    if (isKeyword) {
      updateKeywordMutation.mutate({ id: realId, status: newStatus });
    } else {
      updateProductTargetMutation.mutate({ id: realId, status: newStatus });
    }
    setConfirmStatusOpen(false);
    setStatusChangeTarget(null);
  }, [statusChangeTarget, newStatus, updateKeywordMutation, updateProductTargetMutation]);
  
  // 切换单个选择
  const toggleSelect = useCallback((id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    setSelectAll(false);
  }, [selectedIds]);
  
  // 全选/取消全选
  const toggleSelectAll = useCallback((targets: any[]) => {
    if (selectAll) {
      setSelectedIds(new Set());
      setSelectAll(false);
    } else {
      setSelectedIds(new Set(targets.map(t => t.id)));
      setSelectAll(true);
    }
  }, [selectAll]);
  
  // 批量修改出价
  const handleBatchBid = useCallback(() => {
    if (!batchBidValue || selectedIds.size === 0) return;
    
    const keywordIds: number[] = [];
    const productTargetIds: number[] = [];
    
    selectedIds.forEach(id => {
      const [type, realId] = id.split("-");
      if (type === "kw") {
        keywordIds.push(parseInt(realId));
      } else {
        productTargetIds.push(parseInt(realId));
      }
    });
    
    if (keywordIds.length > 0) {
      batchUpdateKeywordBidMutation.mutate({
        ids: keywordIds,
        bidType: batchBidType,
        bidValue: parseFloat(batchBidValue),
      });
    }
    
    if (productTargetIds.length > 0) {
      batchUpdateProductTargetBidMutation.mutate({
        ids: productTargetIds,
        bidType: batchBidType,
        bidValue: parseFloat(batchBidValue),
      });
    }
  }, [selectedIds, batchBidValue, batchBidType, batchUpdateKeywordBidMutation, batchUpdateProductTargetBidMutation]);
  
  // 批量修改状态
  const handleBatchStatus = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    const keywordIds: number[] = [];
    const productTargetIds: number[] = [];
    
    selectedIds.forEach(id => {
      const [type, realId] = id.split("-");
      if (type === "kw") {
        keywordIds.push(parseInt(realId));
      } else {
        productTargetIds.push(parseInt(realId));
      }
    });
    
    if (keywordIds.length > 0) {
      batchUpdateKeywordStatusMutation.mutate({
        ids: keywordIds,
        status: batchStatus,
      });
    }
    
    if (productTargetIds.length > 0) {
      batchUpdateProductTargetStatusMutation.mutate({
        ids: productTargetIds,
        status: batchStatus,
      });
    }
  }, [selectedIds, batchStatus, batchUpdateKeywordStatusMutation, batchUpdateProductTargetStatusMutation]);
  
  // 清除筛选
  const clearFilters = useCallback(() => {
    setFilters({
      matchType: "all",
      status: "all",
      bidMin: "",
      bidMax: "",
      clicksMin: "",
      clicksMax: "",
      spendMin: "",
      spendMax: "",
      salesMin: "",
      salesMax: "",
      acosMin: "",
      acosMax: "",
      roasMin: "",
      roasMax: "",
      ordersMin: "",
      ordersMax: "",
      ctrMin: "",
      ctrMax: "",
      cvrMin: "",
      cvrMax: "",
    });
  }, []);
  
  // 检查是否有激活的筛选
  const hasActiveFilters = () => {
    return filters.matchType !== "all" ||
      filters.status !== "all" ||
      filters.bidMin !== "" ||
      filters.bidMax !== "" ||
      filters.clicksMin !== "" ||
      filters.clicksMax !== "" ||
      filters.spendMin !== "" ||
      filters.spendMax !== "" ||
      filters.salesMin !== "" ||
      filters.salesMax !== "" ||
      filters.acosMin !== "" ||
      filters.acosMax !== "" ||
      filters.roasMin !== "" ||
      filters.roasMax !== "" ||
      filters.ordersMin !== "" ||
      filters.ordersMax !== "" ||
      filters.ctrMin !== "" ||
      filters.ctrMax !== "" ||
      filters.cvrMin !== "" ||
      filters.cvrMax !== "";
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // 合并关键词和商品定向为统一的投放词列表
  const allTargets: any[] = [];
  
  if (targetsData?.keywords) {
    targetsData.keywords.forEach((k: any) => {
      allTargets.push({
        id: `kw-${k.id}`,
        originalId: k.id,
        realId: k.id,
        text: k.keywordText,
        type: 'keyword',
        matchType: k.matchType,
        status: k.status,
        bid: k.bid,
        impressions: k.impressions,
        clicks: k.clicks,
        spend: k.spend,
        sales: k.sales,
        orders: k.orders || 0,
        unitsOrdered: k.unitsOrdered || 0,
        adGroupName: k.adGroupName
      });
    });
  }
  
  if (targetsData?.productTargets) {
    targetsData.productTargets.forEach((pt: any) => {
      allTargets.push({
        id: `pt-${pt.id}`,
        originalId: pt.id,
        realId: pt.id,
        text: formatAutoTargetingExpression(pt.targetExpression || pt.asin || ''),
        type: 'product',
        matchType: pt.targetMatchType || null,
        status: pt.status,
        bid: pt.bid,
        impressions: pt.impressions,
        clicks: pt.clicks,
        spend: pt.spend,
        sales: pt.sales,
        orders: pt.orders || 0,
        unitsOrdered: pt.unitsOrdered || 0,
        adGroupName: pt.adGroupName,
        // 品类定向字段
        categoryName: pt.categoryName || null,
        categoryRefinements: pt.categoryRefinements || null,
        asinTitle: pt.asinTitle || null,
        targetType: pt.targetType || null,
      });
    });
  }
  
  // 应用筛选
  const filteredTargets = allTargets.filter(target => {
    const tSpend = parseFloat(target.spend || "0");
    const tSales = parseFloat(target.sales || "0");
    const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
    const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
    const tBid = parseFloat(target.bid || "0");
    
    // 匹配方式筛选
    if (filters.matchType !== "all") {
      if (filters.matchType === "product" && target.type !== "product") return false;
      if (filters.matchType !== "product" && target.matchType !== filters.matchType) return false;
    }
    
    // 状态筛选
    if (filters.status !== "all" && target.status !== filters.status) return false;
    
    // 出价范围筛选
    if (filters.bidMin && tBid < parseFloat(filters.bidMin)) return false;
    if (filters.bidMax && tBid > parseFloat(filters.bidMax)) return false;
    
    // 点击范围筛选
    if (filters.clicksMin && (target.clicks || 0) < parseInt(filters.clicksMin)) return false;
    if (filters.clicksMax && (target.clicks || 0) > parseInt(filters.clicksMax)) return false;
    
    // 花费范围筛选
    if (filters.spendMin && tSpend < parseFloat(filters.spendMin)) return false;
    if (filters.spendMax && tSpend > parseFloat(filters.spendMax)) return false;
    
    // 销售额范围筛选
    if (filters.salesMin && tSales < parseFloat(filters.salesMin)) return false;
    if (filters.salesMax && tSales > parseFloat(filters.salesMax)) return false;
    
    // ACoS范围筛选
    if (filters.acosMin && tAcos < parseFloat(filters.acosMin)) return false;
    if (filters.acosMax && tAcos > parseFloat(filters.acosMax)) return false;
    
    // ROAS范围筛选
    if (filters.roasMin && tRoas < parseFloat(filters.roasMin)) return false;
    if (filters.roasMax && tRoas > parseFloat(filters.roasMax)) return false;
    
    // 订单数范围筛选
    if (filters.ordersMin && (target.orders || 0) < parseInt(filters.ordersMin)) return false;
    if (filters.ordersMax && (target.orders || 0) > parseInt(filters.ordersMax)) return false;
    
    // 点击率范围筛选
    const tCtr = target.impressions > 0 ? (target.clicks / target.impressions * 100) : 0;
    if (filters.ctrMin && tCtr < parseFloat(filters.ctrMin)) return false;
    if (filters.ctrMax && tCtr > parseFloat(filters.ctrMax)) return false;
    
    // 转化率范围筛选
    const tCvr = target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0;
    if (filters.cvrMin && tCvr < parseFloat(filters.cvrMin)) return false;
    if (filters.cvrMax && tCvr > parseFloat(filters.cvrMax)) return false;
    
    return true;
  });
  
  if (allTargets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无投放词数据</p>
      </div>
    );
  }
  
  // 按销售额排序
  const sortedTargets = [...filteredTargets].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  const isMutating = updateKeywordMutation.isPending || updateProductTargetMutation.isPending ||
    batchUpdateKeywordBidMutation.isPending || batchUpdateProductTargetBidMutation.isPending ||
    batchUpdateKeywordStatusMutation.isPending || batchUpdateProductTargetStatusMutation.isPending;
  
  return (
    <>
      {/* 筛选和批量操作工具栏 */}
      <div className="mb-4 space-y-4">
        {/* 筛选按钮和批量操作 */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Target className="h-4 w-4 mr-2" />
              筛选
              {hasActiveFilters() && <Badge variant="secondary" className="ml-2">激活</Badge>}
            </Button>
            {hasActiveFilters() && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
          
          {/* 批量操作按钮 */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
              <span className="text-sm text-muted-foreground">已选择 {selectedIds.size} 项</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBatchStatus("enabled");
                  setBatchStatusOpen(true);
                }}
              >
                <Play className="h-4 w-4 mr-1" />
                批量启用
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBatchStatus("paused");
                  setBatchStatusOpen(true);
                }}
              >
                <Pause className="h-4 w-4 mr-1" />
                批量暂停
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBatchBidOpen(true)}
              >
                <Edit2 className="h-4 w-4 mr-1" />
                批量修改出价
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectAll(false);
                }}
              >
                取消选择
              </Button>
            </div>
          )}
        </div>
        
        {/* 筛选面板 */}
        {showFilters && (
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {/* 匹配方式 */}
                <div>
                  <Label className="text-xs">匹配方式</Label>
                  <select
                    className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={filters.matchType}
                    onChange={(e) => setFilters({...filters, matchType: e.target.value as any})}
                  >
                    <option value="all">全部</option>
                    <option value="broad">广泛</option>
                    <option value="phrase">词组</option>
                    <option value="exact">精确</option>
                    <option value="product">商品定向</option>
                  </select>
                </div>
                
                {/* 状态 */}
                <div>
                  <Label className="text-xs">状态</Label>
                  <select
                    className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={filters.status}
                    onChange={(e) => setFilters({...filters, status: e.target.value as any})}
                  >
                    <option value="all">全部</option>
                    <option value="enabled">启用</option>
                    <option value="paused">暂停</option>
                  </select>
                </div>
                
                {/* 出价范围 */}
                <div>
                  <Label className="text-xs">出价范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.bidMin}
                      onChange={(e) => setFilters({...filters, bidMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.bidMax}
                      onChange={(e) => setFilters({...filters, bidMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 点击范围 */}
                <div>
                  <Label className="text-xs">点击范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.clicksMin}
                      onChange={(e) => setFilters({...filters, clicksMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.clicksMax}
                      onChange={(e) => setFilters({...filters, clicksMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 花费范围 */}
                <div>
                  <Label className="text-xs">花费范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.spendMin}
                      onChange={(e) => setFilters({...filters, spendMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.spendMax}
                      onChange={(e) => setFilters({...filters, spendMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 销售额范围 */}
                <div>
                  <Label className="text-xs">销售额范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.salesMin}
                      onChange={(e) => setFilters({...filters, salesMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.salesMax}
                      onChange={(e) => setFilters({...filters, salesMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* ACoS范围 */}
                <div>
                  <Label className="text-xs">ACoS范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.acosMin}
                      onChange={(e) => setFilters({...filters, acosMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.acosMax}
                      onChange={(e) => setFilters({...filters, acosMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* ROAS范围 */}
                <div>
                  <Label className="text-xs">ROAS范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.roasMin}
                      onChange={(e) => setFilters({...filters, roasMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.roasMax}
                      onChange={(e) => setFilters({...filters, roasMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 订单数范围 */}
                <div>
                  <Label className="text-xs">订单数范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.ordersMin}
                      onChange={(e) => setFilters({...filters, ordersMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.ordersMax}
                      onChange={(e) => setFilters({...filters, ordersMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 点击率范围 */}
                <div>
                  <Label className="text-xs">点击率范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.ctrMin}
                      onChange={(e) => setFilters({...filters, ctrMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.ctrMax}
                      onChange={(e) => setFilters({...filters, ctrMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 转化率范围 */}
                <div>
                  <Label className="text-xs">转化率范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.cvrMin}
                      onChange={(e) => setFilters({...filters, cvrMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.cvrMax}
                      onChange={(e) => setFilters({...filters, cvrMax: e.target.value})}
                    />
                  </div>
                </div>
              </div>
              
              {/* 筛选结果统计 */}
              <div className="mt-4 text-sm text-muted-foreground">
                筛选结果: {filteredTargets.length} / {allTargets.length} 项
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  checked={selectAll && sortedTargets.length > 0}
                  onChange={() => toggleSelectAll(sortedTargets)}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </TableHead>
              <TableHead>投放词</TableHead>
              <TableHead>定向详情</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>匹配方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">出价</TableHead>
              <TableHead className="text-right">CPC</TableHead>
              <TableHead className="text-right">展示</TableHead>
              <TableHead className="text-right">点击</TableHead>
              <TableHead className="text-right">点击率</TableHead>
              <TableHead className="text-right">花费</TableHead>
              <TableHead className="text-right">订单</TableHead>
              <TableHead className="text-right">订购件数</TableHead>
              <TableHead className="text-right">销售额</TableHead>
              <TableHead className="text-right">转化率</TableHead>
              <TableHead className="text-right">ACoS</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTargets.map((target: any) => {
              const tSpend = parseFloat(target.spend || "0");
              const tSales = parseFloat(target.sales || "0");
              const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
              const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
              const isKeyword = target.type === 'keyword';
              const isEnabled = target.status === "enabled";
              
              return (
                <TableRow key={target.id} className={selectedIds.has(target.id) ? "bg-muted/50" : ""}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(target.id)}
                      onChange={() => toggleSelect(target.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <button
                      className="text-left hover:text-primary hover:underline truncate block w-full"
                      title={`点击查看 "${target.text}" 的历史趋势`}
                      onClick={() => {
                        setTrendTarget({
                          id: target.originalId,
                          type: isKeyword ? "keyword" : "productTarget",
                          name: target.text,
                          matchType: isKeyword ? target.matchType : undefined,
                        });
                        setTrendChartOpen(true);
                      }}
                    >
                      {target.text}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    {!isKeyword && (target.categoryName || target.asinTitle) ? (
                      <div className="flex flex-col gap-0.5">
                        {target.categoryName && (
                          <span className="text-xs text-teal-600 truncate" title={`品类: ${target.categoryName}`}>
                            📂 {target.categoryName}
                          </span>
                        )}
                        {target.asinTitle && (
                          <span className="text-xs text-blue-600 truncate" title={target.asinTitle}>
                            {target.asinTitle}
                          </span>
                        )}
                        {target.categoryRefinements && (
                          <span className="text-[10px] text-muted-foreground truncate" title={`细化: ${target.categoryRefinements}`}>
                            细化: {target.categoryRefinements}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isKeyword ? "default" : "secondary"}>
                      {isKeyword ? "关键词" : (
                        // 检查是否是SP自动广告的匹配组
                        target.categoryName ? "品类定向" :
                        ["紧密匹配", "宽泛匹配", "关联商品", "同类商品"].includes(target.text) 
                          ? "自动定向" 
                          : "ASIN定向"
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isKeyword ? (
                      <Badge variant="outline" className={({exact: 'bg-red-50 text-red-700 border-red-200', phrase: 'bg-green-50 text-green-700 border-green-200', broad: 'bg-blue-50 text-blue-700 border-blue-200'} as Record<string, string>)[target.matchType as string] || 'bg-gray-50'}>
                        {target.matchType === "exact" ? "精确" : target.matchType === "phrase" ? "词组" : "广泛"}
                      </Badge>
                    ) : target.matchType ? (
                      <Badge variant="outline" className={({exact: 'bg-purple-50 text-purple-700 border-purple-200', expanded: 'bg-indigo-50 text-indigo-700 border-indigo-200', category: 'bg-teal-50 text-teal-700 border-teal-200', brand: 'bg-cyan-50 text-cyan-700 border-cyan-200', close: 'bg-rose-50 text-rose-700 border-rose-200', loose: 'bg-orange-50 text-orange-700 border-orange-200', substitutes: 'bg-amber-50 text-amber-700 border-amber-200', complements: 'bg-lime-50 text-lime-700 border-lime-200'} as Record<string, string>)[target.matchType as string] || 'bg-gray-50 text-gray-700 border-gray-200'}>
                        {({exact: '精确定向', expanded: '拓展定向', category: '品类定向', brand: '品牌定向', close: '紧密匹配', loose: '宽泛匹配', substitutes: '替代商品', complements: '关联商品'} as Record<string, string>)[target.matchType as string] || target.matchType}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isEnabled ? "default" : "secondary"}>
                      {isEnabled ? "启用" : "暂停"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">${target.bid || "N/A"}</TableCell>
                  <TableCell className="text-right">
                    {target.clicks > 0 ? `$${(tSpend / target.clicks).toFixed(2)}` : "-"}
                  </TableCell>
                  <TableCell className="text-right">{target.impressions?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{target.clicks?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">
                    <span className={(target.impressions > 0 ? (target.clicks / target.impressions * 100) : 0) >= 0.5 ? "text-green-500" : "text-yellow-500"}>
                      {target.impressions > 0 ? `${(target.clicks / target.impressions * 100).toFixed(2)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">${tSpend.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{target.orders || 0}</TableCell>
                  <TableCell className="text-right">{target.unitsOrdered || 0}</TableCell>
                  <TableCell className="text-right">${tSales.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={(target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0) >= 10 ? "text-green-500" : (target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0) >= 5 ? "text-yellow-500" : "text-red-500"}>
                      {target.clicks > 0 ? `${((target.orders || 0) / target.clicks * 100).toFixed(2)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={tAcos > 30 ? "text-red-500" : tAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                      {tSales > 0 ? `${tAcos.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={tRoas >= 3 ? "text-green-500" : tRoas >= 2 ? "text-yellow-500" : "text-red-500"}>
                      {tSpend > 0 ? tRoas.toFixed(2) : "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEditBid(target)}
                        title="编辑出价"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {isKeyword && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setBidCurveTarget({
                              id: target.originalId,
                              text: target.text,
                              bid: parseFloat(target.bid || "0.5"),
                              matchType: target.matchType,
                            });
                            setBidCurveOpen(true);
                          }}
                          title="出价响应曲线分析"
                        >
                          <TrendingUp className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleStatusChange(target, isEnabled ? "paused" : "enabled")}
                        title={isEnabled ? "暂停" : "启用"}
                      >
                        {isEnabled ? (
                          <Pause className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <Play className="h-4 w-4 text-green-500" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {/* 编辑出价弹窗 */}
      <Dialog open={editBidOpen} onOpenChange={setEditBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑出价</DialogTitle>
            <DialogDescription>
              修改投放词 "{editingTarget?.text}" 的出价
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="currentBid" className="text-right">当前出价</Label>
              <div className="col-span-3">
                <span className="text-muted-foreground">${editingTarget?.bid || "N/A"}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="newBid" className="text-right">新出价</Label>
              <div className="col-span-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="newBid"
                    type="number"
                    step="0.01"
                    min="0.02"
                    value={newBid}
                    onChange={(e) => setNewBid(e.target.value)}
                    placeholder="输入新出价"
                    className="w-32"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBidOpen(false)}>取消</Button>
            <Button onClick={handleSaveBid} disabled={isMutating || !newBid}>
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 状态变更确认弹窗 */}
      <Dialog open={confirmStatusOpen} onOpenChange={setConfirmStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newStatus === "paused" ? "暂停投放词" : "启用投放词"}</DialogTitle>
            <DialogDescription>
              确定要{newStatus === "paused" ? "暂停" : "启用"}投放词 "{statusChangeTarget?.text}" 吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStatusOpen(false)}>取消</Button>
            <Button 
              onClick={handleConfirmStatusChange} 
              disabled={isMutating}
              variant={newStatus === "paused" ? "destructive" : "default"}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{newStatus === "paused" ? "暂停" : "启用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 批量修改出价弹窗 */}
      <Dialog open={batchBidOpen} onOpenChange={setBatchBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量修改出价</DialogTitle>
            <DialogDescription>
              已选择 {selectedIds.size} 个投放词，请选择调整方式
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">调整方式</Label>
              <div className="col-span-3">
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={batchBidType}
                  onChange={(e) => setBatchBidType(e.target.value as any)}
                >
                  <optgroup label="基于当前出价">
                    <option value="fixed">固定出价</option>
                    <option value="increase_percent">按百分比提高</option>
                    <option value="decrease_percent">按百分比降低</option>
                  </optgroup>
                  <optgroup label="基于CPC">
                    <option value="cpc_multiplier">按CPC倍数设置</option>
                    <option value="cpc_increase_percent">按CPC百分比提高</option>
                    <option value="cpc_decrease_percent">按CPC百分比降低</option>
                  </optgroup>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">
                {batchBidType === "fixed" ? "新出价 ($)" : batchBidType === "cpc_multiplier" ? "CPC倍数" : "调整比例 (%)"}
              </Label>
              <div className="col-span-3">
                <Input
                  type="number"
                  step={batchBidType === "fixed" ? "0.01" : batchBidType === "cpc_multiplier" ? "0.1" : "1"}
                  min="0"
                  value={batchBidValue}
                  onChange={(e) => setBatchBidValue(e.target.value)}
                  placeholder={
                    batchBidType === "fixed" ? "输入新出价" : 
                    batchBidType === "cpc_multiplier" ? "例如: 1.2 表示 CPC×1.2" : 
                    "输入百分比"
                  }
                />
              </div>
            </div>
            {/* CPC调整方式说明 */}
            {(batchBidType === "cpc_multiplier" || batchBidType === "cpc_increase_percent" || batchBidType === "cpc_decrease_percent") && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <p className="font-medium mb-1">💡 CPC调整说明</p>
                <p>CPC = 花费 ÷ 点击数，代表实际每次点击成本</p>
                {batchBidType === "cpc_multiplier" && (
                  <p>例如：输入 1.2，则新出价 = CPC × 1.2</p>
                )}
                {batchBidType === "cpc_increase_percent" && (
                  <p>例如：输入 20，则新出价 = CPC × 1.2</p>
                )}
                {batchBidType === "cpc_decrease_percent" && (
                  <p>例如：输入 20，则新出价 = CPC × 0.8</p>
                )}
                <p className="mt-1 text-yellow-500">注意：无点击数据的投放词将使用当前出价作为CPC基数</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchBidOpen(false)}>取消</Button>
            <Button onClick={handleBatchBid} disabled={isMutating || !batchBidValue}>
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 批量修改状态弹窗 */}
      <Dialog open={batchStatusOpen} onOpenChange={setBatchStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量{batchStatus === "enabled" ? "启用" : "暂停"}投放词</DialogTitle>
            <DialogDescription>
              确定要{batchStatus === "enabled" ? "启用" : "暂停"} {selectedIds.size} 个投放词吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchStatusOpen(false)}>取消</Button>
            <Button 
              onClick={handleBatchStatus} 
              disabled={isMutating}
              variant={batchStatus === "paused" ? "destructive" : "default"}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{batchStatus === "enabled" ? "启用" : "暂停"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 趋势图弹窗 */}
      {trendTarget && (
        <TargetTrendChart
          open={trendChartOpen}
          onOpenChange={setTrendChartOpen}
          targetId={trendTarget.id}
          targetType={trendTarget.type}
          targetName={trendTarget.name}
          matchType={trendTarget.matchType}
        />
      )}
      
      {/* 出价响应曲线弹窗 */}
      {bidCurveTarget && (
        <BidResponseCurve
          open={bidCurveOpen}
          onOpenChange={setBidCurveOpen}
          keywordId={bidCurveTarget.id}
          keywordText={bidCurveTarget.text}
          currentBid={bidCurveTarget.bid}
          matchType={bidCurveTarget.matchType}
          campaignId={campaignId}
        />
      )}
    </>
  );
}

// 搜索词列表子组件
