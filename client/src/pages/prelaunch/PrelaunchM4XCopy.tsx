/**
 * M4X 文案进化引擎 — 详情页
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileText, ArrowLeft, RefreshCw, Loader2, Play, Sparkles, History, HelpCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM4XCopy() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("copies");
  const [generation, setGeneration] = useState<number | undefined>(undefined);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery() as unknown;
  const projects = (() => { const d = projectsQuery.data; return (d && 'data' in (d as unknown) ? (d as Record<string, unknown>).data : d) || []; })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const copiesQuery = trpc.prelaunch.getCopyVersions.useQuery(
    { projectId: projectId!, generation },
    { enabled: !!projectId }
  );

  const qnaQuery = trpc.prelaunch.getQnaSeeds.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'qna' }
  );

  const generateMutation = trpc.prelaunch.runM4XGenerate.useMutation({
    onSuccess: () => { toast.success("文案生成已启动"); copiesQuery.refetch(); },
    onError: (err) => toast.error("生成失败: " + err.message),
  });

  const evolveMutation = trpc.prelaunch.runM4XEvolve.useMutation({
    onSuccess: () => { toast.success("文案进化已启动"); copiesQuery.refetch(); },
    onError: (err) => toast.error("进化失败: " + err.message),
  });

  const copiesData = (copiesQuery.data as unknown)?.data || [];
  const qnaData = (qnaQuery.data as unknown)?.data || [];

  const copyTypeLabels: Record<string, { label: string; color: string }> = {
    title: { label: 'Title', color: 'bg-blue-500/20 text-blue-400' },
    bullet: { label: 'Bullet Point', color: 'bg-green-500/20 text-green-400' },
    description: { label: 'Description', color: 'bg-purple-500/20 text-purple-400' },
    search_term: { label: 'Search Term', color: 'bg-amber-500/20 text-amber-400' },
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
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M4X 文案进化引擎</h1>
                <p className="text-muted-foreground text-xs">Title/Bullet/Description → 半监督进化 → A/B归因</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="">选择项目</option>
              {projects.map((p: unknown) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => copiesQuery.refetch()} disabled={copiesQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${copiesQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => projectId && generateMutation.mutate({ projectId })}
              disabled={!projectId || generateMutation.isPending}>
              {generateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              生成初稿
            </Button>
            <Button size="sm"
              onClick={() => projectId && evolveMutation.mutate({ projectId })}
              disabled={!projectId || evolveMutation.isPending || copiesData.length === 0}
              className="bg-amber-600 hover:bg-amber-700">
              {evolveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <History className="w-3 h-3 mr-1" />}
              进化迭代
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="copies">文案版本</TabsTrigger>
            <TabsTrigger value="qna">QnA种子</TabsTrigger>
          </TabsList>

          <TabsContent value="copies" className="space-y-4">
            {copiesData.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-base font-medium">暂无文案数据</p>
                  <p className="text-sm mt-2">点击"生成初稿"开始创建Listing文案</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {copiesData.map((copy: unknown) => {
                  const typeInfo = copyTypeLabels[copy.copyType] || { label: copy.copyType, color: 'bg-gray-500/20 text-gray-400' };
                  return (
                    <Card key={copy.id} className="hover:border-amber-500/20 transition-colors">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                            <Badge variant="outline" className="text-xs">Gen {copy.generation || 1}</Badge>
                          </div>
                          {copy.fitnessScore && (
                            <span className="text-xs text-muted-foreground">适应度: {Number(copy.fitnessScore).toFixed(2)}</span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm whitespace-pre-wrap">{copy.content || copy.copyContent || '-'}</p>
                        {copy.abResult && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-muted-foreground">A/B归因: {copy.abResult}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="qna" className="space-y-4">
            {qnaData.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <HelpCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">暂无QnA种子数据</p>
                  <p className="text-xs mt-1">生成文案初稿时将自动创建QnA种子</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {qnaData.map((qna: unknown, i: number) => (
                  <Card key={i}>
                    <CardContent className="py-4">
                      <p className="text-sm font-medium">Q: {qna.question}</p>
                      <p className="text-sm text-muted-foreground mt-2">A: {qna.answer}</p>
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
