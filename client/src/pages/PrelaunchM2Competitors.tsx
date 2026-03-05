/**
 * M2 竞品库引擎 — 详情页
 * 竞品列表、TRS评分排行、场景矩阵
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
  Star, TrendingUp, ChevronLeft, ChevronRight, ExternalLink, Grid3X3
} from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM2Competitors() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("competitors");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery();
  const projects = (() => {
    const d = projectsQuery.data;
    return (d && 'data' in (d as any) ? (d as any).data : d) || [];
  })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const competitorsQuery = trpc.prelaunch.getCompetitors.useQuery(
    { projectId: projectId!, tier: tierFilter as any || undefined, page, pageSize: 20 },
    { enabled: !!projectId }
  );

  const scenarioMatrixQuery = trpc.prelaunch.getCompetitorScenarioMatrix.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'matrix' }
  );

  const runM2 = trpc.prelaunch.runM2Pipeline.useMutation({
    onSuccess: () => { toast.success("M2竞品库引擎已启动"); competitorsQuery.refetch(); },
    onError: (err) => toast.error("启动失败: " + err.message),
  });

  const competitorsData = (competitorsQuery.data as any)?.data || [];
  const totalCompetitors = (competitorsQuery.data as any)?.total || 0;
  const matrixData = (scenarioMatrixQuery.data as any)?.data || [];

  const tiers = [
    { key: '', label: '全部' },
    { key: 'tier1', label: 'Tier 1 (直接竞品)' },
    { key: 'tier2', label: 'Tier 2 (间接竞品)' },
    { key: 'tier3', label: 'Tier 3 (潜在竞品)' },
  ];

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
                <p className="text-muted-foreground text-xs">竞品识别 → TRS评分 → 评论分析 → 场景矩阵</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => { setProjectId(Number(e.target.value)); setPage(1); }}>
              <option value="">选择项目</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
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

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">总竞品数</p>
              <p className="text-2xl font-bold">{totalCompetitors}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">平均TRS评分</p>
              <p className="text-2xl font-bold">
                {competitorsData.length > 0
                  ? (competitorsData.reduce((s: number, c: any) => s + Number(c.trsScore || 0), 0) / competitorsData.length).toFixed(1)
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
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="competitors">竞品列表</TabsTrigger>
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
                          <th className="text-left px-4 py-3 font-medium text-xs">ASIN</th>
                          <th className="text-left px-3 py-3 font-medium text-xs">产品标题</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">层级</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">TRS评分</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">评分</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">评论数</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">价格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {competitorsData.map((comp: any) => (
                          <tr key={comp.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <a href={`https://www.amazon.com/dp/${comp.asin}`} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 hover:underline flex items-center gap-1">
                                {comp.asin}<ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                            <td className="px-3 py-2.5 max-w-[300px] truncate">{comp.title || '-'}</td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge variant="outline" className={`text-xs ${
                                comp.tier === 'tier1' ? 'border-red-500/50 text-red-400' :
                                comp.tier === 'tier2' ? 'border-amber-500/50 text-amber-400' :
                                'border-gray-500/50 text-gray-400'
                              }`}>
                                {comp.tier?.toUpperCase() || '-'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium">{Number(comp.trsScore || 0).toFixed(1)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="flex items-center justify-end gap-1">
                                <Star className="w-3 h-3 text-amber-400" />{Number(comp.rating || 0).toFixed(1)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{(comp.reviewCount || 0).toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">${Number(comp.price || 0).toFixed(2)}</td>
                          </tr>
                        ))}
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
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(totalCompetitors / 20)} onClick={() => setPage(p => p + 1)}>
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
                {matrixData.map((item: any, i: number) => (
                  <Card key={i} className="hover:border-purple-500/30 transition-colors">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{item.scenario || item.scenarioCode || `场景 ${i + 1}`}</CardTitle>
                      <CardDescription className="text-xs">{item.description || ''}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1">
                        {(item.competitors || item.asins || []).slice(0, 5).map((c: any, j: number) => (
                          <Badge key={j} variant="outline" className="text-xs">{typeof c === 'string' ? c : c.asin}</Badge>
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
