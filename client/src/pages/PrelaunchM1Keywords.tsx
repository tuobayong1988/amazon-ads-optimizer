/**
 * M1 搜索词库引擎 — 详情页
 * 关键词列表、四维分类分布、语义聚类、COSMO因果链
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Search, ArrowLeft, RefreshCw, Loader2, Play, Download,
  BarChart3, Layers, GitBranch, ChevronLeft, ChevronRight,
  Filter, ArrowUpDown, TrendingUp
} from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM1Keywords() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("keywords");
  const [relevanceFilter, setRelevanceFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'kviScore' | 'searchVolume' | 'drAmScore'>('kviScore');

  // 获取项目列表
  const projectsQuery = trpc.prelaunch.listProjects.useQuery();
  const projects = (() => {
    const d = projectsQuery.data;
    return (d && 'data' in (d as any) ? (d as any).data : d) || [];
  })();

  // 自动选择第一个项目
  if (!projectId && projects.length > 0) {
    setProjectId(projects[0].id);
  }

  // 获取关键词列表
  const keywordsQuery = trpc.prelaunch.getKeywords.useQuery(
    {
      projectId: projectId!,
      relevanceLayer: relevanceFilter as any || undefined,
      sortBy,
      page,
      pageSize: 30,
    },
    { enabled: !!projectId }
  );

  // 获取聚类数据
  const clustersQuery = trpc.prelaunch.getKeywordClusters.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'clusters' }
  );

  // 获取COSMO因果链
  const cosmoQuery = trpc.prelaunch.getCosmoTriples.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'cosmo' }
  );

  // 运行M1流水线
  const runM1 = trpc.prelaunch.runM1Pipeline.useMutation({
    onSuccess: () => {
      toast.success("M1搜索词库引擎已启动");
      keywordsQuery.refetch();
    },
    onError: (err) => toast.error("启动失败: " + err.message),
  });

  const keywordsData = (keywordsQuery.data as any)?.data || [];
  const totalKeywords = (keywordsQuery.data as any)?.total || 0;
  const clustersData = (clustersQuery.data as any)?.data || [];
  const cosmoData = (cosmoQuery.data as any)?.data || [];

  const relevanceLayers = [
    { key: '', label: '全部', color: '' },
    { key: 'core', label: '核心词', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    { key: 'extended', label: '扩展词', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { key: 'long_tail', label: '长尾词', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    { key: 'irrelevant', label: '无关词', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/prelaunch")}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              返回
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30">
                <Search className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M1 搜索词库引擎</h1>
                <p className="text-muted-foreground text-xs">关键词采集 → 四维分类 → 语义聚类 → COSMO因果链</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 项目选择 */}
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''}
              onChange={(e) => { setProjectId(Number(e.target.value)); setPage(1); }}
            >
              <option value="">选择项目</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.projectName}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => keywordsQuery.refetch()}
              disabled={keywordsQuery.isFetching}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${keywordsQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => projectId && runM1.mutate({ projectId, seedKeywords: [], marketplace: 'US' })}
              disabled={!projectId || runM1.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {runM1.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              运行M1
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">总关键词</p>
                  <p className="text-2xl font-bold">{totalKeywords.toLocaleString()}</p>
                </div>
                <Search className="w-8 h-8 text-blue-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">语义聚类</p>
                  <p className="text-2xl font-bold">{clustersData.length || 0}</p>
                </div>
                <Layers className="w-8 h-8 text-purple-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">COSMO三元组</p>
                  <p className="text-2xl font-bold">{cosmoData.length || 0}</p>
                </div>
                <GitBranch className="w-8 h-8 text-green-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">平均KVI分</p>
                  <p className="text-2xl font-bold">
                    {keywordsData.length > 0
                      ? (keywordsData.reduce((s: number, k: any) => s + Number(k.kviScore || 0), 0) / keywordsData.length).toFixed(2)
                      : '-'}
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-amber-400 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="keywords">关键词列表</TabsTrigger>
            <TabsTrigger value="clusters">语义聚类</TabsTrigger>
            <TabsTrigger value="cosmo">COSMO因果链</TabsTrigger>
          </TabsList>

          {/* 关键词列表 */}
          <TabsContent value="keywords" className="space-y-4">
            {/* 筛选栏 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Filter className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">分类:</span>
              </div>
              {relevanceLayers.map((layer) => (
                <Button
                  key={layer.key}
                  variant={relevanceFilter === layer.key ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setRelevanceFilter(layer.key); setPage(1); }}
                >
                  {layer.label}
                </Button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                <select
                  className="h-7 rounded border border-input bg-transparent px-2 text-xs"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                >
                  <option value="kviScore">KVI评分</option>
                  <option value="searchVolume">搜索量</option>
                  <option value="drAmScore">DR-AM评分</option>
                </select>
              </div>
            </div>

            {/* 关键词表格 */}
            <Card>
              <CardContent className="p-0">
                {keywordsData.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">暂无关键词数据</p>
                    <p className="text-xs mt-1">请先运行M1搜索词库引擎采集关键词</p>
                    <Button
                      size="sm"
                      className="mt-4"
                      onClick={() => projectId && runM1.mutate({ projectId, seedKeywords: [], marketplace: 'US' })}
                      disabled={!projectId || runM1.isPending}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      运行M1引擎
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-3 font-medium text-xs">关键词</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">分类</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">搜索量</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">KVI评分</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">DR-AM</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">场景</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">意图</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keywordsData.map((kw: any) => (
                          <tr key={kw.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{kw.keyword}</td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge variant="outline" className={`text-xs ${
                                kw.relevanceLayer === 'core' ? 'border-blue-500/50 text-blue-400' :
                                kw.relevanceLayer === 'extended' ? 'border-green-500/50 text-green-400' :
                                kw.relevanceLayer === 'long_tail' ? 'border-amber-500/50 text-amber-400' :
                                'border-gray-500/50 text-gray-400'
                              }`}>
                                {kw.relevanceLayer === 'core' ? '核心' :
                                 kw.relevanceLayer === 'extended' ? '扩展' :
                                 kw.relevanceLayer === 'long_tail' ? '长尾' : '无关'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{(kw.searchVolume || 0).toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium">{Number(kw.kviScore || 0).toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{Number(kw.drAmScore || 0).toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-center">
                              {kw.scenarioCode ? (
                                <Badge variant="secondary" className="text-xs">{kw.scenarioCode}</Badge>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {kw.intentTag ? (
                                <Badge variant="secondary" className="text-xs">{kw.intentTag}</Badge>
                              ) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 分页 */}
            {totalKeywords > 30 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  共 {totalKeywords} 条，第 {page} / {Math.ceil(totalKeywords / 30)} 页
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(totalKeywords / 30)} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 语义聚类 */}
          <TabsContent value="clusters" className="space-y-4">
            {clustersData.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">暂无聚类数据</p>
                  <p className="text-xs mt-1">运行M1引擎后将自动生成语义聚类</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clustersData.map((cluster: any) => (
                  <Card key={cluster.clusterId || cluster.id} className="hover:border-blue-500/30 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{cluster.clusterLabel || `聚类 #${cluster.clusterId}`}</CardTitle>
                        <Badge variant="secondary" className="text-xs">{cluster.keywordCount || 0} 词</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1">
                        {(cluster.topKeywords || []).slice(0, 5).map((kw: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* COSMO因果链 */}
          <TabsContent value="cosmo" className="space-y-4">
            {cosmoData.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">暂无COSMO因果链数据</p>
                  <p className="text-xs mt-1">运行M1引擎后将自动生成COSMO因果三元组</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-3 font-medium text-xs">主体 (Subject)</th>
                          <th className="text-center px-3 py-3 font-medium text-xs">关系 (Predicate)</th>
                          <th className="text-left px-3 py-3 font-medium text-xs">客体 (Object)</th>
                          <th className="text-right px-3 py-3 font-medium text-xs">置信度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cosmoData.map((triple: any, i: number) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-medium">{triple.subject}</td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge variant="secondary" className="text-xs">{triple.predicate}</Badge>
                            </td>
                            <td className="px-3 py-2.5">{triple.object}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {triple.confidence ? `${(Number(triple.confidence) * 100).toFixed(0)}%` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
