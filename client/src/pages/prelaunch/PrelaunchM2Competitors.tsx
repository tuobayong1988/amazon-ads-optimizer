/**
 * M2 竞品库引擎 — 详情页
 * 竞品列表、TRS评分排行、场景矩阵
 * 
 * v3.1 修复:
 * - tier 枚举修正为 T1_head / T2_waist / T3_niche（与后端一致）
 * - 新增属性过滤状态展示卡片
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Users, ArrowLeft, RefreshCw, Loader2, Play, BarChart3,
  Star, TrendingUp, ChevronLeft, ChevronRight, ExternalLink, Grid3X3,
  Filter, ShieldCheck
} from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM2Competitors() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("competitors");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery() as unknown;
  const projects = (() => {
    const d = (projectsQuery as any).data;
    // @ts-ignore
    return (d && 'data' in (d as unknown) ? (d as Record<string, unknown>).data : d) || [];
  })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const competitorsQuery = trpc.prelaunch.getCompetitors.useQuery(
    // @ts-ignore
    { projectId: projectId!, tier: tierFilter as unknown || undefined, page, pageSize: 20 },
    { enabled: !!projectId }
  // @ts-ignore
  );

  const scenarioMatrixQuery = trpc.prelaunch.getCompetitorScenarioMatrix.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'matrix' }
  );

  // v3.1: 获取 M1B 属性分析结果
  const attributeQuery = trpc.prelaunch.getAttributeAnalysis.useQuery(
    // @ts-ignore
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const runM2 = trpc.prelaunch.runM2Pipeline.useMutation({
    onSuccess: () => { toast.success("M2竞品库引擎已启动"); competitorsQuery.refetch(); },
    onError: (err: any) => toast.error("启动失败: " + err.message),
  });

  // @ts-ignore
  const competitorsData = (competitorsQuery.data as unknown)?.data || [];
  // @ts-ignore
  const totalCompetitors = (competitorsQuery.data as unknown)?.total || 0;
  // @ts-ignore
  const matrixData = (scenarioMatrixQuery.data as unknown)?.data || [];
  // @ts-ignore
  const attributeData = (attributeQuery.data as unknown)?.data || null;

  // v3.1: 修正 tier 枚举，与后端 T1_head / T2_waist / T3_niche 一致
  const tiers = [
    { key: '', label: '全部' },
    { key: 'T1_head', label: 'T1 头部竞品' },
    { key: 'T2_waist', label: 'T2 腰部竞品' },
    { key: 'T3_niche', label: 'T3 利基竞品' },
  ];

  /** v3.1: tier badge 样式映射 */
  const getTierStyle = (tier: string) => {
    switch (tier) {
      case 'T1_head': return 'border-red-500/50 text-red-400';
      case 'T2_waist': return 'border-amber-500/50 text-amber-400';
      case 'T3_niche': return 'border-gray-500/50 text-gray-400';
      default: return 'border-gray-500/50 text-gray-400';
    }
  };

  /** v3.1: tier 显示名称映射 */
  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'T1_head': return 'T1 头部';
      case 'T2_waist': return 'T2 腰部';
      case 'T3_niche': return 'T3 利基';
      default: return tier?.toUpperCase() || '-';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/prelaunch")}>
              <ArrowLeft className="w-4 h-4 mr-1" />返回
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30">
                <Users className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M2 竞品库引擎</h1>
                <p className="text-muted-foreground text-xs">竞品识别 → 属性过滤 → TRS评分 → 评论分析 → 场景矩阵</p>
              </div>
            {/* @ts-ignore */}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => { setProjectId(Number(e.target.value)); setPage(1); }}>
              <option value="">选择项目</option>
              {projects.map((p: unknown) => <option key={(p as any).id} value={(p as any).id}>{(p as any).projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => competitorsQuery.refetch()} disabled={competitorsQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${competitorsQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
            <Button size="sm" onClick={() => projectId && runM2.mutate({ projectId })}
              disabled={!projectId || runM2.isPending} className="bg-purple-600 hover:bg-purple-700">
              {runM2.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              运行M2
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">总竞品数</p>
              <p className="text-2xl font-bold">{totalCompetitors}</p>
            {/* @ts-ignore */}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">平均TRS评分</p>
              <p className="text-2xl font-bold">
                {competitorsData.length > 0
                  ? (competitorsData.reduce((s: number, c: unknown) => s + Number((c as any).trsScore || 0), 0) / competitorsData.length).toFixed(1)
                  : '-'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">场景矩阵</p>
              <p className="text-2xl font-bold">{matrixData.length || 0}</p>
            </CardContent>
          </Card>

          {/* v3.1: 属性过滤状态卡片 */}
          <Card className={attributeData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Filter className="w-3 h-3" />属性过滤
              </p>
              {attributeData ? (
                <div>
                  <p className="text-lg font-bold text-green-400 flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4" />
                    {(() => {
                      try {
                        const dims = typeof attributeData.activeFilterDimensions === 'string'
                          ? JSON.parse(attributeData.activeFilterDimensions)
                          : attributeData.activeFilterDimensions;
                        return Array.isArray(dims) ? `${dims.length} 维度激活` : '已分析';
                      } catch { return '已分析'; }
                    })()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                      try {
                        const dims = typeof attributeData.activeFilterDimensions === 'string'
                          ? JSON.parse(attributeData.activeFilterDimensions)
                          : attributeData.activeFilterDimensions;
                        if (Array.isArray(dims) && dims.length > 0) {
                          const dimLabels: Record<string, string> = { color: '颜色', size: '尺码', style: '款式', quantity: '数量' };
                          return dims.map((d: string) => dimLabels[d] || d).join('、');
                        }
                        return '无激活维度';
                      } catch { return ''; }
                    })()}
                  </p>
                </div>
              ) : (
                <p className="text-lg font-bold text-muted-foreground">未分析</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* @ts-ignore */}
          <TabsList>
            {/* @ts-ignore */}
            <TabsTrigger value="competitors">竞品列表</TabsTrigger>
            {/* @ts-ignore */}
            <TabsTrigger value="matrix">场景矩阵</TabsTrigger>
          </TabsList>

          <TabsContent value="competitors" className="space-y-4">
            <div className="flex items-center gap-2">
              {tiers.map((t) => (
                <Button key={t.key} variant={tierFilter === t.key ? "default" : "outline"} size="sm" className="h-7 text-xs"
                  onClick={() => { setTierFilter(t.key); setPage(1); }}>
                  {t.label}
                </Button>
              ))}
            </div>

            <Card>
              <CardContent className="p-0">
                {competitorsData.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">暂无竞品数据</p>
                    <p className="text-xs mt-1">请先运行M2竞品库引擎</p>
                    <Button size="sm" className="mt-4" onClick={() => projectId && runM2.mutate({ projectId })}
                      disabled={!projectId || runM2.isPending}>
                      <Play className="w-3 h-3 mr-1" />运行M2引擎
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {/* @ts-ignore */}
                          <th className="text-left px-4 py-3 font-medium text-xs">ASIN</th>
                          <th className="text-left px-3 py-3 font-medium text-xs">产品标题</th>
                          {/* @ts-ignore */}
                          <th className="text-center px-3 py-3 font-medium text-xs">层级</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">TRS评分</th>
                          {/* @ts-ignore */}
                          <th className="text-right px-3 py-3 font-medium text-xs">评分</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">评论数</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">价格</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">属性匹配</th>
                        {/* @ts-ignore */}
                        </tr>
                      </thead>
                      <tbody>
                        {competitorsData.map((comp: unknown) => {
                          const c = comp as any;
                          // v3.1: 从 rawData 中提取属性过滤结果
                          const attrFilter = (() => {
                            try {
                              const raw = typeof c.rawData === 'string' ? JSON.parse(c.rawData) : c.rawData;
                              return raw?.attributeFilter || null;
                            } catch { return null; }
                          })();

                          return (
                            <tr key={c.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-2.5">
                                <a href={`https://www.amazon.com/dp/${c.asin}`} target="_blank" rel="noopener noreferrer"
                                  className="text-blue-400 hover:underline flex items-center gap-1">
                                  {c.asin}<ExternalLink className="w-3 h-3" />
                                </a>
                              </td>
                              <td className="px-3 py-2.5 max-w-[300px] truncate">{c.title || '-'}</td>
                              <td className="px-3 py-2.5 text-center">
                                <Badge variant="outline" className={`text-xs ${getTierStyle(c.tier)}`}>
                                  {getTierLabel(c.tier)}
                                </Badge>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{Number(c.trsScore || 0).toFixed(1)}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="flex items-center justify-end gap-1">
                                  <Star className="w-3 h-3 text-amber-400" />{Number(c.rating || 0).toFixed(1)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{(c.reviewCount || 0).toLocaleString()}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">${Number(c.price || 0).toFixed(2)}</td>
                              <td className="px-3 py-2.5 text-center">
                                {attrFilter ? (
                                  <Badge variant="outline" className={`text-xs ${
                                    attrFilter.passed ? 'border-green-500/50 text-green-400' : 'border-orange-500/50 text-orange-400'
                                  }`}>
                                    {attrFilter.passed ? '通过' : '降级'}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {totalCompetitors > 20 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">共 {totalCompetitors} 条，第 {page} / {Math.ceil(totalCompetitors / 20)} 页</p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  {/* @ts-ignore */}
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(totalCompetitors / 20)} onClick={() => setPage(p => p + 1)}>
                    {/* @ts-ignore */}
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="matrix" className="space-y-4">
            {matrixData.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Grid3X3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">暂无场景矩阵数据</p>
                  <p className="text-xs mt-1">运行M2引擎后将自动生成场景矩阵</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {matrixData.map((item: unknown, i: number) => (
                  <Card key={i} className="hover:border-purple-500/30 transition-colors">
                    <CardHeader className="pb-2">
                      {/* @ts-ignore */}
                      <CardTitle className="text-sm">{item.scenario || item.scenarioCode || `场景 ${i + 1}`}</CardTitle>
                      {/* @ts-ignore */}
                      <CardDescription className="text-xs">{item.description || ''}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1">
                        {((item as any).competitors || (item as any).asins || []).slice(0, 5).map((c: unknown, j: number) => (
                          <Badge key={j} variant="outline" className="text-xs">{typeof c === 'string' ? c : (c as any).asin}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
