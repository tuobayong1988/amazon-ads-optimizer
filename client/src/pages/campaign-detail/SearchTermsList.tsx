// @ts-nocheck
/**
 * v361: 从CampaignDetail.tsx拆分的SearchTermsList子组件
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Filter, Loader2, MoreHorizontal, Plus, Tag } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

export function SearchTermsList({ campaignId }: { campaignId: number }) {
  const { data: searchTerms, isLoading, refetch } = trpc.campaign.getSearchTerms.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  // 获取广告组列表（用于选择目标广告组）
  const { data: adGroups } = trpc.campaign.getAdGroups.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  // 筛选状态
  const [showFilters, setShowFilters] = useState(false);
  const [stFilters, setStFilters] = useState({
    matchType: "all" as "all" | "broad" | "phrase" | "exact",
    spendMin: "",
    spendMax: "",
    salesMin: "",
    salesMax: "",
    ordersMin: "",
    ordersMax: "",
    acosMin: "",
    acosMax: "",
    roasMin: "",
    roasMax: "",
    ctrMin: "",
    ctrMax: "",
    cvrMin: "",
    cvrMax: "",
  });
  
  // 批量选择状态
  const [selectedTermIds, setSelectedTermIds] = useState<Set<number>>(new Set());
  
  // 否定词弹窗状态
  const [negateDialogOpen, setNegateDialogOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<any>(null);
  const [negateMatchType, setNegateMatchType] = useState<"phrase" | "exact">("phrase");
  
  // 添加为投放词弹窗状态
  const [addKeywordDialogOpen, setAddKeywordDialogOpen] = useState(false);
  const [addKeywordConfig, setAddKeywordConfig] = useState({
    adGroupId: 0,
    matchType: "exact" as "broad" | "phrase" | "exact",
    bid: "0.75",
  });
  
  // 添加否定词 mutation
  const addNegativeKeywordMutation = trpc.adAutomation.applyNegativeKeywords.useMutation({
    onSuccess: () => {
      toast.success("已添加为否定关键词");
      setNegateDialogOpen(false);
      setSelectedTerm(null);
    },
    onError: (error: any) => {
      toast.error(`添加失败: ${error.message}`);
    }
  });
  
  // 批量创建关键词 mutation
  const batchCreateKeywordsMutation = trpc.keyword.batchCreate.useMutation({
    onSuccess: (result) => {
      if (result.created > 0) {
        toast.success(`成功添加 ${result.created} 个投放词`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} 个投放词添加失败（可能已存在）`);
      }
      setAddKeywordDialogOpen(false);
      setSelectedTermIds(new Set());
      refetch();
    },
    onError: (error: any) => {
      toast.error(`添加失败: ${error.message}`);
    }
  });
  
  // 处理批量选择
  const handleSelectTerm = (termId: number, checked: boolean) => {
    const newSelected = new Set(selectedTermIds);
    if (checked) {
      newSelected.add(termId);
    } else {
      newSelected.delete(termId);
    }
    setSelectedTermIds(newSelected);
  };
  
  // 全选/取消全选
  const handleSelectAll = (checked: boolean, terms: any[]) => {
    if (checked) {
      setSelectedTermIds(new Set(terms.map((t: any) => t.id)));
    } else {
      setSelectedTermIds(new Set());
    }
  };
  
  // 打开添加投放词弹窗
  const handleOpenAddKeywordDialog = () => {
    if (selectedTermIds.size === 0) {
      toast.warning("请先选择要添加的搜索词");
      return;
    }
    // 默认选择第一个广告组
    if (adGroups && adGroups.length > 0) {
      setAddKeywordConfig(prev => ({ ...prev, adGroupId: adGroups[0].id }));
    }
    setAddKeywordDialogOpen(true);
  };
  
  // 确认添加为投放词
  const confirmAddKeywords = () => {
    if (addKeywordConfig.adGroupId === 0) {
      toast.error("请选择目标广告组");
      return;
    }
    
    const selectedTerms = searchTerms?.filter((t: any) => selectedTermIds.has(t.id)) || [];
    const keywords = selectedTerms.map((term: any) => ({
      keywordText: term.searchTerm,
      matchType: addKeywordConfig.matchType,
      bid: addKeywordConfig.bid,
    }));
    
    batchCreateKeywordsMutation.mutate({
      adGroupId: addKeywordConfig.adGroupId,
      keywords,
    });
  };
  
  // 处理否定词操作
  const handleNegate = (term: any) => {
    setSelectedTerm(term);
    setNegateDialogOpen(true);
  };
  
  // 确认添加否定词
  const confirmNegate = () => {
    if (!selectedTerm) return;
    addNegativeKeywordMutation.mutate({
      accountId: 1,
      campaignId,
      negatives: [{
        keyword: selectedTerm.searchTerm,
        matchType: negateMatchType,
      }]
    });
  };
  
  // 清除筛选
  const clearStFilters = () => {
    setStFilters({
      matchType: "all",
      spendMin: "",
      spendMax: "",
      salesMin: "",
      salesMax: "",
      ordersMin: "",
      ordersMax: "",
      acosMin: "",
      acosMax: "",
      roasMin: "",
      roasMax: "",
      ctrMin: "",
      ctrMax: "",
      cvrMin: "",
      cvrMax: "",
    });
  };
  
  // 检查是否有激活的筛选
  const hasActiveStFilters = () => {
    return stFilters.matchType !== "all" ||
      stFilters.spendMin !== "" ||
      stFilters.spendMax !== "" ||
      stFilters.salesMin !== "" ||
      stFilters.salesMax !== "" ||
      stFilters.ordersMin !== "" ||
      stFilters.ordersMax !== "" ||
      stFilters.acosMin !== "" ||
      stFilters.acosMax !== "" ||
      stFilters.roasMin !== "" ||
      stFilters.roasMax !== "" ||
      stFilters.ctrMin !== "" ||
      stFilters.ctrMax !== "" ||
      stFilters.cvrMin !== "" ||
      stFilters.cvrMax !== "";
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (!searchTerms || searchTerms.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无搜索词数据</p>
      </div>
    );
  }
  
  // 筛选搜索词
  const filteredTerms = searchTerms.filter((term: any) => {
    const stSpend = parseFloat(term.spend || "0");
    const stSales = parseFloat(term.sales || "0");
    const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
    const stRoas = stSpend > 0 ? (stSales / stSpend) : 0;
    const stCtr = term.impressions > 0 ? (term.clicks / term.impressions * 100) : 0;
    const stCvr = term.clicks > 0 ? ((term.orders || 0) / term.clicks * 100) : 0;
    
    // 匹配类型筛选
    if (stFilters.matchType !== "all" && term.matchType !== stFilters.matchType) return false;
    
    // 花费范围筛选
    if (stFilters.spendMin && stSpend < parseFloat(stFilters.spendMin)) return false;
    if (stFilters.spendMax && stSpend > parseFloat(stFilters.spendMax)) return false;
    
    // 销售额范围筛选
    if (stFilters.salesMin && stSales < parseFloat(stFilters.salesMin)) return false;
    if (stFilters.salesMax && stSales > parseFloat(stFilters.salesMax)) return false;
    
    // 订单范围筛选
    if (stFilters.ordersMin && (term.orders || 0) < parseInt(stFilters.ordersMin)) return false;
    if (stFilters.ordersMax && (term.orders || 0) > parseInt(stFilters.ordersMax)) return false;
    
    // ACoS范围筛选
    if (stFilters.acosMin && stAcos < parseFloat(stFilters.acosMin)) return false;
    if (stFilters.acosMax && stAcos > parseFloat(stFilters.acosMax)) return false;
    
    // ROAS范围筛选
    if (stFilters.roasMin && stRoas < parseFloat(stFilters.roasMin)) return false;
    if (stFilters.roasMax && stRoas > parseFloat(stFilters.roasMax)) return false;
    
    // 点击率范围筛选
    if (stFilters.ctrMin && stCtr < parseFloat(stFilters.ctrMin)) return false;
    if (stFilters.ctrMax && stCtr > parseFloat(stFilters.ctrMax)) return false;
    
    // 转化率范围筛选
    if (stFilters.cvrMin && stCvr < parseFloat(stFilters.cvrMin)) return false;
    if (stFilters.cvrMax && stCvr > parseFloat(stFilters.cvrMax)) return false;
    
    return true;
  });
  
  // 按销售额排序
  const sortedTerms = [...filteredTerms].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            筛选
            {hasActiveStFilters() && <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">•</span>}
          </Button>
          {hasActiveStFilters() && (
            <Button variant="ghost" size="sm" onClick={clearStFilters}>
              清除筛选
            </Button>
          )}
          {/* 批量操作按钮 */}
          {selectedTermIds.size > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <span className="text-sm text-muted-foreground">
                已选 {selectedTermIds.size} 项
              </span>
              <Button
                variant="default"
                size="sm"
                onClick={handleOpenAddKeywordDialog}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加为投放词
              </Button>
            </>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          共 {filteredTerms.length} / {searchTerms.length} 个搜索词
        </div>
      </div>
      
      {/* 筛选面板 */}
      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {/* 匹配类型 */}
              <div>
                <Label className="text-xs">匹配类型</Label>
                <Select value={stFilters.matchType} onValueChange={(v: any) => setStFilters({...stFilters, matchType: v})}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="broad">广泛</SelectItem>
                    <SelectItem value="phrase">词组</SelectItem>
                    <SelectItem value="exact">精确</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* 花费范围 */}
              <div>
                <Label className="text-xs">花费范围 ($)</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.spendMin}
                    onChange={(e) => setStFilters({...stFilters, spendMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.spendMax}
                    onChange={(e) => setStFilters({...stFilters, spendMax: e.target.value})}
                  />
                </div>
              </div>
              
              {/* 订单范围 */}
              <div>
                <Label className="text-xs">订单范围</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.ordersMin}
                    onChange={(e) => setStFilters({...stFilters, ordersMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.ordersMax}
                    onChange={(e) => setStFilters({...stFilters, ordersMax: e.target.value})}
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
                    value={stFilters.acosMin}
                    onChange={(e) => setStFilters({...stFilters, acosMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.acosMax}
                    onChange={(e) => setStFilters({...stFilters, acosMax: e.target.value})}
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
                    value={stFilters.roasMin}
                    onChange={(e) => setStFilters({...stFilters, roasMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.roasMax}
                    onChange={(e) => setStFilters({...stFilters, roasMax: e.target.value})}
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
                    value={stFilters.cvrMin}
                    onChange={(e) => setStFilters({...stFilters, cvrMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.cvrMax}
                    onChange={(e) => setStFilters({...stFilters, cvrMax: e.target.value})}
                  />
                </div>
              </div>
            </div>
            
            {/* 快捷筛选预设 */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground mr-2">快捷筛选:</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, spendMin: "5", ordersMin: "", ordersMax: "0"})}
              >
                🚨 高花费0转化
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, acosMin: "50", ordersMin: ""})}
              >
                ⚠️ ACoS{'>'}50%
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, ordersMin: "3", acosMax: "25"})}
              >
                ⭐ 高价值词
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, cvrMin: "10"})}
              >
                📈 高转化率
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* 搜索词表格 */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={sortedTerms.length > 0 && selectedTermIds.size === sortedTerms.length}
                  onCheckedChange={(checked) => handleSelectAll(!!checked, sortedTerms)}
                />
              </TableHead>
              <TableHead>客户搜索词</TableHead>
              <TableHead>搜索词类型</TableHead>
              <TableHead>源头投放词/ASIN</TableHead>
              <TableHead>来源类型</TableHead>
              <TableHead>来源匹配方式</TableHead>
              <TableHead className="text-right">展示</TableHead>
              <TableHead className="text-right">点击</TableHead>
              <TableHead className="text-right">点击率</TableHead>
              <TableHead className="text-right">花费</TableHead>
              <TableHead className="text-right">CPC</TableHead>
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
            {sortedTerms.map((term: any, index: number) => {
              const stSpend = parseFloat(term.spend || "0");
              const stSales = parseFloat(term.sales || "0");
              const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
              const stRoas = stSpend > 0 ? (stSales / stSpend) : 0;
              const stCtr = term.impressions > 0 ? (term.clicks / term.impressions * 100) : 0;
              const stCvr = term.clicks > 0 ? ((term.orders || 0) / term.clicks * 100) : 0;
              
              // 判断是否为低效搜索词（高花费0转化或ACoS过高）
              const isLowPerforming = (stSpend >= 5 && (term.orders || 0) === 0) || stAcos > 50;
              // 判断是否为高价值搜索词
              const isHighValue = (term.orders || 0) >= 3 && stAcos <= 25;
              
              return (
                <TableRow key={term.id || index} className={isLowPerforming ? "bg-red-500/5" : isHighValue ? "bg-green-500/5" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selectedTermIds.has(term.id)}
                      onCheckedChange={(checked) => handleSelectTerm(term.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[180px] truncate" title={term.searchTerm}>
                    <div className="flex items-center gap-1">
                      {isLowPerforming && <span title="低效搜索词">🚨</span>}
                      {isHighValue && <span title="高价值搜索词">⭐</span>}
                      {term.searchTerm}
                    </div>
                  </TableCell>
                  <TableCell>
                    {term.searchTermType === 'asin' ? (
                      <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-700">ASIN</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">关键词</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-muted-foreground" title={term.targetText}>
                    {term.targetText || "-"}
                  </TableCell>
                  <TableCell>
                    {(term.sourceTargetType || term.targetType) === "product_target" ? (
                      <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700">商品定向</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">关键词</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const mt = term.sourceMatchType || term.matchType || '';
                      if ((term.sourceTargetType || term.targetType) === "product_target") {
                        const ptMatchMap: Record<string, {label: string, color: string}> = {
                          'exact': { label: '精确定向', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                          'expanded': { label: '拓展定向', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                          'category_exact': { label: '品类定向', color: 'bg-teal-50 text-teal-700 border-teal-200' },
                          'brand_exact': { label: '品牌定向', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
                          'substitute': { label: '替代商品', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                          'accessory': { label: '关联商品', color: 'bg-lime-50 text-lime-700 border-lime-200' },
                          'loose': { label: '宽泛匹配', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                          'close': { label: '紧密匹配', color: 'bg-rose-50 text-rose-700 border-rose-200' },
                        };
                        const info = ptMatchMap[mt] || { label: mt || '自动', color: 'bg-gray-50 text-gray-700 border-gray-200' };
                        return <Badge variant="outline" className={`text-xs ${info.color}`}>{info.label}</Badge>;
                      } else {
                        const kwMatchMap: Record<string, {label: string, color: string}> = {
                          'broad': { label: '广泛', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                          'phrase': { label: '词组', color: 'bg-green-50 text-green-700 border-green-200' },
                          'exact': { label: '精确', color: 'bg-red-50 text-red-700 border-red-200' },
                        };
                        const info = kwMatchMap[mt] || { label: mt || '广泛', color: 'bg-gray-50 text-gray-700 border-gray-200' };
                        return <Badge variant="outline" className={`text-xs ${info.color}`}>{info.label}</Badge>;
                      }
                    })()}
                  </TableCell>
                  <TableCell className="text-right">{term.impressions?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{term.clicks?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{stCtr.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">${stSpend.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    {term.clicks > 0 ? `$${(stSpend / term.clicks).toFixed(2)}` : "-"}
                  </TableCell>
                  <TableCell className="text-right">{term.orders || 0}</TableCell>
                  <TableCell className="text-right">{term.unitsOrdered || term.searchTermUnitsOrdered || 0}</TableCell>
                  <TableCell className="text-right">${stSales.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={stCvr >= 10 ? "text-green-500" : stCvr >= 5 ? "text-yellow-500" : "text-muted-foreground"}>
                      {term.clicks > 0 ? `${stCvr.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={stAcos > 30 ? "text-red-500" : stAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                      {stSales > 0 ? `${stAcos.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={stRoas >= 4 ? "text-green-500" : stRoas >= 2 ? "text-yellow-500" : "text-muted-foreground"}>
                      {stSpend > 0 ? stRoas.toFixed(2) : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleNegate(term)}>
                          <Ban className="h-4 w-4 mr-2" />
                          添加为否定词
                        </DropdownMenuItem>
                        {isHighValue && (
                          <DropdownMenuItem onClick={() => toast.info("迁移功能开发中...")}>
                            <ArrowUpRight className="h-4 w-4 mr-2" />
                            迁移到精确匹配
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {/* 否定词弹窗 */}
      <Dialog open={negateDialogOpen} onOpenChange={setNegateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加为否定关键词</DialogTitle>
            <DialogDescription>
              将搜索词 "{selectedTerm?.searchTerm}" 添加为否定关键词，阻止广告在该搜索词上展示
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>否定匹配类型</Label>
              <Select value={negateMatchType} onValueChange={(v: "phrase" | "exact") => setNegateMatchType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phrase">
                    <div className="flex flex-col">
                      <span>词组否定</span>
                      <span className="text-xs text-muted-foreground">包含该词组的搜索词都不会触发广告</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="exact">
                    <div className="flex flex-col">
                      <span>精确否定</span>
                      <span className="text-xs text-muted-foreground">仅完全匹配该搜索词时不触发广告</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedTerm && (
              <div className="bg-muted p-3 rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">花费:</span>
                  <span>${parseFloat(selectedTerm.spend || "0").toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单:</span>
                  <span>{selectedTerm.orders || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ACoS:</span>
                  <span>
                    {parseFloat(selectedTerm.sales || "0") > 0 
                      ? `${(parseFloat(selectedTerm.spend || "0") / parseFloat(selectedTerm.sales || "0") * 100).toFixed(1)}%`
                      : "-"}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNegateDialogOpen(false)}>
              取消
            </Button>
            <Button 
              onClick={confirmNegate}
              disabled={addNegativeKeywordMutation.isPending}
            >
              {addNegativeKeywordMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />添加中...</>
              ) : (
                "确认添加"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 添加为投放词弹窗 */}
      <Dialog open={addKeywordDialogOpen} onOpenChange={setAddKeywordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加为投放词</DialogTitle>
            <DialogDescription>
              将选中的 {selectedTermIds.size} 个搜索词添加为新的投放关键词
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* 目标广告组 */}
            <div className="space-y-2">
              <Label>目标广告组</Label>
              <Select 
                value={addKeywordConfig.adGroupId.toString()} 
                onValueChange={(v) => setAddKeywordConfig({...addKeywordConfig, adGroupId: parseInt(v)})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择广告组" />
                </SelectTrigger>
                <SelectContent>
                  {adGroups?.map((ag: any) => (
                    <SelectItem key={ag.id} value={ag.id.toString()}>
                      {ag.adGroupName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* 匹配方式 */}
            <div className="space-y-2">
              <Label>匹配方式</Label>
              <Select 
                value={addKeywordConfig.matchType} 
                onValueChange={(v: "broad" | "phrase" | "exact") => setAddKeywordConfig({...addKeywordConfig, matchType: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">
                    <div className="flex flex-col">
                      <span>精准匹配</span>
                      <span className="text-xs text-muted-foreground">仅完全匹配时触发，最精准</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="phrase">
                    <div className="flex flex-col">
                      <span>词组匹配</span>
                      <span className="text-xs text-muted-foreground">包含该词组时触发</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="broad">
                    <div className="flex flex-col">
                      <span>广泛匹配</span>
                      <span className="text-xs text-muted-foreground">相关搜索词都可触发，覆盖面最广</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* 初始出价 */}
            <div className="space-y-2">
              <Label>初始出价 ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.02"
                value={addKeywordConfig.bid}
                onChange={(e) => setAddKeywordConfig({...addKeywordConfig, bid: e.target.value})}
                placeholder="0.75"
              />
            </div>
            
            {/* 选中的搜索词预览 */}
            <div className="space-y-2">
              <Label>选中的搜索词</Label>
              <div className="bg-muted p-3 rounded-lg max-h-[150px] overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {searchTerms?.filter((t: any) => selectedTermIds.has(t.id)).map((term: any) => (
                    <Badge key={term.id} variant="secondary" className="text-xs">
                      {term.searchTerm}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddKeywordDialogOpen(false)}>
              取消
            </Button>
            <Button 
              onClick={confirmAddKeywords}
              disabled={batchCreateKeywordsMutation.isPending || addKeywordConfig.adGroupId === 0}
            >
              {batchCreateKeywordsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />添加中...</>
              ) : (
                `添加 ${selectedTermIds.size} 个投放词`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// 广告位置绩效列表组件
// 否定关键词列表组件
